---
name: computer-use
description: Operate and visually verify real desktop applications, including development builds, through the Antigravity native desktop runtime. Use for interactive app testing, screenshots, controls, dialogs, canvas gestures and task verification. You run its terminal commands yourself; never hand the user manual steps to follow.
---

# Computer use

## Start the task

Run exactly one `ready` call in your terminal. For an already open app, list its windows in that call:

```{{SHELL}}
{{DESKTOP_COMMAND}} ready --apps
```

Use the matching window handle for `snapshot`. If the task calls for opening a known application, start with this instead:

```{{SHELL}}
{{DESKTOP_COMMAND}} ready --launch 'APP' --reason 'Open the requested application'
```

Replace APP with the executable or app bundle. On macOS an app name such as `TextEdit` also works.
Use the returned frame directly. Use plain `ready` for a readiness check or human handoff.

Keep the returned `task_token` private. Append each command to the returned `task_command_prefix`. Do not call
`status` before `ready`; `ready` already reports the state you need.
Alternatively, append `--task <task_token>` to
all subsequent task commands, including `ready` after a human handoff and
`end`. For example:

`{{DESKTOP_COMMAND}} snapshot --task <task_token> --hwnd <observed-window>`

On `task_owned`, wait for the owning task to finish. Never fetch another
conversation's token or issue End on its behalf. Status, app discovery and
emergency Stop remain available without the task token. After successful End,
discard the old token; a new task starts with `ready` without `--task`.
If your own task is orphaned with zero grants and no input held, and you lost its token, use `stop` or the bar’s Stop.
A lost response does not justify replaying an input action.

- If the combined call returned an error, follow its recovery. On plain `ready:true`, use `apps` or `launch --observe` to find the target.
- If `ready:false`, perform only the returned `next_action`, then stop or wait as instructed. Do not invent a recovery path.
- Every blocked reply carries a `recovery` object (`actor`, the exact `command` or a `reason`, and `safe_when`). Follow it instead of guessing.
- `human_start_on_visible_desktop`: ask the human to open **`{{CONTROLLER_START}}`** once on their normal desktop. Do not switch desktops or repeatedly start helpers.
  If controls still fail, collect diagnostics and report the incident instead of inventing another launch method.
- If the launcher fails, report its exact error and stop.

## The loop

Use one controller per task. Read unfamiliar command schemas in one `describe` call. Use the runtime replies to operate the desktop.
`observe_pending`, `input_completed:true` or a verification failure after launch means discover the existing process, never launch it again blindly.
Finish with `end`. `ready` starts a task; to check state after `end`, use `status`, which never opens a task.
If you noticed a skill or runtime problem, keep private notes during the task and, after `end`, follow the report step in [finishing and reports](references/finishing-and-reports.md).
Report only what the app showed. If it shows no output path, use at most one visible control that opens the output folder, or say the path was not shown. Do not explore history panels, hover for tooltips or search the disk to find it.
For physical handoff (a human presses Esc or takes over): at most one bounded input attempt, then stop issuing controller calls and wait for the human. Details in the handoff reference below.
If any result shows `state: stopped` or `control_reason: escape`, the human stopped you: say so plainly in your reply (for example "You pressed Esc, so I stopped after X"), never call it a clean finish, and do not resume until asked.
H/F/N are the observed handle, frame and index. Brackets mark optional flags.

| Command | Named arguments |
| --- | --- |
| `launch` | `--app EXE_OR_APP_BUNDLE --observe --reason TEXT`; on a Mac an app name such as `TextEdit` also works |
| `snapshot` | `--hwnd H --reason TEXT [--query TEXT] [--max-nodes 500] [--image] [--settle-ms 0..2000]` |
| `click` | `--hwnd H --observation-id F --name TEXT --role Button --risk routine --reason TEXT [--physical true] [--park-cursor] [--image] [--max-nodes 500] [--settle-ms 0..2000]`; or `--index N` in place of name/role |
| `click` (pixels) | `--hwnd H --observation-id F --x X --y Y --risk routine --reason TEXT [--image]`; X/Y come from that frame's freshly viewed image |
| `move` | `--hwnd H --observation-id F --x X --y Y --risk routine --reason TEXT`; hover without clicking |
| `drag` | `--hwnd H --observation-id F --from X,Y --to X,Y --risk routine --reason TEXT` (write an array once: `X,Y` or JSON `'[X,Y]'`) |
| `drag` (curve) | `--points '[[X,Y],[X,Y],...]'` in place of from/to: 2–400 points from the viewed image, one continuous stroke through every point |
| `key` | `--hwnd H --observation-id F --keys CHORD --risk routine --reason TEXT [--index N] [--image]`; the flag is `--keys`, also inside `run --step key` |
| `set_value` | `--hwnd H --observation-id F --name TEXT --role Edit --text VALUE --risk routine --reason TEXT`; or `--index N` |
| `file_dialog` | `--hwnd OWNER --observation-id F --path FILE --action open` (or `save`) `--entry-method clipboard --reason TEXT` |
| `run` | `--hwnd H --observation-id F --reason TEXT --step COMMAND` followed by that step's flags; repeat at most 8 times, omitting per-step owner/frame. Add `--images all` before the first step for per-step images |
| `wait` | `--hwnd H --until TEXT --timeout-ms 30000 --reason TEXT [--abort-on 'Failed,Cancelled'] [--image]`; or `--until-gone OBSERVED_TEXT` in place of `--until` |
| `burst` | `--hwnd H --frames 6 --interval-ms 150 --reason TEXT` captures a short sequence |
| `wait_change` | `--hwnd H --observation-id F --timeout-ms 30000 --reason TEXT` |
| `close_window` | `--hwnd H --reason TEXT` |
| `end`, `status` | No arguments |

