# Preserve uncertain Stop across later writers

Issue [#26](https://github.com/shayann07/antigravity-computer-use/issues/26)
remains open. A file-only probe invoked the actual Windows native `LatchStop`
method and the actual shared Runtime with inert dependencies. Both changed
`unconfirmed:<fixture>` into plain `stopped`; a reconstructed Runtime then
reported an ordinary persisted Stop. No controls, application grant, input or
physical re-arm was involved. The native source blob also matches beta.4's
source. This proves lost uncertainty metadata, not a demonstrated input bypass.

## Candidate repair

- Ordinary Node and native Stop writers create missing markers without
  overwriting existing evidence. Native file writes are flushed.
- Uncertain delivery also publishes `emergency.stop.unconfirmed` atomically,
  create-only and file-flushed. This separate marker survives a Windows open
  handle preventing replacement of the primary file, or a later primary write.
  The primary retains the uncertainty prefix when replacement is possible.
- Updated native workers and human controls check both paths. The independent
  monitors also observe the uncertainty marker; active/paused control is
  revoked without requiring the agent or responsive guardian UI to relay it.
  Passive startup remains invisible; this does not start a guardian or re-arm.
- Shared startup, shutdown and status preserve the stronger reason. Unknown
  filesystem entries fail closed; marker reads are bounded and do not follow
  file links. Both marker names remain private runtime state.
- Installer, updater and rollback refuse or defer when uncertainty or Stop
  persistence errors are present. No older bundle is launched automatically to
  bypass this boundary. Ordinary confirmed Stop still survives normal upgrades.
- Update preparation refuses unresolved Stop recovery. Permission settings,
  deployment pins and human-only re-arm are unchanged.

The supported complete bundle must include these native and shared changes
together. An arbitrary old executable does not honor the new companion file;
cross-version/manual-launch exclusion is not claimed. Older generic writers
can still erase the primary prefix, which is why the companion is required.

## Evidence and limits

Tests exercise actual native file persistence without input, late writes through
an older open handle, concurrent ordinary writers, flush failure, process
reconstruction, invalid entries, and installer/updater/rollback deferral. They
do not establish physical held-input cleanup, native pipe-loss behavior, or
power-loss durability. Windows may not support flushing a directory handle;
the existing atomic writer reports that limitation separately from file flush.

This repair does **not** supply a correlated authenticated native Stop
acknowledgement, and it does not create a new recovery/re-arm authorization.
Uncertain delivery stays blocked. Completing a trustworthy recovery protocol
for verified old-worker termination and held-input cleanup remains part of #26.
Do not delete a marker or manufacture a human click to force qualification.
Real broken-pipe, hung-guardian, crash, restart and physical recovery checks on
Windows and Mac remain release gates. Source/fixture passes cannot close them.
