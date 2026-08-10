# Changelog

All notable changes to `@atol-sh/react` are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] - Staged, unpublished

This staged release consolidates every change since the last published version,
0.3.3. It has no publication date or release tag because registry publication
and integrity verification have not completed.

### Added

- `responseVault` forwards the public response-vault v1 authorization profile
  to the core client, including discovery registration validation and
  navigation-channel-safe response delivery.
- `postLogoutRedirectUri` is forwarded to the core browser-auth client so
  applications can keep authorization callbacks and signed-out landings on
  distinct registered routes. Ordinary authorization defaults it to
  `redirectUri`; response-vault authorization requires an explicit distinct
  route.

### Changed

- Organization scope is exposed as `useAtol().organizationId`, sourced from
  the core client's atomic `AtolSession` credential context instead of
  `AtolUser` profile data.
- `AtolUser` no longer exposes organization, plan, or role fields.
- `useAtol().selectOrganization(organizationId)` delegates to the core
  client's atomic credential transaction and returns its verified session.
- Public action failures now reject with bounded `AtolDiagnosticError` codes.
  Core exceptions, callback/resource URLs, and caught values are discarded.
- Type checking now covers tests and fakes as well as production source.
- Requires `@atol-sh/js` `^0.3.0`. Earlier core releases do not implement the
  response-vault config or its fail-closed discovery and settlement contract;
  this range also includes the grant-bound organization-selection and
  lifecycle protections staged for the same coordinated release.
- Device identification now acquires the Bearer token or DPoP token/proof pair
  atomically from the core client for the exact identify URL. React passes only
  a non-secret credential generation and operation-scoped owner to the device
  layer, so bound tokens cannot be downgraded or retained in device state.
- Published device state is tagged with its credential generation and API host.
  Rendering hides old-session and old-region state synchronously, before
  passive cleanup effects run.

### Fixed

- Configured permission checks now fail closed without calling AccessService
  when the current credential is not scoped to an organization. Permission
  results are cleared before every credential transition so a prior
  organization's grants cannot survive a failed or superseded reload.
- DPoP permission loads reject before fetch if an organization transition
  changes the token while its proof is being produced, preventing a token-A
  request from carrying a proof bound to token B.
- Starting manual logout synchronously invalidates deferred session work, so
  late permission results cannot restore grants or fire `onLogin`.
- `onLogout` now fires exactly once for both manual and passive authenticated
  to unauthenticated transitions.
- A second active provider can no longer replace the credential-owning client.
  A different client whose teardown is already pending is destroyed before
  replacement; a genuine Strict Mode remount still adopts the exact client.
  Failed teardown retains a poisoned ownership slot, blocks replacement with
  `provider_client_cleanup_failed`, and retries only incomplete cleanup steps.
- Synchronous subscription or initialization setup now rolls back its acquired
  client immediately. Subscription teardown releases client custody in a
  `finally` path and exposes only `provider_client_cleanup_failed`.
- Opt-in test-session bridge registration is part of the same acquisition
  transaction; a rejected registration cannot strand an active client slot.

### Security

- The provider inherits the core client's durable signed-out tombstone:
  reloads cannot silently restore an IdP session after logout, even without
  `BroadcastChannel`, and only an explicit `login()` starts fresh authority.
- `logout()` continues to clear React credential-derived state immediately
  while propagating refresh revocation, lifecycle cleanup, or end-session
  failures to the caller as the closed `logout_failed` diagnostic.

## [0.3.3] - 2026-07-19

### Fixed

- React 18 and 19 Strict Mode no longer create two independent browser-auth clients
  that race consumption of the single-use OIDC callback state. The provider
  reuses one client across the synchronous development double-mount, defers
  teardown until a real unmount, and keeps the test-session bridge aligned
  with that lifecycle.
- Strict Mode client reuse now treats each `initialTestSession` token response
  as part of client identity without serializing its credential material.

## [0.3.2] - 2026-07-08

### Added

- `initialTestSession` prop on `<AtolProvider>` (requires `allowTestSessions`).
  The provider adopts the given token response during mount instead of the
  cold-load restore, so a browser e2e test renders authenticated at first paint
  with no OIDC round-trip and no silent-renew iframe. Preferred over seeding via
  `@atol-sh/react/testing` after mount when you control the provider config:
  deterministic and race-free, and it avoids the restore iframe that blocks
  against a stubbed backend with no IdP. Re-exports the `TokenResponse` type.
  Requires `@atol-sh/js` >= 0.1.2.

### Changed

- Require `@atol-sh/js` `^0.1.2` (was `^0.1.1`) for `initialTestSession`.

## [0.3.1] - 2026-07-08

### Added

- Test-session seam (`@atol-sh/react/testing`): `installAtolTestHook()`
  publishes `window.__ATOL_TEST__.seedSession(tokens)`, which establishes an
  authenticated session in a mounted `<AtolProvider allowTestSessions>`
  directly from a token response — no OIDC redirect, no live IdP round-trip.
  This restores browser e2e testing (Cypress/Playwright) against the
  in-memory token store, where priming `sessionStorage` no longer works. New
  `allowTestSessions` prop on `<AtolProvider>` (default `false`); the seam
  ships on its own subpath so its `window` glue stays out of app bundles that
  never import it. Test-only: the sole security boundary is
  `allowTestSessions` (off by default, core throws when disabled), so it is
  inert in production. Requires `@atol-sh/js` >= 0.1.1 (`seedTestSession`).
  See `EXAMPLES.md`.

### Changed

- Require `@atol-sh/js` `^0.1.1` (was `^0.1.0`): the `./testing` seam depends
  on `seedTestSession`, added in that release.

