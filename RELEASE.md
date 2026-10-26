# Release process

`@atol-sh/react` is published from
[`.github/workflows/release.yml`](.github/workflows/release.yml) by npm
trusted publishing. Local manual publishing is not part of the normal release
path.

The package consumes `@atol-sh/js` `^0.4.0` and exposes optional device
intelligence through `@atol-sh/fingerprint` `^0.2.0`. Neither `package.json`
nor `package-lock.json` may contain a `file:` dependency.

## Coordinated release order

1. Release compatible `@atol-sh/fingerprint` 0.2.0 first, then
   `@atol-sh/js` 0.4.0. Each tag workflow must finish successfully, including
   bounded registry `dist.integrity` verification.
2. If React needs a newer fingerprint or core release, update the corresponding
   range in
   `package.json`, regenerate `package-lock.json` from npm, and confirm the
   lock resolves to `https://registry.npmjs.org/`.
3. Run the React package gates:

   ```bash
   npm ci
   npm run typecheck
   npm test
   npm run build
   npm run verify:pack
   ```

4. Update `CHANGELOG.md` and set the package version without creating a tag:
   `npm version <patch|minor|major> --no-git-tag-version --ignore-scripts`.
   Skip this command when the reviewed release version is already present.
5. Commit the qualified release tree, then create and push only its exact tag
   using the atomic path below.
6. Wait for the release workflow to verify the registry integrity before
   updating downstream consumers.

## What the tag workflow publishes

An unprivileged qualification job verifies that the tag matches
`package.json` and runs typechecking, tests, the build, `publint`, and
`are-the-types-wrong`. It has no OIDC publishing authority and installs
project dependencies with lifecycle scripts disabled.

The qualification job calls `npm pack --ignore-scripts --json` exactly once.
Before any npm command, it downloads the npm 11.18.0 registry archive,
verifies its official SHA-512, and invokes the extracted CLI directly without
a global install. It requires npm's exact one-entry array report shape,
computes SHA-512 from the resulting tarball bytes, and requires npm's pack
metadata and file count to agree.

A separate OIDC-authorized job receives only the qualified tarball. It does
not check out the repository, install project dependencies, or globally
install npm. Instead it independently repeats the exact npm 11.18.0 archive
download, SHA-512 verification, and direct-CLI bootstrap. That CLI runs
`npm pack <tarball> --dry-run
--ignore-scripts --json`; the workflow requires the exact package name,
tag-bound version, package id, expected SHA-512 and file count, one
`package.json`, no bundled dependencies, and exactly `publishConfig:
{"access":"public"}`. It then publishes the same `.tgz` bytes with provenance
and lifecycle scripts disabled to the explicit public registry and `latest`
tag.

After publish returns, the workflow polls npm for at most five minutes. The
release succeeds only when the registry's `dist.integrity` equals the recorded
tarball SHA-512.

## Exact release tag path

After the release commit is final and all package gates pass, bind its manifest
version to one annotated tag and push that commit and tag atomically:

```bash
set -euo pipefail
version="$(node -p "require('./package.json').version")"
test "$(git branch --show-current)" = "main"
test -z "$(git status --porcelain)"
! git rev-parse --verify --quiet "refs/tags/v${version}"
git tag --annotate "v${version}" --message "@atol-sh/react ${version}" HEAD
git push --atomic origin \
  HEAD:refs/heads/main \
  "refs/tags/v${version}:refs/tags/v${version}"
```

Do not update downstream consumers until the workflow has confirmed the
registry `dist.integrity`.

## Failure handling

- If build, verification, packing, or publish fails, no downstream version
  should be updated.
- If publish succeeds but registry verification times out, inspect that exact
  version on npm before doing anything else. Do not try to overwrite or
  republish an existing npm version.
- If npm reports a different integrity, stop the release and investigate the
  byte mismatch. Do not advance dependent packages.

## Trusted publisher configuration

The npm package is configured for GitHub Actions trusted publishing with:

- Organization: `atol-sh`
- Repository: `atol-sdk-react`
- Workflow filename: `release.yml`

The workflow uses GitHub OIDC and provenance. It must not use a long-lived
`NPM_TOKEN`.
