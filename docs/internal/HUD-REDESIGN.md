# Control bar and glow redesign

Design proposal only. No native code changes are part of this document. It was
written against `origin/main` at `743b042`.

Mockup: `.localdata/hud-redesign/mockup.html`, rendered to
`.localdata/hud-redesign/mockup-full.png` (ignored, local only). The mockup uses
two fictional apps and no captured desktop data.

Product context was taken from the code and the existing docs. There is no
`PRODUCT.md` or `DESIGN.md` in the repository.

## 0. The control model this design assumes

The owner has decided to remove arm and re-arm. The design follows that model:

- **Per-app access.** The human approves each app before the agent can use it.
- **Tiers.** Terminals and IDEs are click only. Everything else, browsers
  included, is full control.
- **Approval lasts for the conversation.** It ends only when the person starts
  a new conversation. Esc, Stop and the session time limit do not revoke it.
- **Stop ends the task.** Stop or Esc halts input at once. There is no latch
  and no approval card afterwards: the person tells the agent to continue and
  the next request starts a fresh task for the apps already approved.
- **Human input never pauses the agent.** Only Esc or Stop halts it. Pause
  exists only as an explicit button on the bar.

Decided alongside it: no breathing glow, per-window glow as phase 2, a flat
dark bar, six docks plus free placement, "Stop" and "Resume" as the only
control words, and a native change so the bar's Stop works by mouse while a
prompt is open.

The removal of the latch and of re-arm is engineering work outside this
document. This document covers what the person sees.

## 1. What is on screen today

