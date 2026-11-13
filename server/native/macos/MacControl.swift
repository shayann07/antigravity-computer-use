// Original macOS adapter for the shared Node control protocol. AX/input
// primitives remain in the attributed upstream AxonHost.swift foundation.
import AppKit
import ApplicationServices
import Carbon
import CoreGraphics
import CryptoKit
import Darwin
import Foundation

enum MacContract {
    static var value: [String: Any] = [:]
    static func load() throws {
        guard let path = ProcessInfo.processInfo.environment["AGCU_CONTRACT_FILE"] else {
            throw AxonError("native_contract_mismatch", "The shared control contract is missing.")
        }
        try MacPrivateStorage.ancestors(URL(fileURLWithPath: path).deletingLastPathComponent().path)
        let info = try MacPrivateStorage.info(path)
        guard info.st_mode & S_IFMT == S_IFREG, info.st_mode & 0o022 == 0,
              info.st_uid == getuid() || info.st_uid == 0 else {
            throw AxonError("native_contract_mismatch", "The shared control contract is not trusted.")
        }
        value = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: path))) as? [String: Any] ?? [:]
        guard value["version"] as? Int == 1,
              value["states"] as? [String] == ["idle", "active", "paused", "stopped"] else {
            throw AxonError("native_contract_mismatch", "The helper and shared control contract differ.")
        }
    }
    static func pattern(_ key: String, _ text: String) -> Bool {
        guard let pattern = value[key] as? String else { return true }
        return text.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
    }
}

func macProcessStart(_ pid: pid_t) throws -> String {
    var record = kinfo_proc()
    var length = MemoryLayout<kinfo_proc>.size
    var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, pid]
    guard sysctl(&mib, UInt32(mib.count), &record, &length, nil, 0) == 0, length > 0 else {
        throw AxonError("identity_changed", "The target process is unavailable.")
    }
    let start = record.kp_proc.p_un.__p_starttime
    return "\(start.tv_sec).\(start.tv_usec)"
}

func macProcessPath(_ pid: pid_t) throws -> String {
    guard let app = NSRunningApplication(processIdentifier: pid), let executable = app.executableURL else {
        throw AxonError("identity_changed", "Cannot identify the target executable.")
    }
    return executable.resolvingSymlinksInPath().path
}

func macIdentity(_ pid: pid_t) throws -> [String: Any] {
    let started = try macProcessStart(pid)
    let path = try macProcessPath(pid)
    return ["pid": Int(pid), "started": started, "path": path,
            "key": "\(pid):\(started):\(path)"]
}

func macFingerprint(_ op: String, _ args: [String: Any], _ label: String) throws -> String {
    func clean(_ value: Any) -> Any {
        if let object = value as? [String: Any] {
            return object.filter { !$0.key.hasPrefix("__") }.mapValues(clean)
        }
        if let array = value as? [Any] { return array.map(clean) }
        return value
    }
    let bytes = try JSONSerialization.data(withJSONObject: clean(args), options: [.sortedKeys, .withoutEscapingSlashes])
    var input = Data((op + "|" + label + "|").utf8); input.append(bytes)
    return Data(SHA256.hash(data: input)).base64EncodedString()
}

enum MacDeadline {
    // System-wide monotonic milliseconds, including time asleep.
    static var now: UInt64 { clock_gettime_nsec_np(CLOCK_MONOTONIC_RAW) / 1_000_000 }
    static func create(requested: Int64, wallNow: Int64, bootNow: UInt64, maximumMs: Int) -> UInt64 {
        guard wallNow >= 0, requested > wallNow, bootNow > 0, maximumMs > 0 else { return 0 }
        let remaining = (requested - wallNow) / 10_000
        guard remaining > 0 else { return 0 }
        let duration = UInt64(min(remaining, Int64(maximumMs)))
        let (deadline, overflow) = bootNow.addingReportingOverflow(duration)
        return overflow ? 0 : deadline
    }
    static func valid(_ deadline: UInt64, now: UInt64) -> Bool { now > 0 && deadline > now }
    static func walkBudgetExceeded(start: UInt64, now: UInt64, budgetMs: Int) -> Bool {
        guard start > 0, now >= start, budgetMs >= 0 else { return true }
        return now - start > UInt64(budgetMs)
    }
}

