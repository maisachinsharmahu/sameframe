# Contributing to Sameframe

Bug reports, focused improvements, documentation fixes, and tests are welcome.

## Local setup

```bash
npm install
npm test
npm run build
```

The automated test suite does not require downloaded model weights. To work on
AI similarity features, follow the model setup in [README.md](README.md).

## Pull requests

1. Keep exact-duplicate logic deterministic. AI or perceptual scores must never
   authorize deletion.
2. Keep media processing local and do not introduce telemetry or uploads.
3. Add or update tests for scanner, containment, comparison, and similarity
   behavior.
4. Run `npm test` and `npm run build` before opening a pull request.
5. Explain user-visible safety implications in the pull-request description.

## Reporting security issues

Please do not publish exploitable path-containment, deletion, or local-file
access issues before a fix is available. Open a private security advisory from
the repository's **Security** tab.
