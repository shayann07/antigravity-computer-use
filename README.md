<h1 align="center">Antigravity Computer Use</h1>

<p align="center"><b>Let your Antigravity agent use real apps on Windows and macOS.</b></p>

<p align="center">
  <a href="https://github.com/shayann07/antigravity-computer-use/releases/latest"><img src="https://img.shields.io/github/v/release/shayann07/antigravity-computer-use?label=release&amp;color=80abcf" alt="Latest release"></a>
  <img src="https://img.shields.io/badge/Windows%20%7C%20macOS-697e92" alt="Windows and macOS">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-9ac7dc" alt="MIT license"></a>
  <a href="https://github.com/shayann07/antigravity-computer-use/stargazers"><img src="https://img.shields.io/github/stars/shayann07/antigravity-computer-use?style=flat&amp;color=80abcf" alt="GitHub stars"></a>
</p>

<p align="center">
  <a href="docs/media/paint-demo.mp4"><img src="docs/media/paint-vs-photo.png" width="520" alt="Left: a portrait painted in Microsoft Paint by the Antigravity agent. Right: the original photo."></a>
</p>

<p align="center">
  <a href="docs/media/paint-demo.mp4"><b>▶ Watch it paint (21 s)</b></a><br>
  <sub>A real run: Antigravity drove Microsoft Paint through a prepared plan of 2,553 strokes in 40 exact colours. About an hour of painting, shown 260× faster.</sub>
</p>

Type `/computer-use` in Antigravity and say what you want done. The agent reads
the app, then clicks, types, drags and fills in dialogs with your real mouse and
keyboard. It uses the model you already have: no API key, no second LLM, no MCP
server.

## Install

**Windows**

```powershell
irm https://raw.githubusercontent.com/shayann07/antigravity-computer-use/main/install.ps1 | iex
```

**macOS:** download the `macos-arm64` (Apple silicon) or `macos-x64` (Intel)
archive from the [latest release](https://github.com/shayann07/antigravity-computer-use/releases/latest),
then run `install.command` and `Setup.Mac.Permissions.command`. [Mac guide](docs/MACOS.md)

Then open Antigravity and try:

```text
/computer-use
Open Paint, draw a red circle in the middle, save it to my Desktop as circle.png.
```

## You can see what it's doing

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/media/glow-dark.png">
    <img src="docs/media/hero-glow.png" width="640" alt="A soft blue glow around the window the agent is working in.">
  </picture>
</p>

A soft glow outlines the window it is working in, and a small bar says what it
is doing right now.

<p align="center">
  <img src="docs/media/bar-states.png" width="440" alt="Three states of the control bar: Antigravity is working, Waiting for your answer, and Stopped because you pressed Esc.">
</p>

## It asks before it touches anything

<p align="center">
  <img src="docs/media/access-card.png" width="420" alt="An access card asking to allow Antigravity to use Notepad with full control until a new conversation starts, with Allow and Deny.">
</p>

Nothing runs without your OK: through Antigravity's own approvals with the
one-line install, or with this card in [standalone mode](docs/INSTALLATION.md#permission-policy),
where saving, pasting and deleting ask again. Terminals and code editors are
always click-only, so it can't type commands into them.

## One key stops it

<p align="center">
  <img src="docs/media/settings-menu.png" width="380" alt="The Settings menu: show bar and glow in recordings, move the bar, glow brightness, and a reminder that Esc or Ctrl+Alt+F12 stops at once.">
</p>

**Esc** stops it at once, wherever you are, and lets go of every key and
button. Ask it to carry on and it starts fresh. Sign-ins and admin prompts are
always left to you.

## Long jobs in one command

`plan` sends many steps at once, so the model doesn't have to think between
every click. A 30-turn task drops to about 9.

The portrait at the top is one `plan`: 2,832 steps that pick 40 exact colours in
Paint's colour editor and paint each one as long back-and-forth rows. It ran
unattended for about 65 minutes with no retries.

<p align="center">
  <img src="docs/media/paint-progress.png" width="760" alt="Four moments from the real run: the dress blocked in at 9 minutes, more of the figure at 24, the braid and hands at 43, and the finished portrait at about 65 minutes.">
</p>

## Learn more

[Install guide](docs/INSTALLATION.md) · [Mac guide](docs/MACOS.md) ·
[Security](SECURITY.md) · [Changelog](CHANGELOG.md) ·
[Contributing](CONTRIBUTING.md)

MIT licensed. Not affiliated with Google.
Built on [ridelink0/claude-computer-use](https://github.com/ridelink0/claude-computer-use); see [UPSTREAM.json](UPSTREAM.json).

<p align="center">⭐ <b>Star it if it saves you time.</b></p>
