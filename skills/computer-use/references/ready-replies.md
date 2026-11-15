# Ready replies and recovery states

Read this when `ready` returns `ready:false`, an `update_notice` or a `next_action` you do not recognise. Perform only the returned `next_action`. Do not invent a recovery path.

Run `ready` once. Follow `next_action`:

If `update_notice` is returned, mention its short message once. Do not dump update
state, restart the host or interrupt the requested task to investigate it.
- `discover_or_launch`: choose `apps` for an existing/unknown window or `launch --app 'D:\Apps\Example.exe' --observe --reason 'Open the requested app'` for a known executable.
  Windows 11 Store apps (Paint, Calculator, Notepad) need the real `.exe` inside their package: `(Get-AppxPackage Microsoft.Paint).InstallLocation`; aliases in System32 or WindowsApps are refused.
- `awaiting_human_rearm` / `awaiting_human_resume`: controls were requested. Tell the human what action is needed, then wait. Never claim a bar is visible unless `controls_visible:true` was returned.
- `inspect_diagnostics`: run `DESKTOP_COMMAND diagnostics` once, report the incident ID and stop repeating startup. Do not invent an Antigravity Sidecar panel or repeatedly ask the user to rerun the starter.
- `resolve_version_mismatch` or `client_build_mismatch:true`: the selected skill and running service use different builds. Stop and report the mismatch; do not interrupt another task, overwrite a project pin or restart repeatedly. An operator can reconcile the intended deployment before retrying.
- `end_recovered_task`: a leftover task was opened but never sent input, and its controller is gone. Call `end` once, then `ready`. Every blocked reply also carries a `recovery` object:
  `actor` (agent, human or operator), the exact `command` (or a `reason` when there is none) and `safe_when`. Follow it instead of guessing. While a recovered task is unverified, `controls` shows the bar with Stop available and re-arm locked.
- `ready` and `status` also report `task_age_ms`, `last_activity_ms_ago`, `held_resources` (grant count, input held), `task_origin`, `task_liveness` (active, idle or orphaned, with `task_liveness_rule`) and `owner` (self, other, unknown or none).
  Use them to tell a leftover task from a live one before deciding anything. They are a coordination hint, not authentication, and carry no tokens.
  Refusals for a flag or path you can fix (`fix_arguments_and_retry`) allow replay because nothing was sent; every other refusal keeps replay off.
- `inspect_recovered_task`, `inspect_prior_input_cleanup` or `recovered_task:true`: the controller restarted with a task still open. Its last input may have happened; inspect existing app state or artifacts without replay.
  Snapshots of already running apps remain available under the normal permission rules, but target actions and launches are refused. If you can establish it is your task and no other conversation owns it, call `end` once.
  On both Windows and macOS, supported records can close only after the runtime verifies that all recorded prior processes are gone and the exact old input ledger is empty.
  The runtime performs this verification; never inspect/delete private guard files yourself. Missing, legacy or unverifiable records remain blocked. If End still reports `inspect_prior_input_cleanup`, stop and report that operator inspection is needed.
  Do not force an update, clear the marker, or end another caller's task. Emergency Stop still requires local human re-arm.
- `inspect_stop_persistence_without_restart`: control is stopped but the emergency latch could not be saved. Report this and do not restart or send further input; the operator must inspect the controller's private storage.
- `inspect_input_cleanup`: automation-held input cleanup could not be confirmed. Report the failure and stop; do not repeat input, force an update, or ask the user repeatedly to re-arm. The operator must inspect the native ledger and cleanup state.
- If `control_reason` is `guard_persistence_failed` or `stop_persistence_failed`, report that native control storage failed and do not restart or send further input. The operator must inspect storage before continuing.
For another recovery `next_action`, read only the relevant case in
[recovery guidance](recovery.md). This packaged skill reference is
operating guidance, not a reason to explore source files. Stop if the reply says
human action or diagnostics are needed; do not try a different launch method.
