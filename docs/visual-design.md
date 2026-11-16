# Native desktop control presentation

This describes what the Windows runtime draws while the agent controls the desktop: the edge glow, the control bar, its Settings menu, the access prompt and the pointer. The full specification, with rationale, is `docs/internal/HUD-REDESIGN.md`. No vendor artwork, cursor resources or private code was copied.

## One place for the values

Every colour, size and duration lives in `server/native/DesktopVisuals.cs`. The windows in `Guardian.cs` and `Overlay.cs` take their motion from those names.

| Token | Value | Used for |
|---|---|---|
| `Fast` | 100 ms | hover, toggle |
| `Normal` | 200 ms | appear, state change |
| `Slow` | 300 ms | the glow's entrance |
| `FastLeave`, `NormalLeave` | 67 ms, 133 ms | leaving; Stop uses the fast one |
| `Press`, `PressScale` | 160 ms, 0.97 | a press landing |
| `EaseOut`, `EaseInOut` | cubic-bezier(.23,1,.32,1), (.77,0,.175,1) | entering and leaving; moving |
| `SpringSeconds`, `SpringBounce` | 0.45 s, 0.15 | the gentle spring |
| `BarBody.FlingSpeed`, `BarBody.Glide` | 900 DIP/s, 0.4 s | a throw: how fast counts as one, and how long its speed takes to fade |

The bar's drag and throw physics (`BarBody.cs`) are adapted from the liquidglass Calm tab-bar selector (Apache-2.0):
- Closed-form springs: mass 1, stiffness ω², damping 2ζω.
- The settling spring is critical, ω 24.
- While held, speed drives the stretch: drive ω 10, shape ω 32, ζ 0.72, reference 8 slots/s, gain 0.6. Scrubbing back and forth is suppressed.
- A throw into a screen edge lands on two edges. The leading edge stops at the wall, and the trailing edge swings in (ω 9, ζ 0.3, stiffening 0.5), then recovers (ω 13).

Departures for a 440 by 48 bar on a whole screen:
- **A throw glides.** The library's landing spring is made for a hop of a tab or two; across a screen it would snap. A release at 900 DIP/s or more keeps its own speed, fading over 0.4 s. It lands on two edges only if it reaches a screen edge still faster than 0.6 of its width a second. Where it stops, a dock within 12 px takes it.
- The trailing edge keeps its real impact speed (the library keeps 0.1 of it as the lead reaches its rest, which here is the moment of handover), so the squash scales with how hard the bar hits.
- A slot is 96 DIP.
- The stretch is capped at 0.2 (the library allows 0.336). Each axis is driven by its own speed, with no shear term, so a long bar never tilts.
- An edge stays between 0.6 of its length and its full length, and no stretch draws the bar past the screen's edge.
- The wall is the work area's edge, so the dock's inset is all the give.

While the bar moves, a click-through window draws it from one cached picture, at one fixed size for the gesture and at whole pixels, so the text never shimmers. The bar window stays in place, invisible at alpha 1, so clicks still land on it. Frames come from one 15 ms timer (16 would fire on every other 15.6 ms system tick), and the process asks for the fine system timer only while the bar moves.

When Windows' animation preference is off, movement becomes an instant change or a short fade. The feedback itself stays.

## Edge glow

The glow marks the window the agent is working in. It is drawn by `Glow.cs` as soft strips around that window's edge, with a transparent centre and no hard border.

- One palette for every app: blue with a touch of violet.
- It is thick and never static. Thickness, spill and colour drift slowly along the edge from smooth noise, and the colours travel one lap in 60 seconds.
- It fades to nothing with no visible rectangle or steps.
- Brightness is a setting in the menu: Soft (the default), Medium or Bright.
- The brightest part eases towards the point of the agent's last action: the real pointer after a physical action, or the screen point the action reports (`point: [x, y]` in the activity message) when the pointer did not move. That is the only response to an action.
- It enters by fading in while the band widens. It fades out and back in when the window jumps, is minimised or the target changes.
- At rest it redraws 15 times a second. Transitions redraw every 16 ms.
- It is hidden for the runtime's own screenshots and excluded from capture when Windows supports that, unless the owner turns on "Show bar and glow in recordings".

