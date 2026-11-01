# macOS candidate validation — 29 October 2026

**Current Windows record:** [1 November beta.4 qualification](docs/WINDOWS-BETA4-QUALIFICATION.md).
It supersedes older installed/published identities below without upgrading
historical physical or Mac checks to current-build passes.

On 29 October, the owner physically pressed Esc during a Windows Notepad drag
on installed build `bc45734396d12837098b4cdcd046fd4d36e7c22da7eeeb6acec33fd023cedc9f`.
The journal observed one held mouse button before Stop and none afterward; the
queued second action was skipped. Stop survived service restart, programmatic
resume was refused, and the owner re-armed locally. This does not establish a
held-key Stop, multi-display behavior or Mac physical Stop. Evidence is retained
in `.localdata/reliability-current/physical-stop-result.json`.

The shared-core Mac port lives on `codex/macos-and-latency-review`, not in a
published release. Native Apple Silicon and Intel compilation, native refusal
contracts, private storage/link/ACL/lease checks, shared regressions, sealed
packaging, fake-home install/start/End/Stop/restart/update/rollback passed at
`6c48fb7`: [Mac CI](https://github.com/shayann07/antigravity-computer-use/actions/runs/40817884413).
Subsequent cleanup/identity changes require their own exact-head checks.
The local Windows suite at `e0533a9` passed 154 tests with zero failures and seven
skips (five ACL qualification, two Mac-only). Native Windows compilation passed;
the source inventory includes the shared skill and Mac adapter.

CI sends no desktop input or permission clicks. Actual Mac Antigravity tasks,
native Open/Save behavior, physical interruption/held-input cleanup/re-arm,
permission revocation, lock/sleep/session transitions, mixed displays and visual
cleanup remain unqualified. [Mac checklist](docs/MACOS.md). Neither Windows
orchestration speed nor installed/published Windows identity was changed here.

# Automatic-startup qualification — 27 October 2026

Actual Antigravity-managed startup passed on published beta.2: the service parent was the App's `language_server.exe`; no manual launcher/App restart was used, and no guardian process opened. Native read-only app discovery passed the visible-desktop preflight and returned three windows. Both scope pins and 75 sealed files per scope matched build `23ddd7bdfc2f2c19060308c441ef7fef43d700ccfdccaa88b76bb488105d2777`. End retained Stop and cleared grants. Only the project's Sidecar enabled setting changed; unrelated configuration was checked equal. The existing focused Sidecar configuration test passed. Private evidence: `.localdata/autostart-repair-20261027/result.json`. This is startup/discovery qualification, not physical re-arm/input or full Upscaly AI acceptance. The enabled setting was rechecked on 28 October without restarting or retesting the service.

# Startup control-bar fix — 26 October 2026

26 October 2026 startup bar repair: v0.3.0-beta.2. Passive startup/status/End/shutdown do not start the guardian; native startup is hidden; End hides controls; Stop dismisses after8seconds; explicit controls reveals human re-arm without clearing Stop. Actual native visibility regression passed for idle and latched startup, active/End, capture cleanup, dismissal and refused activation while stopped. Source139pass/0fail/5ACLskips. The changed helper requires fresh real-app and physical/hardware qualification; earlier AI speed figures remain historical. General orchestration latency is still unfinished.

# Latest validation — 24 October 2026

| Check | Current evidence | Boundary |
| --- | --- | --- |
| Windows source / CI |137passed,0failed,5explicitly skipped | Installation-ACL qualification is refused under unsafe checkout ancestors; skips are not qualification passes. Native source compilation and provenance checks passed. |
| Real Antigravity PNG |1920×1320,3424092bytes, SHA256`7945386ae3df58d29b96fd303d922716a12bc5894cac494278311c7c9ec46b6c`; native inference16272ms, DBpublished | Exact controllerde470849, helper5e2cbf20.269280ms end-to-end; source/app changes prevent treating it as a statistical A/B. |
| Real Antigravity JPEG |1920×1320,174151bytes, SHA256`5fb3342865f9e85e75572e21d8d791d321f1787211a737dce0038a2ba29fd13b`; native inference18915ms, DBpublished | Same controller/helper/model, independent new session,272954ms. It is slower than an earlier JPEG witness. |
| Real custom-controller application | Rebuilt Upscaly native AI export, actual completion view and independent bytes/DB/engine checks; settings restored | Direct controller operation is not an Antigravity orchestration timing result. Application GPU-profile fix is separate from this library. |
| Installation | Both scopes pinned to the tested build; sealed files/skill/reference content checked, global configuration unchanged | Later documentation-only bundle changes require a refreshed pin/inventory check. |
| Physical final Stop | Owner reported Esc/re-arm; native status recorded human resume, idle, empty grants and cursor off | Instrumented queued waits timed out before physical input and are not live queued/held-input cancellation passes. That qualification remains open. |

The earlier records below are retained historical build-specific evidence, not current totals or a claim that unrun checks passed.

---

# Validation - 0.3.0-beta.1

24 October 2026 (Asia/Karachi). Distinguish source checks, native component tests, actual applications and physical human input. No fixture or model report alone proves general usability.

| Check | Evidence | Boundary |
|---|---|---|
| Automated source | 104 passing local checks on private-storage branch; main93-check filename source passed GitHub CI | Includes actual NTFS privacy/refusal/junction tests, migration Stop preservation, same-build policy binding, per-scope policy retention and exited-starter handoff; branch CI/final host speed pending |
| Native helper | 12 passing checks | Real input/UIA/capture, identity and permission refusal, hung worker termination |
| Host-managed component workflow | 13 passing checks | Two disposable app processes, owned dialog, real wheel/drag/Unicode and second session; not the host permission engine |
| Cursor/glow recovery | 8 passing checks | Actual cursor-role pixels change, distinct text insertion artwork, live breathing, restoration after Pause and hard UI/watchdog crashes |
| Guardian/parent death | 5 guardian checks and parent-death recovery pass | Independent Stop and worker cleanup; injected chord is not physical Esc |
| Renderer | 100/125/200% renders inspected; alpha/falloff checks pass | Original artwork on a fictional desktop; real multi-monitor/DPI remains untested |
| Actual Antigravity | Dev5 real AI export/pause/resume/second session; dev6 real JPEG viewing and semantic/Unicode checks; dev7 exact pin/lifecycle discovery | App used read_file for images. These witnesses are scoped to their recorded builds |
| Real Upscaly | Original and feature build AI PNG/JPEG, in-flight cancel, retry, chosen GPU/tile, actual decoded headers and retained previous outputs | Native NCNN execution and decoded outputs distinguish AI from silent software resize. Broader app features are unqualified |
| Real editor/emulator | Dev7 Copy after Open/New, rich image transfer with clipboard sharing Off, Undo/Redo, rotation/font layout and Gboard emoji | Sharing On downgraded rich clipboard; original settings restored. Direct emoji commit is not composing-text/IME qualification |
| Physical Stop/re-arm | Owner performed both re-arms and physical Esc on dev7; fresh observation afterward | Held drag interrupted and seven queued actions skipped; service replacement did not clear Stop |
| Speed1 native candidate | Exact build8d9d8082 real Upscaly batched import, no leftover picker; actual Notepad pause/refusal/resume/stale frame and exact1319-unit saved Unicode | Direct timings are not host wall-time improvement. Windows Notepad's launcher returned observe_pending; apps/snapshot recovered without duplicate launch. Later source launcher hardening still needs refreshed packaging |
| Provider exception replay | Exact old nativea2: after-effect1dispatch/2effects/1physical; before-effect1/1/1. Candidate2abe/nativea2fd:1/1/0 and1/0/0, both input_outcome_unknown | Real owned WPF accessibility provider, same reusable harness, old exit1/new exit0. This qualifies the fault path, not real Upscaly export, host speed or new physical Esc |
| Explicit filename entry | Native3d/build9f0 real Notepad Unicode/emoji Save, longer ASCII/space Save As, Unicode Open; exact74-unit file bodies, all clipboard restoration flags true | Bypasses the observed incremental keyboard filename loss when clipboard access is explicitly authorized; no claim keyboard entry is globally lossless. Provider regression also passed on exact3d |
| Private deployment | Real68-file storage1 install verified payloads, generated policy, skill pin and actual ACLs; host-managed startup reports private data; standalone same-build startup/discovery refused; rollback verified | No native input in the mode-mismatch check. Exact3d provider regression also passed. Final scope-registry/launcher-speed changes postdate this diagnostic artifact and need refreshed packaging |

## Retained failures and recovery

The beta component workflow initially refused to start because the idle installed helper already owned Ctrl+Alt+F12. The idle service was shut down normally; the unchanged test then passed. Refusing control without the independent emergency shortcut is intentional.

The dev7 Stop harness passed its five safety/human checkpoints but exited unsuccessfully at final cleanup: it supplied an unsupported risk field to close_window. The field was corrected, close/end recovered separately and the original result preserved. It is not a clean whole-script pass.

The new covered-target capture case returned no pixels from an unapproved cover. The suspected older-helper leak did not reproduce on this desktop; no failing-before claim. Native code now refuses covered-screen fallback and the runtime rejects legacy screen_occluded images.

In the final dev7 editor run, one expired observation was safely refused. Two successful Close inputs returned input_completed:true with window_not_found during verification. The agent observed again instead of repeating completed input. A transitional white image was re-observed without replaying the action.

## Beta real-app results

The custom controller operated real Upscaly and Notepad; these were not disposable fixture substitutes. PNG and JPEG decoded at 1920x1320. NCNN logs recorded actual 17154ms/16414ms inference, GPU0/Auto tile/Balanced. PNG SHA256 was 35e841234e83db07284b2aa3d230525931965c8acf9757b5b7e35ed92fe844ee; JPEG was 9159c3817af3e683fc6f9aaae095dcfecb14317cc174451a5c02ea8d16052897. Cancellation during attempt3 terminated its native child, recorded cancelled/aborted and published no third file. Previous outputs remained intact. Settings restored; no model downloads or new consents.

Real Notepad exposed three controller failures before publication: exact-HWND focus rejected its own RichEdit child; rapid Unicode packets lost/repeated characters; a save-dialog value write echoed the requested filename while retaining the old internal filename. These are retained failures, not passes. The corrected containing-root check refuses other roots, short typing is paced/capped400 UTF-16 units, and explicit paste reuses upstream clipboard preservation with stricter failure cleanup. Save As uses keyboard editing, Tab commit and readback before confirmation.

The corrected native sample saved exactly94 UTF-16 units. Explicit paste saved the original1209-unit/37-line sample exactly, including Urdu, Persian joiner and emoji, with clipboard_restored:true. Actual wheel scrolling changed the visible document; the actual displayed custom insertion cursor was captured using this project's GetCursorInfo probe. The misplaced generated failure file was preserved in private evidence and its original test location cleaned. No personal document was used.

The AI workflow predates the final keyboard/paste correction; the text/file-dialog witnesses exercise that correction. Runtime files and the qualified native helper are bound by the release manifest. GitHub Actions checks each source commit; native interactive and hardware checks remain local and separately scoped.

## Not qualified

Physical mixed-DPI/multiple displays, complete script/IME/accessibility behavior, long recovery soak, all Upscaly models/face/ROI/video/cache workflows, secure/elevated desktops and macOS/Linux. Binaries are unsigned. Standalone human approval and host Ask/Deny have earlier records, not a new test of the host's global security engine. Host-managed mode never claims an authenticated Turbo value.

See [repeatable qualification procedures](docs/qualification.md) and [historical records](docs/history/VALIDATION.md). The old Python draft's 55 tests do not apply.


## 24 October: real host isolation and companion qualification

- Actual Agent Manager terminal desktop was exebox, distinct from Default input desktop. Detached start lifetime and foreground hidden-app failures are retained. Native preflight now refuses this context before app actions; no sandbox escape or security-setting change.
- Desktop-context2 build be7d765c2e7ba9b0aea65b8e551e609159480f2c722605092183cdafa613bde8, native5e55146303a00d0d2d04a0b7888999fb809303462e1360f45bc47dccf83d2c9a, installed both global/project scopes. Actual negative host refusal and normal end/shutdown passed. Source109 checks and GitHub CI passed.
- With the local runtime started on the normal desktop, a fresh No Project /computer-use task completed actual Upscaly import, AI PNG1920x1320, settings restoration, owned-window close and idle/empty-grants cleanup. Independent NCNN/file/database verification passed. About5min wall time means orchestration latency remains open. Same-service Notepad follow-up is in progress, not yet acceptance.
- Next source candidate adds opt-in official App Sidecars and persistent passive listener with idle control release, preserving Pause/Stop. Managed startup and final-artifact qualification remain pending. Public release stays draft.


## Direct-controller ownership qualification (24 October)

Two independent inert server processes reproduced simultaneous ownership of one data folder. The candidate now claims a Windows kernel mutex through the existing prebuilt storage helper before creating the runtime. Ownership uses the user and physical directory identity, covers path-case aliases, and retains a directory handle that prevents replacement while held. There is no stale lock-file deletion. Capability publication is atomic; a live legacy controller is respected. Ownership-helper loss stops control and rejects further input, with normal cleanup and human Stop rules preserved. Microsoft documents [kernel namespaces](https://learn.microsoft.com/en-us/windows/win32/termserv/kernel-object-namespaces) and [Mutex synchronization](https://learn.microsoft.com/en-us/dotnet/api/system.threading.mutex).

All123 local checks pass, including six real Windows ownership/failure tests with inert runtimes. They send no desktop input and do not replace real App qualification. The latest installed named-batch2 build separately completed actual AI JPEG1920x1320 through Antigravity in235796ms with17controllercalls; independently decoded bytes, DB publication and native NCNN21414ms were verified. Its executed no-file --step command was inspected in the actual host tool record. Native input helper bytes are unchanged; the new ownership/storage helper still needs final packaged App checks.

Use one active desktop task at a time. The shared local companion serializes commands and protects its own startup; it does not provide independent desktop isolation for simultaneous conversations or virtual desktops. Do not mix the optional legacy adapter with direct control.


## Window reachability candidate

The reported partially offscreen window placement is handled by explicit `fit_window`, scoped to the approved app identity. It restores normal placement and fits the nearest display work area, preserves valid negative origins, clears earlier frames and reports actual applied bounds/minimum-size limits. It does not switch virtual desktops or change display settings. Physical move/click/scroll endpoints are checked before pointer travel; drag validates both endpoints before holding a button. Display gaps return `point_off_desktop` with recovery guidance.

All126 source checks pass. A manual native component test moved an owned window from[525,-787,473,1053] to[525,0,473,1053] within1920x1080, refused an unreachable move/drag without cursor movement or mouse-down, invalidated pre-fit frames and invoked the fresh control once. The exact native helper also passed the provider-exception no-replay regression. Initial hidden-fixture discovery and shared-hotkey refusals are retained; exclusive visible-fixture retries passed. These component results do not replace actual application or hardware acceptance. Physical mixed-DPI/multiple-display testing remains open.
