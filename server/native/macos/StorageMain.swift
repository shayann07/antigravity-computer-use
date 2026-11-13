import Foundation
import Darwin

func storageReply(_ value: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    FileHandle.standardOutput.write(data + Data([10]))
}

@main enum StorageMain {
    static func main() {
        do {
            let args = Array(CommandLine.arguments.dropFirst())
            if args == ["identity"] { storageReply(["ok": true, "owner_uid": getuid()]); return }
            guard args.count == 2 else { throw PrivateStorageError(code: "bad_arguments", path: "", message: "Pass a storage operation and absolute directory.") }
            let mode = args[0]
            guard ["install", "data", "legacy", "verify", "verify-tree", "verify-data-tree", "lease"].contains(mode) else {
                throw PrivateStorageError(code: "bad_arguments", path: args[1], message: "Unknown storage operation.")
            }
            if mode == "lease" { try lease(args[1]); return }
            let root: String
            if mode.hasPrefix("verify") {
                root = try MacPrivateStorage.normalized(args[1])
                if mode == "verify" { try MacPrivateStorage.verify(root) } else { try MacPrivateStorage.verifyTree(root) }
            } else { root = try MacPrivateStorage.prepare(args[1]) }
            storageReply(["ok": true, "private_storage": true, "path": root])
        } catch let error as PrivateStorageError {
            storageReply(["ok": false, "error": ["code": error.code, "message": error.message, "path": error.path]])
            exit(1)
        } catch {
            storageReply(["ok": false, "error": ["code": "storage_permissions_failed", "message": String(describing: error)]])
            exit(1)
        }
    }
    static func lease(_ raw: String) throws {
        let root = try MacPrivateStorage.prepare(raw)
        let directory = open(root, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard directory >= 0 else { try MacPrivateStorage.reject("service_ownership_unavailable", root, "Cannot hold the data directory.") }
        defer { close(directory) }
        var identity = stat()
        guard fstat(directory, &identity) == 0 else { try MacPrivateStorage.reject("service_ownership_unavailable", root, "Cannot identify data directory.") }
        let lockPath = (root as NSString).appendingPathComponent(".controller-lease")
        let fd = open(lockPath, O_RDWR | O_CREAT | O_NOFOLLOW, 0o600)
        guard fd >= 0 else { try MacPrivateStorage.reject("service_ownership_unavailable", lockPath, "Cannot open controller lease.") }
        defer { close(fd) }
        var lockIdentity = stat()
        guard fstat(fd, &lockIdentity) == 0, lockIdentity.st_uid == getuid(), lockIdentity.st_mode & 0o077 == 0 else {
            try MacPrivateStorage.reject("service_ownership_unavailable", lockPath, "Controller lease file is not private.")
        }
        guard flock(fd, LOCK_EX | LOCK_NB) == 0 else {
            try MacPrivateStorage.reject("service_already_running", root, "Another controller owns this directory.")
        }
        defer { flock(fd, LOCK_UN) }
        let current = try MacPrivateStorage.info(root), currentLock = try MacPrivateStorage.info(lockPath)
        guard current.st_dev == identity.st_dev, current.st_ino == identity.st_ino,
              currentLock.st_dev == lockIdentity.st_dev, currentLock.st_ino == lockIdentity.st_ino else {
            try MacPrivateStorage.reject("service_ownership_lost", root, "The held directory or lease was replaced.")
        }
        try MacPrivateStorage.verify(root)
        storageReply(["ok": true, "lease_acquired": true, "private_storage_verified": true, "pid": getpid()])
        let closed = DispatchSemaphore(value: 0)
        DispatchQueue.global().async {
            while let line = readLine() {
                do {
                    guard let request = try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any],
                          let encoded = request["data"] as? String, let bytes = Data(base64Encoded: encoded), bytes.count <= 256*1024 else {
                        throw PrivateStorageError(code:"bad_arguments",path:root,message:"Invalid lease operation.")
                    }
                    let taskOwner = request["op"] as? String == "publish_task_owner" && URL(fileURLWithPath: root).lastPathComponent == "desktop-task-lease"
                    guard taskOwner ? bytes.count <= 4096 : (request["op"] as? String == "publish_incidents" && URL(fileURLWithPath: root).lastPathComponent == "incident-writer-lease") else { throw PrivateStorageError(code:"bad_arguments",path:root,message:"Invalid publication scope.") }
                    let target = taskOwner ? "task-owner.json" : "incidents.json"
                    let parent = taskOwner ? root : URL(fileURLWithPath: root).deletingLastPathComponent().path
                    try MacPrivateStorage.verify(parent)
                    let pfd = open(parent, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
                    guard pfd >= 0 else { throw PrivateStorageError(code:"storage_unavailable",path:parent,message:"Cannot open incident directory.") }
                    defer { close(pfd) }
                    var existing = stat()
                    if fstatat(pfd,target,&existing,AT_SYMLINK_NOFOLLOW) == 0 {
                        guard (existing.st_mode & S_IFMT) == S_IFREG, existing.st_uid == getuid(), existing.st_nlink == 1, existing.st_mode & 0o077 == 0 else {
                            throw PrivateStorageError(code:"storage_not_private",path:parent,message:"Incident journal is not private.")
                        }
                    } else if errno != ENOENT { throw PrivateStorageError(code:"storage_unavailable",path:parent,message:"Cannot inspect incident journal.") }
                    let temp = taskOwner ? ".task-owner-publish.tmp" : ".incident-publish.tmp"
                    var stale = stat()
                    if fstatat(pfd,temp,&stale,AT_SYMLINK_NOFOLLOW) == 0 {
                        guard (stale.st_mode & S_IFMT) == S_IFREG, stale.st_uid == getuid(), stale.st_nlink == 1, stale.st_mode & 0o077 == 0, unlinkat(pfd,temp,0) == 0 else {
                            throw PrivateStorageError(code:"storage_not_private",path:parent,message:"Cannot safely recover the reserved incident temporary file.")
                        }
                    } else if errno != ENOENT { throw PrivateStorageError(code:"storage_unavailable",path:parent,message:"Cannot inspect incident temporary file.") }
                    let fd = openat(pfd,temp,O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW,0o600)
                    guard fd >= 0 else { throw PrivateStorageError(code:"storage_permissions_failed",path:parent,message:"Cannot create incident journal temporary file.") }
                    var written=0;let ok = bytes.withUnsafeBytes { raw -> Bool in
                        while written < bytes.count { let n=write(fd,raw.baseAddress!.advanced(by:written),bytes.count-written);if n <= 0 { return false };written += n };return fsync(fd) == 0
                    };close(fd)
                    guard ok, renameat(pfd,temp,pfd,target) == 0 else { unlinkat(pfd,temp,0);throw PrivateStorageError(code:"storage_permissions_failed",path:parent,message:"Cannot publish incident journal.") }
                    _ = fsync(pfd);storageReply(["ok":true,"published":true])
                } catch {
                    storageReply(["ok":false,"error":["code":"incident_publish_failed","message":"Incident journal publication failed."]]);break
                }
            }
            closed.signal()
        }
        while closed.wait(timeout: .now() + 0.1) == .timedOut {
            let current = try MacPrivateStorage.info(root)
            let currentLock = try MacPrivateStorage.info(lockPath)
            guard current.st_dev == identity.st_dev, current.st_ino == identity.st_ino,
                  currentLock.st_dev == lockIdentity.st_dev, currentLock.st_ino == lockIdentity.st_ino else {
                try MacPrivateStorage.reject("service_ownership_lost", root, "The held directory or lease was replaced. Control must stop.")
            }
        }
    }
}
