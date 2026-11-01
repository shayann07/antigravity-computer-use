# Mac HUD material and icon correction

Apple documents [`NSGlassEffectView`](https://developer.apple.com/documentation/appkit/nsglasseffectview)
as an **AppKit** view introduced in macOS 26. The earlier source comment claiming
it was unavailable in AppKit was incorrect. Historical qualification reports
that described native glass do not prove the later fallback-only source used it.

The candidate uses `NSGlassEffectView` with the regular style and native corner
radius on macOS 26+, provided it was compiled with a supporting SDK. Older SDKs
compile the `NSVisualEffectView` fallback without referencing unavailable symbols.
The SDK version is probed explicitly, included in the content-addressed build
identity, and selects a compile-time gate. A runtime availability check preserves
the macOS 14 deployment target. Future signed Mac packages build using macOS 26
runners so native glass is included, rather than permanently compiling it out.

Mac icons now load the same original Phosphor SVG files used by the Windows
package helper. Those exact assets are copied into the app before code signing
and sealed by the release inventory. The handwritten icon approximations are
removed; only the fill colour changes while loading. The settings icon matches
Windows' filled sliders icon. Icon decoding/rendering is checked offscreen; a
missing icon retains a readable text fallback rather than an empty control.

The native contract reports the selected material backend and the five decoded
icons. CI includes Intel and Apple Silicon on macOS 15 and 26, exercising older
SDK fallback and the native API path. These are build, resource and selection
checks. They do not prove live glass compositing, accessibility contrast, current
Mac permissions, physical Stop/re-arm, cursor cleanup or display behaviour.
The former `minimumContrast` constant is now named `contrastTarget`; its value
was a design target, not a measured contrast ratio over real desktop content.

Before shipping a Mac update, the Mac agent must verify the exact signed build
on hardware, report the actual material backend, inspect active/paused/stopped
controls over light and dark content and check Reduce Transparency, Increase
Contrast and Reduce Motion. Then finish the existing permission, real-app,
physical Stop, cleanup, update/rollback and second-task gates. Preserve the
user's settings. No full Mac visual qualification is claimed from CI alone.
