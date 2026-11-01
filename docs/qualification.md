# Qualification checks

Read VALIDATION.md for the latest result. Record the exact installed build ID, native SHA256 and app executable hash before a desktop check. Retain failures as well as successful recovery; do not overwrite a failing receipt with a later passing label.

## Source and installed files

Run `npm test` on Windows. This covers component behavior and native pure-function harnesses; it does not perform a full Antigravity task.

Run `node scripts/verify-install.mjs <installation-folder>` to verify the installed manifest and global skill pin. Compare any project-local skill too. File integrity proves identity, not application behavior.

## Actual Antigravity task

Use the Agent Manager App, a fresh No Project conversation and its registered `/computer-use` entry. Keep existing host settings. Ask it to report the build ID, follow the skill quick reference, fetch only unfamiliar schemas together, launch a real existing app and open an actual returned screenshot in its available image tool. Avoid per-command catalogue setup, per-action receipt files and screenshot copies. Automatic bounded receipts are sufficient. The tested App uses `read_file`; do not assume IDE tools exist.

Exercise both semantic and screenshot-coordinate actions, an owned native dialog and a meaningful application result. Independently inspect produced files for an export task. Verify soft Pause blocks input, authorized Resume invalidates the previous observation, normal End clears grants, and another session works without restarting Antigravity. Never count accessibility text alone as image viewing.

## Installed Stop and physical re-arm

The interactive source harness `tests/installed-stop-resume.mjs` verifies an
explicit installed release against its expected published build ID. It requires
Windows, a host-managed installation and an operator-owned harmless real app.
Reserve the physical desktop and keep other agents out of control. The initial
service must be idle with no open/recovered task or grants; the harness refuses
to take over another task. It never changes the installed permission policy.

Create a private JSON file with:

```json
{
  "installation": "D:/YOUR-PRIVATE-INSTALL/installation.json",
  "expected_build_id": "REPLACE_WITH_THE_VERIFIED_PUBLISHED_BUILD_ID",
  "hwnd": 123456,
  "from": [100, 200],
  "to": [300, 200],
  "evidence": ".localdata/tests/installed-stop-resume/new-owner-run",
  "close_owned_window": false
}
```

Use the installation printed by the supported installer and the identity from
the verified signed release. Replace the example HWND and coordinates with
observed values for a harmless test canvas; do not drag files, user content or
destructive controls. Evidence paths are resolved from the checkout and must
stay under ignored `.localdata/tests/`, regardless of the current directory.
Use a new directory for every attempt; existing failed evidence is never
overwritten. Omit `evidence` for an automatically unique directory. Closing the
target window is off by default; enable it only for an explicitly owned
disposable window, not a shared app containing the user's other tabs/documents.

A read-only preflight can be run before the human is available:

```text
node tests/installed-stop-resume.mjs .localdata/tests/stop-config.json --check-only
```

This verifies sealed files, private installation, fixed policy and idle status.
It does not show controls, inspect an app, send input or qualify a physical test.

For the interactive check, run without `--check-only` in a terminal session with
stdin available. The harness reserves its task, returns an actual screenshot
and waits for `BEGIN`. Open that image and check the harmless drag path before
sending the start signal. `BEGIN` coordinates the test; it is not a permission
approval, physical Esc event or re-arm. If the signal is absent, the test ends
without a drag. A stale/moved frame or refused action is not replayed.

With the human ready, the harness performs one drag followed by seven queued
harmless moves. The human presses **physical Esc while the selection is moving**.
No Stop/Esc chord is injected. A short-lived sampler records the actual held
ledger before Stop; missing, unreadable, linked or malformed ledgers do not
prove cleanup. The current journal is selected from the durable task record,
not the first filename matching a reusable PID. The check requires native
`escape` reason, first-step interruption and seven skipped steps. If that event
or held sample is missed, retain the failed/partial run rather than retrying it.

After verifying refusal of software Resume/observation, End and a passive
service restart must preserve Stop. The harness explicitly requests visible
controls before asking for **one local Re-arm**; a passive restart alone does
not show them. It reserves the continuation while awaiting the human and sends
no app input during that wait. Then a fresh observation and harmless pointer
move exercise a second session, followed by End and grant/cursor checks.

The record separates scoped checks from complete release qualification.
An empty ledger alone does not prove release delivery to the target app;
independent target/cursor observation still needs review. Timeouts never permit
programmatic latch deletion or manufactured re-arm. On failure the harness ends
only its reserved task; uncertain in-flight input may request Stop for cleanup,
and that cleanup request is never counted as physical Esc.

`tests/installed-qualification.test.mjs` also exercises this procedure with an
inert in-memory transport, including an already-owned task and incomplete Stop
evidence. Those records carry `evidence_kind: inert_fixture`; no native process,
physical input or human re-arm occurs. They check the harness's decisions, not
desktop acceptance. CLI/configuration arguments cannot select that fixture.

The original dev7 run used the older synthetic-hotkey plus human-Esc procedure.
Its final close call failed because the test supplied an unsupported argument;
close/end were recovered separately and the failure was retained. That record
predates the new physical-held-drag procedure. It is neither a clean whole-script
pass nor current-build physical qualification.

## Covered-window capture

`tests/capture-scope-live.mjs <release-folder> <private-evidence-folder>` launches two isolated test processes, grants only the target and checks that target capture contains no blue cover pixels. It changes visible windows and must respect desktop reservations. It requires the Windows compiler for its test fixture; normal installation does not.

The new helper passed this case. The suspected older-helper leak did not reproduce on the tested desktop. That is a limitation of the reproduction, not evidence of a failing-before regression. More display/provider combinations still need testing.

Never publish private desktop images, local capability files, approvals or user data as test artifacts. Hardware mixed-DPI/multi-monitor checks, host Ask/Deny behavior and broad app/model qualification need their own records.

## Provider exceptions without replay

On an exclusive interactive Windows desktop, run `node tests/provider-failure-integration.mjs <exact-release-folder> <new-private-evidence-folder>`. This developer test compiles an owned WPF target using the Windows Framework compiler; normal bundle users need no compiler. It records dispatch, effect and physical-click counters for a provider that throws after its effect and one that refuses before effect. It never retries either action itself, normal-ends control and closes only its owned target. Do not run concurrently with another desktop task.

The old nativea2 helper failed with an automatic physical fallback in both cases. Candidate nativea2fd passed with one dispatch, no physical fallback, correct effect counts and input_outcome_unknown. Error means observe the actual result before continuing; it does not prove no effect. The harness retains compile errors and full private results while printing bounded counters. It is a native fault-path regression, not an autonomous task or actual app qualification.
