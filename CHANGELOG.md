# Changelog

## 0.3.0-beta.6 - Faster app operation (Windows)

- `run` batches several steps in one command, and pixel steps chained inside one `run` each get a fresh screenshot (#82, #85).
- `wait --until-gone` waits up to about 3 s for its label to appear and, when refused, returns a fresh frame to act on (#83, #84).
- WebView2 apps are read as web content, and native windows are walked 24 levels deep, so lists such as Explorer rows are visible (#70, #84).
- `drag --points` draws one continuous stroke through up to 400 points, for curves and handwriting-like input. macOS refuses points drags for now (#85).
- A check capture spoiled by a passing overlay is retried once instead of skipping the rest of a batch. The launch refusal now says how to find a Windows Store app's real executable (#86).
- A bad `launch` path now advises fixing the path instead of collecting diagnostics, and the skill tells the model plainly to run the commands itself (#87).
- This release is Windows-only; macOS remains experimental and unqualified on hardware.

## 0.3.0-beta.5 - Stop, ownership and recovery (Windows)

- Stop that may not have reached the native controls is kept as uncertain across native writes, restart and update; unknown input delivery is never replayed. Normal End never clears an emergency Stop.
- Task ownership: tasks get capabilities issued by the server, and a per-account native lease and journal coordinates installations. End needs a native cleanup acknowledgement, and cleanup by current and prior actors is verified.
- Recovery after a restart is no longer a dead end (#47, #57). A leftover task that provably never sent input can be ended once. `controls` shows the bar with Stop available and re-arm locked while the previous task's cleanup is unverified. Every blocked reply now names who acts next, the exact command and when it is safe (`recovery`).
- `ready` reports `task_started`; use `status` to check state after `end` (#55).
- The Windows control bar moves away from the target before a click (HUD avoidance).
- Internal maintainer notes are no longer shipped in release bundles.
- macOS changes in this source (native glass, consent fencing, compiler leases) are compiled in CI only. This release is Windows-only; macOS remains experimental and unqualified on hardware.

## 2026-10-28 - repository presentation

- Reworked the README with original branding, CI/release/license badges, the labelled historical real demo, installation and concise qualification limits.
- Updated the GitHub About description, download homepage and searchable topics.
- Corrected obsolete draft/pending installation guidance and refreshed the Claude Code continuation brief.
- Retired six redundant work branches after ancestry review; the only unique README draft remains under an archive tag. No runtime or release asset changed.

## 0.3.0-beta.2 - silent startup and control cleanup (26 October 2026)

- Passive startup/status/End/shutdown no longer starts the guardian merely because Stop is saved.
- Native controls start hidden; End hides the bar and stopped controls auto-dismiss after eight seconds. Added explicit controls reveal for human re-arm and a Hide action while stopped.
- Capture completion cannot resurrect a hidden bar; Stop remains latched and human-only re-arm is unchanged.
- Actual native lifecycle checks passed; source checks: 139 passed, zero failed, five explicit ACL skips. Full AI workflow, physical queued/held-input interruption and hardware qualification on this changed helper remain open.
- On 27 October, re-enabled the owner's existing Sidecar entry. Actual Antigravity-managed beta.2 startup and native read-only discovery passed without a manual launcher or whole-App restart; unrelated settings and Stop were preserved. This configuration repair did not create a new runtime build.

## 0.3.0-beta.1 - direct native Windows skill

- Direct skill scripts and persistent authenticated native service replace the default MCP route. No extra model or credentials.
- Real-app fixes: numeric ranges, indexed keyboard focus, owned pickers, Unicode transport, bounded observation settling, worker epochs and explicit input-delivery evidence.
- Persistent emergency Stop across replacement, independent input/cursor cleanup and Keep working by default.
- Stronger soft breathing ice-blue edges, smaller halo, original pointer and distinct text insertion cursor with correct hotspot.
- Manifest integrity preflight before installer writes; configuration-preserving upgrade/rollback, source provenance CI and fresh-folder release packaging.
- Qualification includes real Upscaly and editor workflows; see VALIDATION.md for exact build boundaries and unavailable hardware. Earlier checkpoints below are historical.

## 2026-10-24 - dev7 installed qualification

- Actual Agent Manager confirmed the exact dev7 pin and lifecycle schemas after the dev5 real AI workflow and dev6 actual JPEG-viewing/Unicode regression.
- Native hotkey interrupted a held real-app drag, released the owned button and skipped seven queued actions. Stop survived service replacement. Both human re-arms and physical Esc were observed.
- The Stop harness's unsupported final close argument was corrected separately after preserving its failed receipt; all prior safety assertions passed. This is not reported as a clean whole-script pass.
- Covered-target capture passed without pixels from an unapproved cover. An older-helper leak did not reproduce; no failing-before claim. 66 automated checks pass. Native helper changed to SHA256 98793c75fa416cdf3a7233b0e400b831268a454c2ab5bf94f8bc12e7c7705d02.
- No new public release. Older dev7 source/lifecycle entries below precede native hardening and do not describe the final installed bytes.

### Dev7 native capture hardening

- Check all higher windows intersecting the target rectangle instead of sampling five points.
- Fail clearly if a covered window cannot render itself; never return a covering-window screenshot as the app. Discard screen pixels if coverage changes during capture.
- Reject legacy screen_occluded replies before delivering an image to the agent. 66 automated checks pass; native helper rebuilt. The installed capture and Stop witnesses are recorded above.

## 2026-10-24 - dev7 lifecycle discovery

- Complete describe/start/shutdown schemas, including conventional COMMAND --help, after actual Antigravity tried describe start.
- Make the real JPEG-viewing step explicit with the Agent Manager App's actually tested read_file tool and require UTF-8 requests.
- 65 checks pass. Actual Agent Manager dev5 AI/pause-resume/second-session and dev6 JPEG/semantic/Unicode witnesses are recorded privately; final installed emergency Stop/human re-arm checks remain pending. Native helper bytes unchanged.

## 2026-10-24 - dev6 actual Antigravity integration feedback

- Add describe COMMAND / --help COMMAND with exact argument schemas. Ordinary skill operation no longer needs source inspection.
- Emit ASCII-escaped JSON at the CLI boundary to prevent legacy PowerShell OEM decoding from corrupting Unicode labels and values. Actual Windows PowerShell437 pipeline round-trip passes Urdu, joiners and emoji.
- Require launch/observation of a prebuilt app before inferring or starting development-server prerequisites.
- 65 source checks pass, including preventing a queued input-lease action from running after Stop. Native helper bytes unchanged; dev6 live acceptance is pending.

## 2026-10-24 - dev5 connection recovery

- Give a clear recovery error when a saved service pipe is unreachable. Distinguish connection loss after possible input delivery; do not replay it.
- Refuse to launch a competing controller when an existing live service fails to answer.
- 62 automated checks pass, including both regressions. Native helper bytes unchanged from dev4. Fresh Antigravity/native stop-resume qualification remains pending.

## 2026-10-24 - dev4 reliability work

- Real peer editor feedback: preserve Unicode joiners and bidi marks; add foreground HWND hints, clear idle-service recovery, and bounded screenshot settling.
- Bind observations to native-worker epoch. Refuse stale element indexes after helper replacement before input delivery.
- Report input_completed with verification_error when input succeeded but its subsequent observation failed; stop batches without replay.
- Treat failed held-input recovery as a control Stop; native Resume/Re-arm/activation stay blocked while the owned-input journal is uncleared.
- 59 automated controller checks pass; full native helper compiles. This entry is source evidence, not new Antigravity or hardware qualification.

# Changelog

## 0.3.0-dev.1 — unpublished reliability rework

- Numeric slider values, indexed keyboard focus and verified owned-dialog input fencing.
- Compact observations, deeper bounded queries, expected-state waits and actionable native errors.
- Matching-request cancellation, retained stop reasons and renewed human-resume deadline.
- Skill protocol conflict correction, real app/output verification guidance and recursive reference installation.
- Explicit runtime version/build identity, correct completion diagnostics and saved takeover-mode reporting before native startup.
- Packaging preserves the source-addressed native binary; repeated packaging verifies its identity instead of forcing a new compiler artifact.

Actual Upscaly 1x/zero-enhancement PNG/JPEG exports and indexed-key regressions passed in Agent Manager. This does not qualify AI inference, all workflows or visual parity. The app's import/status/publication defects were repaired separately. See VALIDATION.md for remaining limits.

## 0.2.0 — Windows beta

First public release of the native Antigravity Agent Manager integration.

- Global `/computer-use` skill and 21 MCP tools, using Antigravity's existing model.
- Windows accessibility, screenshots, Unicode input, real cursor movement, clicks, scroll and drag.
- Minimal native controls, breathing ice-blue glow and custom cursor with independent restoration.
- Manual pause and optional Smart takeover; human Resume/re-arm and independent emergency stop.
- Process identity and observation fencing, bounded batches, automation-owned input recovery, and fail-closed input lease acquisition.
- Portable Node/native bundle, preserving installation, update and rollback.

Local evidence includes automated tests, native fixture workflows, real Agent Manager two-session acceptance and physical Smart takeover/Resume. Mixed-DPI hardware and code signing remain unverified. See VALIDATION.md for precise boundaries.
