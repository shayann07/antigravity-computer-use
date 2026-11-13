# Contributing

Thanks for helping. This project drives a real desktop, so safety comes first
and every change needs evidence that it works.

## Good places to start
- **First issues:** issues labelled [`good first issue`](https://github.com/shayann07/antigravity-computer-use/labels/good%20first%20issue)
  are scoped and say what "done" looks like.
- **Larger work:** [`help wanted`](https://github.com/shayann07/antigravity-computer-use/labels/help%20wanted)
  marks bigger pieces, especially cutting the number of model turns
  ([#74](https://github.com/shayann07/antigravity-computer-use/issues/74)).
- **Real apps:** reports of apps where `/computer-use` gets stuck are valuable
  too. Use the bug template.

## Set up
- Windows x64 and **Node 24.20.0**, the version used for packaging. There are
  no npm dependencies.
- The native helpers are compiled with the built-in .NET Framework compiler.
- Experimental macOS work needs macOS 14+, a matching Node 24.20.0 and the Xcode
  Command Line Tools; see [docs/MACOS.md](docs/MACOS.md).

```powershell
npm test
node scripts/check-provenance.mjs
npm run build
```

- **Native tests:** these drive a real desktop. Run them one at a time, on a
  desktop nobody else is using, against the provided disposable fixtures.
  Never point input tests at personal documents.
- **Evidence:** keep any test or recording evidence in the ignored `.localdata/`
  folder.

## Pull requests
- **Describe it:** say what problem you fixed, what you observed before and
  after, and how you verified it.
- **Test the risky areas:** changes to input, cancellation, permissions,
  coordinates or installation need focused regression tests.
- **Keep the safety rules:** independent Stop, human-only re-arm, native
  identity checks, one-use observations, and no automatic replay of uncertain
  input. Never add approval flags the model could set.
- **Update provenance:** if you change a tracked source file, run
  `node scripts/check-provenance.mjs --write` and commit the updated
  `UPSTREAM.json`.
- **CI:** it runs on Windows and four macOS runners. The single required check
  is `ci-ok`. Pull requests from forks need a maintainer's approval before CI
  runs.
- **Don't commit:** private screenshots, recordings, logs, credentials,
  `.localdata/`, built executables or `dist/` archives. Release files belong in
  GitHub Releases.

## Reporting bugs
Include:
- your Windows version, display scaling and monitor layout;
- the app and its version;
- what you asked for, the step that failed, and the reply's `next_action` and
  `recovery` fields if there were any.

Remove personal content first. For security problems, use
[private vulnerability reporting](https://github.com/shayann07/antigravity-computer-use/security/advisories/new),
never a public issue. See [SECURITY.md](SECURITY.md) and [VALIDATION.md](VALIDATION.md).

Everyone taking part is expected to follow the [code of conduct](CODE_OF_CONDUCT.md).
