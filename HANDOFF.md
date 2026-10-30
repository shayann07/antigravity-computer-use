# Antigravity Computer Use: handoff

## 30 October final Intel Mac Space/capture & Liquid Glass HUD repair

Branch `codex/argon-final-mac` (based on `v0.3.0-beta.3` commit
`b33940cb65fb764e04922b9d600b0747ac076f2b`) reproduces and repairs the macOS
window capture failure on Google Chrome and Mission Control Spaces:

- Direct `_AXUIElementGetWindow` -> `CGWindowID` matching and browser/document
  title suffix matching (`"<Tab> - Google Chrome - <Profile>"` vs CoreGraphics
  `kCGWindowName`), twin-window disambiguation, off-Space `WindowRegistry`
  retention (`other_desktop: true`), and retired handle `identity_changed`
  refusal.
- Deterministic 5-state window disposition classification (`other_desktop`,
  `window_fullscreen`, `window_minimized` / `window_hidden`, `identity_changed`,
  `mac_permissions_required`) with one bounded recovery attempt before refusing
  repeated polling (`repeated_failure: true`, `recovery_attempts_remaining: 0`).
- Native `NSGlassEffectView` Liquid Glass HUD on macOS 26+ (`NSVisualEffectView`
  fallback on macOS 14/15) with pure filled Phosphor Icons, no status dot, no
  strokes, high-contrast crimson emergency tint (`Stopped · Re-arm required`),
  reduced-motion support, and keyboard accessibility.
- `priorMacCleanupVerified` so `end` closes a recovered macOS task after prior
  parent, worker and watchdog PIDs exit and the JSON `.inputs` ledger is empty.

See [docs/MACOS-QUALIFICATION.md](docs/MACOS-QUALIFICATION.md) for live
qualification receipts (`34634.4`–`34634.24`) and remaining human/hardware gates.

## 30 October release-candidate installation checkpoint

Candidate source `89b355e` was installed through the supported installer on the
Windows machine at `D:\AntigravityComputerUse-ed035f9812`. The exact installed
build is `9966ffaeb573294af5133921035cb2fa848c77f445cacf3f726a5702eef517fd`,
version `0.3.0-beta.3`, with the existing direct host-managed/manual policy and
sidecar configuration preserved. `verify-install.mjs` passed for 109 files and
the skill pointer matched.

An actual Antigravity `/computer-use` smoke task then used that installation:
`ready`, app discovery, Notepad launch, fresh snapshot, click, text entry,
verification and `computer_end` all returned successful receipts. Independent
desktop inspection showed the exact text `AGCU candidate 89b355e real task`.
The task used the direct skill and no fallback; receipts are retained in the
private `.localdata/antigravity-smoke-20261030.json` record and the installed
receipt journal. Antigravity's conversation view remained on a stale running
tool card after the controller had returned idle, so host/model presentation
completion is recorded as a defect boundary rather than a clean host pass.

This was a real smoke qualification of the earlier `89b355e` installation. It
is historical evidence only; it is superseded by the later `1960190` Stop-marker
installation below and does not qualify that newer build, physical Stop/re-arm,
Upscaly AI, or release approval.

The Stop-marker candidate from source `1960190` is now installed through the
supported installer. Exact installed build is
`b8d1ad546cdedcb77555efef3e22093dc8d6bc406ef715d561c97e0d6a913f31`; verification
passes for 109 files and the skill pointer. The service reports idle, no open
task, no grants, host-managed/manual policy, and automatic beta updates. The
previous installation remains in the printed rollback backup. No real desktop
task has been run on this new Stop-marker build yet.

## Real Antigravity Upscaly qualification — 30 October 2026

The installed candidate also completed the real stable Upscaly workflow through
Antigravity `/computer-use`. It launched the stable `upscaly.exe`, waited for
GPU/main UI readiness, changed the output directory, selected General Real-World
`realesr-general-x4v3`, imported the requested portrait through the native file
dialog, clicked Upscale, verified the completion UI and split view, closed only
the owned app and ended control.

The native Vulkan witness invoked `realesrgan-ncnn-vulkan.exe` with `-g 1`,
`-s 4`, model `realesr-general-x4v3`, and no CPU/software fallback. The decoded
PNG is 2800×4496 RGB, 14,171,211 bytes, SHA-256
`f846a3934a00d603a7fcf0b840d70f63ced0621148acdbd0ced2170710de05a4`. The AI
engine wrote the output in 4.53 seconds; the Upscale-to-completion observation
took 21.65 seconds and the launch-to-End session took 2 minutes 22.5 seconds.
Original settings were restored and the controller ended idle with no grants.

