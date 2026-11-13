<h1 align="center">Antigravity Computer Use</h1>

<p align="center">
  Let your Antigravity agent use real Windows apps with <b>/computer-use</b>:<br>
  the real cursor, the real keyboard, and a Stop you can always reach.
</p>

<p align="center">
  <a href="https://github.com/shayann07/antigravity-computer-use/actions/workflows/ci.yml"><img src="https://github.com/shayann07/antigravity-computer-use/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="https://github.com/shayann07/antigravity-computer-use/releases"><img src="https://img.shields.io/github/v/release/shayann07/antigravity-computer-use?include_prereleases&amp;label=Windows%20beta&amp;color=80abcf" alt="Latest Windows prerelease"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-9ac7dc" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/platform-Windows%20x64-697e92" alt="Windows x64">
  <a href="https://github.com/shayann07/antigravity-computer-use/stargazers"><img src="https://img.shields.io/github/stars/shayann07/antigravity-computer-use?style=flat&amp;color=80abcf" alt="GitHub stars"></a>
</p>

<p align="center">
  <img src="docs/media/launch-film.gif" width="720" alt="A real recording: an Antigravity agent opens Upscaly, picks a photo in the file dialog and runs a 4x upscale while the blue edge glow and control bar show it is in control.">
</p>

<p align="center">
  <a href="docs/media/launch-film.mp4"><b>Watch the 40-second film with sound</b></a> ·
  <a href="#install">Install</a> ·
  <a href="docs/INSTALLATION.md">Documentation</a> ·
  <a href="https://github.com/shayann07/antigravity-computer-use/issues">Roadmap</a>
</p>

Antigravity is the agent. This open-source skill gives its existing model native
desktop tools: it can look at an app, use its buttons and fields, fill in file
dialogs and work on canvases from screenshots. It runs in the **Antigravity
Agent Manager App** and uses the model you already chose there: no separate LLM,
API key, browser extension or MCP server.

The film above is a real recording, edited for length: the agent operates
Upscaly and upscales a 736×1308 photo to 2944×5232. The countdown is shown at
8× speed and labelled. [How it was made](docs/media/LAUNCH-FILM.md).

