# Measuring desktop task latency

## 2 November: full-record correction and tool timing

The compact Flash transcript has SHA-256
`e1ead287f7b18ab84f2f736d587439254564432a711da9bd415967dcdf472d49`.
Its 14 shortened previews initially suggested a 4 KB model/tool delivery cap.
That diagnosis was not supported. The corresponding `transcript_full.jsonl`
(SHA-256 `2d1b1554207050ffd8d89a17d3045c16a37351fab42e7db2b97d86008d9b0935`)
retains all twelve complete controller JSON results and their observation IDs,
the complete diagnostics result, and a 21,751-character skill result including
its command section. The 17,675-byte omission describes the compact log only.
[Issue #41](https://github.com/shayann07/antigravity-computer-use/issues/41)
is closed with the correction, not as a verified runtime repair.

Private structural comparisons are in `.localdata/host-transcript-comparison.json`.
Never publish raw prompts, application text, paths, images or model reasoning.
The task has 97 rows, 48 planner responses and 47 tool calls (39 terminal calls
and eight file/image reads). Its 471.574-second receipt interval includes
37.683 service-seconds. Row timestamp semantics do not establish separate model,
dispatch and result-delivery time. Do not infer lost model input or a speedup
from compact log previews, token counts or these formatting tests.

The automatic byte cap introduced in the first draft `f9dc519` is removed.
Its synthetic tests passed but did not justify discarding useful controls on
an unproven host-limit premise. Default brief output keeps the complete rendered
tree, and explicit full JSON/IPC content remains lossless.

A separate source-proven correction preserves native `tree_incomplete` in brief
CLI output; the old formatter removed it with the metadata object. Pure and
actual CLI/inert-IPC tests verify completeness, exact Unicode, unchanged trees,
input/delivery/cancellation evidence and full JSON. Native execution is unchanged.

The shorter skill proposal is retained at
[revision 0ab5f73](https://github.com/shayann07/antigravity-computer-use/tree/0ab5f7385a0aabd1349c440cfa274721d9a57daf/skills/computer-use)
and in private `.localdata/short-skill-context-proposal.patch`, following
[documented progressive disclosure](https://antigravity.google/docs/skills?app=antigravity).
Its 3,500-byte page target was a chosen context budget, not a host transport
limit. It is deferred from the correctness fix until actual model comparison.
Passing template/link checks did not establish model compliance or task speed.
The established shared skill remains in the narrowed candidate.

The full tool results also contain `Created At` and `Completed At` headers.
All 47 tools have matching ordered pairs and no negative inter-tool gaps.
Their rounded durations are:

| Recorded interval | Calls | Nominal seconds |
| --- | ---: | ---: |
| Terminal tools | 39 | 55 |
| File/image readers | 8 | 2 |
| First tool start through final tool completion | 47 | 480 |
| Time between tools | 46 gaps | 423 |

The 33 controller CLI tool calls account for 52 nominal terminal seconds; the
ready command includes an internal status request, producing 34 controller
receipts overall. Source SHA and raw interval remain unchanged. Headers have
one-second precision: a conservative combined tool-duration range is 22–104
seconds, assuming stable wall time and at most one second of interval rounding.
This is not independent monotonic timing or a precise native/transport split.
The 423-second rounded remainder includes model/host orchestration and possibly
asynchronous application inference; it is not model reasoning alone. A zero-
second displayed read does not prove zero elapsed time.

Private analysis: `.localdata/host-tool-timing.json`. These records support
investigating avoidable decision round trips rather than assuming all the
delay is cursor travel or CLI startup. They do not establish that a daemon,
shorter prompt, different model or batched workflow improves successful wall
time. Actual Flash/Sonnet acceptance, native hardware checks and publication
remain pending. The published installation has not been replaced.

## Reviewed comparison utility

The comparison tool reuses the Antigravity latency worktree's utility from
`a44e532a74fe6863e8c31fd612af99a80ee1273a`, with qualification and input handling
repaired. Its original comparison could report a qualified speedup when workload
identity was missing or completion was a non-boolean value. That branch was not
the published runtime. No wholesale merge of its older runtime or quick-start
changes is implied by adopting this utility.

The remaining prototype helpers are explicitly **not adopted**. An inert audit
of `time-call.mjs` and `benchmark-baseline.mjs` at that revision reproduced an
after-effect timeout reported as `delivery_uncertain:false`, missing milestones
reported as zero, and observations scheduled for `active`, `paused` and
idle-but-open task states. See [issue #38](https://github.com/shayann07/antigravity-computer-use/issues/38).
The audit used only fake child processes, file markers and fake status replies;
no desktop input, installation, permission or Stop latch was touched.

Do not run those unmerged helpers against live controls or use their output as
release timing evidence. Before any adoption they need bounded confirmed child
cleanup, truthful unknown delivery, explicit idle/task ownership checks, unknown
rather than zero milestone values, and selection of the actual installed build.
Killing a client does not prove that its action did not run. The supported direct
IPC client already treats accepted-but-unacknowledged requests as uncertain;
seven current transport regressions passed during this audit. The optional old
helpers are not a required release component. Use the ordinary installed skill
and the reviewed bounded receipt analysis for upcoming real task measurements.

```text
node scripts/measure-run.mjs .localdata/receipts.jsonl PID ISO_TASK_START FINAL_RECEIPT .localdata/run-a.json --first FIRST_RECEIPT
node scripts/compare-runs.mjs .localdata/run-a.json .localdata/run-b.json .localdata/comparison.json
```

Replace the boundaries with actual recorded values. `--first` verifies that the
specified initial receipt exists; it cannot prove that an operator selected the
true beginning of a task. Reports without that explicit boundary remain useful
for inspection but cannot form an eligible pair. Missing sequences, unknown
outcomes, unknown/mixed build IDs, overlaps or backwards timestamps also prevent
pair eligibility. Selected malformed timestamps are rejected, not omitted.
Inputs are bounded to 32 MiB and outputs must be new files: failed evidence is
not overwritten. Precomputed reports cannot silently be filtered by raw-receipt
boundary flags. Wall time uses recorded UTC timestamps; forward clock steps
are not detected. An external monotonic host timer is still needed for strong
end-to-end timing evidence.
Receipt IDs can repeat after PID reuse; archive the bounded raw interval and
never suppress duplicate-sequence errors to force a comparison.

To assess a pair, annotate the bounded reports with independently checked
`completed: true` (or `success: true`), `output_verified: true`, a shared `workload`
identifier and `measurement_scope` (`receipt_interval` or `host_task`). Supply a
`benchmark` object containing `platform`, `arch`, `agent_model`, `host_version`,
and SHA-256 identities named `app_sha256`, `input_sha256`, `settings_sha256`,
`hardware_sha256`, `engine_sha256` and `model_sha256`. Hash canonical settings
including GPU/tile/preset/formats and the actual engine/model bytes; omit private
paths from the specification. Use the empty-content hash for absent engine/model
inputs in non-AI tasks. Keep the full source/build identities and failed runs.

The comparator checks declared metadata; it does not inspect output files,
reproduce inference or establish that an agent's completion claim is true.
Perform those independent checks first. Its `pair_eligible` result is scoped to
one reported matched pair. `release_speed_qualified` is always false: repetition,
failure-rate review and actual Antigravity task evidence remain required. Shorter
failed runs and fewer calls are not successful-workflow speed claims.

### 1 November read-only calibration

The exact installed beta.4 build `c93b8fcbd62e58c6ab0dd355dbaacf622d234ca95b2449e184ecbf2d9bee9b89`
returned seven idle status replies, without starting or driving the desktop.
Complete child-process wall times ranged from 120.1 to 1237.5 ms, median
296.4 ms; median service time was 0.4 ms. This is a small warm-service CLI sample,
not a host/model benchmark or a general startup/input measurement. It does not
support reusing a historical 35–45 ms CLI claim as current evidence.

Re-reading the retained real Flash Upscaly receipts `12880.4` through `12880.37`
with an explicit first boundary gives 34 calls, 471574.3 ms including the final
receipt's duration, 37683.3 service-ms and a median gap of 10675.4 ms. The
433891.0 ms outside service includes inference between calls and host/model/file/
image work; it is not model reasoning alone. One `obscured` refusal remains in
the trace. There is no complete matched environment record for a new run, so
these measurements do not establish an optimization. Private raw evidence is
under ignored `.localdata/latency-comparison-audit/`.

## Wait-path implementation and boundaries

Text and change waits pass their remaining polling budget (at least 100 ms)
to the native accessibility walk. Windows caps it by the existing configured
walk budget; macOS caps it at its existing 4-second default. Truncated or unread
change-wait views stop instead of counting as an application change. This is a
cooperative limit between accessibility calls, not a hard deadline for a hung
provider, grant, screenshot, or cleanup. The Mac candidate now measures its
native walk using the shared monotonic clock and stops on an unavailable or
backwards clock. Focused mocked forwarding and incomplete-view tests passed,
and Windows native compilation passed. Mac native CI, real sleep/wake and
actual application checks remain pending.
The walk's remaining budget is calculated after grant and app-identity checks;
a mocked slow-grant regression covers that ordering. If the budget expires
before a polling or success-verification snapshot starts, the wait now stops
with explicit inspect-without-replay guidance rather than starting that walk.
The 100 ms minimum and post-deadline failure or timeout captures mean the
polling budget is still not a hard limit.
For wait snapshots only, the candidate also asks the driver to time out the
native call after the cooperative walk budget plus 100 ms of transport
grace. A timeout starts worker retirement; the reply can precede confirmed
exit, but the driver fences replacement and reports failed cleanup if the old
worker cannot be confirmed stopped. Mocked worker and forwarding tests cover
that boundary, including the actual JavaScript Driver with an inert worker that
withholds its reply. Wait screenshots also receive a remaining-budget driver
timeout plus 100 ms of grace; if the budget expires during overlay-capture
preparation, the overlay is restored and no screenshot starts. Mocked tests
cover both paths; an inert, unresponsive screenshot worker also exercises the
actual JavaScript Driver, overlay restoration and replacement fence. Startup,
grant, guardian capture preparation and real hung
provider or screenshot behavior remain outside a hard deadline, so issue #25
remains open. Capture preparation now receives a remaining-budget timeout plus
one second; the guardian timeout attempts Stop and directs the agent to inspect
status and prior effects rather than retry. An inert timeout fixture checks the
attempt, not native Stop delivery. A
busy real guardian could hit the shorter limit, so this needs real-app timing
and physical Stop/re-arm qualification before release.
An isolated Windows test also calls the compiled host's budget policy and
checks that a requested limit cannot widen the configured limit; it does not
walk a real accessibility tree or prove provider cancellation.

`wait` and `wait_change` replies include `wait_metrics`: elapsed monotonic milliseconds,
observation count and polling budget. Successful batch steps retain the same
metrics when a later action supplies the final result. These fields contain no
screen text or paths. They describe controller-side wait time, not host/model
decision gaps or native inference. An in-flight observation can still exceed
the polling budget; issue #25 tracks hard deadlines and cleanup. Change-wait
elapsed time includes its initial app-identity check before polling begins.
Observation failures now also carry numeric wait metrics through direct and
batch IPC; failures before observation or while checking cancellation may not.
Inert IPC tests verify the numeric-only fields, not real provider timing.

## Text-only timeout observation

During the existing 500 ms polling interval, the candidate checks control and
worker state at intervals of at most 100 ms without taking extra screenshots.
This should reduce the delay before a waiting request reports Stop; scheduling,
filesystem-check overhead and physical Stop latency have not been measured.

Windows CI job `123905322677` showed an unexpected extra poll. Early timer
wakeup before a fractional target is a plausible cause, not directly measured
in that run. Mac CI jobs `123905322766` and `123905322484` also observed extra
polls in the text/change wait fixture. The candidate now waits until the
monotonic target is reached before polling again. This addresses the observed
early-wakeup path; focused reruns and fresh CI are needed before treating the
failure as resolved.

If the polling budget expires during a delay, the candidate now returns the
last valid text-only observation instead of issuing a further capture. A
control or worker change during that delay invalidates the frame. Failure text
that appears after the retained snapshot is not detected by this timeout;
the agent must inspect the current app before continuing. Fixture tests cover
the frame and cancellation behavior; real-app impact remains unmeasured.

When a text-only wait exhausts its polling budget without a match, it now
returns the last observed frame instead of starting another capture. An inert
probe with a 100 ms budget and a 250 ms observation went from 525 ms with two
observations to 259 ms with one. This is a single synthetic failure-path probe,
not an Antigravity task benchmark. Image-requested waits and success
verification retain their capture behavior. A text-only wait that observes a
failure also returns that same frame immediately and stops the batch. An in-flight observation can still
overrun the budget; the hard-deadline work in issue #25 remains open.
If a success label disappears during the verification capture after the budget
expires, a text-only batch returns that verified frame as a timeout and skips
later actions rather than starting a third capture.

## 30 October 2026: post-action settle investigation

On installed build `6822e63c59dff126e76b6ed2a8413fffc62dcc5b0c15aae716e45e6a4125b052`,
six alternating real Upscaly 1.0.9 Settings openings compared the default 180 ms
post-action settle with explicit `--settle-ms 0`. Each used the default physical
click and checked that the returned tree contained the opened Settings panel.
Service times were 1457.2 / 910.5 / 857.5 ms with the default and 703.2 / 826.8 /
702.3 ms with zero settle; medians were 910.5 and 703.2 ms respectively. The app
was closed and control ended. Private raw samples are in
`.localdata/reliability-current/settle-comparison.json`.

This is one panel, three samples per option and no full task or model timing.
It shows a possible per-action saving but does not validate immediate observation
across asynchronous apps, establish statistically reliable speed, or explain
the much larger host/model gaps. The default remains unchanged until broader
real-app verification supports a safe change.

## 29 October 2026: matched Notepad tasks

Two real Antigravity conversations used the same installed Windows build
`bc45734396d12837098b4cdcd046fd4d36e7c22da7eeeb6acec33fd023cedc9f` and the
same Unicode file-to-Notepad save task. Sonnet 4.6 Thinking took 203,199 ms
(14 controller calls, 18,904 ms service time); Gemini 3.8 Flash High took
181,909 ms (19 calls, 18,530 ms service time). Both independently read-back
outputs matched the input after CRLF normalization, including ZWJ and ZWNJ.
Flash encountered `window_not_found` during close verification. Sonnet
repeated launch/schema discovery. These runs measure different models, not a
before/after speed improvement; neither establishes Upscaly performance or
affected-PC recovery. Private summaries and receipts remain under
`.localdata/real-model-qualification-20261029/reviewed-paired/`.

Reanalysis with the corrected median calculation reports Sonnet median
controller service 505.85 ms and median inter-call gap 8,823 ms; Flash reports
314.5 ms and 7,167.65 ms. The retained intervals contain no internal receipt
sequence gaps, but start at sequence 3 and 9 respectively, so missing earlier
receipts cannot be ruled out from these files alone. These are historical
different-model runs, not a speed improvement measurement.
In those receipts, the gap before `file_dialog` was 19.1 seconds after a
Sonnet batch and 14.2 seconds after a Flash click. These gaps include all host
work between calls; they do not identify model reasoning or prove that batching
would remove them. The skill now shows the already-supported observed Save plus
file-dialog batch, which still stops on failure and requires output verification.
An isolated batch regression confirms fresh-frame propagation and stopping on a
path mismatch; it does not exercise a real native picker. The example needs a
matched real-host benchmark before claiming any savings.

Use a real app task in Antigravity and preserve its exact build, model, input,
settings, prompt start time and final task receipt ID. Save all local test
artifacts under the checkout's ignored `.localdata/` directory. Keep hardware,
model and inference-setting changes visible in any comparison.

```text
node scripts/measure-run.mjs RECEIPTS PID TASK_START FINAL_RECEIPT OUTPUT
```

For example, use `123.18` as the final receipt if that was the task's final
status response. Later diagnostic polls are excluded. The report separates
controller execution, inter-call gaps and verification errors. Gaps include
host/model reasoning, terminal startup, image inspection and file tools; they
are not a measurement of model reasoning alone.
`missing_sequences` counts gaps between included receipt IDs. A nonzero value
means the trace cannot establish complete controller-call coverage; investigate
rotation, failed receipt writes or other calls before using it for comparison.

Verify exported bytes and actual native-engine completion separately. An app
can fail while every controller call succeeds. Failed exports do not qualify
as faster successful workflows. A different tile size or GPU is a different
workload; distinguish orchestration improvement from faster inference.

The current speed work reduces round trips through observation-bound exact
selectors, sequential action/wait batches, text-only section queries and shorter
skill instructions. It preserves native permission/identity checks, fresh
observations and independent Stop. A timed-out wait stops the batch without
replaying its earlier input. Real-app qualification remains separate from unit
tests and native component fixtures.


---

The records below are retained historical snapshots. Their pending status, test counts and next-candidate descriptions refer to those earlier builds, not the current checkout.

# Historical qualification record

The final Agent Manager run of the first beta candidate was cancelled after roughly 8minutes at import, with about 9 desktop actions. It is a latency failure, not acceptance. The release remains draft.

The trace included about 17 separate schema descriptions, model-created request/result files per action, old artifact reads, screenshot copies and 6–35second gaps between operations. Native input time alone does not explain the wall time. Model deliberation, terminal tool scheduling and image viewing are also part of the experience.

## Candidate changes

- Short installer-managed launcher and strict named flags eliminate routine per-action request files.
- One-call multi-schema discovery and skill quick reference remove catalogue setup loops.
- Brief replies omit duplicate metadata. Semantic action replies default to tree-only; pixel decisions still require an actual viewed screenshot.
- Bounded local receipts automatically record service time, gaps, delivery and verification outcomes. They omit text, clipboard data, UI trees, permission reasons and capabilities. Storage failures never hide delivered input.
- Optional launch-and-observe uses only an unambiguous exact launched PID/executable; ambiguity and capture failure preserve launch evidence without inviting relaunch.
- Small batches validate the complete plan first, observe freshly between steps, capture at the final checkpoint and stop on action or verification failure.

## Required comparison

Run a fresh No Project conversation in the real Agent Manager, preserving the selected model and permission preset. Compare the same real Upscaly launch/import prefix, then finish AI PNG export, view the actual output, and complete a second-session Unicode paste/save task. Record total time, model/terminal/image calls, avoidable artifact files, service time and gaps. Keep failed runs intact. Unit/mock timing is not proof of host speed.

Status:88 source tests pass. Installed speed1 build8d9d8082 launched actual Upscaly with its first image in3.7seconds; a two-step real-file import batch took6.8seconds and left no picker. A second real Notepad session refused paused input and the old frame after Resume, then saved an exact1319-unit Unicode sample with clipboard restoration. These are direct controller timings, not Agent Manager wall-time improvement. The stock host-control API could not restore minimized Antigravity; the actual host comparison remains pending human restoration. Hardware-dependent mixed-DPI checks and physical emergency re-arm remain separately scoped.

The short entrypoint uses bundled Node and an exact-release JavaScript import, with no command-shell forwarding. Literal quotes, percent signs, metacharacters, Urdu and emoji are covered by an executable argv regression. Project-local launchers are isolated from the global launcher. Installing over a live service is refused before writes; end and shutdown the task first.

Further direct witness: private2 returned Notepad's exited-starter handoff in1517ms, with the actual window discovered223ms later and no duplicate launch. Earlier runs waited roughly8.5seconds for a window belonging to the already exited starter. This removes that bounded wait without guessing the handed-off process. Explicit filename paste then saved exact Unicode content in a2932ms command. Actual Agent Manager call/gap/wall-time comparison remains required.

## Actual Windows host finding (24 October)

Agent Manager terminal processes were attached to an `exebox` desktop while the visible input desktop was `Default`, even with Turbo selected. Detached children also died between ordinary terminal calls. A foreground service in a host background task survived independent calls but its launched app was hidden and UI Automation failed. These failed attempts are retained; process lifetime alone was not the fix.

A native read-only desktop preflight now refuses mismatched/unavailable input desktops before app operations. Starting the pinned local companion on the normal desktop allowed the real global `/computer-use` skill in a fresh No Project conversation to import Upscaly media, perform native RealESRGAN AI PNG export, restore settings and finish normally. Independent file/database/engine checks confirmed PNG1920x1320 and actual NCNN inference23468ms. This task took roughly five minutes; its successful completion is not a claim that remaining latency is solved. Most native actions were400-900ms, with6-35second gaps between decisions and one30second wait. Model deliberation, image viewing and host task delivery still dominate.

The next candidate adds opt-in App Sidecars for host-managed local process lifecycle, and a passive listener that releases idle control while remaining available for the next session. Sidecars are documented at https://www.antigravity.google/docs/sidecars/ . Registration, rollback and idle Pause/Stop preservation have component tests; actual App-managed startup must be verified separately. No desktop switching, WMI recovery or host security changes are used.

Named no-file batches were exercised in the actual host on the installed AEA05 build: one real JPEG export task finished in235796ms with17controllercalls,18356service-ms and median native call436ms. JPEG differs from the prior PNG benchmark; these are bounded individual witnesses, not a statistical format-independent speed guarantee. Remaining median gap9479ms includes model/host/tool work. The actual executed --step command was inspected, rather than inferred from a requested example.

A real settings-discovery defect was reproduced: query `format` returned only FORMAT/Export format labels while a separate JPEG query found the button. The candidate now reuses the foundation subtree traversal to include a matching section’s child controls, preserving observation indexes and offscreen state. This should remove extra catalogue/full-tree reads; packaged real-app qualification is separate from the source test. No Upscaly source or preferences were changed for this fix.

