# Control bar and glow redesign

Design proposal only. No native code changes are part of this document. It was
written against `origin/main` at `743b042`.

Mockup: `.localdata/hud-redesign/mockup.html`, rendered to
`.localdata/hud-redesign/mockup-full.png` (ignored, local only). The mockup uses
two fictional apps and no captured desktop data.

Product context was taken from the code and the existing docs. There is no
`PRODUCT.md` or `DESIGN.md` in the repository, and no owner interview was held
for this proposal; the open choices are listed under "Owner decisions".

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
4. **Re-arm is an unlabelled play triangle.** It sits in the slot that held
   Pause a moment earlier. The word "re-arm" appears only in the status text
   and a tooltip.
5. **Stop turns into Hide in the same place with no guard.** A second panic
   click on Stop dismisses the bar.
6. **Refusals are silent.** When re-arm is refused (`rearmLocked`, held input,
   live workers, unconfirmed Stop, latch unreadable) the guardian emits a
   `visual_warning` on stdout. Nothing changes on screen. The person presses
   the triangle and nothing happens.
7. **The reason for a state is never shown.** `SetState` and `Emergency` carry
   a reason (`human_takeover`, `escape`, `input_desktop_changed`, …). The bar
   shows only "Paused" or "Stopped".
8. **The stopped bar leaves after 8 s** (`ShowControls(8000)`), taking the only
   re-arm control with it. Session expiry dismisses the bar with no message.
