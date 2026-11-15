---
name: computer-use
description: Operate and visually verify real desktop applications, including development builds, through the Antigravity native desktop runtime. Use for interactive app testing, screenshots, controls, dialogs, canvas gestures and task verification. You run its terminal commands yourself; never hand the user manual steps to follow.
---

# Computer use

Antigravity is the agent: you do the task yourself by running these commands, not by writing instructions for the user.
The local native runtime supplies screenshots, accessibility and real mouse/keyboard input.
Windows and macOS use the same tools, observation/action loop, batch limits and permission lifecycle.
Use its installed direct terminal command. No MCP or separate model is needed. Do not mix it with Cua Driver or another controller.

```powershell
{{DESKTOP_COMMAND}} ready
```

## Mandatory weak-model fast path

The first controller call is always the installed command above. Run exactly one
`ready` call through the host's terminal tool before doing anything else. Do
**not** search the repository, read source files, inspect historical evidence, or enumerate
`.localdata` to decide how to operate the desktop. The `ready` reply is the
runtime's authority.

Keep the returned `task_token` private. Prefer copying `task_command_prefix`
from the ready response and appending the next command to that prefix; it
already includes the correct installed launcher and task context. Do not call
`status` before `ready`; `ready` already reports the state you need.
Alternatively, append `--task <task_token>` to
all subsequent task commands, including `ready` after a human handoff and
`end`. The CLI obtains this token inside the first `ready` call; no separate
model/tool round trip is needed. For example:

`{{DESKTOP_COMMAND}} snapshot --task <task_token> --hwnd <observed-window>`

On `task_owned`, wait for the owning task to finish. Never fetch another
conversation's token or issue End on its behalf. Status, app discovery and
emergency Stop remain available without the task token. After successful End,
discard the old token; a new task starts with `ready` without `--task`.
A lost response does not justify replaying an input action.

- If `ready:true`, continue directly with `apps`/`launch`, then `snapshot`, action/verification and `end`.
- If `ready:false`, perform only the returned `next_action`, then stop or wait as instructed. Do not invent a recovery path.
- Every blocked reply carries a `recovery` object (`actor`, the exact `command` or a `reason`, and `safe_when`). Follow it instead of guessing.
- `human_start_on_visible_desktop`: ask the human to open **`{{CONTROLLER_START}}`** once on their normal desktop. Do not switch desktops or repeatedly start helpers.
  If controls still fail, collect diagnostics and report the incident instead of inventing another launch method.
- If the command cannot be resolved or returns an error, report that exact error and stop. Source exploration is never a substitute for the controller.

This short path is mandatory for Flash, low-effort and other models that may
otherwise turn a desktop task into repository analysis.

## The loop

Use `ready → apps/launch → snapshot → action/verify → end`.
Read only unfamiliar command schemas through one `describe` call. Do not inspect implementation/source files to perform a desktop task.
Launch returns the window, frame and screenshot; reuse them.
`observe_pending`, `input_completed:true` or a verification failure after launch means discover the existing process, never launch it again blindly.
Finish with `end`. `ready` starts a task; to check state after `end`, use `status`, which never opens a task.
For physical handoff (a human presses Esc, takes over or re-arms): at most one bounded input attempt, then stop issuing controller calls and wait for the human. Details in the handoff reference below.
These common command shapes are complete; use them directly without schema setup. H/F/N are observed handle/frame/index values. Optional flags are in brackets; replace placeholders, not the command names.

