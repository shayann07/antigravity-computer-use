# Window recovery

- `point_off_desktop`: no pointer travel/button press was sent for that unreachable endpoint. Use explicit `fit_window` on the approved top-level app, inspect its fresh state and choose a reachable point. It restores/fits the nearest physical work area without changing desktops, clears old frames, and reports if an app minimum size still prevents full visibility. Do not clamp a bad coordinate onto another app or use Windows-key recovery.

- Foreground/occlusion refusal (`window_minimized`, `window_hidden`, `window_capture_unavailable`): follow `next_action` (`focus_target_then_observe`) for at most one bounded `focus` recovery attempt, then take a fresh observation. If `repeated_failure:true` or `recovery_attempts_remaining:0` (`await_human_window_recovery`) is returned, stop polling that window handle and ask the human to bring the window onto the visible desktop. Never relax identity or occlusion checks.

- Cross-Space or macOS full-screen refusal (`other_desktop` / `await_human_space_switch`, `window_fullscreen` / `await_human_fullscreen_exit`): macOS cannot safely capture or send verified physical input across Mission Control Spaces or into a separate full-screen Space without switching the user's active Space. Do not poll `snapshot`, `focus`, or `fit_window` repeatedly; ask the human once to move the window to the current Space or exit full-screen mode.

- Stale window handle or changed process identity (`identity_changed` / `discover_apps_then_observe`): run `apps` once to discover current window handles; never poll a stale `hwnd`.

- Missing macOS TCC permission (`mac_permissions_required` / `accessibility_denied` / `await_human_permission_grant`): stop and ask the human to grant the required permission in System Settings > Privacy & Security.

- UI still transitioning: re-observe before deciding an input failed. Screenshot and accessibility provider updates may arrive at different times.
