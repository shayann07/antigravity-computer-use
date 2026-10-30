# Release checklist

- Run `npm test` and `npm run build` on Windows. Run native tests sequentially on an interactive disposable desktop; human tests require real human input.
- Refresh UPSTREAM.json modification hashes without changing original upstream hashes. Retain all licenses.
- Use Node 24.20.0 with its recorded license for `npm run bundle`.
- Verify the bundle manifest, install into a test destination, run `scripts/verify-install.mjs`, and test update/rollback.
- Package source without .git, .localdata, dist, node_modules, logs, private recordings or personal screenshots. Package the portable folder separately.
- Inspect ZIP contents and publish SHA-256 checksums with release assets.
- Create the intended public GitHub repository, enable private vulnerability reporting, and run its Windows workflow before labeling CI verified.
- Prepare signed update metadata with the maintainer-controlled key using the
  `Prepare signed release assets` workflow. Verify its exact source revision,
  public-key signature, inventory, platform, architecture, expiry and payload
  hashes before publication. This signs update metadata, not Windows binaries.
- Publish the source tree, portable ZIP, checksums and matching signed Windows
  update assets only after the applicable Windows checks and release notes have
  been reviewed. A Windows-only release must not claim a newly qualified Mac
  bundle. The bootstrap pin must point to an existing, verified public asset.
- Record hardware coverage precisely. Physical mixed-DPI/multi-monitor validation remains outstanding.

Public repository: https://github.com/shayann07/antigravity-computer-use. Release assets must correspond to a commit whose Windows checks passed.
