# Startup and ownership

Call the installed `ready` once through the host terminal tool. This direct
skill uses Antigravity's existing model and a persistent native runtime, with
no required MCP or separate model. Do not mix it with another controller.

Follow the returned action:

- `discover_or_launch`: `apps` for an existing/unknown window, or
  `launch --app PATH --observe --reason TEXT` for a known executable. Windows
  uses an existing EXE; Mac uses an existing .app and cmd/option shortcuts.
- `awaiting_human_rearm` / `awaiting_human_resume`: tell the human the requested
  action, then wait. Never claim visibility without `controls_visible:true`.
- `human_start_on_visible_desktop`: ask the human to run the launcher named in SKILL.md
  once on the visible desktop. Windows host terminal jobs can use an isolated
  exebox desktop even in Turbo. Do not switch desktops, use WMI, change policy
  or repeatedly launch helpers. No invented IDE/Sidecar panel.
- `inspect_diagnostics`: run `diagnostics` once and report its incident ID.
  Repeated startup is not recovery.
- `resolve_version_mismatch` / `client_build_mismatch:true`: stop and report
  the skill/service mismatch. Do not overwrite a project pin or interrupt an
  active task to replace its build.
- `inspect_stop_persistence_without_restart`: native Stop storage failed.
  No restart, re-arm or further input until the operator inspects storage.
- `inspect_input_cleanup`: input release is unconfirmed. Report it; no input
  replay, forced update or repeated requests to re-arm.

`inspect_recovered_task`, `inspect_prior_input_cleanup` or `recovered_task:true`
means a previous task survived restart. Its last input may have happened.
Existing-app observations remain subject to normal permissions; new input and
launches are refused. If you can establish this is your task and no other
conversation owns it, call `end` once. On both platforms the runtime can verify
supported records only when every recorded old process is gone and the exact
old input ledger is empty. Never read/delete private guard files yourself.
Legacy, missing or unverifiable records stay blocked. If End still asks for
prior cleanup inspection, report the operator handoff and stop. Stop still
needs local human re-arm; End cannot grant it.

The Sidecar shares task state between callers; it does not authenticate the
owning conversation. Action serialization does not establish task ownership.
An idle status alone is insufficient: coordinate one task at a time.

Passive startup/status do not open controls. `end` hides them without closing
the listener or clearing Stop. Use `shutdown` only for authorized update/removal.
Mention a returned `update_notice` once; do not investigate it during a task.

If the command itself cannot resolve or fails, report the exact error and stop.
Source-file exploration is not a replacement for a working controller.
