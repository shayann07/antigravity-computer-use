## What and why

<!-- The problem, and what this change does about it. Link the issue: "Fixes #123". -->

## How I verified it

<!-- Commands you ran and what you saw. For desktop behaviour: the app, the steps and the result. -->

## Checklist

- [ ] `npm test` passes locally.
- [ ] Changed tracked files have their hashes updated (`node scripts/check-provenance.mjs --write`).
- [ ] Changes to input, cancellation, permissions, coordinates or installation have focused tests.
- [ ] Safety rules are unchanged: independent Stop, human-only re-arm, one-use observations, no replay of uncertain input.
- [ ] No private screenshots, recordings, logs, credentials, `.localdata/` or built binaries are included.
