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
