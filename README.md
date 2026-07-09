# @atol-sh/react

[![npm version](https://img.shields.io/npm/v/@atol-sh/react.svg)](https://www.npmjs.com/package/@atol-sh/react)
[![license](https://img.shields.io/npm/l/@atol-sh/react.svg)](./LICENSE)
[![CI](https://github.com/atol-sh/atol-sdk-react/actions/workflows/ci.yml/badge.svg)](https://github.com/atol-sh/atol-sdk-react/actions/workflows/ci.yml)

React SDK for [Atol](https://atol.sh) — authentication and frontend authorization in one package. One provider, one hook, one identity.

Handles OIDC login/logout, JWT token management, and permission-based UI gating. Permissions are loaded in bulk at login time for instant `can()` / `cannot()` checks with no API calls on the render path.

## Install

```bash
npm install @atol-sh/react
```

## Quick Start

### 1. Get your publishable key

Go to [console.atol.sh](https://console.atol.sh) > **Settings > API Keys**. Copy the **Key ID** (`atol_kid_...`). This is safe for frontend code.

### 2. Wrap your app

```tsx
import { AtolProvider } from '@atol-sh/react'

function App() {
  return (
    <AtolProvider
      keyId="atol_kid_abc123"
      authority="https://auth.atol.sh"
      redirectUri={window.location.origin + '/'}
      useRefreshTokens
      permissions={[
        { action: 'edit', resource: 'publication' },
        { action: 'manage', resource: 'team' },
        { action: 'view', resource: 'analytics' },
      ]}
    >
      <YourApp />
    </AtolProvider>
  )
}
```

`redirectUri` must be an allow-listed redirect URI for this app in
[console.atol.sh](https://console.atol.sh). `<AtolProvider>`'s `init()` handles
the OIDC callback in place on that URL — no dedicated `/callback` route or
component is needed.

### 3. Use the hooks

```tsx
import { useAtol, usePermissions, Can } from '@atol-sh/react'

function Dashboard() {
  const { isAuthenticated, user, login, logout } = useAtol()
  const { can } = usePermissions()

  if (!isAuthenticated) {
    return <button onClick={() => login()}>Sign in</button>
  }

  return (
    <div>
      <p>Welcome, {user.name} ({user.plan} plan)</p>
      <button onClick={logout}>Sign out</button>

      {can('edit', 'publication') && <EditButton />}

      <Can action="manage" resource="team">
        <TeamSettings />
      </Can>
    </div>
  )
}
```

## Next.js / React Server Components

The SDK is a client component (it uses React context, browser crypto, and
IndexedDB). The published bundle already carries a `"use client"` directive,
so under the Next.js App Router you just import and mount it from your own
client boundary:

```tsx
'use client'
import { AtolProvider } from '@atol-sh/react'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AtolProvider keyId="atol_kid_abc123" authority="https://auth.atol.sh" redirectUri="...">
      {children}
    </AtolProvider>
  )
}
```

Then render `<Providers>` from your root layout. Do not import the SDK into a
Server Component.

## Token Storage

Tokens live **in memory only**. The OIDC user object — access token, ID
token, and (when `useRefreshTokens` is on) the refresh token — is never
written to localStorage or sessionStorage, so persisted credentials are
not readable by a later XSS payload.

sessionStorage is used for exactly one thing: the OIDC state/PKCE
verifier, which must survive the same-tab redirect to the Atol login
page and back. It contains no tokens and is worthless after the code
exchange completes.

Because the in-memory store is empty after a page reload, the provider
transparently performs one silent renew against the Atol session cookie
on mount. Users with a live IdP session stay signed in across reloads;
everyone else settles on unauthenticated.

### Everything the browser keeps

None of it is authoritative — the Atol control plane is the source of truth.
The browser holds only what a session needs:

| What | Where | Survives reload? |
|------|-------|------------------|
| Access / ID / refresh tokens | memory only | No — re-obtained by silent renew |
| OIDC state + PKCE verifier | `sessionStorage` | Only across the login redirect; useless after |
| KEK vault (zero-knowledge encryption, when `deriveEncryptionKey`) | IndexedDB, under a device-bound non-extractable key | Yes — rehydrated on load |
| DPoP key (when `useDPoP`) | memory, per-tab non-exportable keypair | No |
| Permissions (`usePermissions`) | memory (React state) | No — re-fetched at login |

## API Reference

### `<AtolProvider>`

Mount once at the root of your app.

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `keyId` | `string` | Yes | Publishable key ID (`atol_kid_...`) |
| `authority` | `string` | Yes | OIDC issuer URL (`https://auth.atol.sh`) |
| `apiUrl` | `string` | No | Control-plane API base URL that serves permission checks and device identify. This is the API host, NOT the OIDC issuer. Device intelligence inherits it. Default: `https://api.atol.sh` |
| `redirectUri` | `string` | Yes | URL to redirect to after login |
| `scope` | `string` | No | OIDC scopes. Default: `"openid profile email"` |
| `audience` | `string` | No | API audience identifier |
| `permissions` | `PermissionCheck[]` | No | Permissions to bulk-load at login |
| `onLogin` | `(user: AtolUser) => void` | No | Called after successful login |
| `onLogout` | `() => void` | No | Called after logout |
| `onPermissionsError` | `(error: Error) => void` | No | Called when the bulk permission load fails (checks stay deny-by-default) |
| `useRefreshTokens` | `boolean` | No | Renewal strategy. Default (`false`) renews via a hidden-iframe silent authorize against the IdP session cookie (`prompt=none`) and requests/stores no refresh token. The iframe path needs the IdP session cookie in a third-party context, which Safari ITP blocks and Chrome's third-party-cookie phase-out removes, so it fails **unconditionally** for a cross-site app (UI on a different registrable domain from the IdP). Such apps **must** set `true`: this appends `offline_access` and renews via the refresh-token grant. Same-site apps (UI on a subdomain of the IdP) reach the first-party cookie in the iframe and leave it `false`. Default: `false` |
| `useRefreshTokensFallback` | `boolean` | No | On a transient refresh-grant failure, fall back to the iframe path once before surfacing the error. Default: `false` |
| `useDPoP` | `boolean` | No | Sender-constrained tokens (RFC 9449). Generates a per-tab non-exportable ES256 keypair and attaches a DPoP proof to every token-endpoint call, so a stolen refresh token cannot be redeemed elsewhere. Default: `false` |
| `deriveEncryptionKey` | `boolean` | No | Zero-knowledge encryption: ask the server to derive a KEK at login and deliver a wrapped DEK. The unwrapped DEK is exposed as `encryptionKey`. Default: `false` |
| `deviceIntelligence` | `DeviceConfig` | No | Device intelligence config (see below) |
| `allowTestSessions` | `boolean` | No | **Test only.** Enable the test-session seam so e2e tests can seed an authenticated session without a live OIDC round-trip. Gate it behind a build/env flag — it bypasses OIDC validation and must never ship enabled. Default: `false`. See [EXAMPLES.md](./EXAMPLES.md#testing-seed-a-session-in-cypress--playwright) |
| `initialTestSession` | `TokenResponse` | No | **Test only** (requires `allowTestSessions`). A token response the provider adopts on mount instead of the cold-load restore — authenticated at first paint, no OIDC round-trip and no silent-renew iframe. Preferred for route-guarded apps on a stubbed backend. See [EXAMPLES.md](./EXAMPLES.md#preferred-initialtestsession-deterministic-no-restore-iframe) |

### `useAtol()`

Primary hook. Returns auth state and methods.

```typescript
const {
  isLoading,        // true while OIDC is initializing
  isAuthenticated,  // true when user is logged in
  user,             // AtolUser | null
  error,            // Error | null
  encryptionKey,    // Uint8Array | null — unwrapped DEK (deriveEncryptionKey)
  encryptionError,  // Error | null — DEK could not be unwrapped (wrong KEK, tamper, vault error)
  device,           // DeviceState — device intelligence (see below)
  login,            // (options?: { returnTo?: string }) => Promise<void>
  logout,           // () => Promise<void>
  getAccessToken,   // () => Promise<string | undefined> — renews when stale
  forceRenew,       // () => Promise<string | undefined> — rotate now
} = useAtol()
```

`getAccessToken()` returns the current access token and silently renews
it when it is within 60s of expiry. Renewal is single-flight per tab and
coordinated across tabs (Web Locks + BroadcastChannel), so concurrent
callers and concurrent tabs never race the token endpoint.

`forceRenew()` bypasses the freshness check and rotates immediately —
useful when the server signals an out-of-band claim change.

> **Known gap:** step-up re-authentication (`stepUp`) exists on the
> `@atol-sh/js` core client but is not yet exposed through `useAtol()`.
> Apps that need to force a step-up (e.g. on a `step_up_required`
> challenge from the management API) should reach for the core client
> directly for now.

### `usePermissions()`

Permission checker for UI gating. `can()` is a synchronous Map lookup, no API call.

```typescript
const { can, cannot, isLoading, error } = usePermissions()

can('edit', 'publication')     // true if allowed
cannot('manage', 'billing')   // true if denied
```

Only permissions declared in `<AtolProvider permissions={[...]}>` are
available. Unlisted permissions return `false` (deny by default).

`error` is non-null when the bulk permission load failed. Checks still
deny, but your app can tell "user has no permissions" apart from
"permissions failed to load" and show a retry instead of a permanent
access-denied. Pair with the `onPermissionsError` provider callback.

### `useUser()`

Convenience hook — returns just the user.

```typescript
const user = useUser()
// user?.id, user?.email, user?.orgId, user?.plan, user?.roles
```

### `<Can>`

Conditionally renders children based on a permission.

```tsx
<Can action="edit" resource="publication">
  <EditButton />
</Can>

<Can action="manage" resource="billing" fallback={<UpgradePrompt />}>
  <BillingSettings />
</Can>
```

### `<ProtectedRoute>`

Route guard. Redirects to login if not authenticated, checks permission if specified.

```tsx
<ProtectedRoute>
  <Dashboard />
</ProtectedRoute>

<ProtectedRoute action="manage" resource="team" fallback={<AccessDenied />}>
  <TeamSettings />
</ProtectedRoute>
```

### `<LoginButton>` / `<LogoutButton>`

Pre-wired buttons. Pass any `<button>` props.

```tsx
<LoginButton className="btn">Sign in</LoginButton>
<LogoutButton>Sign out</LogoutButton>
```

## Zero-Knowledge Encryption

With `deriveEncryptionKey: true`, login derives a Key Encryption Key
(KEK) server-side from the user's credentials and delivers it in the
redirect URL fragment (never stored server-side in usable form). A
wrapped Data Encryption Key (DEK) rides on the ID token. The SDK unwraps
the DEK locally and exposes it:

```tsx
const { encryptionKey } = useAtol()  // Uint8Array | null (32 bytes)
```

The KEK is persisted under a device-bound, non-extractable WebCrypto key
in IndexedDB (`KEKVault`), so silent renews and page reloads rehydrate
the DEK without a password prompt. Logout wipes the vault. Lower-level
primitives (`KEKVault`, `unwrapDEK`, `extractKEKFromFragment`) are
exported for apps that want custom DEK lifetime control.

## Device Intelligence

Optional device fingerprinting and risk signals via
[`@atol-sh/fingerprint`](https://www.npmjs.com/package/@atol-sh/fingerprint)
(install it as a peer; it is lazy-loaded only when enabled — zero bundle
cost otherwise).

```tsx
<AtolProvider
  /* ... */
  deviceIntelligence={{
    enabled: true,
    apiUrl: 'https://api.atol.sh', // Atol API host (default). NOT the OIDC authority.
    collectOnMount: true,          // default
    recheckInterval: 0,            // ms; 0 disables periodic re-identify
  }}
>
```

```tsx
import { useDevice } from '@atol-sh/react'

const { deviceId, known, newDevice, confidence, platform, browser, osVersion,
        signals, loading, error } = useDevice()

if (signals?.bot || signals?.tampered) {
  // step up or block
}
```

`signals` mirrors the server's smart-signal analysis exactly:
`bot`, `vpn`, `proxy`, `tor`, `incognito`, `tampered`, `emulator`,
`rooted`, `geo_mismatch`, and `anomaly_score` (0-1 composite).

## AtolUser

The `user` object parsed from Atol JWT claims:

```typescript
interface AtolUser {
  id: string            // User ID (JWT sub)
  email: string         // Email address
  emailVerified: boolean // email_verified claim
  name: string          // Display name
  orgId: string         // Organization ID
  plan: string          // Subscription plan (e.g. "pro")
  roles: string[]       // Roles (e.g. ["admin", "editor"])
  authMethod: string    // How they authenticated (e.g. "oidc")
  mfaVerified: boolean  // MFA completed
}
```

## How It Works

1. `<AtolProvider>` initializes an OIDC client (Authorization Code + PKCE flow)
2. On login, the user is redirected to `auth.atol.sh` for authentication
3. After redirect back, the SDK exchanges the code for tokens
4. User info is parsed from JWT claims — no `/userinfo` API call needed
5. Permissions are bulk-loaded in one batch call using the publishable key
6. `can()` / `cannot()` check permissions from the pre-loaded Map (synchronous, no network)
7. Tokens are held in memory only (never localStorage/sessionStorage; sessionStorage carries just the OIDC state/PKCE verifier across the login redirect) and renewed silently — refresh-token grant when `useRefreshTokens` is on, hidden iframe otherwise. After a reload, one silent renew restores the session from the IdP cookie.

The publishable key (`atol_kid_...`) is the only credential in your frontend code — no secrets.

## Security model

Client-side permission checks (`can` / `cannot` / `<Can>` / `<ProtectedRoute>`)
are **UI gating only**. They run against claims parsed in the browser and a
permission map that browser code can read. They keep the UI coherent; they are
not an authorization boundary. Always re-authorize every privileged action on
the server, which verifies the access token from `getAccessToken()`.

Tokens are held in memory (never localStorage/sessionStorage). This defends
against persisted-credential theft and cross-origin reads. It does **not**
defend against an active same-origin attacker (XSS or untrusted embedded
script) that can read memory while present on the page — mitigate that with a
strict CSP, Trusted Types, and SRI. Cross-tab token broadcasts are
authenticated: a follower tab verifies the broadcast ID token's signature,
issuer, and audience against the IdP and pins the subject before adopting any
rotated token, and a `session-expired` signal triggers a server-verified renew
rather than a blind logout.

`mfaVerified` / `emailVerified` on `AtolUser` are convenience copies of token
claims for UI use; treat the server's view as authoritative for security
decisions.

## Troubleshooting

**`redirect_uri` mismatch.** The `redirectUri` passed to `<AtolProvider>` must
exactly match an allow-listed redirect URI for this app in
[console.atol.sh](https://console.atol.sh) > **Settings > API Keys**.

**Silent renew fails on Safari or in a cross-site embed.** The default
iframe-based renewal needs the IdP's first-party session cookie inside a
third-party iframe, which Safari ITP and Chrome's third-party-cookie
phase-out block. If your app's UI is on a different registrable domain from
the OIDC issuer, set `useRefreshTokens` so renewal uses the refresh-token
grant instead.

**DPoP silently falls back to Bearer.** `useDPoP` requires WebCrypto
(`crypto.subtle`), which is unavailable in some embedded/insecure contexts.
Check whether DPoP is actually active with the core client's
`isDPoPActive()`, or inspect whether `signDPoPProof()` returns a `proof` —
`undefined` means the call fell back to a plain Bearer token.

**Seeing a `DPoP-Nonce` challenge in the network tab.** This is expected —
the token endpoint issued a nonce challenge and the SDK automatically
retries once with the server-provided nonce. No action needed.

**Permission checks always return `false`.** Either the `action`/`resource`
pair was never declared in `<AtolProvider permissions={[...]}>` (unlisted
checks deny by default), or the bulk permission load failed. Check
`usePermissions().error` to distinguish "no permission granted" from
"permissions failed to load", and pair it with the `onPermissionsError`
provider callback.

## Requirements

- React 18+
- [Atol account](https://console.atol.sh) (15-day free trial)

## License

Apache 2.0
