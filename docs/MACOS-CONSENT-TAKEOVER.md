# Native confirmation and Smart takeover

Issue [#43](https://github.com/shayann07/antigravity-computer-use/issues/43)
is a source-observed regression. Standalone confirmation hides the HUD, while
the independent monitor exempted only its old rectangle. A real Allow/Deny
click could therefore pause control, and prompt completion could overwrite
that pause with the guardian's older active state. Hardware reproduction and
qualification are still required; this record does not claim an observed bypass.

The repair candidate uses the watchdog's birth-time-bound guardian identity
and Apple's public
[`kAXFocusedWindowAttribute`](https://developer.apple.com/documentation/applicationservices/kaxfocusedwindowattribute)
and [`kAXModalAttribute`](https://developer.apple.com/documentation/applicationservices/kaxmodalattribute).
Pointer interaction is
exempt only when the native modal's bounds match the first visible window at
that point and its owner is the guardian. Foreign covers, missing AX data or
uncertain ownership retain ordinary takeover behavior. Keyboard exemption also
requires that the guardian is the foreground application. The old HUD mouse
rectangle cannot exempt keyboard activity in another application. Physical
Escape and Ctrl+Alt+F12 are handled before any UI exemption.

Approval publication and deliberate takeover share a separate private kernel
transition lock. It is independent of the held-input lock: a takeover must
revoke an active drag before waiting for its input cleanup. The approval is
bound to the pre-dialog native session, state, grants and both deadlines.
Pause, Stop, expiration, changed session or cleanup uncertainty prevents
publication. Stop writes its latch independently and is checked again before
returning an approval. No desktop protocol flag creates this exemption,
approval or resume authority. Existing host-managed policy remains unchanged.
Before showing standalone consent, the guardian also releases its hidden-cursor
ownership: hiding the custom pointer alone would leave the human with no visible
cursor throughout the modal decision. Normal capture restoration reapplies the
custom cursor only if active control is still valid and requested.

Native contracts exercise changed/expired/latched approval refusal, a real
takeover state transition while the input lock is held, preserved pause and
cleanup state after stale approval, and covering-window geometry. These
contracts do not click a consent dialog, grant an app or send desktop input.

Required physical Mac acceptance on the exact candidate:

1. In standalone Smart mode, approve the first app, then request an additional
   app and a harmless sensitive action during an active task. Actual Allow
   clicks and keyboard confirmation must not create an unwanted pause loop.
   Verify the normal OS cursor is visible during consent and cursor ownership
   is balanced afterward, including Deny, timeout and Stop.
2. Deny and time out confirmations. No later task step may execute. Do not
   replace denial with an alternate input path or silently change policy.
3. Click/type outside the dialog, including keyboard input while the pointer
   remains over the former HUD location. The task must pause and completing
   the old dialog must not reactivate it or publish a usable permit.
4. Press physical Esc during confirmation. Verify latched Stop, no queued
   execution and cleanup across restart; only the human may re-arm.
5. Complete a second task, End, and verify invisible passive state. Record
   actual AX/foreground/covering-window failures rather than widening exemptions.

Use a disposable local target. No message sending, deletion or security change
is needed to exercise these boundaries. Preserve the user's selected policy.