## [0.3.0] - 2026-07-05

### Added

- `signDPoPProof(method, url)`: dedicated resource-server proof accessor,
  returning `{ token, proof? }` so a host app can attach an RFC 9449 proof
  (or a plain Bearer token when DPoP is off or WebCrypto is unavailable) to
  its own resource-server calls, without overloading `getAccessToken()`.

### Fixed

- Cross-tab DPoP refresh: a follower tab no longer adopts the leader's
  key-bound broadcast refresh token, which previously failed
  `ErrDPoPKeyMismatch` on the next renew and poisoned the single-use
  rotation chain, logging both tabs out.

## [0.2.0] - 2026-06-20

Open-source and npm-readiness pass: security hardening, correctness fixes,
packaging, and OSS hygiene.

### Added

- DPoP applied to the AccessService permission call (`ath` binding) plus
  server-nonce retry.
- `apiUrl` config: control-plane API base (default `https://api.atol.sh`).
  Permission checks call `AccessService` on this host, not the OIDC issuer.
- `encryptionError` state: distinguishes a failed DEK unwrap (wrong KEK,
  tamper, vault error) from "encryption disabled".
- Package metadata for npm publishing: `exports` map with per-format types
  + default + `./package.json`, `engines`, `author`, `NOTICE`,
  `prepublishOnly` running tests, `AtolHookValue` type.
- OSS hygiene: CONTRIBUTING, CODE_OF_CONDUCT, NOTICE, issue/PR templates,
  README badges plus security-model and App Router notes.

### Changed

- `loadPermissions` targets the control-plane API host (new `apiUrl` prop),
  not the OIDC authority.
- Permissions reload on every token renewal, so server-side grants and
  revocations take effect within a session.
- Trimmed `DeviceProvider`/`PermissionResult` from the public surface.

### Fixed

- Cross-tab broadcast ID tokens are now verified (signature/`iss`/`aud` via
  `jose`) and the subject pinned before adoption; a `session-expired`
  broadcast triggers a server-verified renew instead of a blind logout.
- `BatchCheckAccess` response length is validated (deny-by-default
  integrity).
- Deterministic base64 validation and KEK length check for the DEK unwrap
  path.
- SSR-safe lazy `UserManager`; `DeviceProvider` re-identifies on token
  rotation.
- CI: added `@vitest/coverage-v8` dependency.

## [0.1.0] - 2026-06-09

Initial release.

### Added

- `<AtolProvider>`: OIDC authentication (Authorization Code + PKCE) via
  `oidc-client-ts`, JWT claim parsing into `AtolUser`, bulk permission
  loading, and silent token renewal.
- In-memory token storage: access, ID, and refresh tokens never touch
  localStorage or sessionStorage. sessionStorage holds only the OIDC
  state/PKCE verifier needed across the login redirect. After a page
  reload the provider silently re-establishes the session from the IdP
  session cookie.
- `useRefreshTokens` / `useRefreshTokensFallback`: refresh-token grant
  renewal (works under third-party cookie phaseout), with optional
  iframe fallback. Cross-tab renewal coordination via `navigator.locks`
  + `BroadcastChannel` to avoid refresh-token reuse detection races.
- `useDPoP`: sender-constrained tokens (RFC 9449) with a per-tab
  non-exportable ES256 keypair. DPoP proofs are attached to the token
  endpoint AND to the permission-check (AccessService) call with an `ath`
  binding, and the client handles the server `use_dpop_nonce` challenge.
- `apiUrl` config: control-plane API base (default `https://api.atol.sh`).
  Permission checks call `AccessService` on this host, not the OIDC issuer.
  Device intelligence inherits it.
- Authenticated cross-tab token adoption: a follower tab verifies the
  broadcast ID token's signature, issuer, and audience against the IdP
  JWKS (via `jose`) and pins the subject before adopting rotated tokens;
  a `session-expired` broadcast triggers a server-verified renew rather
  than a blind logout.
- Permissions reload on every token renewal, so server-side grants and
  revocations take effect within a session (including via `forceRenew()`).
- `encryptionError` state: distinguishes a failed DEK unwrap (wrong KEK,
  tamper, vault error) from "encryption disabled".
- Ships a `"use client"` directive for Next.js App Router / RSC consumers.
- `deriveEncryptionKey`: zero-knowledge encryption key derivation. KEK
  delivered via URL fragment, DEK unwrapped client-side, persisted in a
  device-bound IndexedDB vault (`KEKVault`), exposed as `encryptionKey`.
- `forceRenew()`: on-demand token rotation bypassing the freshness check.
- Hooks: `useAtol`, `usePermissions` (with `error` flag distinguishing
  "no permissions" from "failed to load"), `useUser`, `useDevice`.
- Components: `<Can>`, `<ProtectedRoute>`, `<LoginButton>`, `<LogoutButton>`.
- `onPermissionsError` callback for permission-load failures (checks
  remain deny-by-default).
- Device intelligence: optional `@atol-sh/fingerprint` integration
  (lazy-loaded). `deviceIntelligence.apiUrl` selects the Atol API host
  (default `https://api.atol.sh`). Mapped state mirrors the server
  identify contract: `deviceId`, `known`, `confidence`, `newDevice`,
  `platform`, `browser`, `osVersion`, and smart signals
  (`bot`, `vpn`, `proxy`, `tor`, `incognito`, `tampered`, `emulator`,
  `rooted`, `geo_mismatch`, `device_mismatch`, `device_shared`,
  `shared_user_count`, `anomaly_score`).
