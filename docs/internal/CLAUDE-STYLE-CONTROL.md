# Claude-style control: per-app access, tiers and an unlatched Stop

Owner decision, November 2026. This replaces the emergency-Stop latch that only
a human re-arm could clear. The model follows the one Claude's own computer use
uses: the human approves apps one by one, each app has an access tier, and Stop
ends the agent's task instead of locking the machine until someone re-arms it.

This document covers the JavaScript side, which is implemented on branch
`feat/claude-style-control`, and the native work, which is not. Native C# and
Swift were deliberately left untouched.

## Rules

1. **Per-app access.** The agent asks for apps with `request_access`, or the
   first action on an app asks. The human approves each app in a local dialog.
   Input goes only to approved apps.
2. **Tiers.** Terminals and IDEs (the existing shell tier in `policy.mjs`) are
   `click`: plain left click, pointer move, scroll and focus only. Everything
   else is `full`, browsers included (a later owner decision overrode the first
   plan to make browsers read-only). Protected apps (UAC and elevation, the lock
   screen, security tools, password managers, wallets) are blocked and have no
   tier. A `read` tier exists in the code for a future category; no app maps to
   it today. Refusals are `app_tier_click` or `app_tier_read`, name the tier and
   say what to do instead.
3. **Stop or Esc** halts input at once, ends the task and revokes every app
   approval. There is no latch for the human to clear. The next `ready` starts
   a fresh task and the Allow prompt appears again for each app. The skill
   tells the agent to report and wait, never to retry immediately.
4. **Human input does not pause the agent.** Smart takeover is retired. Only
   Esc, the bar's Stop, or an explicit Pause halts the agent. A pause resumes
   when the human says so; no re-arm is involved.
5. **Kept safety.** Stop is always reachable. Unknown delivery is never
   replayed. An unconfirmed Stop (`guardian_stop_unconfirmed`), a Stop storage
   failure and a recovered task with unverified cleanup keep every existing
   fence. The controller never types into its own host app. Link-safety and
   financial-action rules are in the skill text.

What goes is the **human gate**, not the cleanup proof. Before a stopped task
is cleared, the runtime still proves that keys and buttons were released and
that the prior workers are gone.

## State table

| State | How it is entered | Agent input | Leaves by |
|---|---|---|---|
| `idle` | startup with no marker; End; a cleared Stop; native session expiry | none until an app is approved | approving an app (`active`) |
| `active` | an app approval plus native activation | approved apps only, within each tier | Stop/Esc (`stopped`), Pause (`paused`), End (`idle`), deadline (`idle`, reported as `session_limit`) |
| `paused` | `pause`, or the bar's Pause | none | `resume` when the human says so, or the bar's Resume (`active`); Stop (`stopped`) |
| `stopped` (confirmed) | Stop, Esc, Ctrl+Alt+F12; a confirmed persisted marker at startup | none; calls fail `control_stopped` with `report_and_wait_for_human` | the next `ready`, after cleanup proof (`idle`, fresh task, approvals reset) |
| `stopped` (unconfirmed) | Stop whose native delivery or cleanup is unproven | none | unchanged: inspection and the existing nonce settlement only |
| `stopped` (storage failure) | Stop marker could not be written or read | none | unchanged: operator inspection |
| recovered task | controller restarted with a task open | observation only | unchanged: `end` after prior cleanup is verified |

Next actions that changed:

| Old | New |
|---|---|
| `awaiting_human_rearm` | removed. A confirmed Stop is cleared by `ready`; an old native build reports `native_update_required` |
| `awaiting_human_resume` | `ask_human_before_resume` |
| `human_resume_required` (code) | `resume_refused` or `not_paused` |
| `control_stopped` -> `inspect_status_then_human_controls` | `control_stopped` -> `report_and_wait_for_human` |
| `session_limit` -> `end_owned_task_then_reauthorize` | `session_limit` -> `renew_task_and_continue` |
| stop reply `human_rearm_required:true` | `task_ended:true, next_action:'report_and_wait_for_human'` |

`awaiting_human_owner_rearm` became `inspect_owner_stop`. The cross-installation
`global_stop_latched` refusal in `task-coordinator.mjs` now fires only for an
unconfirmed or unreadable Stop in the other installation; a confirmed Stop there
only ended that installation's task.

## How long an approval lasts

