# Native desktop control presentation

This describes what the Windows runtime draws while the agent controls the desktop: the edge glow, the control bar, its Settings menu, the access prompt and the pointer. The full specification, with rationale, is `docs/internal/HUD-REDESIGN.md`. No vendor artwork, cursor resources or private code was copied.

## One place for the values

Every colour, size and duration lives in `server/native/DesktopVisuals.cs`. The windows in `Guardian.cs` and `Overlay.cs` use those names and hold no raw durations or easings.

| Token | Value | Used for |
|---|---|---|
| `Fast` | 100 ms | hover, toggle |
| `Normal` | 200 ms | appear, state change |
| `Slow` | 300 ms | the glow's entrance |
| `FastLeave`, `NormalLeave` | 67 ms, 133 ms | leaving; Stop uses the fast one |
| `Press`, `PressScale` | 160 ms, 0.97 | a press landing |
| `EaseOut`, `EaseInOut` | cubic-bezier(.23,1,.32,1), (.77,0,.175,1) | entering and leaving; moving |
| `SpringSeconds`, `SpringBounce` | 0.45 s, 0.15 | the bar settling after a drag |

When Windows' animation preference is off, movement becomes an instant change or a short fade. The feedback itself stays.

## Edge glow

The glow marks the window the agent is working in. It is drawn by `Glow.cs` as soft strips around that window's edge, with a transparent centre and no hard border.

- One palette for every app: blue with a touch of violet.
- It is thick and never static. Thickness, spill and colour drift slowly along the edge from smooth noise, and the colours travel one lap in 60 seconds.
- It fades to nothing with no visible rectangle or steps.
- Brightness is a setting in the menu: Soft (the default), Medium or Bright.
- The brightest part eases towards the point of the agent's last action. That is the only response to an action.
- It enters by fading in while the band widens. It fades out and back in when the window jumps, is minimised or the target changes.
- At rest it redraws 15 times a second. Transitions redraw every 16 ms.
- It is hidden for the runtime's own screenshots and excluded from capture when Windows supports that, unless the owner turns on "Show bar and glow in recordings".

## Control bar

A 440 by 48 pill on the ink surface, always dark. Two lines of text: the first says the state and takes the state's colour, the second gives the reason or the hint. There are no state dots. Stop and Settings are real buttons, 44 by 44, with names and tooltips for screen readers, and each has hover and pressed states. The bar never takes keyboard focus. It can be dragged; it resists at the screen edge and settles to its dock with the spring.

## Settings menu

A raised panel 312 wide with a 12 radius, one neutral drop shadow and a hairline edge. It hangs 8 px under the bar, or above it when the bar is docked low. Rows are 44 high with a hover and a pressed plate. It opens with opacity and a scale from 0.96 at the Settings corner, closes in reverse, and a page change moves the height while the rows cross-fade. The footer repeats how to stop.

## Access prompt

The prompt asks before the agent may use an application, perform a sensitive operation or launch a program.

- It is a card on the bar's surface: 496 wide, 18 radius, the same shadow and hairline as the menu. It hangs 8 px under the bar and is centred on it, sits above a bar docked low, and is centred on the screen when the bar is not shown.
- The first line of the request is the title. The rest is shown whole under it; when it is longer than 300 px it scrolls and nothing is cut.
- Allow is filled and Deny is outlined, both 104 by 44, with hover, pressed and focus states. The note beside them says that no answer in 90 seconds counts as Deny.
- It is a modal dialog with a real text box and real buttons, so focus, the keyboard and screen readers work as in any dialog. Deny holds the focus when it opens, and Enter and Esc mean Deny.
- The title strip drags it, so it can be moved off whatever it covers.
- It appears and disappears at once. A dialog that holds live controls cannot be scaled, so `prompt.open` and `prompt.close` in the specification are not implemented.
- It is always excluded from capture and marked as an overlay window, so the agent can neither see nor click it.
- In a Windows contrast theme it uses the system colours.

The specification's per-application rows and tier tags are not built. They need the request as structured data instead of one text message.

## Pointer

The agent's pointer carries a small glow that follows it, and a brief ripple marks each click.

## Reviewing without a desktop session

`--visual-preview <directory>` exports the same drawing code to pictures: the glow at several scales and on light and dark, the bar in every state, the menu and its page change, the access prompt, and the pointer. It also checks the glow's alpha and times one frame. `--glow-trial <hwnd> <seconds>` lights one real window and reports frame times and processor share. `--prompt-trial <seconds> <kind>` shows a sample prompt that screenshots can see.

Pictures prove the drawing, not the feel. Motion, a second monitor, mixed scaling and a real Antigravity task each need a person at the machine.