This qualifies one real PNG workflow on the installed Windows candidate. It does
not qualify JPEG, matched Flash/Sonnet speed, physical Stop/re-arm, mixed DPI or
the signed updater.

Updated **30 October 2026**, Asia/Karachi. Published track: **v0.3.0-beta.2**,
Windows x64 prerelease. Development work is on `codex/review-intel-mac`;
the current reviewed head is `793da95` (Mac covering-window repair from PR #27
plus signed-candidate documentation).
Check its current commit and CI before using any checkpoint below.

## Current reliability and Mac qualification handoff

Read [the current implementation matrix](docs/RELIABILITY-IMPLEMENTATION.md)
before the historical entries below. Source checkpoint `99599da` passed Windows
CI and both Mac architecture jobs. The Mac update/rollback check uses a test
signing key and substituted transport; the Windows native updater qualification
remains an explicit unsafe-ancestor skip, not a pass.

Recent repairs include native ambiguous-target/Unicode risk parity, bounded
invisible-control failures, explicit human-launcher recovery, and unknown-delivery
advice with absolute IPC deadlines. The human launcher now performs passive
`start` then `controls`; agent `ready` remains bounded. Showing controls never
clears Stop. No current interactive desktop acceptance follows from these checks.

The installed global and Upscaly project-local scopes were upgraded to beta.3
build `22e47b7c1236c2d4052f579e307e7e327c7584ddf333b7c2a5ae0ff9336c44b8`,
from source `36bef786d8b73b5479141867512cb186c93a7c3d`. The project scope remains
pinned; the running service most recently reported that build idle with no app
grants. This installed build predates `99599da` and is not the published beta.2.
Keep deployment/version pins and the published bootstrap unchanged until the
applicable acceptance gates pass. Verify identities again before any live work.

