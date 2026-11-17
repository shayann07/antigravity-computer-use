// Kernel-verified caller identity for the AI-app gate (#60), macOS side of
// CallerGate.cs.
//
// The service cannot learn who is calling it. This gate can: it listens on a
// Unix socket in a fresh private directory (mode 0700, the current user only),
// the service hands the socket path to its authenticated client, and the
// client connects. The gate reads the client's process id from the kernel
// (LOCAL_PEERPID), checks the peer is the same user, and walks the parent
// chain while the client is still connected. Every hop must report a full
// image path and be strictly older than its child; the first hop that fails
// ends the walk, so a reused process id never joins the chain. The client gets
// a one-time nonce that expires in 30 seconds, and the service redeems it here.
// The service never accepts a host name or process id from the request itself.
import Foundation
import Darwin
import Security

enum MacCallerGate {
    static let maxDepth = 16
    static let connectTimeoutMs: Int32 = 5000
    static let nonceLifetime: TimeInterval = 30

    private struct Pending { let chain: [[String: Any]]; let expires: Date }
    private static let sync = NSLock()
    private static var nonces: [String: Pending] = [:]

    private static func hex(_ count: Int) -> String? {
        var bytes = [UInt8](repeating: 0, count: count)
        guard SecRandomCopyBytes(kSecRandomDefault, count, &bytes) == errSecSuccess else { return nil }
        return bytes.map { String(format: "%02x", $0) }.joined()
    }

    // Opens a one-connection socket that only the current user can reach.
    static func open() throws -> [String: Any] {
        guard let name = hex(16) else { return ["pipe": NSNull()] }
        var template = Array((NSTemporaryDirectory() as NSString).appendingPathComponent("agcu.XXXXXX").utf8CString)
        guard let made = mkdtemp(&template) else { return ["pipe": NSNull()] }
        let directory = String(cString: made)
        let socketPath = (directory as NSString).appendingPathComponent("gate.\(name)")
        let cleanup = { unlink(socketPath); rmdir(directory) }
        guard chmod(directory, 0o700) == 0, socketPath.utf8.count < 104 else { cleanup(); return ["pipe": NSNull()] }
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { cleanup(); return ["pipe": NSNull()] }
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        withUnsafeMutableBytes(of: &address.sun_path) { raw in
            let bytes = Array(socketPath.utf8)
            raw.copyBytes(from: bytes)
            raw[bytes.count] = 0
        }
        let size = socklen_t(MemoryLayout<sockaddr_un>.size)
        let bound = withUnsafePointer(to: &address) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, size) } }
        guard bound == 0, chmod(socketPath, 0o600) == 0, listen(fd, 1) == 0 else { close(fd); cleanup(); return ["pipe": NSNull()] }
        Thread.detachNewThread { serve(fd, cleanup: cleanup) }
        return ["pipe": socketPath]
    }

    // Accepts one client within the timeout, answers with a nonce, then removes the socket.
    private static func serve(_ listener: Int32, cleanup: @escaping () -> Void) {
        defer { close(listener); cleanup() }
        var poller = pollfd(fd: listener, events: Int16(POLLIN), revents: 0)
        guard poll(&poller, 1, connectTimeoutMs) == 1 else { return }
        let client = accept(listener, nil, nil)
        guard client >= 0 else { return }
        defer { close(client) }
        var uid = uid_t(0), gid = gid_t(0)
        guard getpeereid(client, &uid, &gid) == 0, uid == getuid() else { return }
        var pid = pid_t(0)
        var length = socklen_t(MemoryLayout<pid_t>.size)
        guard getsockopt(client, SOL_LOCAL, LOCAL_PEERPID, &pid, &length) == 0, pid > 0 else { return }
        let chain = walk(pid)
        guard !chain.isEmpty, let nonce = hex(32) else { return }
        sync.lock()
        let now = Date()
        nonces = nonces.filter { $0.value.expires > now }
        nonces[nonce] = Pending(chain: chain, expires: now.addingTimeInterval(nonceLifetime))
        sync.unlock()
        let line = Array((nonce + "\n").utf8)
        _ = line.withUnsafeBytes { write(client, $0.baseAddress, $0.count) }
    }

    struct Hop: Equatable { let pid: pid_t; let parent: pid_t; let started: UInt64; let path: String }

    static func describe(_ pid: pid_t) -> Hop? {
        var info = proc_bsdinfo()
        let size = Int32(MemoryLayout<proc_bsdinfo>.size)
        guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size else { return nil }
        var buffer = [CChar](repeating: 0, count: Int(4 * MAXPATHLEN))
        guard proc_pidpath(pid, &buffer, UInt32(buffer.count)) > 0 else { return nil }
        let path = String(cString: buffer)
        guard path.hasPrefix("/") else { return nil }
        let started = UInt64(info.pbi_start_tvsec) * 1_000_000 + UInt64(info.pbi_start_tvusec)
        return Hop(pid: pid, parent: pid_t(info.pbi_ppid), started: started, path: path)
    }

    // The client first, then each parent that is strictly older than its child.
    static func chain(from pid: pid_t, describe: (pid_t) -> Hop? = describe) -> [Hop] {
        var hops: [Hop] = []
        var current = pid
        while hops.count < maxDepth, current > 0, let hop = describe(current) {
            if let child = hops.last, hop.started >= child.started { break }
            hops.append(hop)
            if hop.parent == hop.pid || hop.parent <= 0 { break }
            current = hop.parent
        }
        return hops
    }

    static func walk(_ pid: pid_t) -> [[String: Any]] {
        chain(from: pid).map { ["pid": Int($0.pid), "path": $0.path, "created": String($0.started)] }
    }

    // One use: the nonce is removed whether or not it was valid.
    static func redeem(_ args: [String: Any]) -> [String: Any] {
        guard let nonce = args["nonce"] as? String, nonce.count == 64, nonce.allSatisfy({ $0.isHexDigit && !$0.isUppercase }) else {
            return ["resolved": false, "chain": [Any]()]
        }
        sync.lock(); defer { sync.unlock() }
        guard let pending = nonces.removeValue(forKey: nonce), pending.expires > Date(), !pending.chain.isEmpty else {
            return ["resolved": false, "chain": [Any]()]
        }
        return ["resolved": true, "chain": pending.chain]
    }
}