- **Tree first.** Read the returned `tree`; it answers most questions.
  **Open the actual `image.path` with the host image viewer** only when you need pixel coordinates, when you are making a visual claim (layout, rendering, colour, image content), or when the tree cannot answer.
  Each image view costs a full model turn. Agent Manager's `read_file` can view its JPEGs. JSON, a reconstructed picture or an accessibility label does not prove visual behavior. Report an unavailable image viewer.
- Every action consumes its `observation_id` and returns a **fresh frame and tree**. Use that reply directly. Do not take another snapshot merely to get a frame you already have.
  Pixel targets require a fresh viewed image. Ordinary named actions are tree-only; add `--image` when pixels or visual verification are needed.
- Combine predictable steps in one bounded `run` with 1–8 `--step` groups. For dozens to hundreds of steps, compute the steps with a script, then run them with `plan`, never one `run` per model turn.
- An app’s “Posted” confirmation or View link confirms publication. A feed can lag after a successful post. Never publish again because a list has not refreshed.
- Never guess an observation id, index or pixel position across a layout change. Never replay an input action after a lost reply or `delivery_unknown:true`.

For a dev-build smoke test, use `ready --launch`, one `run --images all` with the observed controls, then `close_window` on the disposable window and `end`.

Examples only: replace handles, frames, indexes, names and paths with values from the current task and its fresh observation.

```{{SHELL}}
{{DESKTOP_COMMAND}} click --hwnd 123 --observation-id FRAME --name Settings --role Button --risk routine --reason 'Open observed settings' --max-nodes 500
{{DESKTOP_COMMAND}} run --hwnd 123 --observation-id FRAME --reason 'Import, start and wait' --step click --name 'Choose files' --role Button --risk routine --step file_dialog --path 'OBSERVED_FILE_PATH' --action open --entry-method clipboard --settle-ms 600 --step click --name Start --role Button --risk routine --step wait --until 'Done' --timeout-ms 30000
{{DESKTOP_COMMAND}} set_value --hwnd 123 --observation-id FRAME --index 9 --text 'Sample' --risk routine --reason 'Set the observed field'
{{DESKTOP_COMMAND}} run --hwnd 123 --observation-id FRAME --reason 'Pick a colour and draw two curves' --step click --name Green --role ListItem --risk routine --step drag --points '[[300,500],[360,470],[430,480],[500,450]]' --risk routine --step drag --points '[[300,560],[380,530],[460,545]]' --risk routine
```

## Where the rest lives

These are packaged operating guidance, not a reason to explore source files. Read only the file the situation names.

| When | Read |
| --- | --- |
| `ready:false`, `update_notice`, any `next_action` or recovery state | [ready replies](references/ready-replies.md) |
| A human must press Esc or take over | [handoff](references/handoff.md) |
| Targets, batches, steps files, waits, schemas | [observe and act](references/observe-and-act.md) |
| Dozens or hundreds of steps (drawing, repetitive entry) | [complex tasks](references/complex-tasks.md) |
| Typing, paste, Unicode, Open/Save dialogs | [dialogs and text](references/dialogs-and-text.md) |
| Stop, Esc, permissions, `input_completed`, `delivery_unknown` | [control and permissions](references/control-and-permissions.md) |
| macOS, sidecar unavailable, control bar, task ownership | [platform and sidecar](references/platform-and-sidecar.md) |
| Any other failure code | [recovery](references/recovery.md) |
| Reporting, giving up, feedback, updates | [finishing and reports](references/finishing-and-reports.md) |
| Development or QA qualification | [application verification](references/app-verification.md) |