Outstanding: affected-PC recovery ([issue #3](https://github.com/shayann07/antigravity-computer-use/issues/3)),
actual affected-PC/fresh-install tasks and matched Flash/Sonnet Upscaly speed
([issue #2](https://github.com/shayann07/antigravity-computer-use/issues/2)),
Windows human re-arm and second task, Mac external-display/sleep/permission
checks, native Windows update/OS permission qualification, interruption and
published-release transport.
An earlier Flash trial took 605,626 ms, used 21 calls and failed exact Unicode;
later matched Notepad trials passed the Unicode comparison but did not qualify
the full Upscaly workflow. See `docs/PERFORMANCE.md` for both results.

Intel Mac qualification and the covering-window repair are now represented by
PR #28 and integrated at `d4c8903` with provenance follow-up `0fc1dd3`. The
Mac report records discovery, permissions, animated pointer actions, Unicode
save/reopen verification, physical Stop persistence, human re-arm and a second
Calculator task. The standalone Open/Save panel repair is included. Remaining
Mac limits are external mixed-DPI displays, sleep/wake, permission revocation,
production signing and Gatekeeper/update transport; see
[Mac qualification](docs/MACOS-QUALIFICATION.md). The Windows installation is
still the earlier Stop-marker build and is not claimed equivalent to this new
source head. Preserve human-only checks and use
[the Mac-agent handoff](docs/MAC-QUALIFICATION-PROMPT.md) for any refreshed
device run. Keep the goal open until the remaining acceptance and release gates
are verified.

## Signed candidate checkpoint — 30 October 2026

Maintainer-only workflow [41031566735](https://github.com/shayann07/antigravity-computer-use/actions/runs/41031566735)
ran on exact head `00e9cbc` with sequence `41030254030`. Windows x64, macOS
ARM64 and macOS Intel signed payloads were generated and independently verified;
the Windows job recorded the project-ancestor ACL limitation, while both Mac
native signed-bundle checks passed. Downloaded artifacts were checked against
the public trust root: 108 Windows payloads and 111 payloads per Mac
architecture. This is a signed candidate only. It is not a published release,
does not establish Gatekeeper/notarization, and has not replaced the user's
installed Windows build.

## Windows physical Stop qualification — 30 October 2026

Antigravity qualified the installed Stop-marker build
`b8d1ad546cdedcb77555efef3e22093dc8d6bc406ef715d561c97e0d6a913f31` through a
real Notepad held-drag task. The operator physically pressed Esc while the
mouse button was held. Receipt `5944.101` and the private record
`.localdata/physical-stop-qualified-20261030.json` establish `state: stopped`,
`control_reason: escape`, a persisted `emergency.stop` marker, a clean native
held-input ledger, three skipped queued actions, a refused post-Stop snapshot,
and `human_resume_required` with `replay_allowed: false`. This clears the
physical Stop/cleanup boundary for that installed build. The human then clicked
Re-arm (`control_reason: human_resume`); receipt `5944.430` verified a second
Notepad task, and `5944.431` ended cleanly at idle without restarting
Antigravity. The Windows Stop/re-arm/second-task gate is passed for this
installed build.

## Mac permission-mode repair — 30 October 2026

Commit `e7793fd` makes supported `--sidecar` installations default to
`host-managed` permission mode unless an existing deployment explicitly chose a
mode. This lets Antigravity’s Turbo/host permission policy authorize ordinary
Mac actions without repeated standalone native approval modals. Emergency Stop,
physical Esc, the native HUD latch and human-only re-arm remain independent of
that permission mode. The Mac agent verified TextEdit and Calculator in
host-managed mode with no repeated permission popups.

## Current Windows Upscaly qualification — 30 October 2026

The installed Stop-marker build `b8d1ad5…` ran the stable Upscaly 1.0.9
executable against the requested portrait through the native controller. The
first genuine AI attempt failed closed when the app reported GPU out-of-memory
at AUTO tile; no output was accepted. The controller then selected the NVIDIA
RTX 3050 and a bounded 256px tile, reran the same native RealESRGAN Ultra 4×
job, and verified both formats in the app:

- PNG: 2800×4496 RGB, SHA-256
  `f846a3934a00d603a7fcf0b840d70f63ced0621148acdbd0ced2170710de05a4`.
- JPG: 2800×4496 RGB, SHA-256
  `7c9724e61e8808f17ab3752b1bf957ab385264769569fd65a614115ce19daff6`.

The PNG engine witness recorded `realesrgan-ncnn-vulkan.exe` with GPU `-g 1`
and scale `-s 4`; the JPG retry was visually completed with the same selected
GPU/tile settings, but its separate process witness was not captured. Evidence
is under `.localdata/current-upscaly-20261030/`; the owned app was closed and
the controller ended idle without restarting Antigravity.

## Historical checkpoints

## 28 October stable Upscaly demo and remaining problems

Latest correction: the public recording now uses a different owner-authorized
portrait, full-screen capture and normal-speed actions. It includes the actual
glow, working chip, native pointer movement and comparison drag. The fresh
2800×4496 PNG fully decoded; an independent observer recorded the native NCNN
process during this export. Exact evidence and edit ranges are in
[UPSCALY-DEMO.md](docs/media/UPSCALY-DEMO.md). The earlier excerpt below was
rejected because its crop and capture exclusion hid the controls.

Source commit `7815cc2` added a local menu option to include the native visuals in
recordings while still hiding them from agent observations. Native exclusion and
inclusion checks passed; the source suite had148 passes and5 explicit ACL skips.
The installed recording candidate `eec4740…` is ahead of published beta.2
`23ddd7…`. Do not claim installed/published manifest equivalence. Recording
inclusion was disabled again after End; the passive listener remains available.
The clean task also exposed a real app edge case: clicking Upscale on an already
Done queue item did not generate another output. Antigravity recovered by
re-importing the sample. Initial ineffective attempts and host gaps remain in
private evidence; the clip is not proof that latency is solved.

- Antigravity used the installed beta.2 direct controller with the verified
  Upscaly 1.0.9 stable executable and the owner's requested sample image. It
  reported General Real-World native AI, 4× and a completed PNG. Independent
  decoding confirmed a 2944×5232 PNG and SHA-256
  `1c805486a807098718f33030c38f3963b772d9623e769fb67eea7bf2ffe33a11`.
  Engine process execution has not yet been independently verified; the agent's
  report and a difference from Lanczos do not alone prove the backend used.
- The actual task took about 14 minutes. Receipts contain a 251-second gap,
  stale observations and two `element_stale` failures. Investigate host/tool
  latency, stale accessibility references and error recovery without replaying
  uncertain input. A second output exists; determine its provenance before using it.
- The first window-only recording was 900 seconds of near-black frames. A second
  aborted capture is incomplete. Neither is acceptable as a real demo. A new
  desktop retake captured the real import and completed app view. Its cropped,
  accelerated excerpt and limitations are documented in
  [the recording notes](docs/media/UPSCALY-DEMO.md); raw desktop footage remains
  private under `.localdata`. Frame inspection must be repeated if it is re-edited.
- Stable app UI did not offer 2× or a 64-pixel tile for that selected model;
  the observed task used 4× and AUTO. Restore and independently check settings.
- Source installer tests and GitHub CI passed, but fresh installation ACL
  qualification was refused under replaceable ancestors. Those five skips do not
  qualify native fresh installation. Existing-install idempotence was checked.

## 28 October repository presentation and branch cleanup

Compared the public LiquidGlass and ComposeDoc repositories, then rewrote this
README around the product, real labelled demo, install path and capabilities.
Added original SVG branding, live CI/release/license badges, repository topics,
a searchable About description and a download homepage. Corrected the installation
guide's obsolete draft/pending wording. The current speed and beta.2 qualification
limits remain explicit; presentation changes are not new runtime acceptance.

Retired six historical work branches after ancestry/open-PR checks. Five were
ancestors of `main`; the README-only unique draft is preserved under
`archive/readme-draft-20261028`. [Branch policy and exact commits](docs/BRANCHES.md).
The published Windows bundle and installed runtime were not changed by this cleanup.

## 27 October automatic-startup repair

The installed Sidecar had remained disabled after the startup-bar fix, so
Antigravity asked the owner to run the manual launcher. At the owner's request,
only this project's Sidecar entry was enabled; unrelated configuration was
verified unchanged. Antigravity's `language_server.exe` then started the pinned
beta.2 service automatically, without a manual launch or whole-App restart.

Recorded qualification on 27 October: the exact installed build was
`23ddd7bdfc2f2c19060308c441ef7fef43d700ccfdccaa88b76bb488105d2777` in
both global and Upscaly scopes, with all 75 sealed payload files checked in each.
The automatic passive startup created no guardian window/process. Read-only
native app discovery passed the visible-desktop preflight, returned three
windows, and End left no app grants. Emergency Stop remained latched; no physical
input or re-arm was sent. The passive listener was left available. The enabled
Sidecar setting was checked again on 28 October; the running service was not
retested in that documentation-only check.

This was a local configuration repair using the existing published beta.2 code,
not a new runtime build or full AI-workflow qualification. Private evidence is
retained under `.localdata/autostart-repair-20261027/`; do not publish the raw
host configuration. Silent background availability and human-only emergency
re-arm are separate: a saved Stop still needs the human even though the service
starts automatically. Remaining speed and hardware qualifications stay open.

## 26 October startup control-bar fix

The owner reported the stopped bar appearing on ordinary Antigravity startup,
despite not invoking computer use. Reproduced cause: passive service preparation
started the guardian whenever an old emergency latch existed; the native form
also showed itself at startup and never dismissed its stopped state.

The fix keeps passive startup, status, End and shutdown free of guardian startup.
The native guardian starts hidden, shows controls during an active/paused task,
and hides them at End. Stopped controls dismiss after eight seconds; the stopped
button and menu can dismiss them sooner. `controls` explicitly reveals controls
for human re-arm for30seconds, without changing state, grants or the latch.
Blocked grant/snapshot/launch requests reveal controls but refuse input until
the human re-arms. Late screenshot completion cannot resurrect a hidden bar.

`tests/guardian-visibility.mjs` exercises actual native visibility in both idle
and persisted-Stop startup, explicit reveal, active/End, capture cleanup,
dismissal, refused activation while stopped and automatic Stop dismissal.
It sends no target-app clicks/keys and does not qualify physical Stop. The new
helper changes the native binary: the older real Upscaly/physical evidence below
remains evidence for that older helper, not an automatic pass for this revision.
Source tests: **139 passed, 0 failed, 5 explicit ACL skips**.

The continuation prompt is [docs/CLAUDE-CODE-HANDOFF-PROMPT.md](docs/CLAUDE-CODE-HANDOFF-PROMPT.md).
Remaining speed/hardware/physical queued-input work below is still open.

## Read this first

The native desktop workflow works in the actual Antigravity Agent Manager App.
Real Upscaly AI PNG and JPEG exports passed, including independent file, database
and native-engine verification. **Overall latency is not fully solved**: the
tested Gemini 3.8 Flash High workflow still takes about four and a half minutes.
Do not describe this as finished vendor parity or complete hardware qualification.

This handoff records both completed work and remaining debt. Publishing the beta
does not turn skipped or incomplete checks into passes. The release page and its
manifest/checksums are authoritative for the published asset identity:

- [Controller repository](https://github.com/shayann07/antigravity-computer-use)
- [Windows beta and downloads](https://github.com/shayann07/antigravity-computer-use/releases/tag/v0.3.0-beta.2)
- [Installation](README.md#install-on-windows), [security](SECURITY.md),
  [validation history](VALIDATION.md), [performance](docs/PERFORMANCE.md)

## Current status

| Area | Status and limits |
| --- | --- |
| Invocation | Global `/computer-use` skill in Antigravity App; project-local installation is supported. App 2.26 was exercised. Do not substitute IDE-only assumptions. |
| Runtime | One Node/C# Windows implementation. The direct skill uses private local IPC and the App's Sidecar lifecycle. No MCP, extra model, model subscription or browser extension is required. The optional legacy MCP adapter is retained for compatibility. |
| Desktop operations | Screenshots, accessibility inspection/actions, real cursor input, typing/paste, scrolling, dragging, shortcuts, native file dialogs, app/window management and bounded sequential batches are implemented. |
| Observation safety | One-use frames bind native snapshots to app identity and worker epoch. Exact name/role/automation-ID selectors resolve inside the observed snapshot; missing or ambiguous targets refuse. Pixels require an actual screenshot and centrally mapped coordinates. |
| Control | Manual/Keep working is the default; incidental human movement does not pause. Optional Smart takeover yields on input. Esc, Ctrl+Alt+F12 and Stop use an independent guardian. Emergency re-arm is local human-only. |
| Permissions | Standalone mode uses native approval dialogs. Operator-selected host-managed mode relies on host execution permissions. It does not inspect or authenticate the Turbo preset. Model approval flags cannot grant permission. |
| Interface | Minimal control bar, breathing edge glow, custom arrow/text cursor, eased pointer travel and input restoration exist. Final visual feedback is still open; semantic actions can execute without pointer travel. |
| Installation | Portable Node and prebuilt helpers, per-user protected installation, immutable release pins, global/project scopes, preserved configuration and rollback backups are implemented. Normal bundle installation needs no compiler or Python. |
| Tests | Beta2 source checks: **139 passed, 0 failed, 5 skipped**. The five installation-ACL cases are refused under replaceable checkout ancestors. Those skips are not ACL qualification passes. Provenance and native compilation checks passed. |
| Stop handoff | Owner reported physical Esc/Stopped/re-arm complete. Installed status subsequently showed `idle`, `control_reason: human_resume`, empty grants and cursor overlay off. The instrumented queued-wait attempts timed out before physical input; live queued/held-input interruption on the final helper remains separately unqualified. |
| Scheduling | The owner deleted the overnight automation and cleared the goal. Both were confirmed. **Do not recreate or resume recurring work without a new request.** The passive installed Sidecar is a product component, not the deleted automation. |

## What changed in this work

1. Reused the MIT Windows implementation from
   `ridelink0/claude-computer-use` at its pinned revision. Kept the persistent native
   host, UI Automation, capture/input, guardian and relevant test infrastructure.
   OpenAI/Anthropic public MIT references and modification records are retained in
   [UPSTREAM.json](UPSTREAM.json), [notices](THIRD_PARTY_NOTICES.md) and `licenses/`.
   No private vendor implementation or helper protocol was copied.
2. Replaced routine MCP integration with a supported global skill and managed App
   Sidecar. This also fixed the discovered App terminal `exebox` desktop/lifetime
   problem. Starting a controller from an isolated terminal cannot control the
   visible desktop; do not bypass that boundary with WMI or desktop switching.
3. Added fixed deployment policy, exact build binding, native permission/identity
   checks, independent cancellation, input cleanup and OS-owned service ownership.
   Provider errors preserve unknown delivery without replaying a click or Enter.
4. Added short pinned launchers, named flags, exact observed selectors, section
   queries with their child controls, tree-only query defaults and batches that
   stop on failure. A batch can include observed-text waits with a combined
   maximum wait budget of 30 seconds. Common command forms are in the skill.
5. Added explicit clipboard-preserving filename entry/readback and Unicode
   handling. Preserved the failed keyboard-entry and provider-replay evidence.
6. Kept all test/probe/recording/evidence folders under this checkout's ignored
   `.localdata/`. `tests/paths.mjs` resolves paths from the module, independently of
   the caller's working directory. Do not restore drive-root or OS-temp fixtures.
7. Diagnosed a related Upscaly integrated-GPU configuration defect and accessibility
   labels. Those changes belong to the separate private app repository below.

## Real-app evidence and performance

The latest successful tasks used fresh No Project conversations, Gemini 3.8 Flash
High and the existing Turbo preset. The sample was a 480×330 image; both outputs
were RealESRGAN Ultra, 100% enhancement, 4×, with no software fallback.

| Measurement | PNG | JPEG |
| --- | ---: | ---: |
| Whole task, including setup and cleanup | 269,280 ms (4m29s) | 272,954 ms (4m33s) |
| Controller calls | 15 | 15 |
| Time inside controller requests | 11,893 ms | 15,937 ms |
| Native inference, measured by app | 16,272 ms | 18,915 ms |
| Published output | 1920×1320, 3,424,092 bytes | 1920×1320, 174,151 bytes |

PNG SHA256: `7945386ae3df58d29b96fd303d922716a12bc5894cac494278311c7c9ec46b6c`.
JPEG SHA256: `5fb3342865f9e85e75572e21d8d791d321f1787211a737dce0038a2ba29fd13b`.
File signatures, decoded pixels, SQLite publication and actual NCNN completion
were checked independently. Settings were restored and owned app instances closed.
A second task completed without restarting Antigravity.

The previous successful High PNG witness took 326,493 ms with 25 controller calls:
the latest witness was about **17.5% faster with 40% fewer calls**. An earlier JPEG
witness took 235,796 ms, which is faster than the latest JPEG result. These are
individual witnesses with application/profile changes, not a controlled statistical
speed claim. Model/host decision gaps, terminal scheduling and image/file tools
remain dominant. The App's picker exposed only the selected Flash High variant;
the proposed lower-effort comparison was not run and the model was not changed.

The exact AI-tested controller build was
`de4708498a561ebaddd55ec60ea606df14d11bd43a907084ebf84a66783542cd`.
A later documentation-only bundle, `19b3e952562cc7b430c06002b554ca5ced6301aa7013568b12c2a5771bea2026`,
had 34 runtime/script/skill/helper/Node files identical to that build and was
installed and inspected. Final release packaging adds this handoff; compare its
manifest and the publication audit rather than assuming the old full build ID.
The qualified native helper SHA256 is
`5e2cbf2060ee228006234dd90fb0832adaed6dc8f63c9bd80e1c08863088aa1a`.

Private receipts, recordings and transcripts are intentionally not published.
On the owner's checkout, evidence is under `.localdata/speed-resume-20261024/`:
`host-final/`, `custom-real/`, `physical-stop/`, build/test logs and the incremental
Upscaly patch. Publication audits and checksums are under `.localdata/handoff-publish/`.
Earlier failed runs remain evidence of failure, not replacement acceptance passes.

## Related Upscaly handoff — separate private repository

The existing feature working tree and required dependencies were preserved on:

- Branch: `handoff/computer-use-2026-10-24`
- Snapshot: `53cb838743d600e7ed76f3da61ae1ef1f5b0246d`
- [Private app handoff](https://github.com/shayann07/Upscaly/blob/handoff/computer-use-2026-10-24/docs/COMPUTER-USE-HANDOFF.md)

This is a WIP source snapshot, not an Upscaly binary release. Its main branch,
active checkout and original index were not changed. Local `.agents/` settings,
`skills-lock.json`, models, recordings, runtime data and binaries were excluded.
The private branch retains an incremental compatibility patch and explains the
inherited feature work. It is not part of this project's MIT source distribution.

The Intel device reported a 16,198 MB shared heap. Treating that as dedicated VRAM
selected two GPU workers and unsafe AUTO/256px work. A conservative integrated-GPU
profile now uses a 512 MB budget, at most 64px tiles and one GPU worker, keeping the
chosen native GPU/model. Device loss (`VkResult -4`) is reported distinctly from
proven allocation failure. Output directory, Tile size and Upscale received stable
accessible names/groups. The qualified app EXE SHA256 is
`20ce0c45a7c91659992fbdb6392b0420655c45ba1f4e99b520ce27c197232a24`.
Focused app checks passed: 2 GPU-profile tests, 1 existing NCNN-options regression,
6 SettingsPanel tests and the TypeScript/Vite/Tauri debug build. This does not
qualify every feature on the snapshot branch.

## Prioritized TODOs and acceptance criteria

### P0 — remaining latency

- Separate launch/readiness, inference, model/terminal/image calls and cleanup in
  the next trace. Inspect actual tool calls, not private model reasoning.
- Avoid the first loading-only screenshot round trip, repeated schema discovery,
  unnecessary field queries and individual restore/close commands. Preserve the
  current one-use-frame, identity, native approval and Stop checks.
- A small JavaScript IPC client that maintains frame state and chains predictable
  verified steps is a possible next approach. **It was discussed but not implemented
  or installed.** There is no hidden SDK or second agent framework in this release.
- Benchmark before changing the default skill workflow. Use the same app binary,
  input, model/effort, preset, device, tile, format and fresh session across repeated
  trials. Record a task start and explicit final receipt ID with
  `scripts/measure-run.mjs`; exclude later diagnostic polls. Verify real outputs.
- Agree an explicit latency target before declaring this work complete. Do not
  claim general improvement from fewer calls or a faster isolated primitive.

### P1 — finish safety, hardware and distribution qualification

- In an owner-ready physical session, interrupt an actual queued operation and
  held input on the final helper; record cancellation, independent release and
  refusal of old observations. Native re-arm must remain human-only. Previous
  timeout/skipped-action results are not proof of physical cancellation.
- Qualify mixed DPI, multiple physical displays, negative monitor origins,
  display gaps and hot-plug changes. Simulation and single-display math tests do
  not establish hardware coverage.
- Run the five skipped installation-ACL tests in a trusted, owner-approved
  checkout. Keep its test artifacts inside that checkout. Do not change parent
  ACLs or silently move individual tests outside the project to force a pass.
- Recheck install/update/rollback after unrelated configuration changes and App
  restarts, preserving Stop across updates. End/shutdown before replacing files.
- Review signing/SmartScreen/distribution expectations. Do not claim signed or
  universally trusted experimental helper binaries.

### P2 — usability and broader application testing

- Get final feedback on glow intensity, animation, cursor roles and minimal bar
  behavior. Keep controls legible, click-through edges and reliable teardown.
- Evaluate visible feedback for semantic actions that execute without cursor
  travel. Do not replace safe accessibility actions with blind pixel replay.
- Complete the original-versus-feature Upscaly matrix: F01 ROI/two-model comparison;
  F02 sizing/print; F03 enhancement blending; F04 DNI; F05 video ranges/samples;
  F06 clipboard; F07 recipes/mixed selection; F08 folders/sessions; F09 pause/resume;
  F10 protection; F11 face restoration; F12 export/metadata/naming. Current bounded
  PNG/JPEG witnesses do not qualify all those features.
- Revisit effective shared-memory GPU budgets and displayed profile consistency
  in the app. The current integrated-device cap is conservative, not universal
  performance tuning. Do not make OS driver/security changes as automatic recovery.
- macOS/Linux ports remain future work. Do not advertise the Windows beta as
  equivalent cross-platform qualification.

## Safe continuation checklist

1. Read this file, `AGENTS.md`, `PROJECT-STATUS.md`, `VALIDATION.md` and the latest
   local checkpoint. Verify current Git, CI, installed manifest and native status.
2. Keep one physical desktop task active. Coordinate with other sessions; virtual
   desktops are not isolated mouse/keyboard workspaces.
3. Preserve host settings and the installed permission mode. Host-managed mode
   is an explicit operator choice, not proof that Turbo is active.
4. View actual returned screenshots before pixel actions or visual claims. On
   unknown/completed delivery, observe effects before continuing; never replay.
5. Ask the owner to be ready before an interactive physical check. Activate its
   bar immediately before the handoff; account for ordinary idle auto-release.
   Do not leave stale prompts or report a timed-out check as passed.
6. Restore test-modified settings, close only owned disposable windows, call `end`
   and verify idle/empty grants/cursor restoration. Keep passive Sidecar lifecycle
   separate from removed recurring work.

For a source review start with `server/runtime.mjs`, `desktop-tools.mjs`,
`desktop-service.mjs`, `service-lease.mjs`, `scripts/desktop.mjs`, `arguments.mjs`,
`install.mjs`, `rollback.mjs` and native `Guardian.cs`, `AxonHost.cs`, `CursorSafety.cs`
and `DesktopVisuals.cs`. See [review guidance](docs/review-guide.md).
# 29 October 2026 — shared Mac adapter candidate

Continue from `codex/macos-and-latency-review` for the Mac adapter. Read
[docs/MACOS.md](docs/MACOS.md) for architecture, candidate installation and the
explicit pending hardware checklist. Shared runtime/tool/permission contracts
must remain common to both platforms; native implementation details differ.

Both architectures compiled on CI at `7dc7a54`. A storage fixture failed before
installer qualification and is repaired in `787ddb1`; inspect the latest CI,
not those historical results. Further source hardening checks input permission
at every CGEvent and verifies fit-window bounds. Real desktop acceptance is
unrun. Headless tests must never be reported as a human Stop or app-workflow pass.
Keep the candidate unmerged/unreleased until those boundaries are addressed.

The installed Windows recording build and published beta.2 remain different;
this work did not update either. The real 39-second Upscaly demo is already on
main. Antigravity's separate `reduce_orchestration_latency` worktree was not
modified or merged. Project speed remains unfinished; projected savings are not
matched real Antigravity benchmark results. No automation or goal was recreated.

# Reliability and automatic-update candidate — 29 October 2026

The active implementation goal is recorded in
[docs/RELIABILITY-IMPLEMENTATION.md](docs/RELIABILITY-IMPLEMENTATION.md), with
requirement-by-requirement status and pending release/native gates. The candidate
repairs human-launcher controls and guardian readiness, adds `ready`, mandatory
sanitized local incidents and consented reporting, and introduces signed update
staging/idle apply/rollback and installer preferences. The Mac agent prompt is in
[docs/MAC-QUALIFICATION-PROMPT.md](docs/MAC-QUALIFICATION-PROMPT.md).

Local regression at `207a844`: 168 passed, zero failed, seven explicit skips.
Windows CI passed; Mac checks must be inspected at the current head. No production
signing key or signed updater release is configured. Actual affected-PC/model,
native update, physical/hardware and Mac desktop acceptance remain pending.
Do not install over a live task or publish this as a completed updater release.

# 31 October 2026 — package-backed Windows HUD checkpoint

The current `main` head includes Mac PR #29/#30 integration, the bounded wait
transport fix, and the Windows package-backed LiquidGlass companion path. The
latest commits are `406dc17` (bundle helper), `3ebc7fc` (persistent helper
stdio), `db39b51` (native client), and `6946a24`/`3837c8f` (wait deadline and
provenance fixes).

`server/liquidglass-host` builds against the published `LiquidGlass` 1.0.0
package with the local .NET 10 SDK. A self-contained x64 helper rendered a
surface over persistent stdio. The native Windows host discovers
`liquidglass/LiquidGlass.Host.exe` relative to its installation and uses the
compatibility renderer only when that companion is absent. `scripts/bundle.mjs`
seals the helper executable and `libSkiaSharp.dll` when
`AGCU_LIQUIDGLASS_HELPER_BUILD` is supplied.

Evidence: native host compilation passed; package helper build and stdio render
passed; bundle inventory included both helper files; provenance is 175/175;
serial controller suite is 452 tests, 441 pass, 0 fail, 11 platform skips;
targeted bundle identity, cursor and risk-policy tests pass. Windows install
qualification reached the ACL guard and skipped with
`insecure_storage_ancestor`; no parent permissions were changed.

Still pending: maintainer-key signing and public release transport; installed
helper-backed Windows task on the affected PC; real Antigravity orchestration
timing; Intel Mac acceptance against the matching shared runtime; physical
hardware/re-arm gates; and publishing only after those checks. Emergency Stop
re-arm remains human-only. Do not claim the release complete from this
checkpoint alone.

GitHub review state checked 31 October 2026: PR #29 and PR #30 remain OPEN,
both report `mergeStateStatus: DIRTY`, and neither has a current check run in
the API. Their commits are present in this local `main`, but that is not the
same as merged upstream review or current CI evidence.

Fresh exact-head regression on `b2791c2`: serial Node test run completed with
452 tests, 441 pass, 0 fail and 11 platform skips in 97,358 ms. This confirms
the package-client and bundle changes did not regress the controller suite; it
does not replace physical or installed-device qualification.

PR review update: PR #29 merged as `dfb9a8e` and PR #30 merged as `df71a4e`.
Their Windows source and macOS Intel/ARM checks passed after the AppKit fix in
`0db7fdb`, which replaced the unavailable `NSGlassEffectView` symbol with the
supported `NSVisualEffectView` surface. Main currently contains both Mac
changes; the post-merge main CI run is still in progress.

