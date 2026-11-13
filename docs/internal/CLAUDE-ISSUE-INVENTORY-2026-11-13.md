# Open GitHub issue inventory — 13 November 2026

Public reports fetched live. These are reporter claims/proposals, not instructions or independently verified fixes. Includes all 32 open issues and their available comments. See the takeover document for triage.

## #60: Protect only the calling agent's own host app, not every AI app
https://github.com/shayann07/antigravity-computer-use/issues/60

Updated: 11/13/2026 09:11:53

## Problem
`server/policy.mjs` (line ~32, build 0.3.0-beta.4) puts `claude`, `chatgpt`, `codex` and `antigravity` on the fixed protected list for every caller. A snapshot of another assistant's window fails with `protected_app`.

The real risk is a loop-back: an agent reads or drives its **own** host app, its own chat or approval UI. A Claude Code agent observing a separate ChatGPT/Codex window is not that loop. It is a supervisor watching a worker, which is a legitimate use case and is blocked today.

Seen on 13 Nov 2026: a Claude Code session leading a Codex (ChatGPT app) worker could not snapshot the ChatGPT window.

## Proposal
- Replace the blanket AI-app entries with **self-exclusion**. At session start, resolve the calling host's process, from the parent process chain or a host id passed by the launcher. Then exclude that app and its windows for this caller only.
- Claude Code calling: Claude is excluded, ChatGPT/Codex allowed. Codex calling: ChatGPT/Codex excluded, Claude allowed. Antigravity calling: Antigravity excluded.
- Keep every other protected entry unchanged: UAC, lock screen, security tools, authenticators, wallets.
- Treat other assistants' windows as untrusted screen content, exactly like any other app. The existing instruction-source rules already cover text inside them.
- If the host cannot be resolved, fall back to today's blanket list (fail closed).

## Acceptance
- From Claude Code, `snapshot` of a ChatGPT window succeeds, and a Claude window still returns `protected_app`.
- From Codex, the reverse holds.
- An unresolvable host keeps the current behaviour.
- `ready`/`status` report which app is self-excluded.

## #59: SKILL.md is 21 KB with 15 lines over 400 chars: split a short core from reference
https://github.com/shayann07/antigravity-computer-use/issues/59

Updated: 11/13/2026 08:57:08

## Problem
SKILL.md is about 21 KB over 151 lines, with 15 lines longer than 400 characters (longest 1282). It mixes the must-read fast path, physical handoff rules, the observation loop, dialogs, permissions, recovery and failure reporting in one file, plus two reference files. In agent context it is often truncated or skimmed, and the dense paragraphs hide the rules that matter most. Evidence of the cost: #46 (key missing from the quick reference, agents guess flags), #48 (undocumented array arguments), and the 13 Nov 2026 stall, where the recovery rule for `recovered_task` sits in one long paragraph that contradicts itself (call `end`, but stop if End says `inspect_prior_input_cleanup`).

The "weak-model fast path" is also not first: other text precedes it and several hundred lines follow it.

