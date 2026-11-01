# Own-HUD avoidance candidate

This source change is not in published beta.4. It addresses the physical-click
refusal recorded in [#33](https://github.com/shayann07/antigravity-computer-use/issues/33).

The runtime derives a target region from the consumed observation's native
element bounds, or from its existing screenshot-to-desktop coordinate mapping.
Only a native worker advertising `hud_avoidance` uses the extra handshake.
The independent Windows guardian accepts its private `avoid_input` request only
while active and with the current session token. It relocates its own visible
bar to the closest free docking position inside the same monitor's work area.
It never hides another overlay, makes a foreign window click-through, switches
desktops, grants an app, resumes a pause or clears Stop.

Small controls use their full observed rectangle. Large controls use their
center, and pixel targets use the already validated mapped point. The native
click checks remain authoritative if layout changes after the observation.

Positioning is acknowledged before native risk classification so pixel previews
inspect the application instead of a HUD button. It is checked again inside the
input lease after any sensitive prompt. Stop, cancellation, expiry, failed or
unknown acknowledgement prevents app input. The native physical click retains
its target identity and topmost-window checks before and after pointer travel.
Other controllers' overlays still produce a refusal.

Automated scope: native geometry checks include top-center overlap, unchanged
placement, negative monitor origins, no-room refusal and undersized work areas.
Runtime tests check handshake order, denied/unknown delivery, Stop races,
session expiry, semantic-only clicks, old-helper compatibility, large controls
and scaled pixel targets with negative origins. The Windows native helper
compiles. These tests do not prove the live guardian moved correctly.

Before a release includes this change, qualify on the actual desktop:

1. Use a private, supported installation and ensure no other agent owns input.
2. Record the exact source/build and guardian identity. Open stable Upscaly and
   reproduce a top-center media-close target under the bar.
3. Verify the own bar moves before the physical pointer click, remains visible,
   and the intended media control receives exactly one click.
4. Put an unrelated controller's banner over the target and verify refusal,
   with no click and no later batch steps executed.
5. Verify a sensitive target still obtains its required approval after the move.
6. Physically press Esc during a moving/queued action; verify Stop, held-input
   cleanup, skipped work and persistence. Human re-arm must remain human-only.
7. End, verify restored cursor/hidden visuals, then complete a second task.

Keep all captures and receipts under ignored `.localdata/`. Do not replace the
user's published installation with this source candidate solely to obtain a
test screenshot. Record unavailable desktop or hardware checks as pending.