struct MacFenceState {
    let state: String
    let token: String
    let until: Int64
    let bootUntil: UInt64
    let cleanupPending: Bool
    let grants: Set<String>
    init(_ text: String) throws {
        let parts = text.components(separatedBy: "|")
        guard parts.count >= 3, ["idle", "active", "paused", "stopped"].contains(parts[0]), let ticks = Int64(parts[2]) else {
            throw AxonError("control_stopped", "Native control state is unavailable or invalid.")
        }
        state = parts[0]; token = parts[1]; until = ticks
        if state == "active" {
            guard parts.count >= 5, let monotonic = UInt64(parts[4]), monotonic > 0 else {
                throw AxonError("control_stopped", "Active native control has no valid monotonic deadline.")
            }
            bootUntil = monotonic
        } else { bootUntil = 0 }
        if parts.count > 5 {
            guard parts[5] == "0" || parts[5] == "1" else { throw AxonError("control_stopped", "Native cleanup state is invalid.") }
            cleanupPending = parts[5] == "1"
        } else { cleanupPending = false }
        guard state != "active" || !cleanupPending else { throw AxonError("control_stopped", "Active native control cannot have pending cleanup.") }
        if parts.count > 3, let bytes = Data(base64Encoded: parts[3]), let text = String(data: bytes, encoding: .utf8) {
            grants = Set(text.components(separatedBy: "\n").filter { !$0.isEmpty })
        } else { grants = [] }
    }
    static var now: Int64 { Int64(Date().timeIntervalSince1970 * 10_000_000) + 621355968000000000 }
}

