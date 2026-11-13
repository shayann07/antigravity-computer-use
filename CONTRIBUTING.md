# Contributing

Use Windows x64 and Node 24.20.0 for reproducible packaging. No npm dependencies are needed. Run `npm test` and `npm run build` before submitting changes. Native tests require an unlocked interactive desktop; run them sequentially against the provided disposable fixtures. Never run input tests against personal documents.

Describe the problem, observable behavior, and verification in your pull request. Changes to input, cancellation, permissions, coordinates, or installation need focused regression tests. Preserve independent stop, human re-arm, native identity checks, and one-use observations. Never add model-supplied approval flags.

Keep source attribution and modification hashes in UPSTREAM.json current. Do not submit private screenshots, user recordings, logs, credentials, .localdata, generated executables, or dist archives in source commits. Public release assets belong in GitHub Releases.

Report OS, display scaling, monitor arrangement, app version and reproduction steps for bugs. Redact personal content. See SECURITY.md for security reports and VALIDATION.md for verification limits.

