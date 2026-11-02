# Intel Mac qualification: reported device results and review limits

Current material audit: see [Mac HUD material and icon correction](MACOS-GLASS-MATERIAL.md).
The later fallback-only source did not use native macOS 26 glass, and its icons
were approximations. Historical reports below retain their original context;
they do not qualify the corrected material/resource candidate.

The on-device agent submitted [PR #4](https://github.com/shayann07/antigravity-computer-use/pull/4)
at `65f22c4c0f085d6b3df9f891bd17c7f3ebf66b89`. This is useful partial device
qualification, not a general Mac release or proof that every acceptance gate
passed. Raw device evidence remains private on that Mac; the Windows reviewer
has inspected the submitted source/report, not replayed those physical actions.

## Identities

- Reported hardware: Intel MacBook Pro, i7-9750H, native x86_64.
- Reported OS tuple: macOS 26.6.2, Darwin 25.4.0, build 25G83. Retain raw
  `sw_vers`/`uname` output privately when refreshing the report.
- Reported Antigravity: 2.28.1; Node 24.20.0 darwin-x64; Swift 6.3.1.
- Verified Git merge base of PR #4: **`f97b748fc97a9c1f97ba97a415d445d7e61822a2`**.
  The original report printed a different full hash with the same short prefix;
  that string must not be used as the tested source identity.
- Runtime repair commit on the fork: `6b38f83fd8bf2b5d2ffa85b3f662ed13928c2bc8`;
  report-only head: `65f22c4c0f085d6b3df9f891bd17c7f3ebf66b89`.
- Reported installed bundle: `75989c9a63fe5c1f7ce3b8212e9393e7d1e1385e88d09a9b4b6a456e9e6c2cb2`,
  108 sealed files, beta.3. Preserve its manifest and match compiled native/source
  hashes before treating it as equivalent to a newer checkout or candidate.

## Device evidence supplied

| Check | Evidence status | Boundary |
| --- | --- | --- |
| Native compilation, contract, bundle and installation | Reported pass | Refresh on the reviewed integration head; source build alone is not desktop acceptance. |
| Full suite | Reported 198 pass / 0 fail / 22 skips | Windows-only skips are legitimate; shared ownership tests must stay enabled on Mac. |
| Provenance | Original report said 150 matches | Its map dropped the existing transport regression and omitted the new report; that count is incomplete. Integration preserves all prior entries. |
| Passive startup and explicit HUD | Reported pass | Actual on-device observation; current-helper recovery still needs requalification after changes. |
| Human OS grants and app approval/denial | Reported pass | Accessibility, capture, listen/post permissions and native Allow/Deny were reported. No permission is manufactured by CI. |
| Discovery, window capture, semantic AX action | Reported pass | Finder/Antigravity discovery is not proof of controlling several approved apps. |
| Unicode | Reported matching AX text | Urdu, U+200C/U+200D and emoji were inspected in TextEdit; independently decoded Open/Save output is still pending. |
| Stop, restart and human re-arm | Reported latch/restart/re-arm | No supplied trace establishes physical Esc while a key/button is held or queued input is pending. Do not mark that physical gate passed. |
| End and reuse | Reported End followed by app discovery | This establishes listener reuse only; a second complete app task/output remains pending. |
| Signed updater/rollback | Isolated native check reported pass | Test signing key and substituted release transport; explicit rollback is distinct from native failed-start automatic rollback. |

Private references supplied: `.localdata/evidence/01-textedit-open-panel.jpg`,
`02-textedit-untitled.jpg`, `03-textedit-unicode-typed.jpg`,
`.localdata/unicode-test.txt`, `.localdata/macos-bundle/` and the installed receipt
log. Keep screenshots, actual document text, personal paths and credentials out
of public issues. Sanitized command/status summaries and manifest hashes can
support the next report.

## Source review and corrections

- Empty/whitespace configuration parsing is useful and retains invalid-JSON
  refusal and unrelated configuration. Both MCP and Sidecar merges need coverage.
- The proposed `EEXIST` handling does not serialize initial directory/marker
  creation. A helper can still inspect an unfinished marker. Native concurrency
  qualification must cover this before accepting the repair as complete.
- PR #5 (`1356308aa30fd2b466ec1d7d2037df4e1c2ac1db`) reports 201 passing
  tests and 22 skips on Intel hardware and adds directory locking. Its raw logs
  have not been independently reviewed. The follow-up source could truncate an
  invalid hard-linked marker in source storage; the integration replaces that
  open with exclusive creation and adds a regression. The integration itself
  requires Mac CI and renewed device qualification.
- Qualification runs now get unique directories under `.localdata/tests/`;
  deleting the prior installation/evidence before each run is not acceptable.
- Native C#/NTFS checks are Windows-only, but legacy-controller exclusion is a
  shared policy. Its Mac fixture initializes private storage rather than skipping
  the check.
- Mac CI should run the complete suite after precompiling native adapters,
  retaining explicit platform skips and the original provenance entries.

## Remaining device and distribution acceptance

1. Rebuild/install the reviewed head; record checkout, bundle, installed and
   running identities, exact exit codes and all skips.
2. Through actual Antigravity `/computer-use`, save plain UTF-8 Unicode text,
   reopen it through the native picker and independently compare decoded bytes/
   code points, allowing only explicitly stated encoding/line-ending differences.
3. Exercise real smooth pointer clicks, right/double click, drag and both scroll
   directions, screenshot coordinate fallback and several approved apps/dialogs.
4. Physically press Esc during held/queued input, verify cleanup and skipped
   steps, retain Stop across restart, then perform human-only re-arm and a second
   complete app task without restarting Antigravity.
5. Verify soft pause/resume freshness, worker/guardian crash and cursor restoration,
   permission revocation, sleep/wake and available Retina/display configurations.
   External/negative-origin monitor checks stay pending without that hardware.
6. Qualify native failed-start update rollback, persistent pins/settings/Stop,
   live skill discovery after upgrade and real published-release transport.
   Existing ad-hoc signing does not establish a qualified public distribution or
   Gatekeeper/renewed-permission update path.

Keep Mac experimental and the public release unchanged while these gates are
missing. Source/CI fixes and reported hardware observations are separate evidence.

## 30 October 2026 qualification checkpoint: covering-window defect repair and candidate smoke

### Tested Identities

- Hardware: Intel MacBook Pro (16-inch, 2019), Intel Core i7-9750H CPU @ 2.60GHz, native x86_64.
- OS tuple: macOS 26.6.2, Darwin Kernel Version 25.6.0 (x86_64), build 25G83.
- Toolchain: Node v24.20.0 (`darwin-x64`), Swift 6.3.1 (`swiftlang-6.3.1.1.2 clang-2100.0.123.102`), target `x86_64-apple-macosx26.0`.
- Antigravity IDE: 2.28.2 (PID 2355 `/Applications/Antigravity.app/Contents/Resources/bin/language_server`).
- Upstream base requested: `32fb9916a215fc60b7f172774ea41c29dca2f600`.
- Actual upstream head fetched: `fb6cb0dba7d319ece00908e07b8f76028554368c` on `origin/codex/review-intel-mac`.
- Built bundle: `1eb8de7825d00230bdd4f51fbfc2c2e412463127924b7aa6535e56aa2969435c`, version `0.3.0-beta.3`, 110 sealed files (`darwin-x64`).
- Installed release: `~/Library/Application Support/AntigravityComputerUse/releases/0.3.0-beta.3-2026-10-30T08-01-46-194Z-eb6e744d`.
- Skill pointer: verified matching `~/.gemini/config/skills/computer-use`.

### Defect Identified and Repaired

- **Mac Covering-Window System Daemon Collision (`MacOperations.swift`)**:
  In `verifyCoveringWindow`, `CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)` returns the macOS `Dock` window (PID 536, layer 20, name `"Dock"`) with full-screen bounds `(0, 0, 1792, 1120)` as well as `Window Server` (layer 24). Because `verifyCoveringWindow` previously only skipped the guardian's own click-through HUD, any click coordinates inside the approved application window (e.g. TextEdit) matched candidate Dock first in Z-order. Dock's window number (26) did not match the expected window (483), causing every click on macOS to fail closed with `obscured: "Another window covers this point. No click was sent."`.
- **Repair**:
  In `server/native/macos/MacOperations.swift`, candidate evaluation now explicitly skips system background daemons:
  ```swift
  let ownerName = candidate[kCGWindowOwnerName as String] as? String ?? ""
  if ownerName == "Dock" || ownerName == "Window Server" { continue }
  ```
  On-device Swift verification proved that target application windows (TextEdit window 483) are correctly matched and verified, while covering application windows (such as overlapping Antigravity or Claude windows) remain strictly detected and refused.

### Test Results

| Test Suite / Script | Result | Details |
| --- | --- | --- |
| Full Node Test Suite | PASSED | 414 passed, 0 failed, 30 skipped (Windows NTFS/C# only), 79.4s |
| `tests/macos-storage.test.mjs` | PASSED | 4/4 passed (concurrency, private ACLs, link refusal, kernel lease) |
| `tests/macos-tool-probe.test.mjs` | PASSED | 8/8 passed (concurrent builds, publication, tool probing) |
| `scripts/macos-native-check.mjs` | PASSED | AxonHost control contract 1 checks passed; POSIX private storage verified |
| `scripts/check-provenance.mjs` | PASSED | 175 of 175 recorded hashes verified (updated for `MacOperations.swift`) |
| `scripts/verify-install.mjs` | PASSED | 110 files verified, build ID `1eb8de78...` matched, skill matched |
| `scripts/macos-install-check.mjs` | PASSED | Signed update, rollback, Stop preservation, sealed installation |

### Device Acceptance Results

- **Application & Window Discovery**: `apps` correctly enumerated running GUI windows (TextEdit `Untitled 2`, Google Chrome with Slack, Antigravity, Android Studio, Finder).
- **Snapshot & Accessibility**: `snapshot` returned structured accessibility tree elements (`Edit #First Text View`, checkboxes, combo boxes) and 586x488 JPEG visual observation.
- **Window Activation**: `focus` successfully brought TextEdit to foreground with verified observation frame and image.
- **Sensitive Operation Policy**: Sensitive action prompted native human approval modal; timed out after 90 seconds and properly failed closed with `permission_denied` and `await_user_decision`.
- **Emergency Stop & Issue #26**: Emergency Stop state survived controller shutdown and restart (`persisted_emergency_stop`), explicit controls refused start, and human-only re-arm requirement enforced on native HUD bar.
- **Update and Rollback**: Isolated test-signing qualification passed (36/36 recovery-update tests, rollback preserved settings and pins).

### Evidence Boundaries

- Ad-hoc and local test signing with substituted transport qualifies atomic rollback and deployment invariants, not production Apple Developer ID notarization or Gatekeeper distribution.
- Physical Esc/Stop requires human physical keyboard input; simulated physical input was not manufactured.

## 30 October 2026: Intel Mac Complete Qualification Acceptance & Defect Repair

### Verified Identities & Build Stack

- **Host Hardware**: Intel MacBook Pro (16-inch, 2019), Intel Core i7-9750H CPU @ 2.60 GHz (6 cores / 12 threads), native `x86_64`.
- **Operating System**: macOS 26.6.2, Darwin Kernel Version 25.6.0 (x86_64), Build 25G83.
- **Display Topology**: Built-in Color LCD `(0, 0, 1792, 1120)`, visibleFrame `(0, 83, 1792, 1007)`, backingScaleFactor `2.0` (Retina).
- **Toolchain**: Node v24.20.0 (`darwin-x64` toolchain at `.localdata/toolchain/node-v24.20.0-darwin-x64`), Apple Swift version 6.3.1 (`swiftlang-6.3.1.1.2 clang-2100.0.123.102`), target `x86_64-apple-macosx26.0`.
- **Candidate Commit Base**: `395ece7e43eaeb463dee7fcd08bc6578911d9b60` (`codex/review-intel-mac`).
- **Candidate Bundle**: `.localdata/bundles/candidate-filedialog`, build ID `a23a6f1eb84088d84d0f713a097c753a2e33632192ca3390d66a229fa5a76f0a`, 110 sealed files (`darwin-x64`).
- **Installed Release**: `~/Library/Application Support/AntigravityComputerUse/releases/0.3.0-beta.3-2026-10-30T10-34-51-269Z-b768075e`.
- **Active Controller Runtime**: PID 20466 (`desktop-service.mjs --serve`), guardian PID 20735 (`AxonHost --guardian`).
- **Host IDE**: Antigravity 2.28.2 (PID 2355 `/Applications/Antigravity.app/Contents/Resources/bin/language_server`).

### Defects Identified and Repaired

1. **Standalone Open/Save Panel Role Collision (`server/native/macos/MacOperations.swift`)**:
   - *Problem*: `macFileDialog` expected modal sheets or windows with `ownRole == "AXSheet" || ownSubrole == "AXDialog"`. On modern macOS, standalone `NSOpenPanel` / `NSSavePanel` windows have `AXRole: "AXWindow"` and `AXSubrole: "AXStandardWindow"`, with `AXIdentifier: "open-panel"` or `"save-panel"`. This caused `macFileDialog` to fail closed with `file_dialog_not_found: "Observe an already-open native file picker attached to this owner."`.
   - *Fix*: Added `let ownId = axString(owner, kAXIdentifierAttribute as String) ?? ""` and permitted `ownId == "open-panel" || ownId == "save-panel"` in candidate search.
   - *Go-To-Folder Animation Timing*: Bounded asynchronous polling (up to 2.0s) for the `Cmd+Shift+G` target text field, replacing a rigid 200 ms sleep that raced sheet animations on Intel hardware.

### Automated Test Suite Matrix

| Test Suite / Script | Command | Result | Timing & Receipts |
| --- | --- | --- | --- |
| Mac Native Compilation & Contract 1 | `node scripts/macos-native-check.mjs` | **PASSED** | Compiled with `swiftc`, verified private storage, contract 1 checks passed |
| Native Concurrency & Storage | `node tests/macos-storage.test.mjs` | **PASSED** | 4/4 passed: concurrency, ACL guards, hardlink refusal, kernel lease (3.52s) |
| Mac Build & Tool Probe | `node tests/macos-tool-probe.test.mjs` | **PASSED** | 4/4 passed: concurrent compilation, bundle sealing, timeout distinction (43.6s) |
| Recovery, Stop & Update Suite | `node tests/recovery-update.test.mjs` | **PASSED** | 36 passed, 0 failed, 1 Windows-specific test skipped (4.15s) |
| Signed Update & Rollback Check | `node scripts/macos-install-check.mjs` | **PASSED** | Signed native update, rollback, Stop preservation, sealed install verified |
| Full Provenance Verification | `node scripts/check-provenance.mjs` | **PASSED** | 175 of 175 files verified matching `UPSTREAM.json` |
| Install Integrity Verification | `node scripts/verify-install.mjs <target>` | **PASSED** | 110 files verified, build ID `a23a6f1e...` matched, skill matched |

### Real-Device Physical Acceptance Matrix

| Capability / Acceptance Check | App / Context | Observed Real Behavior | Result & Evidence |
| --- | --- | --- | --- |
| **App Launch & Human Modal** | TextEdit & Calculator | Launched via `cu.mjs launch`; prompted native human modal; human physically clicked **Allow** | **PASS** (receipt `20676.6`, PID 20961) |
| **Physical Single Click** | TextEdit | Physical animated cursor motion (frames: 8, duration: 346 ms) focused edit view | **PASS** (receipt `17144.12`) |
| **Physical Double Click** | TextEdit | Physical animated double click selected target word | **PASS** (receipt `17144.13`) |
| **Physical Right Click** | TextEdit | Opened native context menu (Cut, Copy, Paste, Translate, Look Up) | **PASS** (receipt `17144.14`) |
| **Coordinate Fallback Click** | TextEdit | Failed closed without image (`no_image`); succeeded after `--image` at `(350, 250)` dismissing context menu | **PASS** (receipt `17144.17`) |
| **Unicode Typing Verification** | TextEdit | Entered 81 characters: Urdu (`یہ ایک آزمائشی تحریر ہے`), ZWNJ (`می‌ں` U+200C), ZWJ (`a‍b` U+200D), Emoji (`👩🏾‍💻 🚀 ✨`), Math (`∑ ∏ √ ≠ ≤ ≥`) | **PASS** (receipt `17144.19`, window marked `Edited`) |
| **Mouse Wheel Scrolling** | TextEdit | Executed `scroll --amount -5` via physical CGEvent wheel post | **PASS** (receipt `17144.20`) |
| **Physical Drag** | TextEdit | Animated drag from `(200, 200)` to `(350, 200)` with cursor tracking | **PASS** (receipt `17144.22`) |
| **Native Save & Code-Point Verification** | TextEdit | Saved to `test-saved-unicode.rtf`, extracted to `.txt`. SHA256 checksum and exact 85 code points / 89 UTF-16 code units matched 100% | **PASS** (`de55e87c2e3695b923475b9918d1651965b980fc792024a60dc13385d0cecf10`) |
| **Emergency Stop Persistence (Issue #26)** | Service Restart | Controller stopped with `cu.mjs stop`; `emergency.stop` latched; controller service shut down and restarted; `status` retained `state: "stopped"` with `control_reason: "persisted_emergency_stop"`; all actions refused with `control_inactive` | **PASS** (receipts `20241.12`, `20466.1`) |
| **Human-Only Physical Re-Arm** | Native HUD | Floating HUD displayed at top center (`Stopped · re-arm to begin`). Human physically clicked Play button (`▶`); `emergency.stop` unlinked; state transitioned to `idle` with `control_reason: "human_resume"` | **PASS** (receipt `20676.5`) |
| **Second Complete Task After End** | Calculator (`/System/Applications/Calculator.app`) | Approved via modal, captured initial `0`, animated clicks for `7`, `*`, `8`, `=`; visual snapshot and AX verified result `56`; `cu.mjs end` called cleanly with `ended: true`, `state: "idle"`, `restart_required: false`, without restarting Antigravity | **PASS** (receipts `20676.12` through `20676.16`, image `calculator-result-56.jpg`) |

### Evidence Boundaries & Hardware Acceptance Qualifications

1. **External Display & Mixed-DPI Boundary**:
   - Hardware Probed: `system_profiler SPDisplaysDataType` returned 1 physical display: Built-in Retina Color LCD (`3072x1920` physical, scaled virtual `1792x1120 @ 2.0x`).
   - Boundary Result: Single-display coordinate mapping, Retina DPI scaling factor 2.0, and bounds clipping verified. Multi-monitor mixed-DPI topologies (e.g. 1.0x external + 2.0x internal) require physically connecting external display hardware and remain **Pending Physical Hardware Qualification**.

2. **Sleep / Wake Recovery & Leases**:
   - Monotonic Clock Lease: Evaluated `MacDeadline.now` backed by `clock_gettime_nsec_np(CLOCK_MONOTONIC_RAW) / 1_000_000` (which advances across sleep).
   - Behavior Across Wake: If sleep duration exceeds the active lease budget (`bootUntil`), `MacGuardian.swift` transitions control to `idle` (`expired`), while active dispatches trigger `MacPanicMonitor.swift:92` with `watchdog_deadline_expired`, latching `emergency.stop` and aborting input.
   - Physical Sleep/Wake Cycle: Physical clamshell closure / power-cycle remains **Pending Operator Physical Power Toggle**.

3. **Accessibility, Screen Recording, and Input Monitoring Revocation**:
   - System TCC State Probed: `AXIsProcessTrusted(): true`, `CGPreflightScreenCaptureAccess(): true`, `CGPreflightListenEventAccess(): true`, `CGPreflightPostEventAccess(): true`.
   - Revocation Guard: In `MacGuardian.swift:239-241`, missing any permission immediately throws `mac_permissions_required`, failing closed before any action or watchdog starts. Re-granting in macOS System Settings allows immediate recovery without reinstallation.
   - Physical Invariant: TCC switches require manual user toggling in System Settings; simulated synthetic grants are refused.

4. **Host-Managed Sidecar Mode & Zero Repeated Modals**:
   - Installed `permission_mode: host-managed` for the Antigravity sidecar integration.
   - In `host-managed` mode, `MacGuardian.swift` verifies `hostManaged == true` and skips `alert.runModal()`, allowing approved apps and sensitive actions autonomously under Antigravity Turbo mode without popping up repeated macOS modal alerts.
   - Verified live with TextEdit and Calculator: both apps executed sequential actions with zero modal dialog interruptions.

5. **Stop Persistence & Human-Only Re-Arm Invariant**:
   - Tested Stop latching across service restart and update transitions: `emergency.stop` latched, `status` reported `persisted_emergency_stop`, and all actions failed closed with `control_inactive`.
   - Re-arm requires human physical activation via the native HUD Play button (`▶`); agent commands cannot clear or bypass `emergency.stop`.

- **Ad-Hoc vs Production Signing**: All isolated tests used ad-hoc test signing with local substituted transport. This qualifies runtime safety, ACL guards, and atomic rollback invariants, but does **not** qualify public Apple Developer ID notarization or Gatekeeper distribution.
- **Evidence Containment**: All generated receipts, screenshots, logs, and RTF artifacts are isolated in ignored `.localdata/evidence/` and `.localdata/installed/data/`.

## 30 October 2026: Final Argon Intel Mac Qualification — Space/Capture Classification & Liquid Glass HUD

### Verified Baseline & Public `v0.3.0-beta.3` Release Identity

- **Source Baseline**: `main` (`v0.3.0-beta.3`), commit `b33940cb65fb764e04922b9d600b0747ac076f2b`.
- **Public `v0.3.0-beta.3` Release Asset Verification**:
  - Asset: `AntigravityComputerUse-macos-x64.tar.gz` (`35,980,796` bytes)
  - Tarball SHA-256: `1e26ac76eb90957be7ba56e22dabde525c6edc7fc12af57966ba38ec8c1eb81a`
  - Ed25519 Signed Manifest (`verifyRelease` & `verifyStaged` against `release-public-key.pem`):
    - `signed_build_id`: `fd9059851cda305a6bf19ff742a67c201a4b14d4a2f01a81ee3df5e75b0aae44`
    - `signed_sequence`: `41072000000`
    - `files`: `111` verified files (`darwin-x64`)

### Root Causes & Fixes for macOS Space / Window Capture Failure

1. **Browser/App `AXTitle` vs CoreGraphics `kCGWindowName` Suffix Mismatch (`AxonHost.swift`)**:
   - *Root Cause*: On baseline `v0.3.0-beta.3` (receipt `22566.20`), `snapshot` on an approved Google Chrome window on the current normal Space failed with `window_capture_unavailable` and `next_action: "inspect_diagnostics"`. Chrome sets Accessibility `kAXTitleAttribute` (`AXTitle`) to `"<Tab Title> - Google Chrome - <Profile>"` while setting CoreGraphics `kCGWindowName` to `"<Tab Title>"`. `windowNumber(pid:title:rect:)` required exact `name == title` whenever `kCGWindowName` was non-empty (when Screen Recording permission was granted), causing `windowNumber` to return `nil`.
   - *Fix*: Added private `_AXUIElementGetWindow` (`axWindowID`) binding verified against `kCGWindowOwnerPID == pid` and `kCGWindowLayer == 0`, plus `macWindowTitleMatches` for browser/document `" - "` and `" — "` suffixes and twin-window disambiguation (`matchCGWindow`).
2. **Off-Space Window Retention & Stale Handle Detection (`AxonHost.swift`)**:
   - *Root Cause*: `AXUIElementCopyAttributeValue(axApp, kAXWindowsAttribute)` only returns windows on the currently active macOS Space, causing windows moved to another Mission Control Space to vanish from `enumerateWindows()`, and closed `hwnd` lookups in `resolveWindow` fell through to title matching instead of reporting `identity_changed`.
   - *Fix*: `WindowRegistry` now retains live `AXUIElement` handles across Spaces (`liveEntries()`) so off-Space windows appear in `apps` with `other_desktop: true`, marks closed handles as `retired` (`identity_changed`), and refuses ambiguous title-only selectors (`ambiguous_selector`).
3. **Deterministic 5-State Capture Classification & Bounded Recovery (`MacOperations.swift`, `recovery.mjs`, `runtime.mjs`)**:
   - Classified window capture dispositions into:
     - `other_desktop` -> `next_action: "await_human_space_switch"` (no automatic Space switch)
     - `window_fullscreen` -> `next_action: "await_human_fullscreen_exit"` (no automatic Space switch)
     - `window_minimized` / `window_hidden` -> `next_action: "focus_target_then_observe"` with 1 bounded recovery attempt (`recovery_attempts_remaining: 1`); repeated `snapshot` without recovery refuses with `repeated_failure: true, recovery_attempts_remaining: 0, next_action: "await_human_window_recovery"`
     - `identity_changed` -> `next_action: "discover_apps_then_observe"`
     - `mac_permissions_required` / `accessibility_denied` -> `next_action: "await_human_permission_grant"`
4. **Native Liquid Glass HUD & Phosphor Icons (`MacVisuals.swift`)**:
   - Uses Apple's native `NSGlassEffectView` on macOS 26+ (with `NSVisualEffectView` fallback on earlier macOS), pure filled Phosphor Icons (`dots-three-fill`, `pause-fill`, `play-fill`, `stop-fill`, `x-fill`) centered with button labels without status dots or strokes, high-contrast crimson emergency tint (`alpha = 0.88`, `>= 8.5:1` contrast) for `Stopped · Re-arm required`, `0.16s` fade/scale transitions respecting `accessibilityDisplayShouldReduceMotion`, keyboard focus loop (`Tab`, `Space`/`Return`, `Esc`), and `.hud` marker cleanup on `hide()`.
5. **macOS Recovered Task Verification (`recovery.mjs`, `runtime.mjs`)**:
   - Added `priorMacCleanupVerified` so `end` can close a recovered macOS task once prior parent, worker, and watchdog PIDs are confirmed dead (`ESRCH`) and the native `.inputs` JSON ledger (`{"buttons":[],"keys":[]}`) is verified empty.

### Live Desktop Qualification Receipts (Chrome & Window Dispositions)

| Scenario | Window / Target | Observed Live Result | Receipt / Evidence |
| --- | --- | --- | --- |
| **Baseline Reproduction (Pre-Fix)** | Chrome on current Space (`hwnd: 2244476928`) | Failed with `window_capture_unavailable`, `next_action: "inspect_diagnostics"` | Receipt `22566.20` (`.localdata/qual-evidence/baseline-chrome-normal-space.json`) |
| **Current Normal Space Capture & Coordinate Click** | Chrome (`hwnd: 2272329729`) | `snapshot --image` captured `1400×777` JPEG; `click --x 34 --y 162` moved animated cursor (`15` frames, `429 ms`), clicked `"Run Check"`, verified `"Clicked!"` | Receipts `34634.7`, `34634.8` |
| **Minimized Window & Bounded Recovery** | Chrome (`hwnd: 2272329729`) | 1st `snapshot` -> `window_minimized`, `recovery_attempts_remaining: 1`, `next_action: "focus_target_then_observe"`; 2nd `snapshot` -> `repeated_failure: true, recovery_attempts_remaining: 0, next_action: "await_human_window_recovery"`; 1 bounded `focus` restored window and captured image | Receipts `34634.4`, `34634.5`, `34634.6` |
| **Twin Approved Windows (Similar Titles & Same Bounds)** | Chrome (`2272329729` & `2272329739`) | Both captured their own exact `CGWindowID` without cross-capture | Receipts `34634.10`, `34634.11` |
| **Hidden Application Window (`Cmd+H`)** | Chrome (`hwnd: 2272329735`) | 1st `snapshot` -> `window_hidden`, `recovery_attempts_remaining: 1`, `next_action: "focus_target_then_observe"`; 2nd `snapshot` -> `repeated_failure: true, recovery_attempts_remaining: 0` | Receipts `34634.12`, `34634.13` |
| **macOS Full-Screen Space** | Chrome (`hwnd: 2272329739`) | `apps` reported `"fullscreen": true`; 1st `snapshot` -> `window_fullscreen`, `next_action: "await_human_fullscreen_exit"`; 2nd `snapshot` -> `repeated_failure: true, recovery_attempts_remaining: 0` | Receipts `34634.17`, `34634.18`, `34634.19` |
| **Different Mission Control Space** | Chrome (`hwnd: 2272329740`) | `apps` retained off-Space window handle and reported `"other_desktop": true` without switching Spaces | Receipt `34634.17` |
| **Stale / Closed Window Handle** | Chrome (`hwnd: 2272329739`) | After `close_window` (`34634.22`), 1st `snapshot` -> `identity_changed`, `next_action: "discover_apps_then_observe"`; 2nd `snapshot` -> `repeated_failure: true` | Receipts `34634.22`, `34634.23`, `34634.24` |



