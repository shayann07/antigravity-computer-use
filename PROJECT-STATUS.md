# Current qualification status — 1 November 2026

Windows beta.4 is published and installed globally from verified GitHub bytes.
PR #31 is merged; the real stable Upscaly PNG/JPEG tasks have decoded outputs,
native process witnesses, restored settings and clean End. Speed remains open,
as do updater timeout #32, overlay overlap #33 and current physical/Mac gates.
Read [the current qualification record](docs/WINDOWS-BETA4-QUALIFICATION.md).
The entries below are historical, with their original evidence boundaries.

## Final Intel Mac Space/capture & Liquid Glass HUD qualification — 30 October 2026

Branch `codex/argon-final-mac` (from `v0.3.0-beta.3`, `b33940c`) repairs macOS
Chrome and Space window capture (`_AXUIElementGetWindow` direct `CGWindowID`
binding, browser/profile title suffix matching, off-Space `WindowRegistry`
retention, retired-handle `identity_changed` detection, and 5-state
deterministic failure classification with bounded recovery), upgrades the macOS
control bar to Apple's native `NSGlassEffectView` with pure filled Phosphor
Icons (no status dot, no strokes, high-contrast emergency crimson tint), and
adds `priorMacCleanupVerified` for recovered macOS tasks. Live Chrome normal
Space, minimized, hidden, full-screen, other-Space, twin-window and closed-handle
checks passed on Intel macOS 26.6.2 (receipts `34634.4`–`34634.24`; see
[docs/MACOS-QUALIFICATION.md](docs/MACOS-QUALIFICATION.md)).

## Mac covering-window repair integrated — 30 October 2026

Mac PR #27’s covering-window repair and PR #28’s standalone file-dialog repair
are integrated at `d4c8903`/`0fc1dd3`. The Intel Mac report records real
permissions, animated pointer actions, Unicode byte/code-point matching,
physical Stop persistence, human re-arm and a second Calculator task. The
shared local suite remains green at 446 total, 435 passed, 0 failed, 11
explicit ACL skips; provenance verifies 175/175 recorded files. Remaining Mac
gates are external-display/sleep/permission-revocation checks, production
signing, Gatekeeper and published-update transport.

