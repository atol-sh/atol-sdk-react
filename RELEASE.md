# Release Process

`@atol-sh/react` depends on `@atol-sh/js` (currently `file:../atol-sdk-js`
in `package.json`). This repo **cannot** publish or go green on CI until
that dependency is flipped to a published npm range, because a `file:`
dependency does not resolve on a CI runner or for an end-user `npm install`.

Release order:

## 1. Publish `@atol-sh/js` first

See `atol-sdk-js/RELEASE.md` for that package's own release steps. It must
land on npm before anything below can work.

## 2. Flip the dependency in this repo

Once `@atol-sh/js` has a published version:

1. In `package.json`, change:
   ```json
   "@atol-sh/js": "file:../atol-sdk-js"
   ```
   to a real semver range matching the published version, e.g.:
   ```json
   "@atol-sh/js": "^0.1.0"
   ```
2. Run `npm install` to update `package-lock.json`.
3. Run `npm run typecheck && npm test && npm run build` to confirm nothing
   broke against the published package.
4. Commit.

**This repo's CI and release workflow cannot go green until this step is
done.** `npm ci` on a GitHub Actions runner has no access to a sibling
`../atol-sdk-js` checkout, so the `file:` dependency fails to resolve.

## 3. Bootstrap the package on npm

Same bootstrap as the other Atol SDK packages:

1. Manual first publish: `npm publish --access public` from a local
   checkout, to create the package on npm (trusted publishing requires the
   package to already exist).
2. Configure the GitHub Actions trusted publisher on npmjs.com:
   - org: `atol-sh`
   - repo: `atol-sdk-react`
   - workflow filename: `release.yml`
3. Harden the npm package settings: require 2FA for publishing, disallow
   classic tokens.

> **Repository visibility.** `atol-sdk-react` is private for now.
> `npm publish --provenance` and trusted publishing's automatic provenance
> require a public repo, so make the repo public before the first tag-driven
> release (ideally before the manual bootstrap publish, so the first version
> also carries a provenance badge).

## 4. Thereafter: tag-driven releases

Once bootstrapped, every release is:

1. Update `CHANGELOG.md` for the new version and commit it (`npm version`
   needs a clean tree).
2. Run `npm version <patch|minor|major>`. This bumps `package.json`, commits,
   and creates a matching `vX.Y.Z` tag in one atomic step, so the version and
   the tag can never drift — the `release.yml` guard that checks tag ==
   `package.json` version will always pass.
3. Push both together: `git push --follow-tags`.

`.github/workflows/release.yml` publishes keylessly with provenance via
npm trusted publishing — no long-lived npm token in CI.

## Summary

| Step | Blocks on |
|------|-----------|
| 1. Publish `@atol-sh/js` | Nothing — do this first |
| 2. Flip `@atol-sh/js` dependency here, install, verify, commit | Step 1 |
| 3. Bootstrap `@atol-sh/react` on npm (manual publish + trusted publisher + hardening) | Step 2 |
| 4. Tag-driven releases (`release.yml`) | Step 3 |
