# Observing, acting and waiting in detail

Read this for the detail behind the command table in SKILL.md: targets, batches, steps files, waits and schemas.

- A refusal that says no input was sent (`target_not_observed`, `no_image`, a bad point) leaves the frame usable: fix the call and reuse the same `observation_id`.
- Prefer observed accessibility indexes or exact **unique** `--name`, `--role`, `--automation-id`. Names resolve against that frame's bounded native snapshot, not an unbounded live search. Ambiguous/missing controls refuse; inspect rather than guess.
  `--query 'Export format'` returns a matching section and its child controls. Named section snapshots are tree-only by default; add `--image` for visual inspection. Queries are literal substrings, not regex.
  If a reply is truncated, use one relevant section query or `--max-nodes 500`, rather than many repeated full screenshots.
- Clicks move the real animated pointer by default, including named/index targets. They retain observation-scoped resolution and native ownership and visibility checks.
  Use `--physical false` only when an accessible control requires a semantic action; it may leave the pointer stationary. `set_value`, invoke and other semantic actions need not move it. Do not claim pointer movement for a semantic action.
- Combine predictable steps in one bounded `run` with 1–8 `--step` groups. The runtime observes between steps, resolves names from fresh state, and stops on the first failure. Do not guess future indexes or pixel positions across layout changes.
  Root owner/frame/reason precede the first group. The last step returns an image by default; use `--no-image` explicitly when appropriate.
  Add `--images all` before the first group to get a screenshot after every step (in `batch.completed[N].image`), for example to show the state between two steps.
- To check a short animation or transition, `burst --hwnd H --frames 6 --interval-ms 150 --reason TEXT` returns 2-10 screenshots taken at that interval (pictures only, no input).
- Every image reports `scale` (image pixels per screen pixel; images are capped at 1400 px wide) and `client` (the app's client area inside the image). Images are kept in the observations folder as the newest 50 only: copy one elsewhere if you need it later.
- Pixel steps (`click --x --y`, `move`, `drag`) may follow each other in one `run`: each step captures the screenshot the next pixel step needs.
  Take every position from an image you viewed, and end the batch to look again before anything that opens a menu, dialog or new view. A pixel step straight after a `wait` is refused; look first.
- A short sequence of up to 8 steps can live in a UTF-8 JSON file: `run --hwnd H --observation-id F --reason TEXT --steps-file FILE`.
- **Long or complex work (dozens to hundreds of steps: drawing, repetitive data entry, many similar edits): compute the steps with a script, then run them with `plan`**, not one `run` per model turn.
  `plan --hwnd H --observation-id F --plan-file STEPS.json --ledger LEDGER.json --reason TEXT [--checkpoint-every 6] [--renew-budget N]` sends the steps as consecutive `run` batches of 8, records progress in the ledger, re-observes after a spoiled frame, never replays a step that may have run, and halts on any other refusal.
  Every `--checkpoint-every` batches it returns a frame: look at it, then run the same command again with its `observation_id` and it resumes from the ledger. A changed plan needs a new ledger file.
  `--renew-budget N` lets it end and restart the task at most N times when the 200-action budget runs out; the reply then carries the new `task_token`, which you must use from then on. Do not write your own loop around `run`.
  Read [complex tasks](complex-tasks.md) first: plan offline, preview, calibrate by measuring, run, then compare the result with the goal.

A steps file for the same idea holds `[{"kind":"click","name":"Green","role":"ListItem","risk":"routine"},{"kind":"drag","points":[[300,500],[360,470],[430,480]],"risk":"routine"}]`.

Fetch only unfamiliar command schemas in **one** `describe scroll` call; the table above already covers clicks, hover, drag and `run`. Do not read every schema, implementation or historical test script to operate an app.
Named flags need no JSON request files (`--steps-file` is only for long `run` plans); automatic receipts already record bounded timings/delivery. Use UTF-8 `--text-file` for large generated text. Keep user-facing progress brief, without raw trees/log dumps.

For processing, use `wait --hwnd 123 --until 'ACTUAL EXPECTED TEXT' --timeout-ms 30000 --reason 'Wait for the observed result'`.
When you do not know the completion text but can see a progress or Cancel label (for example `Stop upscaling`), use `--until-gone 'Stop upscaling'` instead: it returns once that observed text has disappeared from a complete tree.
The text must appear within about 3 s of the wait starting, so an action followed by `wait --until-gone` can share one `run`.
`wait_label_not_observed` means it never appeared (the job may already have finished, or a splash already closed); when that reply carries a frame, act on its `observation_id` instead of taking another snapshot.
If you know the app's actual failure labels, `--abort-on 'Failed,Cancelled'` stops early when one appears; failure wins if both success and failure are visible. Labels are literal substrings; select specific observed text.
Do not combine `--query` with `--abort-on`: filtering may hide failure labels, so this combination is refused before input. If a failure-aware wait reports an incomplete tree, inspect the result before continuing; do not replay the previous action.
Even an unfiltered accessibility tree may omit offscreen or inaccessible errors; inspect the result independently.
A `--step wait` may follow an action in a batch; combined polling budgets are at most30seconds, and an unmet or aborted wait stops subsequent input.
An in-flight observation may extend actual elapsed time beyond that budget; do not assume the request has finished or start another action until its outcome is known. Never invent a completion or failure label.
A known output can instead be watched by ordinary authorized file tools with a bounded deadline, then checked independently and against the GUI. Start once; a timeout is a reason to inspect, never resubmit.

Intermediate batch text waits skip the screenshot when the next step uses an
accessible target. A final wait captures an image by default, except a named
section query defaults to text only; use `--image` when needed. Pixel actions immediately after a wait are refused in a
batch because the agent has not seen that intermediate image: end the batch,
inspect a fresh screenshot, then act.

When the next accessible label is unknown, `wait_change --hwnd H --observation-id F --timeout-ms 30000 --reason 'Wait for this view to update'` consumes the current frame and returns a fresh text-only frame on a tree change or timeout.
It uses the original snapshot's query and node limit. Incomplete trees are refused or returned for inspection rather than treated as a change; do not replay an earlier action.
`--step wait_change` can also follow an action in a batch; it compares that action's returned frame, and a timeout stops later steps. A change may already have happened before that frame, or may be unrelated; canvas or pixel-only changes may not appear.
Inspect the returned tree and take a fresh screenshot when needed. A change is never proof of success, and a timeout is not permission to repeat an earlier action.

For responsive-layout checks, `resize_window --hwnd H --client-width W --client-height H [--units logical|physical] --reason TEXT` sets the client area of a resizable top-level window exactly (DPI aware) and returns a fresh frame.
The reply gives the resulting client size in physical and logical pixels; `matched:false` means the app enforced its own minimum or maximum. A window without a sizing border is refused with `window_not_resizable`. Windows only.
