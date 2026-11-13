# Branch policy and cleanup

`main` is the maintained development branch. Published versions are preserved by
their release tags. Create a short-lived branch for an active change and remove
it after integration; old work branches are not separate supported editions.

The current UI candidates are `codex/guardian-hud-avoidance`
([PR #35](https://github.com/shayann07/antigravity-computer-use/pull/35)) and
`codex/mac-native-glass-assets`
([PR #36](https://github.com/shayann07/antigravity-computer-use/pull/36)). They share
the runtime and remain draft pending their live/physical checks. Inspect their
current heads; neither candidate is a separately supported product edition.

Antigravity's `reduce_orchestration_latency` worktree retains its unmerged
revisions. PR #37 selectively reused and repaired the comparison utility; it did
not merge that branch's older runtime, quick-start or timing harness. The
remaining harness has reproduced qualification faults recorded in issue #38.
Do not use it against live controls until repaired. Merged temporary branches
are removed only after their ancestry and PR state have been verified; private
worktrees and other agents' work are preserved.

On 28 October 2026 the following historical branches were retired after checking
their ancestry and open pull requests. There were no open pull requests using
them. A full pre-cleanup Git bundle is retained locally under ignored `.localdata/`.

| Retired branch | Last commit | Preservation |
| --- | --- | --- |
| `work/atomic-filename-entry` | `cf1d6033519c3aefca3b40bf5f2ee525de66a852` | Ancestor of `main` |
| `work/host-daemon-session` | `de186dfdba30f4d5c2fab02e61ba0a036cc2f85a` | Ancestor of `main` |
| `work/observed-selectors` | `c9838ff865dfda0422662ac6803014edd94aef97` | Ancestor of `main` |
| `work/private-storage` | `b85ff132c8034c96fc47af350c15f28ce3c81345` | Ancestor of `main` |
| `work/window-reachability` | `83a015715c91fa686793ea252b2cb2e769abae38` | Ancestor of `main` |
| `work/release-documentation` | `a733bddf77271f6b1302811fdffa293e2ccf2b40` | README-only draft retained by tag `archive/readme-draft-20261028`; current documentation is on `main` |

No runtime implementation was discarded or force-pushed. For current work and
qualification limits, read [the validation record](../VALIDATION.md).
