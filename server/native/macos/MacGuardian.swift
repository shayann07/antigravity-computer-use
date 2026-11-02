// Native consent/Stop authority. No approval Boolean exists in the action API.
import AppKit
import ApplicationServices
import CoreGraphics
import Darwin
import Foundation

func macStopNonceValid(_ nonce: String) -> Bool {
    nonce.utf8.count == 32 && nonce.range(of:"^[a-f0-9]{32}$", options:.regularExpression) != nil
}

enum MacWorkers {
    static var unreaped: Process?
    static func readReadyLine(_ handle: FileHandle) -> String? {
        var bytes = Data()
        while bytes.count <= 8192 {
            let part = handle.availableData
            if part.isEmpty { return nil }
            bytes.append(part)
            if let end = bytes.firstIndex(of: 10) {
                guard end <= 8192 else { return nil }
                return String(data: bytes[..<end], encoding: .utf8)
            }
        }
        return nil
    }
    static func readyAcknowledged(_ line: String?) -> Bool {
        guard let data = line?.data(using:.utf8),
              let value = (try? JSONSerialization.jsonObject(with:data)) as? [String: Any],
              let ready = value["watchdog_ready"] as? NSNumber,
              CFGetTypeID(ready) == CFBooleanGetTypeID() else { return false }
        return ready.boolValue
    }
    static func terminateBeforeRetry(_ child: Process, expectedBirth: String?, timeout: TimeInterval = 2) -> Bool {
        if child.isRunning {
            let pid = child.processIdentifier
            guard let birth = expectedBirth, (try? macProcessStart(pid)) == birth else { return false }
            child.terminate()
        }
        guard timeout.isFinite else { return false }
        let start = MacDeadline.now, budget = UInt64(max(0, min(timeout, 5)) * 1000)
        guard start > 0 else { return false }
        while child.isRunning {
            let now = MacDeadline.now
            if now == 0 || now < start || now - start >= budget { break }
            Thread.sleep(forTimeInterval: 0.005)
        }
        guard !child.isRunning else { return false }
        child.waitUntilExit(); return true
    }
    static func start(_ args: [String]) throws -> Process {
        if let prior = unreaped {
            guard !prior.isRunning else {
                MacFence.emergency("watchdog_start_cleanup_unconfirmed")
                throw AxonError("stop_monitor_cleanup_unconfirmed", "A prior Stop monitor may still be running. Control stays stopped; inspect locally before retrying.")
            }
            prior.waitUntilExit(); unreaped = nil
        }
        let child = Process(); child.executableURL = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath()
        child.arguments = args; child.environment = ProcessInfo.processInfo.environment
        let output = Pipe(); child.standardOutput = output; child.standardError = FileHandle.standardError
        try child.run()
        let birth = try? macProcessStart(child.processIdentifier)
        if birth == nil {
            if !terminateBeforeRetry(child, expectedBirth: nil) { unreaped = child; MacFence.emergency("watchdog_start_cleanup_unconfirmed") }
            throw AxonError("stop_monitor_cleanup_unconfirmed", "Cannot establish the Stop monitor identity. Control stays stopped; inspect locally before retrying.")
        }
        let ready = DispatchSemaphore(value:0); var line: String?
        DispatchQueue.global().async { line = readReadyLine(output.fileHandleForReading); ready.signal() }
        let signaled = ready.wait(timeout:.now()+5) == .success
        guard signaled, readyAcknowledged(line), child.isRunning else {
            guard terminateBeforeRetry(child, expectedBirth: birth) else {
                unreaped = child
                MacFence.emergency("watchdog_start_cleanup_unconfirmed")
                throw AxonError("stop_monitor_cleanup_unconfirmed", "A prior Stop monitor may still be running. Control stays stopped; inspect locally before retrying.")
            }
            throw AxonError("stop_monitor_unavailable", "Independent Stop monitoring did not start. Check Input Monitoring permission.")
        }
        return child
    }
}