enum MacFence {
    static func latchEntryBlocks(_ path: String) -> Bool {
        guard !path.isEmpty else { return true }
        var info = stat()
        if lstat(path, &info) == 0 { return true }
        return errno != ENOENT
    }
    static func latchBlocks(_ path: String) -> Bool {
        path.isEmpty || latchEntryBlocks(path) || latchEntryBlocks(path + ".unconfirmed")
    }
    static func resolvedState(_ proposed: String, latched: Bool) -> String {
        latched ? "stopped" : proposed
    }
    static var file: String { ProcessInfo.processInfo.environment["AGCU_GUARD_FILE"] ?? "" }
    static var latch: String { ProcessInfo.processInfo.environment["AGCU_STOP_LATCH"] ?? "" }
    static var current: [String: Any] = [:]
    static var operation = ""
    static var didDispatch = false
    static var rootIdentity: (dev_t, ino_t)?
    static var transitionIdentity: (dev_t, ino_t)?
    static var parentIdentity: String?
    static var keyboardPID: pid_t = 0
    static var keyboardWindow: AXUIElement?
    static func initialize(requireDirectParent: Bool = true) throws {
        try MacContract.load()
        guard !file.isEmpty else { throw AxonError("no_native_guard", "Native permission runtime required.") }
        let root = URL(fileURLWithPath: file).deletingLastPathComponent().path
        try MacPrivateStorage.verify(root)
        let identity = try MacPrivateStorage.info(root)
        rootIdentity = (identity.st_dev, identity.st_ino)
        let transitions = try MacPrivateStorage.prepare(file + ".transitions")
        let transitionInfo = try MacPrivateStorage.info(transitions)
        transitionIdentity = (transitionInfo.st_dev, transitionInfo.st_ino)
        let parent = pid_t(ProcessInfo.processInfo.environment["AGCU_PARENT_PID"] ?? "0") ?? 0
        guard parent > 0, !requireDirectParent || parent == getppid() else { throw AxonError("no_native_guard", "The native runtime parent is invalid.") }
        parentIdentity = try macProcessStart(parent)
    }
    static func read() throws -> MacFenceState {
        let root = URL(fileURLWithPath: file).deletingLastPathComponent().path
        let identity = try MacPrivateStorage.info(root)
        guard let pinned = rootIdentity, pinned.0 == identity.st_dev, pinned.1 == identity.st_ino else {
            throw AxonError("service_ownership_lost", "Private control storage was replaced.")
        }
        let stateInfo = try MacPrivateStorage.info(file)
        guard stateInfo.st_uid == getuid(), stateInfo.st_mode & S_IFMT == S_IFREG,
              stateInfo.st_mode & 0o022 == 0 else { throw AxonError("control_stopped", "Native control state is not trusted.") }
        return try MacFenceState(String(contentsOfFile: file, encoding: .utf8))
    }
    static func check() throws {
        if latchBlocks(latch) {
            throw AxonError("control_stopped", "Emergency Stop is latched; local human re-arm is required.")
        }
        let state = try read()
        guard state.state == "active", state.token == str(current["__session"]), state.until > MacFenceState.now,
              MacDeadline.valid(state.bootUntil, now: MacDeadline.now) else {
            throw AxonError("control_stopped", "Control is paused, stopped or expired. Observe again after authorized resume.")
        }
        MacWorkerLifetime.markActive()
        let parent = pid_t(ProcessInfo.processInfo.environment["AGCU_PARENT_PID"] ?? "0") ?? 0
        guard try macProcessStart(parent) == parentIdentity else { throw AxonError("control_stopped", "The controller parent changed.") }
        guard let watchdog = try? String(contentsOfFile: file + ".watchdog", encoding: .utf8).split(separator: "|"),
              watchdog.count == 2, let pid = pid_t(watchdog[0]), try macProcessStart(pid) == String(watchdog[1]) else {
            throw AxonError("control_stopped", "Independent Stop monitoring is unavailable.")
        }
        guard let guardian = try? String(contentsOfFile: file + ".guardian", encoding: .utf8).split(separator: "|"),
              guardian.count == 2, let pid = pid_t(guardian[0]), try macProcessStart(pid) == String(guardian[1]) else {
            throw AxonError("control_stopped", "Native permission authority is unavailable.")
        }
        if current["hwnd"] != nil {
            let (_, pid, _, _) = try resolveWindow(current)
            let identity = try macIdentity(pid)
            guard state.grants.contains(identity["key"] as! String), int(current["__pid"], -1) == Int(pid),
                  str(current["__started"]) == identity["started"] as? String else {
                throw AxonError("identity_changed", "The native app grant or process identity no longer matches.")
            }
            if keyboardPID != 0 && NSWorkspace.shared.frontmostApplication?.processIdentifier != keyboardPID {
                throw AxonError("focus_changed", "Keyboard focus left the approved application. No further input was sent.")
            }
            if keyboardPID != 0, let window=keyboardWindow {
                guard !IsSecureEventInputEnabled() else {throw AxonError("protected_app","Keyboard focus became secure. Human handoff is required; no further input was sent.")}
                let axApp = AXUIElementCreateApplication(keyboardPID)
                if let focused=axAttr(axApp,kAXFocusedUIElementAttribute as String),
                   CFGetTypeID(focused)==AXUIElementGetTypeID() {
                    let target=focused as! AXUIElement
                    let role=(axString(target,kAXRoleAttribute as String) ?? "")+(axString(target,kAXSubroleAttribute as String) ?? "")
                    guard !role.lowercased().contains("secure") else {throw AxonError("protected_app","Keyboard focus became secure. Human handoff is required; no further input was sent.")}
                    let inside = CFEqual(target, axApp) || macElementInWindow(target, window)
                    guard inside else {throw AxonError("focus_changed","Keyboard focus moved outside the approved window or dialog. No further input was sent.")}
                } else {
                    let isMainOrFocused = (axBool(window, kAXMainAttribute as String) == true)
                        || (axBool(window, kAXFocusedAttribute as String) == true)
                        || {
                            if let fw = axAttr(axApp, kAXFocusedWindowAttribute as String), CFGetTypeID(fw) == AXUIElementGetTypeID() {
                                return CFEqual(fw, window)
                            }
                            return false
                        }()
                    guard isMainOrFocused else {throw AxonError("focus_changed","No keyboard target is currently observable.")}
                }
            }
        }
    }
    static func begin(_ op: String, _ args: [String: Any]) throws {
        current = args; operation = op; didDispatch = false; keyboardPID = 0; keyboardWindow=nil
        if ["ping", "list_apps", "identity", "presence", "session"].contains(op) { return }
        if op == "authorize" {
            current = args["action_args"] as? [String: Any] ?? [:]
            operation = str(args["action_op"]) ?? ""
            try check(); return
        }
        try check()
        let writes: Set<String> = ["move", "click", "drag", "type", "key", "set_value", "scroll", "focus", "fit_window", "close_window", "clipboard", "paste", "file_dialog", "open", "launch"]
        if writes.contains(op), sensitive(op, args, label: try preview(args)) {
            let permit = str(args["__permit"]) ?? ""
            guard UUID(uuidString: permit) != nil || (permit.count == 32 && permit.allSatisfy { $0.isHexDigit }) else {
                throw AxonError("confirmation_required", "Native action approval is required.")
            }
            let path = (file + ".permits" as NSString).appendingPathComponent(permit)
            let info = try MacPrivateStorage.info(path)
            guard info.st_uid == getuid(), info.st_mode & S_IFMT == S_IFREG else { throw AxonError("confirmation_required", "Approval is not trusted.") }
            let lines = try String(contentsOfFile: path, encoding: .utf8).components(separatedBy: "\n")
            try FileManager.default.removeItem(atPath: path) // consume before dispatch
            let identity: String
            if args["hwnd"] != nil { identity = try macIdentity(resolveWindow(args).1)["key"] as! String } else { identity = "" }
            guard lines.count >= 4, lines[0] == str(args["__session"]),
                  lines[1] == (try macFingerprint(op, args, try preview(args))), lines[2] == identity,
                  (Int64(lines[3]) ?? 0) > MacFenceState.now else {
                throw AxonError("approval_changed", "Approved target or action changed. No input was sent.")
            }
        }
    }
    static func preview(_ args: [String: Any]) throws -> String {
        if args["index"] != nil {
            let (element, _) = try snapshotElement(args)
            if ((axString(element, kAXRoleAttribute as String) ?? "") + (axString(element, kAXSubroleAttribute as String) ?? "")).lowercased().contains("secure") {
                throw AxonError("protected_app", "Secure fields require a human.")
            }
            return [axString(element, kAXTitleAttribute as String), axString(element, kAXDescriptionAttribute as String), axString(element, kAXRoleAttribute as String)].compactMap { $0 }.joined(separator: " ")
        }
        // Pixels carry no reliable semantic label; ambiguous effects remain sensitive.
        return args["point"] != nil || args["from"] != nil ? "" : str(args["keys"]) ?? ""
    }
    static func sensitive(_ op: String, _ args: [String: Any], label: String) -> Bool {
        // Only risk matching drops Unicode format characters. Observed and
        // entered text retain semantic joiners, direction marks and modifiers.
        let riskLabel=label.replacingOccurrences(of:"\\p{Cf}",with:"",options:.regularExpression)
        if str(args["__risk"]) != "routine" { return true }
        if (MacContract.value["sensitive_operations"] as? [String] ?? []).contains(op) { return true }
        if op == "key" && MacContract.pattern("sensitive_key_pattern", str(args["keys"]) ?? "") { return true }
        if op != "focus", let pid = args["__pid"] as? Int,
           let path = try? macProcessPath(pid_t(pid)), MacContract.pattern("sensitive_process_pattern",URL(fileURLWithPath:path).lastPathComponent) { return true }
        if (MacContract.value["ambiguous_target_operations"] as? [String] ?? ["click","drag"]).contains(op) && riskLabel.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty { return true }
        return MacContract.pattern("sensitive_label_pattern", riskLabel)
    }
    static func dispatched() throws { try check(); didDispatch = true }
    static func approvalStateMatches(_ expected: MacFenceState, _ current: MacFenceState,
                                     latched: Bool, wallNow: Int64, bootNow: UInt64) -> Bool {
        guard !latched, ["idle", "active"].contains(expected.state),
              current.state == expected.state, current.token == expected.token,
              current.until == expected.until, current.bootUntil == expected.bootUntil,
              current.grants == expected.grants, !current.cleanupPending, !expected.cleanupPending else { return false }
        return current.state == "idle" || (current.until > wallNow && MacDeadline.valid(current.bootUntil, now: bootNow))
    }
    // Keep this lock separate from the held-input lock: takeover must revoke
    // an in-progress drag before waiting for that worker to release input.
    static func withTransitionLock<T>(_ body: () throws -> T) throws -> T {
        let path = file + ".transitions", fd = open(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard fd >= 0 else { throw AxonError("control_stopped", "Cannot open the native transition lock.") }
        defer { close(fd) }
        var held = stat()
        guard let pinned = transitionIdentity, fstat(fd, &held) == 0,
              held.st_uid == getuid(), held.st_mode & S_IFMT == S_IFDIR,
              held.st_mode & 0o077 == 0, held.st_dev == pinned.0, held.st_ino == pinned.1 else {
            throw AxonError("control_stopped", "The native transition lock changed.")
        }
        let start = MacDeadline.now
        guard start > 0 else { throw AxonError("control_stopped", "The transition-lock clock is unavailable.") }
        while flock(fd, LOCK_EX | LOCK_NB) != 0 {
            let problem = errno, now = MacDeadline.now
            guard problem == EWOULDBLOCK || problem == EAGAIN || problem == EINTR,
                  now >= start, now - start < 100 else {
                throw AxonError("control_stopped", "The native transition lock did not become available.")
            }
            Thread.sleep(forTimeInterval: 0.001)
        }
        defer { flock(fd, LOCK_UN) }
        let current = try MacPrivateStorage.info(path)
        guard current.st_dev == held.st_dev, current.st_ino == held.st_ino else {
            throw AxonError("control_stopped", "The native transition directory was replaced.")
        }
        return try body()
    }
    // Serialize approval publication with deliberate takeover.
    // This accepts only a native state captured before the local dialog; there
    // is no new approval/resume field in the desktop action protocol.
    static func withApprovalFence<T>(_ expected: MacFenceState, _ body: () throws -> T) throws -> T {
        try withTransitionLock {
            guard approvalStateMatches(expected, try read(), latched: latchBlocks(latch),
                                       wallNow: MacFenceState.now, bootNow: MacDeadline.now) else {
                throw AxonError("approval_changed", "Control changed during confirmation. No approval was published; observe after authorized resume.")
            }
            let result = try body()
            guard !latchBlocks(latch) else { throw AxonError("control_stopped", "Stop interrupted confirmation. No action is authorized.") }
            return result
        }
    }
    static func pauseForTakeover(_ observed: MacFenceState) throws -> Bool {
        try withTransitionLock {
            let current = try read()
            guard current.state == "active", current.token == observed.token,
                  current.until == observed.until, current.bootUntil == observed.bootUntil,
                  !latchBlocks(latch) else { return false }
            let encoded = Data(current.grants.sorted().joined(separator: "\n").utf8).base64EncodedString()
            try write("paused|\(current.token)|\(current.until)|\(encoded)|0|1")
            return true
        }
    }
    static func write(_ text: String) throws {
        try Data(text.utf8).write(to: URL(fileURLWithPath: file), options: [.atomic])
        guard chmod(file, 0o600) == 0 else { throw AxonError("control_stopped", "Cannot protect native control state.") }
    }
    @discardableResult static func latchStop(_ path: String) -> Bool {
        guard !path.isEmpty else { return false }
        let fd = open(path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
        guard fd >= 0 else { return errno == EEXIST } // Preserve every existing entry, including uncertainty.
        defer { close(fd) }
        let bytes = Array("stopped".utf8)
        let written = bytes.withUnsafeBytes { Darwin.write(fd, $0.baseAddress, bytes.count) }
        return written == bytes.count && fsync(fd) == 0
    }
    @discardableResult static func emergency(_ reason: String) -> Bool {
        latchStop(latch)
        try? write("stopped||0||0|1")
        let workersStopped = macWaitForWorkers(), inputsRecovered = MacInputLedger.recover()
        if !workersStopped || !inputsRecovered { emit(["ev": "visual_warning", "message": "Input cleanup is incomplete; control stays stopped."]) }
        return workersStopped && inputsRecovered
    }
}

// A worker cancels itself when its own guard is revoked. This avoids sending a
// signal to a numeric PID that may have been recycled by the operating system.
enum MacWorkerLifetime {
    static let gate = NSLock()
    static var enabled = false, wasActive = false
    static func markActive() { gate.lock(); if enabled { wasActive = true }; gate.unlock() }
    static func start() {
        gate.lock(); enabled = true; gate.unlock()
        Thread.detachNewThread {
            while true {
                gate.lock(); let active = wasActive; gate.unlock()
                if MacFence.latchBlocks(MacFence.latch) { _exit(0) }
                if let state = try? MacFence.read() {
                    if state.state == "stopped" || state.state == "paused" || (state.state == "idle" && active) { _exit(0) }
                    if state.state == "active" {
                        markActive()
                        if state.until <= MacFenceState.now || !MacDeadline.valid(state.bootUntil, now: MacDeadline.now) { _exit(0) }
                    }
                } else if active { _exit(0) }
                Thread.sleep(forTimeInterval: 0.05)
            }
        }
    }
}

enum MacInputLedger {
    static var path: String { MacFence.file + ".inputs" }
    // Lock the pinned private directory itself, so unlinking a separate lock
    // file cannot create two independent locks. A dead process releases flock.
    static func withLock<T>(_ body: () throws -> T) throws -> T {
        guard !MacFence.file.isEmpty else { throw AxonError("input_cleanup_failed", "Input lock has no control state.") }
        let root = URL(fileURLWithPath: MacFence.file).deletingLastPathComponent().path
        let fd = open(root, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard fd >= 0 else { throw AxonError("input_cleanup_failed", "Cannot open the input lock.") }
        defer { close(fd) }
        var held = stat()
        guard let pinned = MacFence.rootIdentity, fstat(fd, &held) == 0,
              held.st_uid == getuid(), held.st_mode & S_IFMT == S_IFDIR,
              held.st_mode & 0o077 == 0, held.st_dev == pinned.0, held.st_ino == pinned.1 else {
            throw AxonError("input_cleanup_failed", "The input lock is not private.")
        }
        let started = MacDeadline.now
        guard started > 0 else { throw AxonError("input_cleanup_failed", "The input-lock clock is unavailable.") }
        while flock(fd, LOCK_EX | LOCK_NB) != 0 {
            let lockError = errno, now = MacDeadline.now
            guard lockError == EWOULDBLOCK || lockError == EAGAIN || lockError == EINTR,
                  now > 0, now >= started, now - started < 1000 else {
                throw AxonError("input_cleanup_failed", "Input dispatch did not release its lock; cleanup is unconfirmed.")
            }
            Thread.sleep(forTimeInterval: 0.005)
        }
        defer { flock(fd, LOCK_UN) }
        let current = try MacPrivateStorage.info(root)
        guard current.st_dev == held.st_dev, current.st_ino == held.st_ino, current.st_mode & S_IFMT == S_IFDIR else {
            throw AxonError("input_cleanup_failed", "The input lock directory was replaced.")
        }
        return try body()
    }
    static func read() throws -> [String: Any] {
        guard !MacFence.file.isEmpty, FileManager.default.fileExists(atPath: path) else { throw AxonError("input_cleanup_failed", "The input ledger is missing; cleanup cannot be confirmed.") }
        let info = try MacPrivateStorage.info(path)
        guard info.st_uid == getuid(), info.st_mode & S_IFMT == S_IFREG else { throw AxonError("input_cleanup_failed", "The input ledger is not trusted.") }
        guard let value = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: path))) as? [String: Any],
              let keys = value["keys"] as? [Int], let buttons = value["buttons"] as? [Int],
              keys.allSatisfy({ $0 >= 0 && $0 < 256 }), buttons.allSatisfy({ $0 >= 0 && $0 <= 2 }) else {
            throw AxonError("input_cleanup_failed", "The input ledger is invalid; re-arm is refused.")
        }
        return value
    }
    static func save(_ value: [String: Any]) throws {
        try JSONSerialization.data(withJSONObject: value).write(to: URL(fileURLWithPath: path), options: [.atomic])
        guard chmod(path, 0o600) == 0 else { throw AxonError("input_cleanup_failed", "Cannot protect the input journal.") }
        // A held input is recorded before it is posted. Do not proceed if the
        // journal bytes cannot be flushed to the file the process just wrote.
        let fd = open(path, O_RDWR | O_NOFOLLOW)
        guard fd >= 0 else { throw AxonError("input_cleanup_failed", "Cannot open the input journal for flushing.") }
        defer { close(fd) }
        var written = stat()
        guard fstat(fd, &written) == 0, written.st_uid == getuid(), written.st_mode & S_IFMT == S_IFREG,
              written.st_mode & 0o077 == 0, written.st_nlink == 1, fsync(fd) == 0 else {
            throw AxonError("input_cleanup_failed", "Cannot confirm input journal file flush.")
        }
    }
    static func record(_ event: CGEvent, before: Bool) throws {
        var value = try read()
        let keyDown = event.type == .keyDown, keyUp = event.type == .keyUp
        let mouseDown = [.leftMouseDown, .rightMouseDown, .otherMouseDown].contains(event.type)
        let mouseUp = [.leftMouseUp, .rightMouseUp, .otherMouseUp].contains(event.type)
        if keyDown && before || keyUp && !before {
            let key = Int(event.getIntegerValueField(.keyboardEventKeycode)); var keys = value["keys"] as! [Int]
            if keyDown { if !keys.contains(key) { keys.append(key) } } else { keys.removeAll { $0 == key } }
            value["keys"] = keys
        } else if mouseDown && before || mouseUp && !before {
            let button = Int(event.getIntegerValueField(.mouseEventButtonNumber)); var buttons = value["buttons"] as! [Int]
            if mouseDown { if !buttons.contains(button) { buttons.append(button) } } else { buttons.removeAll { $0 == button } }
            value["buttons"] = buttons
        } else { return }
        try save(value)
    }
    static func recover(location: () -> CGPoint? = { CGEvent(source: nil)?.location }) -> Bool {
        do {
            return try withLock { try recoverLocked(location: location) }
        } catch { return false }
    }
    private static func recoverLocked(location: () -> CGPoint?) throws -> Bool {
            let value = try read()
            if (value["keys"] as! [Int]).isEmpty && (value["buttons"] as! [Int]).isEmpty { return true }
            let buttons = value["buttons"] as! [Int]
            // Resolve before posting any release, including key-up events.
            // A missing location retains the entire journal unchanged.
            let position = buttons.isEmpty ? nil : location()
            if !buttons.isEmpty && position == nil { return false }
            guard CGPreflightPostEventAccess() else { return false }
            let source = CGEventSource(stateID: .hidSystemState)
            for key in value["keys"] as! [Int] {
                guard let event = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(key), keyDown: false) else { return false }
                markedEvent(event)?.post(tap: .cghidEventTap)
            }
            if !buttons.isEmpty {
                // Never invent a screen position for a release: an up event at
                // (0, 0) could affect the wrong window on a different display.
                guard let position = position else { return false }
                for button in buttons {
                    guard let event = CGEvent(mouseEventSource: source, mouseType: button == 0 ? .leftMouseUp : button == 1 ? .rightMouseUp : .otherMouseUp,
                                              mouseCursorPosition: position, mouseButton: CGMouseButton(rawValue: UInt32(button))!) else { return false }
                    markedEvent(event)?.post(tap: .cghidEventTap)
                }
            }
            try save(["keys": [Int](), "buttons": [Int]()]); return true
    }
}

