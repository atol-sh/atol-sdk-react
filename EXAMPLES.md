# Examples

Runnable snippets for `@atol-sh/react`. Each covers one export from `src/index.ts`.

## AtolProvider setup

```tsx
import { AtolProvider } from '@atol-sh/react'

function App() {
  return (
    <AtolProvider
      keyId="atol_kid_abc123"
      authority="https://auth.atol.sh"
      apiUrl="https://api.atol.sh"
      redirectUri={window.location.origin + '/'}
      useRefreshTokens
      useDPoP
      permissions={[
        { action: 'edit', resource: 'publication' },
        { action: 'manage', resource: 'team' },
      ]}
      onLogin={(user) => console.log('logged in', user.id)}
      onLogout={() => console.log('logged out')}
      onPermissionsError={(err) => console.error('permission load failed', err)}
    >
      <YourApp />
    </AtolProvider>
  )
}
```

`redirectUri` must be an allow-listed redirect URI in console.atol.sh.
`<AtolProvider>` handles the OIDC callback on that URL itself — no
dedicated `/callback` route needed.

## useAtol: login / logout

```tsx
import { useAtol } from '@atol-sh/react'

function LoginPanel() {
  const { isLoading, isAuthenticated, user, error, login, logout, getAccessToken } = useAtol()

  if (isLoading) return <p>Loading...</p>
  if (error) return <p>Auth error: {error.message}</p>

  if (!isAuthenticated) {
    return <button onClick={() => login({ returnTo: '/dashboard' })}>Sign in</button>
  }

  async function callApi() {
    const token = await getAccessToken()
    await fetch('https://api.atol.sh/v1/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
  }

  return (
    <div>
      <p>Signed in as {user!.email}</p>
      <button onClick={callApi}>Call API</button>
      <button onClick={() => logout()}>Sign out</button>
    </div>
  )
}
```

## usePermissions + Can + ProtectedRoute

```tsx
import { usePermissions, Can, ProtectedRoute } from '@atol-sh/react'

function Toolbar() {
  const { can, cannot, error } = usePermissions()

  if (error) {
    // bulk permission load failed; distinct from "denied"
    return <p>Could not load permissions. Retry?</p>
  }

  return (
    <div>
      {can('edit', 'publication') && <button>Edit</button>}
      {cannot('manage', 'billing') && <p>Upgrade to manage billing.</p>}

      <Can action="manage" resource="team" fallback={<p>No team access.</p>}>
        <TeamSettings />
      </Can>
    </div>
  )
}

function App() {
  return (
    <ProtectedRoute action="manage" resource="team" fallback={<p>Access denied.</p>}>
      <Toolbar />
    </ProtectedRoute>
  )
}
```

`<ProtectedRoute>` without `action`/`resource` only enforces authentication
(redirects to login when signed out):

```tsx
<ProtectedRoute>
  <Dashboard />
</ProtectedRoute>
```

## useDPoP (signDPoPProof)

There is no separate `useDPoP` hook — pass `useDPoP` to `<AtolProvider>` and
use `signDPoPProof` from `useAtol()` to attach a proof to calls against your
own resource server:

```tsx
import { useAtol } from '@atol-sh/react'

function useProtectedFetch() {
  const { signDPoPProof } = useAtol()

  return async (url: string) => {
    const result = await signDPoPProof('GET', url)
    if (!result) throw new Error('not authenticated')

    const { token, proof } = result
    const headers = proof
      ? { Authorization: `DPoP ${token}`, DPoP: proof }
      : { Authorization: `Bearer ${token}` }

    return fetch(url, { headers })
  }
}
```

`proof` is `undefined` when `useDPoP` is off or WebCrypto is unavailable —
the snippet above falls back to plain `Bearer` automatically.

## useDevice with @atol-sh/fingerprint

`@atol-sh/fingerprint` is an optional peer dependency, lazy-loaded only when
`deviceIntelligence.enabled` is set:

```bash
npm install @atol-sh/fingerprint
```

