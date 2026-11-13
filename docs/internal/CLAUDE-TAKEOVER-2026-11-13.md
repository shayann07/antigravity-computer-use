# Claude takeover — verified 13 November 2026

This is the current handoff. Older HANDOFF.md entries and issue comments describe earlier candidates and must not override the identities below. The owner cleared the goal. Do not recreate a goal, overnight loop or automation. Do not contact the unrelated deputy. This handoff is research/status work, not a completed release or a fresh desktop qualification.

## 1. Verified current state

- Repository: https://github.com/shayann07/antigravity-computer-use
- Checkout: D:\Work\AntigravityComputerUse
- Runtime source reviewed: codex/preserve-stop-uncertainty at 0af522e99ae4cd609241df6338a90820a7570592. Working tree was clean at takeover review; subsequent changes in this handoff are documentation only.
- origin/main: dc9435a8f948abfef62e67aed64d854ff9f69b37 (PR45 installation location). Fetched on 13 November.
- Latest published release: v0.3.0-beta.4, prerelease, published 1 November. No beta.5 release is published. Old local beta.5 artifacts do NOT contain the subsequent Stop/ownership fixes.
- PR44: draft, current source above; Windows source FAILURE, all four Mac native jobs SUCCESS (macOS15/26, Intel/ARM). Windows run41437147134: 569 total, 555 passed, one failed, 13 skipped. Mac run41437147218 passed all four jobs. These are historical exact-source CI results checked live today, not tests rerun today.
- Failure: tests/desktop-service.test.mjs, foreground serve residency/shutdown test, 10-second startup timer. Error: Foreground startup timed out. Root cause remains unproven. Source fixture starts its timer before native preparation. Investigate cold build/private storage timing; do not just increase product deadlines or rerun until green.
- PR35 (Windows HUD avoidance), head935c82db2adb55efe3464dbde294ae0af18f1426, and PR36 (Mac glass/consent/compiler), head4dc7914e9df5adb574acdf83208884780a989022, are still draft/open. Both exact heads are ancestors of PR44; ancestry was checked today. Do not independently cherry-pick them again. Their green older CI is not qualification of PR44.
- Provenance rerun today: 224 checked, zero mismatches, no updates.
- 32 open issues, including all 15 new issues #46 through #60. Full public bodies and comments are in the companion issue inventory. Treat reports and proposed fixes as hypotheses until reproduced.

## 2. Installed copy and QUEUED UNINSTALL

Owner explicitly requested uninstall OR queue removal for later. Removal is QUEUED, NOT performed. No skill, settings, process, Stop file or installation was deleted/disabled in this review.

Permanent root: D:\Apps\AntigravityComputerUse\ed035f9812. The former D:\AntigravityComputerUse-ed035f9812 root was moved earlier; do not reinstall there.

A read-only installed status call today returned build c93b8fcbd62e58c6ab0dd355dbaacf622d234ca95b2449e184ecbf2d9bee9b89, version0.3.0-beta.4, state idle, task_open false, recovered_task false, no approved apps, host-managed permissions, manual takeover, no custom cursor, ownership not lost. This is a status sample, not proof no other conversation will use it later.

There are TWO deployment scopes: global (sidecar enabled, unpinned) and project08856ab6e4e2 (pinned, Upscaly workspace D:\Work\Extras\Upscaly\image upscaler). Global release suffix c25934b2; project release suffix b3d453ff. Both share the installation data root. installation.json records the last PROJECT installation, so reading only it misses the global scope: inspect deployments.json and each deployment pointer.

Uninstall is queued deliberately because a managed sidecar and two scopes require coordinated unregistering; partial deletion can leave auto-restart or broken slash commands. There is no single documented transactional uninstall command. Owner permits queueing; no claim of removal.

### First task for Claude: safely remove the installed copy