| Command | Named arguments |
| --- | --- |
| `launch` | `--app EXE_OR_APP_BUNDLE --observe --reason TEXT` |
| `snapshot` | `--hwnd H --reason TEXT [--query TEXT] [--max-nodes 500] [--image] [--settle-ms 600]` |
| `click` | `--hwnd H --observation-id F --name TEXT --role Button --risk routine --reason TEXT [--physical true] [--image] [--max-nodes 500]`; or `--index N` in place of name/role |
| `click` (pixels) | `--hwnd H --observation-id F --x X --y Y --risk routine --reason TEXT [--image]`; X/Y come from that frame's freshly viewed image |
| `move` | `--hwnd H --observation-id F --x X --y Y --risk routine --reason TEXT`; hover without clicking |
| `drag` | `--hwnd H --observation-id F --from X,Y --to X,Y --risk routine --reason TEXT` (write an array once: `X,Y` or JSON `'[X,Y]'`) |
| `drag` (curve) | `--points '[[X,Y],[X,Y],...]'` in place of from/to: 2–400 points from the viewed image, one continuous stroke through every point |
| `key` | `--hwnd H --observation-id F --keys CHORD --risk routine --reason TEXT [--index N] [--image]`; the flag is `--keys`, also inside `run --step key` |
| `set_value` | `--hwnd H --observation-id F --name TEXT --role Edit --text VALUE --risk routine --reason TEXT`; or `--index N` |
| `file_dialog` | `--hwnd OWNER --observation-id F --path FILE --action open` (or `save`) `--entry-method clipboard --reason TEXT` |
| `run` | `--hwnd H --observation-id F --reason TEXT --step COMMAND` followed by that step's flags; repeat at most 8 times, omitting per-step owner/frame |
| `wait` | `--hwnd H --until TEXT --timeout-ms 30000 --reason TEXT [--abort-on 'Failed,Cancelled'] [--image]`; or `--until-gone OBSERVED_TEXT` in place of `--until` |
| `wait_change` | `--hwnd H --observation-id F --timeout-ms 30000 --reason TEXT` |
| `close_window` | `--hwnd H --reason TEXT` |
| `end`, `status` | No arguments |

- **Tree first.** Read the returned `tree`; it answers most questions.
  **Open the actual `image.path` with the host image viewer** only when you need pixel coordinates, when you are making a visual claim (layout, rendering, colour, image content), or when the tree cannot answer.
  Each image view costs a full model turn. Agent Manager's `read_file` can view its JPEGs. JSON, a reconstructed picture or an accessibility label does not prove visual behavior. Report an unavailable image viewer.
- Every action consumes its `observation_id` and returns a **fresh frame and tree**. Use that reply directly. Do not take another snapshot merely to get a frame you already have.
  Pixel targets require a fresh viewed image. Ordinary named actions are tree-only; add `--image` when pixels or visual verification are needed.
- Combine predictable steps in one bounded `run` with 1–8 `--step` groups. For dozens to hundreds of steps, compute the steps with a script, then run them with `plan`, never one `run` per model turn.
- Never guess an observation id, index or pixel position across a layout change. Never replay an input action after a lost reply or `delivery_unknown:true`.

Examples only: replace handles, frames, indexes, names and paths with values from the current task and its fresh observation.

```powershell
{{DESKTOP_COMMAND}} click --hwnd 123 --observation-id FRAME --name Settings --role Button --risk routine --reason 'Open observed settings' --max-nodes 500
{{DESKTOP_COMMAND}} run --hwnd 123 --observation-id FRAME --reason 'Import, start and wait' --step click --name 'Choose files' --role Button --risk routine --step file_dialog --path 'D:\Samples\cat.jpg' --action open --entry-method clipboard --settle-ms 600 --step click --name Start --role Button --risk routine --step wait --until 'Done' --timeout-ms 30000
{{DESKTOP_COMMAND}} set_value --hwnd 123 --observation-id FRAME --index 9 --text 'Sample' --risk routine --reason 'Set the observed field'
{{DESKTOP_COMMAND}} run --hwnd 123 --observation-id FRAME --reason 'Pick a colour and draw two curves' --step click --name Green --role ListItem --risk routine --step drag --points '[[300,500],[360,470],[430,480],[500,450]]' --risk routine --step drag --points '[[300,560],[380,530],[460,545]]' --risk routine
```

## Where the rest lives

These are packaged operating guidance, not a reason to explore source files. Read only the file the situation names.

| When | Read |
| --- | --- |
| `ready:false`, `update_notice`, any `next_action` or recovery state | [ready replies](references/ready-replies.md) |
| A human must press Esc, take over or re-arm | [handoff](references/handoff.md) |
| Targets, batches, steps files, waits, schemas | [observe and act](references/observe-and-act.md) |
| Dozens or hundreds of steps (drawing, repetitive entry) | [complex tasks](references/complex-tasks.md) |
| Typing, paste, Unicode, Open/Save dialogs | [dialogs and text](references/dialogs-and-text.md) |
| Pause, Stop, permissions, `input_completed`, `delivery_unknown` | [control and permissions](references/control-and-permissions.md) |
| macOS, sidecar unavailable, control bar, task ownership | [platform and sidecar](references/platform-and-sidecar.md) |
| Any other failure code | [recovery](references/recovery.md) |
| Reporting, giving up, feedback, updates | [finishing and reports](references/finishing-and-reports.md) |
| Development or QA qualification | [application verification](references/app-verification.md) |