```tsx
import { AtolProvider, useDevice } from '@atol-sh/react'

function App() {
  return (
    <AtolProvider
      keyId="atol_kid_abc123"
      authority="https://auth.atol.sh"
      redirectUri={window.location.origin + '/'}
      deviceIntelligence={{
        enabled: true,
        apiUrl: 'https://api.atol.sh',
        collectOnMount: true,
        recheckInterval: 0,
      }}
    >
      <RiskGate />
    </AtolProvider>
  )
}

function RiskGate() {
  const { deviceId, known, newDevice, confidence, signals, loading, error } = useDevice()

  if (loading) return null
  if (error) return <p>Device check failed.</p>

  if (signals?.bot || signals?.tampered) {
    return <p>Additional verification required.</p>
  }

  return <p>Device {deviceId} — known: {String(known)}, new: {String(newDevice)}, confidence: {confidence}</p>
}
```

## Next.js App Router

The published bundle ships a `"use client"` directive, so `<AtolProvider>`
can be imported straight into a client boundary — mount it once from a
client component and render that from your root layout:

```tsx
// app/providers.tsx
'use client'
import { AtolProvider } from '@atol-sh/react'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AtolProvider
      keyId="atol_kid_abc123"
      authority="https://auth.atol.sh"
      redirectUri={typeof window !== 'undefined' ? window.location.origin + '/' : ''}
    >
      {children}
    </AtolProvider>
  )
}
```

```tsx
// app/layout.tsx
import { Providers } from './providers'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
```

Do not import `@atol-sh/react` into a Server Component — it uses React
context, browser crypto, and IndexedDB, all client-only.

## Testing: seed a session in Cypress / Playwright

Tokens live in an in-memory store, so an e2e test cannot prime
`sessionStorage` to fake a login, and a full OIDC redirect is slow and flaky
against a stubbed backend. The `@atol-sh/react/testing` seam bootstraps an
authenticated session directly from a token response — no IdP round-trip,
works with route guards (`<ProtectedRoute>`) and a stubbed backend.

It is **test-only**. The one security boundary is the provider's
`allowTestSessions` flag: it defaults to `false` and the underlying core
throws while it is off, so the seam is inert in production as long as you never
enable it there. `installAtolTestHook()` is a convenience that exposes
`window.__ATOL_TEST__` — not a second security gate — so gate
`allowTestSessions` itself behind a build/env flag.

1. Render `<AtolProvider allowTestSessions>` — gate the flag behind a build/env
   flag so it is never on in a production bundle.
2. Call `installAtolTestHook()` once from your test-build **app entry** to
   publish `window.__ATOL_TEST__`.

```tsx
// src/main.tsx (or a test-only entry)
import { installAtolTestHook } from '@atol-sh/react/testing'

const testMode = import.meta.env.MODE === 'test' // however you flag test builds
if (testMode) installAtolTestHook()

createRoot(document.getElementById('root')!).render(
  <AtolProvider
    keyId="atol_kid_abc123"
    authority="https://auth.atol.sh"
    redirectUri={window.location.origin + '/'}
    allowTestSessions={testMode}
  >
    <App />
  </AtolProvider>,
)
```

```ts
// cypress: after cy.visit(), flip to authenticated with no IdP round-trip
cy.visit('/')
cy.window().then((w) =>
  w.__ATOL_TEST__!.seedSession({
    access_token,
    id_token,
    refresh_token,
    token_type: 'Bearer',
    scope: 'openid profile email offline_access',
    expires_in: 3600,
  }),
)
// the app is now authenticated; ProtectedRoute renders its children
```

The seam skips OIDC signature/state/nonce checks, which is safe only because
your API still validates the presented token server-side; never enable it in
production.

**Gotchas**

- **Give the access token a future `exp`.** Use a token minted by your test
  IdP / mock issuer (the one your specs already use). A token with a past or
  missing `exp` makes the client attempt an immediate renewal the hermetic
  environment cannot satisfy, which can flip the seeded session straight back
  to signed-out. `seedSession` logs a `console.warn` when it sees this.
- **Same realm.** `installAtolTestHook()` and `<AtolProvider>` must run in the
  same window — your application-under-test bundle. Installing the hook from a
  Cypress spec/support file (the runner's realm) leaves the bridge empty and
  `seedSession` rejects with "no provider mounted". Install it from the app
  entry, gated on the test flag.
- **One provider.** The bridge tracks a single mounted
  `<AtolProvider allowTestSessions>`; mount one (the usual shape for an app
  under test).
