# Reliability and updates implementation log

2 November source candidate: [Stop uncertainty preservation](STOP-UNCERTAINTY.md)
records a reproduced native/shared marker downgrade and its monotonic repair.
It is not a correlated native acknowledgement or completed physical recovery
protocol. Existing installed/released bytes remain unchanged; #26 stays open.

On 30 October the final Intel Mac qualification and repair pass on
`codex/argon-final-mac` (from `v0.3.0-beta.3` baseline `b33940c`) reproduced and
repaired the macOS Chrome/Space window capture failure (`_AXUIElementGetWindow`
direct `CGWindowID` resolution, browser/document title suffix matching, off-Space
`WindowRegistry` retention, retired handle `identity_changed` classification,
5-state deterministic Space/capture classification with 1 bounded recovery
attempt before refusing repeated polling), updated `MacVisuals.swift` to use
Apple's native `NSGlassEffectView` on macOS 26+ with pure filled Phosphor Icons
(without status dots or strokes) and high-contrast crimson emergency tint, and
added `priorMacCleanupVerified` for verified macOS recovered-task completion.
See `docs/MACOS-QUALIFICATION.md` for live Chrome/Space/Full-Screen/Minimized/Hidden
receipts (`34634.4`–`34634.24`) and remaining physical hardware boundaries.

On 30 October the local Windows source suite at `8811630` passed 430 tests,
with 11 explicit skips and no failures (`node --test --test-concurrency=4
tests/*.test.mjs`); provenance checked 175 recorded files without mismatches.
This source result does not qualify physical Stop, native pipe loss, Mac
hardware, real Antigravity workflows, or production updates. Issue #26 remains
open. Mac CI for the preceding pushed revision was still running at this check.

