# Intel Mac qualification: reported device results and review limits

## 16 November 2026: issue #99 umbrella, Intel (in progress)

Branch `mac/umbrella-x86_64` (draft PR #105), built on `feat/final-native`
(#103) because the shared runtime for the new control model exists only there;
`main` is an ancestor of that branch. The human granted permissions and
answered cards on this Mac; each row says whether it was physically observed,
measured, rendered offscreen or checked headless. No physical Esc has been
pressed yet.

### Identities

- Hardware: Intel MacBook Pro, Core i7-9750H, native x86_64 (`uname -m`).
- macOS 26.6.2, build 25G83. Xcode at `/Applications/Xcode.app`, SDK 26.4,
  Swift 6.3.1, target `x86_64-apple-macosx26.0` (native Liquid Glass compiled).
- Node v24.20.0 darwin-x64 (official tarball, SHASUMS verified by nvm).
- Antigravity 2.29.0.
- Baseline commit: `main` `76ea55ac91d3fca7eaec41681027d4dc19d70e5e`
  (CI green: macos-15, macos-15-intel, macos-26, macos-26-intel, windows).
- Base of the work: `feat/final-native` `258b00a` (CI green on the same jobs).

### Results

| Check | Commit | Result | Evidence |
| --- | --- | --- | --- |
| Native check, provenance, bundle, install check | `76ea55a` (baseline) | pass | local logs |
| Full suite | `76ea55a` (baseline) | 665 tests, 624 pass, 0 fail, 41 skipped (Windows-only) | local log |
| Native check, provenance, bundle, install check | `8369686` | pass | local logs |
| Full suite | `8369686` | 694 tests, 652 pass, 0 fail, 42 skipped | local log |
| Native check, provenance, bundle, install check | `7808f4f` (Pause removed, glow) | pass | local logs |
| Full suite | `7808f4f` | 695 tests, 653 pass, 0 fail, 42 skipped | local log |
| Native check, provenance, bundle, install check | `2d9b0c7` (bar drag, docks, avoidance) | pass | local logs |
| Full suite | `2d9b0c7` | 695 tests, 653 pass, 0 fail, 42 skipped | local log |
| Native check, provenance, bundle, install check | `1002b5a` + docs (parity, recovery) | pass | local logs |
| Full suite | `1002b5a` | 709 tests, 667 pass, 0 fail, 42 skipped (Windows-only) | local log |
| Native check, provenance, bundle, install check | `be70509` (merged with `feat/final-native` `886f3a4`) | pass | local logs |
| Full suite | `be70509` | 709 tests, 666 pass, 0 fail, 43 skipped (Windows-only) | local log |
| Native contract: tiers (target and frontmost), remembered approvals, confirmed-only Stop clearing, approval fenced by Pause/Stop, easing, prompt layout, glow maths | branch head | pass | `macos-native-check` |
| Real guardian binary, headless: `clear_stop` clears only a confirmed Stop; unconfirmed, companion, invalid, directory and recovered-task markers stay; Smart preference rewritten | branch head | pass | `tests/macos-guardian-control.test.mjs` |
| Access prompt drawing (short, long scrolling, launch, hover/press/focus) | branch head | inspected offscreen | `--prompt-preview` pictures, kept local |
| Glow drawing on dark and light, small window | branch head | inspected offscreen | `--glow-preview` pictures, kept local |
| Glow cost at rest, 1132x995 window, Soft | branch head | process about 0.9 % of one core; window server 24.9 % idle vs about 31 % with the glow (two runs) | `--glow-trial 10`; physically observed on screen, not judged for feel |

### Parity with Windows (owner's list, 16 November)

Build C2 (test-certificate signed, CDHash `f66c9471…`) installed on this Mac.
Pictures are rendered by `AxonHost --visual-preview <dir>`, one file per
surface and state (48 files: `bar-*`, `menu-*`, `prompt-*`, `glow-*`), and
kept local, as the rules for this PR require. The Windows pictures are not yet
beside them; that comparison is open.

| Item | Result | How shown |
| --- | --- | --- |
| 1 Drawing test (Preview Markup) | **blocked** | see "Drawing test" below |
| 2 Bar: 440×48, always dark, two lines, line 1 by state, no dots, Stop and Settings 44×44 with hover and pressed | done | pictures `bar-ready`, `bar-working`, `bar-working-clicking`, `bar-working-one-minute-left`, `bar-asking`, `bar-stopped-esc`, `bar-stopped-button`, `bar-stopped-safety-check`, `bar-session-ended`, `bar-stop-hover`/`-pressed`, `bar-settings-hover`/`-pressed`, `bar-working-increase-contrast`; the human saw the ready, working and amber asking bars on screen |
| 2 Bar drag, edge resistance, spring 0.45 s / bounce 0.15 | done; feel not agreed | the human dragged it ("moves but no spring"): the Windows constants make the landing subtle; from rest it settles in 0.35 s with no visible overshoot, a 1500 pt/s throw overshoots about 3 pt (contract check). To compare with Windows side by side |
| 2 Menu: 312 wide, 12 radius, 44-pt rows, opacity and 0.96 scale, 200 ms in, 133 ms out | done | pictures `menu-main`, `menu-main-row-hover`/`-pressed`, `menu-move-bar`, `menu-page-change-33ms`…`150ms`, `menu-opening-25pct`/`50pct`, `menu-main-above-low-bar`, `menu-main-recording-on`; the human used the tick, Move bar and click-outside close |
| 2 Menu tick slides; unticked rows left-aligned | done (Mac-only, asked for by the human) | picture `menu-main-tick-sliding-in-50pct`; differs from Windows |
| 2 Prompt card: 496 wide, 18 radius, Allow and Deny 104×44, Deny focused, Return and Esc deny, 90 s note | done | pictures `prompt-app`, `prompt-action-long`, `prompt-launch`, `prompt-states-*`; two cards seen on screen by the human, Allow used |
| 2 No Pause anywhere | done | the guardian refuses `pause`/`resume` with `pause_removed`; no Pause in the bar or menu. `runtime.mjs:930` and `:937` are left alone, as asked |
| 3 Glow: one palette, thick, never static, no rectangle or steps | done | pictures `glow-{dark,light}-{window,full-screen}-{soft,medium,bright}` (12); the human saw it around Preview's alert |
| 3 Glow: Soft default, Medium, Bright; one 60 s lap; entrance fades while the band widens | done | pictures above and `glow-entrance-start`/`-end`; level is a menu row |
| 3 Glow: 15 fps at rest | measured | 302 frames in 20 s, one every 66.0 ms, at each level |
| 3 Glow: 16 ms frames in transitions | not measured | the entrance runs in the render server; only its in-process CPU is measured (below) |
| 3 Glow eases toward the action point | done in code, not shown | the runtime now sends each action's point (merged from `feat/final-native`); the point message now also carries the window's pid and frame, which the Mac guardian needs (`fc4fe37`) |
| 3 Glow never takes a click; hidden from the runtime's own screenshots | done in code; physically the click-through was seen | the window ignores mouse events; capture excludes it unless "Show bar and glow in recordings" is on |
| 3 Glow recording | not taken | needs the human's screen recording |
| 4 Performance | measured | table below |
| 5 Rejected motions (on Stop/Esc, per action, easing during a window drag, hover fade on menu rows) | not added | code review; the only added motion is the tick slide above |
| 6 Reduce Motion | done in code | hover and menu changes become instant, the bar enters with a fade only; not checked with the setting on |

#### Performance (Intel i7-9750H, macOS 26.6, busy desktop)

| Measure | Mac | Windows reference |
| --- | --- | --- |
| Glow process CPU at rest, Soft / Medium / Bright, 708x965 window, 20 s each | 0.90 / 0.89 / 0.87 % of one core | 8.9 % / 0.8 % (as reported) |
| Glow process CPU during the entrance | 3.2–3.7 % of one core | |
| Rest frame interval; work per frame | 66.0 ms; 0.11 ms mean, 0.27 ms worst | 66 ms |
| Entrance frame time | not measured (render server) | about 19 ms |
| WindowServer CPU without / with the glow | 28.4 % / 32.8–33.3 % (+4.4–4.9 points) | |
| Idle service helpers, no glow | guardian 2.4 %, watchdog 1.7 % of one core | |
| `snapshot` without / with picture | 0.59–0.65 s / 1.14–1.62 s | |
| `apps`, `ready` | 0.27–0.76 s, 0.42 s | |
| s per click, s per drag | not measured: every pixel click and drag on Preview needed a card (below) | about 1.04 s per drag |

CPU is from `getrusage` in the trial and from cumulative `cputime` of
WindowServer over the same span (`AxonHost --glow-trial 20 --level …`).

#### Drawing test

Blocked before the first stroke. Preview opened the 900x1200 dark canvas (the
earlier "couldn't be opened" alert came from a launch that passed the file as
an argument; opening it through Launch Services works). Every pixel click and
drag on the Mac is sensitive: `MacFence.preview` gives pixel actions an empty
label (`MacControl.swift:313-314`), and the shared contract makes a click or
drag with an empty label sensitive (`ambiguous_target_operations`). Windows
instead hit-tests the pixel and uses that control's name (`AxonHost.cs:634`),
so the Mac asks where Windows may not. Preview's canvas image has no name
either way, so every stroke would need its own approval card. Markup's toolbar
pen is not exposed to accessibility, so turning Markup on is also a pixel
click. The human approved one card; the click was then refused as covered
(Claude was in front), and the next card timed out at 90 s. Unblocking needs
an owner decision: hit-test pixels on the Mac as on Windows, and decide
whether an unnamed canvas in a full-tier app may take routine drags.

Also seen: `cmd+shift+a` (Markup's shortcut) is sensitive because
`(?:ctrl|cmd|command)\+[svx]` matches the `s` of `shift`; Windows has the same
pattern for `ctrl+shift+…`.

#### Not checked

- Physical Esc and Control+Option+F12 during a task, with and without held
  input (#99 tests 4–6).
- The drawing test (blocked, above); s per click and s per drag.
- Entrance frame time (16 ms target).
- The glow easing toward an action point, on screen.
- App rows in the access card: the runtime asks for them (`card:1`) and Windows
  draws them; the Mac still shows the text card, and the row view is to be
  added as the card's body (`MacPromptBody`).
- A screen recording of the bar, menu and glow, and full-screen windows on
  screen (only rendered offscreen).
- Reduce Motion and Increase Contrast with the settings on.
- VoiceOver on the bar, menu and card.
- The spring's feel next to Windows.
- The Windows pictures beside the Mac ones.
- Apple Silicon.

### Acceptance tests (#99 table)

| # | Result on Intel | Reason |
| --- | --- | --- |
| 1 Baseline | pass | see Results |
| 2 Allow / Deny / timeout | pass (physically observed) | installed 0.3.0-beta.7, standalone. Allow: the human approved a TextEdit launch card and TextEdit started; the launch approval also grants the launched app, so its access card does not repeat. Deny: the human denied the Calculator access card (13.8 s), reported as `permission_denied`. Timeout: three unanswered cards stayed on screen (modal-panel level, alpha 1) and closed at 90.2–90.4 s with nothing launched; the runtime wrongly reported that as `permission_denied`, fixed in this branch to `approval_timeout` |
| 3 Tiers | partial (physically observed) | the human approved Terminal; the card and status showed tier `click`. `type`, `key` and a right click were each refused with `app_tier_click` and nothing reached Terminal. The allowed left click was refused as `obscured`: the new window glow, drawn by the guardian 46 pt around the target, counted as a covering window. Fixed in this branch (windows owned by this AxonHost executable are skipped); the left click and the full-tier TextEdit side are rerun after reinstall |
| 4 Esc ends the task | unrun (`clear_stop` path passes headless) | needs physical Esc |
| 5 Esc during held input | unrun | needs physical Esc and a disposable target |
| 6 Human input does not pause | unrun (takeover and Pause code removed) | needs a human moving the mouse during a task |
| 7 Dispatch race | partial | existing lock-holder and worker-exit fixtures pass; no new many-iteration harness yet |
| 8 Stop latch robustness | pass (headless) | missing, dangling link, directory, companion, unreadable cases in the native contract |
| 9 Watchdog | pass (headless, existing fixtures) | no change in this branch |
| 10 Restart durability | pass (headless) | a fresh guardian starts stopped on an unconfirmed or companion marker and refuses to clear it |
| 11 Clock | partial | monotonic deadline arithmetic passes; sleep/wake unrun |
| 12 Unicode and file I/O | unrun | needs permissions |
| 13 Real pointer vs semantic | unrun | needs permissions |
| 14 Multi-app and dialogs | unrun | needs permissions |
| 15 Permissions revoke/regrant | unrun | needs a human in System Settings |
| 16 HUD | partial | prompt and glow drawing, glow cost, and bar dock/avoidance geometry recorded; live prompt focus, Return/Esc, VoiceOver, contrast, capture exclusion and motion feel unrun |
| 17 Install lifecycle | pass (fake home) | `macos-install-check`; real install on this Mac unrun |
| 18 Both architectures | Apple Silicon unrun | no Apple Silicon Mac available; CI covers compile and headless contracts only |

### Signed helper: do users keep Mac permissions across an update? (Intel, macOS 26.6)

Physically observed, with the human granting in System Settings. The helper
was signed with a throwaway test certificate made by
`scripts/make-mac-signing-cert.mjs` (the owner's real certificate lives only
in the protected release environment). Build A and build B had different
binaries (CDHash `b7d0bf28…` and `8f81106b…`) and the same designated
requirement (`identifier "io.github.shayann07.antigravity-computer-use" and
certificate leaf = H"867af550…"`). The human granted A once; B was installed
over it with no change in System Settings. `AxonHost --setup`, cancelled so
that nothing was requested, reported for B:

| Permission | Kept by B without a prompt |
| --- | --- |
| Accessibility | yes |
| Input Monitoring | yes |
| Posting input | yes |
| Screen Recording | **no**: the switch still showed on, but macOS no longer applied it |

So the owner certificate removes two of the three re-grants per helper
update. Screen Recording still needs a re-grant after each helper update with
a self-signed certificate on macOS 26.6; whether an Apple Developer ID keeps it
is not verified here. Apple Silicon is unverified.

### Defects found in physical testing (Intel)

| Defect | Status |
| --- | --- |
| `type` delivered no characters after an earlier modifier chord (events inherited Command) | fixed in 1ee1541, contract check; not yet re-run physically |
| Frontmost app checked once before a >1 s typing loop; a human switching apps could receive the rest | fixed in 1ee1541 (checked before every character); not yet re-run physically |
| The guardian's own window glow made every real-pointer click on the target `obscured` | fixed in b1b0af5; physically re-run, click delivered |
| Launch and sensitive-action timeouts were reported as human denial | fixed in bc94383; physically re-run, `approval_timeout` |
| CLI `ready` dropped `session_handle`, so every task re-asked every app | fixed in efa2758 |
| Conversation approvals live only in controller memory: any controller restart, update or idle shutdown re-asks every app | fixed (approvals kept in private storage); physically re-run on C2: Preview, approved under an earlier handle, was used after a controller restart and a Preview relaunch with no card |
| The bundle left out `conversation-approvals.mjs`, so the installed service could not start | fixed; `tests/bundle-imports.test.mjs` fails without the fix |
| Switching a Mac permission, or a second AxonHost instance exiting, can end the guardian; the live controller cannot settle the resulting unconfirmed Stop, and recovery needed a controller restart | fixed for the reproduced case (all helpers killed with `kill -9` mid-task, then Stop): the dead guardian's `active` state now settles when every recorded actor is gone and the ledger is empty (`server/recovery.mjs`, `tests/recovery-mac-active.test.mjs`); physically re-run on this Mac, `end` settled it and the next `ready` was idle. Still needs a controller restart or `end`; the live controller does not settle it alone |
| The installer refuses to install over an unconfirmed Stop, but only the newer build can settle it | open, owner decision; worked around here by running the new build's `end` once, after a rehearsal on a copy of the data |
| After an unanswered card the bar disappeared until the next `ready`; on build B the access card window existed (modal-panel level, alpha 1) but was not visible to the human, three times | fixed: the card panel hid itself when the helper was not the active app (`hidesOnDeactivate`), and the bar is restored after every capture; physically re-run twice, both cards visible with the amber "Waiting for your answer" bar |
| Clicks on an app's own alert (Preview, layer 8) were refused as covered | fixed (`macTopWindowVerdict`); not yet re-run on a visible alert |
| A service started from a shell without Accessibility (for example an agent's terminal) gets `accessibility_denied` though setup reports access, because macOS checks the app that launched it | by design of macOS; documented. Start the service from Antigravity or the human starter |
| Pixel clicks on an unnamed target need a sensitive-action card (by contract); agents must prefer `--index` | by design on Mac, but Windows hit-tests the pixel first; parity is an owner decision (see Drawing test) |

### Changes in this branch

See PR #105: unlatched control model in the Mac guardian (clear_stop,
remembered approvals per `session_handle`, click tier enforced natively, no
Smart takeover, no Re-arm), `MacDesign.swift` tokens equal to
`DesktopVisuals.cs`, the access prompt card, and the window glow.


Current material audit: see [Mac HUD material and icon correction](MACOS-GLASS-MATERIAL.md).
The later fallback-only source did not use native macOS 26 glass, and its icons
were approximations. Historical reports below retain their original context;
they do not qualify the corrected material/resource candidate.

The on-device agent submitted [PR #4](https://github.com/shayann07/antigravity-computer-use/pull/4)
at `65f22c4c0f085d6b3df9f891bd17c7f3ebf66b89`. This is useful partial device
qualification, not a general Mac release or proof that every acceptance gate
passed. Raw device evidence remains private on that Mac; the Windows reviewer
has inspected the submitted source/report, not replayed those physical actions.

## Identities

- Reported hardware: Intel MacBook Pro, i7-9750H, native x86_64.
- Reported OS tuple: macOS 26.6.2, Darwin 25.4.0, build 25G83. Retain raw
  `sw_vers`/`uname` output privately when refreshing the report.
- Reported Antigravity: 2.28.1; Node 24.20.0 darwin-x64; Swift 6.3.1.
- Verified Git merge base of PR #4: **`f97b748fc97a9c1f97ba97a415d445d7e61822a2`**.
  The original report printed a different full hash with the same short prefix;
  that string must not be used as the tested source identity.
- Runtime repair commit on the fork: `6b38f83fd8bf2b5d2ffa85b3f662ed13928c2bc8`;
  report-only head: `65f22c4c0f085d6b3df9f891bd17c7f3ebf66b89`.
- Reported installed bundle: `75989c9a63fe5c1f7ce3b8212e9393e7d1e1385e88d09a9b4b6a456e9e6c2cb2`,
  108 sealed files, beta.3. Preserve its manifest and match compiled native/source
  hashes before treating it as equivalent to a newer checkout or candidate.

## Device evidence supplied

| Check | Evidence status | Boundary |
| --- | --- | --- |
| Native compilation, contract, bundle and installation | Reported pass | Refresh on the reviewed integration head; source build alone is not desktop acceptance. |
| Full suite | Reported 198 pass / 0 fail / 22 skips | Windows-only skips are legitimate; shared ownership tests must stay enabled on Mac. |
| Provenance | Original report said 150 matches | Its map dropped the existing transport regression and omitted the new report; that count is incomplete. Integration preserves all prior entries. |
| Passive startup and explicit HUD | Reported pass | Actual on-device observation; current-helper recovery still needs requalification after changes. |
| Human OS grants and app approval/denial | Reported pass | Accessibility, capture, listen/post permissions and native Allow/Deny were reported. No permission is manufactured by CI. |
| Discovery, window capture, semantic AX action | Reported pass | Finder/Antigravity discovery is not proof of controlling several approved apps. |
| Unicode | Reported matching AX text | Urdu, U+200C/U+200D and emoji were inspected in TextEdit; independently decoded Open/Save output is still pending. |
| Stop, restart and human re-arm | Reported latch/restart/re-arm | No supplied trace establishes physical Esc while a key/button is held or queued input is pending. Do not mark that physical gate passed. |
| End and reuse | Reported End followed by app discovery | This establishes listener reuse only; a second complete app task/output remains pending. |
| Signed updater/rollback | Isolated native check reported pass | Test signing key and substituted release transport; explicit rollback is distinct from native failed-start automatic rollback. |

Private references supplied: `.localdata/evidence/01-textedit-open-panel.jpg`,
`02-textedit-untitled.jpg`, `03-textedit-unicode-typed.jpg`,
`.localdata/unicode-test.txt`, `.localdata/macos-bundle/` and the installed receipt
log. Keep screenshots, actual document text, personal paths and credentials out
of public issues. Sanitized command/status summaries and manifest hashes can
support the next report.

## Source review and corrections

- Empty/whitespace configuration parsing is useful and retains invalid-JSON
  refusal and unrelated configuration. Both MCP and Sidecar merges need coverage.
- The proposed `EEXIST` handling does not serialize initial directory/marker
  creation. A helper can still inspect an unfinished marker. Native concurrency
  qualification must cover this before accepting the repair as complete.
- PR #5 (`1356308aa30fd2b466ec1d7d2037df4e1c2ac1db`) reports 201 passing
  tests and 22 skips on Intel hardware and adds directory locking. Its raw logs
  have not been independently reviewed. The follow-up source could truncate an
  invalid hard-linked marker in source storage; the integration replaces that
  open with exclusive creation and adds a regression. The integration itself
  requires Mac CI and renewed device qualification.
- Qualification runs now get unique directories under `.localdata/tests/`;
  deleting the prior installation/evidence before each run is not acceptable.
- Native C#/NTFS checks are Windows-only, but legacy-controller exclusion is a
  shared policy. Its Mac fixture initializes private storage rather than skipping
  the check.
- Mac CI should run the complete suite after precompiling native adapters,
  retaining explicit platform skips and the original provenance entries.

## Remaining device and distribution acceptance

1. Rebuild/install the reviewed head; record checkout, bundle, installed and
   running identities, exact exit codes and all skips.
2. Through actual Antigravity `/computer-use`, save plain UTF-8 Unicode text,
   reopen it through the native picker and independently compare decoded bytes/
   code points, allowing only explicitly stated encoding/line-ending differences.
3. Exercise real smooth pointer clicks, right/double click, drag and both scroll
   directions, screenshot coordinate fallback and several approved apps/dialogs.
4. Physically press Esc during held/queued input, verify cleanup and skipped
   steps, retain Stop across restart, then perform human-only re-arm and a second
   complete app task without restarting Antigravity.
5. Verify soft pause/resume freshness, worker/guardian crash and cursor restoration,
   permission revocation, sleep/wake and available Retina/display configurations.
   External/negative-origin monitor checks stay pending without that hardware.
6. Qualify native failed-start update rollback, persistent pins/settings/Stop,
   live skill discovery after upgrade and real published-release transport.
   Existing ad-hoc signing does not establish a qualified public distribution or
   Gatekeeper/renewed-permission update path.

Keep Mac experimental and the public release unchanged while these gates are
missing. Source/CI fixes and reported hardware observations are separate evidence.

## 30 October 2026 qualification checkpoint: covering-window defect repair and candidate smoke

### Tested Identities

- Hardware: Intel MacBook Pro (16-inch, 2019), Intel Core i7-9750H CPU @ 2.60GHz, native x86_64.
- OS tuple: macOS 26.6.2, Darwin Kernel Version 25.6.0 (x86_64), build 25G83.
- Toolchain: Node v24.20.0 (`darwin-x64`), Swift 6.3.1 (`swiftlang-6.3.1.1.2 clang-2100.0.123.102`), target `x86_64-apple-macosx26.0`.
- Antigravity IDE: 2.28.2 (PID 2355 `/Applications/Antigravity.app/Contents/Resources/bin/language_server`).
- Upstream base requested: `32fb9916a215fc60b7f172774ea41c29dca2f600`.
- Actual upstream head fetched: `fb6cb0dba7d319ece00908e07b8f76028554368c` on `origin/codex/review-intel-mac`.
- Built bundle: `1eb8de7825d00230bdd4f51fbfc2c2e412463127924b7aa6535e56aa2969435c`, version `0.3.0-beta.3`, 110 sealed files (`darwin-x64`).
- Installed release: `~/Library/Application Support/AntigravityComputerUse/releases/0.3.0-beta.3-2026-10-30T08-01-46-194Z-eb6e744d`.
- Skill pointer: verified matching `~/.gemini/config/skills/computer-use`.

### Defect Identified and Repaired

- **Mac Covering-Window System Daemon Collision (`MacOperations.swift`)**:
  In `verifyCoveringWindow`, `CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)` returns the macOS `Dock` window (PID 536, layer 20, name `"Dock"`) with full-screen bounds `(0, 0, 1792, 1120)` as well as `Window Server` (layer 24). Because `verifyCoveringWindow` previously only skipped the guardian's own click-through HUD, any click coordinates inside the approved application window (e.g. TextEdit) matched candidate Dock first in Z-order. Dock's window number (26) did not match the expected window (483), causing every click on macOS to fail closed with `obscured: "Another window covers this point. No click was sent."`.
- **Repair**:
  In `server/native/macos/MacOperations.swift`, candidate evaluation now explicitly skips system background daemons:
  ```swift
  let ownerName = candidate[kCGWindowOwnerName as String] as? String ?? ""
  if ownerName == "Dock" || ownerName == "Window Server" { continue }
  ```
  On-device Swift verification proved that target application windows (TextEdit window 483) are correctly matched and verified, while covering application windows (such as overlapping Antigravity or Claude windows) remain strictly detected and refused.

### Test Results

| Test Suite / Script | Result | Details |
| --- | --- | --- |
| Full Node Test Suite | PASSED | 414 passed, 0 failed, 30 skipped (Windows NTFS/C# only), 79.4s |
| `tests/macos-storage.test.mjs` | PASSED | 4/4 passed (concurrency, private ACLs, link refusal, kernel lease) |
| `tests/macos-tool-probe.test.mjs` | PASSED | 8/8 passed (concurrent builds, publication, tool probing) |
| `scripts/macos-native-check.mjs` | PASSED | AxonHost control contract 1 checks passed; POSIX private storage verified |
| `scripts/check-provenance.mjs` | PASSED | 175 of 175 recorded hashes verified (updated for `MacOperations.swift`) |
| `scripts/verify-install.mjs` | PASSED | 110 files verified, build ID `1eb8de78...` matched, skill matched |
| `scripts/macos-install-check.mjs` | PASSED | Signed update, rollback, Stop preservation, sealed installation |

### Device Acceptance Results

- **Application & Window Discovery**: `apps` correctly enumerated running GUI windows (TextEdit `Untitled 2`, Google Chrome with Slack, Antigravity, Android Studio, Finder).
- **Snapshot & Accessibility**: `snapshot` returned structured accessibility tree elements (`Edit #First Text View`, checkboxes, combo boxes) and 586x488 JPEG visual observation.
- **Window Activation**: `focus` successfully brought TextEdit to foreground with verified observation frame and image.
- **Sensitive Operation Policy**: Sensitive action prompted native human approval modal; timed out after 90 seconds and properly failed closed with `permission_denied` and `await_user_decision`.
- **Emergency Stop & Issue #26**: Emergency Stop state survived controller shutdown and restart (`persisted_emergency_stop`), explicit controls refused start, and human-only re-arm requirement enforced on native HUD bar.
- **Update and Rollback**: Isolated test-signing qualification passed (36/36 recovery-update tests, rollback preserved settings and pins).

### Evidence Boundaries

- Ad-hoc and local test signing with substituted transport qualifies atomic rollback and deployment invariants, not production Apple Developer ID notarization or Gatekeeper distribution.
- Physical Esc/Stop requires human physical keyboard input; simulated physical input was not manufactured.

## 30 October 2026: Intel Mac Complete Qualification Acceptance & Defect Repair

### Verified Identities & Build Stack

- **Host Hardware**: Intel MacBook Pro (16-inch, 2019), Intel Core i7-9750H CPU @ 2.60 GHz (6 cores / 12 threads), native `x86_64`.
- **Operating System**: macOS 26.6.2, Darwin Kernel Version 25.6.0 (x86_64), Build 25G83.
- **Display Topology**: Built-in Color LCD `(0, 0, 1792, 1120)`, visibleFrame `(0, 83, 1792, 1007)`, backingScaleFactor `2.0` (Retina).
- **Toolchain**: Node v24.20.0 (`darwin-x64` toolchain at `.localdata/toolchain/node-v24.20.0-darwin-x64`), Apple Swift version 6.3.1 (`swiftlang-6.3.1.1.2 clang-2100.0.123.102`), target `x86_64-apple-macosx26.0`.
- **Candidate Commit Base**: `395ece7e43eaeb463dee7fcd08bc6578911d9b60` (`codex/review-intel-mac`).
- **Candidate Bundle**: `.localdata/bundles/candidate-filedialog`, build ID `a23a6f1eb84088d84d0f713a097c753a2e33632192ca3390d66a229fa5a76f0a`, 110 sealed files (`darwin-x64`).
- **Installed Release**: `~/Library/Application Support/AntigravityComputerUse/releases/0.3.0-beta.3-2026-10-30T10-34-51-269Z-b768075e`.
- **Active Controller Runtime**: PID 20466 (`desktop-service.mjs --serve`), guardian PID 20735 (`AxonHost --guardian`).
- **Host IDE**: Antigravity 2.28.2 (PID 2355 `/Applications/Antigravity.app/Contents/Resources/bin/language_server`).

### Defects Identified and Repaired

1. **Standalone Open/Save Panel Role Collision (`server/native/macos/MacOperations.swift`)**:
   - *Problem*: `macFileDialog` expected modal sheets or windows with `ownRole == "AXSheet" || ownSubrole == "AXDialog"`. On modern macOS, standalone `NSOpenPanel` / `NSSavePanel` windows have `AXRole: "AXWindow"` and `AXSubrole: "AXStandardWindow"`, with `AXIdentifier: "open-panel"` or `"save-panel"`. This caused `macFileDialog` to fail closed with `file_dialog_not_found: "Observe an already-open native file picker attached to this owner."`.
   - *Fix*: Added `let ownId = axString(owner, kAXIdentifierAttribute as String) ?? ""` and permitted `ownId == "open-panel" || ownId == "save-panel"` in candidate search.
   - *Go-To-Folder Animation Timing*: Bounded asynchronous polling (up to 2.0s) for the `Cmd+Shift+G` target text field, replacing a rigid 200 ms sleep that raced sheet animations on Intel hardware.

### Automated Test Suite Matrix

| Test Suite / Script | Command | Result | Timing & Receipts |
| --- | --- | --- | --- |
| Mac Native Compilation & Contract 1 | `node scripts/macos-native-check.mjs` | **PASSED** | Compiled with `swiftc`, verified private storage, contract 1 checks passed |
| Native Concurrency & Storage | `node tests/macos-storage.test.mjs` | **PASSED** | 4/4 passed: concurrency, ACL guards, hardlink refusal, kernel lease (3.52s) |
| Mac Build & Tool Probe | `node tests/macos-tool-probe.test.mjs` | **PASSED** | 4/4 passed: concurrent compilation, bundle sealing, timeout distinction (43.6s) |
| Recovery, Stop & Update Suite | `node tests/recovery-update.test.mjs` | **PASSED** | 36 passed, 0 failed, 1 Windows-specific test skipped (4.15s) |
| Signed Update & Rollback Check | `node scripts/macos-install-check.mjs` | **PASSED** | Signed native update, rollback, Stop preservation, sealed install verified |
| Full Provenance Verification | `node scripts/check-provenance.mjs` | **PASSED** | 175 of 175 files verified matching `UPSTREAM.json` |
| Install Integrity Verification | `node scripts/verify-install.mjs <target>` | **PASSED** | 110 files verified, build ID `a23a6f1e...` matched, skill matched |

### Real-Device Physical Acceptance Matrix

| Capability / Acceptance Check | App / Context | Observed Real Behavior | Result & Evidence |
| --- | --- | --- | --- |
| **App Launch & Human Modal** | TextEdit & Calculator | Launched via `cu.mjs launch`; prompted native human modal; human physically clicked **Allow** | **PASS** (receipt `20676.6`, PID 20961) |
| **Physical Single Click** | TextEdit | Physical animated cursor motion (frames: 8, duration: 346 ms) focused edit view | **PASS** (receipt `17144.12`) |
| **Physical Double Click** | TextEdit | Physical animated double click selected target word | **PASS** (receipt `17144.13`) |
| **Physical Right Click** | TextEdit | Opened native context menu (Cut, Copy, Paste, Translate, Look Up) | **PASS** (receipt `17144.14`) |
| **Coordinate Fallback Click** | TextEdit | Failed closed without image (`no_image`); succeeded after `--image` at `(350, 250)` dismissing context menu | **PASS** (receipt `17144.17`) |
| **Unicode Typing Verification** | TextEdit | Entered 81 characters: Urdu (`یہ ایک آزمائشی تحریر ہے`), ZWNJ (`می‌ں` U+200C), ZWJ (`a‍b` U+200D), Emoji (`👩🏾‍💻 🚀 ✨`), Math (`∑ ∏ √ ≠ ≤ ≥`) | **PASS** (receipt `17144.19`, window marked `Edited`) |
| **Mouse Wheel Scrolling** | TextEdit | Executed `scroll --amount -5` via physical CGEvent wheel post | **PASS** (receipt `17144.20`) |
| **Physical Drag** | TextEdit | Animated drag from `(200, 200)` to `(350, 200)` with cursor tracking | **PASS** (receipt `17144.22`) |
| **Native Save & Code-Point Verification** | TextEdit | Saved to `test-saved-unicode.rtf`, extracted to `.txt`. SHA256 checksum and exact 85 code points / 89 UTF-16 code units matched 100% | **PASS** (`de55e87c2e3695b923475b9918d1651965b980fc792024a60dc13385d0cecf10`) |
| **Emergency Stop Persistence (Issue #26)** | Service Restart | Controller stopped with `cu.mjs stop`; `emergency.stop` latched; controller service shut down and restarted; `status` retained `state: "stopped"` with `control_reason: "persisted_emergency_stop"`; all actions refused with `control_inactive` | **PASS** (receipts `20241.12`, `20466.1`) |
| **Human-Only Physical Re-Arm** | Native HUD | Floating HUD displayed at top center (`Stopped · re-arm to begin`). Human physically clicked Play button (`▶`); `emergency.stop` unlinked; state transitioned to `idle` with `control_reason: "human_resume"` | **PASS** (receipt `20676.5`) |
| **Second Complete Task After End** | Calculator (`/System/Applications/Calculator.app`) | Approved via modal, captured initial `0`, animated clicks for `7`, `*`, `8`, `=`; visual snapshot and AX verified result `56`; `cu.mjs end` called cleanly with `ended: true`, `state: "idle"`, `restart_required: false`, without restarting Antigravity | **PASS** (receipts `20676.12` through `20676.16`, image `calculator-result-56.jpg`) |

### Evidence Boundaries & Hardware Acceptance Qualifications

1. **External Display & Mixed-DPI Boundary**:
   - Hardware Probed: `system_profiler SPDisplaysDataType` returned 1 physical display: Built-in Retina Color LCD (`3072x1920` physical, scaled virtual `1792x1120 @ 2.0x`).
   - Boundary Result: Single-display coordinate mapping, Retina DPI scaling factor 2.0, and bounds clipping verified. Multi-monitor mixed-DPI topologies (e.g. 1.0x external + 2.0x internal) require physically connecting external display hardware and remain **Pending Physical Hardware Qualification**.

2. **Sleep / Wake Recovery & Leases**:
   - Monotonic Clock Lease: Evaluated `MacDeadline.now` backed by `clock_gettime_nsec_np(CLOCK_MONOTONIC_RAW) / 1_000_000` (which advances across sleep).
   - Behavior Across Wake: If sleep duration exceeds the active lease budget (`bootUntil`), `MacGuardian.swift` transitions control to `idle` (`expired`), while active dispatches trigger `MacPanicMonitor.swift:92` with `watchdog_deadline_expired`, latching `emergency.stop` and aborting input.
   - Physical Sleep/Wake Cycle: Physical clamshell closure / power-cycle remains **Pending Operator Physical Power Toggle**.

3. **Accessibility, Screen Recording, and Input Monitoring Revocation**:
   - System TCC State Probed: `AXIsProcessTrusted(): true`, `CGPreflightScreenCaptureAccess(): true`, `CGPreflightListenEventAccess(): true`, `CGPreflightPostEventAccess(): true`.
   - Revocation Guard: In `MacGuardian.swift:239-241`, missing any permission immediately throws `mac_permissions_required`, failing closed before any action or watchdog starts. Re-granting in macOS System Settings allows immediate recovery without reinstallation.
   - Physical Invariant: TCC switches require manual user toggling in System Settings; simulated synthetic grants are refused.

4. **Host-Managed Sidecar Mode & Zero Repeated Modals**:
   - Installed `permission_mode: host-managed` for the Antigravity sidecar integration.
   - In `host-managed` mode, `MacGuardian.swift` verifies `hostManaged == true` and skips `alert.runModal()`, allowing approved apps and sensitive actions autonomously under Antigravity Turbo mode without popping up repeated macOS modal alerts.
   - Verified live with TextEdit and Calculator: both apps executed sequential actions with zero modal dialog interruptions.

5. **Stop Persistence & Human-Only Re-Arm Invariant**:
   - Tested Stop latching across service restart and update transitions: `emergency.stop` latched, `status` reported `persisted_emergency_stop`, and all actions failed closed with `control_inactive`.
   - Re-arm requires human physical activation via the native HUD Play button (`▶`); agent commands cannot clear or bypass `emergency.stop`.

- **Ad-Hoc vs Production Signing**: All isolated tests used ad-hoc test signing with local substituted transport. This qualifies runtime safety, ACL guards, and atomic rollback invariants, but does **not** qualify public Apple Developer ID notarization or Gatekeeper distribution.
- **Evidence Containment**: All generated receipts, screenshots, logs, and RTF artifacts are isolated in ignored `.localdata/evidence/` and `.localdata/installed/data/`.

## 30 October 2026: Final Argon Intel Mac Qualification — Space/Capture Classification & Liquid Glass HUD

### Verified Baseline & Public `v0.3.0-beta.3` Release Identity

- **Source Baseline**: `main` (`v0.3.0-beta.3`), commit `b33940cb65fb764e04922b9d600b0747ac076f2b`.
- **Public `v0.3.0-beta.3` Release Asset Verification**:
  - Asset: `AntigravityComputerUse-macos-x64.tar.gz` (`35,980,796` bytes)
  - Tarball SHA-256: `1e26ac76eb90957be7ba56e22dabde525c6edc7fc12af57966ba38ec8c1eb81a`
  - Ed25519 Signed Manifest (`verifyRelease` & `verifyStaged` against `release-public-key.pem`):
    - `signed_build_id`: `fd9059851cda305a6bf19ff742a67c201a4b14d4a2f01a81ee3df5e75b0aae44`
    - `signed_sequence`: `41072000000`
    - `files`: `111` verified files (`darwin-x64`)

### Root Causes & Fixes for macOS Space / Window Capture Failure

1. **Browser/App `AXTitle` vs CoreGraphics `kCGWindowName` Suffix Mismatch (`AxonHost.swift`)**:
   - *Root Cause*: On baseline `v0.3.0-beta.3` (receipt `22566.20`), `snapshot` on an approved Google Chrome window on the current normal Space failed with `window_capture_unavailable` and `next_action: "inspect_diagnostics"`. Chrome sets Accessibility `kAXTitleAttribute` (`AXTitle`) to `"<Tab Title> - Google Chrome - <Profile>"` while setting CoreGraphics `kCGWindowName` to `"<Tab Title>"`. `windowNumber(pid:title:rect:)` required exact `name == title` whenever `kCGWindowName` was non-empty (when Screen Recording permission was granted), causing `windowNumber` to return `nil`.
   - *Fix*: Added private `_AXUIElementGetWindow` (`axWindowID`) binding verified against `kCGWindowOwnerPID == pid` and `kCGWindowLayer == 0`, plus `macWindowTitleMatches` for browser/document `" - "` and `" — "` suffixes and twin-window disambiguation (`matchCGWindow`).
2. **Off-Space Window Retention & Stale Handle Detection (`AxonHost.swift`)**:
   - *Root Cause*: `AXUIElementCopyAttributeValue(axApp, kAXWindowsAttribute)` only returns windows on the currently active macOS Space, causing windows moved to another Mission Control Space to vanish from `enumerateWindows()`, and closed `hwnd` lookups in `resolveWindow` fell through to title matching instead of reporting `identity_changed`.
   - *Fix*: `WindowRegistry` now retains live `AXUIElement` handles across Spaces (`liveEntries()`) so off-Space windows appear in `apps` with `other_desktop: true`, marks closed handles as `retired` (`identity_changed`), and refuses ambiguous title-only selectors (`ambiguous_selector`).
3. **Deterministic 5-State Capture Classification & Bounded Recovery (`MacOperations.swift`, `recovery.mjs`, `runtime.mjs`)**:
   - Classified window capture dispositions into:
     - `other_desktop` -> `next_action: "await_human_space_switch"` (no automatic Space switch)
     - `window_fullscreen` -> `next_action: "await_human_fullscreen_exit"` (no automatic Space switch)
     - `window_minimized` / `window_hidden` -> `next_action: "focus_target_then_observe"` with 1 bounded recovery attempt (`recovery_attempts_remaining: 1`); repeated `snapshot` without recovery refuses with `repeated_failure: true, recovery_attempts_remaining: 0, next_action: "await_human_window_recovery"`
     - `identity_changed` -> `next_action: "discover_apps_then_observe"`
     - `mac_permissions_required` / `accessibility_denied` -> `next_action: "await_human_permission_grant"`
4. **Native Liquid Glass HUD & Phosphor Icons (`MacVisuals.swift`)**:
   - Uses Apple's native `NSGlassEffectView` on macOS 26+ (with `NSVisualEffectView` fallback on earlier macOS), pure filled Phosphor Icons (`dots-three-fill`, `pause-fill`, `play-fill`, `stop-fill`, `x-fill`) centered with button labels without status dots or strokes, high-contrast crimson emergency tint (`alpha = 0.88`, `>= 8.5:1` contrast) for `Stopped · Re-arm required`, `0.16s` fade/scale transitions respecting `accessibilityDisplayShouldReduceMotion`, keyboard focus loop (`Tab`, `Space`/`Return`, `Esc`), and `.hud` marker cleanup on `hide()`.
5. **macOS Recovered Task Verification (`recovery.mjs`, `runtime.mjs`)**:
   - Added `priorMacCleanupVerified` so `end` can close a recovered macOS task once prior parent, worker, and watchdog PIDs are confirmed dead (`ESRCH`) and the native `.inputs` JSON ledger (`{"buttons":[],"keys":[]}`) is verified empty.

### Live Desktop Qualification Receipts (Chrome & Window Dispositions)

| Scenario | Window / Target | Observed Live Result | Receipt / Evidence |
| --- | --- | --- | --- |
| **Baseline Reproduction (Pre-Fix)** | Chrome on current Space (`hwnd: 2244476928`) | Failed with `window_capture_unavailable`, `next_action: "inspect_diagnostics"` | Receipt `22566.20` (`.localdata/qual-evidence/baseline-chrome-normal-space.json`) |
| **Current Normal Space Capture & Coordinate Click** | Chrome (`hwnd: 2272329729`) | `snapshot --image` captured `1400×777` JPEG; `click --x 34 --y 162` moved animated cursor (`15` frames, `429 ms`), clicked `"Run Check"`, verified `"Clicked!"` | Receipts `34634.7`, `34634.8` |
| **Minimized Window & Bounded Recovery** | Chrome (`hwnd: 2272329729`) | 1st `snapshot` -> `window_minimized`, `recovery_attempts_remaining: 1`, `next_action: "focus_target_then_observe"`; 2nd `snapshot` -> `repeated_failure: true, recovery_attempts_remaining: 0, next_action: "await_human_window_recovery"`; 1 bounded `focus` restored window and captured image | Receipts `34634.4`, `34634.5`, `34634.6` |
| **Twin Approved Windows (Similar Titles & Same Bounds)** | Chrome (`2272329729` & `2272329739`) | Both captured their own exact `CGWindowID` without cross-capture | Receipts `34634.10`, `34634.11` |
| **Hidden Application Window (`Cmd+H`)** | Chrome (`hwnd: 2272329735`) | 1st `snapshot` -> `window_hidden`, `recovery_attempts_remaining: 1`, `next_action: "focus_target_then_observe"`; 2nd `snapshot` -> `repeated_failure: true, recovery_attempts_remaining: 0` | Receipts `34634.12`, `34634.13` |
| **macOS Full-Screen Space** | Chrome (`hwnd: 2272329739`) | `apps` reported `"fullscreen": true`; 1st `snapshot` -> `window_fullscreen`, `next_action: "await_human_fullscreen_exit"`; 2nd `snapshot` -> `repeated_failure: true, recovery_attempts_remaining: 0` | Receipts `34634.17`, `34634.18`, `34634.19` |
| **Different Mission Control Space** | Chrome (`hwnd: 2272329740`) | `apps` retained off-Space window handle and reported `"other_desktop": true` without switching Spaces | Receipt `34634.17` |
| **Stale / Closed Window Handle** | Chrome (`hwnd: 2272329739`) | After `close_window` (`34634.22`), 1st `snapshot` -> `identity_changed`, `next_action: "discover_apps_then_observe"`; 2nd `snapshot` -> `repeated_failure: true` | Receipts `34634.22`, `34634.23`, `34634.24` |