> **Windows beta.** [v0.3.0-beta.5](https://github.com/shayann07/antigravity-computer-use/releases/tag/v0.3.0-beta.5)
> is a published Windows x64 prerelease. Read [what is verified](#status-and-limits)
> before installing. Not affiliated with or endorsed by Google.

## Install

On Windows, paste this one line into PowerShell:

```powershell
irm https://raw.githubusercontent.com/shayann07/antigravity-computer-use/main/install.ps1 | iex
```

Then open Antigravity, type **/computer-use**, and describe what you want done.

The installer:
- downloads the beta.5 Windows bundle and checks its SHA-256;
- installs the global skill;
- enables a small background service, which Antigravity starts as a sidecar.

It keeps your existing settings and any emergency Stop. Requires Windows x64 and
the standard .NET Framework runtime. Installed copies update themselves from
signed releases; you can switch updates to manual or roll back.

Manual ZIP install, project-only setup, permissions, updates and removal:
[installation guide](docs/INSTALLATION.md).

## Try it

```text
/computer-use
Open my app, import the sample image, export it as PNG, and verify the result.
Restore the original settings and end computer use when finished.
```

Name the app, the file and where the output should go. The agent works faster
when it doesn't have to search for things.

## What it can do

| Capability | How it works |
| --- | --- |
| **See the real app** | Screenshots plus Windows accessibility names, roles and values. |
| **Use native controls** | Click, invoke, select, toggle and set values on the controls it observed. |
| **Work visually** | Moves the real cursor: click, double-click, right-click, drag and scroll by screenshot position. |
| **Type and use shortcuts** | Native keyboard input, Unicode text, and paste that restores your clipboard. |
| **Work across apps** | Find, launch, focus and pick windows, including the app's own file pickers and dialogs. |
| **Check each step** | Fresh observations after actions, short ordered batches, and no automatic replay when an input's outcome is uncertain. |
| **Hand control back** | Pause, optional take-over on human input, and an independent Stop that releases held keys and buttons. |

## You stay in control

- **You can see when it's working.** A breathing blue edge glow and a small
  control bar appear while the agent is in control.
- **Stop is always yours.** Esc, Ctrl+Alt+F12 or the bar's Stop button halts it
  immediately and releases anything it was holding. Only a human can re-arm it;
  restarting the service does not clear Stop.
- **Approvals have one owner.** The one-line install uses the sidecar, which
  relies on Antigravity's own approval of each command (`host-managed`). A
  manual install asks you directly instead (`standalone`): you approve each app
  per session and confirm sensitive actions separately. Either way, grants are
  tied to the real process. See [permission policy](docs/INSTALLATION.md#permission-policy).
- **Recovery is spelled out.** After a crash, every blocked reply names who acts
  next, the exact command and when it is safe.
- **Human-only screens stay human.** Sign-ins, UAC and the secure desktop are
  handed back to you. Screenshots go only to the model provider you already
  use in Antigravity; this project adds no telemetry.

Use one desktop task at a time: Windows virtual desktops share one mouse and
keyboard. [Security model](SECURITY.md).

## Status and limits

| Area | Where it stands (beta.5, build `f5a02d01`) |
| --- | --- |
| **Automated checks** | Windows and four macOS CI runners pass on every code change. The local suite has 575 tests: 562 passed, 0 failed, 13 skipped for platform or folder permissions. |
| **Releases** | Update metadata is signed through a protected release environment. A real beta.4 install updated itself to beta.5 from GitHub and can roll back. |
| **Desk test** | On a real install: normal task, physical Esc while typing, human re-arm, and recovery after a crash, both before and after input was sent. |
| **Speed** | Each step costs a model turn. In one Upscaly run, 30 turns took about 4.5 minutes, of which the controller itself used about 16 seconds. Cutting turns is tracked in [#74](https://github.com/shayann07/antigravity-computer-use/issues/74). |
| **Known gaps** | Some WebView2/Tauri controls are missing from the accessibility tree ([#70](https://github.com/shayann07/antigravity-computer-use/issues/70)). The bar can't be dragged yet ([#68](https://github.com/shayann07/antigravity-computer-use/issues/68)). Weaker models aren't tested yet ([#57](https://github.com/shayann07/antigravity-computer-use/issues/57)). Mixed-DPI and multi-monitor hardware remain untested. |
| **Platforms** | Windows x64. macOS (Apple Silicon and Intel) shares the same controller and skill but is **experimental**: it is built in CI only and not part of this release ([Mac guide](docs/MACOS.md)). Linux is unsupported. |

[Validation record](VALIDATION.md) · [Performance notes](docs/PERFORMANCE.md) ·
[Changelog](CHANGELOG.md) · [All releases](https://github.com/shayann07/antigravity-computer-use/releases)

## Build and contribute

Contributions are welcome, especially ones that cut model turns or make real
apps work more reliably. Start with an issue labelled
[`good first issue`](https://github.com/shayann07/antigravity-computer-use/labels/good%20first%20issue)
or [`help wanted`](https://github.com/shayann07/antigravity-computer-use/labels/help%20wanted),
and read [CONTRIBUTING](CONTRIBUTING.md).

Windows source builds need **Windows x64, Node 24.20.0** and the built-in .NET
Framework compiler. There are no npm runtime dependencies.

```powershell
git clone https://github.com/shayann07/antigravity-computer-use.git
cd antigravity-computer-use
npm test
node scripts/check-provenance.mjs
npm run bundle
```

The portable bundle is written to `dist/AntigravityComputerUse-windows-x64`.
Interactive native tests need a desktop nobody else is using. Keep test evidence
under the ignored `.localdata/` folder.

[Contributing](CONTRIBUTING.md) · [Code of conduct](CODE_OF_CONDUCT.md) ·
[Review guide](docs/review-guide.md) · [CI guide](docs/CI.md) ·
[Report a bug](https://github.com/shayann07/antigravity-computer-use/issues/new/choose)

## Open source and attribution

**MIT licensed.** Built on the published MIT native implementation from
[ridelink0/claude-computer-use](https://github.com/ridelink0/claude-computer-use),
with attributed adaptations from OpenAI's MIT computer-use sample and Anthropic's
MIT quickstarts. Exact revisions, modifications and hashes are recorded in
[UPSTREAM.json](UPSTREAM.json); bundled components and their licences are listed in
[third-party notices](THIRD_PARTY_NOTICES.md).

This is an independent project. It is not an official Google, OpenAI or Anthropic
product and is not affiliated with or endorsed by them.

[License](LICENSE) · [Security](SECURITY.md)
