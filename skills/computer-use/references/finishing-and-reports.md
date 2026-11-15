# Finishing a task, failure reports and updates

Read this before reporting a result, giving up on a task, recording feedback or touching updates.

Report the result within a fixed budget. Confirm completion from the app's own text in the tree, then check the produced artifact once (one file check of the expected path).
If the app does not show the output path, use at most one visible control that opens the output folder, or say the path was not shown. Do not explore history panels, hover for tooltips or search the disk to find it.
Restore test-modified preferences, close only owned disposable windows with `close_window --hwnd HANDLE --reason ...`, and call `end`.

If your own `ready` returned a `task_token` and you give up before finishing, still call `end` once before reporting, so your open task does not block the next conversation with `task_owned`.
If `end` is refused, report its reply and `recovery` instead of retrying.
This never applies to a task you do not own (`task_owned`, or `ready:false` without a token), while you are waiting for a human handoff, or when a reply's `next_action` or `recovery` says to report and stop.
A later task can begin without restarting Antigravity. For broader development/QA qualification, see [application verification](app-verification.md).

The runtime automatically records sanitized, deduplicated incidents. A reply with `diagnostic_pending:true` means recording is still in progress, not yet confirmed; check `status` once before `diagnostics` and report any `diagnostic_error`.
After an unresolved failure, include the incident ID and failed step in your task result. Run `diagnostics --submit` only under the installation's explicit reporting consent.
Missing authentication/consent leaves reports pending; never invent submission success. Do not copy screenshots, user text, paths or credentials into public issues.

Before ending a task, briefly assess whether the controller showed an unresolved usability, reliability, speed or missing-capability concern.
For a real concern not already captured as a runtime error, record one structured report with `feedback --category CATEGORY --operation OPERATION --evidence observed` (use `suspected` or `reproduced` when accurate).
Run `describe feedback` once for the fixed categories; no free text is accepted. Do not invent concerns, interrupt the task to investigate, or duplicate an automatically logged failure.
Reports are explicitly unverified agent observations; the runtime retains them locally and submits sanitized metadata only when the installation's reporting consent and GitHub authentication permit it. Do not claim an issue was opened without confirmation.
Instructions cannot force every model to notice or report every defect; runtime errors are recorded independently of model compliance.

Ordinary desktop tasks must not edit or replace the installed controller. Authorized development tasks should reproduce the defect, add a regression and submit a reviewable branch/PR. Never self-merge a repair while using the controller.

Use `update status` or `update check` to inspect/stage signed published updates. Automatic installation waits for idle and confirmed input cleanup. Updates cannot clear Stop or approve OS permission dialogs.
Do not change update policy, use unsigned payloads or interrupt a task to force installation.
