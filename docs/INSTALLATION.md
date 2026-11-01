# Installation, update and removal

Version **0.3.0-beta.4** is the Windows direct `/computer-use` prerelease with bundled Node and native helpers. Download the [complete Windows ZIP and checksums](https://github.com/shayann07/antigravity-computer-use/releases/tag/v0.3.0-beta.4). External-display, Gatekeeper and published-update transport limits remain documented in [HANDOFF.md](../HANDOFF.md). Historical v0.2.0 uses the older MCP route, including the recording labelled as such in the README.

For the **experimental macOS candidate**, including architecture-matched prebuilt
downloads and human OS permission setup, see [Mac installation](MACOS.md).
The Windows command below does not install the Mac candidate.

The bundle includes control recovery and signed-update support. An older
installation without the updater needs one supported upgrade before it can check
for signed updates; installing a skill file alone cannot upgrade its runtime.
See [implementation and qualification status](RELIABILITY-IMPLEMENTATION.md)
for the distinction between automated checks and real-device acceptance.

## Quick install

Paste this in Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/shayann07/antigravity-computer-use/main/install.ps1 | iex
```

It downloads the beta.4 archive and pinned helper, verifies SHA-256, and
installs the global direct skill and Sidecar. A matching installation is verified
and reused without shutting down a running session. Existing permission policy and
emergency Stop are retained. Source: [install.ps1](../install.ps1). On unsafe
replaceable cache ancestors the installer refuses rather than changing parent ACLs.

## Windows portable bundle (manual)

1. Download the complete Windows ZIP and SHA256 checksums from [the beta.4 release](https://github.com/shayann07/antigravity-computer-use/releases/tag/v0.3.0-beta.4). Source builds use Node 24.20.0 and the Windows compiler: `npm test`, then `npm run bundle`. Release packaging can use `node scripts/bundle.mjs --output <new-empty-folder>` to preserve previous output.
2. Extract/copy the complete `dist/AntigravityComputerUse-windows-x64` folder. Its prebuilt helper and Node are required; normal installation needs no compiler, Python, new model account or credentials.
3. For App-managed startup, run `install.cmd --integration direct --sidecar`. Direct integration is the default; omitting `--sidecar` uses manual local startup. Sidecar installs default to `host-managed` permission mode so Antigravity's host/Turbo policy can authorize ordinary actions without repeated native approval modals; an existing explicit mode is preserved. The installer prints the release and exact backup paths.
4. Start a fresh Antigravity App conversation, invoke `/computer-use` and describe the task. The skill calls its pinned local script, opens returned screenshot files and uses native input. No MCP restart is required for this route. An old already-running MCP server may remain in an old conversation until the host refreshes; do not mix both controllers.

```powershell
.\install.cmd --target "D:\MyPrivateComputerUse" --integration direct
.\install.cmd --workspace "D:\Projects\Example" --integration direct
```

For the App's documented process lifecycle, opt in during the **global** direct installation:

```powershell
.\install.cmd --integration direct --sidecar
```

This registers only `antigravity-computer-use` under `~/.gemini/config/sidecars/` and enables its own entry in `config.json`, preserving permissions, models and other sidecars. Existing disabled state survives ordinary updates; explicitly passing `--sidecar` enables it. Project-local installs reuse the global companion and do not rewrite its configuration. Sidecars are an [official Antigravity App feature](https://www.antigravity.google/docs/sidecars/), distinct from MCP. The definition uses the pinned Node launcher, `serve` and `on-failure` restart. It creates no conversations or model requests. Actual App-managed beta.2 startup and read-only native discovery passed on 27 October 2026 without a manual launcher or whole-App restart. Refresh the Sidecar if a configuration change has not loaded; do not restart an active task.

The installed sidecar policy keeps the private listener resident after idle cleanup; app grants, cached observations and held inputs are released. It never resumes a Pause or clears emergency Stop. `end` finishes a task while retaining the listener; `shutdown` exits normally and is not an automatic crash restart. Manual installs without `--sidecar` retain the 15-minute service expiry. No Windows login task is registered.

Private-storage candidate default: a private `D:\AntigravityComputerUse-<owner-hash>` folder when its ACL is safe, then the Antigravity user-profile tree (`~/.gemini/AntigravityComputerUseBootstrap`), then LocalAppData. The printed directory is stable for the Windows account. A writable/renamable parent such as an inherited shared `D:\Tools` is rejected; parent/global settings are never changed. Choose a private direct-drive or user-profile folder for `--target`. App skill location: `~/.gemini/config/skills/computer-use`. Project location: `.agents/skills/computer-use`. These match [the official App documentation](https://antigravity.google/docs/skills).

The installer verifies manifest file hashes before making changes and refuses to update a live service. A short `cu.mjs` entrypoint with bundled `cu-node.exe` calls the exact installed script without command-shell forwarding. Node uses a hard link to the immutable payload where supported, otherwise a copy. Project-local launchers have separate names so they cannot redirect an existing global skill. Updates and rollback preserve both launcher files alongside the skill and installation pointer. `verify-install.mjs` checks the launcher pin and Node bytes as well as the payload. Only this project's old MCP entry is removed during direct migration. Other servers, host security preferences and unrelated configuration survive. Backups are kept under `backups/<timestamp>`. `--legacy-profiles` is optional and never enabled implicitly.

## Permission policy

Manual direct installations default to standalone native app/session and sensitive-operation dialogs. Sidecar installations default to host-managed mode; to opt into host-managed mode explicitly for a manual direct installation, use:

```powershell
.\install.cmd --integration direct --permission-mode host-managed
```

This does not read or change Antigravity's Turbo preset. The host agent is responsible for required user/sensitive-effect review before running the script. Broad terminal grants grant broad desktop authority. Native identity, frame, budget, watchdog and Stop checks remain active. The mode is fixed deployment configuration, not a model-controlled action flag.

Keep working is the default: normal physical mouse/keyboard activity does not pause. The bar's optional Yield on input mode pauses on deliberate input. Soft Resume follows local human Resume or, in host-managed mode, an explicit user message. Esc/Stop always requires local human re-arm; never restart a service to bypass it. Windows virtual desktops share one mouse, keyboard and active screen capture.

## Recording the visible controls (source recording candidate)

By default, Windows screen capture omits the control bar, glow and pointer halo.
To include them in a real demo, open the control bar's three-dot menu and enable
**Show glow and controls in screen recordings**. This is a local preference;
desktop action requests cannot enable it. Permission dialogs stay excluded.
The controller continues to hide its own chrome from agent screenshots. Turn the
option off afterward if you want clean recordings. It does not start a recorder.
This option is included in the beta.3 bundle.

## Verify an installed development bundle

```powershell
.\node.exe .\scripts\verify-install.mjs "D:\MyPrivateComputerUse"
```

This checks manifest files, the pinned skill and the chosen integration. It does not perform desktop actions or establish real application qualification. `status` reports the running build ID; a new build refuses to silently reuse another version's active service.

## Update and rollback

Finish and `end` active tasks first. Use the currently installed direct command's `shutdown` to close the helper, then install the replacement. Each install gets an immutable release folder; user deployment policy and skill command paths are generated separately. Ordinary direct updates retain the previously chosen approval mode unless explicitly changed. The private-storage candidate detects known prior deployment roots, preserves Stop and takeover preferences across a move, and never copies old capabilities/permits. Existing roots/backups remain recoverable. First migration from the historical location should explicitly select the intended permission mode; do not infer a Turbo token.

```powershell
.\node.exe .\scripts\rollback.mjs "D:\MyPrivateComputerUse\backups\EXACT-TIMESTAMP\rollback.json"
```

Use the exact printed backup path. Rollback restores this project's prior entry/skill and installation pointer while preserving unrelated host configuration edits. Existing older backup formats may lack the installation pointer record; inspect the restored skill when using one. Release folders remain recoverable.

## Optional legacy MCP

`--integration mcp` registers the compatibility adapter. Its default policy remains host-managed; standalone can be selected explicitly. Only this route requires refreshing/restarting the host's MCP server. The direct skill does not call this adapter.

## Removal and troubleshooting

End/shutdown control. Remove only this project's MCP entry if present and its global/project skill. After processes exit, remove only the chosen installation folder if desired; retain backups for recovery. Never delete the whole `.gemini` or `.agents` folder.

- Missing slash command: verify the intended App global/project skill path, then open a fresh conversation.
- Missing screenshots: open the returned actual `image.path` with the host image viewer. Text alone is not visual verification.
- Animation/old frame: use a fresh snapshot with `settle_ms:600` or wait for expected visible text. Never repeat the preceding input merely because its first image was transitional.
- Refused filename: `file_dialog_path_mismatch` means the tool sent no Save/Open confirmation. Inspect the actual dialog; explicit `entry_method: clipboard` uses temporary clipboard-preserving filename paste when authorized. It is not a model approval flag or silent fallback. Unicode/emoji Save, longer ASCII/space Save As and Unicode-path Open passed on native3d; retain the original keyboard-stream failure as a separate result.
- Wrong desktop/minimized: discover with `include_hidden:true`, focus only the intended app and inspect fresh pixels.
- Different running build: end/shutdown the old owned session before starting the new build; do not interrupt someone else's task.
- Elevated app/UAC/security surface: human handoff. No normal-user bypass is supported.
- Cursor roles: common arrow/link/text/app-starting roles are temporary custom cursors; app-owned and resize shapes remain app-controlled.

Specific real Agent Manager tasks and installed human Stop/re-arm checks now have records. Broader application, hardware and release qualification remain open. See VALIDATION.md; passing an installer or fixture test does not prove ordinary-task reliability.

## Windows desktop startup

If the managed sidecar is not available, double-click the printed `controller_start` file (**Start Computer Use.cmd**) from the normal Windows desktop, then invoke `/computer-use`. It uses only the installed pinned Node/runtime and accepts no forwarded arguments. It does not add a login task, change security settings, or grant approval. End/shutdown still cleans up normally; start it again after service expiry or reboot.

Actual Agent Manager terminal jobs were attached to an isolated `exebox` desktop while the visible input desktop was `Default`, even with Turbo selected. Their detached children were also retired between commands. Host-owned `serve` fixed lifetime but could not supply visible-desktop access. The native preflight now returns `desktop_context_unavailable` rather than creating hidden app windows or failing later in UI Automation. A local companion started on the normal desktop is the supported bridge; do not use WMI or desktop-switching recovery. Background startup at login is not enabled by this build.