An approval lasts for the agent's conversation. `ready` returns a
`session_handle`; the agent passes it to later `ready` calls in the same
conversation. Approvals are remembered per handle and per executable, with no
idle timer, and native session expiry or End does not drop them. A missing or
unknown handle starts a new conversation that asks again. Stop or Esc revokes
the handle and every approval on it.

Gated on native: the guardian only lets input reach an app that a `prompt
kind:'app'` added to its own grant list, and that list is cleared on End,
expiry and Stop. So today a remembered app still shows the dialog after the
native session ends. JS sends `remembered:true` and `session_handle` with that
prompt; the native change below must honour them. The handle lives in the
service process memory, so a controller restart also starts a new conversation.
The `plan` command's automatic renewal calls `ready` without a handle; passing
it through is a follow-up.

## How `ready` clears a confirmed Stop with today's native binaries

The current guardian enforces the marker file (`ControlFence.LatchBlocks`),
refuses `activate` and `prompt` while stopped, and only leaves `stopped` through
the human re-arm handler. On startup it comes up `idle` when no marker exists
(`Initialize`, `SetState(LatchBlocks?stopped:idle)`). The JS uses that:

1. Refuse when input may be held, when the marker is unconfirmed or unreadable,
   when local controls are failing, or when a recovered task is open.
2. Proof of cleanup. With a live guardian, request a fresh nonce Stop receipt;
   it must report `workers_stopped` and `input_cleanup_confirmed`. Without one,
   a task of this process that dispatched input must pass the existing
   exited-actor ledger proof. Otherwise refuse `stop_cleanup_unverified`.
3. Close the task record, close the guardian (normal shutdown), then remove the
   marker with `clearConfirmedStop`, which refuses anything but an exact
   confirmed `stopped` with no `.unconfirmed` companion.
4. `ready` continues and starts a fresh guardian. If it still reports
   `stopped`, `ready` refuses with `native_latch_still_enforced` and
   `native_update_required`.

This needs no native change on Windows, as far as the source shows, but it was
not run against a real guardian. The cleanup watchdog (`CursorSafety.cs`,
`CrashCleanup`) can rewrite the marker when its owner exits; if that lands after
JS removes it, the new guardian comes up stopped and `ready` refuses with
`native_latch_still_enforced`, which fails closed. The Mac guardian was not
read for this path. It is also a stopgap: the bar still shows
Re-arm, the old guardian process is restarted on every post-Stop task, and a
standalone chat `resume` is still refused by native code.

## Native work list (not done)

Windows, `server/native/Guardian.cs` and friends:

- **Stop model.** Replace `LatchStop`/`LatchBlocks` semantics: Stop writes a
  per-task Stop record that blocks input only for the current task token.
  Add an op such as `clear_stop` that, after `WorkersExited` and
  `!InputLedger.HasHeld()`, moves `stopped` to `idle` without a human epoch, so
  JS no longer needs to restart the guardian. Keep the `.unconfirmed` companion
  and nonce receipts exactly as they are.
- **`SetState`.** Allow `stopped -> idle` from that op; keep refusing
  `stopped -> active`.
- **Bar.** Remove the Re-arm path from the toggle button (lines around 350-372)
  and its tooltip text. The toggle becomes Pause/Resume only. Stop keeps its
  button, Esc and Ctrl+Alt+F12. Drop `rearm_locked` and `AGCU_REARM_LOCKED`;
  for a recovered task, show the bar with Stop only.
- **Resume.** Let `resume` succeed in standalone mode for a pause that the
  agent or the bar requested, under the same cleanup checks; today it requires
  `hostManaged`.
- **Takeover.** `Presence` and `TakeoverPolicy` must never pause on human
  input. Remove the Smart option from the mode menu and ignore a saved `smart`
  value. JS already forces `AGCU_TAKEOVER_MODE=manual`, but a human can still
  pick Smart in the current bar menu, and `LoadTakeoverMode` reads the saved
  preference.
- **Access dialog.** Replace the single-app `prompt kind:'app'` dialog with a
  list dialog: one row per requested app with its tier (full or click), Allow
  and Deny per row, and a single confirm. JS currently calls the existing
  dialog once per app and puts the tier in its text.
- **Tier enforcement in native.** The JS checks the target app. Native should
  also check the frontmost app at dispatch (the keyboard target check in
  `KeyboardTargetPolicy.cs` already verifies the foreground window for keys),
  so a click-tier window that comes to the front between check and dispatch
  cannot receive typing.