1. Inspect current ownership/status using the installed commands, not source CLI. If another task is active, defer shutdown and record its state; do not End a foreign task.
2. Back up only relevant config entries/deployment pointers under ignored .localdata/uninstall-<date>. Preserve Stop, incident data, update policy and rollback records. Do not publish these private files.
3. Disable/remove only sidecars.antigravity-computer-use in %USERPROFILE%\.gemini\config\config.json, preserving all unrelated settings. Inspect/remove its matching definition under .gemini/config/sidecars/antigravity-computer-use/sidecar.json only after verifying its target. Prevent host auto-restart before shutdown; do not close/restart Antigravity.
4. Use the installed normal shutdown after task cleanup. If cleanup is refused, retain files and record the actual blocker; never force-delete Stop/ledger data or kill a potentially held-input watchdog.
5. Remove only matching global skill .gemini/config/skills/computer-use and project .agents/skills/computer-use; examine any legacy profiles and MCP entry but do not delete unrelated entries. Verify pointers target THIS installation before edits.
6. After confirmed process exit, archive or remove this installation root only. Validate resolved paths before recursive operations. Preserve repository and backups/evidence. Verify no matching host registration/launcher points to a removed root. Do not install a replacement unless requested for qualification.
7. Record uninstalled/partially removed/deferred honestly, with paths and checks. No computer-use desktop actions are needed just to inventory files.

## 3. Architecture and implemented source work

One shared Node direct skill/IPC service plus Windows C# and macOS Swift native adapters. Antigravity supplies its existing LLM. No required MCP, additional model subscription or replacement basic bridge. Keep attributed upstream MIT code, licenses and provenance. Optional old MCP adapter is not the production direct integration.

PR44 adds server-issued task capabilities, reusable task command prefixes, per-account native cross-installation lease/journal, original-guard-bound Stop evidence, native End acknowledgements, current/prior actor cleanup verification and local End session UI. It incorporates PR35 own-HUD avoidance and PR36 native Mac glass, shared official Phosphor fill assets, consent handling and compiler changes. Explicit controls persist instead of disappearing after30seconds. Idle Mac event-tap failure retires quietly rather than creating a phantom stopped HUD.

Read: server/task-ownership.mjs, task-coordinator.mjs, recovery.mjs, guardian.mjs, runtime.mjs, desktop-service.mjs, service-lease.mjs; scripts/desktop.mjs; native Guardian/ControlFence/CursorSafety/StorageGuard and Mac equivalents. Read docs/TASK-OWNERSHIP.md and docs/STOP-UNCERTAINTY.md. These protocols coordinate cooperative same-user callers; they do not isolate malicious processes with full access to the same account. Unregistered legacy controllers cannot be forced to honor the new protocol.

Preserve evidence: accepted IPC write is not native delivery; a replacement process's empty ledger is not proof old input was released. Unknown delivery must not replay. Stop uncertainty must survive restart/update, and normal End must not clear the emergency latch. Legacy incomplete records need a usable safe recovery path, not invented proof.

## 4. New issue triage and source findings

Suggested priority is an engineering recommendation, not an assertion every report is reproduced.

### Release blockers / first fixes

- #47/#57: recovery dead end after restart; ready, controls AND end can refuse. Implement a single recovery contract with actor, exact supported action, safe conditions and docs. A read-only recovery HUD must be separable from permitting input/re-arm. Never make a recovery button clear unverified cleanup. Explain missing legacy evidence and provide an actual operator path. One bounded attempt, no restart loops.
- #7/#9/#10/#26/#58: ownership, old input cleanup and Stop recovery. PR44 contains substantial fixes, but real multi-caller/crash/physical acceptance is still pending. Add useful read-only task age/last-action/owner and held-resource evidence. Age or zero grants alone must not prove another caller dead or authorize takeover.
- #52: possible pixels from another app around invisible borders. Current AxonHost.cs capture code obtains GetWindowRect and uses that as captureRect/region. Microsoft documents invisible resize borders and DPI virtualization here. Reproduce on contrasting background windows, then correct capture bounds AND the shared coordinate transform, including PrintWindow origin/cropping, DPI, negative monitor origins and image resizing. Report dimensions, origin, scale and retention explicitly; do not only change crop and break clicks.
- Current Windows CI startup failure: isolate fixture setup from foreground service readiness only after proving the cause. Retain failed log .localdata/final2-windows-ci-failure.log.

### Reliability, weak-model usability and speed

