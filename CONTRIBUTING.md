# Contributing to @atol-sh/react

Thanks for your interest in improving the Atol React SDK. This document
covers how to get set up, the quality bar, and how to propose changes.

## Getting started

```bash
git clone https://github.com/atol-sh/atol-sdk-react.git
cd atol-sdk-react
npm install
```

Common tasks:

```bash
npm run build       # tsup -> dist/ (ESM + CJS + d.ts)
npm test            # vitest (run once)
npm run test:watch  # vitest watch mode
npm run typecheck   # tsc --noEmit
npx vitest run --coverage   # tests with coverage
```

## Before you open a pull request

- `npm run typecheck` passes.
- `npm test` passes. Add or update tests for any behavior change. This is a
  security-critical auth SDK; logic changes to token handling, DPoP, the
  crypto/KEK paths, or the deny-by-default permission path must come with
  tests.
- `npm run build` succeeds and the public API surface in `src/index.ts` is
  intentional (run `npx publint` and `npx @arethetypeswrong/cli --pack` if
  you touched packaging).
- Keep changes surgical. Match the existing style. Files stay focused
  (one provider/hook/lib concern per file).

## Commit and PR conventions

- Use clear, imperative commit messages (Conventional Commits welcome but
  not required).
- Describe the user-facing effect and the security/behavior implications in
  the PR description.
- Link any related issue.

## Reporting security issues

Do not open a public issue for a vulnerability. Follow the process in
[SECURITY.md](./SECURITY.md) (email security@atol.sh).

## License

By contributing, you agree that your contributions are licensed under the
Apache License 2.0, the same license that covers this project.
