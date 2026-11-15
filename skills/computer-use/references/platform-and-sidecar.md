# macOS, the sidecar and the control bar

Read this on macOS, when the sidecar is unavailable, or when you need to know how the control bar and task ownership behave.

On macOS, launch an existing `.app` bundle such as `/Applications/Example.app`; returned `hwnd` values are opaque window handles with the same observation rules. Use the application's Mac shortcuts (`cmd`/`option`) where appropriate.
Required macOS Accessibility, Screen Recording and Input Monitoring grants must be completed by the human through the installed **Setup.Mac.Permissions.command**. Never operate system permission prompts or weaken a refusal.
The native Mac adapter is experimental until the documented interactive qualification passes; a compile/contract test is not desktop acceptance.

The installed App sidecar keeps a passive listener across tasks. Finish with `end`; use `shutdown` only for updates/removal. `ready` starts a task (its reply says `task_started`); to check state after `end`, use `status`, which never opens a task.
The pinned launcher's build must match the listener. Windows Agent Manager terminal jobs can run on an isolated `exebox` desktop, even in Turbo.
If the sidecar is unavailable, the human starts the controller starter named in SKILL.md on the normal desktop or restarts the App's Computer Use sidecar.
Do not use WMI, switch desktops, change policy or restart a live unresponsive controller to get around this boundary.

The direct Sidecar currently shares one task state between callers; it does not
authenticate which conversation owns the session. Individual actions are
serialized, but a second caller's `end` can clear another caller's grants and
frames between actions. Coordinate one desktop task at a time; if another task
may own it, do not start or end its session. A momentarily idle status alone
does not establish ownership. This limitation is tracked in issue #7.

Passive startup/status never opens the control bar. After Stop, the bar confirms for four seconds and hides; `controls` explicitly shows it without granting permission or sending input.
`end` hides it. Do not leave controls open during unrelated code work.
