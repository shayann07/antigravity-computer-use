# Windows LiquidGlass integration

The Windows HUD uses a package-backed host under
`server/liquidglass-host`. It references the published `LiquidGlass` 1.0.0
NuGet package and renders through its `GlassPainter` API. The host is built with
the .NET 10 SDK and runs separately from the safety-critical .NET Framework
AxonHost. Its input is a caller-owned backdrop, not a capture of the desktop;
the result is therefore not live refraction of other applications.

The release bundle includes the helper and native Skia dependency in its sealed
inventory. The HUD connects over a persistent local stdio channel and displays
a plain readable surface if the helper is missing or unavailable. The complete
bundle is updated together; the helper is not downloaded or updated separately.

Qualification command (requires a .NET 10 SDK):

```powershell
dotnet build server/liquidglass-host/LiquidGlass.Host.csproj -c Release
dotnet run --project server/liquidglass-host/LiquidGlass.Host.csproj -c Release -- .localdata/liquidglass-real.png
```

This test proves the published package can be loaded and render a caller-owned
surface. Production HUD IPC, packaging and live appearance have separate checks.

For a Windows release, publish the helper self-contained and set
`AGCU_LIQUIDGLASS_HELPER_BUILD` to that output directory before running
`scripts/bundle.mjs`. The bundle then seals `liquidglass/LiquidGlass.Host.exe`
and `libSkiaSharp.dll`; the native HUD discovers the helper relative to the
bundle root. Package versions are pinned at build time. Dependabot proposes
upstream package updates automatically; they reach installations only after
review, testing and a signed bundle release. A library publication alone does
not immediately replace code on users' computers.
