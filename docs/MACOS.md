# macOS adapter — experimental candidate

The Mac implementation uses the same Node runtime, tool schemas, observation
references, batches, limits, receipts, installation and rollback as Windows.
There is one `/computer-use` skill. The native adapters implement OS calls;
there is no second agent, required MCP server or separate feature library.

`server/control-contract.json` supplies the common control states, time/action
limits, sensitive-effect patterns and visual tokens. Both native consent
runtimes load it. The Mac helper refuses control when its contract is missing,
incompatible, paused, expired or stopped. The shared driver refuses the old
unguarded Swift port.

## Requirements and current status

- macOS 14 or later; Apple Silicon and Intel candidate builds.
- Antigravity Agent Manager App with global skills and Sidecars.
- Human-granted Accessibility, Screen Recording and Input Monitoring access.
- No compiler or external Node installation for a prebuilt candidate. Source
  builds require Xcode Command Line Tools and Node24.20.0.

Candidate `787ddb1` passed compilation, shared regressions, native contract and
private-storage/ownership checks, packaging, installation, End, latched Stop
across restart, update and rollback on Apple Silicon and Intel
([CI evidence](https://github.com/shayann07/antigravity-computer-use/actions/runs/40817619660)).
Earlier installation/start checks failed under deep paths; the current Mac
adapter uses an ephemeral IPv4 **127.0.0.1** endpoint with the same private
256-bit capability authentication. It never listens on an external interface.
Windows retains its named pipe. This is a transport difference, not a different
tool or permission API.

**Interactive Mac acceptance remains unrun.** Do not present the candidate as
qualified Windows parity or a general release. See the exact commit's macOS CI
for current compilation, installation and packaging results; failed runs are
retained. No user Mac was controlled from the Windows development environment.

## Try a prebuilt candidate

Use the architecture-matching artifact from the Mac adapter branch's successful
[macOS workflow run](https://github.com/shayann07/antigravity-computer-use/actions/workflows/ci.yml).
These CI artifacts are temporary development downloads, not release assets.

1. Extract the artifact ZIP and its `.tar.gz` archive. Keep the complete
   `macos-bundle` directory together.
2. Run `install.command` from that folder. It installs the global direct skill
   and the project's own Sidecar, preserving existing configuration and a rollback
   backup. The default target is
   `~/Library/Application Support/AntigravityComputerUse`.
3. Run **Setup.Mac.Permissions.command** yourself. Approve the OS-requested
   permissions in System Settings. The agent must not complete those prompts.
4. Use `/computer-use` in Antigravity. The tool vocabulary is the same; `launch`
   accepts `.app` bundles and key chords accept `cmd` and `option`.

From a terminal in the extracted folder, installation is also one command:

```sh
./install.command
```

Sidecar installations use host-managed permissions by default so Antigravity's
host/Turbo policy can authorize ordinary actions without repeated native
approval modals. For a manual direct installation, only an operator should opt
into host-managed permissions:

```sh
./install.command --permission-mode host-managed
```

The default standalone mode uses native app-session and sensitive-action
approval dialogs. Host-managed deployment relies on host execution review;
neither platform claims to authenticate Turbo. The helpers are ad-hoc signed for
development, not Developer ID signed or notarized. Do not disable Gatekeeper or
system security to run them. A permission/quarantine refusal needs human review.
macOS may require new permission approval after an ad-hoc-signed update.

## Native behavior

- Accessibility uses AXUIElement, reusing the attributed MIT Swift foundation.
- ScreenCaptureKit captures only the unambiguously matched approved window
  (binding `_AXUIElementGetWindow` directly to `CGWindowID` with browser/profile
  title suffix matching and refusing ambiguous title-only selectors when multiple
  windows share a title); there is no covering-desktop fallback. Coordinates
  retain native display origins and screenshot-to-window scaling in the shared
  runtime.
- **macOS Space and capture classification & human recovery**: macOS
  `kAXWindowsAttribute` and `CGWindowListCopyWindowInfo(.optionOnScreenOnly)`
  only expose windows on the currently active Space, and macOS cannot safely
  capture or focus a window on another Mission Control Space or full-screen Space
  without switching Spaces. The adapter never switches Spaces automatically and
  classifies window capture states deterministically with bounded recovery (at
  most one recovery attempt per window before refusing repeated polling with
  `repeated_failure: true` and `recovery_attempts_remaining: 0`):
  - `other_desktop` (`next_action: "await_human_space_switch"`): Target window is
    on another Mission Control Space. **Human recovery**: switch to that Space or
    move the window to the current Space, then observe again.
  - `window_fullscreen` (`next_action: "await_human_fullscreen_exit"`): Target
    window is in macOS full-screen mode on a dedicated Space. **Human recovery**:
    exit full-screen mode (green title-bar button or `Control+Command+F`), then
    observe again.
  - `window_minimized` / `window_hidden` (`next_action: "focus_target_then_observe"`,
    `recovery_attempts_remaining: 1`): Target window is minimized to the Dock or
    hidden (`Cmd+H`). One bounded `focus` attempt unminimizes/unhides it on the
    current Space; repeated `snapshot` polling without recovery refuses with
    `await_human_window_recovery`.
  - `identity_changed` (`next_action: "discover_apps_then_observe"`): Target
    window handle was closed or retired. Run `apps` to discover current windows.
  - `mac_permissions_required` / `accessibility_denied`
    (`next_action: "await_human_permission_grant"`): Screen Recording or
    Accessibility permission is missing in System Settings.
- Physical input uses marked CGEvents, eased real-pointer travel and ownership
  checks. Semantic actions do not invent mouse movement. Ambiguous provider
  failures return unknown delivery without a physical retry.
- A separate event-tap watchdog handles physical Esc or Control+Option+F12 and
  invalidates the native fence. Workers observe revocation and exit themselves;
  the watchdog waits for their recorded identities and attempts to release
  journaled automation-held input. An unresponsive worker leaves cleanup
  unconfirmed and Stop latched. Stop persists across
  restart; only the local human Re-arm control clears it. Prior macOS task
  recovery verifies that parent, worker and watchdog PIDs have exited and the
  JSON `.inputs` ledger (`{"buttons":[],"keys":[]}`) is empty before closing a
  recovered task.
- Input permission and point ownership are rechecked while dispatching native
  events. Errors attempt journaled input cleanup and preserve unknown delivery;
  detected cleanup failure latches Stop. Native headless refusal tests do not
  prove physical Esc or successful release at a target application.
- Manual takeover is the default. Optional Smart mode ignores small motion and
  yields on deliberate input. Resume requires fresh observations.
- AppKit renders the HIG-aligned Liquid Glass control bar (`396×44` rounded
  capsule using Apple's native `NSGlassEffectView` on macOS 26+ with
  `NSVisualEffectView` fallback on macOS 14/15, pure filled Phosphor Icons
  without status dots or strokes, and clear state labels for
  `Working · Esc to stop`, `Paused · Resume or Esc`, and
  `Stopped · Re-arm required`), breathing screen edges and original arrow/text
  pointer. Emergency Stop uses a high-opacity crimson glass tint (`alpha = 0.88`,
  `>= 8.5:1` contrast) so translucent material never obscures the stopped state.
  Transitions use `0.16s` fade/scale motion and respect
  `accessibilityDisplayShouldReduceMotion`. Controls support keyboard focus
  (`Tab` loop, native focus ring mask, `Space`/`Return` activation and `Esc`
  emergency Stop), while areas outside the control bar remain click-through.
  End/Pause/Stop release the cursor, remove `.hud` bounds and hide active
  visuals. Native screenshots omit the chrome.
- POSIX ownership/mode checks, link refusal, extended-Allow-ACL refusal and an
  OS-held `flock` lease protect the data directory. Parent permissions are never
  modified. Directory or lease replacement invalidates control.
- Native file pickers require an already-open owned dialog and exact path
  readback. If the picker cannot expose a verified target, confirmation refuses;
  there is no blind Enter fallback. Save-dialog coverage needs real Mac testing.
- Clipboard paste preserves readable formats and restores them if no other app
  changed the clipboard. Provider-owned/lazy clipboard formats can refuse.

Authentication, secure fields, locked sessions and OS security prompts require
human handoff. The shared policy blocks the assistant/Antigravity host windows.
The adapter does not switch Spaces or create hidden desktops for automation.

## Qualification checklist

CI must compile both architectures, run shared state/observation/batch tests,
native contract tests, storage/link/ACL/lease checks, package sealed prebuilt
helpers and exercise install/start/End/Stop/restart/update/rollback in a fake home
under `.localdata`. These tests send no desktop input and preserve the real home.

On an actual Mac, still verify:

1. Human permission setup and denial; ordinary and sensitive approval/denial.
2. Actual Antigravity `/computer-use`: a screenshot, physical click/typing,
   semantic action, scroll, drag, native Open and Save, Unicode and output bytes.
3. Multiple approved applications and owned dialogs without repeated ordinary
   prompts; no clicks into covering apps or other Spaces.
4. Physical Esc during held input and queued actions, no subsequent input,
   independent cleanup, human re-arm and a second task without host restart.
5. Pause/authorized resume, incidental input in manual mode and deliberate input
   in Smart mode; cursor/glow cleanup after completion and helper crashes.
6. Retina/mixed-scale multiple monitors, negative origins, gaps and display changes.
7. Actual Sidecar startup while idle, permission revocation, sleep/wake and app
   restart, retaining Stop and existing host configuration.

Keep evidence inside the checkout's ignored `.localdata`. An unavailable human,
permission or hardware check stays pending; do not remove its guard to force a pass.