- **Remembered approvals.** For a `prompt kind:'app'` carrying
  `remembered:true` and a `session_handle` the guardian has seen approved, add
  the grant without a dialog. Clear the remembered set on Stop and Esc.
- **Host-managed mode.** The prompt handler starts with `allowed=hostManaged`,
  so no dialog is ever shown there and an app is re-approved silently after
  Stop. This conflicts with the owner rule that Stop must not let the agent
  regain control silently. Owner decision needed: show the dialog after a Stop
  even in host-managed mode, or accept host approval.
- **Session expiry.** `Tick` goes `idle` with no reason at the deadline. Emit a
  reason such as `session_expired`; JS currently infers expiry from an
  unexplained `active -> idle`.
- **CursorSafety watchdog** reads the marker (`CursorSafety.cs` around line
  206); keep it consistent with the per-task Stop record.

macOS, not read in detail for this change; the same list applies:

- `MacOperations.swift` and `MacGuardian.swift`: the latch read and write
  (`LatchBlocks`/`LatchStop` equivalents, 38 and 20 references), the re-arm
  handler, the stopped-to-idle transition, the resume rule and the watchdog
  marker rewrite.
- `MacControl.swift` and `MacVisuals.swift`: the bar's Re-arm button and
  tooltip, the Smart takeover menu item, and the access approval list dialog.
- The remembered-approval prompt and the host-managed decision, as on Windows.

## Migration of existing marker files on upgrade

- A confirmed `emergency.stop` reading exactly `stopped` with no companion is
  treated as "the previous task ended by Stop". The first `ready` after the
  upgrade clears it, after cleanup proof.
- An `unconfirmed:<nonce>` primary or an `emergency.stop.unconfirmed`
  companion is never migrated or removed automatically. It keeps the current
  inspection and settlement path.
- An unreadable marker stays `stop_persistence_failed`.
- Installer, updater and rollback keep their current deferral rules for
  uncertainty. `preserveStopLatch` still carries a confirmed Stop to the new
  install, where `ready` clears it; it could instead drop confirmed markers once
  the native change ships.
- `control-preferences.json` with `takeover_mode:"smart"` is ignored by JS; the
  native change should rewrite it to `manual`.

## Risks

- **Silent regain of control.** In standalone mode Stop clears every grant in
  JS and native and the next task must show the Allow prompt again (tested
  against a fake guardian only). In host-managed mode native auto-allows the
  prompt, so control returns without a dialog; see the native list.
- **Clearing a Stop whose input is still held.** Mitigated by the receipt or
  exited-actor proof and by never touching unconfirmed markers. The receipt is
  transport evidence from the guardian process, not physical proof.
- **Guardian restart race.** JS closes the guardian before removing the marker.
  If the close is not confirmed, `ready` refuses. If a stale guardian survives,
  its Tick does not leave `stopped` on its own.
- **Agent retry loops after Stop.** The skill says to report and wait. The
  runtime cannot tell a human-requested restart from an agent retry; a fresh
  `ready` after Stop is allowed by design.
- **Click tier gaps.** Enforced on the target hwnd only. Window-free clipboard
  operations are not tier-checked. Scroll is allowed at click tier, as in the
  reference model.
- **Old docs.** `docs/STOP-UNCERTAINTY.md`, `docs/TASK-OWNERSHIP.md`, README,
  SECURITY and the history files still describe human re-arm. Update them
  when the native change ships.

## Issues affected

Status read from GitHub on 2026-11-15:

- #21 (open, preserve native stopped state across concurrent guardian
  transitions): partly moot. Its concern is that a stale idle or paused UI makes
  re-arm confusing; there is no re-arm now. The race itself (a Stop during a
  transition must still win) still matters, so it stays open until the native
  change lands, then it can be narrowed to "Stop wins a concurrent transition".
- #23 (closed, Mac fail-closed when the latch cannot be inspected) and #89
  (closed, recovery end for undispatched tasks with unconfirmed Stop): already
  closed. Their fail-closed behaviour is kept.
- #26 (open, preserve unconfirmed Stop across restart): not moot. The
  uncertainty fence is unchanged and still needs native qualification.
- #19 (open, independently armed Windows cleanup watchdog): unaffected; "armed"
  there refers to the watchdog, not to Stop.
