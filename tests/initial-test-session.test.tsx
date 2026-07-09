/**
 * `initialTestSession` prop, exercised end to end through the REAL
 * `@atol-sh/js` client (this file deliberately does NOT mock it). The provider
 * threads the prop into `createAtolBrowserAuth`, whose `init()` adopts the
 * token and skips the cold-load restore -- so the app settles AUTHENTICATED at
 * first paint with no silent-renew iframe. The core's own gating/skip behavior
 * (ignored without allowTestSessions; restore skipped) is covered in
 * `@atol-sh/js`'s browser-auth-seed.test.ts; here we assert the binding wires
 * it up and React reflects the authenticated session.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import type { TokenResponse } from '@atol-sh/js'
import { makeAccessToken, makeIDToken } from './helpers'

vi.mock('../src/lib/permissions', () => ({
  loadPermissions: vi.fn().mockResolvedValue(new Map()),
  permissionKey: (a: string, r: string) => `${a}:${r}`,
}))

import { AtolProvider } from '../src/provider'
import { useAtol } from '../src/hooks/use-atol'

type Snapshot = ReturnType<typeof useAtol>

function Harness({ onState }: { onState: (s: Snapshot) => void }) {
  onState(useAtol())
  return null
}

function tokens(overrides: Partial<TokenResponse> = {}): TokenResponse {
  return {
    access_token: makeAccessToken(3600),
    id_token: makeIDToken(),
    token_type: 'Bearer',
    scope: 'openid profile email',
    expires_in: 3600,
    ...overrides,
  }
}

describe('AtolProvider initialTestSession', () => {
  it('settles authenticated at first paint with no restore iframe', async () => {
    let latest: Snapshot | null = null
    render(
      <AtolProvider
        keyId="atol_kid_test"
        authority="https://auth.atol.test"
        redirectUri="https://app.test/cb"
        allowTestSessions
        initialTestSession={tokens()}
      >
        <Harness onState={(s) => (latest = s)} />
      </AtolProvider>,
    )
    // If the restore iframe ran (it must not), init would block on the silent
    // authorize until timeout and this waitFor would fall over rather than
    // resolve promptly.
    await waitFor(() => expect(latest!.isLoading).toBe(false))
    expect(latest!.isAuthenticated).toBe(true)
    expect(latest!.user?.id).toBe('user-1')
    expect(latest!.error).toBeNull()
  })
})