The maintainer-only signed candidate workflow [41031566735](https://github.com/shayann07/antigravity-computer-use/actions/runs/41031566735)
also passed on this exact head. It produced verified Windows x64, macOS ARM64
and macOS Intel payloads using sequence `41030254030`; Windows recorded the
project-ancestor ACL limitation and both Mac native signed-bundle checks passed.
The candidate is retained privately and has not been published or installed
over the user's current Windows build.

Windows physical Stop qualification now passes on the installed `b8d1ad5…`
build. Antigravity recorded a real held Notepad drag interrupted by physical
Esc, persisted Stop, cleaned the held-input ledger, skipped queued actions,
refused a post-Stop snapshot and rejected software resume. The human then
re-armed locally; receipt `5944.430` verified a second Notepad task and
`5944.431` ended cleanly at idle without restarting Antigravity.

The same installed build also completed a fresh stable Upscaly 1.0.9 run after
recovering from a genuine GPU OOM at AUTO tile. Selecting the RTX 3050 and
256px tile produced verified native-AI PNG and JPG outputs at 2800×4496; both
were independently hashed and the app reported completion. The PNG has a
native `realesrgan-ncnn-vulkan` witness; the JPG process witness remains
pending. Evidence is retained under `.localdata/current-upscaly-20261030/`.

## Candidate installation and Antigravity smoke — 30 October 2026

Candidate source `89b355e` is installed at `D:\AntigravityComputerUse-ed035f9812`
with build `9966ffaeb573294af5133921035cb2fa848c77f445cacf3f726a5702eef517fd`
(`0.3.0-beta.3`). The supported installer preserved the existing direct
host-managed/manual policy, sidecar and configuration backups; verification
passed for 109 files and the skill pointer.

A real Antigravity `/computer-use` Notepad smoke task passed through the direct
skill on the earlier `89b355e` installation: readiness, discovery, launch,
fresh observation, click, typing and End. Independent desktop observation
confirmed the requested text. No fallback was used. This is historical evidence
and is superseded by the later `1960190` Stop-marker installation. The
Antigravity conversation card remained visually stuck on its last tool while the
controller was already idle; this host presentation-lag issue is pending a
separate fix.

The same installed candidate subsequently completed a real stable Upscaly PNG
workflow through Antigravity. Native Vulkan Real-ESRGAN `realesr-general-x4v3`
ran on GPU 1 at 4× with no software fallback. The decoded output was 2800×4496
RGB, 14,171,211 bytes, SHA-256
`f846a3934a00d603a7fcf0b840d70f63ced0621148acdbd0ced2170710de05a4`; completion
UI and split view were verified, settings restored, and control ended idle. The
engine took 4.53 seconds and the full launch-to-End session took 2 minutes 22.5
seconds. JPEG, matched model speed, physical safety and updater qualification
remain pending.

The Stop-marker candidate from source `1960190` is now installed as build
`b8d1ad546cdedcb77555efef3e22093dc8d6bc406ef715d561c97e0d6a913f31`; install
verification passes for 109 files, the service is idle with no task or grants,
and the automatic beta update policy is preserved. Its new durable Stop behavior
still needs one real desktop task plus physical re-arm qualification.

**Incomplete; development candidate only.** The review branch integrates Mac
PR #5 with additional marker protection. Windows CI passed at `fc2b9ac`; Mac
checks and exact-head checks for later commits must be inspected independently.
The published release/bootstrap remain beta.2. See the
[qualification matrix](docs/RELIABILITY-IMPLEMENTATION.md) and
[Mac evidence boundaries](docs/MACOS-QUALIFICATION.md).

The installed global and Upscaly project-local Windows build `22e47b7c1236c2d4052f579e307e7e327c7584ddf333b7c2a5ae0ff9336c44b8`
was built from `36bef786d8b73b5479141867512cb186c93a7c3d` and verified its
108 files and skill on 29 October. Its passive service reported idle,
host-managed, with zero approved apps. The supported local upgrade confirmed
cleanup and preserved settings and project pins; Stop was not latched during
this upgrade. It was not a signed automatic-update acceptance run. Real model
and application acceptance on this build is pending. A project-launcher smoke
test opened stable Upscaly, physically clicked Settings, visually verified the
panel, closed it and ended control. This is not a full Antigravity model workflow.

Real Sonnet and Flash Notepad tasks saved matching Unicode on the prior installed
build `bc457343...`, and a physical Esc during a held drag released input and
skipped the queued action on that prior build.
See [performance](docs/PERFORMANCE.md) and [validation](VALIDATION.md) for
measurements and limitations. Remaining acceptance includes affected-PC and fresh
installation recovery, matched Upscaly performance, held-key and multi-display
checks, Mac physical/device qualification, native Windows automatic-update tests,
and published/downloaded/installed identity verification. Source/CI success does
not complete these requirements. Issues #2 and #3 remain open.

# Historical shared macOS adapter checkpoint — 29 October 2026

Development branch: `codex/macos-and-latency-review`. The macOS adapter uses the
existing shared Node runtime, observations, batches, limits, tool vocabulary,
installer, rollback and global skill. Native AX/ScreenCaptureKit/CGEvent/AppKit
implementations supply OS calls and enforce local consent and independent Stop.
Windows now also reads common policy/visual tokens from `control-contract.json`.

Apple Silicon and Intel compilation passed at `7dc7a54`; native storage/lease
checks passed, while a shared test fixture failed because it populated an
unqualified data directory. The fixture was repaired without changing the guard.
Candidate `787ddb1` and the subsequent native-fence candidate `6c48fb7` passed
the full matrix, including installation, passive start, End, persistent Stop,
restart, update and rollback. Further cleanup/identity changes are checked at
their own head. The local Windows suite at `e0533a9` passed 154 tests, zero failed,
with five ACL and two Mac-only skips. Skips are not qualification passes;
interactive Mac acceptance, including actual Antigravity tasks, is **unrun**.
See [Mac qualification](docs/MACOS.md) and the exact-head CI. This branch is not a
published release, a Windows installation update, or proof of performance parity.
The separate Antigravity latency worktree remains untouched.

# Automatic-startup repair — recorded 28 October 2026

On 27 October, enabled the existing Computer Use Sidecar at the owner's request. Antigravity automatically started the published beta.2 build `23ddd7bdfc2f2c19060308c441ef7fef43d700ccfdccaa88b76bb488105d2777`, without a manual launcher or App restart. Both installed scopes passed 75-file payload checks. Passive startup created no guardian; native read-only discovery passed, End left no grants, and emergency Stop remained latched. Unrelated settings were preserved. The enabled setting was rechecked on 28 October; no new runtime build, desktop input or full AI qualification was performed. See [HANDOFF.md](HANDOFF.md).

# Startup control-bar fix — 26 October 2026

26 October 2026 startup bar repair: v0.3.0-beta.2. Passive startup/status/End/shutdown do not start the guardian; native startup is hidden; End hides controls; Stop dismisses after8seconds; explicit controls reveals human re-arm without clearing Stop. Actual native visibility regression passed for idle and latched startup, active/End, capture cleanup, dismissal and refused activation while stopped. Source139pass/0fail/5ACLskips. The changed helper requires fresh real-app and physical/hardware qualification; earlier AI speed figures remain historical. General orchestration latency is still unfinished.

# Current Windows beta qualification — 24 October 2026

The direct Windows runtime is installed and exercised in the real Antigravity App. The Windows beta is published as a prerelease with its remaining limitations documented in [HANDOFF.md](HANDOFF.md); this is not a claim of vendor parity or completed speed qualification.

- Exact tested controller: `de4708498a561ebaddd55ec60ea606df14d11bd43a907084ebf84a66783542cd`; native helper: `5e2cbf2060ee228006234dd90fb0832adaed6dc8f63c9bd80e1c08863088aa1a`.
- Actual fresh No Project `/computer-use` tasks produced native-AI PNG and JPEG1920×1320 outputs, restored settings, closed their owned app and ended normally. File signatures/pixels, database publication and native engine completion were checked independently. No software fallback or automatic replay.
- PNG:269280ms /15controller calls /11893service-ms; JPEG:272954ms /15calls /15937service-ms. Model:Gemini3.8FlashHigh, Turbo preserved. The earlier successful High PNG witness was326493ms /25calls. The earlier JPEG witness was235796ms, so general speed improvement is not established. Application GPU-profile/a11y fixes are another comparison variable.
- Local and Windows CI:137passed, zero failures,5explicit ACL qualification skips because the checkout has replaceable ancestors. No parent permission changes. The unsafe-ancestor refusal test passed.
- Exact global/project pins and unrelated host configuration were checked. The runtime uses a supported global skill and App Sidecar, without MCP or a separate model.
- The owner reported physical Esc/re-arm; installed status recorded `human_resume`, idle, empty grants and cursor off. Live queued/held-input interruption on this exact helper remains unqualified; the timed-out queue checks were not passes. Real mixed-DPI/multiple-display hardware, wider application coverage and remaining cursor/glow feedback remain unqualified.

Detailed local evidence is intentionally ignored under `.localdata/speed-resume-20261024/`; public source CI and [performance guidance](docs/PERFORMANCE.md) remain reviewable. Earlier snapshots below are historical and may describe superseded pending work.

---

# Windows 0.3.0-beta.1 qualification

Updated 24 October 2026 (Asia/Karachi). This is a Windows beta, not a claim of vendor parity or complete application qualification.

**Release remains draft.** The latest exact-build Agent Manager run was cancelled after about8minutes near import: excessive orchestration latency, not an acceptance pass. The source speed candidate passes 88 tests. Installed speed1 build8d9d8082 completed real Upscaly batched import and exact1319-unit Notepad save with pause/resume/stale-frame refusal. Later source hardening replaces the temporary command-shell launcher with a literal-argv Node entrypoint, isolates project launchers and refuses live-service installation. Its refreshed packaging and actual Agent Manager comparison remain pending; the stock host-control API could not restore minimized Antigravity, so human restoration is deferred. See [performance qualification](docs/PERFORMANCE.md).

## Implemented

The later native audit reproduced automatic physical replay after a provider exception. Candidate2abe67e5/nativea2fd1fbc now preserves unknown delivery without an alternate click/Enter; the owned provider regression fails olda2 and passes the candidate.92 local tests pass, with prior88-check sourcece9 green on GitHub. New ordinary-app native qualification, installation and host speed acceptance are still pending; installed speed1 and project0a8 are not yet this repair.

- Direct global/project /computer-use skill using Antigravity's existing model, a local Node service and prebuilt C# helper. MCP is optional compatibility only.
- Screenshots and scoped accessibility references; real smooth cursor travel, clicks, typing, shortcuts, scrolling, drag and owned dialogs.
- Fixed deployment permission authority, process/window identity checks, stale/one-use observation rejection, cancellation and independent automation-owned input cleanup.
- Keep working by default; optional Yield on input. Soft resume requires fresh observation. Esc/Stop persists across service replacement and needs local human re-arm.
- Minimal graphite controls, soft breathing ice-blue edge glow, original pointer artwork and a distinct insertion cursor. Independent cursor restoration on pause/end/crash.
- Portable Node/native installation, configuration backups and rollback. Bundle integrity is checked before installation writes. Existing unrelated host settings remain intact.

## Evidence

69 automated checks; 12 native-host, 13 host-managed component workflow, 8 cursor/restoration/crash, 5 guardian checks and parent-death recovery. Visual primitives inspected at 100%, 125% and 200%. These component checks do not substitute for real-app testing.

Actual Agent Manager selected the global skill, opened real JPEGs with its image tool and completed a real Ultra AI export, soft pause/resume and another session without host restart. Dev7 was also used in a real editor/emulator for rich clipboard, image, undo/redo, rotation, larger-font layout and emoji input.

Beta qualification used the custom controller on actual Upscaly and Notepad. Real NCNN PNG/JPEG exports decoded at 1920x1320; in-flight cancellation aborted publication and left no child process. Actual divider drag, wheel scroll, deliberate Pause/refusal/Resume and old-frame rejection passed. Notepad reproduced a child-window focus refusal, packet loss and a save-dialog false readback. The fixes use parent-root validation, paced short typing, explicit clipboard-preserving paste and committed/verified filenames. Saved 94-unit native and 1209-unit/37-line bulk samples matched exactly; the live custom insertion cursor was captured. Failure artifacts remain private and intact.

The owner physically performed Esc and both local re-arms on dev7. Its held-drag test released the owned button and skipped seven queued actions. One final test cleanup argument was wrong; it was corrected and cleanup recovered separately, with the original failure retained.

## Remaining limits

- Physical mixed-DPI/multi-display hardware, secure desktop and elevated apps are not qualified. Coordinate simulations are not hardware coverage.
- macOS/Linux are not release targets. UAC, authentication and Windows security surfaces require human handoff.
- Broader Upscaly face/ROI/video/cache/model matrices and recovery soak are separate application work. Image exports do not qualify those features.
- Aesthetic acceptance is subjective. The preview uses the actual renderer on a fictional desktop; it is not a screenshot of an autonomous task.
- This unsigned beta relies on the current user's privileges. Host-managed mode cannot inspect/prove Turbo; broad terminal permission grants broad desktop authority.

See [validation](VALIDATION.md), [installation](docs/INSTALLATION.md), and [historical checkpoints](docs/history/PROJECT-STATUS.md). Exact installed identity comes from status and bundle-manifest.json. Private evidence remains excluded from Git.


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