- #55: current Runtime.ready() explicitly calls beginTask() before reporting readiness and revealing controls. Therefore ready AFTER end can itself create a new task; the report is not by itself proof End failed. Decide and document side-effectful prepare versus read-only status, and test End via status before ready. Keep actual visibility distinct from requested visibility.
- #46/#48/#59: generated short core skill, complete command/flag table, key --keys, JSON array examples and actionable range errors. Keep all old safety instructions mapped into references. Test real weak-model usage, not just line counts. No arbitrary aliases without compatibility review.
- #50: WebView2/Tauri UIA absent or partial. Reproduce cold/warm provider, modals and virtualized/scrolled content. Do not assume a Chromium process launch flag can be injected into an already-running user's app or that Mac AX flags solve Windows UIA. Report missing/partial structure and honest fallback; avoid endless name/wait retries.
- #53: validate batch structure before any effects; preserve stop-on-failure. A screenshot captured internally is not automatically a screenshot the model has seen: do not silently authorize later pixel coordinates against an unseen changed frame. Provide explicit observation checkpoints or split batches with a clear message. Test partial-completion receipts and unknown delivery without replay.
- #49: refused pre-input action frame handling, launch helper-window selection, hover interference, bounded stability wait. Only reuse a frame after a no-input refusal if app/geometry/freshness remain valid. Parking a cursor is itself input and must obey Stop/ownership. Largest window is a heuristic, not identity; return candidates and verified PID/path/owner flags.
- #33/#54: PR35 own-HUD movement integrated but unpublished. Qualify own and foreign overlays; fix upstream Claude-specific error wording and only recommend semantic targets actually available.
- #2/#13/#18/#19/#21/#22/#23/#43: exact Unicode, long model gaps, independent expiry/watchdog, native transition/consent races. Source/CI coverage exists for parts; retain hardware and failure-delivery gates.
- #8: cross-root rollback leases remain an independent concurrency audit; a new task coordinator does not automatically prove installer/rollback serializes every affected root.
- #38: do not adopt the old a44e532 time-call/baseline wrappers wholesale. They mishandled unknown delivery and busy detection. Existing comparison tooling is separate.

### Scoped feature/policy work after blockers

- #51 explicit client resize with logical/physical units, actual result and refusal for nonresizable windows. Useful real responsive-test feature.
- #56 bounded target-window burst/recording; same approvals, cancellation, capture privacy and private evidence retention. Never default to full desktop after a black capture.
- #60 host-specific self-exclusion is a NEW policy proposal, not an already accepted implementation. Current policy.mjs blanket blocks claude/chatgpt/codex/antigravity, confirmed today. Resolve host identity through trusted integration, not model arguments, and keep fail-closed unresolved-host behavior. Audit approval UIs, cross-agent prompt injection and nested supervisors before allowing other assistant windows. Do not use this issue to bypass current host protections during testing.

## 5. Research and visual requirements

Primary sources checked 13 November:

- Microsoft GetWindowRect: https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowrect — DPI virtualized, may include invisible resize borders; recommends DwmGetWindowAttribute/DWMWA_EXTENDED_FRAME_BOUNDS for visible bounds, which are not DPI-adjusted. Supports the investigation for #52, not a completed fix.
- DWM attributes: https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwmwindowattribute — extended bounds in screen space and platform-dependent backdrop attributes. Check OS gating before adopting backdrop APIs.
- Apple NSGlassEffectView: https://developer.apple.com/documentation/appkit/nsglasseffectview — page requires JS in this research environment; no newly verified API details inferred. Existing Mac implementation uses macOS26 native glass with explicit older-OS fallback; compile and qualify on actual Mac.
- Owner's Windows library: https://liquidglass.shayxo.dev/ — web fetch failed today; dependency/version claims must be rechecked in the lock/package files and upstream release, not inferred from website availability.

Owner requires the actual published LiquidGlass library on Windows, not copied/inspired shader code; native Apple glass where supported on Mac; official Phosphor fill icons, no decorative status dot or hand-stroked substitutes; minimal controls; real smoothly moving cursor, breathing glow, clean release/restoration. Existing Windows package integration uses caller-provided background rendering and must NOT be represented as live desktop refraction or Apple parity without visual evidence. Library updates should flow through tested, signed compatible bundle updates, never arbitrary remote executable loading during a task.

## 6. Qualification and release sequence