9. **The bar cannot be moved** (#68). Avoidance moves it for a click and never
   brings it back.
10. **During a permission prompt the bar's Stop button is dead.** The prompt is
    `dialog.ShowDialog(this)`, which disables the bar. Esc and Ctrl+Alt+F12
    still stop. This is a gap against "Stop must always be reachable" by mouse.
11. **Three sizes disagree.** `control-contract.json` says 384 × 44,
    `DesktopVisuals` says 470 × 52, the Mac bar is 396 × 44.
12. **Text glyphs stand in for icons** when the glass helper is missing
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
- Stop keeps one slot in every state. Once stopped, that slot holds only a
  close mark at its right edge, and the bar ignores clicks for 600 ms.
- The glow means one thing: input can arrive in this window now. It sits
  outside the window, steady, and lifts briefly when an action lands.

## 3. State model

The underlying states do not change: `idle`, `active`, `paused`, `stopped`.
The bar shows nine presentations of them. "New" marks behaviour that does not
exist today.

| Presentation | Underlying | Line 1 | Line 2 | Primary | Secondary | Glow |
|---|---|---|---|---|---|---|
| Ready | `idle`, controls shown | Antigravity is ready | Not controlling anything | Stop | Settings | none |
| Working | `active`, action in last 1.2 s | Antigravity is working | Clicking / Typing / Moving / Dragging / Scrolling / Reading the screen | Stop | Pause, Settings | line + field |
| Working, between actions | `active`, no action for 1.2 s | Antigravity is working | Waiting for the next step | Stop | Pause, Settings | line + field |
| Working, nearly out of time (new) | `active`, under 2 min left | Antigravity is working | *verb* · 1 min left | Stop | Pause, Settings | line + field |
| Paused | `paused` | Paused · you have control | reason, see below | Resume | Stop, Settings | amber line |
| Waiting for your answer (new) | `prompting` | Waiting for your answer | Answer in the permission window · Esc stops | in the dialog | Stop (needs native change, section 9) | amber line |
| Stopped | `stopped` | Stopped | reason · nothing can act | Re-arm | Hide (×), Settings | none |
| Can't re-arm yet (new) | `stopped` + a refusal | Can't re-arm yet | reason, see below | Check again | Hide (×), Settings | none |
| Session ended (new) | `idle` after expiry | Session ended | The time limit ran out · hides in 8 s | Hide (×) | Settings | none |

Rules:

- **Line 1 never changes inside a state.** Only line 2 changes, and a verb is
  held for at least 1.2 s so the text does not flicker.
- **Stop is the filled button whenever the agent can act.** In Paused it drops
  to an outlined button in the same slot and Resume is filled.
- **Re-arm is a labelled button** in the Resume slot, not in the Stop slot. It
  keeps every check it has today. Only a physical click on it re-arms.
- **Check again** re-runs the existing checks (`ControlFence.Recover`,
  `InputLedger.HasHeld`, `WorkersExited`, latch inspection). It cannot clear a
  lock by itself. If the checks still fail it stays in this state and line 2
  keeps the reason. Settlement rules in `STOP-UNCERTAINTY.md` are unchanged.
- **Waiting for your answer** exists only when the guardian shows its own
  prompt. It does not exist in host-managed mode.

### Line 2 reasons

Every reason the guardian already produces maps to one line of text.

| Source in `Guardian.cs` | State | Line 2 |
|---|---|---|
| `human_takeover` | Paused | You moved the mouse *or* You pressed a key |
| toggle click | Paused | You pressed Pause |
| `requested_pause` | Paused | Antigravity paused itself |
| `button` | Stopped | You pressed Stop · nothing can act |
| `escape` | Stopped | You pressed Esc · nothing can act |
| `hotkey` | Stopped | You pressed Ctrl+Alt+F12 · nothing can act |
| `human_end`, `dismiss`, `request` | Stopped | The session was ended · nothing can act |
| `persisted_emergency_stop` | Stopped | Stop is still on from earlier |
| `input_desktop_changed` | Stopped | The screen was locked or switched |
| `cursor_watchdog_failed`, `watchdog_unavailable` | Stopped | A safety check failed |
| `guard_persistence_failed` | Stopped | Could not save the stopped state |
| `rearmLocked` | Can't re-arm yet | The last task's cleanup is not confirmed |
| `input_cleanup_failed`, held input, live workers | Can't re-arm yet | A key or button may still be held |
| `guardian_stop_unconfirmed`, `.unconfirmed` marker | Can't re-arm yet | Stop was not confirmed |
| latch unreadable or undeletable | Can't re-arm yet | Could not read the stop record |
| deadline cannot be established | Can't re-arm yet | Could not start the session timer |

Two warnings stay off the bar because they need no action: "Custom pointer
unavailable" and "Could not save control preference".

### Settings menu

Same five functions as today, renamed for what they do.

| Today | Proposed |
|---|---|
| Keep working — Pause or Esc to interrupt | group "When you use the mouse or keyboard": **Let it keep working** |
| Yield on input — deliberate input pauses | same group: **Pause Antigravity** |
| Show glow and controls in screen recordings | **Show bar and glow in recordings** |
| Esc always stops immediately (disabled item) | footer: Esc or Ctrl Alt F12 stops at once |
| End session and hide | **End session** |
| — | **Move bar** ▸ six dock positions, Reset (section 8) |

## 4. Layout, type, colour, spacing

All sizes are DIPs and scale with the monitor.

### Layout

- Bar: 496 × 56, radius 18, 1 px edge.
- Left to right: state mark 12 × 12, 12 gap, text block (flexible, the drag
  handle), Settings 44 × 44, hand-over slot (Pause 44 × 44, or a labelled
  Resume / Re-arm / Check again at 92 minimum × 44), Stop slot 92 × 44.
- 16 left padding, 6 right, 6 above and below the controls, 4 between controls.
- The Stop slot is 92 wide in every state. When stopped it holds a 44 × 44
  close mark at its right edge; the left 48 is inert.
- Every target is at least 44 × 44. Rendered sizes were measured in the
  mockup: 44 × 44, 92 × 44, 102 × 44, 103 × 44.
- No text is cut off in any state at 100% (measured).

### State mark

A shape, not only a colour, so it survives colour blindness and grey capture.

| State | Mark |
|---|---|
| Working | filled ice dot with a soft ring |
| Ready, Session ended | hollow grey ring |
| Paused | two amber bars |
| Waiting | hollow amber ring |
| Stopped | filled rose square |
| Can't re-arm yet | hollow rose square |

### Type

`Segoe UI Variable Text` on Windows, falling back through `Overlay.UiFont`.
The system font on macOS.

| Role | Size | Weight | Line height |
|---|---|---|---|
| Line 1 | 13 | Semibold | 18 |
| Line 2 | 12 | Regular | 16 |
| Button label | 13 | Semibold | — |
| Menu item | 13 | Regular | 44 row |
| Menu group and footer | 12 | Regular | — |

### Colour

The bar is always dark. It floats over unknown content, and a fixed dark
surface gives known contrast in every case.

| Token | Value | Role | Contrast |
|---|---|---|---|
| `ink` | `#12161D` | bar surface | — |
| `ink-raised` | `#1C222C` | menu surface | — |
| `paper` | `#F2F5F8` | line 1, labels, filled button | 16.6:1 on ink |
| `mist` | `#A9B4C0` | line 2 | 8.6:1 on ink, 7.6:1 on ink-raised |
| icon rest | `#D5DCE4` | Settings and Pause icons | 13.1:1 on ink |
| `ice` | `#9BCDEB` | agent can act | 10.6:1 on ink |
| `amber` | `#F0B866` | you have control | 10.1:1 on ink |
| `rose` | `#FF8FA0` | stopped | 8.4:1 on ink |
| `slate` | `#1B2735` | hairline beside glow lines | 15.1:1 on white |
| edge | white at 16% | bar and menu border | — |
| outline | paper at 40% | outlined button border | about 3.6:1 on ink |

`ice`, `amber` and `rose` come from today's `StateColor` and `accent_rgb`, so
the product keeps its colours. Filled button text is `ink` on `paper`, 16.6:1.

Ice and amber on white are 1.7:1 and 1.8:1. They are never used alone on app
content: the glow line always has a slate hairline on both sides (8.9:1 and
8.5:1 against the line, 15.1:1 against white).

### Spacing, radius, shadow

- Spacing scale: 4, 8, 12, 16, 24.
- Radius: 18 bar, 12 controls and menu, 8 menu rows.
- Shadow: the bar has none. The menu has one neutral drop shadow
  (0 12 28, black 34%). Nothing else has a shadow.

### Material

The mockup uses a flat ink surface. The current glass helper renders a
caller-owned dark backdrop, not live refraction (`LIQUIDGLASS-WINDOWS.md`), so
the visible difference is small. Whether to keep LiquidGlass as the surface
material is an owner decision; see section 9 for what each choice costs.

## 5. The glow

### What it signals

One thing: **input can arrive in this window now.** The bar says who is in
control. The glow says where.

### Intensity by state

| State | Line | Field | Notes |
|---|---|---|---|
| Working | 2 px ice, slate hairline each side | soft, 22 px, 50% at the line falling to 0 | steady, no breathing |
| Action lands | lighter ice | 26 px, 72% | lifts over 100 ms, settles over 300 ms |
| Paused, Waiting | 2 px amber, slate hairlines | none | shows where the session is attached, hands off |
| Stopped, Ready, Ended | none | none | gone within 67 ms of Stop |

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
- The glow has no slow breathing, so a recording has no pulsing border and
  compresses cleanly. The action lift is a short event tied to a real action,
  which is what a viewer wants to see.
- The line is 2 px with dark hairlines, so it survives downscaling to 720p.

### Phasing

- **Phase 1, no protocol change.** Keep the monitor-edge glow and change its
  numbers in `control-contract.json`: `edge_depth` 82 → 18, `edge_sigma`
  27 → 7, add the slate hairline, `breath_amplitude` → 0, add the per-state
  rule above. This is the "maximised" picture in the mockup, used for every
  window.
- **Phase 2, per-window glow.** The guardian does not know the target window
  today. The runtime already sends `{op:'activity', action}` before each
  action; add the target `hwnd` to it. The guardian accepts it only if
  `ControlFence.Identity(hwnd).key` is in `grants`, then tracks that window's
  frame bounds on its existing timer. With several granted apps, the glow
  follows the last window that received an action.

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
| `bar.stop` | confirm Stop at once | none; the bar is in Stopped on the same frame |
| `button.press` | confirm the press on pointer-down | `fast`; scale 0.97 |
| `bar.refuse` | show that re-arm was refused | `normal`; 4 px horizontal shake, once |
| `bar.stepAside` | show where the bar went when it yields to a click | `normal`, ease-in-out; position |
| `bar.return` | bring the bar home after the click | `slow`, ease-in-out; position |
| `bar.drag` | follow the pointer | none; 1:1 |
| `bar.settle` | land on a dock after release | `gentle` spring; `snappy` if released with speed |
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
- Only opacity and position animate. Nothing resizes during a transition.
- `bar.stepAside` must finish **before** `avoid_input` is acknowledged, or the
  acknowledgement must report the final bounds. The click waits for the
  acknowledgement today; that order stays.
- Today's breathing is removed. If the owner wants it back, it must stay under
  10% amplitude and off the field (see "Owner decisions").

### Reduced motion

When Windows "Animation effects" is off (`DesktopVisuals.MotionEnabled`) or
macOS Reduce Motion is on:

- Movement becomes a 100 ms fade or an instant change. `bar.stepAside` and
  `bar.return` jump. `bar.settle` jumps to the dock.
- `bar.refuse` does not shake. Line 2 still changes to the reason.
- `glow.action` does not lift. The verb on line 2 still changes.
- All state feedback remains: text, mark shape, button set.

## 7. Accessibility

- **Targets:** all 44 × 44 or larger.
- **Contrast:** all text 7.6:1 or better; see the table in section 4.
- **Not colour alone:** each state has its own mark shape, its own line 1 and
  its own button set.
- **Names:** every control is a real native button with a name that says the
  action: "Stop computer use", "Pause computer use", "Resume computer use",
  "Re-arm computer use", "Check again", "Hide controls", "Settings". The bar
  is a toolbar named "Antigravity computer use: *line 1*, *line 2*".
- **Announcements:** a change of line 1 raises a live-region event (UIA
  `LiveSetting` polite; assertive for Stopped). Verb changes on line 2 are not
  announced.
- **Keyboard:** the bar never takes focus by itself (it stays
  `WS_EX_NOACTIVATE`). Esc and Ctrl+Alt+F12 stop from anywhere. When the bar
  is focused through UIA or the menu, Tab order is Settings, hand-over, Stop;
  a 2 px ice focus ring with 2 px offset.
- **Moving the bar without a mouse:** Settings ▸ Move bar lists the six docks.
- **High contrast:** in Windows contrast themes the bar uses system colours
  (`Window`, `WindowText`, `Highlight`), a solid 2 px border and no glow field,
  only the line.
- **Reduced transparency:** already met; the bar surface is opaque.
- **Text scaling:** the bar scales with monitor DPI. With Windows text scaling
  above 100% the bar grows in height and width with the text; nothing is
  ellipsised before the bar reaches 640 wide.
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
- **Safety:**
  - Only physical pointer input on the bar moves it. There is no agent
    operation that moves or hides it; `avoid_input` stays the only programmatic
    move and keeps its token and state checks.
  - Dragging does not change state, grants, the latch or visibility.
  - Dragging the bar must not count as takeover input. Smart takeover pauses
    on deliberate movement and on any click; a press or drag that starts on
    the bar is exempt, as the Mac bar's `.hud` bounds already are.
  - While the agent's own injected click is in flight, a drag cannot start.
  - Stop, Resume and Re-arm stay live while the bar is being dragged or is
    settling.
- **DPI:** `visualScale` and the form `Region` are set once in the `Guardian`
  constructor. Crossing to a monitor with another scale must recompute both
  and relayout the buttons.
- **Menu:** Settings ▸ Move bar offers the six docks and Reset.
- **macOS:** the same rules in `MacVisuals.swift` and `MacGuardian.swift`;
  `writeHudBounds` must be called after every move.

## 9. What changes in which file

No file is changed by this document.

| File | Change |
|---|---|
| `server/control-contract.json` | One bar size (496 × 56) replacing three. New glow numbers, per-state glow rule, motion tokens, colour tokens. `breath_*` retired or zeroed. |
| `server/native/DesktopVisuals.cs` | `Hud` redrawn: two lines, state mark, slot layout, filled/outlined/icon buttons, new `HudWidth`/`HudHeight` and rects, a fourth rect for the close mark. Takes line 2 and the presentation as input. Icons drawn from the Phosphor path data, no text glyphs. `Edge` takes state and draws line + hairlines + short field. `BreathLevel` removed or flattened. `Export` renders all nine presentations over a dark and a light backdrop. |
| `server/native/Guardian.cs` | Keep the last reason and map it to line 2. Add the presentations "can't re-arm yet", "waiting" and "session ended". Refusals in the toggle handler set the bar text as well as emitting `visual_warning`. 600 ms click guard after entering `stopped`. Hold verbs 1.2 s. Stopped bar no longer auto-hides (owner decision). Expiry shows "Session ended" for 8 s. Drag handling, home position, return after avoidance, per-monitor preference, DPI change. Menu text and "Move bar". Accessible names and live region. Show the permission prompt without disabling the bar, so Stop works by mouse during a prompt. |
| `server/native/Overlay.cs` | `RingForm`: per-state alpha and colour, `glow.action` lift, `glow.stop` at 67 ms, no breath timer. Phase 2: bounds from the target window, z-order above the target, not topmost. One shared motion-token table for `Animate`. `BannerForm` is unused in guardian mode and is not touched. |
| `server/native/WindowGeometry.cs` | `AvoidHud` candidates include the six docks; return the home position for the way back. Clamp helper for drag. |
| `server/native/TakeoverPolicy.cs`, `Presence.cs` | Ignore input that starts on the bar. |
| `server/liquidglass-host/Program.cs`, `LiquidGlassPackageClient.cs` | The helper bakes three icons into the surface at fixed coordinates. Either the helper renders the surface only and `DesktopVisuals` draws the icons, or the helper is retired with the flat surface (owner decision). |
| `server/runtime.mjs` | Phase 2: send the target `hwnd` with `activity`. Send `observe` so line 2 can say "Reading the screen". Nothing else. |
| `server/native/macos/MacVisuals.swift` | `statePresentation` gains line 2, the primary button and the new presentations. Bar 496 × 56. `MacGlowView` per-state and without breathing. Drag, home, docks. |
| `server/native/macos/MacGuardian.swift` | Reasons to line 2. `.hud` bounds rewritten after every move. |
| `tests/hud-avoidance.test.mjs`, native geometry checks | New size, docks, return-home, drag clamp. |
| `tests/recording-visuals-live.mjs` | Unchanged behaviour; re-run. |
| `docs/visual-design.md`, `docs/HUD-AVOIDANCE.md` | Updated once the change ships. |

Suggested order: (1) contract numbers and glow phase 1; (2) bar redraw with
reasons and refusals; (3) drag and home; (4) prompt fix; (5) per-window glow;
(6) macOS.

## 10. Risks

- **Stop regression.** Any change near `Emergency`, `SetState` or the toggle
  handler can break Stop or human-only re-arm. The redraw must not touch the
  latch logic. Physical Stop, Esc, hotkey and re-arm need a fresh human
  qualification; rendering checks do not cover them.
- **Re-arm is now a labelled, filled button.** It is easier to find, so easier
  to press without thought. It still clears only a confirmed Stop, and the
  600 ms guard blocks a double click that began on Stop. Owner may prefer it
  outlined.
- **Stopped bar that stays.** Honest, but it stays on screen until hidden.
  Fallback: keep the 8 s auto-hide.
- **Modeless permission prompt.** Making the bar live during a prompt changes
  the prompt's window ownership and focus behaviour. It needs its own review
  against #43 and the consent rules.
- **Per-window glow.** A new field in `activity`, window tracking at timer
  rate, z-order handling, elevated or cloaked windows, virtual desktops,
  mixed DPI. Phase 1 avoids all of it and can ship alone.
- **Glow on neighbours.** The field can fall on a window behind the target.
  It is capped at 22 px and 50%.
- **Avoidance timing.** If `bar.stepAside` is animated, the acknowledgement
  must still describe where the bar ends up before the click is classified.
- **Drag and takeover.** If the exemption is wrong in either direction, a drag
  pauses the agent, or real takeover input near the bar is ignored. Keep the
  exemption to presses that start on the bar.
- **Wider bar.** 496 × 56 against 470 × 52 covers slightly more and steps
  aside slightly more often.
- **Reference departure.** `docs/visual-design.md` records the owner's
  reference: a full-monitor ice glow that breathes on a 5.2 s cycle, and a
  glass bar. This proposal drops the breathing, shrinks the frame and flattens
  the bar. That is the owner's call.
- **Mockup is not the product.** It is HTML. GDI+ text rendering, layered
  window compositing, real DPI scaling and real capture exclusion are not
  proven by it.
- **Detector notes.** The design detector flags the coloured glow as a pattern
  to avoid. Here the glow is the feature being designed; it carries state and
  has a job. It also flags a `clip-path` in the mockup's placeholder photo,
  which is not product UI.

## 11. Owner decisions

1. **Breathing.** Drop it (recommended), or keep a faint version on the line
   only.
2. **Glow scope.** Per-window glow in phase 2 (recommended), or stay with the
   slim monitor-edge glow.
3. **Material.** Flat ink bar (recommended, removes a helper process from the
   bar path), or keep LiquidGlass as the surface with icons drawn natively.
4. **Stopped bar lifetime.** Stays until hidden or re-armed (recommended), or
   keep the 8 s auto-hide.
5. **Re-arm weight.** Filled (recommended, one primary per state), or
   outlined.
6. **Wording.** Keep "Re-arm", or change to "Allow control again".
7. **Permission prompt.** Approve the native change that keeps the bar's Stop
   live during a prompt, or accept Esc and the hotkey as the only stops there.
8. **Dock model.** Six docks plus free placement (recommended), or docks only.
