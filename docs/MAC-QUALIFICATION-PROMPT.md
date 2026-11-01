# Prompt for the Mac qualification agent

Paste the following into an agent running on the Mac. It is a development task,
not the normal desktop-use skill. The report/PR is the handoff back to this repo.

```text
Qualify and repair Antigravity Computer Use on this Mac.
Repository: https://github.com/shayann07/antigravity-computer-use
Qualification candidate: `codex/mac-native-glass-assets`, PR #36.
Windows HUD avoidance is separate draft PR #35. Do not assume it is included.

Fetch and inspect the current integration branch and CI checks. Record its full
commit before testing. Preserve local changes and active work; do not reset or
overwrite an existing checkout. Create a short-lived repair branch from that
exact integration commit. Do not assume historical PR #1 is current. Read
AGENTS.md, HANDOFF.md, docs/MACOS.md, docs/MACOS-GLASS-MATERIAL.md,
docs/RELIABILITY-IMPLEMENTATION.md, VALIDATION.md and the shared skill.
Documentation is not proof of functionality. Refresh the exact PR head and its
CI before testing; do not use an older commit from this prompt as a current pin.

Keep one shared Node runtime, tool API, permission/observation/batch lifecycle,
installer and /computer-use skill. Add no separate agent, model or required MCP.
Record source/installed/running identities, architecture, macOS and Antigravity
versions. Keep all probes and private evidence inside ignored .localdata.

Verify the selected Xcode SDK using xcrun. Native Liquid Glass requires a macOS
26+ SDK at build time and macOS 26+ at runtime. Older-SDK source builds deliberately
use NSVisualEffectView; do not report that fallback as native Liquid Glass.
The contract test must decode all five shared official Phosphor SVGs from the
signed app Resources and report hud_material/native_glass_compiled. Inspect the
actual live bar too: native-class selection alone does not prove compositing.
Verify Settings, Pause/Resume/Re-arm and Stop/Hide keep fixed positions across
states, icons have no drawn substitutes or status dot, and keyboard focus/labels
remain usable. Check light/dark content and the human-selected Reduce Motion,
Reduce Transparency and Increase Contrast states. Do not silently change global
accessibility settings or manufacture OS approvals. Record unavailable cases.

Run source/native checks, build and install the matching candidate in a private
per-user path using the supported installer. Preserve settings, Stop and rollback.
Do not weaken storage guards, change parent ACLs or bypass OS security.

Have the human complete TCC/OS permission prompts and physical re-arm/Stop checks.
Test actual Antigravity /computer-use: ready, visible stopped controls, human
re-arm, discovery, usable screenshot, semantic and real-pointer actions, Unicode,
scroll/drag, Open/Save with independently verified outputs, multiple approved apps
and owned dialogs, approval/denial, physical Esc during queued/held input,
pause/resume, End, a second task, permission revocation, sleep/wake, available
displays and cursor/glow restoration after crashes. Use disposable documents.
Check that named clicks move the real pointer by default; also test explicit
semantic-only clicks, disabled controls, and that error/Stop paths do not replay
input. Record which actions are physically observed rather than inferred.

Specifically challenge issues #7, #9, #11, #16 and #17 on the exact current
head. Check serialization of native dispatch and cleanup, a worker killed while
an input is held, lock/ledger replacement, cleanup failure and a second task.
Posting a CGEvent or seeing an empty journal does not by itself prove that a
release reached the target. Record actual physical observations separately.
Run the native missing-cursor-location contract fixture on both available
architectures: it must retain the complete key/button ledger and post no event.
If macOS denies post-event access, verify the conditional denied-access fixture
retains the held-button journal. These are inert failure-path checks, not proof
of successful physical release. Qualify release delivery to a disposable target
separately, including an interrupted drag and modifier chord; if delivery cannot
be observed, leave that gate pending. Never manufacture OS permission or re-arm.
Check cooperative worker self-exit after Stop, Pause and expiry, and verify an
unresponsive worker leaves cleanup unconfirmed without signalling a recycled
PID. Do not suspend or kill unrelated processes to create the test.
The Sidecar does not yet authenticate host conversation ownership; never use a
model-supplied ID as a credential or disturb another task to make this pass.

Qualify updater authenticity, idle deferral, preserved Stop/config/pins,
failed-start rollback and skill discovery after upgrade. Production releases need
a maintainer-pinned signing key; never create an unsigned bypass to run a test.
Use explicit inert fixtures for cryptographic tests and label their limits.
Never claim that a fixture proves physical input or Antigravity orchestration.
Run the incident concurrency and helper-death tests on the exact Mac build,
including interrupted publication and refusal of a linked temporary file.
Record all skips and failures; older pinned project deployments may still use an
older writer, so do not claim universal cross-version safety without evidence.

Fix reproducible defects and add meaningful regressions. Preserve unknown input
delivery and no replay. If host UI cannot be controlled through a supported tool,
prepare the exact task for human launch and independently inspect its results.

Maintain tracked docs/MACOS-QUALIFICATION.md with passed/failed/blocked/unrun
checks, build identities, reproduction, changes and evidence references. Keep
screenshots, recordings, personal paths and document content out of public data.

With available GitHub authentication, push the repair branch and create a draft
PR targeting `codex/mac-native-glass-assets` while PR #36 is open. If it has
merged, use its reviewed integration successor on main and state that change.
File deduplicated
sanitized issues for unresolved reproducible defects. These project reports are
authorized. Without auth, prepare commits/report/issue text locally and state
what remains unsent. Do not self-merge or publish a general Mac release.

Return the PR/issue links and tested identities, actual results and remaining
human/hardware blockers. The owner will paste the PR link into the Windows
Codex chat for independent review. Do not claim completion while required
interactive or update acceptance remains unrun.
```

## Execution details for the qualification agent

- Refresh the current PR head; do not reuse a plan's older commit as current.
- Intel uses Swift target `x86_64`, while the Node bundle manifest records
  `platform: "darwin"`, `arch: "x64"`. Package with the exact Node version in
  `licenses/Node-provenance.json`; verify official download hashes.
- `AxonHost --contract-test` is headless contract qualification, not a TCC
  permission report. Human-facing `--setup`/the installed permissions launcher
  requests permissions and emits the current preflight results. Let macOS
  identify the actual helper identities; do not assume the host needs every grant.
- `scripts/qualify-signed-update.mjs` exports a function; running it alone does
  not execute qualification. `node scripts/macos-install-check.mjs <bundle>`
  invokes it with native storage/services and substituted transport/test keys.
  Report those limits separately from real published-signature/download tests.
- A current human starter uses passive `start` then `controls`. It can explicitly
  retry a cached `ready` failure; it never clears Stop or performs human re-arm.
- Qualify actual signed update transport and rollback separately from installer
  fixtures. Never add Mac assets to the existing Windows-only beta.4 release or
  automatically install a CI artifact. A manual candidate/source build is test
  evidence, not a published Mac upgrade. The maintainer owns release signing.
