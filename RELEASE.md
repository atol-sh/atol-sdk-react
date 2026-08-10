# Release process

`@atol-sh/react` is published from
[`.github/workflows/release.yml`](.github/workflows/release.yml) by npm
trusted publishing. Local manual publishing is not part of the normal release
path.

The package consumes `@atol-sh/js` `^0.3.0` and exposes optional device
intelligence through `@atol-sh/fingerprint` `^0.2.0`. Neither `package.json`
nor `package-lock.json` may contain a `file:` dependency.

## Coordinated release order

1. Release compatible `@atol-sh/fingerprint` 0.2.0 first, then
   `@atol-sh/js` 0.3.0. Each tag workflow must finish successfully, including
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

4. Update `CHANGELOG.md`. For a version not already present in `package.json`,
   use `npm version <patch|minor|major>` from a clean tree. This keeps the
   committed package version and the `vX.Y.Z` tag identical. For the
   already-staged 0.5.1 recovery, use the exact same-version path below
   instead.
5. Push the commit and tag together with `git push --follow-tags`.
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

After publish returns, the workflow polls npm for at most two minutes. The
release succeeds only when the registry's `dist.integrity` equals the recorded
tarball SHA-512.

## Exact tag path for the already-staged 0.5.1 recovery

The `v0.5.0` tag already exists, and its release workflow failed before
publishing because its committed lock integrity does not match the public
`@atol-sh/js` 0.3.0 tarball. The tag is immutable release history: do not move,
delete, recreate, or reuse `v0.5.0`, even though npm has no
`@atol-sh/react` 0.5.0.

The repository already records recovery package version 0.5.1 even though that
version has not been tagged or published. Do not run `npm version` for this
release. Regenerate the React lock from the registry-verified fingerprint 0.2.0
and core 0.3.0 artifacts, then run all package gates.
After all 0.5.1 source, tests, packed documentation, and changelog content are
final, create one frozen release commit on `main`. Verify that npm still has no
0.5.1 and Git has no `v0.5.1` tag.

From the clean checkout of that exact commit, bind the existing manifest
version to the tag without modifying package files:

```bash
version="$(node -p "require('./package.json').version")"
test "$version" = "0.5.1"
test "$(git branch --show-current)" = "main"
test -z "$(git status --porcelain)"
! git rev-parse --verify --quiet "refs/tags/v${version}"
git tag --annotate "v${version}" --message "@atol-sh/react ${version}" HEAD
git push --atomic origin \
  HEAD:refs/heads/main \
  "refs/tags/v${version}:refs/tags/v${version}"
```

The atomic push ensures the tag cannot reach the release workflow without the
frozen commit it names. Do not update downstream consumers until the workflow
has confirmed the registry `dist.integrity`.

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
