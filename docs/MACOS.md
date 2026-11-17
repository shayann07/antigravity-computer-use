# macOS

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

- macOS 14 or later, on Apple silicon or Intel.
- Antigravity Agent Manager App with global skills and Sidecars.
- Human-granted Accessibility, Screen Recording and Input Monitoring access.
- No compiler or external Node installation for the release bundle. Source
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

Since then the Mac adapter has been tested by hand on a real Intel Mac: access
cards with Allow, Deny and timeout, Esc and Stop, installation, and a 177-step
drawing in Preview with no failures or retries. The record is in
[MACOS-QUALIFICATION.md](MACOS-QUALIFICATION.md). Apple silicon is covered by CI
on every change.

## Install

Download the macOS archive for your Mac (arm64 for Apple silicon, x64 for Intel)
from the [1.0.0 release](https://github.com/shayann07/antigravity-computer-use/releases/tag/v1.0.0)
and check it against the release's checksums.

1. Extract the archive. Keep the complete
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
neither platform claims to authenticate Turbo. Release helpers are signed with
the project's own certificate, not an Apple Developer ID (owner decision), and
are not notarized. Do not disable Gatekeeper or system security to run them. A
permission/quarantine refusal needs human review.

**Which app's permissions count.** macOS charges the helper's Accessibility
and Screen Recording checks to the *responsible* app: the app that started the
service. When Antigravity starts it (the normal case), the checks use
Antigravity's own switches in System Settings, so a helper update needs no
new permission (seen in the TCC log on an Intel Mac with macOS 26.6: even
ScreenCaptureKit's capture check through `replayd` named
`com.google.antigravity` as responsible, and an update to a never-granted
helper captured with no change in System Settings). The AxonHost entry
matters only when the helper is responsible for itself, as in the setup
application opened from Finder; there macOS keeps Accessibility and Input
Monitoring across a helper update signed with the same certificate, but not
Screen Recording. A service started from Terminal is charged to Terminal.
Apple Silicon is unverified. Development builds signed ad hoc may lose all
three in the setup case.

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
  unconfirmed and Stop fenced. Stop ends the task; there is no human re-arm.
  The agent's next `ready` clears a confirmed Stop through the guardian's
  `clear_stop` operation once workers have exited and the input ledger is
  empty. An unconfirmed (`unconfirmed:` marker or `.unconfirmed` companion),
  unreadable, linked or directory marker is never cleared and survives
  restart. Prior macOS task
  recovery verifies that parent, worker and watchdog PIDs have exited and the
  JSON `.inputs` ledger (`{"buttons":[],"keys":[]}`) is empty before closing a
  recovered task. A guardian killed mid-task leaves its state reading `active`;
  that settles a stuck Stop only when every actor the task recorded is gone
  (guardian, watchdog and workers by pid and recorded start time, so a reused
  pid is told apart; the controller and recorded children by pid alone) and
  the ledger is a plain, single-link, readable file holding the empty ledger.
  Settling writes an ordinary `stopped` and ends the task; it never resumes
  the old task. This is the evidence the Windows guardian relies on: no held
  input and every worker exited.
- Input permission and point ownership are rechecked while dispatching native
  events. Errors attempt journaled input cleanup and preserve unknown delivery;
  detected cleanup failure latches Stop. Native headless refusal tests do not
  prove physical Esc or successful release at a target application.
- Per-app access, as on Windows: each app needs the human's Allow in the local
  prompt. Approvals last for the agent's conversation: `ready` returns a
  `session_handle`, and the guardian restores an app approved under that handle
  (matched by handle and executable path) without a prompt, across Stop, End
  and session expiry. Approvals are kept in private storage, so they also
  survive a controller restart and a relaunch of the approved app (same
  executable path). A missing or unknown handle or a new app asks again. The
  handle is never an approval by itself.
- Access tiers: terminals and IDEs (Terminal, iTerm2, Warp, Ghostty, Xcode,
  VS Code, Cursor, Zed, Sublime Text, Nova and the JetBrains IDEs) are
  click-only: left click, pointer moves, scrolling, focus and window sizing.
  Typing, keys, right/middle/modified clicks, drags, pastes, value writes,
  file pickers and opens are refused with `app_tier_click`, both for the target
  and whenever a click-only app is frontmost, and again at dispatch.
  Everything else, browsers included, is full.
- Human mouse and keyboard input never pauses or yields control; Smart takeover
  is gone and a saved `smart` preference is rewritten to manual. Only Esc,
  Control+Option+F12 or the bar's Stop end the task. There is no Pause and no
  Resume (owner decision, #99): the guardian refuses both ops with
  `pause_removed`, and a `paused` record from an older build is treated as no
  control.
- The control bar is drawn as on Windows (`docs/visual-design.md`,
  `DesktopVisuals.cs`): a 440×48 pill on the always-dark ink surface, two
  lines (line 1 coloured by state: working, asking, stopped, ended; line 2 the
  current activity), an Esc key cap, and Stop and Settings buttons at 44×44
  with hover and pressed states. No status dots, no Pause, Resume or Re-arm.
  The earlier Liquid Glass capsule is replaced
  ([material note](MACOS-GLASS-MATERIAL.md)). Motion and colour come from one
  file, `server/native/macos/MacDesign.swift`, with the same values as
  `DesktopVisuals.cs` (a test keeps them equal). Reduce Motion turns hover and
  menu motion into instant changes.
- Settings opens a 312-wide menu (12 radius, 44-pt rows) 8 pt under the bar,
  or above it when the bar is docked low. It opens with opacity and a scale
  from 0.96 over 200 ms and closes over 133 ms; Move bar changes page in place.
  Rows: Show bar and glow in recordings, Move bar (six docks and Reset), Glow
  brightness (Soft, Medium, Bright). One Mac-only difference, asked for on
  the Mac: a row's tick slides in and out, and an unticked row is left-aligned.
  Clicking outside closes the menu.
- The bar can be dragged by its body (4 pt threshold, never from a button,
  never by an event the agent posted), resists at the screen edge, and lands
  on one of six docks (top or bottom by left, centre, right; 12 pt from the
  sides, 18 pt from top and bottom) with the Windows spring (0.45 s, bounce
  0.15), or stays where it was dropped. It remembers its place in
  `control-preferences.json`. HUD avoidance works on Mac (`hud_avoidance`,
  guardian `avoid_input`, a port of `WindowGeometry.AvoidHud`): before a click
  the bar steps aside from the target, and it returns home afterwards.
  While an access card waits, the bar stays and reads "Waiting for your answer".
- The glow (`MacGlow.swift`) lights the window that last received an action,
  as on Windows: a soft blue-to-violet band on the window's edge that tapers
  to nothing (no rectangle, dithered so there are no steps), turning one lap
  in 60 s and swelling slowly on a 15 fps clock at rest. Its bright part eases
  toward the action's `point` when the runtime sends one (global points,
  top-left origin), otherwise toward the pointer after a click, move, drag or
  scroll. Brightness is a menu
  setting: Soft (default), Medium, Bright. The runtime passes the window's pid
  and frame; the guardian lights it only for a granted process. Measured at
  rest on an Intel i7-9750H around a 708x965 window, all three levels: the
  process 0.87–0.90 % of one core (3.2–3.7 % during the entrance), one frame
  every 66 ms with 0.11 ms of work (worst 0.27 ms), and the window server
  about 4.5–5 points more than without it. The entrance fades in while the
  band widens; in full screen the edges are lit inside the screen.
  `AxonHost --glow-preview <dir>` and `--glow-trial <seconds>` review it.
- The access prompt is a card on the bar's dark surface, matching the Windows
  design (`docs/visual-design.md`): 496 wide, 18 radius, one soft shadow and a
  hairline; the first line is the title and the rest scrolls past 300 pt;
  filled Allow and outlined Deny with hover, pressed and focus states; the note
  that 90 s without an answer counts as Deny. It hangs 8 pt under the bar,
  above a bar docked low, or in the middle of the screen. Its behaviour is
  unchanged: modal, Deny holds the focus, Return and Esc deny, the timeout
  denies, it is excluded from capture and the normal OS cursor is shown.
  `AxonHost --prompt-preview <dir>` renders it offscreen for review. Controls support keyboard focus
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
   independent cleanup, and a second task (same `session_handle`, no prompt)
   without host restart.
5. Click tier in a terminal or IDE and full tier in a browser and TextEdit;
   human input during a task never pauses it;
   cursor/glow cleanup after completion and helper crashes.
6. Retina/mixed-scale multiple monitors, negative origins, gaps and display changes.
7. Actual Sidecar startup while idle, permission revocation, sleep/wake and app
   restart, retaining Stop and existing host configuration.

Keep evidence inside the checkout's ignored `.localdata`. An unavailable human,
permission or hardware check stays pending; do not remove its guard to force a pass.
