# Continuous integration

The repository and its [workflow source](../.github/workflows/) are public.
Contributors can inspect the checks and open pull requests from forks; the
Windows and macOS source workflows run on push, pull request and manual dispatch
without a signing key or other repository secret. They use a read-only token,
do not persist checkout credentials, and pin third-party actions to commits.
Fork owners may need to enable GitHub Actions on their fork.
For each workflow, event type and branch, a newer run cancels older in-progress
runs. Push and pull-request checks remain separate, and the signed-release
preparation workflow is not automatically cancelled by this policy.

| Workflow | What it runs | Important boundary |
| --- | --- | --- |
| `ci.yml` | One required check, `ci-ok`, that always reports. Every code change runs the full Windows checks (Node tests, provenance, native host build, noninteractive guardian check, development bundle, native updater qualification where the runner ACL permits it) and all four macOS runners in parallel. Pushes to main, a weekly run and manual runs also upload development candidates. Docs-only pull requests run the provenance check only. | An ACL refusal is reported as a skip, not proof of a native update. Hosted CI does not test interactive mouse, desktop or physical Stop. macOS runs use test keys and substituted transport and do not qualify physical permissions. |
| `prepare-signed-release.yml` | Maintainer-only preparation and verification of signed candidate assets on Windows and both Mac architectures | Requires the maintainer's signing secret. It is not run for fork pull requests and does not publish a release. Never expose the signing key to untrusted pull-request code. |

The downloadable CI artifacts are **development candidates**, not signed public
releases or evidence of full desktop acceptance. The release workflow is kept
separate from ordinary pull-request CI; release and installer pins only change
after the documented acceptance gates in [reliability status](RELIABILITY-IMPLEMENTATION.md).
The Mac workflow and updater changes are currently on the development branch;
the default branch and published beta may not contain them yet.
The [public draft PR checks](https://github.com/shayann07/antigravity-computer-use/pull/6/checks)
show the current candidate's Windows and Mac runs. The [Actions page](https://github.com/shayann07/antigravity-computer-use/actions)
shows their logs and workflow definitions; the Mac workflow becomes part of the
default branch only after the candidate is reviewed and merged.

The Windows workflow limits Node's test-file concurrency to four to reduce
competition between native compilation, PowerShell and installer fixtures on
hosted runners. It still executes the full suite. A timed-out bootstrap test
reports its process error and retains its own fixture under `.localdata/tests/`;
this does not establish why a timeout occurred or replace a successful rerun.

For a local source check, use Node 24.20.0 from the repository root:

```sh
node --test tests/*.test.mjs
node scripts/check-provenance.mjs
node server/build.mjs --force
```

Native compilation requires Windows or macOS and the platform's standard build
tools. Keep temporary test output under `.localdata/`. Check the individual test
results for skips and failures; source tests, hosted builds and simulated input
do not replace the real-app, physical-input or device checks.