1. Inventory current code/PRs and finish queued uninstall. Preserve owner's cleared goal and no-loop request.
2. Reproduce/fix Windows CI failure, recovery UX and new release-blocking reports. Add minimal meaningful regressions. Update PR44 title/body to actual integrated scope.
3. Run node --test --test-concurrency=4 tests/*.test.mjs, provenance, native compilation/contracts and installer/update checks. Keep ALL artifacts under ignored .localdata. An ACL skip is unqualified; never weaken parent ACLs or relocate evidence to drive root/temp.
4. Build a NEW signed compatible bundle from final source. Verify key, manifest, hashes, OS/architecture, pins. Do not reuse old beta5 candidate or treat CI artifacts as published release.
5. Real Windows: passive startup hidden; explicit recovery UI; clean restart; real cursor/HUD/glow; own/foreign overlay; physical Esc during held/queued input; independent cleanup; second task; two callers/installations; interrupted update and rollback. No simulated human approvals/re-arm. Record human-only tests pending when unavailable.
6. Real Antigravity Flash/Sonnet stable Upscaly1.0.9 AI PNG/JPEG, identical task/candidate/settings, preserve originals and verify decoded output plus native NCNN evidence. Baseline Flash ~471.556 seconds, 34 calls, ~37.683 seconds controller, median decision gap~10.675 seconds. Older269/273-second15-call runs are different baselines. Native compiler WMO and fewer calls do not establish host/model speed improvement. Measure wall/controller/inference separately and retain failures.
7. Mac Intel and ARM acceptance: permissions/revocation, Spaces/fullscreen, Web/Electron AX and OCR, modal consent, Stop/rearm/held inputs, display scaling, cursor restoration, update/Gatekeeper. Current four-platform CI does not replace hardware qualification. Windows may ship separately; Mac must retain explicit experimental limits if unqualified.
8. Signed updates: stable/beta channels, automatic/notify/manual, 24h cadence, private staging, idle-only atomic whole-bundle switch, paused/active deferral, shared/global/project pins, Stop preservation, failed-start rollback and actual skill discovery. Audit cross-root ownership separately.
9. Merge only reviewed passing exact heads; PR35/36 are already included in44. Close issues only when their acceptance is actually met, with evidence. Publish accurate Windows/Mac scope, verify downloaded bundle/installed identity, then archive superseded branches without losing work. No premature production/parity claim.

## 7. Evidence, boundaries and working rules

Useful local records: .localdata/PAUSED-CURRENT.md, INSTALLATION-CURRENT.md, CLEANUP.md, final2-windows-ci-failure.log, windows-beta4-acceptance, combined-candidate-full-suite.log. Older logs have older test totals/heads. Some historical duplicate bundles were removed to reclaim22.413GB; metadata remaining does not mean binaries still exist.

Stable app: .localdata/one-line-demo-20261028/stable-app/upscaly.exe. Cached input: .localdata/demo-capture-fix-20261028/portrait.jpg. Original sample_data lives under the owner's private sample-data folder. Preserve private Upscaly settings/work. Never launch disliked1.1 as substitute for stable1.0.9.

Owner wants direct autonomous work, clear done/partial/blocked records, fast practical agent UX and honest proofs. Do not restart/close Antigravity or interfere with another agent's desktop session. Do not contact the unrelated deputy. Do not recreate cleared goal or scheduling. Ordinary tasks cannot self-modify/self-merge; shareable diagnostics exclude screenshots/text/clipboard/private paths and need reporting consent. Only open-source/documented reuse with attribution.

This review did not run the full suite, fix runtime code, merge a PR, publish a bundle, uninstall, or operate the desktop. It fetched current GitHub state and comments, read relevant source and installation metadata, queried passive installed status, checked provenance and primary platform documentation. No claim that all remaining work is merely testing.

## 8. Prompt for Claude

Take over Antigravity Computer Use in D:\Work\AntigravityComputerUse. Read AGENTS.md, this document, docs/CLAUDE-ISSUE-INVENTORY-2026-11-13.md, docs/TASK-OWNERSHIP.md, docs/STOP-UNCERTAINTY.md, docs/PERFORMANCE.md and the relevant implementation. Treat older handoffs as historical. Refresh GitHub state before edits. Start with the queued complete local uninstall and a done/partial/blocked ledger, then address recovery/privacy/CI blockers and new usability issues in the stated sequence. Preserve shared Windows/Mac behavior, actual LiquidGlass dependency and official icons, original Stop/cleanup proof and unknown-input non-replay. Use your available tools, not assumed Codex tools. Do the engineering and real qualification; no fixture-only completion claims. Keep artifacts in .localdata, no goal/automation recreation or deputy contact. Windows can release independently of unavailable Mac hardware, with honest platform scope. Report commits, exact CI, real measurements, remaining human/hardware gates and publication/installation identities separately.
