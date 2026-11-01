# Reuse and provenance

The native foundation is `ridelink0/claude-computer-use`, revision `70347e652ab19f017939653e1a112eb523695198`, published under MIT. Its license is retained in `licenses/ridelink0.txt`; source inventory and original byte hashes are in `UPSTREAM.json`.

Retained implementation: persistent C# `AxonHost.cs`, `Presence.cs`, `Overlay.cs`; Node driver/build, renderer, session input lease and classification utilities; selected original fixtures/tests. Modified files add Antigravity integration, native human grants/action approvals, native input fencing, independent stop/worker termination, real-cursor behavior, monitor-edge glow and prebuilt packaging. `upstream-index.mjs` is an unexecuted source reference and is excluded from runtime bundles. Its old model-asserted grants are not the new MCP entry point.

The experimental macOS adapter also reuses the foundation's MIT
`server/native/AxonHost.swift` accessibility/input implementation at the same
revision. Its original hash and modified bytes are recorded in `UPSTREAM.json`.
The new `server/native/macos/` files implement the shared permission contract,
watchdog, storage, AppKit visuals and Mac-specific operations. The tool API,
observations, batching, receipts and installer remain in the common Node runtime.

OpenAI `openai/openai-cua-sample-app`, revision `6dd34b40acc1d002696ccd41aaf0a1f2f2be290c`, MIT: `python-app/app/desktop/release_inputs.py` is adapted into `ControlFence.Recover` (independent release attempts after failures; now restricted to inputs recorded in the original InputLedger ownership journal). Lifecycle concepts from `desktop/runtime.py` are adapted into driver abort/independent recovery. These are ports, not byte-identical copies. Copyright (c) 2025 OpenAI; full MIT license is in `licenses/OpenAI.txt`.

Anthropic `anthropics/claude-quickstarts`, revision `9ec32b91df50b0d4906cae64b13c6298055ff40d`, MIT: `computer-use-best-practices/computer_use/image.py` sizing algorithm is ported into `upstream-utils.mjs`; `tools/batch.py` sequential first-failure algorithm is adapted into the MCP batch implementation. Our transport image budget is not a claim about Gemini's encoder. Copyright (c) 2023 Anthropic; full MIT license in `licenses/Anthropic.txt`.

The Windows bundle includes the locally installed official Node executable, with its version/checksum recorded in `bundle-manifest.json` and upstream Node license under `licenses/`. No proprietary product bundles, extracted assets or leaked source maps are included. Product names identify compatibility; no affiliation or endorsement is claimed.

The Windows HUD companion uses the published `LiquidGlass` 1.0.0 NuGet package
by `shayann07/liquidglass` (Apache-2.0) and `SkiaSharp` / native assets 4.153.1
(MIT and other included notices), together with the self-contained .NET 10
runtime. Their licenses and notices are retained in
`licenses/`. The companion renders a caller-owned surface and does not capture
foreign desktop pixels.

The Windows HUD uses unmodified fill icons from `phosphor-icons/core`, revision
`2b75f3ad12b420c9504ef05df8d2564a28f8500e`, under MIT. Their source SVGs are in
`server/liquidglass-host/icons/` and the license is in `licenses/Phosphor-Icons.txt`.