final class MacPanicMonitor {
    var tap: CFMachPort?
    var baseline: CGPoint?
    var moved: Double = 0
    var at = Date()
    var expiredKey: String?
    var expiredSince: UInt64 = 0
    var invalidSince: UInt64?
    static func deadlineGraceElapsed(since: UInt64, now: UInt64) -> Bool {
        now >= since && now - since >= 5000
    }
    static func deadlineProblem(_ state: MacFenceState, now: UInt64) -> String? {
        if state.cleanupPending { return "cleanup" }
        if state.state == "active" && !MacDeadline.valid(state.bootUntil, now: now) { return "expired" }
        return nil
    }
    func checkDeadline() {
        if MacDeadline.now == 0 { MacFence.emergency("watchdog_clock_unavailable"); return }
        guard let state = try? MacFence.read() else {
            let now = MacDeadline.now
            if invalidSince == nil { invalidSince = now; return }
            if let since = invalidSince, now >= since, now - since >= 1000, (try? MacFence.read()) == nil {
                MacFence.emergency("watchdog_state_unavailable"); invalidSince = nil
            }
            return
        }
        invalidSince = nil
        if ["active", "paused"].contains(state.state), MacFence.latchBlocks(MacFence.latch) {
            MacFence.emergency(MacFence.latchEntryBlocks(MacFence.latch + ".unconfirmed") ? "guardian_stop_unconfirmed" : "persisted_emergency_stop"); return
        }
        guard let problem = Self.deadlineProblem(state, now: MacDeadline.now) else {
            expiredKey = nil; expiredSince = 0; return
        }
        let key = problem + "|" + state.state + "|" + state.token + "|" + String(state.until) + "|" + String(state.bootUntil), now = MacDeadline.now
        if expiredKey != key { expiredKey = key; expiredSince = now; return }
        guard Self.deadlineGraceElapsed(since: expiredSince, now: now),
              let latest = try? MacFence.read(), latest.state == state.state,
              latest.token == state.token, latest.until == state.until, latest.bootUntil == state.bootUntil,
              Self.deadlineProblem(latest, now: MacDeadline.now) == problem else { return }
        MacFence.emergency(problem == "cleanup" ? "watchdog_cleanup_stalled" : "watchdog_deadline_expired")
        expiredKey = nil; expiredSince = 0
    }
    func start() -> Bool {
        let mask = (1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.mouseMoved.rawValue) |
            (1 << CGEventType.leftMouseDown.rawValue) | (1 << CGEventType.rightMouseDown.rawValue) | (1 << CGEventType.scrollWheel.rawValue)
        tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
                               eventsOfInterest: CGEventMask(mask), callback: { _, type, event, pointer in
            let monitor = Unmanaged<MacPanicMonitor>.fromOpaque(pointer!).takeUnretainedValue()
            if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
                if let tap = monitor.tap { CGEvent.tapEnable(tap: tap, enable: true) }
                MacFence.emergency("event_tap_disabled")
            } else { monitor.receive(type, event) }
            return Unmanaged.passUnretained(event)
        }, userInfo: Unmanaged.passUnretained(self).toOpaque())
        guard let tap = tap, let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0) else { return false }
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes); CGEvent.tapEnable(tap: tap, enable: true)
        return true
    }
    func receive(_ type: CGEventType, _ event: CGEvent) {
        if event.getIntegerValueField(.eventSourceUserData) == AXON_EVENT_MARKER { return }
        guard let state = try? MacFence.read(), ["active", "paused"].contains(state.state) else { return }
        let key = event.getIntegerValueField(.keyboardEventKeycode)
        if type == .keyDown && (key == 53 || (key == 111 && event.flags.contains([.maskControl, .maskAlternate]))) {
            MacFence.emergency("escape"); return
        }
        guard state.state == "active" else { return }
        let preferences = (URL(fileURLWithPath: MacFence.file).deletingLastPathComponent()).appendingPathComponent("control-preferences.json")
        let mode = (try? Data(contentsOf: preferences)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }?["takeover_mode"] as? String ?? "manual"
        guard mode == "smart" else { return }
        // Local controls must remain usable without the takeover hook racing them.
        if let bytes = try? Data(contentsOf: URL(fileURLWithPath: MacFence.file + ".hud")),
           let r = try? JSONSerialization.jsonObject(with: bytes) as? [Double], r.count == 4,
           CGRect(x: r[0], y: r[1], width: r[2], height: r[3]).contains(event.location) { return }
        var deliberate = type != .mouseMoved
        if type == .mouseMoved {
            if Date().timeIntervalSince(at) > 0.5 { moved = 0; at = Date(); baseline = event.location }
            if let previous = baseline { moved += hypot(event.location.x - previous.x, event.location.y - previous.y) }
            baseline = event.location; deliberate = moved >= 70
        }
        if deliberate {
            try? MacFence.write("paused|\(state.token)|\(state.until)|\(Data(state.grants.sorted().joined(separator: "\n").utf8).base64EncodedString())")
            let workersStopped = macWaitForWorkers(), inputsRecovered = MacInputLedger.recover()
            if !workersStopped || !inputsRecovered { MacFence.emergency("input_cleanup_failed") }
        }
    }
    func run(guardian: pid_t, birth: String) -> Never {
        guard start() else { emit(["ev": "error", "message": "Input Monitoring permission is required for independent Stop."]); exit(1) }
        do {
            let marker = MacFence.file + ".watchdog"
            try Data("\(getpid())|\(try macProcessStart(getpid()))".utf8).write(to: URL(fileURLWithPath: marker), options: [.atomic])
            guard chmod(marker, 0o600) == 0 else { throw AxonError("stop_monitor_unavailable", "Cannot protect watchdog identity.") }
            let fd = open(marker, O_RDWR | O_NOFOLLOW); guard fd >= 0 else { throw AxonError("stop_monitor_unavailable", "Cannot open watchdog identity.") }
            defer { close(fd) }
            var info = stat()
            guard fstat(fd, &info) == 0, info.st_uid == getuid(), info.st_mode & S_IFMT == S_IFREG,
                  info.st_mode & 0o077 == 0, info.st_nlink == 1, fsync(fd) == 0 else {
                throw AxonError("stop_monitor_unavailable", "Cannot confirm watchdog identity.")
            }
        } catch { emit(["ev":"error", "message":"Independent Stop monitoring could not record its identity."]); exit(1) }
        emit(["watchdog_ready": true])
        Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { _ in
            let parent = pid_t(ProcessInfo.processInfo.environment["AGCU_PARENT_PID"] ?? "0") ?? 0
            if (try? macProcessStart(guardian)) != birth || (try? macProcessStart(parent)) != MacFence.parentIdentity {
                if (try? MacFence.read().state) != "idle" { MacFence.emergency("guardian_exited") }
                else { let workersStopped = macWaitForWorkers(), inputsRecovered = MacInputLedger.recover(); if !workersStopped || !inputsRecovered { MacFence.emergency("input_cleanup_failed") } }
                exit(0)
            }
            self.checkDeadline()
        }
        RunLoop.current.run(); exit(0)
    }
}