## Control bar

A 440 by 48 pill on the ink surface, always dark. Two lines of text: the first says the state and takes the state's colour, the second gives the reason or the hint. There are no state dots. Stop and Settings are real buttons, 44 by 44, with names and tooltips for screen readers, and each has hover and pressed states. The bar never takes keyboard focus. It can be dragged and it resists at the screen edge. Put down slowly, it stays where it is, lands on a dock within 12 px of one, and eases back inside if it was dropped past the edge. Thrown, it glides on with its own speed until that fades. If it reaches a screen edge still moving fast, it squashes against that edge and swings back out to its shape; if it stops near a dock, it lands on it. While held, it stretches along the direction it moves, more the faster it goes. While it moves, it is drawn in its moving shape in a click-through window; the bar itself stays in place for clicks.

## Settings menu

A raised panel 312 wide with a 12 radius, one neutral drop shadow and a hairline edge. It hangs 8 px under the bar, or above it when the bar is docked low. Rows are 44 high with a hover and a pressed plate. It opens with opacity and a scale from 0.96 at the Settings corner, closes in reverse, and a page change moves the height while the rows cross-fade. A row that can carry a tick keeps its text at the left when unticked; when its tick changes, the tick fades and the text slides 30 px over 200 ms, easing in and out (instant with reduced motion), as on macOS. The footer repeats how to stop.

## Access prompt

The prompt asks before the agent may use an application, perform a sensitive operation or launch a program.

- It is a card on the bar's surface: 496 wide, 18 radius, the same shadow and hairline as the menu. It hangs 8 px under the bar and is centred on it, sits above a bar docked low, and is centred on the screen when the bar is not shown.
- A request to use an app shows a row: the app's name, one sentence on what the tier allows, and a tier tag ("Full control" or "Click only", a word plus a two-step mark so the tier does not rest on colour). The line under the heading says how long the approval lasts: "Until you start a new conversation", or "For this task" when the agent passed no conversation handle. The name and path come from the guardian's own look at the window and the tag from the tier it grants. The path, the process number, the task and the notice follow as text.
- Every other request, and an app request without `card: 1` or with a tier that has no row, is a text card: the first line is the title and the rest is shown whole under it.
- Text longer than 300 px scrolls and nothing is cut.
- Allow is filled and Deny is outlined, both 104 by 44, with hover, pressed and focus states. The note beside them says that no answer in 90 seconds counts as Deny.
- It is a modal dialog with a real text box and real buttons, so focus, the keyboard and screen readers work as in any dialog. Deny holds the focus when it opens, and Enter and Esc mean Deny.
- The title strip drags it, so it can be moved off whatever it covers.
- It appears and disappears at once. A dialog that holds live controls cannot be scaled, so `prompt.open` and `prompt.close` in the specification are not implemented.
- It is always excluded from capture and marked as an overlay window, so the agent can neither see nor click it.
- In a Windows contrast theme it uses the system colours.

The runtime approves one app per request, so a card has one row. The specification's list of several apps under one confirm is not built; it needs the agent to name its apps before it starts.

## Pointer

The agent's pointer carries a small glow that follows it, and a brief ripple marks each click.

## Reviewing without a desktop session

`--visual-preview <directory>` exports the same drawing code to pictures: the glow at several scales and on light and dark, the bar in every state, the menu and its page change, the access prompt, and the pointer. It also checks the glow's alpha and times one frame. `--glow-trial <hwnd> <seconds>` lights one real window and reports frame times and processor share. `--prompt-trial <seconds> <kind> [top|bottom|corner]` shows a sample prompt that screenshots can see, alone or against a bar docked there; kinds 0 to 2 are the text cards and 3 and 4 are the app row at full control and click only.

Pictures prove the drawing, not the feel. Motion, a second monitor, mixed scaling and a real Antigravity task each need a person at the machine.
