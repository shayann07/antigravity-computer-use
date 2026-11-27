# Code signing policy

Status: Windows binaries (`AxonHost.exe`, `StorageGuard.exe`) are not yet
Authenticode-signed. We have applied to the SignPath Foundation for free
open-source code signing. Until that is approved, verify downloads against
`SHA256SUMS` on the release page. See issue #149.

Once approved: free code signing provided by [SignPath.io](https://about.signpath.io),
certificate by [SignPath Foundation](https://signpath.org).

## What gets signed

Only binaries built from this repository's source by GitHub Actions
(`.github/workflows/prepare-signed-release.yml`). Nothing built on a developer
machine and no third-party binaries are signed under this policy.

## Team roles

- Committers and reviewers: [shayann07](https://github.com/shayann07)
- Approvers: [shayann07](https://github.com/shayann07)

Every signing request is approved by hand for each release.

## Privacy

This program will not transfer any information to other networked systems
unless specifically requested by the user or the person installing or operating
it. The only network access is the update check, which downloads signed release
metadata from GitHub. Screenshots and UI data stay on the machine and go only to
the AI agent the user runs.
