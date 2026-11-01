---
name: computer-use
description: Operate and visually verify Windows and macOS desktop apps using Antigravity's existing agent and the installed native controller.
---

# Computer use

Use the installed command through the host terminal tool. First call:

```powershell
{{DESKTOP_COMMAND}} ready
```

If `ready:false`, follow only `next_action`; see [startup](references/startup.md).
Do not search source, logs or old evidence to operate an app. Do not invent a
Sidecar panel, restart a live controller or repeat startup. Only say the bar is
visible when `controls_visible:true`. Never manufacture approval or local re-arm.
Human launcher (only when requested): **{{CONTROLLER_START}}**.

Reuse the command prefix with the suffixes below. H/F/N are observed window,
one-use frame and element index. Work sequentially:
`ready → apps/launch → snapshot → action/verify → end`.

| Suffix | Use |
| --- | --- |
| `apps` | Find windows; do not relaunch an uncertain prior launch. |
| `launch --app PATH --observe --reason TEXT` | Existing EXE or Mac .app; reuse its frame/image. |
| `snapshot --hwnd H --reason TEXT` | Fresh tree/image. `--query TEXT` is literal and tree-only; add `--image` when needed. |
| `click --hwnd H --observation-id F --index N --risk routine --reason TEXT` | Animated real cursor. Exact unique `--name TEXT --role Button` can replace index. |
| `set_value --hwnd H --observation-id F --index N --text VALUE --risk routine --reason TEXT` | Observed field. |
| `end` | Release grants, cursor and controls; keep the passive listener. |

Open actual `image.path` with the host image viewer at visual checkpoints.
Pixels require a fresh viewed image. Reuse each action's returned frame; avoid
redundant snapshots. `tree_incomplete` means known omissions: query the relevant
section; never assume all controls/errors were shown. See [observations](references/observations.md).

Combine predictable steps using [batches/waits](references/batches-and-waits.md).
Read only unfamiliar schemas in one `describe COMMAND...` call. See [text and
file dialogs](references/text-and-dialogs.md) for exact Unicode/import/save.

`input_completed:true` plus verification failure, `delivery_unknown:true`, or
`input_outcome_unknown` means inspect the effect; never replay the input.
Follow [recovery](references/recovery.md) after errors. No desktop switching or safety bypasses.

Coordinate one task/controller at a time. Never End another caller's task.
Esc/Stop stays latched until local human Re-arm. Soft Resume needs explicit
user authorization and fresh observation. Never simulate physical handoffs,
poll for them, or open Ask Question merely because control paused.

Before End, assess controller concerns. Native permissions remain authoritative.
Read [control/feedback](references/control-and-feedback.md)
for sensitive actions, handoffs, mandatory concern assessment and consented
reporting. Ordinary tasks must not modify the controller. Verify real results,
restore test settings, close only owned disposable windows and `end`.
