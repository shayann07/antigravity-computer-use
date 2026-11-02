# Mac HUD material and icon correction

The branch now integrates shared core through main `a02fabc`, including the
brief completeness fix and current qualification procedures. The established
shared skill is retained. This remains a source-only Mac candidate; its package
version does not identify a new published Mac release. The separately frozen
Windows beta.5 candidate is not rebuilt or installed by this integration.

Signed Mac packages on the new HUD line must include all five official icon
resources. The updater refuses an incomplete package before stopping the current
service or changing installation pointers. Older published beta.3 packages remain
outside this new resource requirement.

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
The Mac bar uses the same state wording and settings/play/pause/stop/hide artwork
as Windows. Controls keep fixed positions across states; the expanded red Re-arm
pill is removed. Native focus feedback and descriptive accessibility labels remain.

The native contract reports the selected material backend and the five decoded
icons. CI includes Intel and Apple Silicon on macOS 15 and 26, exercising older
SDK fallback and the native API path. These are build, resource and selection
checks. They do not prove live glass compositing, accessibility contrast, current
Mac permissions, physical Stop/re-arm, cursor cleanup or display behaviour.
The former `minimumContrast` constant is now named `contrastTarget`; its value
was a design target, not a measured contrast ratio over real desktop content.
The Mac guardian reports actual native panel visibility, rather than a hardcoded
success. A successful `ready` reply can include `visual_material` with the known
native/fallback backend, helping the agent distinguish them without source reads.

Capture restore now preserves requested visibility separately from temporary
hiding. Restoring a screenshot no longer requests a new entrance animation, and
Hide/End during capture cannot be undone by a late restore. Native contract
checks exercise passive startup, first show, repeated capture/state updates,
explicit dismissal during capture and a subsequent explicit show. These are
state-transition checks, not a recorded live-animation pass.
Temporary hiding also removes the HUD takeover-exemption bounds; an invisible
bar must not reserve a mouse region. Bounds cleanup uses file-scoped `unlink`
and refuses to recursively remove a directory at that path. Native contract
fixtures cover both regular-file cleanup and preserved directory contents.
Standalone consent-dialog input in Smart takeover is a separate source concern
tracked in [#43](https://github.com/shayann07/antigravity-computer-use/issues/43).
Its repair candidate and required physical qualification are documented in
[native confirmation and takeover](MACOS-CONSENT-TAKEOVER.md); the capture fix
alone does not establish correct consent behavior.

The macOS 26 Intel PR job at `3120237` failed the intentional concurrent-source
build test: one of two optimized Swift compilers exceeded its existing
120-second deadline. Its native compilation/contracts had passed, and the
same-head push job passed; the failing job is retained as evidence:
[job 124985095468](https://github.com/shayann07/antigravity-computer-use/actions/runs/41352353014/job/124985095468).
Serial test files did not eliminate that within-test contention.

Source builds now coordinate the expensive host compilation with the existing
native kernel lease, keyed by the complete source/SDK stamp. A concurrent
request waits for and verifies the signed bundle instead of starting a second
compiler. A late request also reuses a newly published winner. Old cached
bundles cannot masquerade as a new forced compilation. Reply files are separate
from the dedicated lease directory; releasing a request removes its reply files
and never removes the shared lock. The compiler's 120-second deadline and both
concurrent test requests remain. Prebuilt installation startup is unchanged.
Transport fixtures do not establish this repair: fresh Mac CI must compile the
real host and confirm that the two requests start exactly one compiler.

The source review used Apple's [motion guidance](https://developer.apple.com/design/human-interface-guidelines/motion)
(`Providing feedback`: permit cancellation and avoid needless repeated motion)
and [materials guidance](https://developer.apple.com/design/human-interface-guidelines/materials)
(`Liquid Glass`: regular material for legible foreground controls). The bar uses
13-point system status text, labelled keyboard-focusable controls and fixed
positions. Reduced Motion removes the entrance transform and makes the glow
static. Actual contrast, text enlargement, preference changes and compositing
over real light/dark content remain hardware acceptance items; source values
and target ratios cannot establish them.

Before shipping a Mac update, the Mac agent must verify the exact signed build
on hardware, report the actual material backend, inspect active/paused/stopped
controls over light and dark content and check Reduce Transparency, Increase
Contrast and Reduce Motion. Then finish the existing permission, real-app,
physical Stop, cleanup, update/rollback and second-task gates. Preserve the
user's settings. No full Mac visual qualification is claimed from CI alone.
