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
    var guardianIdentity: (pid_t, String)?
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
                // An idle monitor losing its tap must not summon a stopped HUD
                // while the user works normally. Retire it; activation creates
                // a fresh, acknowledged monitor. Active/unknown state still stops.
                let state = try? MacFence.read()
                if state?.state != "idle" || state?.cleanupPending != false { MacFence.emergency("event_tap_disabled") }
                exit(0)
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
        // Human mouse and keyboard input never pauses or yields control.
        // Only Esc or Control+Option+F12 ends the task (handled above).
    }
    func run(guardian: pid_t, birth: String) -> Never {
        guardianIdentity = (guardian, birth)
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
                if (try? MacFence.read().state) != "idle" {
                    // The old owner is gone. Preserve the cleanup witness for
                    // a replacement's read-only recovery instead of leaving a
                    // permanently pending record after successful release.
                    if MacFence.emergency("guardian_exited") { try? MacFence.write("stopped||0||0|0") }
                }
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
    // App keys approved at the click tier (terminals and IDEs).
    var clickGrants = Set<String>()
    // Approvals last for the agent's conversation: per session_handle, the
    // executables the human approved. Kept across Stop, End and expiry; a
    // controller restart starts empty, so a new conversation asks again.
    var remembered: [String: Set<String>] = [:]
    var watchdog: Process?
    var timer: Timer?
    var visuals = MacVisuals()
    var prompt: NSPanel?
    var controlsUntil = Date.distantFuture
    // Set while a previous task's input cleanup is unverified: the bar is
    // visible and Stop works, but clear_stop, resume and activation refuse.
    // Starts locked when the runtime recovered an unverified prior task.
    var rearmLocked = ProcessInfo.processInfo.environment["AGCU_REARM_LOCKED"] == "1"
    let hostManaged = ProcessInfo.processInfo.environment["AGCU_PERMISSION_MODE"] == "host-managed"
    func run() throws -> Never {
        _ = NSApplication.shared; NSApp.setActivationPolicy(.accessory)
        try Data("\(getpid())|\(try macProcessStart(getpid()))".utf8).write(to: URL(fileURLWithPath: MacFence.file + ".guardian"), options: [.atomic])
        chmod(MacFence.file + ".guardian", 0o600)
        visuals.onStop = { [weak self] in self?.stop("button") }
        visuals.onEnd = { [weak self] in guard let self = self else { return }; self.stop("human_end"); self.visuals.hide(); emit(["ev":"human_end","state":self.state]) }
        retireSmartMode()
        state = MacFence.latchBlocks(MacFence.latch) ? "stopped" : "idle"
        try writeState(); visuals.hide()
        emit(["ev": "settings", "takeover_mode": "manual"])
        emit(["ev": "ready", "pid": Int(getpid()), "hotkey": false, "presence": false, "platform": "darwin",
              "clear_stop": true, "session_reason": true, "remembered_approvals": true, "access_tiers": true])
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
    // Smart takeover is retired: human input never pauses. A saved "smart"
    // preference from an older build is rewritten to manual.
    func retireSmartMode() {
        let path = URL(fileURLWithPath: MacFence.file).deletingLastPathComponent().appendingPathComponent("control-preferences.json")
        guard var value = (try? Data(contentsOf: path)).flatMap({ try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }),
              value["takeover_mode"] as? String == "smart" else { return }
        value["takeover_mode"] = "manual"
        if let bytes = try? JSONSerialization.data(withJSONObject: value) { try? bytes.write(to: path, options: [.atomic]); chmod(path.path, 0o600) }
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
        let click = Data(clickGrants.intersection(grants).sorted().joined(separator: "\n").utf8).base64EncodedString()
        try MacFence.write("\(state)|\(token)|\(until)|\(encoded)|\(bootUntil)|\(cleanupPending ? 1 : 0)|\(click)")
    }
    func clearGrants() { grants.removeAll(); clickGrants.removeAll() }
    func set(_ next: String, reason: String = "", clearingStop: Bool = false) {
        if next == "active" && (MacFence.latchBlocks(MacFence.latch) || state == "stopped") { return }
        // Only clear_stop, after its cleanup proof, leaves a stopped state.
        if state == "stopped" && next != "stopped" && !clearingStop { return }
        var effectiveReason = reason
        state = next
        cleanupPending = next != "active"
        if next == "stopped" || next == "idle" { clearGrants() }
        do { try writeState() } catch { state = "stopped"; MacFence.emergency("state_write_failed") }
        // The independent watchdog may latch Stop while this transition is
        // being published. Recheck after the write so a stale idle/paused
        // transition cannot leave the local UI claiming control is available.
        let resolved = MacFence.resolvedState(state, latched: MacFence.latchBlocks(MacFence.latch))
        if resolved != state {
            state = resolved; cleanupPending = true; clearGrants(); effectiveReason = "emergency_stop"
            do { try writeState() } catch { MacFence.emergency("state_write_failed") }
        }
        if state != "active" {
            let workersStopped = macWaitForWorkers(), inputsRecovered = MacInputLedger.recover()
            if !workersStopped || !inputsRecovered { state = "stopped"; clearGrants(); effectiveReason = "input_cleanup_failed"; MacFence.emergency(effectiveReason) }
            else {
                cleanupPending = false
                do { try writeState() } catch { state = "stopped"; effectiveReason = "state_write_failed"; MacFence.emergency(effectiveReason) }
                let final = MacFence.resolvedState(state, latched: MacFence.latchBlocks(MacFence.latch))
                if final != state { state = final; clearGrants(); effectiveReason = "emergency_stop"; do { try writeState() } catch { MacFence.emergency("state_write_failed") } }
            }
            visuals.releaseCursor()
        }
        if state == "idle" { visuals.hide() }
        else { visuals.show(state); controlsUntil = state == "stopped" ? Date().addingTimeInterval(8) : .distantFuture }
        emit(["ev": "state", "state": state, "reason": effectiveReason, "custom_cursor": visuals.cursorApplied])
    }
    func stop(_ reason: String) { MacFence.emergency(reason); set("stopped", reason: reason) }
    // There is no Pause and no Resume (owner decision, #99): Esc, Control+
    // Option+F12 or the bar's Stop end the task, and the agent's next ready
    // clears a confirmed Stop after cleanup proof. A "paused" record left by an
    // older build is still read as no-control, never resumed.
    // Moves a confirmed Stop to idle once cleanup is proven: keys and buttons
    // released, prior workers gone. An unconfirmed Stop or an unreadable
    // marker is never cleared. Mirrors Guardian.cs "clear_stop".
    func clearStop() -> [String: Any] {
        var cleared = false, why: String?
        if state != "stopped" { cleared = state == "idle"; if !cleared { why = "not_stopped" } }
        else if rearmLocked { why = "recovered_cleanup_unverified" }
        else if !macWaitForWorkers() || !MacInputLedger.recover() { why = "input_cleanup_unverified" }
        else {
            // The watchdog ignores Esc while the fence reads stopped, but any
            // other writer that replaces the fence while the marker is being
            // cleared means a new Stop: latch again and refuse.
            var before = stat(), after = stat()
            let pinned = lstat(MacFence.file, &before) == 0
            switch MacFence.clearConfirmedLatch(MacFence.latch) {
            case .cleared where !pinned || lstat(MacFence.file, &after) != 0 || after.st_ino != before.st_ino || after.st_mtimespec.tv_nsec != before.st_mtimespec.tv_nsec || after.st_mtimespec.tv_sec != before.st_mtimespec.tv_sec:
                MacFence.latchStop(MacFence.latch); why = "stopped_again"
            case .cleared:
                set("idle", reason: "stop_cleared", clearingStop: true)
                cleared = state == "idle"; if !cleared { why = "stopped_again" }
            case .refused(let reason): why = reason
            }
        }
        return ["cleared": cleared, "reason": why ?? NSNull(), "workers_stopped": cleared, "input_cleanup_confirmed": cleared]
    }
    func tick() {
        if Date() > controlsUntil { visuals.hide(); controlsUntil = .distantFuture }
        if (["active", "paused"].contains(state) || prompt != nil), MacFence.latchBlocks(MacFence.latch) {
            if prompt != nil { NSApp.abortModal() }; stop(MacFence.latchEntryBlocks(MacFence.latch + ".unconfirmed") ? "guardian_stop_unconfirmed" : "persisted_emergency_stop"); return
        }
        guard let stored = try? MacFence.read() else { if state == "active" { stop("state_unavailable") }; return }
        if stored.state == "stopped" && state != "stopped" { if prompt != nil { NSApp.abortModal() }; set("stopped", reason: "escape") }
        if state == "active" {
            if watchdog?.isRunning != true { stop("watchdog_exited"); return }
            if MacFenceState.now >= until || !MacDeadline.valid(bootUntil, now: MacDeadline.now) { set("idle", reason: "session_expired"); return }
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
            case "visual_status": reply(["controls_visible": visuals.visible, "cursor": state == "active", "takeover_mode": "manual", "material_backend": MacVisuals.materialBackend(for: visuals.rootView)])
            case "show_controls": rearmLocked = (message["rearm_locked"] as? Bool) ?? false; visuals.show(state); controlsUntil = .distantFuture; reply(["controls_visible": visuals.visible, "rearm_locked": rearmLocked, "material_backend": MacVisuals.materialBackend(for: visuals.rootView)])
            case "dismiss_controls": if ["active", "paused"].contains(state) { stop("dismiss") }; visuals.hide(); reply(["controls_visible": false])
            case "attach": reply(["registered": true]) // worker self-registers before reporting ready
            case "activate":
                guard !rearmLocked, state != "stopped", state != "paused", MacInputLedger.recover() else { reply(["allowed": false]); return }
                try ensureWatchdog(); let nextToken = str(message["token"]) ?? "", requested = Int64(str(message["deadline"]) ?? "0") ?? 0
                let nextBoot = MacDeadline.create(requested: requested, wallNow: MacFenceState.now, bootNow: MacDeadline.now, maximumMs: MacContract.value["session_ms"] as? Int ?? 600_000)
                guard !nextToken.isEmpty, nextBoot > 0 else { reply(["allowed": false]); return }
                token = nextToken; until = requested; bootUntil = nextBoot
                set("active"); reply(["allowed": state == "active"])
            case "avoid_input":
                // Moves the bar clear of a click target (global points, top-left
                // origin). Only the agent's own active task can ask; it never
                // changes Stop, state, grants or visibility.
                var allowed = state == "active" && !token.isEmpty && str(message["token"]) == token, moved = false
                if let r = message["rect"] as? [NSNumber], r.count == 4,
                   r.allSatisfy({ $0.doubleValue.isFinite && abs($0.doubleValue) <= 10_000_000 }), r[2].doubleValue > 0, r[3].doubleValue > 0 {
                    if allowed {
                        let target = MacWindowGlow.appKit(CGRect(x: r[0].doubleValue, y: r[1].doubleValue, width: r[2].doubleValue, height: r[3].doubleValue))
                        (allowed, moved) = visuals.avoid(target)
                    }
                } else { allowed = false }
                reply(["allowed": allowed, "moved": moved])
            case "pause", "resume":
                // Removed: nothing pauses or resumes control. Refused without effect.
                reply(["allowed": false, "error": "pause_removed"])
            case "clear_stop": reply(clearStop())
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
            case "end":
                clearGrants(); set(["stopped", "paused"].contains(state) ? state : "idle"); visuals.hide()
                if let nonce = str(message["end_nonce"]), macStopNonceValid(nonce) {
                    let exited = macWaitForWorkers()
                    let native = try? MacFence.read()
                    let journal = try? MacInputLedger.read()
                    let clean = exited && native?.state == state && native?.cleanupPending == false && state != "active" && !visuals.visible &&
                        (journal?["keys"] as? [Int])?.isEmpty == true && (journal?["buttons"] as? [Int])?.isEmpty == true
                    if !clean { stop("end_cleanup_unconfirmed"); visuals.hide() }
                    reply(["end_nonce":nonce,"guardian_pid":Int(getpid()),"guard_file":(MacFence.file as NSString).lastPathComponent,"workers_stopped":exited,"input_cleanup_confirmed":clean,"controls_visible":visuals.visible])
                } else { reply(["controls_visible": visuals.visible]) }
            case "capture": visuals.hideForCapture(); reply(["allowed": true])
            case "capture_end": visuals.finishCapture(state)
            case "activity":
                let action = str(message["action"]) ?? "Checking"
                visuals.activity(action)
                // The glow follows the last window that received an action. Only
                // a window of an app approved for this task is accepted.
                // point: the action in global screen points, top-left origin
                // (the same space as rect). Without it the pointer is used.
                var at: CGPoint?
                if let point = message["point"] as? [NSNumber], point.count == 2,
                   point.allSatisfy({ $0.doubleValue.isFinite && abs($0.doubleValue) < 100_000 }) {
                    at = MacWindowGlow.appKit(CGPoint(x: point[0].doubleValue, y: point[1].doubleValue))
                }
                if state == "active", let pid = (message["pid"] as? NSNumber)?.int32Value, pid > 0,
                   let rect = message["rect"] as? [NSNumber], rect.count == 4,
                   rect.allSatisfy({ $0.doubleValue.isFinite && abs($0.doubleValue) < 100_000 }),
                   let key = (try? macIdentity(pid))?["key"] as? String, grants.contains(key) {
                    visuals.glow(action: action, pid: pid, rect: CGRect(x: rect[0].doubleValue, y: rect[1].doubleValue, width: rect[2].doubleValue, height: rect[3].doubleValue), point: at)
                }
            case "shutdown": if state != "idle" { stop("shutdown") }; visuals.hide(); watchdog?.terminate(); exit(0)
            case "prompt":
                guard state != "stopped", state != "paused" else { reply(["allowed": false]); return }
                try ensureWatchdog()
                let approvalState = try MacFence.read()
                let kind = str(message["kind"]) ?? ""
                guard ["app", "action"].contains(kind) else { throw AxonError("bad_arguments", "Unknown native confirmation kind.") }
                var identity: [String: Any]?
                if kind == "app" { identity = try macIdentity(pid_t(int(message["app_pid"], -1))) }
                var handle = str(message["session_handle"])
                if let value = handle, value.isEmpty || value.utf8.count > 64 { handle = nil }
                let executable = identity?["path"] as? String
                // Already approved in this conversation: restored without a prompt.
                // The handle alone is never an approval; the executable must match.
                let known = kind == "app" && (message["remembered"] as? Bool) == true &&
                    MacGuardian.rememberedAllows(remembered, handle: handle, executable: executable)
                var allowed = hostManaged || known, timedOut = false
                if !allowed {
                    // The prompt hangs from the bar where it was before capture hiding.
                    let bar = visuals.visible ? visuals.panel?.frame : nil
                    visuals.hideForCapture()
                    // Capture hiding removes our pointer window; the human
                    // needs the normal OS cursor throughout a modal decision.
                    visuals.releaseCursor()
                    var request = String((str(message["message"]) ?? "").prefix(6000))
                    if let path = identity?["path"] as? String, !request.contains(path) {
                        // Keep the native identity in view when the request omits it.
                        let parts = MacPromptCardView.split(request, fallback: "")
                        request = (parts.title.isEmpty ? "" : parts.title + "\n\n") + path + "\n\n" + parts.body
                    }
                    allowed = MacAccessPrompt.run(message: request,
                                                  fallback: kind == "app" ? "Allow this app for this session?" : "Allow one sensitive action?",
                                                  bar: bar, onPanel: { [weak self] in self?.prompt = $0 }, timedOut: &timedOut)
                    tick() // Resolve takeover, Stop and expiry before restoring control visuals.
                    visuals.finishCapture(state)
                }
                if state == "stopped" || state == "paused" || MacFence.latchBlocks(MacFence.latch) { allowed = false }
                var result: [String: Any] = ["allowed": allowed, "decision": allowed ? (hostManaged ? "host-authorized" : known ? "remembered" : "allowed") : (state == "stopped" ? "stopped" : timedOut ? "timeout" : "denied")]
                if allowed {
                    try MacFence.withApprovalFence(approvalState) {
                        if kind == "app", let identity = identity {
                            let current = try macIdentity(pid_t(identity["pid"] as! Int))
                            guard current["key"] as? String == identity["key"] as? String else { throw AxonError("identity_changed", "App restarted during approval.") }
                            let key = identity["key"] as! String
                            grants.insert(key)
                            if str(message["tier"]) == "click" { clickGrants.insert(key) } else { clickGrants.remove(key) }
                            try writeState()
                            if let handle = handle, let executable = executable {
                                remembered = MacGuardian.remember(remembered, handle: handle, executable: executable)
                            }
                        }
                        if kind == "action" {
                            let args = message["args"] as? [String: Any] ?? [:], operation = str(message["action_op"]) ?? ""
                            let label = str(message["label"]) ?? "", permit = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
                            let key = args["__pid"] != nil ? try macIdentity(pid_t(int(args["__pid"], -1)))["key"] as! String : ""
                            let dir = MacFence.file + ".permits"; try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
                            let contents = "\(token)\n\(try macFingerprint(operation, args, label))\n\(key)\n\(MacFenceState.now + 900_000_000)"
                            let path = (dir as NSString).appendingPathComponent(permit)
                            try Data(contents.utf8).write(to: URL(fileURLWithPath: path), options: [.atomic]); chmod(path, 0o600); result["permit"] = permit
                        }
                    }
                }
                reply(result)
            default: reply(["allowed": false, "error": "unknown_guardian_operation"])
            }
        } catch {
            reply(["allowed": false, "decision": "refused", "message": String(describing: error)])
        }
    }
    static func rememberedAllows(_ table: [String: Set<String>], handle: String?, executable: String?) -> Bool {
        guard let handle = handle, !handle.isEmpty, handle.utf8.count <= 64,
              let executable = executable, !executable.isEmpty else { return false }
        return table[handle]?.contains(executable) == true
    }
    static func remember(_ table: [String: Set<String>], handle: String, executable: String) -> [String: Set<String>] {
        guard !handle.isEmpty, handle.utf8.count <= 64, !executable.isEmpty else { return table }
        var next = table
        if next[handle] == nil && next.count >= 64 { next.removeAll() }
        next[handle, default: []].insert(executable)
        return next
    }
}