final class MacGuardian: NSObject {
    var state = "idle", token = "", until: Int64 = 0
    var bootUntil: UInt64 = 0
    var cleanupPending = false
    var grants = Set<String>()
    var watchdog: Process?
    var timer: Timer?
    var visuals = MacVisuals()
    var prompt: NSAlert?
    var controlsUntil = Date.distantFuture
    let hostManaged = ProcessInfo.processInfo.environment["AGCU_PERMISSION_MODE"] == "host-managed"
    func run() throws -> Never {
        _ = NSApplication.shared; NSApp.setActivationPolicy(.accessory)
        try Data("\(getpid())|\(try macProcessStart(getpid()))".utf8).write(to: URL(fileURLWithPath: MacFence.file + ".guardian"), options: [.atomic])
        chmod(MacFence.file + ".guardian", 0o600)
        visuals.onToggle = { [weak self] in self?.humanToggle() }
        visuals.onStop = { [weak self] in self?.stop("button") }
        visuals.onMode = { [weak self] mode in self?.saveMode(mode) }
        state = MacFence.latchBlocks(MacFence.latch) ? "stopped" : "idle"
        try writeState(); visuals.hide()
        emit(["ev": "settings", "takeover_mode": takeoverMode()])
        emit(["ev": "ready", "pid": Int(getpid()), "hotkey": false, "presence": false, "platform": "darwin"])
        timer = Timer(timeInterval: 0.07, repeats: true) { [weak self] _ in self?.tick() }
        RunLoop.main.add(timer!, forMode: .common); RunLoop.main.add(timer!, forMode: .modalPanel)
        Thread.detachNewThread { [weak self] in
            while let line = readLine() {
                guard line.utf8.count <= 1_048_576, let bytes = line.data(using: .utf8),
                      let message = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any] else { continue }
                DispatchQueue.main.async { self?.receive(message) }
            }
            DispatchQueue.main.async {
                if self?.state != "idle" { self?.stop("controller_exited") }
                self?.visuals.hide(); exit(0)
            }
        }
        NSApp.run(); exit(0)
    }
    func takeoverMode() -> String {
        let path = URL(fileURLWithPath: MacFence.file).deletingLastPathComponent().appendingPathComponent("control-preferences.json")
        let value = (try? Data(contentsOf: path)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        return value?["takeover_mode"] as? String == "smart" ? "smart" : "manual"
    }
    func saveMode(_ mode: String) {
        let path = URL(fileURLWithPath: MacFence.file).deletingLastPathComponent().appendingPathComponent("control-preferences.json")
        var value = (try? Data(contentsOf: path)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
        value["takeover_mode"] = mode
        if let bytes = try? JSONSerialization.data(withJSONObject: value) { try? bytes.write(to: path, options: [.atomic]); chmod(path.path, 0o600) }
        emit(["ev": "settings", "takeover_mode": takeoverMode()])
    }
    func ensureWatchdog() throws {
        guard AXIsProcessTrusted(), CGPreflightScreenCaptureAccess(), CGPreflightListenEventAccess(), CGPreflightPostEventAccess() else {
            throw AxonError("mac_permissions_required", "Open the installed Mac setup application and grant Accessibility, Screen Recording and Input Monitoring yourself. Control has not started.")
        }
        if watchdog?.isRunning == true { return }
        watchdog = try MacWorkers.start(["--mac-watchdog", String(getpid()), try macProcessStart(getpid())])
    }
    func writeState() throws {
        let encoded = Data(grants.sorted().joined(separator: "\n").utf8).base64EncodedString()
        try MacFence.write("\(state)|\(token)|\(until)|\(encoded)|\(bootUntil)|\(cleanupPending ? 1 : 0)")
    }
    func set(_ next: String, reason: String = "") {
        if next == "active" && (MacFence.latchBlocks(MacFence.latch) || state == "stopped") { return }
        var effectiveReason = reason
        state = next
        cleanupPending = next != "active"
        if next == "stopped" || next == "idle" { grants.removeAll() }
        do { try writeState() } catch { state = "stopped"; MacFence.emergency("state_write_failed") }
        // The independent watchdog may latch Stop while this transition is
        // being published. Recheck after the write so a stale idle/paused
        // transition cannot leave the local UI claiming control is available.
        let resolved = MacFence.resolvedState(state, latched: MacFence.latchBlocks(MacFence.latch))
        if resolved != state {
            state = resolved; cleanupPending = true; grants.removeAll(); effectiveReason = "emergency_stop"
            do { try writeState() } catch { MacFence.emergency("state_write_failed") }
        }
        if state != "active" {
            let workersStopped = macWaitForWorkers(), inputsRecovered = MacInputLedger.recover()
            if !workersStopped || !inputsRecovered { state = "stopped"; grants.removeAll(); effectiveReason = "input_cleanup_failed"; MacFence.emergency(effectiveReason) }
            else {
                cleanupPending = false
                do { try writeState() } catch { state = "stopped"; effectiveReason = "state_write_failed"; MacFence.emergency(effectiveReason) }
                let final = MacFence.resolvedState(state, latched: MacFence.latchBlocks(MacFence.latch))
                if final != state { state = final; grants.removeAll(); effectiveReason = "emergency_stop"; do { try writeState() } catch { MacFence.emergency("state_write_failed") } }
            }
            visuals.releaseCursor()
        }
        if state == "idle" { visuals.hide() }
        else { visuals.show(state); controlsUntil = state == "stopped" ? Date().addingTimeInterval(8) : .distantFuture }
        emit(["ev": "state", "state": state, "reason": effectiveReason, "custom_cursor": visuals.cursorApplied])
    }
    func stop(_ reason: String) { MacFence.emergency(reason); set("stopped", reason: reason) }
    func humanToggle() {
        if state == "active" { set("paused", reason: "requested_pause"); return }
        do { try ensureWatchdog() } catch { emit(["ev":"visual_warning", "message":String(describing:error)]); return }
        guard MacInputLedger.recover() else { return }
        until = MacFenceState.now + Int64(MacContract.value["session_ms"] as? Int ?? 600_000) * 10_000
        bootUntil = MacDeadline.create(requested: until, wallNow: MacFenceState.now, bootNow: MacDeadline.now, maximumMs: MacContract.value["session_ms"] as? Int ?? 600_000)
        guard bootUntil > 0 else { return }
        if state == "stopped" {
            guard !MacFence.latch.isEmpty else { return }
            if MacFence.latchEntryBlocks(MacFence.latch + ".unconfirmed") {
                emit(["ev":"visual_warning", "message":"Stop delivery is unconfirmed; inspect prior input cleanup before re-arm"])
                return
            }
            if let text = try? String(contentsOfFile: MacFence.latch, encoding: .utf8), text.hasPrefix("unconfirmed:") {
                emit(["ev":"visual_warning", "message":"Stop delivery is unconfirmed; inspect prior input cleanup before re-arm"])
                return
            }
            if unlink(MacFence.latch) != 0 && errno != ENOENT { return }
        }
        set(state == "paused" ? "active" : "idle", reason: "human_resume")
        emit(["ev": "human_resume", "state": state])
    }
    func tick() {
        if Date() > controlsUntil { visuals.hide(); controlsUntil = .distantFuture }
        if (["active", "paused"].contains(state) || prompt != nil), MacFence.latchBlocks(MacFence.latch) {
            if prompt != nil { NSApp.abortModal() }; stop(MacFence.latchEntryBlocks(MacFence.latch + ".unconfirmed") ? "guardian_stop_unconfirmed" : "persisted_emergency_stop"); return
        }
        guard let stored = try? MacFence.read() else { if state == "active" { stop("state_unavailable") }; return }
        if stored.state == "stopped" && state != "stopped" { if prompt != nil { NSApp.abortModal() }; set("stopped", reason: "escape") }
        if stored.state == "paused" && state == "active" { set("paused", reason: "human_takeover") }
        if state == "active" {
            if watchdog?.isRunning != true { stop("watchdog_exited"); return }
            if MacFenceState.now >= until || !MacDeadline.valid(bootUntil, now: MacDeadline.now) { set("idle", reason: "expired"); return }
            visuals.animate()
        }
        let parent = pid_t(ProcessInfo.processInfo.environment["AGCU_PARENT_PID"] ?? "0") ?? 0
        if (try? macProcessStart(parent)) != MacFence.parentIdentity {
            if state != "idle" { stop("parent_exited") }; visuals.hide(); exit(0)
        }
    }
    func receive(_ message: [String: Any]) {
        let op = str(message["op"]) ?? "", id = message["id"] ?? NSNull()
        func reply(_ extra: [String: Any] = [:]) { emit(extra.merging(["id": id, "state": state]) { _, new in new }) }
        do {
            switch op {
            case "visual_status": reply(["controls_visible": visuals.visible, "cursor": state == "active", "takeover_mode": takeoverMode()])
            case "show_controls": visuals.show(state); controlsUntil = Date().addingTimeInterval(state == "idle" || state == "stopped" ? 30 : 600); reply(["controls_visible": true, "human_rearm_required": state == "stopped"])
            case "dismiss_controls": if ["active", "paused"].contains(state) { stop("dismiss") }; visuals.hide(); reply(["controls_visible": false])
            case "attach": reply(["registered": true]) // worker self-registers before reporting ready
            case "activate":
                guard state != "stopped", state != "paused", MacInputLedger.recover() else { reply(["allowed": false]); return }
                try ensureWatchdog(); let nextToken = str(message["token"]) ?? "", requested = Int64(str(message["deadline"]) ?? "0") ?? 0
                let nextBoot = MacDeadline.create(requested: requested, wallNow: MacFenceState.now, bootNow: MacDeadline.now, maximumMs: MacContract.value["session_ms"] as? Int ?? 600_000)
                guard !nextToken.isEmpty, nextBoot > 0 else { reply(["allowed": false]); return }
                token = nextToken; until = requested; bootUntil = nextBoot
                set("active"); reply(["allowed": state == "active"])
            case "resume":
                guard hostManaged, state == "paused", MacInputLedger.recover() else { reply(["allowed": false]); return }
                try ensureWatchdog(); until = MacFenceState.now + 6_000_000_000
                bootUntil = MacDeadline.create(requested: until, wallNow: MacFenceState.now, bootNow: MacDeadline.now, maximumMs: MacContract.value["session_ms"] as? Int ?? 600_000)
                guard bootUntil > 0 else { reply(["allowed": false]); return }
                set("active", reason: "host_authorized_resume")
                emit(["ev": "host_resume", "state": state]); reply(["allowed": state == "active"])
            case "pause": set("paused", reason: "requested_pause")
            case "stop":
                stop("request")
                if let nonce = str(message["stop_nonce"]), macStopNonceValid(nonce) {
                    let exited = macWaitForWorkers()
                    let native = try? MacFence.read()
                    let journal = try? MacInputLedger.read()
                    let clean = exited && native?.state == "stopped" && native?.cleanupPending == false &&
                        (journal?["keys"] as? [Int])?.isEmpty == true && (journal?["buttons"] as? [Int])?.isEmpty == true && MacFence.latchBlocks(MacFence.latch)
                    reply(["stop_nonce":nonce,"guardian_pid":Int(getpid()),"guard_file":(MacFence.file as NSString).lastPathComponent,"workers_stopped":exited,"input_cleanup_confirmed":clean])
                }
            case "end": grants.removeAll(); set(["stopped", "paused"].contains(state) ? state : "idle"); visuals.hide(); reply(["controls_visible": false])
            case "capture": visuals.hideForCapture(); reply(["allowed": true])
            case "capture_end": visuals.finishCapture(state)
            case "activity": visuals.activity(str(message["action"]) ?? "Checking")
            case "shutdown": if state != "idle" { stop("shutdown") }; visuals.hide(); watchdog?.terminate(); exit(0)
            case "prompt":
                guard state != "stopped", state != "paused" else { reply(["allowed": false]); return }
                try ensureWatchdog()
                let kind = str(message["kind"]) ?? ""
                var identity: [String: Any]?
                if kind == "app" { identity = try macIdentity(pid_t(int(message["app_pid"], -1))) }
                var allowed = hostManaged
                if !hostManaged {
                    visuals.hideForCapture()
                    let alert = NSAlert(); alert.messageText = kind == "app" ? "Allow this app for this session?" : "Allow one sensitive action?"
                    alert.informativeText = String((identity?["path"] as? String ?? "") + "\n\n" + (str(message["message"]) ?? "").prefix(6000))
                    alert.addButton(withTitle: "Deny"); alert.addButton(withTitle: "Allow")
                    prompt = alert
                    let expiry = Timer(timeInterval: 90, repeats: false) { _ in NSApp.abortModal() }
                    RunLoop.main.add(expiry, forMode: .common); RunLoop.main.add(expiry, forMode: .modalPanel)
                    allowed = alert.runModal() == .alertSecondButtonReturn
                    expiry.invalidate(); prompt = nil; visuals.finishCapture(state)
                }
                if state == "stopped" || MacFence.latchBlocks(MacFence.latch) { allowed = false }
                var result: [String: Any] = ["allowed": allowed, "decision": allowed ? (hostManaged ? "host-authorized" : "allowed") : "denied"]
                if allowed && kind == "app", let identity = identity {
                    let current = try macIdentity(pid_t(identity["pid"] as! Int))
                    guard current["key"] as? String == identity["key"] as? String else { throw AxonError("identity_changed", "App restarted during approval.") }
                    grants.insert(identity["key"] as! String); try writeState()
                }
                if allowed && kind == "action" {
                    let args = message["args"] as? [String: Any] ?? [:], operation = str(message["action_op"]) ?? ""
                    let label = str(message["label"]) ?? "", permit = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
                    let key = args["__pid"] != nil ? try macIdentity(pid_t(int(args["__pid"], -1)))["key"] as! String : ""
                    let dir = MacFence.file + ".permits"; try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
                    let contents = "\(token)\n\(try macFingerprint(operation, args, label))\n\(key)\n\(MacFenceState.now + 900_000_000)"
                    let path = (dir as NSString).appendingPathComponent(permit)
                    try Data(contents.utf8).write(to: URL(fileURLWithPath: path), options: [.atomic]); chmod(path, 0o600); result["permit"] = permit
                }
                reply(result)
            default: reply(["allowed": false, "error": "unknown_guardian_operation"])
            }
        } catch {
            reply(["allowed": false, "decision": "refused", "message": String(describing: error)])
        }
    }
}