The Stop candidate now persists its latch and aborts the driver even if the
guardian pipe throws. It retains an unconfirmed-delivery state across repeated
Stop attempts and refuses automatic recovery; an absent passive guardian does
not need to be launched merely to latch Stop. Simulated tests cover pipe loss,
latch-write failure, repeat attempts and passive Stop. An accepted pipe write
is still not a native Stop acknowledgement, and real pipe loss, restart and
physical re-arm remain unqualified.
An uncorrelated delayed `stopped` event no longer clears the in-memory
unconfirmed-delivery state; a simulated stale-event regression covers this.
No current protocol response proves which Stop a native event acknowledges.
[Issue #26](https://github.com/shayann07/antigravity-computer-use/issues/26)
tracks the remaining durable-reason and authenticated recovery gap across
controller restart. The generic Stop latch alone does not prove native delivery.

On 30 October the local Windows source suite at `c0b95e2` passed 426 tests,
with 11 explicit skips and no failures (`node --test --test-concurrency=4
tests/*.test.mjs`). The skips are not native qualification. This does not prove
physical Stop, the real Antigravity workflow, Mac hardware or published updates.

Guardian requests now clear their pending timer if the pipe write throws and
attempt Stop without assuming delivery. Timeout rejection also survives a Stop
write throwing. A known unavailable pipe fails promptly; stream backpressure
is still treated as an accepted write. The local controller invalidates frames
and aborts its driver when Stop delivery is uncertain; a missing durable latch
is reported rather than treated as confirmed Stop. Simulated broken-pipe tests
cover timer cleanup and reporting;
actual native pipe loss, Stop persistence and physical recovery remain pending.

The timeout-frame candidate initially captured the worker epoch before its
first observation, which could mistake a normal first worker start for a
restart. It now binds to the epoch after that observation and rejects a change
during later verification or the polling delay. Inert tests cover first start,
restart and frame invalidation; real controller startup remains unqualified.

When a scheduled-update or reporting timestamp is in the future after a wall
clock correction, the candidate rebases it to the current time without an
immediate network request. This avoids an indefinite future wait and preserves
the normal daily/hourly throttle after the correction. Transaction fixtures
cover update and consented-reporting scheduling; real system-clock changes,
restart behavior and elapsed-time guarantees across clocks remain unqualified.

On 30 October at 10:06 a.m. Pakistan time, a read-only Codex window inventory
returned no targetable Antigravity or Upscaly window on the current desktop.
Antigravity processes still existed, but process existence does not establish
desktop ownership or availability. No window was launched, restored or clicked;
real-app qualification was deferred rather than disturbing another session.

Failure-aware waits also check the captured node names and text before display
shortening or row pruning; only the caller's matching label is returned. This
can conservatively stop on an old or hidden matching label and does not detect
text never supplied by the application or omitted by the native walk. An inert
regression covers a failure hidden by rendering; real-app behavior is pending.

Wait failure, incomplete-view and timeout responses now give the agent explicit
inspect-without-replay guidance, including after an earlier batch input. An
authenticated IPC fixture checks the incomplete-view path and skipped action;
the corresponding real-model response remains unqualified.

Intel CI job `123898938830` at `f9aa5c2` failed compiling the Mac storage
helper with no compiler output. The prior 60-second spawn result discarded its
error and signal, so the log cannot establish whether the compiler timed out,
was killed, or failed silently. The candidate uses the same 120-second bound
as the Mac host build and reports timeout, spawn failure, exit and signal
separately. Synthetic tests cover error classification; a new Intel CI run is
needed and a longer bound does not prove the original cause or fix.

Failure-aware waits now request up to 500 nodes and refuse a matched success
when the verified view has known native truncation, a row limit, or unread text.
The batch retains its fresh frame and skips subsequent input. Focused synthetic
tests cover these cases. This may increase observation cost; real-app latency
is not measured. The flag does not prove all visual errors are accessible:
hidden browser chrome, shortened individual text, custom canvases and other
unreported omissions remain possible. Independently inspect the result.

Failure-aware waits now reject a nonempty query filter, including during whole-batch
preflight before any input, because filtering could hide the failure label while
exposing success. This is a deliberate compatibility restriction. Unfiltered
accessibility trees can still omit offscreen, truncated or inaccessible errors;
the result needs independent verification. A focused inert regression covers
direct validation and the no-input batch boundary; real-app qualification is pending.

The active goal is the complete “Reliable computer use, automatic updates and
shared Mac support” plan. This log records implementation and evidence separately.
Review branch: `codex/review-intel-mac`. All private test output stays
in `.localdata/`. No release completion is claimed here.

Open coordination gap: [issue #7](https://github.com/shayann07/antigravity-computer-use/issues/7)
tracks the shared direct Sidecar's lack of authenticated per-task ownership.
An isolated IPC probe using the actual service dispatch and `Runtime.finish`
showed that a second connection's `end` clears another connection's frames and
grants. No real desktop or two live agents were used in that probe. Individual
actions are serialized, but that does not prove whole-task isolation; coordinate
one task at a time until a host-compatible ownership design is qualified. The
skill now states that limit rather than promising safe concurrent tasks.

On 30 October, a read-only Antigravity accessibility inspection showed the
`Upscaly Code Repair Execution` conversation with a Stop execution control,
indicating that execution was still running. This does not establish whether
that task currently owns the desktop. Because issue #7 prevents reliable
ownership attribution, the live installation and desktop were left untouched;
real Antigravity qualification remains pending.

[Antigravity's documented hooks](https://antigravity.google/docs/hooks) provide
`conversationId` and tool-call details to `PreToolUse` handlers, which can deny
a terminal call. This is a possible host-side coordination signal. The docs do
not establish a trusted binding between a hook invocation and a later direct
IPC caller, and shell commands can invoke the same local controller in multiple
ways. Do not treat the ID, command text or a model-provided token as a security
credential. No hook has been registered or tested in the live App; preserving
unrelated hooks, failure behavior and two real concurrent tasks remains work.

Agents can now record structured feedback about observed usability, speed or
missing-capability concerns that did not produce a runtime error. Categories,
operation and evidence level come from fixed lists; task text, paths, screenshots
and arbitrary model prose cannot be submitted through this command. Reports are
deduplicated locally and labeled unverified. The existing scheduler submits
sanitized metadata only when the installation explicitly enables reporting and
GitHub authentication is available. Runtime errors are still recorded without
model participation. The skill instructs agents to assess and report genuine
concerns, but cannot force an arbitrary model to notice or report every issue.
Focused tests cover consent, sanitization and the unverified label; the running
installation and real automatic GitHub submission are not yet qualified.

The shared visual contract now uses a four-second breathing cycle with a
0.64–1.00 opacity range. Windows requests opacity updates for its cached edge
bitmap every 50 ms instead of 100 ms; macOS reads the same cycle and amplitude.
Both retain a static 0.94 opacity when the operating system requests reduced
motion. A headless Windows native probe read the contract in the newly compiled
helper and sampled 0.640–1.000 over one cycle. Its preview render and alpha
falloff checks passed. This does not measure on-screen frame rate, CPU/GPU cost,
comfort, or the actual Mac UI. The change is source-only: the existing installed
controller was not replaced while the Upscaly task was active. The local suite
passed 259 tests with nine explicit skips.

The shared `wait` operation accepts up to eight explicit `abort_on` labels for
known app failure states. It observes without repeating input, prioritizes an
observed failure over a success label, returns a fresh frame, and stops later
batch steps. Focused tests exercise failure precedence, frame cleanup, argument
bounds and skipped input. Labels are literal substrings, so callers must choose
specific observed text and avoid queries that hide errors. This is source/test
evidence only; a real Antigravity app workflow and its latency remain unmeasured.
Text waits now check the final returned view as well as the initial match. A
success label that vanishes does not advance the batch, and a known failure
appearing in the final view stops it. Focused regressions cover both transitions;
the returned view is still a point-in-time observation, not a guarantee that an
application cannot change afterward.
If a failure first appears in the final timeout observation, the wait now
reports that failure instead of masking it as a generic timeout; an inert
regression covers this boundary.
Intermediate text waits in batches now omit the final screenshot when followed
by an accessible-target action, avoiding a redundant capture. Final waits keep
their image default unless explicitly or query-selected otherwise. A pixel action
immediately after either wait is rejected before any batch input because its
intermediate screenshot was not available for the agent to inspect. Focused
tests cover these defaults and refusal. Real-app latency is still unmeasured.

The separate `wait_change` command waits for a change in the exact accessible
tree shown by a fresh observation. It preserves that observation's query and
node limit, consumes the old frame, returns a fresh text-only frame, and rejects
app identity, worker or control changes. A tree change can be unrelated and a
canvas may not expose changes, so it is not an outcome-verification shortcut.
Focused tests cover changes, timeout, consumed/stale frames and identity/control
transitions. Real desktop/model behavior and speed benefit remain unqualified.
It can also run as a batch step: a fresh frame feeds the next action, timeouts
skip the rest, and its budget is combined with ordinary waits. The comparison
starts from the previous action's returned frame, so an earlier change can be
missed; a detected change can be unrelated and must not be treated as success.
A direct authenticated IPC test now exercises the batch and actual shared wait
logic with an inert runtime, checking fresh-frame propagation and one dispatch
per action. It does not operate a desktop or establish host/model latency.
An additional review found that rendered trees start with a changing native
snapshot ID, which made the initial implementation report a change on every
capture. The comparison now excludes that identifier. A regression using the
actual renderer verifies unchanged snapshots time out and a changed label is
detected. Observation-scoped row and focus indexes are also excluded from the
comparison because the Mac adapter can renumber controls between captures;
tests retain actual user text and focus details. This feature was not installed
when the defect was found.

Review found that Windows `set_value` could dispatch an accessibility write and
then silently repeat it as keyboard input if the provider threw or returned
stale/unreadable data. It now reports `input_outcome_unknown` after an uncertain
dispatch and requires a fresh observation; range writes also report uncertainty
on post-dispatch failures. A headless test invokes the real compiled policy with
fake providers and checks a single dispatch across ignored, throwing and
unreadable cases. The Mac adapter also previously ignored numeric input and
reported success without read-back; it now sends the supplied number and checks
the observed value before reporting success. Mac contract checks and real
provider/app acceptance must still run for this change.

Intel CI run `40956802016` compiled the native adapter but failed a passive
Sidecar regression: it checked that the fake runtime was still active after a
25 ms idle timeout, and a loaded runner had already released it. The test now
checks that the same listener actually dispatched the subsequent observation,
without assuming the response arrives before the idle timer. The production
timeout and idle behavior are unchanged. The focused Windows checks passed;
the exact revised head still needs fresh cross-platform CI.

| Requirement | Status | Evidence / next step |
| --- | --- | --- |
| Human launcher reveals controls, passive startup hidden | Source repaired; current affected-PC/native trial pending | Human launcher uses passive `start` then explicit `controls`, recovering cached `ready` failures without re-arm. Earlier native Windows visibility evidence exists; latest generated-launcher test uses inert IPC controls, not a real bar. Issue #3 tracks device acceptance. |
| Guardian concurrency, timeout, early exit and bounded recovery | Implemented; focused and CI checks passed | Shared readiness, early exit, invisible replies, cached failures, explicit recovery, isolated-desktop handoff and lost-acknowledgement tests pass. Physical crash/input cleanup remains separate. |
| Simple model workflow | Partial; real matched Notepad trials recorded | On installed `bc457343...`, Sonnet and Flash saved matching Unicode in 203,199 ms and 181,909 ms respectively. Flash had a close verification error; earlier Flash failure remains evidence. Affected-PC and matched Upscaly trials remain pending. See `docs/PERFORMANCE.md`. |
| Shared signed update staging | Implemented; release transport pending | Ed25519 verification, architecture/OS/channel/sequence checks, bounded hashed downloads and inventory checks. Protected key and Actions secret configured; local signing verified. No release published. |
| Idle update, settings, Stop, rollback and pins | Mac isolated native checks passed; full acceptance pending | Real installer/lease paths cover upgrade, failed health, settings/Stop/pins, deferral and recovery. Mac native update/rollback uses substituted release transport/test signing keys. Windows native checks skip unsafe ancestors. Native interruption/power-loss and production updates remain pending. |
| Automatic scheduling | Implemented; native qualification pending | Both passive and foreground Sidecar entrypoints schedule bounded workers; daily check policy, explicit manual/notify modes. No OS scheduled task. |
| Local failure diagnostics and consented GitHub reports | Implemented; mocked integration passed | Allowlisting, deduplication, consent, missing auth and backoff have regressions. Authorized development issues #2/#3 track real reports; automatic reporting from a consented user installation is not yet qualified. |
| Shared Windows/Mac implementation | Partial | Intel report and repairs were submitted in PRs #4/#5; source integration at `fc2b9ac` passed both Mac CI architectures. Independent interactive Mac acceptance remains incomplete. |
| Real app and physical/hardware acceptance | Partial | Physical Esc during a held Windows mouse drag, queued-action cancellation, restart and human re-arm were observed on `bc457343...`. Affected PC, fresh PC, Mac physical input, held-key, mixed-display and production updater acceptance remain pending. |
| Publication and bootstrap installer pin | Pending | Keep release draft until applicable gates pass. Existing published beta cannot acquire updater without one supported upgrade. |

Updater status and post-switch health must now explicitly report `ok:true` in
addition to the expected identity and passive state. Failed or missing health
acknowledgements trigger rollback; a failed initial status does not authorize
shutdown. Transaction tests cover these cases with isolated adapters, not a real
published update.
Reservation now requires both `ok:true` and `prepared:true`; every update-path
shutdown requires `ok:true` and `closed:true` before installation or rollback
continues. An isolated transaction test verifies ambiguous acknowledgements do
not switch files. Actual signed-update cleanup remains unqualified.
If the replacement never starts, a failed shutdown may now proceed to rollback
only after a positive `not_running` status and acquisition of the native data
lease. Initial cleanup has already been confirmed and the switch journal blocks
new input. Active, unresponsive or ambiguous status still requires operator
inspection. Isolated tests cover these branches; real failed-start recovery on a
published bundle remains pending.
Explicit rollback and interrupted-switch recovery also acquire the native
controller lease before restoring files, and release it before passive restart.
An isolated test checks ordering and confirms a competing owner leaves the
recovery journal intact. Real Sidecar/OS race qualification is still pending.
Lease release now waits for the ownership helper to exit even after requesting
termination. If the helper does not exit within the bounded cleanup period,
release reports `service_lease_cleanup_unconfirmed` instead of claiming success.
Inert helper tests exercise delayed exit and refusal; actual OS failure remains
separate from this test evidence. The updater retains its recovery journal and
does not start rollback if the helper's exit is unconfirmed, because it cannot
assume the old fence is still held. A transaction test covers that boundary.
If closing the helper's pipe throws, release still requests termination and
requires an exit acknowledgement; an inert broken-pipe test covers that path.
Rollback and interrupted recovery now validate that every rollback manifest is
an absolute, non-duplicate `backups/<entry>/rollback.json` inside this install,
and verify the private tree before shutdown or restoration. Tests cover external,
relative and duplicate paths and failed tree verification. They do not establish
protection against an attacker already able to alter trusted backup contents.

Mac Intel CI run `40946383380` failed during the compiler lookup after roughly
ten seconds and reported missing Xcode tools. The previous code discarded the
underlying spawn error, so the log cannot prove whether tools were absent or the
probe timed out. The storage-builder probe now distinguishes timeout, spawn failure
and unavailable tools, and allows a 30-second bounded lookup. A focused synthetic
test covers those distinctions; actual Intel CI and device checks remain required.
The Mac host build now uses the same bounded SDK probe and reports probe timeouts
accurately; Swift compilation also has a finite 120-second limit. A timeout is
not proof that the toolchain is missing or that the resulting build is valid.

Stop persistence errors are no longer reported as successful durable Stop. The
runtime invalidates control and cleans up input, reports `stop_persistence_failed`
without a private path, and refuses orderly shutdown until it can persist the
latch. A stopped event from the native guardian also checks that the latch exists
and reports a failure if it does not. Focused tests cover missing storage and
recovery; actual physical Esc under a failing disk remains unqualified.
When the in-memory stopped reason is a latch or guard persistence failure,
`ready`, grant and launch now report the storage problem without opening controls
or suggesting ordinary re-arm. The explicit human controls command remains
available to the operator; no model action clears Stop.
When visibility cannot be verified after a failure, `ready` reports it as unknown
rather than claiming the controls are hidden. An explicit native `false` remains
distinguishable from a timeout or an unobserved result.
On Windows, a failed native guardian state write now also forces stopped state
and attempts cursor restoration, worker termination, held-input recovery and
overlay removal independently before emitting `guard_persistence_failed`.
The native helper compiles and a headless cleanup-order test passes; an actual
guardian storage failure and physical-input cleanup still need device testing.

The operator authorized reconciling the Upscaly project-local pin. Source
`36bef78` was built after its Windows and both Mac CI jobs passed. Global and
`D:\Work\Extras\Upscaly\image upscaler` project scopes now both identify build
`22e47b7c1236c2d4052f579e307e7e327c7584ddf333b7c2a5ae0ff9336c44b8`; their
108 payload files and skill templates verified, native helper hashes match the
bundle, and settings, Stop state and unrelated pins were preserved. The project
scope remains explicitly pinned. A direct project-launcher smoke test observed
stable Upscaly 1.0.9, physically opened Settings (13 animated frames), verified
the displayed panel, closed the app and ended control. This is not an Antigravity
model-driven task, a signed automatic update, or completion of Mac qualification.
One prior attempt saw a Sidecar restart during staging and the installer refused
the project update. Its failure remains in `.localdata/`; the successful retry
held the native ownership lease through the project install. Rollback journals
were retained. A fresh Antigravity conversation is needed to load the updated
project skill; refresh the Sidecar only if the host has not loaded its definition.

An observed Upscaly project-local beta.2 skill was pinned to a different build
from the running global beta.3 service. Status now explicitly reports a client
build mismatch, and mismatched requests receive `resolve_version_mismatch`
without dispatching input. The skill instructs agents to stop and preserve pins;
this does not change or unpin any deployment. A real project-scoped task after
an operator reconciles the versions is still required.

The preceding Windows installation was locally upgraded from `a4e7234` to build
`50426a656d2374fca25706235407cafb80cb9c0719a19c3cf65760c49cc32474`. Its 108
files and global skill verified, settings and project pins were preserved, and
it started idle without desktop input. Stop was not latched at upgrade time.
Existing diagnostics were readable without submitting them. This is not
production signed-update or current-build Antigravity task qualification.

The preceding Windows installation was locally upgraded from source `f6bfa1f` to
build `6b4d9d967478f383c5cb620bee7f6d2a898510040b10926e08b534fd7a059c7b`.
Its 108 files and global skill match, the service starts passively idle, and
configuration and project pins were preserved. Stop was not latched during the
upgrade. Automatic signed-update acceptance and an actual model task on this
build remain pending. The upgrade receipt is kept in `.localdata/`.

Signed updater metadata now requires a three-component numeric minimum OS and
a valid detected OS version before comparison. Malformed and out-of-range
components are refused rather than coerced. Focused signature and transaction
tests pass; this does not qualify an actual published update.
Scheduled updates also clear stale availability when the signing key is absent
or an apply fails. The prior staged files remain available for inspection, but
the scheduler waits for a new check instead of repeatedly attempting an invalid
apply. Transaction tests cover both cases without a live installation.
Staging now writes each received chunk fully even if the operating system
returns a short write; a zero-progress writer fails and removes its partial file.
The focused test simulates short and stalled writes, without qualifying real
disk exhaustion or a published release.

The owner observed stationary cursor clicks in the direct Upscaly test. Named
clicks had defaulted to accessibility invocation; the shared runtime now requests
physical pointer movement by default, including batch steps. Explicit
`physical:false` retains semantic clicks when needed, while pixel targets always
remain physical. Native identity, target, occlusion, Stop and cancellation checks
remain in place. Runtime tests cover default and explicit selector behavior; the
new default was installed and tested against Upscaly on Windows: a named click
without `physical` moved the real pointer over 15 frames and opened Settings;
the app was closed and control ended. The installed skill and 108 files matched
build `a19b62d415801a03cd37b7c80bf6343148cdd404c8a84f133e0156f2e21abad9`.
Broader Windows and real Mac app qualification are still pending.

The default physical path exposed an earlier native behavior: a disabled indexed
control could be physically clicked and reported as delivered. Both native hosts
now refuse a known disabled accessibility target before sending a click. A pixel
target has no comparable semantic enabled state and still requires visual
verification. The Windows host compiled locally, and the installed new helper
refused the actual disabled Upscaly 2× button with `element_disabled`; it then
closed the app and ended control. Real Mac checks remain pending.
An attempted existing native fixture run stopped with `confirmation_required`;
it is not a pass and no approval was manufactured to make it proceed. The
failure is retained as local test evidence.
Follow-up identified the cause: the test reused a native snapshot after Driver
restarted its worker to clean up the rejected input. A fresh snapshot restored
the intended observed target. A separate attempt compared absolute cursor
positions and failed while physical input could occur, so that unstable assertion
was removed. The corrected fixture passed 13 checks, including disabled refusal;
its explicit fixture grant is a test double, not human approval or device-wide
qualification. The actual Upscaly refusal above remains the real-app evidence.

The supported Windows local upgrade to source `0a919f8` produced and installed
build `4d112e9e4137e1999750430cc3170995bc8cc421a76f998c517c3cd459a66910`.
All 108 payload files and the global skill verified; cleanup was confirmed and
settings and project pins were preserved. Stop was not latched at upgrade time.
The new service started idle and host-managed without desktop input. This is not
an automatic signed-update acceptance test or a real Antigravity task on the new
build. Private receipt and rollback location remain under the installation and
the upgrade evidence is under `.localdata/reliability-current/`.

Windows CI on documentation head `2ab0861` failed the real foreground-service
startup test after its 10-second readiness deadline; stderr was empty. The same
test passed in the local full suite and the preceding Windows CI, but those passes
do not establish why this run failed. The original failure remains in Actions run
`40934910247`; its failed job was rerun for comparison. Treat a successful retry
as a separate observation, not proof that startup cannot hang.
Another local full run timed out the human-launcher fixture and its immediate
cleanup masked the timeout with `EPERM`. The harness now terminates its own
Windows child process tree on timeout and waits for process closure before
cleanup, retaining the original timeout message. The focused test and a full
retry passed; this does not establish the underlying timeout cause.
A later full suite hit the same 10-second fixture deadline again. That harness
runs two separate launcher commands and native storage checks, whose own bounded
operations can exceed the test's shorter deadline. Its outer limit is now 30
seconds and it explicitly logs runs over 10 seconds. This changes the fixture
deadline only; it is not evidence that actual startup latency is acceptable.
Another Windows run (`40937717822`) timed out in the ownership helper and then
hit `EPERM` while removing its fixture directory. Source review identified a
possible cleanup race: startup rejected immediately after requesting helper
termination, before its directory handle was known to be released. The helper
startup path now waits for termination, and reports unconfirmed cleanup if it
cannot establish that the child exited. Focused tests cover both outcomes and
real kernel ownership; they do not establish the cause of the original CI stall.

The incident counter no longer clamps at one million when reading records: that
clamp could cause a new occurrence to appear already acknowledged. A regression
checks the transition past the former limit. Exhaustion of the safe integer range
is reported as diagnostic storage failure instead of silently losing occurrences.
This is source-level evidence, not qualification of automatic GitHub reporting.

Rollback previously accepted any successful start command without checking the
restored service's identity, and interrupted recovery checked state without its
build ID. Explicit rollback, interrupted recovery and automatic failure recovery
now require the expected restored build in an idle or stopped state. They retain
the recovery journal on a false or mismatched health result. Isolated transaction
tests exercise these failures; native interrupted-update acceptance is still open.

### Open diagnostics concurrency defect

The controller and
launcher can both call the synchronous recorder. A two-process barrier test had
both writers read the journal and publish through `incidents.json.tmp`; both
reported success but the final journal held only one of the two distinct events.
The reproduction and result are retained under `.localdata/tests/incident-race-*`.
The separate reporter acknowledgement repair below did not serialize incident
writers. The current candidate serializes production controller and launcher
writers using a separate private native lease and atomically publishes the bounded
journal. A two-process test covers distinct incidents, repeated occurrences and
recovery after terminating a writer. A lost-ownership check immediately before
publication is tested separately. Earlier pinned releases can still use the old
writer, and Mac device behavior needs further qualification. A further Windows
barrier test killed the lease helper just after the writer's ownership check,
allowed a second writer to commit, then resumed the first writer: both reported
success but the first overwrote the second. That JavaScript-side guard did not
close the helper-death race. The candidate now sends the bounded journal to the
native lease holder, which alone flushes and atomically publishes it while holding
the lock. A Windows test kills that helper immediately after the caller's liveness
check; the stale writer fails and the next holder's journal remains intact. The
original reproduction remains under `.localdata/reliability-current/`. Older
pinned runtimes do not use this protocol, and real Mac qualification remains open.
Malformed or oversized helper replies now fail the pending publication promptly
and retire that helper; the result remains outcome-unknown rather than replaying
a potentially committed incident. A focused protocol regression covers this path.
Native publication now uses one reserved temporary file. A later lease holder
checks that file's ownership and privacy before removing an interrupted write;
the Windows native regression exercises recovery and refuses a symlinked temporary
file without changing its target. Mac CI and hardware validation are still
required for the corresponding implementation.
The first asynchronous version delayed error responses while acquiring the lease,
causing a client timeout in the full suite. Recording is now queued off the reply
path; replies identify it as pending, status exposes pending/failure, and orderly
shutdown waits for queued records. Native storage checks run asynchronously.
The failed suite is retained under `.localdata/reliability-current/`, followed by
a full local pass. A subsequent full run also hit the human-launcher fixture's
10-second timeout; the focused test and a full retry passed, but the reason for
the timeout remains unproven. Abrupt process death can still interrupt an
in-flight record.
Another full run under load hit the incident writer's five-second contention
deadline and returned `service_already_running`. The background wait is now
bounded at 15 seconds. A focused retry passed, but this longer limit does not
prove loss-free reporting during sustained overload. The failed run is retained
as `visibility-unknown-suite.log` under `.localdata/reliability-current/`.
Malformed or oversized journal data and malformed acknowledgement files now
refuse recording and reporting with `diagnostic_journal_invalid`; existing bytes
are retained for inspection. This prevents a damaged journal from being treated
as an empty one and overwritten. Focused tests cover each case.

The old recorder and reporting worker both rewrote `incidents.json` through the
same `.tmp` pathname. A deterministic two-process test reproduced `ENOENT` when
a new incident arrived during publication. The candidate now stores bounded
report acknowledgements separately, and the regression verifies that a new
incident and a newer occurrence of the same incident remain pending. A separate
process-termination test confirms an interrupted acknowledgement publication
leaves the incident pending. A deterministic reentrant simulation reproduced two
issue-create calls when reporters both passed the backoff check before either
published it. No real GitHub issue was created. The candidate now acquires a
separate native reporting lease before reading reports and checking backoff; a
real Windows helper test confirms exclusion, detection of helper termination and
subsequent reacquisition. A mocked overlap test confirms the second reporter
defers. Consent is rechecked before submission. Mac native lease and power-loss
behavior remain to qualify. An uncertain remote create outcome still needs
human review if GitHub never reveals the issue: a durable send intent prevents
automatic replay while search may lag, and reconciliation clears it when the
issue appears. A user-facing resolution flow for a confirmed absent issue is
still needed; do not silently discard the intent.

Earlier runtime evidence: Windows 212 passed, zero failed, seven explicit skips;
[Windows CI](https://github.com/shayann07/antigravity-computer-use/actions/runs/40883552932)
and [Mac CI](https://github.com/shayann07/antigravity-computer-use/actions/runs/40883552937)
at `f97b748`. All 151 provenance entries matched then. The later installed/running
build `bc457343...` verified 107 files and the skill, with an idle service and
zero app grants. It remains older than the review branch. These records do not
clear the outstanding human/device gates or qualify a new public release.

## Release signing prerequisite

Updater metadata must be signed using a maintainer-held Ed25519 private key.
Commit only the matching `release-public-key.pem`; keep the private key outside
source, bundles, logs and CI artifacts. `scripts/sign-update.mjs` verifies the
matching public key and prepares per-platform signed metadata and payload assets
for a published release. It does not upload or publish anything.

Without a pinned public key or matching signed release asset, checks return an
explicit prerequisite status and never execute an unsigned update. Key custody,
rotation, release expiry, rollback floor and the qualified release build must be
reviewed before distribution. Kernel minimum versions are recorded per platform
(macOS uses Darwin kernel version). Ad-hoc Mac builds may need renewed human OS
permission approval; never bypass Gatekeeper.

Installer options: `--updates automatic|notify|manual`, `--update-channel
stable|beta`, `--report-incidents` or `--no-report-incidents`. Existing choices
are preserved unless explicitly changed. Reporting is off until the operator
consents. No maintainer GitHub credential is shipped.

Use `--pin-version` / `--unpin-version` to control automatic updates for a
deployment scope. Separately installed projects keep their own root/policy.
`update apply` and `update rollback` queue a worker using immutable release Node
and let the short launcher exit before replacing it on Windows. Inspect
`update status` for the worker result; queuing is not an installation success.

## Historical source evidence

The initial complete local regression run passed 168 tests, failed zero and
explicitly skipped seven (five native installation ACL qualifications and two
Mac-only checks). The newer focused updater/recovery run passed 14 tests. Native
Windows compilation passed. These results do not qualify the affected PC, a
fresh production installation, real Flash/Sonnet tasks or Mac desktop input.

The later full regression run passed **174 tests, zero failures, seven skips**.
`tests/guardian-visibility.mjs` passed on the actual Windows helper, with no target
app clicks or typing. It verified idle/stopped hidden startup, explicit controls,
End cleanup, capture non-resurrection, Stop auto-dismissal and latch preservation
across restart. Physical Esc/re-arm and affected-PC reproduction were not tested.
No helper process remained after cleanup. Private result:
`.localdata/tests/guardian-visibility/run-RztTZO/result.json`.

At `e1e861e`, Windows CI passed 176 tests with zero failures and seven skips,
native compilation, provenance and development-bundle packaging. Its native
updater integration explicitly **skipped** because of
`insecure_storage_ancestor`; parent ACLs were retained. This is not a Windows
native updater qualification pass. The Mac workflow now runs the signed update
and rollback with real native storage/services and isolated test signing data;
inspect the latest job logs for actual results. Desktop input remains unrun.

At that earlier checkpoint, release-key custody/public-key setup was pending;
it has since been configured and verified as recorded below. Remaining release
work includes signed published assets and the bootstrap pin; real
hard-crash/power-loss qualification for multi-scope switching; native updater
acceptance; broader reporting/concurrency tests and actual model trials. Do not replace the
published beta or advertise updater readiness based on current fixtures alone.

Interrupted updates retain `update-switching.json` and rollback journal paths.
The service blocks new control while this marker exists. A scheduled worker
replays the retained rollback journals and checks passive startup before clearing
it. Manual mode still permits interrupted-transaction recovery; it disables new
update checks/installations. Download/check locks do not block an active task.
Every install journal is persisted before the first deployment switch.

## Acceptance and delivery gates

1. Run focused regressions and source suite; retain actual failure output.
2. Run native compilation and provenance checks on Windows and both Mac runners.
3. Exercise signed staging, upgrade, health failure, rollback, task deferral,
   pins, preserved settings/Stop and a second session in isolated installations.
4. Qualify actual Antigravity tasks, affected PC and physical/hardware boundaries.
5. Prepare signed release assets, bootstrap upgrade and exact installed/published
   identity evidence. Update installer pins only for the qualified release.

Agent parity is not guaranteed by prose. Runtime checks enforce limits and log
failures; real model trials establish operational evidence. The overall goal
remains active until all required acceptance and delivery work is verified.

## Maintainer key tools

`scripts/setup-release-signing.ps1` creates a public Ed25519 trust root and
stores the private key only as a current-user DPAPI envelope under ignored
`.localdata/release-signing/`. `-ConfigureGitHub` explicitly adds the private key
to the repository Actions secret `AGCU_RELEASE_SIGNING_KEY`. It refuses to
overwrite an existing key. Rotation needs a separate compatibility change.
Do not upload the protected key as an artifact; arrange maintainer custody and
backup before publishing the trust root. The envelope is tied to that user.

`scripts/sign-update-windows.ps1` decrypts into process memory and pipes the key
to `sign-update.mjs`; no plaintext private-key file is needed. Generic signing
also accepts `-` for standard input. These tools are not invoked by desktop tasks
or normal installations.

The release trust root has now been generated. Its public-key file SHA-256 is
`83db2823088968a42ad19ca2e65a7f89187455e86d139d757a4a6b10ceee9443`.
The private key is stored as a user-bound DPAPI envelope and the repository
Actions secret `AGCU_RELEASE_SIGNING_KEY`. No plaintext private key was written
or included in source. Signed release preparation and production transport still
need qualification; this setup did not publish or update any installation.
The source candidate is `0.3.0-beta.3`; the public bootstrap remains beta.2.

## Installed beta.3 and first real model trial

Global beta.3 candidate build
`83487f3a409d36dd615e2da2542a60ae0858cc0ddacb40ee2aa13adad514873d`
was installed through the supported installer and verified against all 102
sealed files and the global skill. Running status confirmed that build, idle,
host-managed policy, manual takeover and no cursor ownership before the trial.
The previous installation and configuration backups are retained. Project-local
deployment pins were not repointed. This is a development installation, not the
published release.

The owner opened a dedicated No Project Antigravity chat for a Gemini 3.8 Flash
High Notepad Unicode/save task. The live trial reached `ready`, discovery,
launch and screenshot. It spent about 108 seconds between a screenshot and a
click, exceeding the 90-second frame limit; the controller refused stale input.
The agent subsequently re-observed, handled a minimized-window refusal, focused
the target, clicked and pasted. At this checkpoint the run is still active and
the output has not been independently qualified. Unnecessary directory/timing
file reads and large model decision gaps are retained as failures of efficiency.

Source follow-up now supplies deterministic `next_action` fields for expired
frames, minimized targets and unknown/completed delivery, with explicit
`replay_allowed:false`. Service integration tests cover stale-action refusal and
post-input verification failure without replay. This follow-up is not patched
into the active run; matched candidate trials remain required.

The Flash trial finished at 09:50:00 UTC with control idle. It made 21 controller
calls consuming about 20,999 ms, over 605,626 ms from submission to End. It saved
64 UTF-8 bytes and closed the created window. Independent comparison failed:
U+200D was missing between the emoji modifier and laptop. The original user
message's accessible text retained that joiner; exact model argument vs runtime
loss has not yet been isolated. The model's successful summary is not an exact
Unicode pass. Errors logged automatically: stale observation, minimized window
and obscured target. The agent recovered from these without automatic replay.

Private evidence is under
`.localdata/real-model-qualification-20261029/flash-run-summary.json` and its
receipts/output verification files. Output SHA-256:
`acf33b9ae945e678b208714a28114ea0cfea62e073dd38903bb59a8b896c4e3a`.
The dedicated chat is “Creating Notepad Qualification File”. A Sonnet comparison
was deferred after the desktop tool detected human input. No unrelated message
was edited or sent. The goal remains active; speed/reliability are not solved.

Local beta.3 release preparation passed signature verification and independent
verification of 102 payload files, using the configured protected signing key.
The signed metadata identifies build
`3ee48577631beee75b8e60619900f59d18f423d6f2ebc0094ef7cc5968b1dd2a`.
It was retained only under `.localdata`, not published or installed. Subsequent
source changes require fresh packaging; this is a signing-path witness only.

The manual `prepare-signed-release.yml` workflow prepares Windows x64, Mac ARM
and Mac Intel signed assets with the repository secret. It has read-only GitHub
permissions and does not publish, tag, merge or alter installer pins. The
workflow must exist on the default branch before GitHub permits dispatch; its
first actual run and production release-transport qualification remain pending.

## Guardian desktop preflight follow-up

Source review found that the guardian's `Visible` property did not establish
that its desktop was the user's current input desktop. The Windows guardian now
performs the existing read-only `DesktopContext` check before creating its UI
and again before showing controls. Hidden/isolated contexts return
`desktop_context_unavailable`; no desktop is created or switched. Active native
fences also refuse dispatch after an input-desktop change, and the guardian
latches Stop on that transition.

Local source regression passed 182 tests with zero failures and seven skips;
Windows native compilation passed. The new CI negative qualification launches no
guardian when the current desktop is interactive, and otherwise asserts native
refusal before creating controls. Positive interactive qualification of the new
helper remains pending: the owner pressed physical Esc during the previous
desktop trial, so further desktop work was not resumed by a goal continuation.

## Updater concurrency and staging follow-up

The updater now acquires installation ownership before reading deployment state
or claiming its daily schedule. Scheduled check/recovery/apply share that lease;
overlapping workers cannot overwrite timing or transaction state. Failed payload
transfers remove only their newly created stage, and a retry creates fresh private
storage. Metadata is read with a streaming size bound. Regression tests cover
concurrent scheduled workers, interrupted-transfer cleanup/retry, numeric version
ordering, insufficient space and malformed/oversized metadata.

Project pin tests verify the actual pinned launcher and installed skill remain
byte-identical while the global deployment upgrades. When all scopes are pinned,
the worker does not reserve, shut down or update the controller. Maintenance
reservation happens only after update validation. The affected-PC, Sonnet and
physical/hardware gates remain pending; desktop control has remained stopped
since the owner's physical Esc.

## Process termination and update notices

Actual child-process termination tests now interrupt the real installer after
the launcher switch and after the final installation-pointer switch. Scheduled
journal recovery restores the prior launcher, release pointer, unrelated config
and Stop. These tests inject only inert native storage/service boundaries and
do not constitute a physical power-loss or native service interruption test.

`ready` now supplies one concise `update_notice` for an applied update, an
available verified update, a recovered failure or an actionable error. Raw stored
messages and payload metadata never enter the notice, and unchanged notices are
deduplicated even when daily retry timestamps change. The skill relays the short
message once without derailing the user's task. No desktop UI is opened by the
notice reader. Native and real-agent notice behavior remain to be exercised.

Multi-scope update and rollback tests now retain the global Sidecar's permission
policy as the passive startup owner. Previously the last-installed project could
start the listener under its own policy. Project pins and launchers remain
independent; shared-desktop control still requires compatible active build/policy.
The post-change focused updater suite passed 20 tests. A preceding full source
run passed 191 tests with zero failures and seven explicit skips. The complete
suite and native architecture matrix must be checked again at the pushed head.

`update status` now emits a compact allowlisted result instead of the private
signed-manifest envelope and staging/rollback paths. It includes settings,
availability/version, whether staging/rollback exists, sanitized worker result,
an error code and one next action. Unknown settings/worker fields are dropped.
Notify-only installations receive `update_available`, not an automatic-apply
instruction. The complete signed material stays private for runtime verification.

## Signing workflow registration

A direct dispatch attempt returned HTTP 404 because GitHub requires the new
workflow to exist on the default branch. A temporary, explicitly named development
branch push trigger now qualifies the same preparation jobs without merging the
runtime. It runs only when signing scripts, the public key or the workflow change;
it is not a pull-request trigger. Repository permissions remain read-only, and
only unpublished artifact preparation is authorized by this workflow. Automatic
qualification uses its unique run ID as the sequence. Actual release dispatches
must use a sequence greater than any previously published metadata.

The development signing run at `11805ff` passed on Windows x64, Mac ARM64 and
Mac Intel: [workflow evidence](https://github.com/shayann07/antigravity-computer-use/actions/runs/40873372390).
Every prepared signature and payload was independently verified against the
pinned public key; Windows had 105 payloads, each Mac had 108. Signed artifacts
were uploaded with seven-day retention. None was published as a release or fed
to the installed updater. The sequence was `40873372390`.

The follow-up workflow now runs native installation/update/rollback checks on
the exact sealed bundle it signs before uploading assets. Windows ACL refusal
must still be recorded as unqualified. Interactive app/permission/physical tests
remain separate and required; this workflow cannot establish vendor parity.

## Exact signed native qualification result

At `455b126`, the [signed-bundle preparation run](https://github.com/shayann07/antigravity-computer-use/actions/runs/40873846760)
passed all three jobs. Independent public-key verification covered each signature
and every prepared payload. The exact signed Mac ARM64 and Intel bundles passed
native installation, passive service startup, update, rollback and Stop retention
in isolated homes. Windows native updater qualification explicitly skipped with
`insecure_storage_ancestor`; no parent ACL was changed. This is not a Windows
native update pass. All assets remain unpublished CI artifacts.

## Unicode transport isolation

The new no-input Windows transport regression sends the exact synthetic Urdu,
U+200C/U+200D and emoji string through real Windows PowerShell, the production
CLI/parser and authenticated IPC, `Runtime.action`, `Driver.call`, and a native
C# JSON serializer. Both literal `--text` and UTF-8 `--text-file` round trips
preserved every code point. The native endpoint is an inert JSON echo process;
approval/window/observation boundaries are injected fixtures and no clipboard,
app windows or desktop input APIs are used.

This narrows issue #2: the transport/runtime path does not strip the joiner in
the tested cases. It does not establish whether Flash omitted U+200D in its
original paste argument or whether the real clipboard/provider path changed it.
That remaining distinction needs a controlled native app test after the owner
resumes desktop qualification. The issue stays open and the earlier Flash run
remains a failed exact-text qualification.

The first full source run after adding that transport test had one unrelated
foreground-service readiness assertion failure (195 passed, one failed, seven
skipped). Its returned error was not included by the old assertion. The assertion
now retains the actual readiness reply for diagnosis. The focused foreground
test passed, and the next full run passed 196 tests, zero failures and seven
skips. The original failure output is retained privately; a successful retry is
not proof that an intermittent startup defect has been eliminated.

## Flushed recovery metadata

Update state, switching markers, installer journals and deployment pointers now
publish a fully written and `fsync`-flushed temporary file through a same-directory
atomic rename or exclusive link. A failed file flush or replacement retains the
previous metadata and cleans its unpublished temporary file. Before launcher
switching, the installer flushes staged payload files and saved rollback copies.
Host configuration and skill entrypoint text also use atomic publication.

The required file flush is never silently skipped. Directory flushing is
attempted; platforms where Node cannot open/flush directory handles report that
limit rather than treating it as a power-loss qualification pass. Fault-injection
tests verify old-state retention and write ordering. Real power-loss and native
interrupted-service acceptance remain pending, and no user desktop control was
resumed for these tests.

## Legacy project update migration

The installed registry audit found a pre-updater project deployment on a release
different from global, without an `update_pin` field. The updater now treats such
divergent legacy project scopes as pinned. Explicit boolean choices take
precedence, and new scopes retain the documented automatic-update default.
Manually upgrading a legacy scope retains its inferred pin unless the operator
uses `--unpin-version`. Tests verify global upgrade leaves the old project
launcher and release unchanged, and explicit unpin remains possible.

## Current acceptance audit

The full objective remains incomplete. At the audited checkpoint:

1. Recovery implementation and local visibility evidence exist; the affected
   second PC and positive tests of the newest native helper remain pending.
2. Flash produced a real file and ended control, but exact Unicode and speed
   failed qualification. Sonnet was not submitted after physical Esc. Those
   failures cannot be replaced by transport fixtures.
3. Signed preparation/verification passed all architectures. Native Mac update
   and rollback passed for exact signed bundles. Windows native updater
   acceptance is still skipped under unsafe project ancestors.
4. Installer/update preferences, migration, task deferral, pins, journal recovery
   and process-termination checks have source evidence. Real native interruption,
   power loss and production release transport remain pending.
5. Runtime logging and consented submission have fixture coverage and issue #2
   records the actual model failure. Automatic reporting on another user's
   authenticated installation is not yet qualified.
6. The Intel Mac prompt was supplied. No on-device report or repair PR was present
   in the GitHub audit; interactive Mac permission/app/physical checks are unrun.
7. Source/native CI is green at `16ef287`; newer source changes need their own
   checks. Skips remain explicitly unqualified.
8. Public release and one-line bootstrap remain beta.2. The installed global
   beta.3 build is `83487f3a...`, behind current source; its 102 payload files and
   global skill verified. No release/pin update is authorized by a green fixture
   alone. Physical desktop control remains stopped until the owner resumes it.

## Native risk-classification parity

Review found that Windows accepted an unlabeled click or drag as routine while
Mac required sensitive-action approval. The shared contract now explicitly lists
these ambiguous target operations, and both native classifiers require approval
when their risk label is empty or whitespace. Mac now also removes Unicode
format characters for risk matching, matching Windows: a hidden joiner cannot
split a sensitive label such as `delete` to evade classification. This does not
remove joiners, direction marks or other characters from observations or input.

The Windows regression invokes the actual compiled native classifier by
reflection without entering the host, inspecting applications, creating windows,
registering hooks or sending input. It failed on the prior implementation and
passed after the repair. The Mac native contract checks include the corresponding
hidden-label and ambiguous-target cases; their compilation/execution must be
verified on the exact CI head. These checks establish classifier behavior, not
real approval-dialog handling or physical Stop acceptance.

The local Windows suite after this repair passed 202 tests, failed zero and
skipped seven (five Windows ACL qualification checks and two Mac-only tests).
Native compilation succeeded. The historical before-fix failure and after-fix
results are retained under ignored `.localdata/mac-port/`. No live installation
was updated and desktop control was not resumed for this check.

## Invisible-control recovery and explicit human retry

`ready` previously returned no error when the guardian replied with
`controls_visible:false` without an error field. That reply produced no incident
and did not bound repeated attempts. The shared runtime now records
`guardian_controls_not_visible`, retains the failure episode, and returns one
diagnostic action. Isolated-desktop errors retain their explicit human-launcher
handoff even on a cached failure. Neither path claims visible controls or clears
Stop.

An explicit human launcher now performs passive `start` followed by `controls`.
It can retry showing controls after an earlier cached `ready` failure, while
ordinary agent `ready` calls remain bounded. Failed startup does not advance to
the controls command. Both launchers remain fixed and argument-free; they never
re-arm. The shared skill explains the visible-desktop handoff and stops repeated
startup advice if that attempt still fails.

New regressions failed before the runtime fix and passed afterward. An additional
integration test executes the generated human launcher against the real IPC
service with an inert controls provider, verifies one show request and confirms
Stop remains on disk. It does not create an actual bar or establish recovery on
the affected second PC; native visibility, physical re-arm and real host/model
qualification remain required.

## Lost acknowledgements preserve uncertainty

The direct client previously reduced lost, invalid or oversized replies to
ordinary errors, dropping the structured unknown-delivery state. A timeout also
said the session was cancelled without confirming native cleanup. Connected
transport failures now retain `delivery_unknown`, require observation before
continuing and return `inspect_effect_without_replay`. Closing the connection
requests cancellation; it is not reported as proof that input was never sent or
that cleanup completed. Invalid reply contents are not echoed in the error.

Requests now have an absolute deadline, rather than a socket inactivity timeout
that partial bytes could continually extend. Seven real-client/inert-peer cases
cover lost, malformed, non-object, missing-status, oversized, timed-out and
never-completing partial acknowledgements. The existing real-service cancellation
test now exercises an inert action, verifies one dispatch and one Stop request,
and checks the unknown-delivery advice. No test sends desktop input or establishes
the physical watchdog/held-input-cleanup acceptance gate.

The first Intel CI run timed out the 4 MiB oversized-response fixture at its
artificial 250 ms limit before the size condition arrived. The runtime retained
unknown delivery correctly. The fixture now separates that test's deadline from
the dedicated short-deadline cases; the failure is retained in run `40883083236`.

## Real Windows upgrade exposed updater-layout refusal

After the owner resumed Windows testing, the supported installer refused the
existing dedicated installation with `storage_not_dedicated`: native
`OwnInstall` omitted this project's own `update-settings.json`, `update-state.json`
and other updater entries. No configuration switch occurred. Shutdown cleanup
had succeeded, and the prior build was restarted passively and returned idle.

The Windows guard now recognizes exact updater filenames, its staging directory
and the narrow UUID temporary-metadata pattern used by atomic publication.
Unknown/lookalike files are still refused. Ancestor, ownership, ACL and reparse
checks are unchanged; no parent permissions were changed. A regression calls the
real compiled layout classifier without entering its ACL-changing entrypoint. It
failed on `update-settings.json` before the fix, then passed recognition,
unrelated-data refusal and unchanged-ACL checks. The real supported upgrade must
be retried with a fresh complete candidate; this classifier check does not itself
qualify installation or automatic signed updating.

## Incident reporting scheduler

An empty startup submission check previously consumed the retry window and the
daily scheduler timestamp, so a failure recorded immediately afterwards could
remain pending until the next day. Empty journals no longer consume a network
retry window or scheduler attempt; while the service is running, the next hourly
tick can report a new incident when reporting consent and authentication exist.
Actual submission attempts remain throttled to at most hourly. Concurrent
reporters still use the exclusive lease and unknown submission outcomes are not
replayed. Automated coverage uses isolated fixtures; real installed reporting
and GitHub submission are not yet qualified.

## Guardian cleanup confirmation

Shutdown previously returned after requesting termination of an unresponsive
guardian, even if its process had not exited. The controller now waits for the
process close event, reports `guardian_cleanup_unconfirmed` if it cannot confirm
exit, and refuses a replacement while the old process remains unresolved.
Concurrent close requests share the same outcome. Isolated process fixtures cover
late exit, missing exit, and startup timeout; real native failure injection is
still pending. This does not resolve shared task ownership issue #7.

## Input fence across sessions sharing an installation

The inherited file lease could be removed after 30 seconds even while its owner
was alive, or while another writer's metadata was incomplete. New runtimes now
hold a native kernel fence around file-lease claim, action and release. Live or
unreadable metadata is never stolen on age alone. Fence loss requests Stop;
uncertain release after dispatch reports `input_outcome_unknown` and prohibits
replay. Launch also uses the fence and rechecks cancellation after waiting.
Fence waits use monotonic time so a wall-clock adjustment cannot extend a wait
indefinitely. Invalid, partially written or dead-owner lease metadata is left
untouched during ordinary acquisition. On Windows, verified recovered-task End
can clear matching dead-owner metadata under the native fence after the prior
guard, processes and input ledger pass the recovery checks.
Inert tests exercise independent processes, a lost fence, partial metadata and
slow live holders. A local six-sample Windows microbenchmark measured a 191 ms
median for acquire plus release (176–209 ms); this is not an Antigravity task
benchmark and is a deliberate per-action cost pending real performance work.
After moving the same private-storage preparation into the mutex-holding native
helper, a second six-sample local run measured 98.9 ms median (88.8–102.4 ms).
Both are small uncontrolled microbenchmarks on one Windows machine, not an
end-to-end speed claim. Updated helpers explicitly acknowledge completed storage
preparation; older helpers retain the existing separate verification fallback.
Injected test verification is never skipped, and unrelated nonempty storage
is refused. A real native test verifies the prepared private data tree; a
separate injected refusal test confirms the acquired lease is released rather
than accepting a claimed acknowledgement. Mac CI and interactive task timing
remain pending.
An additional real process-death fixture confirms that the next session refuses
the dead owner's metadata, and can proceed only after its internal verified
cleanup path clears the matching record under the native fence. The fixture's
action sends no desktop input.
Apple Silicon CI run `40978321714` failed the same-process fence contention
test with `input_lease_unavailable`; its log did not preserve the underlying
native refusal. The runtime now retains that cause internally for diagnostics
without putting raw paths or messages into incident reports. The separate-process
contention and crash fixtures passed in that run. The cause and corrected
cross-platform result remain to be established; earlier green runs do not erase
this failure.
An authenticated direct IPC integration test also routes an inert operation
through the real Runtime, task record and native fence. A competing native
lease is refused while dispatch is in progress, and End closes the task. The
driver and guardian in that test are inert; this is not a desktop action or a
concurrent Antigravity-task qualification.
The fence only coordinates updated runtimes using the same data directory; it
does not isolate conversations in one Sidecar (issue #7), coordinate separate
installations, or establish safety against older runtimes that ignore the
native fence. Real multi-agent and Mac interaction tests remain pending.
The helper owns the kernel fence separately from the native input worker. If the
helper dies mid-action, the metadata lease still blocks updated participants
while its controller PID lives. If that PID dies, ordinary acquisition now
refuses rather than assuming its native worker exited; matching stale metadata
is removed only after verified recovered-task cleanup. Legacy runtimes that do
not honor the native fence or these stale-owner rules remain outside this
guarantee. Native worker-bound fencing and a real helper-death/input race test
remain required before calling cross-process safety complete.

## Concurrent native build cache

Windows CI run `40964379469` failed because a build's cleanup could delete a
different compiler's temporary executable before publication. Cleanup also
could remove a stamped executable another session was about to launch. The
compiler now leaves other builds and temporary files alone; a real Windows
compiler regression verifies both remain. This trades automatic cache pruning
for correctness until a coordinated, lifetime-aware cleanup exists. The CI
failure is retained as evidence; a passing local regression is not a substitute
for the new commit's CI results.

The Mac source builder previously placed its executable into the shared app
bundle before signing, so concurrent callers could observe or overwrite an
incomplete bundle. It now builds and signs in a private per-build staging
directory, verifies the signature, and publishes the complete app directory in
one rename. A competing publisher verifies and retains the winner; an invalid
existing bundle is refused. The suite includes a real concurrent compiler and
signature check on each Mac CI runner. That CI check is not a substitute for
real interactive Mac qualification or Apple notarization.

## Updater fence for an open idle task

An idle runtime with no approved app is not proof that a task has ended: an
agent may have requested `ready` and still be selecting a target. `ready`, app
grant and launch now mark the task open. The update reservation requires an
explicit closed task, and a running older service without this field is deferred
until an operator uses the supported upgrade path. Idle visual cleanup preserves
the task marker; normal End clears it only after input cleanup succeeds. The
marker is flushed in private storage and survives controller restart. Invalid
or unwritable state fails closed; directory durability on platforms that cannot
flush directory handles is not power-loss qualification. This marker is not
host-attested task identity: a different caller ending the shared task remains
subject to issue #7. Fixture and IPC coverage does not qualify real Antigravity
orchestration.
After restart with an open marker, status now identifies a recovered task and
`ready` directs the agent to inspect its prior result without replay. Observing
existing apps is permitted under the normal permission flow and fresh grants;
input, clipboard actions and new launches are refused. A replacement process
uses a different guard-file input ledger; cleanup of that new ledger cannot
prove the previous ledger was released. End therefore fails closed with
`recovered_cleanup_unverified` and keeps the task marker until a verified
previous-ledger recovery can be verified. For new Windows records, End now
allows a clean recovery only if the original controller, every recorded native
process and the recorded cursor watchdog are all absent, the old guard is idle
or stopped, private storage verifies, and the prior input ledger is exactly
empty. This path performs no injected input and never clears Stop. Missing,
legacy, live, corrupt or nonempty evidence still fails closed. Mac remains blocked
because its event-post API does not provide equivalent delivery confirmation.
Host-authenticated ownership is still unavailable
(issue #7). Stop and re-arm behavior remain unchanged.
New task markers now atomically record the validated guard-file basename before
desktop input can be sent. A replacement retains that prior identity without
exposing a personal path in status; older markers lacking it remain supported
but cannot identify their ledger. This is preparation for issue #9, not proof
that old workers or watchdogs have stopped or that old input is released.
Before native action or application launch dispatch, the runtime now flushes a
bounded list of guardian and worker PIDs with a dispatch-started marker. It
retains prior PIDs when workers change, refuses dispatch if the record cannot be
written, and clears the list only after successful normal End. Tests check
ordering and a write failure using inert drivers. PID values alone are not
birth identities: eventual verification must conservatively treat a live or
uninspectable PID as unresolved, including reuse. Older records without the
list cannot establish that a prior worker is gone. The Windows cursor watchdog
now publishes its PID and start-time record before control can be activated;
unavailable metadata prevents this recovery path. Process PID reuse causes
conservative refusal rather than treating a live unrelated process as dead.
Every dispatch now records the current watchdog PID along with guardian and
worker PIDs, retaining earlier watchdogs if they change. Missing or malformed
watchdog metadata permanently marks that task's watchdog history incomplete,
so recovered End refuses instead of trusting only the latest watchdog. Older
records without this completeness marker also remain blocked.
Fixture-level and native storage tests do not establish physical crash recovery.
Windows watchdog identity publication now flushes a same-directory temporary
file and atomically replaces the prior record. A test invokes the compiled
native writer without desktop input and verifies that a locked failed
replacement preserves the old record. This addresses incomplete reads; it does
not prove physical cursor restoration or watchdog behavior after a real crash.
A Windows cross-process regression now kills a task process and tracks three
real inert child processes. End refuses while any recorded child remains alive
or the prior ledger is nonempty, then succeeds once all have exited and a
fixture ledger is empty; the Stop latch remains. The child processes are not
native desktop controllers, and the fixture deliberately sends no input, so
physical crash recovery and watchdog behavior remain unqualified.
Task startup now creates and flushes its own empty native input ledger before
dispatch, so a pointer-only task can leave verifiable empty evidence. An
existing nonempty, malformed or linked ledger is refused and never overwritten.
The tests use inert ledger contents; real pointer-only crash recovery is pending.
Native cleanup no longer treats a missing ledger as empty on Windows or Mac.
The passive runtime initializes its new guard's ledger before human controls
can start, and a missing ledger causes cleanup to fail closed. A compiled
Windows helper test checks the missing-ledger exit without sending input; Mac's
native contract check covers the same refusal when its fixture starts empty.
Windows native dispatch now also refuses untracked events such as pointer moves
when the ledger is missing, before calling the OS input API. A compiled native
test uses an inert input stub to verify that boundary.
When native cleanup fails, both guardian implementations now retain Stop and
continue other cleanup rather than reporting idle or aborting the remaining
cleanup sequence. `ready` reports `inspect_input_cleanup` instead of repeatedly
requesting re-arm. These are source and isolated-test results; actual guardian
UI, physical release and Mac interaction on this change remain unqualified.
On 30 October, a fresh Windows candidate built from `b1a0d7b` had build ID
`727d06b5186a68518a4e5d4b6640b579715662e6f8827949ea0d3246bfcc2759` and all
109 payload hashes matched. The isolated fresh-install and signed-update check
returned `qualified:false`, `skipped:true`, `insecure_storage_ancestor`; no
parent permissions were changed and no desktop input was sent. That is not an
installation, updater or real Antigravity acceptance pass. The candidate and
result are retained under `.localdata/tests/` and do not replace the live build.
An authenticated direct IPC regression exercises recovered `ready`, a refused
click, deferred update reservation and refused End, and confirms the inert
driver saw no input. This is controller integration evidence, not a real
desktop replay test.

Held-input cleanup now retains its pending flag if the independent release
helper fails, and native startup refuses new operations while that flag remains.
A later cleanup must actually succeed before the flag clears. Focused driver
regressions exercise repeated failure and confirmed recovery; live physical
held-input failure and recovery remain unqualified on both platforms.
An additional Runtime-plus-Driver test now exercises End through two failed
release attempts and one successful attempt: the task stays open and Stop stays
latched until cleanup is confirmed; End never clears the latch. Its release
helper is inert, so this is not a physical input-release test.
The driver also retains an unconfirmed retiring worker across cancellation
attempts. It requests Stop and independently tries input release, but refuses
new native operations and does not report cleanup complete until the worker's
exit is observed. A worker error event is not treated as proof of exit. Mocked
timeout tests and a real inert child-process exit test cover the boundary;
desktop/native hung-worker qualification is still pending.
The service-level regression also exposed a delayed guardian `idle` event that
could overwrite the runtime's stopped state. Stopped now ignores non-stopped
state notifications until a native human-resume event confirms the latch is
absent. Active operations recheck the latch, and delayed activation replies
cannot override a concurrent Stop. Fixture and IPC tests cover these races;
physical human re-arm on the new build remains pending.
Ready, cached app grants and host-authorized soft Resume now also recheck the
persisted latch before reporting control available. A mocked race writes the
latch before the guardian event arrives and verifies the runtime stops rather
than accepting the stale reply. These are not physical Stop/re-arm results.
Ready also reports a latch-persistence failure explicitly if it arises during
that recheck, rather than asking for re-arm while storage is unverified.
The prior driver fix at `503be09` passed both Mac CI jobs in run `40968689619`.
With free disk space restored, the Windows-local suite including the new End-path
regression passed 305 tests with 11 skips; skips are not qualification passes.

The installer also checks task state in the destination and previous deployment
roots before switching files, and checks again after staging. An open marker or
malformed state refuses the installation without replacing its configuration.
The standalone rollback entry point also checks open task state and live service
metadata in the target and every previous deployment root before restoring
files. The standalone rollback command now acquires native controller leases for
every root before rechecking and keeps them through restoration; the updater
passes its existing target lease in-process and acquires any additional roots.
A real local kernel-lease test covers a competing previous-root owner and reuse
of an updater-held target lease. A standalone installer now invokes the guarded
rollback worker after a partial switch. A staged installer returns its journal
to the updater, which reuses its target lease and also restores a scope that
failed before returning a successful installation record. Injected switch-failure
tests exercise both paths. Issue #8 remains open pending helper-loss tests and
real macOS/Windows recovery qualification; a lease can be lost during an
individual filesystem operation and must not be assumed continuously held.
Mac CI run `40966564326` failed three guarded-rollback fixtures because they
populated uninitialized private data directories. Those fixtures now initialize
their own empty Mac directories with the native storage guard before writing
test state. This changes fixture setup, not the storage guard. The repaired tests
passed on Windows; the current Mac CI run must confirm the fix on both runners.
An additional local Windows test now kills the actual lease helper between two
rollback records: the next record remains untouched and the journal remains.
On macOS a terminated helper can remain a zombie while synchronous file work
blocks Node's event loop; lease checks now reject zombie or uninspectable helper
state. Physical Mac qualification remains pending. A completed first
filesystem operation is not rolled back merely
because the helper died afterwards.
On the hosted Apple Silicon job of run `40967555678` (source `8abb123`), the
real helper-death and competing-lease regressions passed. Twenty isolated lease
checks had a 6.30 ms median and 7.57 ms p95 on that runner. This is not a
measurement of agent or desktop task latency. The Intel job passed the same two
regressions with a 9.09 ms median and 12.56 ms p95 over 20 checks. Both jobs
nevertheless failed an
incident test because the new guard raised synchronously; the test now accepts
both synchronous ownership loss and an asynchronous uncertain-publication error.
Interactive Mac qualification remains pending.
Corrected source `a0298d5` subsequently passed the hosted Apple Silicon and
Intel Mac matrix in run `40968152561`, including build, regression, isolated
install/update/rollback and provenance. It did not exercise the interactive
desktop, and later source changes require their own CI results.

Local full-suite rerun on 30 October failed `update_insufficient_space` with
drive D near 156 MiB free while tests ran concurrently. The focused rollback,
installer and updater suites had passed (75 tests) before that run. Old generated
installer fixture folders account for substantial apparent test data; automated
approval blocked their attempted cleanup. Preserve this as a capacity limitation,
not a successful full-suite qualification. GitHub CI for the subsequent commit
must be checked independently.
The largest recurring fixture is the launcher argv test, which copies the full
Node executable into its bundle and release. It now removes only its own newly
created directory after a successful run, while retaining it on failure. That
change does not remove old fixtures or make low-space local qualification pass.
The older beta had no task marker, so its absence in an older stopped service
cannot establish that an Antigravity conversation has finished; that bootstrap
qualification remains outstanding.

On 30 October Windows CI run `40979736685` at `fa828a0` failed one bootstrap
test when its PowerShell child exceeded 30 seconds; 335 tests passed and 11
were skipped. A separate Windows run for the same commit passed. Hosted-runner
resource contention is plausible but unproven. The workflow now limits test-file
concurrency to four, and the bootstrap fixture allows 60 seconds, reports process
errors and retains its directory on failure. The four focused tests passed
locally; the revised workflow still needs its own CI run. No runtime safety
deadline or acceptance requirement was changed.

Source inspection found a possible macOS race between input dispatch and
uncoordinated guardian/watchdog ledger recovery, tracked in issue #11. It is
not yet reproduced on a physical device. A proposed native lock now serializes
the final dispatch fence check and event journaling/posting with guardian and
watchdog recovery. Lock acquisition is bounded and fails closed. The macOS
native contract checks include contended and released lock cases without posting
desktop input; hosted macOS compilation and checks must validate this change.
A further native contract check starts a separate lock-holder process, requires
cleanup to refuse while it holds the lock, kills that process, and then checks
that cleanup can reacquire the lock. That check passed both hosted Mac native
contract stages at `8d986d3`. The lock now uses the already pinned private
directory inode rather than a separately replaceable lock file. A new isolated
contract fixture replaces the root while its original inode is held and checks
that a contender refuses the replacement; this change awaits hosted Mac checks.
These checks send no desktop input. Event-dispatch interleavings and physical Mac
input cleanup and Stop remain pending; the lock does not prove that a posted
release reached macOS.

Issue #20 tracks wall-clock rollback making observation ages negative or too
young. New observations carry an additional in-process monotonic timestamp and
are invalidated if either age is invalid, backwards or expired. Local shared
runtime tests pass. Existing in-process fixtures without the extra timestamp
retain the older wall-clock check; no claim is made about native sleep/wake or
physical stale-input qualification.

The native Mac journal now refuses to proceed when it cannot flush the saved
file before input dispatch. This is a file-flush check, not proof of directory
metadata durability or power-loss survival: Apple's [fsync documentation](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/fsync.2.html)
describes additional drive-level limitations. Mac CI and physical crash/power
qualification remain required for this change.

Apple Silicon CI run `40981240381` at `ed47341` failed the competing-service
test: the native helper exited but its structured refusal was not read before
the JavaScript client reported a generic exit. The client now waits for stream
closure before reporting a missing startup reply; a late native refusal retains
its specific error, while late success from a dead helper still fails closed.
Deterministic event-order tests pass on Windows. The exact fix still needs its
own Mac CI results; this does not establish desktop acceptance.

Peer descriptions no longer call every controller a Claude session or claim
that shared Sidecar conversations have separate grants. They state that the
native input fence is scoped to one data directory and that host conversation
ownership is not identified. A regression checks those limits; issues #7 and
#10 remain open and this wording change does not implement task isolation.
As a partial mitigation for #7, IPC now refuses End from a different build or
permission policy, and refuses a mismatched client's shutdown while an operation
is in flight, task state is open or unknown, or control is active or paused.
Status, Pause and emergency Stop remain available; shutdown
of a confirmed idle service remains possible. If status is unreadable, a
mismatched shutdown is refused while matching-controller cleanup remains
available. This does not identify two host
conversations using the same build and policy. These client-supplied fields are
not credentials and can be imitated; the check prevents accidental mismatch,
not deliberate impersonation. Issue #7 remains unresolved.
The current [Antigravity Sidecars documentation](https://antigravity.google/docs/sidecars)
describes a global background process and outbound `agentapi` commands; it does
not document an authenticated per-conversation identity on incoming local
controller calls. That absence in the published documentation is not proof
that no integration exists. Do not infer ownership from a model-supplied ID.

Issue #12 tracks a task-marker read hazard: a linked or dangling marker could
previously be followed or mistaken for an absent task. The candidate reader
now checks a single-link regular file, opens it without following links where
supported, compares file identity, and fails closed if it disappears after
inspection. Local updater, installation and recovery regressions pass; Mac
link tests and real installation/update acceptance remain outstanding.
The reader also caps the actual read at 1,025 bytes, even if a file grows
after its size was checked, and refuses changes detected during the read;
simulated growing and changing files are rejected locally.
The Windows prior-guard, watchdog and input-ledger reads now apply the same
single-link, file-identity and bounded-read checks. A hard-linked empty ledger
is refused in local regression tests. This does not qualify actual watchdog
cleanup or physical crash recovery, which remain open under issue #9.

Issue #15 tracks a defensive batch protocol gap: explicit failed return values
and malformed step results were not handled like thrown failures. The candidate
stops before later input, preserves delivery evidence, and labels malformed
results as unknown delivery. Local mocked regressions do not establish a real
native failure or complete native batch qualification. An IPC regression also
checks that a failure without an error object receives explicit no-replay
guidance when the step reports completed input.

Issue #16 tracks polling waits that used wall-clock deadlines. `wait` and
`wait_change` now use a monotonic deadline; isolated tests simulate a clock
moving backwards. This bounds polling decisions, not a native observation
already in flight, which has its own timeout. Real-host qualification remains
pending.
The independent native session expiry still uses wall-clock timestamps. A
backwards clock change can extend that nominal limit; issue #18 tracks a
cross-process monotonic design and physical qualification. The polling fix
must not be described as fixing native session expiry.
Candidate clock sources are Windows [GetTickCount64](https://learn.microsoft.com/en-us/windows/win32/sysinfo/windows-time)
and Apple's [continuous clock](https://developer.apple.com/documentation/kernel/1646199-mach_continuous_time),
which their platform documentation says include sleep. An implementation needs
one per-boot deadline shared by the native worker and independent watchdog,
bounded conversion from the requested duration, explicit refusal of malformed
or legacy active state, and safe handling of restart and suspend. Checking only
the guardian UI timer is insufficient. These are design inputs, not completed
implementation or physical sleep/wake evidence.
The current Windows cursor watchdog's `CrashCleanup` latches emergency Stop;
calling it for ordinary session expiry would incorrectly turn a routine limit
into a human-only re-arm. A safe design must handle an expiry racing with Esc
without overwriting a real Stop latch or allowing further queued input. The
worker's per-input fence and an independent watchdog both need the same bound;
neither a JavaScript deadline nor an in-process UI timer proves that property.
An initial candidate adds a per-boot deadline to the Windows and Mac guardian
states and requires it in the worker fence, with matching guardian UI expiry
checks. It rejects malformed or legacy active records and clamps requested
durations. Windows headless native tests cover arithmetic and refusal; Mac
compilation and equivalent contract checks passed in CI run `40988442306` at
`cb74627`. The Windows watchdog candidate allows ordinary guardian cleanup,
then escalates an unresolved expired/inactive state after five seconds or a
persistently invalid state after one second. It retains crash monitoring until explicit disarm after
worker termination and ledger recovery. Headless classification and grace
tests pass locally; native physical expiry/Stop races and Mac watchdog behavior
remain unqualified. A further Mac candidate records cleanup as pending until
worker termination is confirmed and the ledger recovery routine reports success,
allowing the watchdog to
detect a guardian stalled after publishing idle. A further candidate has each
worker exit itself when its native guard is revoked; the guardian and watchdog
wait for recorded birth identities without signalling numeric worker PIDs. An
unresponsive worker leaves cleanup unconfirmed and Stop latched. The separate
watchdog startup path uses its direct child `Process` for termination; the new
approach needs Mac CI, crash and real-device qualification. Its startup also refuses if watchdog
identity cannot be written and flushed. Parser tests are headless; Mac
compilation, actual cleanup acknowledgement, CGEvent delivery and device tests
for these changes remain pending. Do not install or release this partial change.
Issue #22 tracks Mac watchdog startup returning before a timed-out child exited.
The pending candidate records the child's birth identity, requests termination,
waits a bounded time and retains an unreaped child in the current guardian while
keeping Stop latched. An isolated native contract fixture exercises successful
termination; Mac compilation, unconfirmed termination across guardian restart,
and physical Stop/permission tests remain pending.
Watchdog readiness now reads a bounded complete JSON line, validates its boolean
acknowledgement and checks that the child remains alive. A headless Mac contract
fixture fragments the line across writes and refuses malformed, numeric and
oversized acknowledgements; its Mac CI result is pending.
The Mac termination wait now uses the same sleep-inclusive clock, refuses an
unavailable clock, and remains bounded after wake. The watchdog also fails
closed if that clock cannot be read; these changes await native CI and device
sleep/wake verification.
The Mac input-ledger lock wait now uses that same continuous clock and preserves
the original lock error before reading the clock. The existing headless
contention check applies; real sleep/wake remains unqualified.

Issue #19 tracks Windows control previously remaining active when its crash
watchdog failed to arm. The candidate now stops when monitoring is unavailable,
keeps an armed monitor if only cursor rendering fails, and checks the recorded
watchdog PID, birth time and executable in the native input fence. An isolated
native test verifies absent, malformed, wrong-birth and exited-process refusal
without sending input, including oversized and invalid UTF-8 markers. The read
is bounded to 129 bytes. A local run took 16.0 ms for 100 successful identity
checks after this change; the earlier run took 23.1 ms. These are not
end-to-end action latency. Lost arm acknowledgements, cosmetic
failure, actual held-input crashes and physical Stop still need native/real-app
qualification before issue #19 can close.
Windows CI run `40989217268` at `a252658` failed the native watchdog identity
test while the paired Windows run passed. The identity fixture now waits for
its child to report readiness, and failed checks include a bounded reason code
in test diagnostics. Five local reruns passed; the CI root cause is not yet
proven and the native guard has not been weakened.
The native worker now makes at most three read-only identity checks before
refusing an unavailable watcher, then rechecks the guard and Stop latch before
continuing. Isolated policy tests do not prove atomicity between that recheck
and the eventual input; physical Stop and concurrent-race checks remain open.

Issue #21 tracks a Stop racing with guardian state publication. A Windows
candidate checks a Stop generation and latch during publication; the Mac
candidate rechecks the latch after publication. Pure native resolution checks
are not proof of cross-process atomicity, failed-latch behavior or physical
Esc/re-arm. Mac CI and real-device race qualification remain pending.
Issue #23 tracks Mac Stop-latch checks that could treat a dangling link or an
inspection error as absent. The candidate uses `lstat` and treats only ENOENT
as absent; human re-arm uses `unlink` rather than recursive removal. Headless
Mac contract checks and real physical re-arm/Stop qualification are pending.

Issue #17 tracks action budget consumed before input-fence acquisition. The
candidate rechecks the deadline and budget inside the fence and counts only an
attempted native dispatch; busy, cancelled and pre-dispatch failures do not
spend an action. Unknown delivery still spends the action. Local tests cover
these cases. Launches also now check and consume the same budget, including
rechecking after waiting for the fence; local mock tests cover successful,
rejected and unknown-delivery launches. Real concurrent-host qualification
remains pending.
For `another_session_busy`, the direct response now directs the agent to wait
for the other controller and obtain a fresh observation rather than replaying a
possibly consumed frame. Unknown delivery still takes precedence. This is
guidance only and does not resolve shared Sidecar conversation ownership.

Issue #13 records that the listener's idle timer could clear an open task's
grants and frames or shut down a paused task during a long decision gap. The
timer now defers both policies for open or paused tasks. Isolated IPC tests
cover preservation and later cleanup; missing or unreadable task state also
defers cleanup. The independent native session expiry
still applies, and a real long-gap Antigravity test remains pending.
Session-limit failures now identify a bounded recovery action: end only the
owned task, obtain the required new authorization and observe again. An
uncertain or already-completed input still takes precedence and requires
inspection without replay. This guidance does not establish host ownership or
remove the native time/action limit.

Apple documents `CGEventPost` as returning no delivery result and describes
Quartz event-source state tables as combined states. A released state alone
therefore cannot distinguish our synthetic event from physical user input or
prove delivery to a target application. See [CGEventPost](https://developer.apple.com/documentation/coregraphics/cgevent/post(tap:))
and [event-source state](https://developer.apple.com/documentation/coregraphics/cgeventsourcestateid).
If cursor position is unavailable during Mac mouse-button cleanup, the native
helper now retains the ledger and reports failure rather than inventing (0, 0).
The native contract fixture supplies a missing location and checks that both
keys and buttons remain journaled without posting any event. Real Mac cleanup
and actual release delivery still require device qualification.
The native contract test also checks that a held-button journal is retained
when macOS actually reports post-event access denied; that conditional headless
check sends no events and is separate from the missing-position fixture.
The current native recovery still clears a nonempty journal after posting
release events; that is a best-effort cleanup, not a verified release. Do not
use it as evidence for physical Mac acceptance or safe recovered-task End.
# Native worker delivery uncertainty (2026-10-30)

Worker exit, cancellation, a write failure or a timeout can occur after an
effectful request was submitted. The driver now reports `input_outcome_unknown`
for those requests and directs the agent to inspect without replay; read-only
observations retain their specific transport errors. This also covers launch,
open, close and clipboard operations. Input cleanup still runs independently.
An effectful pipe write that throws also retires the native worker even for
operations such as launch that do not hold physical inputs, preventing a
possibly partially delivered command from continuing on a reused worker.

Release-candidate follow-up: an asynchronous guardian stdin error after a write
was accepted now immediately reports unconfirmed Stop, invalidates runtime
control, attempts input cleanup, rejects pending requests without replay, and
refuses another guardian start until the old process exits. A simulated pipe
error exercises this path. It does not establish native Stop acknowledgement,
durable uncertainty across restart, or physical held-input cleanup; issue #26
remains open and the candidate remains unqualified for release.
On Windows, the focused regression passed (36/36). The first full run failed
one parallel native compile with CS1583 (invalid compiler-generated Win32
resource); the second full run passed 431, failed 0, skipped 11. The failure
cause is not established and the rerun does not prove it cannot recur. Five
skips reflect the project-local ACL boundary; no skipped check is a pass.
When a task is recovered after a controller restart, `ready` now reports prior
input cleanup as the next step before suggesting human re-arm or opening a new
guardian. The explicit controls command also refuses a recovered task, an
unconfirmed native Stop, or failed Stop persistence before starting controls.
Isolated lifecycle and direct-service tests cover these paths. An already running
native guardian still requires its own durable re-arm fence; these changes do not
resolve issue #26's acknowledgement protocol or prove old workers have exited.
Driver fixture and IPC/batch regression coverage does not establish physical
Stop behavior or real-app delivery; those acceptance checks remain pending.

The Stop latch now records `unconfirmed:<nonce>` when guardian delivery is
uncertain. A replacement Runtime preserves that reason across restart, refuses
agent `ready` and explicit controls, and native Windows/macOS re-arm refuses to
clear the marker while showing a recovery warning. Normal confirmed Stop still
uses the ordinary `stopped` marker. Lifecycle coverage passes for the persisted
reason and the native Windows source compiles; physical re-arm and a verified
old-worker recovery run remain pending.
If cleanup itself fails after a submitted action, the response now retains both
the `input_cleanup_failed` stop reason and `delivery_unknown`. Direct and batch
IPC tests verify that remaining actions do not run and recovery guidance keeps
the cleanup failure visible. This remains simulated transport coverage.

Incident exports now use fixed operation, state and error-code categories;
unknown identifiers become `unknown`, including when reading older journals.
Agent feedback combinations remain fixed, and an older build ID is reported as
unknown rather than accepting free-form stored text. Unlisted legitimate error
codes lose specificity until deliberately added to the allowlist. Existing
stored journals are not silently rewritten; exports are sanitized on read.
Tests inspect the would-be GitHub title and body without making a network call.
Known literal native errors from the Windows and Mac hosts are included, so
permission, display and file-picker failures retain their classifications.
Reporting also reconciles an existing issue by its exact incident marker and
platform when a legacy code is now sanitized, avoiding a duplicate or a stuck
unknown-submission state after the upgrade. This is tested with mocked GitHub
responses; live reporting from a consented installation remains unqualified.

Signed updates now preflight the required shared runtime, skill, native helpers,
updater scripts and platform launchers, and compare the inner bundle inventory
with the signed payload inventory and computed build identity. This runs both
after staging and immediately before a switch, before the running controller is
reserved or stopped. Tests use signed inert bundles; real release transport and
interactive update acceptance remain pending.
The locally built Windows candidate also passed the new inventory preflight
across 110 packaged files (build `1aadd80279beb51e60016f8fc9a8f7f66b3dfdd80a8c88c6810fdb21ecea8b82`).
That check did not sign, publish or install the candidate.
Starting a new manual or scheduled update check now clears the previous offer
before network or staging work; applying requires an explicitly available
offer. A failed check retains prior stage files for inspection but cannot apply
them. Offline and insufficient-space paths are covered by transaction fixtures.
Release-list responses are streamed with a 4 MiB limit before JSON parsing;
oversized listings are refused before payload download or controller shutdown.

Post-launch window discovery now measures its eight-second polling limit with
the monotonic clock, so a backwards wall-clock adjustment does not extend the
wait or invite a duplicate launch. The test uses an inert driver and simulated
clock change; it does not qualify suspend/resume or live app launch behavior.

A disconnected `apps` discovery request no longer triggers emergency Stop:
discovery sends no input and does not grant an app. The in-flight discovery
still finishes or times out, and the normal one-operation limit remains in
force. An IPC test disconnects a discovery client during an active fixture
task and confirms Stop is not called; the existing action-timeout test still
confirms cancellation. This is not a diagnosis of the user's live pauses.

The skill and batch description now identify wait limits as polling budgets,
not guaranteed end-to-end deadlines. A slow observation may exceed the budget;
the agent must wait for a known outcome and avoid replay. The underlying hard
deadline and native-worker cleanup problem remains open in issue #25.