## Proposed fix
- SKILL.md: at most about 4 KB, no line over about 200 characters. Contents: the ready command, the fast path, the loop (ready, snapshot, act, verify, end), a command table including key with its flags and array syntax, and a pointer table to references.
- Move physical handoff, dialogs, permissions, failure reports and every recovery state into `references/*.md`, loaded only when a reply names them (see the actor/command issue).
- Generate the command table from `describe` output so it cannot omit commands (#46) or flags (#48).
- CI check on size and line length, plus a smoke test where a low-effort model completes ready, launch, snapshot, key, end using only the short file.

## Acceptance criteria
- SKILL.md under 4 KB with no line over 200 characters, enforced by a check.
- The command table lists every command `describe` lists, including key and array-valued flags, verified by a test.
- A recorded low-effort-model run completes the basic loop and handles a `ready:false` reply by loading only the referenced doc.
- No rule is lost: a checklist maps each old paragraph to its new location.


## #58: ready and status should expose task age, owner hint and held resources, so a leftover task can be told from a live one
https://github.com/shayann07/antigravity-computer-use/issues/58

Updated: 11/13/2026 08:57:06

## Problem
When `ready` reports `task_open:true`, nothing says whose task it is, how old it is, or whether it is alive. SKILL.md asks the agent to "establish it is your task and no other conversation owns it" before `end`, but gives no way to establish that, and #7 records that task state is not authenticated. The result is guesswork either way: end a possibly live task, or stop and block the owner.

Evidence (13 Nov 2026): the reply for a recovered task carried `task_open:true`, `recovered_task:true` and an incident id, with no timestamps, action counts, grants, lease state or process identity. In #47 the only signal of a dead leftover was inferring it from an empty approved-apps list and an unused budget.

## Proposed fix
Add a read-only `task` block to `ready` and `status`: `opened_at`, `last_action_at`, `age_s`, `actions_used/limit`, `approved_apps` count, `grants_held`, `input_lease_held`, `opened_by` (host-provided identity or process id and start time when available, never a model-supplied credential, consistent with #7), `controller_restarted_since_open`, and a derived `liveness: active|idle|orphaned` with the rule that produced it. Give the opening caller a handle it keeps, so it can prove "this is mine" without inference (a coordination aid, not a security boundary).

## Acceptance criteria
- `ready` on a recovered task shows age, last action time, grants, lease state and a liveness verdict, with no side effects and no input.
- A caller that opened a task can prove ownership; any other caller gets `owner: other|unknown` instead of silence.
- A task idle beyond a stated threshold with no held resources is labelled `orphaned` with the evidence.
- Tests cover fresh, active, idle, restarted and orphaned tasks; docs say plainly this is not authentication.


## #57: Every blocked reply should say who acts next and the exact command (actor, command, safe_when)
https://github.com/shayann07/antigravity-computer-use/issues/57

Updated: 11/13/2026 08:57:05

## Problem
Blocked states return a `next_action` name, and SKILL.md then explains in prose what to do. Several of those instructions end at "stop and report that operator inspection is needed" with no way for the operator to proceed. Examples in SKILL.md: `inspect_prior_input_cleanup` (older records and Mac stay blocked), `inspect_stop_persistence_without_restart`, `inspect_input_cleanup`, `guard_persistence_failed`, `stop_persistence_failed`, `resolve_version_mismatch`.

Evidence (13 Nov 2026, build 0.3.0-beta.4, host-managed): a fresh agent ran `ready` and got `ready:false`, `recovered_task:true`, `next_action:inspect_prior_input_cleanup`, error `recovered_cleanup_unverified` (incident f5c2f697494428984b5f98a0). The skill says to stop and report. Then, in the same session:
- `controls` was refused with the same code ("Verify its native input cleanup before showing controls or re-arming"), incident 99e524c0eb854aea45d86fb7.
- a single `end` was refused with the same code ("Keep the task open and inspect the previous native ledger"), incident b91c7fff6eb4d365a08db172.

So even a human who wants to re-arm cannot get the control bar shown, and the one agent-side recovery the skill documents is refused. It is a complete dead end with no documented human path. Every new agent session in that state is dead. Related: #47, #9, #26.

Three readers need different things and the reply serves none well: the agent (can I act?), the human at the desk (what do I click?), the operator (what do I inspect, where?).

## Proposed fix
1. Add a machine-readable `recovery` object to every `ready:false` reply: `{actor: agent|human|operator, command, safe_when, blocks, docs}`. One enum, generated from the same table the runtime uses.
2. For human and operator states, ship one documented entry point (for example `cu.mjs recover --incident <id>`, or a control-bar button) that explains the problem in plain words, shows the evidence, and offers the safe action. No private-storage spelunking.
3. `controls` must be able to show a read-only bar (Stop and re-arm only, no automation input) even when cleanup is unverified, so the human always has a visible path.
4. Every dead-end state needs a path out, or an explicit reset instruction with the exact command. An `operator` state with `command: null` should fail a build-time check.
5. Replace the prose recovery list in SKILL.md with a pointer to `recovery.command`, so the skill cannot drift from the runtime.

## Acceptance criteria
- Every `next_action` value in the runtime enum has an entry with actor, command (or a documented reason for none) and safe_when; a test fails when a value is added without one.
- In the `recovered_cleanup_unverified` state, `controls` shows a bar, and the reply names a self-serve command or a single human action, with no need to read SKILL.md.
- A fresh agent with only the `ready` reply states correctly who must act and what to do, shown in a recorded test with a weaker model.
- No state tells the agent to stop without saying who can resume.


## #56: Feature: short recording or burst capture of a window
https://github.com/shayann07/antigravity-computer-use/issues/56

Updated: 11/12/2026 21:42:42

**Feature request: short recordings or burst capture**
Checking a one-second UI animation (a progress fill finishing, a dialog closing) is not possible with single snapshots, which take about 0.8 s each here. I had to start ffmpeg `gdigrab` myself, and grabbing the window by its title captured only black frames for a WebView2 window, so I recorded the whole desktop instead (which also captures unrelated windows).

**What would help**
`record --hwnd H --seconds N [--fps 10] [--region x,y,w,h]` returning a short video or a contact sheet of frames, captured the same way snapshots are (so WebView / DirectComposition windows are not black), cropped to the target window, under the same approval rules.

Environment: 0.3.0-beta.4, Windows 11.


## #55: After end, ready still reports task_open: true and controls_visible: true
https://github.com/shayann07/antigravity-computer-use/issues/55

Updated: 11/12/2026 21:42:40

**What happened**
Right after a successful `end` (`{"ok":true,"ended":true,"state":"idle"}`), `ready` returns `task_open: true`, `control_reason: "completed"`, `approved_apps: []` and `controls_visible: true`. Reproduced three times in one session. SKILL.md says not to end a task you cannot show is yours, so an agent reading `task_open: true` cannot tell whether it may continue, whether another caller owns a task, or whether `end` failed. `controls_visible: true` is also reported although the passive start should not show the bar.

**What would help**
After `end`, report `task_open: false` (or a separate `last_task: { ended_at, owner_hint }`), and report `controls_visible` only when the bar is really drawn.

Environment: 0.3.0-beta.4, Windows 11, host-managed.


## #54: 'obscured' at top centre blames 'another Claude session's banner'; probably the controller's own bar (#33)
https://github.com/shayann07/antigravity-computer-use/issues/54

Updated: 11/12/2026 21:49:27

**What happened (observed only)**
A pixel click on a button near the top of the target window was refused twice with `obscured`: "Another Claude session's on-screen banner is over that control, so a real click would press their banner instead", hint "Target it by index or selector". The point was at roughly the top centre of a 1920x1080 screen (about x 1090, y 75). No other Claude session was driving this desktop. Clicks elsewhere in the same window, with the same windows open, went through.

My first reading (that the host app's window covered the target) does not hold: other clicks passed with the same window order, and a desktop grab may not show the banner. The most likely cause is the controller's own control bar at the top centre, which is #33.

**What would help (on top of #33)**
- Name the right thing in the message: if it is this controller's own bar, say so and offer to move or hide it for the next action, instead of pointing at "another Claude session".
- Suggest index or selector targeting only when the tree has a matching node (in this app the tree had none; see #50).

Environment: 0.3.0-beta.4, Windows 11, host-managed.


## #53: A pixel step after an action is refused mid-batch, after earlier steps already sent input; batches return only the last image
https://github.com/shayann07/antigravity-computer-use/issues/53

Updated: 11/12/2026 21:42:37

**What happened**
- `run --step click --x .. --y .. --step key --keys .. --step click --x .. --y ..` failed at step 3 with `no_image` ("Observe with_image first"), after steps 1 and 2 had already sent their input. The same happens outside batches: `key` (without `--image`) followed by `move --x --y` is refused.
- A two-step `run` (click, then Escape) returns only the final image, so the agent cannot show the state between the steps; I had to repeat the flow as separate calls to prove the first step worked.

**Why it matters**
For apps whose controls are only reachable by pixels (see the WebView tree issue), a batch can hold at most one pixel step, and the refusal arrives after earlier inputs already ran.

**What would help**
- Check the whole batch before sending any input (refuse up front if a later pixel step will need an image the batch cannot provide), or let a step say `--observe-image` so the runtime captures and the next pixel step can use it.
- Optionally return the image after each step (`--images all`).
- Make the single-call error say which earlier call should have used `--image`.

Environment: 0.3.0-beta.4, Windows 11.


## #52: Images: scale cap not reported, pixels from the window behind included, old images dropped silently
https://github.com/shayann07/antigravity-computer-use/issues/52

Updated: 11/12/2026 21:42:35

Three related problems with the images that replies carry:

1. **The scale is not reported.** Images are physical pixels capped at 1400 px wide. A 1294x808 (logical) window at 125 % came back as 1400x873; a smaller window came back 1:1. The reply gives `width`/`height` but not the factor, so an agent reading coordinates off a capped image has to guess it. Please return e.g. `image.scale` (image px per physical px) and the window's client rect inside the image.
2. **Pixels from the window behind are included.** With the target window at 800x560, the right and bottom edges of the image showed text from another app's window behind it (the invisible resize border). That is another app's content in the agent's image. Cropping to the visible frame (`DWMWA_EXTENDED_FRAME_BOUNDS`) instead of the window rect would fix it.
3. **Old images disappear silently.** The observation store seems to keep about 50 images; a picture taken 40 minutes earlier, which I wanted to show the user, was gone. Please document the retention in SKILL.md and in the reply (e.g. `image.expires_after`), or offer `--keep` / an export path.

Environment: 0.3.0-beta.4, Windows 11, 125 % display scaling.


## #51: No way to set a window's size for responsive checks
https://github.com/shayann07/antigravity-computer-use/issues/51

Updated: 11/12/2026 21:42:33

**What happened**
Checking a desktop app's layout at 800x560, 900, 1000, 1100 and 1280 px needed the window resized. The controller has `fit_window` (shrink to the work area) but no way to set a size, so I wrote my own user32 `SetWindowPos` script. Windows PowerShell 5.1 is not DPI aware, so at 125 % scaling my first attempt produced a window 25 % too large, and I only noticed from the screenshot.

**What would help**
`resize_window --hwnd H --client-width W --client-height H [--units logical|physical]`, refusing windows that are not resizable, and replying with the resulting client size in both logical and physical pixels. Responsive checks are one of the main reasons to drive a real app.

Environment: 0.3.0-beta.4, Windows 11, 125 % display scaling.


## #50: WebView2 (Tauri) content is missing or partial in the accessibility tree, so names and waits do not work
https://github.com/shayann07/antigravity-computer-use/issues/50

Updated: 11/12/2026 21:42:32

**What happened**
Driving a Tauri 2 desktop app (its UI is a WebView2 page), the first `snapshot` of the main window returned only about 10 nodes: the window frame, the title bar and an empty "Web content" pane. `--query <a visible button label>` returned 0 nodes. So every name/index action, `wait --until` and `wait_change` was unusable, and the agent had to fall back to pixel clicks.

The web content appeared later (after a `file_dialog` call; on a later launch it was there at once), but even then the tree was partial: it listed the 2 or 3 buttons in the bottom bar, but not the title bar's buttons, the left rail, an open side panel, or an open modal dialog (the dialog was on screen and the tree still listed the controls behind it). A `wait --until` for text further down a scrolled panel did not match.

**Why it matters**
Pixel targeting is the slow, fragile path, and with an empty tree the skill's own advice ("target it by index or name") cannot be followed. An agent also cannot tell an empty tree from a page with no controls.

**What would help**
- Say so in the reply: e.g. `web_content: "absent" | "partial"` plus a hint, instead of a silently short tree.
- Wake the WebView2 / Chromium UIA provider before the first snapshot (it is lazy until a UIA client asks; Chromium also honours `--force-renderer-accessibility`).
- Include open dialogs (`aria-modal`) in the tree, or document that they are excluded.

Environment: 0.3.0-beta.4, Windows 11, 125 % display scaling, host-managed, manual takeover.


## #49: Hover UI stays open after a click; refused clicks spend the frame; launch can return a helper window
https://github.com/shayann07/antigravity-computer-use/issues/49

Updated: 11/12/2026 21:42:44

## What happened

While walking through a desktop app (Tauri / WebView2) several things made the loop slower than it needed to be:

1. **The cursor stays where the last click was.** After clicking near an edge control, the app's hover UI (a side panel that opens on hover) stayed open and covered the next screenshot. A later click at a nearby point then landed on the open panel, not on the page. There is no option to move the pointer out of the way after an action.
2. **A refused named click spends the frame.** `click --name ...` that fails with `target_not_observed` (no input sent) is followed by `stale_observation` on the next call that reuses the same `observation_id`, so one extra snapshot is needed. Since no input was sent, the frame arguably could stay valid.
3. **`launch --observe` returned the wrong window.** The app has two top-level windows (the main one and a small helper window). The returned `hwnd` was the helper's, so the first snapshot showed a small unrelated surface. `apps` was needed to find the main window.
4. **Screenshots can catch a transition.** A capture taken a few hundred milliseconds after a click showed the page half-faded in (the app fades pages in over about 300 ms). `--settle-ms` helps, but it is a fixed delay (max 2000), so each caller guesses.

## Suggestion

- Add `--park-cursor` (or a default off-screen-edge park after each action) so hover UI closes before the observation.
- Do not consume the observation when the action is refused before any input (`target_not_observed`, `bad_arguments`).
- In `launch`, return the window list or pick the largest visible top-level window of the new process.
- Offer `--settle stable` that waits until two consecutive frames match (with a cap), in addition to the fixed delay.

Related: #13 (idle cleanup during long agent gaps) and #33 (banner overlap on top-center clicks) are about the same family of "the controller's own state affects what the agent sees".

Observed on build `0.3.0-beta.4`, Windows.

### Comment — 11/12/2026 21:42:44

Another repro of "launch can return a helper window", plus a gap in `apps`:

- A Tauri app that opens a main window and a small always-on-top helper window: one `launch --observe` returned `observe_pending` ("Several matching windows opened"); a later `launch --observe` returned the **helper** window's handle directly, and a follow-up resize of "the launched window" resized the helper by mistake.
- `apps` lists both windows with title and process name only. Two installs of the same app (same exe name, different folders) can only be told apart by title. Please return `pid`, the executable path and owner/tool-window flags in `apps`, and let `launch` take `--window-title` to pick the main window.


## #48: Array arguments (drag --from/--to) are undocumented, and several errors do not say what to do
https://github.com/shayann07/antigravity-computer-use/issues/48

Updated: 11/12/2026 18:45:22

## What happened

Driving a desktop app with `drag`, using the shape the quick-reference shows for other commands:

```
cu drag --hwnd H --observation-id F --from 700 --from 260 --to 820 --to 300 --steps 30 ...
```

failed with `bad_arguments: Duplicate argument from. No desktop request was sent.` Nothing in SKILL.md or the quick-reference table says how an array parameter (`from`, `to`) is written on the command line. `describe drag` shows `"type":"array"` only. Passing JSON worked:

```
cu drag ... --from '[700,260]' --to '[820,300]' --steps 30
```

Two more small things in the same area:

- `--settle-ms 2200` is refused with `arguments.observe.settle_ms is outside the allowed range`. The message does not give the range (0 to 2000 per the schema), so it takes a second call to find it.
- In `run`, a `key` step followed by a pixel `click` step is refused with `no_image: Observe with_image first.` The message does not say that the batch must be split, or that the next step needs its own screenshot.

## Suggestion

- Add one line to the quick-reference: array arguments are JSON, for example `--from '[x,y]'`.
- Accept the repeated-flag form for numeric arrays, or print the accepted form in the `bad_arguments` message.
- Put the allowed range in range errors (`allowed 0 to 2000`).
- Make the `no_image` message actionable ("a pixel click needs a screenshot you have seen; end the batch, observe with `--image`, then click").

Related: #46 (the quick-reference omits key command flags).

Observed on build `0.3.0-beta.4`, Windows.


## #47: A recovered leftover task blocks the control bar and the error does not say how to recover
https://github.com/shayann07/antigravity-computer-use/issues/47

Updated: 11/13/2026 09:01:53

## What happened

At the start of a new session `ready` returned:

- `state: stopped`, `task_open: true`, `recovered_task: true`, `control_reason: persisted_emergency_stop`
- `error.code: recovered_cleanup_unverified`, `next_action: inspect_prior_input_cleanup`

The human asked for the control bar so they could re-arm. `controls` was refused with the same error ("Verify its native input cleanup before showing controls or re-arming"). `status` showed no approved apps, no live grants and an unused action budget (200 of 200), i.e. a dead leftover of an earlier task.

The only way out was the SKILL.md instruction to call `end` once. That worked (`ended: true`), and the next `ready` then returned `awaiting_human_rearm` with `controls_visible: true`, so the human could re-arm.

## Why this is a usability problem

- The error and `next_action` name the problem but not the step. A person or a model that does not have SKILL.md in context has no way to learn that `end` is the recovery. `inspect_prior_input_cleanup` reads as "go and investigate", and a careful agent will stop and report instead.
- The human was left looking at a controller that refused to show its own bar, with nothing on screen saying why.
- Calling `end` is only safe if the task is really a leftover. Today the agent has to infer that from `approved_apps: []` and a full action budget, which is guesswork.

## Suggestion

1. Put the recovery in the reply itself, for example `next_action: end_recovered_task` with a one-line `hint` such as "If this task is a leftover of your own session, run `end` once; then re-arm from the control bar".
2. Include in `status` and `ready` the evidence that decides whether it is safe: age of the task, number of actions used, whether any grant or input lease is still held, and the process that opened it.
3. Let `controls` show the bar (read-only, no input) even when `recovered_cleanup_unverified` is set, so the human can see and press Stop or re-arm without the agent doing anything first. It sends no input, so it should not need a verified cleanup.

Related: #9 (verify the previous native input ledger before ending a recovered task), #26 (preserve an unconfirmed native Stop across restart), #7.

Observed on build `0.3.0-beta.4`, Windows.

### Comment — 11/13/2026 08:57:03

Second occurrence, 13 Nov 2026, build 0.3.0-beta.4, host-managed. A new agent's first `ready` returned `ok:true, ready:false, task_open:true, recovered_task:true, next_action:inspect_prior_input_cleanup`, error `recovered_cleanup_unverified`, incident f5c2f697494428984b5f98a0.

Follow-up evidence from the same session:
- `controls` was refused with `recovered_cleanup_unverified` ("Verify its native input cleanup before showing controls or re-arming"), incident 99e524c0eb854aea45d86fb7.
- A single `end` was refused with the same code ("Keep the task open and inspect the previous native ledger"), incident b91c7fff6eb4d365a08db172.

So even a human who wants to re-arm cannot get the control bar shown, and the one documented agent recovery (`end` once) is refused too. This is a complete dead end with no documented human path. It differs from the first report here, where `end` succeeded.

The skill also contradicts itself for this state: the recovered-task paragraph says to call `end` once if the task is yours, but also says to stop and report if End reports `inspect_prior_input_cleanup`. And the agent cannot tell whether the task belongs to another open conversation (see #7), because `ready` gives no age, owner hint or action count. Suggestions 1 to 3 in this issue would have unblocked it. The general contract problem is filed separately (actor and command in every blocked reply).

### Comment — 11/13/2026 09:01:52

Follow-up, build 0.3.0-beta.4: after stopping the sidecar process and a fresh one auto-starting, ready, end and controls still return recovered_cleanup_unverified (receipt prefix 30280). The leftover-task record survives a full sidecar restart; no supported path back to a working bar for agent or human.

## #46: Skill quick-reference omits key command flags; run --step key --text is rejected
https://github.com/shayann07/antigravity-computer-use/issues/46

Updated: 11/06/2026 13:07:42

Observed by an agent (Claude Code, Windows, build c93b8fcb) following SKILL.md.

**Repro**
1. Follow the skill's fast path and try to reload a page with a batched key step, using the same flag style as the other steps: `run ... --step key --text F5 --step wait_change ...`
2. The runtime answers `bad_arguments: Unknown flag --text` (no desktop request sent, so nothing unsafe happened).
3. The correct form only appears after `describe key`: `key --hwnd H --observation-id F --keys F5 --risk routine --reason ...`.

**Why it matters**
The skill's table lists launch, snapshot, click, set_value, file_dialog, run, wait, wait_change, close_window, end and status, but not key. Keyboard input is a very common step, and weaker models guess `--text` by analogy with set_value/type. Each guess costs a round trip and records an incident.

**Suggested fix**
Add a `key` row to the command table (`--hwnd H --observation-id F --keys CHORD --risk routine --reason TEXT`), and note that `--keys` (not `--text`) is used inside `run --step key`. Also consider accepting `--text` as an alias.

## #43: Mac Smart takeover may classify native consent-dialog input as human takeover
https://github.com/shayann07/antigravity-computer-use/issues/43

Updated: 11/01/2026 22:35:13

## Original source-level finding; physical reproduction pending

The active Smart-mode monitor exempted only the HUD rectangle. Standalone NSAlert hid that HUD without a native-modal exemption, so Allow/Deny interaction could enter the deliberate-input pause path. Prompt completion could then publish the guardian's older active state over that pause. This concerns sensitive confirmations and incremental grants during an active task; the initial idle app grant is a distinct case. No physical Mac failure, unintended action or permission bypass is claimed from source inspection.

## Repair candidate — not qualified or released

PR #36, source 4dc7914e9df5adb574acdf83208884780a989022:
- Birth-time-bound guardian identity plus public AX focused-window/modal ownership. Pointer exemption also requires matching native modal geometry and the frontmost covering window's owner. Keyboard exemption requires the foreground guardian; the HUD mouse rectangle no longer exempts typing elsewhere.
- Physical Escape/Ctrl+Alt+F12 remains before all UI exemptions. Missing AX data or foreign/unknown covers retain ordinary takeover.
- Approval completion matches the pre-dialog native session, state, grants and wall/monotonic deadlines; pause, Stop, changed identity/session or pending cleanup refuses publication.
- A separate private native transition lock serializes deliberate takeover with approval. It does not wait behind the input lock before revoking a drag. Stop latches independently.
- The human OS cursor is restored while the modal is open, and native pause/Stop/expiry is refreshed before control visuals return.
- No new desktop-action flag, model-provided approval or permission-policy change.

Native contract cases cover geometry/cover refusal, changed/expired/latched approval refusal and preserved takeover/cleanup while input is held. These send no desktop input, click no dialog and grant no real application. Windows-host shared tests: 509/522 pass, zero failures, 13 skips; that run cannot compile Swift. Prior a5b90dc native contracts passed macOS 26 ARM/Intel and macOS 15 Intel CI. The cursor refinement still needs fresh exact-head CI and physical qualification.

## Remaining acceptance

Follow [docs/MACOS-CONSENT-TAKEOVER.md](https://github.com/shayann07/antigravity-computer-use/blob/4dc7914e9df5adb574acdf83208884780a989022/docs/MACOS-CONSENT-TAKEOVER.md). Verify real human Allow, Deny, timeout, deliberate outside click/typing (including pointer over the old HUD), physical Stop, cleanup and a second task on the exact installed candidate. No repeated ordinary-approval loop; no stale approval may reactivate paused control or authorize queued work. Keep native app identity, permission and Stop checks intact. Preserve the user's selected policy. Keep this issue open until native and physical evidence supports closure.

## #38: Keep unmerged timing harness out of live qualification until delivery and ownership checks are repaired
https://github.com/shayann07/antigravity-computer-use/issues/38

Updated: 11/01/2026 16:30:54

Audited the remaining latency prototype at a44e532a74fe6863e8c31fd612af99a80ee1273a. These helpers are **not part of the published runtime or main**. PR #37 selectively adopted and repaired the comparison utility; it did not adopt time-call.mjs or benchmark-baseline.mjs.

Inert subprocess reproduction, with every fixture/evidence file under the checkout's ignored .localdata and no installed controller, desktop input, permission or Stop-latch access:

1. A fake CLI wrote a marker, sent no acknowledgement and then hung. The original timing wrapper killed it at its deadline and returned timed_out=true, exit_code=1, but delivery_uncertain=false. Killing a client is not proof an input did not run or cleanup completed.
2. With fake status replies shaped like the actual protocol, the baseline runner reported active_control_detected=false and attempted both apps and snapshot for state=active/task_open=true, state=idle/task_open=true and state=paused/task_open=true. Its guard checks active===true or state==='running', rather than the real states and explicit task reservation.
3. Without an internal timing packet, a fake successful reply containing receipt.elapsed_ms=7 produced service_ms=0 and module_load_ms=0. Unavailable milestones must not become zero-duration observations.

Required before adoption: preserve unknown delivery on timeout/truncation/lost acknowledgement; bounded confirmed child cleanup without taking over a shared service; refuse desktop-sensitive benchmarking unless task_open===false and appropriate idle/no-grant state is established; keep failed runs; represent unavailable phases as unknown; measure the explicitly selected installed build rather than silently invoking a worktree CLI. Do not bypass native ownership, permissions, Stop or storage guards.

The supported direct IPC client already reports lost acknowledgements as uncertain and requests cancellation. This issue concerns the unmerged diagnostic wrapper and benchmark scheduler, not a claim that current desktop actions were replayed.

Reviewed source SHA-256: time-call e21a9ade0f78e411ed1acdfe9ef8111cd72d1b47bed67b8f0374468b498e0e00; benchmark-baseline 62e3dbca3d711c5c83d1d224e21e8292ba1ccbe97da82bdd073861d4de60d41d. Private raw fixture evidence is retained locally. No real-app safety or latency qualification is implied by this reproduction.

## #33: Qualify and repair banner overlap during physical top-center clicks
https://github.com/shayann07/antigravity-computer-use/issues/33

Updated: 11/12/2026 18:53:22

Observed with the installed, published Windows v0.3.0-beta.4 build while testing stable Upscaly 1.0.9.

The physical click on the media-close control near the top-center of the application was refused with `obscured` and the message that another session's banner covered it. The failed batch sent no first click and skipped the remaining two steps. The task could close its own app and End cleanly. An earlier Flash run encountered the same refusal.

Investigate the exact covering window identity before attributing it to a specific controller. The native physical-click path recognizes in-process Overlay windows, while the guardian HUD is a separate process. Do not fix this by broadly ignoring all overlay windows or clicking through an unrelated controller. Preserve target identity, independent Stop and action-time occlusion checks. A qualified repair should move only this session's authenticated HUD out of the target region before input and verify the target again; test another session's overlay as a negative case.

The refusal itself was fail-closed. The user-facing message still contains upstream Claude-specific wording and misleading semantic-click guidance; correct that alongside the actual cause.

### Comment — 11/12/2026 18:53:22

Another observation for this one, from a Windows run on build `0.3.0-beta.4`.

A pixel click on a control near the top centre of the target window (a small close button on a centred chip) was refused with:

```
code: obscured
message: Another Claude session's on-screen banner is over that control, so a real click would press their banner instead.
hint: Target it by index or selector ...
```

Two things worth noting:

- It was refused correctly, which is good: nothing was pressed. But the banner is the controller's own, and it said "another session" although only one agent was active.
- The hint cannot be followed when the control is not exposed in the accessibility tree (a web-view button with only a `title` and no name). `snapshot --query` found nothing, so there was no index or selector to use. The only workaround was a different route to the same action (a keyboard shortcut).

Suggestion: let the agent nudge the banner out of the way (or let the controller move it automatically when a refused click targets its area), and say "this controller's banner" in the message when the session id matches the caller's own.


## #26: Preserve unconfirmed native Stop across controller restart
https://github.com/shayann07/antigravity-computer-use/issues/26

Updated: 11/02/2026 00:29:19

## Reproduced durability loss

A file-only probe at source 4dc7914 invoked the actual Windows ControlFence.LatchStop method and the actual shared Runtime with inert dependencies. Both replaced unconfirmed:<fixture> with stopped; a reconstructed Runtime then reported persisted_emergency_stop instead of guardian_stop_unconfirmed. The native Guardian.cs blob matches the published beta.4 source. No controls, native app grant, desktop input or physical re-arm were used. This proves loss of uncertainty metadata, not a demonstrated input bypass.

## Partial repair candidate

Draft PR #44; current source c5c616aee7f2e6576848c4452d8b828e9ba77659 (earlier persistence-only source fafb550):
- Ordinary native/shared writers do not overwrite existing uncertainty.
- A private, create-only, atomically published and file-flushed emergency.stop.unconfirmed companion survives Windows open-handle replacement failures and subsequent primary writes.
- Both native platforms and their independent observers honor both markers; human re-arm cannot clear unresolved uncertainty.
- Shared startup/status/shutdown, update preparation and installation/rollback retain the boundary. Switching is deferred/refused while recovery is unresolved.
- Bounded marker inspection refuses links and invalid entries; no model-controlled approval/re-arm field is added.

The initial atomic-primary-replacement prototype failed on Windows while a writer held the file open; that retained failure motivated the companion. A first full suite failed an undefined owner-stop fixture. Normal lifecycle uses stopped, and a separate regression preserves invalid bytes and refuses shutdown without controls.

Local source evidence: full suite 509/521 passed, 0 failed, 12 explicit skips, followed by 146 passing strict-reader/workflow/updater tests and 9 passing final native/file tests. All six exact-head CI checks passed at fafb550: Windows 510 pass / 12 skips, Mac Intel/ARM each 485 pass / 37 platform skips, zero failures; native compilation/contracts and fake-home packaging/update checks passed. These are file/transport/source tests, not physical delivery or power-loss qualification.

## Current-process receipt follow-up

The new source adds a fresh 32-hex nonce receipt from the original private child pipe, bound to OS PID, guard basename, stopped state, confirmed worker exit and input-journal cleanup. Runtime aborts its driver independently and settles only its own fresh uncertainty after both proofs, while retaining the ordinary Stop and human-only re-arm. Old/recovered uncertainty is never cleared by a new process receipt. End retains task evidence on uncertainty. BigInt IDs avoid Windows file-identity rounding.

Local full acknowledgement run: 519/531 pass, zero failed, 12 skips; later retention/native subsets passed. One bb425ea Windows job refused stale-owner cleanup while the PR/Mac jobs passed. That failure is retained. A PID-reuse window was identified; current recovery proves absence before helper spawn, unchanged metadata, and only its verified new helper can explain reuse. Live/foreign owners still refuse. The old log does not establish its precise cause.

Both current c5c616a Windows CI jobs passed (521/533 pass, zero failures, 12 skips); ARM Mac jobs passed, Intel checks still running at this update. These are source/headless fixtures, not physical acceptance.

## Still required; keep open

The current-process receipt protocol needs real native/physical qualification. A completed trusted recovery protocol for all recorded old-worker termination/held-input cleanup after restart is still absent; native End cleanup acknowledgement is also unfinished. An accepted pipe write is not native acknowledgement; an unrelated late stopped event cannot clear uncertainty. Preserve passive startup, permission boundaries and human-only re-arm. Never delete a marker or use model-provided flags to force qualification.

Qualify actual Windows/Mac failed writes, broken pipes, hung guardian, crash, queued/held input, restart, verified cleanup and human recovery. Arbitrary old executables do not honor the new companion; cross-version/manual-launch exclusion is not claimed. Existing installed beta.4 and frozen beta.5 candidate lack this repair. Prepare a new signed candidate and repeat affected acceptance after integration.

See [the scoped implementation and limits](https://github.com/shayann07/antigravity-computer-use/blob/c5c616aee7f2e6576848c4452d8b828e9ba77659/docs/STOP-UNCERTAINTY.md).

## #23: Fail closed when the Mac Stop latch cannot be inspected
https://github.com/shayann07/antigravity-computer-use/issues/23

Updated: 10/30/2026 02:30:25

## Finding

The Mac adapter used `FileManager.fileExists` to check the Stop latch. A dangling symlink or some inspection failures can appear absent, potentially allowing control or a stale state transition when Stop cannot be safely verified. Human re-arm also used a generic remove operation, which should not recursively remove a directory at the latch path. This is a source-level finding, not a reproduced physical bypass.

## Candidate fix

The pending change uses `lstat`: only a confirmed ENOENT means absent; an empty path, existing entry, dangling link or other error blocks control. Human re-arm uses `unlink`, refusing directories. A headless Mac contract fixture covers missing, invalid-parent and dangling-link cases. Mac CI, latch-write failures, physical re-arm/Stop and concurrent races remain pending.

## #22: Confirm a timed-out Mac watchdog exits before retry
https://github.com/shayann07/antigravity-computer-use/issues/22

Updated: 10/30/2026 02:08:25

## Finding

`MacWorkers.start` previously sent termination to a watchdog that did not become ready, then returned without confirming process exit. A delayed process could overlap a retry or write stale identity metadata. This is a source-level finding, not a reproduced physical-device collision.

## Candidate mitigation

The pending change kills the failed child, waits a bounded time for confirmed exit, and retains an unreaped process in the current guardian if termination cannot be verified. In that case it latches Stop and refuses another watcher. The native contract fixture exercises confirmed termination of an isolated child. Mac CI, guardian restart after an unconfirmed kill, real permissions, and physical Stop remain pending; do not infer full safety from the fixture.
### Comment — 10/30/2026 02:08:24

The pending fix also reassembles a bounded newline-delimited readiness message instead of assuming one pipe read contains the whole JSON, verifies `watchdog_ready: true` and checks the child is still running. A headless contract fixture writes readiness in fragments. Mac compilation and native execution remain pending.

## #21: Preserve native stopped state across concurrent guardian transitions
https://github.com/shayann07/antigravity-computer-use/issues/21

Updated: 10/30/2026 02:01:19

## Source finding

A Stop arriving concurrently with a guardian transition could leave a stale idle or paused state in the guardian UI even while the persistent Stop latch blocked native input. Windows changes state from a hook thread and a UI thread; macOS has an independent watchdog process writing the guard and latch. This can make re-arm confusing. No physical race was reproduced.

## Candidate mitigation

Windows state publication now checks a Stop generation and persisted latch; macOS rechecks the latch after publication. Isolated native state-resolution tests cover the policy. These checks do not prove cross-process atomicity, failed latch-write handling, or physical Esc/re-arm behavior. Mac CI, race stress, held-input cleanup and real-device qualification remain required.
### Comment — 10/30/2026 02:01:19

Candidate pushed to draft PR #6 at `a252658`: Windows tracks a Stop generation through publication and human re-arm; Mac rechecks the latch after publication. The isolated Windows native tests passed; Mac CI for this exact change is pending. This does not establish cross-process atomicity or physical race behavior, and failed latch writes still require explicit qualification.

## #19: Require independently armed Windows cleanup watchdog before native input
https://github.com/shayann07/antigravity-computer-use/issues/19

Updated: 11/01/2026 23:40:48

## Original source finding

Earlier Windows code treated failed CursorSafety.Apply as cosmetic even when the independent cleanup watchdog had not armed. Dispatch bookkeeping alone did not prove native monitoring. This was a source-level finding, not a reproduced physical-input failure.

## Shipped mitigation; not full qualification

Commit [fb9843d](https://github.com/shayann07/antigravity-computer-use/commit/fb9843d) is an ancestor of published beta.4. It retains monitoring after a cosmetic cursor failure, refuses active control when watchdog arming/liveness cannot be verified, checks the watchdog's live process/birth/image identity in the native fence and rechecks guard state afterward. Current metadata/identity regression exercises missing/malformed/stale/dead records and bounded transient revalidation without input. The old finding must not be read as an unchanged current implementation.

## Remaining acceptance and protocol scrutiny

Verify startup failure, missing/lost arming acknowledgement, retry/process exit, watcher exit during held input, cosmetic cursor failure with a still-armed watcher, actual crash cleanup and physical Stop. In particular, process identity and an in-memory monitoring flag alone are not independent evidence of fresh native arming; challenge late acknowledgement/reader reuse before claiming that guarantee. Preserve app identity, permissions, held-input journaling and Stop.

This issue stays open until those native/physical checks are proven on the exact candidate. Source/metadata tests and CI do not establish successful physical release or complete arming-protocol robustness. The separate Stop uncertainty downgrade repair in #44 does not by itself close this issue.
### Comment — 10/30/2026 01:41:38

Candidate change in progress: guardian refuses active control if monitoring did not arm, retains an armed watcher if cursor drawing alone fails, and the worker checks watchdog PID, process birth and executable on native fence checks. A compiled Windows reflection test covers absent/malformed/wrong-birth/exited identities without sending input; 100 valid checks took 23.1 ms in one local run. This is not end-to-end latency or physical crash/Stop evidence. The race between liveness check and actual input, arm-ack failure, cosmetic failure, CI and real-device checks still need review/qualification.
### Comment — 10/30/2026 01:56:39

Additional source defect: the Windows watchdog previously disarmed merely because the guard read failed or had become inactive, and guardian cleanup asked it to disarm before stopping workers and recovering the input ledger. A pending candidate keeps it armed until explicit post-cleanup disarm, refuses disarm while held-input status is unknown/nonempty, and escalates persistent invalid/inactive or expired state after bounded grace. Headless native classification/grace tests pass; real crash, held-input, lost-ack and physical Stop qualification are still essential.
### Comment — 10/30/2026 02:05:37

Windows CI run 40989217268 failed the identity test; a separate Windows run at the same head passed. The candidate fixture now waits for a child readiness acknowledgement and emits a bounded reason code if identity checks fail. Five local reruns passed. Root cause remains unproven; the guard still fails closed, and this issue remains open pending exact-head CI and real-device qualification.

## #18: Make native session expiry resilient to wall-clock changes
https://github.com/shayann07/antigravity-computer-use/issues/18

Updated: 10/30/2026 02:31:55

## Finding

The shared `wait` polling deadlines have been moved to a monotonic clock, but the native session deadline remains an absolute wall-clock timestamp. Windows Guardian compares `DateTime.UtcNow.Ticks`, and macOS Guardian compares `MacFenceState.now`; the native fence also reads the timestamp. A backwards system-clock adjustment may therefore extend the nominal session duration. This is a source-level finding, not a reproduced physical-device failure.

## Required work

Design a cross-process monotonic session deadline or another independently enforced bound that works across the guardian, worker and watchdog on Windows and macOS, including suspend/resume and process replacement. Preserve physical Stop, human-only re-arm and old-version compatibility; do not rely solely on a UI-thread timer. Test clock changes, expiry during held input and crash/Stop behavior with inert clocks, then qualify on real devices. Keep the existing action budget and do not claim the time limit is monotonic until verified.
### Comment — 10/30/2026 01:36:46

Candidate platform primitives for a design: Windows [`GetTickCount64`](https://learn.microsoft.com/en-us/windows/win32/sysinfo/windows-time) is system-wide and includes sleep/hibernation; Apple documents [`mach_continuous_time` / `CLOCK_MONOTONIC_RAW`](https://developer.apple.com/documentation/kernel/1646199-mach_continuous_time) as monotonic and including sleep. Both can support a shared per-boot deadline, but the guard protocol must bind it to the current boot/guardian and fail closed on malformed or legacy records. A watchdog must enforce it independently of the guardian UI thread; worker checks alone do not release held input. No implementation or physical sleep/wake result is claimed.
### Comment — 10/30/2026 01:53:08

Partial candidate in draft PR #6 through `cb74627`: Windows and Mac guardian state now includes a bounded per-boot monotonic deadline and the worker fences require it. Windows headless deadline/guard tests pass locally; the Mac native contract was added but must compile and run in CI. The independent watchdogs do not yet enforce expiry while the guardian is stalled, and physical sleep/wake and held-input tests are not done. Do not treat this as a completed fix or release.
### Comment — 10/30/2026 01:57:47

Windows watchdog candidate uses a five-second grace after monotonic expiry or inactive state before fail-closed cleanup if the guardian has not explicitly disarmed. The UI timer currently skips work during prompts/capture, so expiry during a long permission dialog could escalate to latched Stop; this user-experience edge case is not yet qualified and must be addressed before release. Mac independent enforcement also remains pending.
### Comment — 10/30/2026 02:03:11

Mac watchdog candidate now checks a persistently expired active deadline independently and escalates only after a five-second grace and a fresh matching-state read; persistently unreadable guard state is fail-closed. Watchdog startup also requires a protected, flushed identity marker. This code has not yet compiled or run on Mac CI. It still does not prove cleanup if the guardian writes idle and then stalls, and real sleep/wake, dialog, held-input and physical Stop checks remain open.
### Comment — 10/30/2026 02:17:14

A further pending Mac candidate adds a cleanup-pending flag to guardian state. The watchdog can now distinguish an idle/paused state still awaiting worker termination and ledger recovery from acknowledged clean idle; a persistent pending state escalates after the bounded grace. Headless parser/classification tests were added but Mac CI and physical crash/expiry/Stop races remain required. This does not verify CGEvent delivery.
### Comment — 10/30/2026 02:31:55

A further Mac candidate changes input-ledger lock acquisition from awake-only uptime to the same sleep-inclusive continuous clock, preserving the original `flock` error before reading the clock and refusing an unavailable/backwards clock. Existing headless contention checks apply, but Mac CI and real sleep/wake remain pending.

## #13: Idle cleanup can interrupt an open task during a long agent decision gap
https://github.com/shayann07/antigravity-computer-use/issues/13

Updated: 10/30/2026 01:01:50

## Finding

At `4ab227e`, the service idle timer could call `finish({preserveTask:true})` after 15 minutes without a request, clearing grants and observations even when the task marker was still open. With shutdown idle policy it could also close a paused or open task. A long agent decision gap does not prove the task is finished.

## Candidate fix and qualification

A pending change defers idle release/shutdown while the runtime reports an open task or human pause. An isolated IPC test exercises both idle policies and confirms cleanup resumes after the task is closed. Native session expiry, user Stop, and explicit End remain independent. Verify the patch in Windows and Mac CI and run an actual long-gap Antigravity task before treating this issue as fully resolved.
### Comment — 10/30/2026 01:01:50

Candidate fix is now in draft PR #6 at `7f4acd1`. The full local Windows suite passed 343 tests with 11 skips; an isolated IPC regression covers both idle policies, paused/open tasks and unavailable task state. CI for this exact commit and a real long-gap Antigravity task are still pending; native session expiry remains independent.

## #11: Audit and serialize macOS input dispatch and emergency cleanup
https://github.com/shayann07/antigravity-computer-use/issues/11

Updated: 10/30/2026 02:31:13

## Finding

Source inspection of the experimental macOS adapter at `fa828a0` found a possible concurrency gap: `post()` records input, checks the fence, posts the event, and updates the ledger in separate operations. The guardian and watchdog can concurrently call `MacInputLedger.recover()`, whose read/modify/write is not coordinated with event dispatch. `macKillWorkers()` waits only a bounded time and does not report whether a worker actually exited before recovery. A problematic interleaving is therefore plausible, although it has not yet been reproduced on a physical Mac.

## Required work

- Reproduce deterministically with a headless injected event backend and concurrent worker/recovery processes, without sending desktop input.
- Coordinate dispatch and cleanup across processes, validate lock ownership and crash behavior, and ensure recovery fails closed when worker termination or cleanup is uncertain. Do not weaken Stop or physical re-arm.
- Test the check-to-post and journal read/write boundaries, worker death during dispatch, simultaneous recovery, a lost lock, and permission revocation.
- Qualify real physical Stop, held-input release and subsequent tasks on Intel and Apple Silicon Macs. A posted release event is not, by itself, proof of delivery.

Mac functionality remains experimental until real-device acceptance. This finding is independent of the already tracked recovered-task qualification in #9.
### Comment — 10/30/2026 00:37:12

Additional qualification boundary: Apple's documented `CGEventPost` has no delivery result and the Quartz state tables are combined sources. Current `MacInputLedger.recover()` clears a nonempty journal after posting releases; this is best effort, not proof of delivered input or target state. Keep recovered-task End fail-closed and do not claim physical cleanup qualified. See [CGEventPost](https://developer.apple.com/documentation/coregraphics/cgevent/post(tap:)) and [event-source state](https://developer.apple.com/documentation/coregraphics/cgeventsourcestateid). The serialized dispatch/cleanup and process-death contract test are in draft PR #6; native interactive and forced interleaving tests remain outstanding.
### Comment — 10/30/2026 00:38:51

Additional lock identity concern for review: the proposed lock validates its file identity after acquisition, but another same-user process that unlinks and replaces the path while a holder is already inside its critical section could let a later process lock a different inode. The private directory prevents other accounts from doing this, but it does not prove safety against accidental same-user replacement. Add a deterministic replacement-while-held regression and a design that fails closed across that interleaving before calling #11 fixed.
### Comment — 10/30/2026 02:20:45

Review found that the new cleanup-pending acknowledgement could be cleared after `macKillWorkers()` returned even if a worker was still alive. A pending candidate now checks registry file trust and birth identity, requests termination of matching workers, and refuses acknowledgement unless exit is confirmed within a bounded interval. It still attempts ledger cleanup and latches Stop on uncertainty. The Mac contract fixture now exercises a real child and a simulated reused PID; compilation/CI and physical input qualification remain pending.
### Comment — 10/30/2026 02:21:53

Important qualification boundary: comparing birth identity before `kill(pid, SIGKILL)` skips a PID already observed as reused, but does not make the check and signal atomic. A PID could theoretically be recycled between them. [Apple documents PID recycling and staleness](https://developer.apple.com/documentation/xpc/xpc_connection_get_pid(_:)). The current candidate must not be described as proving that an unrelated process can never be signalled; investigate a supported stable-process targeting or cooperative shutdown design before release.
### Comment — 10/30/2026 02:23:16

Research: Apple documents [`NSRunningApplication.forceTerminate()`](https://developer.apple.com/documentation/appkit/nsrunningapplication/forceterminate()) as operating on an app instance and warns that completion is asynchronous. It is not established that our background AxonHost workers are represented by such an object, so this is not a verified fix. A cooperative cancellation channel plus fail-closed handling of an unresponsive worker is a possible direction; any redesign must still provide independent held-input cleanup without trusting model-supplied IDs.
### Comment — 10/30/2026 02:26:24

A local candidate now avoids signalling numeric worker PIDs: each worker monitors its native guard on a separate thread and exits itself after Stop, Pause, expiry or revocation; the guardian/watchdog wait for recorded process identities and fail closed if exit is unconfirmed. A headless contract fixture checks cooperative exit and that an unresponsive or reused-PID fixture is not signalled. Watchdog startup termination uses the direct child `Process` rather than raw SIGKILL. This is not compiled or qualified on Mac yet; a suspended/hung worker may leave held-input cleanup unconfirmed and requires local recovery.
### Comment — 10/30/2026 02:31:13

Head `7f2225d` passed both hosted Mac CI architectures in runs 40991803542 and 40991809504, including the headless cooperative worker and unresponsive/reused-PID contract fixture. This does not test actual held input, a suspended/hung native worker, TCC permissions, physical Stop or application delivery; the issue remains open.

## #10: Coordinate input across separate installations and legacy runtimes
https://github.com/shayann07/antigravity-computer-use/issues/10

Updated: 10/29/2026 23:50:56

## Problem
The new input fence protects updated controller processes that use the same installation data directory. A separately installed controller uses a different fence, and older runtimes do not honor the new native fence. They can therefore still operate the same desktop concurrently.

## Current evidence
Inert same-installation tests cover two independent processes, a live/partial metadata lease, helper death and a blocked launch. These do not exercise real desktop input or establish cross-installation or old-version exclusion. A six-sample local Windows acquire/release microbenchmark had a 191 ms median; actual Antigravity task latency is not yet measured.

## Required work
Design and verify a user-scoped, cross-installation ownership protocol that does not weaken private storage, Stop, approval, cancellation or held-input cleanup. Determine safe migration and legacy-version behavior; do not silently claim old clients are fenced. Test real separate processes and helper/owner death before qualifying two actual Antigravity tasks. Measure end-to-end latency as well as native lock cost.


## #9: Verify previous native input ledger before ending a recovered task
https://github.com/shayann07/antigravity-computer-use/issues/9

Updated: 10/30/2026 00:56:32

## Problem
The controller creates a new random guard file for each process. Native input ledgers are named after that file. After a controller crash, the replacement driver's cleanup operates on its new ledger, so its success does not prove that the old process's held inputs were released.

## Current mitigation
The development branch refuses End with `recovered_cleanup_unverified`, retains the task marker and defers updates when the prior task was interrupted. Inspection of the app is still permitted. This deliberately blocks ordinary recovered-task completion until safe recovery exists; it is not a completed feature.

## Required work
Persist a validated association between a task and its native guard/ledger before input can be delivered. Coordinate the old watchdog, workers and cleanup, including process identity and PID reuse, concurrent native recovery, ledger integrity and missing/corrupt state. Confirm old worker termination and release of every automation-held input without releasing unrelated physical input, without clearing Stop or manufacturing re-arm. Add real cross-process crash and failed-release tests on Windows and macOS, then qualify actual physical input and a second task. Handle older markers with no ledger identity explicitly and safely.

### Comment — 10/30/2026 00:56:32

Further hardening in progress: previous Windows guard, watchdog and input-ledger reads now reject links, check opened-file identity and changes during bounded reads. A hard-linked empty ledger is refused in a local regression. This is not proof of real watchdog cleanup or crash recovery; those qualification gates remain open.

## #8: Coordinate all controller leases during cross-installation rollback
https://github.com/shayann07/antigravity-computer-use/issues/8

Updated: 10/29/2026 22:27:35

## Problem
The direct standalone rollback command checks task markers and live service metadata in both the current and previous installation roots before restoring files. Those checks do not hold controller leases on every root across the entire rollback. A separate Sidecar could start after a check and before deployment restoration.

## Evidence and scope
The installer regression covers rejection when the previous root already has an open task or live service. It does not establish race-free cross-root rollback. The automatic updater holds a controller fence for its target, but that does not prove protection for all previous roots. No real user task collision has been demonstrated.

## Acceptance
Coordinate all affected installation roots through native ownership leases in deterministic order for the full validation and restoration transaction; account for updater-owned fences without re-entrant deadlock, ambiguous cleanup, crashed workers, and legacy deployments. Preserve Stop, task state, permissions and unrelated configuration. Add concurrent-process and fault-injection tests and qualify on Windows and macOS before claiming resolution. Never use model-supplied identifiers as security authority.


## #7: Direct Sidecar callers can end another task session
https://github.com/shayann07/antigravity-computer-use/issues/7

Updated: 11/06/2026 13:07:44

## Problem

The direct Sidecar serves multiple authenticated connections through one Runtime. Between actions, a second caller can invoke `end`, which clears the first caller's observations and app grants and returns the shared state to idle. Per-action serialization prevents simultaneous input, but does not identify which task owns the session between calls. This can disrupt concurrent Antigravity tasks using the same installation.

## Reproduction and evidence

An isolated local probe used the actual `serveDesktop` IPC dispatch and `Runtime.finish`, with an inert runtime and two separate authenticated connections. It initialized one active session with one frame and one grant; a second connection's `end` succeeded; a subsequent status showed idle with zero frames and zero grants. No application, screenshot, or native input was used. This is an architecture-level reproduction, not evidence that two live Antigravity agents have collided in practice.

## Desired behavior

Provide explicit task ownership or safe session coordination for the full observation/action/end lifecycle. A caller must not silently end or change another task's grants and frames. Preserve independent emergency Stop and cleanup, permission boundaries, existing project/global deployment pins, stale-observation protection, and compatibility where host-provided identity is unavailable. Do not treat a model-supplied identifier as a security credential. Add concurrency tests and verify with two real Antigravity tasks before claiming the issue resolved.

### Comment — 10/30/2026 01:05:49

Partial mitigation under test: a client with a different build or permission policy is refused End, and is refused shutdown while task state is open or unknown. Emergency Stop and Pause remain available; a confirmed idle service can still be shut down. This does not authenticate or distinguish two host conversations using the same build and policy. The issue must remain open until full task ownership and real two-task qualification are implemented.
### Comment — 10/30/2026 01:06:48

Clarification: build ID and policy are supplied in the IPC request. They are compatibility checks, not authenticated caller identity, and can be imitated by a client. This mitigation only prevents accidental teardown by normally configured mismatched installations; it is not a security boundary.
### Comment — 10/30/2026 01:12:58

The pending accidental-mismatch mitigation now also refuses a foreign shutdown when the native control state is active, paused or unknown, even if the task marker says closed. Local IPC regressions cover these states. This still does not authenticate caller identity or solve same-build conversation collisions.
### Comment — 11/06/2026 13:07:44

Another observation for this issue (Claude Code, Windows, build c93b8fcb). At the very start of a fresh session, before any action from this caller, `ready` returned `task_open:true` with `remaining_actions:198` and `approved_apps:[]`, plus `controls_visible:true`. So a task state left over from an earlier caller was visible and usable by the next caller without any ownership check. I could not tell whose task it was, which is the ambiguity this issue describes. Suggestion: have `ready` report an owner or age for an open task, or start new callers on a fresh task.

## #3: Qualify missing control-bar recovery on the affected Windows PC
https://github.com/shayann07/antigravity-computer-use/issues/3

Updated: 10/30/2026 15:44:14

## Reported behavior

On a second Windows PC, Antigravity reports a stopped controller with
`guardian_exited` and asks for local re-arm. The user reports that repeatedly
running the installed human launcher still does not reveal the floating controls.
The affected installation's exact bundle identity has not yet been independently
collected. This is a user-reported regression; reproduction on that PC remains
pending.

## Related source repairs

PR #1, commit `043aec6fdf98c8f20e606a08b080d3a48516181b`, addresses two
independently reproduced source-path problems:

- A guardian reply with `controls_visible:false` and no error previously produced
  no incident and did not bound repeated `ready` attempts. It now becomes a
  cached `guardian_controls_not_visible` diagnostic failure.
- The human launcher previously reused `ready`, whose cached failure could
  prevent an explicit retry. It now reconnects/starts passively, then requests
  `controls`, preserving the emergency Stop latch. Isolated-desktop failures
  retain one clear human-visible-desktop handoff.

Windows regressions failed before the runtime repair and passed afterward.
The generated launcher also passes against real IPC with an inert controls
provider; that test creates no real bar or desktop input. Local suite: 205 passed,
zero failed, seven skips. Windows CI passed. These results do not establish the
affected PC's root cause or prove native visual recovery.

## Remaining acceptance

- [ ] Collect sanitized source/bundle/installed/running identities and startup
  diagnostics on the affected PC; preserve existing settings and Stop.
- [ ] Reproduce missing/hidden/crashed controls with the exact candidate and a
  fresh supported installation; retain failed runs.
- [ ] Verify passive startup stays hidden and the human launcher reveals native
  controls without re-arm, input or repeated ordinary approval prompts.
- [ ] Verify physical re-arm, actual app use, Esc during queued/held input,
  persistence across restart, End cleanup and a second task.
- [ ] Measure real Flash and Sonnet tasks rather than substituting CLI fixtures.

Do not close this issue solely because compilation, synthetic recovery or CI
passes. Do not bypass desktop isolation, weaken storage guards, manufacture
human re-arm or publish a qualified release while these checks remain unrun.

### Comment — 10/30/2026 15:44:14

Current release checkpoint: public and installed Windows beta3 build 38e054981678868d29b947fb6524a1078d58d984dd99ec58bfce83e63867b61d. Physical Stop, human re-arm, second task and clean End passed on this PC; the affected-PC/fresh-install control-bar recovery requested by this issue remains unqualified and the issue stays open.

## #2: Real Flash qualification: slow Notepad workflow and missing Unicode joiner
https://github.com/shayann07/antigravity-computer-use/issues/2

Updated: 10/30/2026 15:44:12

An actual Antigravity No Project task using Gemini 3.8 Flash High and the installed beta.3 development candidate completed a Notepad save/cleanup workflow, but independent verification found an omitted Unicode joiner. It also took about ten minutes for a small document. This is a partial qualification result, not a successful speed or exact-text acceptance run.

Candidate build: `83487f3a409d36dd615e2da2542a60ae0858cc0ddacb40ee2aa13adad514873d` (shared runtime candidate from PR #1).

Reproduction task: use `/computer-use` to enter a new three-line Notepad document containing a synthetic mixed Urdu/Latin line and `👩🏽‍💻`, save as UTF-8, verify it, close only the created document and end control.

Observed:

- 605,626 ms from task submission to End; 21 controller calls totaled about 20,999 ms.
- The file was created and control returned to idle. The saved emoji code points were `1F469 1F3FD 1F4BB`; expected `1F469 1F3FD 200D 1F4BB`.
- The original user message's accessible text retained U+200D. Exact paste argument versus runtime/provider loss is **not yet isolated**. Do not attribute this to the native clipboard path without further evidence.
- The model reported success after inspecting byte count and hex without comparing against the original string.
- One screenshot-to-click gap was about 108 seconds, exceeding the 90-second observation lifetime. Native stale-input refusal was correct. The agent also recovered from minimized/obscured target refusals.
- Extra directory/timing-file reads and multiple schema discovery calls added overhead.

Source follow-up in PR #1 adds deterministic recovery actions and exact-Unicode verification guidance. It has not yet been compared in a matched real-model run. The observation validity and no-replay protections must stay intact.

Required follow-up:

1. Isolate the exact model paste payload from a controlled reproduction and independently test the real Notepad clipboard path with a known UTF-8 source.
2. Run Flash and Sonnet with the same candidate/task and report model/tool gaps separately from native processing.
3. Compare exact output code points, not only glyphs, byte length or a hex dump.
4. Retain failed runs and do not close this issue based on fixtures alone.

No private screenshots, chat transcripts, local paths, clipboard data or user documents are attached. The example content was synthetic qualification data.

### Comment — 10/29/2026 12:40:39

Transport isolation follow-up (no desktop input): a new regression preserves the exact synthetic Urdu, U+200C/U+200D and emoji sequence through real Windows PowerShell → production CLI/parser → authenticated IPC → shared `Runtime.action` → `Driver.call` → native C# JSON serialization. Both literal `--text` and UTF-8 `--text-file` round trips passed exact code-point comparison.

The native endpoint is an inert JSON echo process; window/permission/observation providers are fixtures. It does not access the real clipboard or type into an application. This rules out joiner stripping in the tested transport/runtime path only. It does **not** establish whether the original model paste argument omitted U+200D or whether the real clipboard/provider path changed it.

Issue remains open. The original Flash run is still a failed exact-text qualification. A controlled real-app clipboard test and matched Sonnet trial remain pending after the owner resumes desktop qualification.

### Comment — 10/30/2026 15:44:12

Current release checkpoint: public and installed Windows beta3 build 38e054981678868d29b947fb6524a1078d58d984dd99ec58bfce83e63867b61d. Real Upscaly 1.0.9 native-AI PNG and JPG outputs were independently decoded and hashed; this does not close the issue because matched real Flash/Sonnet timing and exact Unicode-joiner qualification remain unrun.

