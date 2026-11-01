# Windows beta.4 qualification — 1 November 2026

## Published and installed identity

- Release: [v0.3.0-beta.4](https://github.com/shayann07/antigravity-computer-use/releases/tag/v0.3.0-beta.4), Windows x64 prerelease only.
- Source: `d720677079f8b146c158864369b65db96d1683a5`; integrated by PR #31.
- Build: `c93b8fcbd62e58c6ab0dd355dbaacf622d234ca95b2449e184ecbf2d9bee9b89`.
- Portable ZIP SHA-256: `d9a6766ffd8f1d4234b8f16df558e1237f1d74de344f36eb68d54eb7129bad9a`.
- Signed release sequence: `41130000000`; 120 signed files including the bundle manifest.

The GitHub-downloaded ZIP was extracted and independently verified against the
pinned public key, signed file inventory and sealed bundle identity. The
supported installer replaced the global candidate with that downloaded bundle;
119 installed payloads and the generated skill pin matched. The listener
reported the same build, host-managed/manual policy and idle state. Existing
automatic/beta update settings and reporting consent were preserved. The
separately pinned Upscaly project deployment was subsequently upgraded through
the same downloaded installer's explicit project-local operation. Both scopes
now match the published beta.4 build; the project remains explicitly pinned,
with rollback backups retained. No active skill points at the development
checkout for these two scopes.

## Actual application evidence

A real no-project Antigravity Flash task on this build exported PNG and JPEG
from stable Upscaly 1.0.9. Both independently decoded at 2800×4496 from a
700×1124 input and matched model publication records. Receipts `12880.4` through
`12880.37` record 471.556 seconds, 34 calls and 37.6833 seconds of controller
execution, including one `obscured` refusal. End returned idle. No independent
engine-process witness was collected during that particular model run.

Two subsequent tasks used the installed GitHub-downloaded build directly. Both
captured an actual `realesrgan-ncnn-vulkan` child with `realesr-general-x4v3`,
scale 4 and the exact PNG/JPEG output paths. The decoded outputs match the Flash
outputs byte for byte:

| Output | Bytes | SHA-256 |
| --- | ---: | --- |
| PNG | 14,181,004 | `90a5b2aa645387f23e8af958418ae3d74cfd9047a365fe881532640ea6ecb614` |
| JPEG | 6,195,183 | `e8c26a408cc3431e548a2ae5a842bdea6cef78d7115585bd1ff99e6676c08f03` |

Native receipts `78468.4`–`78468.21` and `78468.24`–`78468.32` cover the two
tasks, physical animated clicks, clipboard-preserving import, wheel and semantic
scroll-into-view, model selection, output-directory entry, own-window close and
End. The second task required no service restart. App settings were restored
byte-exactly, grants were released and the controls hidden. These direct tests
are not Antigravity orchestration-speed benchmarks.

Local evidence remains private under `.localdata/windows-beta4-acceptance/`:
`verification.json`, `native-verification.json`, `native-processes.jsonl`,
`receipts.json` and decoded output files. Do not upload the private images,
paths, process command lines or application history as diagnostic reports.

## Automated and update checks

- Local final source suite: 456 tests, 445 passed, zero failed, 11 explicit skips.
- Exact release head Windows, Intel Mac and Apple Silicon source checks passed.
- Native Windows compilation and actual LiquidGlass package/client checks passed.
- Provenance: 196 entries matched. Package and icon licenses are retained.
- Native signed upgrade on the existing private installation and explicit
  rollback succeeded. The same sequence was correctly not automatically
  re-offered after rollback; the verified downloaded ZIP was then installed
  explicitly. Settings and project pins survived.
- Fresh project-local native install qualification skipped with
  `insecure_storage_ancestor`; no ancestor ACL was changed. This is not a pass.
- No new Mac release artifacts or current Mac hardware acceptance are claimed.

## Failed and pending gates

The full goal remains incomplete. In particular:

1. Antigravity speed is not solved by the 471.556-second run. Repeat matched
   Flash/Sonnet workflows after measured orchestration changes.
2. Public per-payload transport with the published updater hit its 30-second
   whole-download deadline on large payloads. See [#32](https://github.com/shayann07/antigravity-computer-use/issues/32).
   A source repair separates header, progress and total deadlines; it is not in
   the published beta.4 bytes. Its new client downloaded and verified all 120
   public release files in 49.789 seconds; this does not retroactively qualify
   the published updater.
3. A top-center physical click was refused because an overlay covered it, and
   later batch steps were skipped. Covering-window identity and a safe own-HUD
   avoidance fix require qualification. See [#33](https://github.com/shayann07/antigravity-computer-use/issues/33).
   Do not bypass this by ignoring unrelated overlays or clearing Stop.
4. Final-build physical Esc/held-drag/re-arm, deliberate takeover, mixed-DPI and
   multiple displays still require current human/hardware evidence. Earlier
   builds' checks remain historical.
5. Current Intel Mac signed update/rollback, permission changes, display and
   sleep/wake qualification remain separate gates. Windows beta publication
   does not establish Mac production readiness.

The actual published LiquidGlass package is used, with official filled Phosphor
icons. Its caller-owned backdrop does not provide live desktop refraction;
visual parity with Apple's native material is not claimed.
