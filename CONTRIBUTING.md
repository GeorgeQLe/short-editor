# Contributing to SiftCut

Thanks for helping improve SiftCut.

## Before opening a change

1. Search existing issues and open one for substantial behavior or interface
   changes before investing in implementation.
2. Keep source media, credentials, transcripts, model files, generated builds,
   and machine-specific paths out of commits.
3. Preserve the local-first privacy boundary: no telemetry, automatic upload,
   silent provider fallback, or model download without explicit consent.
4. Keep third-party license and corresponding-source obligations accurate.

## Development

SiftCut requires Node.js 22 or newer:

```bash
npm ci
npm run typecheck
npm test -- --maxWorkers=4
npm run build
```

Apple Silicon release inputs require macOS 14 or newer, Xcode command-line
tools, `uv`, CMake, and Ninja. See `docs/release-sources.md`.

## Pull requests

- Make each pull request a focused, reviewable change.
- Add or update tests for changed behavior.
- Update public contracts, documentation, licenses, and generated inventories
  when relevant.
- Describe privacy, security, migration, and rollback implications.
- Confirm that no secrets or private source material appear in the diff or its
  history.

By contributing, you agree that your contributions are licensed under the MIT
License in this repository.