// Birth-time-bound registry. Workers exit cooperatively after guard revocation;
// the guardian never signals a potentially recycled numeric PID.
func macRegisterWorker() throws {
    let file = MacFence.file + ".worker-\(getpid())"
    try Data((try macProcessStart(getpid())).utf8).write(to: URL(fileURLWithPath: file), options: [.atomic])
    chmod(file, 0o600)
}
@discardableResult func macWaitForWorkers() -> Bool {
    let root = URL(fileURLWithPath: MacFence.file).deletingLastPathComponent()
    let prefix = URL(fileURLWithPath: MacFence.file).lastPathComponent + ".worker-"
    guard let names = try? FileManager.default.contentsOfDirectory(atPath: root.path) else { return false }
    var confirmed = true, pending: [(pid_t, String)] = []
    for name in names where name.hasPrefix(prefix) {
        let file = root.appendingPathComponent(name)
        guard let pid = pid_t(name.dropFirst(prefix.count)), pid > 0, pid != getpid(),
              let info = try? MacPrivateStorage.info(file.path), info.st_uid == getuid(),
              info.st_mode & S_IFMT == S_IFREG, info.st_mode & 0o077 == 0, info.st_nlink == 1, info.st_size <= 128,
              let expected = try? String(contentsOf: file, encoding: .utf8), !expected.isEmpty else { confirmed = false; continue }
        if let actual = try? macProcessStart(pid) {
            if actual != expected { continue } // PID was reused; never kill the new process.
            pending.append((pid, expected))
        } else if kill(pid, 0) == 0 || errno != ESRCH { confirmed = false }
    }
    guard !pending.isEmpty else { return confirmed }
    let start = MacDeadline.now
    guard start > 0 else { return false }
    while !pending.isEmpty {
        pending.removeAll { item in
            let (pid, expected) = item
            if let actual = try? macProcessStart(pid) { return actual != expected }
            return kill(pid, 0) != 0 && errno == ESRCH
        }
        if pending.isEmpty { break }
        let now = MacDeadline.now
        if now == 0 || now < start || now - start >= 1000 { break }
        Thread.sleep(forTimeInterval: 0.005)
    }
    return confirmed && pending.isEmpty
}