In guardian mode the live bar is the `Guardian` form painted by
`DesktopVisuals.Hud`. `Overlay.BannerForm` (the orange "Claude is using your
computer" banner) is not shown in guardian mode. The glow is `Overlay.RingForm`
painted by `DesktopVisuals.Edge`; the Mac equivalents are in `MacVisuals.swift`.

### Problems with the bar

1. **It does not say who has the computer.** "Dragging with Antigravity" reads
   as a slogan. The verb lasts 1.2 s and then the text changes to "Antigravity
   is working", so the one line flickers between two sentences.
2. **Three controls carry equal weight.** Settings, Pause and Stop are three
   pale icons on glass. Nothing marks Stop as the one that matters.
3. **Two of three targets are too small.** `ModeRect` and `ToggleRect` are
   36 × 36 DIPs. `StopRect` is 88 × 36. The floor is 44.
4. **Re-arm is an unlabelled play triangle** in the slot that held Pause, and
   Stop turns into Hide in the same place with no guard. Both go away with the
   new control model.
5. **Refusals are silent.** When a resume is refused (held input, live
   workers) the guardian emits a `visual_warning` on stdout. Nothing changes
   on screen.
6. **The reason for a state is never shown.** `SetState` and `Emergency` carry
   a reason (`human_takeover`, `escape`, `input_desktop_changed`, …). The bar
   shows only "Paused" or "Stopped".
7. **Session expiry dismisses the bar with no message.**
8. **The bar cannot be moved** (#68). Avoidance moves it for a click and never
   brings it back.
9. **The permission prompt is a stock grey dialog** with a text box, in a
   different visual language from the bar. It is shown with
   `dialog.ShowDialog(this)`, which disables its owner, the bar, so the bar's
   Stop is probably dead while it is open. Esc and Ctrl+Alt+F12 still stop.
   This is read from the code and was not observed live.
10. **Three sizes disagree.** `control-contract.json` says 384 × 44,
    `DesktopVisuals` says 470 × 52, the Mac bar is 396 × 44.
11. **Text glyphs stand in for icons** when the glass helper is missing
    (`≡`, `Ⅱ`, `▶`, `■`, `×`).

### Problems with the glow

1. **It frames the monitor, not the app.** It says "something is happening on
   this screen", which the bar already says. It does not say where.
2. **It covers content.** The field reaches 82 DIPs inward at up to 60% alpha
   at the edge. A maximised app has its toolbar, scrollbar and status bar
   tinted.
3. **It is the same in every state it is shown**, and it breathes for the whole
   session. A 4 s loop on a full-monitor frame is constant peripheral motion
   with no information in it.
4. **Ice blue on a light app is close to invisible** (1.7:1 against white).

## 2. The idea

- The bar has two lines. Line one says who has the computer. Line two says
  what is happening or why.
- Each state has one filled button. It is the action most people need in that
  state.
- Stop keeps one slot in every state where the agent can act. Stopping ends
  the task; the bar confirms it for a few seconds and leaves.
- Access is asked once per request, in a prompt that hangs under the bar and
  lists every app with its tier.
- The glow means one thing: input can arrive in this window now. It sits
  outside the window, steady, and lifts briefly when an action lands.

## 3. State model

| Presentation | Line 1 | Line 2 | Primary | Secondary | Glow |
|---|---|---|---|---|---|
| Ready | Antigravity is ready | Not controlling anything | Hide (×) | Settings | none |
| Asking for access | Waiting for your answer | Allow or deny below · Esc stops | Allow, in the prompt | Deny, Stop, Settings | none, or amber line if a task is under way |
| Working | Antigravity is working | Clicking / Typing / Moving / Dragging / Scrolling / Reading the screen | Stop | Pause, Settings | line + field |
| Working, between actions | Antigravity is working | Waiting for the next step | Stop | Pause, Settings | line + field |
| Working, nearly out of time | Antigravity is working | *verb* · 1 min left | Stop | Pause, Settings | line + field |
| Paused | Paused · access kept | You pressed Pause | Resume | Stop, Settings | amber line |
| Paused, can't resume yet | Paused · can't resume yet | A key or button may still be held | Resume (tries again) | Stop, Settings | amber line |
| Stopped | Stopped · Antigravity ended its task | reason, see below | Hide (×) | Settings | none |
| Session ended | Session ended | The time limit ran out | Hide (×) | Settings | none |

Rules:

- **Line 1 never changes inside a state.** Only line 2 changes, and a verb is
  held for at least 1.2 s so the text does not flicker.
- **Stop is the filled button whenever the agent can act.** In Paused and in
  Asking for access it drops to an outlined button in the same slot.
- **Stopped is a confirmation, not a place to act.** Access is kept. It
  shows for 4 s, then the bar hides. If a new request arrives first, the bar
  goes to Working, or to Asking for access for an app not yet approved. There is nothing to undo and no button to restore
  control. The bar ignores clicks for 600 ms after a stop, so a second panic
  click lands on nothing.
- **Session ended** shows for 4 s, then the bar hides.
- **Pause** is only the bar's Pause button. The person's own mouse and
  keyboard never pause the agent. A pause keeps the approved access.
- **Resume** is pressed by the person. If input cleanup is not finished
  (`InputLedger.HasHeld`, live workers), the bar says so on line 2, shakes
  once, and stays paused. Pressing Resume again runs the same checks. Stop is
  live throughout.
- **Stopped with cleanup pending.** If held input cannot be released at once,
  line 2 reads "Still releasing a key or button" and the bar stays until
  cleanup is confirmed. New requests are refused until then.

### Line 2 reasons

| Source in `Guardian.cs` | State | Line 2 |
|---|---|---|
| toggle click | Paused | You pressed Pause |
| `requested_pause` | Paused | Antigravity paused itself |
| held input, live workers on resume | Paused, can't resume yet | A key or button may still be held |
| `button` | Stopped | You pressed Stop |
| `escape` | Stopped | You pressed Esc |
| `hotkey` | Stopped | You pressed Ctrl+Alt+F12 |
| `human_end`, `dismiss`, `request` | Stopped | The task was ended |
| `input_desktop_changed` | Stopped | The screen was locked or switched |
| `cursor_watchdog_failed`, `watchdog_unavailable` | Stopped | A safety check failed |
| `input_cleanup_failed` | Stopped | Still releasing a key or button |
| prompt denied or timed out | Stopped | You denied access *or* No answer in 90 s |

Two warnings stay off the bar because they need no action: "Custom pointer
unavailable" and "Could not save control preference".

### Access prompt

Title: **Allow Antigravity to use these apps?**
Sub-line: Until you start a new conversation

One row per app: the app's name, one sentence, and a tier tag.

| Tier | Applies to | Tag | Sentence |
|---|---|---|---|
| click | terminals and IDEs | Click only | Can see and click. Cannot type |
| full | everything else, browsers included | Full control | Can see, click and type |

- **Buttons:** Allow (filled) and Deny (outlined), both 104 × 44. Footer text:
  "No answer in 90 s counts as Deny".
- **Tier tag:** a word plus a two-step mark (one or two bars lit), so
  the tier does not rely on colour.
- **Placement:** the prompt hangs 8 px under the bar, same width, same surface,
  so the question and Stop are in one place. If the bar is docked at the
  bottom, the prompt sits above it.
- **Keyboard:** Enter does not choose Allow. Tab moves between Deny and Allow.
  Esc stops the task, as everywhere.
- **Stop stays live.** The prompt is not a modal child of the bar.
- **Deny or timeout** ends the request. The bar shows Stopped with the reason.
- **Scope:** an approval lasts for the agent's conversation. Esc and Stop
  do not revoke it. A later request for an app not yet approved shows a prompt with
  only the new apps.
- **Long lists:** up to five rows are shown; beyond that the list scrolls
  inside the prompt and the title gains the count ("these 7 apps").
- **Capture:** the prompt is always excluded from capture, as permission
  dialogs are today, whatever the recording preference is.
- **Unknown app name:** the row shows the executable's file name. A row is
  never blank.

The same card is the right shape for any other prompt the guardian still
shows (see "Open questions").

### Settings menu

| Today | Proposed |
|---|---|
| Keep working — Pause or Esc to interrupt | removed; this is now the only behaviour |
| Yield on input — deliberate input pauses | removed |
| Show glow and controls in screen recordings | **Show bar and glow in recordings** |
| Esc always stops immediately (disabled item) | footer: Esc or Ctrl Alt F12 stops at once. Your own mouse and keyboard don't pause it. |
| End session and hide | **End task and hide** |
| — | **Move bar** ▸ six dock positions, Reset (section 8) |

## 4. Layout, type, colour, spacing

All sizes are DIPs and scale with the monitor.

### Layout

- Bar: 496 × 56, radius 18, 1 px edge.
- Left to right: state mark 12 × 12, 12 gap, text block (flexible, the drag
  handle), Settings 44 × 44, hand-over slot (Pause 44 × 44, or a labelled
  Resume at 92 minimum × 44), Stop slot 92 × 44.
- 16 left padding, 6 right, 6 above and below the controls, 4 between controls.
- The Stop slot is 92 wide wherever there is something to stop. In Ready,
  Stopped and Session ended a 44 × 44 close mark sits where Stop's right edge
  was, and the freed width goes to the text.
- Prompt: 496 wide, radius 18, 16 padding, rows 56 minimum, buttons 104 × 44.
- Every target is at least 44 × 44. Rendered sizes were measured in the
  mockup: 44 × 44, 92 × 44, 102 × 44.
- No text is cut off in any state at 100% (measured).

### State mark

A shape, not only a colour, so it survives colour blindness and grey capture.

| State | Mark |
|---|---|
| Working | filled ice dot with a soft ring |
| Ready, Session ended | hollow grey ring |
| Paused | two amber bars |
| Asking for access | hollow amber ring |
| Stopped | filled rose square |

### Type

`Segoe UI Variable Text` on Windows, falling back through `Overlay.UiFont`.
The system font on macOS.

| Role | Size | Weight | Line height |
|---|---|---|---|
| Line 1, app name | 13 | Semibold | 18 |
| Line 2, row sentence, footer | 12 | Regular | 16 |
| Prompt title | 16 | Semibold | 22 |
| Button label | 13 | Semibold | — |
| Tier tag | 12 | Semibold | — |
| Menu item | 13 | Regular | 44 row |

### Colour

The bar and the prompt are always dark. They float over unknown content, and a
fixed dark surface gives known contrast in every case.

| Token | Value | Role | Contrast |
|---|---|---|---|
| `ink` | `#12161D` | bar and prompt surface | — |
| `ink-raised` | `#1C222C` | menu surface | — |
| `paper` | `#F2F5F8` | line 1, labels, filled button | 16.6:1 on ink |
| `mist` | `#A9B4C0` | line 2 | 8.6:1 on ink, 7.6:1 on ink-raised |
| icon rest | `#D5DCE4` | Settings and Pause icons | 13.1:1 on ink |
| `ice` | `#9BCDEB` | agent can act | 10.6:1 on ink |
| `amber` | `#F0B866` | paused, waiting on you | 10.1:1 on ink |
| `rose` | `#FF8FA0` | stopped | 8.4:1 on ink |
| `slate` | `#1B2735` | hairline beside glow lines | 15.1:1 on white |
| edge | white at 16% | bar, prompt and menu border | — |
| outline | paper at 40% | outlined button and tier tag border | 3.6:1 on ink (computed) |

`ice`, `amber` and `rose` come from today's `StateColor` and `accent_rgb`, so
the product keeps its colours. Filled button text is `ink` on `paper`, 16.6:1.

Ice and amber on white are 1.7:1 and 1.8:1. They are never used alone on app
content: the glow line always has a slate hairline on both sides (8.9:1 and
8.5:1 against the line, 15.1:1 against white).

### Spacing, radius, shadow

- Spacing scale: 4, 8, 12, 16, 24.
- Radius: 18 bar and prompt, 12 controls and menu, 8 menu rows, 7 tier tags.
- Shadow: the bar has none. The prompt and the menu each have one neutral drop
  shadow (0 12 28, black 34%). Nothing else has a shadow.

### Material

Flat `ink`. The LiquidGlass helper is no longer on the bar's path
(section 9).

## 5. The glow

### What it signals

One thing: **input can arrive in this window now.** The bar says who is in
control. The glow says where.

### Intensity by state

| State | Line | Field | Notes |
|---|---|---|---|
| Working | 2 px ice, slate hairline each side | soft, 22 px, 50% at the line falling to 0 | steady, no breathing |
| Action lands | lighter ice | 26 px, 72% | lifts over 100 ms, settles over 300 ms |
| Paused | 2 px amber, slate hairlines | none | access is kept, hands off |
| Asking for access | none, or the amber line of a task already under way | none | no app approved, no glow |
| Stopped, Ready, Ended | none | none | gone within 67 ms of Stop |

Click-only apps get the same glow as full-control apps.

### How it never obscures content

- It is drawn **outside** the window's visible frame
  (`DWMWA_EXTENDED_FRAME_BOUNDS`). Nothing inside the controlled window is
  tinted.
- The glow window is click-through, as today.
- It sits **directly above the target window in z-order**, not topmost. A
  window in front of the target covers the glow. The field can fall on
  whatever is behind the target, within 22 px of it, at 50% or less.
- If the target is maximised or full screen there is no outside. The glow
  moves to the monitor edge and shrinks to a 2 px line and a field that ends
  18 px in. Today's field is 82 px.
- If the target is minimised, cloaked or on another virtual desktop, no glow
  is drawn.
- The checks in `DesktopVisuals.Export` stay: centre alpha 0, falloff inward,
  never an opaque frame.

### Recordings

- Default: excluded from capture (`WDA_EXCLUDEFROMCAPTURE`), as today.
- With "Show bar and glow in recordings" on, a recorder sees both. Agent
  screenshots still hide them through `capture` / `capture_end`. No change.
- There is no breathing, so a recording has no pulsing border and compresses
  cleanly. The action lift is a short event tied to a real action.
- The line is 2 px with dark hairlines, so it survives downscaling to 720p.

### Phasing

- **Phase 1, no protocol change.** Keep the monitor-edge glow and slim it:
  depth 82 → 18, sigma 27 → 7, breathing removed, slate hairline, and the
  per-state rule above. This is the "maximised" picture in the mockup, used
  for every window. It is not a numbers-only change on Windows:
  `DesktopVisuals.Edge` hardcodes sigma, depth, core and both alphas, and only
  `MacGlowView` reads `edge_*` from the contract. `Edge` must read the
  contract, draw the hairline, and take a colour. `SetState` hides the overlay
  for every state except `active`, so the amber line in Paused needs that call
  changed to keep the ring up.
- **Phase 2, per-window glow.** The guardian does not know the target window
  today. The runtime already sends `{op:'activity', action}` before each
  action; add the target `hwnd` to it. The guardian accepts it only for a
  window of an approved app, then tracks that window's frame bounds on its
  existing timer. With several approved apps, the glow follows the last window
  that received an action.

## 6. Motion

Tokens: `fast` 100 ms, `normal` 200 ms, `slow` 300 ms. Entering eases out.
Leaving eases in and runs a third shorter. Moving on screen eases in-out.
Springs: `gentle` (critically damped, response 0.4 s) and `snappy` (damping
0.8, response 0.3 s). These live in one place per platform; components use
the names.

| Name | Job | Token |
|---|---|---|
| `bar.enter` | show that control has started | `normal`, ease-out; opacity, 8 px down |
| `bar.exit` | confirm the bar was dismissed | 133 ms, ease-in; reverse path |
| `bar.stateChange` | show the state changed without a jump | `normal`; mark and line 1 cross-fade, buttons cross-fade in place |
| `bar.verbChange` | show a new action | `fast` cross-fade of line 2 only |
| `bar.stop` | confirm Stop at once | none; the bar reads Stopped on the same frame |
| `button.press` | confirm the press on pointer-down | `fast`; scale 0.97 |
| `bar.refuse` | show that Resume was refused | `normal`; 4 px horizontal shake, once |
| `bar.stepAside` | show where the bar went when it yields to a click | `normal`, ease-in-out; position |
| `bar.return` | bring the bar home after the click | `slow`, ease-in-out; position |
| `bar.drag` | follow the pointer | none; 1:1 |
| `bar.settle` | land on a dock after release | `gentle` spring; `snappy` if released with speed |
| `prompt.open` | show the question belongs to the bar | `normal`, ease-out; opacity, scale 0.96 → 1 from the bar edge |
| `prompt.close` | confirm the answer was taken | 133 ms, ease-in; reverse path |
| `menu.open` | show the menu came from the Settings button | `normal`, ease-out; scale 0.96 → 1 from the button corner, opacity |
| `menu.close` | dismiss | 133 ms, ease-in |
| `glow.enter` | show which window is now controlled | `slow`, ease-out; opacity |
| `glow.exit` | show control left | `normal`, ease-in; opacity |
| `glow.stop` | Stop removes the glow | 67 ms, ease-in |
| `glow.action` | mark an action landing | `fast` up, `slow` down; opacity |
| `glow.hold` | show the agent's hands are off | `normal`; field fades, line cross-fades to amber |
| `glow.follow` | stay on a moving window | none; tracks 1:1 |

Rules:

- The one entrance moment is `bar.enter` followed by `glow.enter`, 40 ms
  apart.
- Everything is interruptible. Stop, Esc and the hotkey never wait for an
  animation. Buttons accept input during every transition.
- Only transform (position, scale) and opacity animate. No layout size
  changes during a transition. A colour change, such as ice to amber, is two
  layers cross-fading in opacity.
- `bar.stepAside` must finish **before** `avoid_input` is acknowledged, or the
  acknowledgement must report the final bounds. The click waits for the
  acknowledgement today; that order stays.

### Reduced motion

When Windows "Animation effects" is off (`DesktopVisuals.MotionEnabled`) or
macOS Reduce Motion is on:

- Movement becomes a 100 ms fade or an instant change. `bar.stepAside` and
  `bar.return` jump. `bar.settle` jumps to the dock. The prompt and menu fade
  without scaling.
- `bar.refuse` does not shake. Line 2 still changes to the reason.
- `glow.action` does not lift. The verb on line 2 still changes.
- All state feedback remains: text, mark shape, button set.

## 7. Accessibility

- **Targets:** all 44 × 44 or larger.
- **Contrast:** all text 7.6:1 or better; see the table in section 4.
- **Not colour alone:** each state has its own mark shape, its own line 1 and
  its own button set. Each tier has a word, a sentence and a step mark.
- **Names:** every control is a real native button with a name that says the
  action: "Stop computer use", "Pause computer use", "Resume computer use",
  "Hide controls", "Settings", "Allow", "Deny". The bar is a toolbar named
  "Antigravity computer use: *line 1*, *line 2*".
- **Prompt:** a dialog named by its title. Each row is read as "*app*, *tier*,
  *sentence*". The 90 s limit is in the accessible description.
- **Announcements:** a change of line 1 raises a live-region event (UIA
  `LiveSetting` polite; assertive for Stopped and for the prompt opening).
  Verb changes on line 2 are not announced.
- **Keyboard:** the bar never takes focus by itself (it stays
  `WS_EX_NOACTIVATE`). Esc and Ctrl+Alt+F12 stop from anywhere. The prompt
  takes focus when it opens, on Deny. Tab order in the bar is Settings,
  hand-over, Stop; a 2 px ice focus ring with 2 px offset.
- **Moving the bar without a mouse:** Settings ▸ Move bar lists the six docks.
- **High contrast:** in Windows contrast themes the bar and prompt use system
  colours (`Window`, `WindowText`, `Highlight`), a solid 2 px border and no
  glow field, only the line.
- **Reduced transparency:** already met; the surfaces are opaque.
- **Text scaling:** the bar scales with monitor DPI. With Windows text scaling
  above 100% the bar grows with the text; nothing is ellipsised before the bar
  reaches 640 wide.
- **Tooltips** repeat the name and the shortcut. They are not the only place
  any information lives.

## 8. Drag and reposition (#68)

- **Handle:** the mark and the text block. A press on a button never starts a
  drag.
- **Threshold:** 4 px of movement before the drag begins, so a click on the
  text does nothing.
- **Tracking:** 1:1 from the grab point, across monitors.
- **Clamp:** always fully inside the monitor work area, 12 px margin.
- **Docks:** six per monitor: top and bottom × left, centre, right. Within
  12 px of a dock the bar snaps to it. Elsewhere it stays where it was dropped.
- **Memory:** saved in `control-preferences.json` per monitor (device name and
  scale) as a dock name or a fraction of the work area. Default is top centre.
  A saved position that no longer fits is clamped; a missing monitor falls
  back to the default.
- **Avoidance:** `WindowGeometry.AvoidHud` works from the current position.
  The chosen position is "home". After the click that needed the space, the
  bar returns home (`bar.return`). Today it never returns.
- **Prompt:** an open prompt moves with the bar and flips above it near the
  bottom edge.
- **Safety:**
  - Only physical pointer input on the bar moves it. There is no agent
    operation that moves or hides it; `avoid_input` stays the only programmatic
    move and keeps its token and state checks.
  - Dragging does not change state, access or visibility.
  - Human input no longer pauses the agent, so a drag cannot cause a pause.
  - While the agent's own injected click is in flight, a drag cannot start.
  - Stop and Resume stay live while the bar is being dragged or is settling.
- **DPI:** `visualScale` and the form `Region` are set once in the `Guardian`
  constructor. Crossing to a monitor with another scale must recompute both
  and relayout the buttons.
- **Menu:** Settings ▸ Move bar offers the six docks and Reset.
- **macOS:** the same rules in `MacVisuals.swift` and `MacGuardian.swift`;
  `writeHudBounds` must be called after every move.

## 9. What changes in which file

No file is changed by this document. Latch and re-arm removal is listed only
where it touches what is drawn.

| File | Change |
|---|---|
| `server/control-contract.json` | One bar size (496 × 56) replacing three. Glow numbers, per-state glow rule, motion tokens, colour tokens. `breath_*` removed. Tier names and sentences. Windows reads the glow numbers only after the `Edge` change below. |
| `server/native/DesktopVisuals.cs` | `Hud` redrawn: two lines, state mark, slot layout, filled/outlined/icon buttons, new `HudWidth`/`HudHeight` and rects, a rect for the close mark. Takes line 2 and the presentation as input. Flat surface; icons drawn from the Phosphor path data, no text glyphs. A new `Prompt` painter for the access card. `Edge` reads `edge_*` from the contract instead of its hardcoded values, takes state, and draws line + hairlines + short field. `BreathLevel` removed. `Export` renders all nine presentations and the prompt over a dark and a light backdrop. |
| `server/native/Guardian.cs` | Keep the last reason and map it to line 2. Presentations "asking", "can't resume yet", "stopped" (4 s, then hide) and "session ended" (4 s). The toggle becomes Pause/Resume only and is the only way to pause; a refused resume sets the bar text as well as emitting `visual_warning`. 600 ms click guard after a stop. Hold verbs 1.2 s; map `observe` to "Reading the screen". Keep the ring visible in Paused. Replace the stock prompt form with the access card: app rows with tiers, Allow/Deny, 90 s timeout, not owned by the bar so the bar's Stop works by mouse. Drag handling, home position, return after avoidance, per-monitor preference, DPI change. Menu text and "Move bar". Accessible names and live region. |
| `server/native/Overlay.cs` | `RingForm`: per-state alpha and colour, `glow.action` lift, `glow.stop` at 67 ms, no breath timer. Phase 2: bounds from the target window, z-order above the target, not topmost. One shared motion-token table for `Animate`. `BannerForm` is unused in guardian mode and is not touched. |
| `server/native/WindowGeometry.cs` | `AvoidHud` candidates include the six docks; return the home position for the way back. Clamp helper for drag. |
| `server/native/TakeoverPolicy.cs`, `Presence.cs` | The takeover pause is removed. `Presence` keeps the Esc hook. The `takeover_mode` preference and its menu items go. On macOS the `.hud` takeover exemption is no longer needed. |
| `server/liquidglass-host/`, `LiquidGlassPackageClient.cs` | No longer used by the bar. Removing the helper from the bundle is a packaging change to schedule with a release. |
| `server/runtime.mjs` | Send one access request with the list of apps and their tiers. Phase 2: send the target `hwnd` with `activity`. `observe` is already sent. |
| `server/native/macos/MacVisuals.swift` | `statePresentation` gains line 2, the primary button and the new presentations. Bar 496 × 56, flat surface. Access card. `MacGlowView` per-state and without breathing. Drag, home, docks. |
| `server/native/macos/MacGuardian.swift` | Reasons to line 2. `.hud` bounds rewritten after every move. |
| `tests/hud-avoidance.test.mjs`, native geometry checks | New size, docks, return-home, drag clamp. |
| `tests/recording-visuals-live.mjs` | Unchanged behaviour; re-run. |
| `docs/visual-design.md`, `docs/HUD-AVOIDANCE.md`, `docs/STOP-UNCERTAINTY.md` | Updated once the changes ship. |

Suggested order: (1) glow phase 1; (2) bar redraw with reasons; (3) access
card and live Stop during it; (4) drag and home; (5) per-window glow;
(6) macOS.

## 10. Risks

- **Stop regression.** Any change near `Emergency` or `SetState` can break
  Stop. Physical Stop, Esc and the hotkey need a fresh human qualification;
  rendering checks do not cover them.
- **No latch.** Stopped is now a 4 s message. If a new agent request arrives
  inside that window the bar moves on, and the person may not have read why it
  stopped. The backstop is that the agent must report and wait after a Stop,
  and a new app still needs its own approval.
- **Stop with unfinished cleanup.** `STOP-UNCERTAINTY.md` describes evidence
  that today rides on the latch. What replaces it is not a design question,
  but the bar needs one honest line for it ("Still releasing a key or button")
  and must not hide while it is true.
- **Prompt fatigue.** Approvals survive Stop, so the prompt appears only for
  apps not yet approved in the conversation. Keep it to one prompt listing all
  apps, never one per app.
- **Tier wording.** "Click only" for a terminal or IDE will surprise people
  who expect the agent to type commands. The sentence on the row is the only
  explanation; it must be accurate to what the runtime enforces.
- **Prompt and bar as separate windows.** Making the bar live during a prompt
  changes window ownership and focus behaviour. It needs its own review
  against #43 and the consent rules. The prompt must stay excluded from
  capture and marked as an overlay window so the agent cannot click it.
- **Per-window glow.** A new field in `activity`, window tracking at timer
  rate, z-order handling, elevated or cloaked windows, virtual desktops,
  mixed DPI. Phase 1 avoids all of it and can ship alone.
- **Glow on neighbours.** The field can fall on a window behind the target.
  It is capped at 22 px and 50%.
- **Avoidance timing.** If `bar.stepAside` is animated, the acknowledgement
  must still describe where the bar ends up before the click is classified.
  The prompt, being larger, must also step aside or the click must wait.
- **Shared input.** The person and the agent can now use the mouse and
  keyboard at the same time. The bar must make Stop and Esc obvious, because
  they are the only ways to halt it. The menu footer says so in words.
- **Esc is also an app key.** Esc stops the agent and ends its task. A
  person pressing Esc for their own app during a task ends the task. Today's
  code already limits this to when the agent is active.
- **Wider bar.** 496 × 56 against 470 × 52 covers slightly more and steps
  aside slightly more often.
- **Reference departure.** `docs/visual-design.md` records a full-monitor
  breathing glow and a glass bar. Both are replaced, by owner decision.
- **Mockup is not the product.** It is HTML. GDI+ text rendering, layered
  window compositing, real DPI scaling and real capture exclusion are not
  proven by it.
- **Detector notes.** The design detector flags the coloured glow as a pattern
  to avoid. Here the glow is the feature being designed; it carries state and
  has a job. It also flags a `clip-path` in the mockup's placeholder photo,
  which is not product UI.

## 11. Decisions

Decided by the owner:

1. No breathing.
2. Per-window glow as phase 2; slim monitor-edge glow first.
3. Flat dark bar.
4. Stopped is a brief confirmation; the bar then hides. Approvals survive Stop.
5. No re-arm. Control words are "Stop" and "Resume".
6. Native change so the bar's Stop works by mouse during a prompt.
7. Six docks plus free placement.
8. Human mouse and keyboard never pause the agent. Pause is a bar button only.
9. Two tiers: click only for terminals and IDEs, full control for the rest.
10. Approval lasts for the conversation; Esc does not revoke it.

Open questions:

1. **Keep the Pause button?** The design keeps it, as the one way to hold the
   agent without losing access. Dropping it removes the Paused states and the
   amber glow line.
2. **Action-time prompts.** Today sensitive actions get their own prompt. If
   they stay, they use the same card with one row and the action in the title.
3. **Confirmation length.** 4 s for Stopped and Session ended.
