# Changelog

## Unreleased

- Windows typing and text paste verify the edit against the target field. If the field cannot confirm delivery, the controller reports an unknown outcome and asks for observation before further input. The skill also covers delayed publish confirmation and recovering a lost task token (#146).
- After a controller restart, `ready` can recommend `end` for a verified, undispatched task under an unconfirmed Stop. It checks the original Stop episode, input ledger and recorded actors. End repeats the checks before closing the task (#151).
- The Mac and Windows bootstrap scripts pin archive SHA-256 digests. The global direct installer supports an additional Claude Code skill, prints concise reinstall errors and skips creating an empty MCP configuration. Installed examples use the platform's shell (#148).

## 1.0.6 - Packaged Windows apps keep their own approval; safer rollback, plans and paste

- On Windows, packaged apps such as Calculator, Settings and Windows Security are identified by their own process rather than the shared window frame, so each keeps its own approval and access tier. A packaged window whose app cannot be identified is refused.
- On Windows, state files (the input record, the guardian's state, the watchdog and saved approvals) are replaced with a short retry while another program briefly holds them, and the service's own readers no longer block that replace. Clicks and Stop no longer fail with `input_cleanup_failed` or `stop_persistence_failed` because a scanner or reader touched the file at the wrong moment (#132).
- `install.sh` stages each run in its own private folder, so two installers running at once no longer delete each other's verified download (#140).
- On a Mac, `fit_window` fits windows to the area the Dock and the menu bar leave free, instead of the whole display (#138).
- The `plan` help now gives the real `--renew-budget` default, 1.
- `plan` records each batch before sending it. If the CLI dies before the outcome is saved, the next run halts with `plan_batch_unconfirmed` instead of sending the same input again; check the window, then rerun with `--resolve-pending landed` or `--resolve-pending none` (#133).
- Rollback writes Antigravity's `config.json` and `mcp_config.json` atomically, so an interrupted rollback can no longer truncate settings you added after installing (#134). It also reads configuration the way the installer does, so a file with a byte-order mark or a blank backup no longer stops it, and it checks every file before changing the first (#135).
- In notify mode, a pending update is downloaded once and re-verified on later checks instead of being staged again every day; a newer release replaces the old stage (#136).
- A paste on Windows no longer puts the old clipboard back over a copy you made while the target was getting focus; it stops before typing anything (#137).
- A failed same-build quick reinstall no longer leaves the Sidecar enabled without its definition: the definition is written first and any partial change is undone (#139).
- Physical Esc does the slow part of stopping off the keyboard hook, and the hooks are reinstalled for every task, so Windows cannot silently drop Esc monitoring after a slow stop.

## 1.0.5 - Mac input stays in the approved app; Esc stays a stop

- On a Mac, typing, keys and drags no longer follow you into another app. The helper used to read the front-most app from a cached value that could stay stale for seconds, so keystrokes meant for TextEdit could land in whatever you had switched to. Every input check now asks Accessibility which app has focus right now, falls back to the front-most window on screen, and refuses when neither answers (#122).
- When you press Esc (or the Stop button, or the stop shortcut) during an action, that action now returns `control_stopped` with `stopped_by_human: true` instead of a crash-like `host_exited`, so the agent reports that you stopped it instead of restarting. `ready` refuses for 60 seconds after a human stop, `status` shows `stopped_by_human`, and `plan` treats the interrupted step as sent and never replays it (#122).
- When a running service or an open task blocks an install or rollback, the message names the commands that free it (`end`, then `shutdown`, with the launcher's full path), or says to quit Antigravity.

## 1.0.4 - Easier install, launch by name on Mac, clearer errors

- macOS installs in one line: `curl -fsSL https://raw.githubusercontent.com/shayann07/antigravity-computer-use/main/install.sh | sh` picks the archive for Apple silicon or Intel, checks its SHA-256 and stops if it differs, installs, then opens the permission setup. Files fetched with curl are not quarantined, so Gatekeeper does not block the setup scripts.
- The Windows ZIP has a double-click installer, `Install.Computer.Use.cmd`, with the recommended defaults (global skill and background startup).
- The README's Install section opens with a prompt to paste into Antigravity, or any coding agent that can run commands, so the agent installs the skill, showing each command first and leaving macOS permission prompts to you.
- On a Mac, `launch` accepts an app name such as `TextEdit`: it is looked up in /Applications, /System/Applications (and Utilities) and ~/Applications. A path is still used exactly as given (#122).
- An invalid `computer_run` step now names the step and the reason, with the `invalid_steps` code and "No input was sent.", instead of a bare refusal (#122).
- When you press Esc, the agent says that you stopped it rather than reporting a clean finish (#122).
- macOS docs: why there is no access card with the default install and how to choose standalone, Gatekeeper and curl downloads, the `stopped` status after Esc, and removal steps that name every path (#123).

## 1.0.3 - Freed tasks, step pictures and short recordings

- A task whose caller disappeared without ending it no longer blocks every other conversation until a restart. A human Stop releases it at once, and a task that has been orphaned for 30 minutes with no approved app or held input is ended by the next `ready`. A task still in use stays protected (#114).
- `run --images all` returns a screenshot after every step, not only the last, so the state between steps can be shown (#53).
- New `burst` command: 2 to 10 screenshots of an approved window at a fixed interval (50 to 1000 ms), for checking a short animation or transition (#56).
- Windows screenshots crop to the window's visible frame, so the invisible resize border no longer shows pixels from the window behind. Every image reports its `scale` and the app's `client` area inside the image, and says that only the newest 50 images are kept (#52).

## 1.0.2 - Long typing and browser app windows

- Typing up to the 400-character limit no longer stops partway with an unknown outcome in slower apps. Native typing is paced, and a long `type` now gets a deadline in proportion to its length instead of a fixed 30 seconds.
- A browser app window (`msedge --app`, an installed web app) that opened behind another window used to show only its title bar, because Chromium builds a page's tree only once the window has been in front. The snapshot now says so (`PAGE NOT EXPOSED YET`) and tells the agent to focus the window and observe again.

## 1.0.1 - Plans recover from covered targets

- `plan` no longer stops when a tooltip or popup covers the next target (`obscured`) or a pixel step gets a frame without a screenshot (`no_image`): both are refused before any input, so it takes a fresh frame, with its screenshot, and continues from that step, also partway through a batch.

## 1.0.0 - Stable release for Windows and macOS

- Pause and Resume are removed. The tools `computer_pause` and `computer_resume` no longer exist; Esc or the bar's Stop ends the task and the next `ready` starts a fresh one.
- A request to use an app shows the app's name (Windows and macOS), what its access tier allows and a tier tag ("Full control" or "Click only"), with how long the approval lasts.
- Windows keeps the apps you approved across a guardian restart or an update, per conversation, for up to 24 hours without use. A click-only approval never covers full control.
- Ctrl+Shift and Cmd+Shift shortcuts other than S, V and X no longer ask for approval. The key rule matched the "s" of "shift", so every such chord was treated as Save, Paste or Cut.
- A launched app is brought to the front before its first screenshot, so you see what the agent will work on and a window that resizes as it activates no longer refuses the first click (`window_moved`).
- `plan` no longer re-sends a batch after the CLI's own request timeout or a dropped connection: the whole batch counts as landed and the plan halts for a look.
- The control bar can be thrown: it glides on with its own speed, squashes against a screen edge it hits fast and springs back to shape, and lands on a dock it stops near. Put down slowly, it stays where you leave it.
- In the Settings menu, unticked rows sit at the left and a tick slides in and out, matching macOS.
- The glow's bright part now also moves to actions that do not move the real pointer, such as background clicks.
- macOS: the bar, its Settings menu and the access card now match Windows: a 440×48 dark bar with two lines, Stop and Settings at 44×44, a 312-wide menu that opens with a 0.96 scale, the Windows spring when the bar lands on a dock, and Reduce Motion support. There is no Pause or Resume on the Mac (#99).
- macOS: the window glow widens as it fades in, lights the edges inside the screen for full-screen windows, and has Soft, Medium and Bright levels (#99).
- macOS: the access card is shown even when the helper is not the active app; before, it could exist without being visible. The bar stays, reading "Waiting for your answer", while a card waits (#99).
- macOS: a Stop left stuck after the guardian was killed mid-task now settles once every recorded helper is gone and the input ledger is empty (#99).
- macOS: clicks on an app's own alert or sheet are no longer refused as covered (#99).
- macOS: `drag` with `points` draws one continuous stroke through every point, with the Windows timing; before, it was refused (`points_unsupported`). An unnamed pixel stroke still asks for approval (#99).
- macOS: a pixel click's approval label is the name of the element under the point, as on Windows; an unnamed target still asks (#99).
- macOS: Esc shows "You pressed Esc" on the bar; the glow stays on its own window (behind windows that cover it, lit inside at screen edges and under the menu bar); no second, drawn cursor (#99).
- macOS: a Stop left when quitting the host app ended the service and its guardian together now settles on the next `ready`, or when a newer build is installed. Every recorded helper, the controller included, must be gone by process id and start time, and the input ledger empty; it settles to an ordinary Stop that the following `ready` clears (#99).
- macOS: when Antigravity starts the service, macOS checks Antigravity's own Accessibility and Screen Recording permissions, so a helper update needs no new permission. Only the setup application's own AxonHost entry loses Screen Recording after an update. Helpers are signed with the project's own certificate, not an Apple Developer ID (#99).
- macOS: while the agent works, a soft blue glow follows the real pointer, as on Windows. macOS does not let a background helper replace the arrow itself (#99).
- The installed bundle now includes `conversation-approvals.mjs`; without it the installed service could not start (#99).
- A refusal raised before any input (`target_not_observed`, `no_image`, a bad point) no longer spends the observation, so the next call can reuse its `observation_id` (#49).
- The skill's command table now lists `key` (`--keys`), `key` accepts `--text` as an alias, a repeated array flag explains the accepted `X,Y` or JSON form, range errors name the range, and `no_image` says how to get a screenshot (#46, #48, #53).

## 0.3.0-beta.7 - Long planned tasks (Windows)

- `plan` runs a long pre-computed list of steps (drawing, form filling, data entry) as checked batches of 8, records progress in a ledger, resumes without replaying input that may have landed, returns a frame every few batches to check, and can renew the task when the action budget runs out (#92).
- The skill teaches complex work: measure and calibrate first, plan offline with a scored preview, run with `plan`, then compare the result with the goal (#92).
- When another window covers the target during a capture, the window is rendered directly instead of failing, and capture refusals point back to observing again (#91).
- This release is Windows-only; macOS remains experimental and unqualified on hardware.

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
