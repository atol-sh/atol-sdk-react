/**
 * Logout flow, asserted through the PROVIDER's observable contract.
 *
 * The RP-Initiated Logout mechanics (revoke the refresh token, send
 * id_token_hint, validate post_logout_redirect_uri, and stay unblocked when
 * the user lookup fails) now live in the `@atol-sh/js` browser-auth client
 * and are covered by its browser-auth.test.ts. The provider's job is to
 * delegate to auth.logout(), fire the onLogout callback, and reset its own
 * derived React state -- which is what these tests assert.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import * as React from 'react'
import type { AtolSession } from '@atol-sh/js'
import { makeFakeAuth, type FakeAuth } from './fake-auth'
import { makeIDToken } from './helpers'
import { atolUser } from './fixtures'

let fake: FakeAuth

vi.mock('@atol-sh/js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@atol-sh/js')>()
  return {
    ...actual,
    createAtolBrowserAuth: () => fake,
  }
})

vi.mock('../src/lib/permissions', () => ({
  loadPermissions: vi.fn().mockResolvedValue(new Map()),
  permissionKey: (a: string, r: string) => `${a}:${r}`,
}))

import { AtolProvider } from '../src/provider'
import { useAtol } from '../src/hooks/use-atol'

const authedSession: AtolSession = { isAuthenticated: true, user: atolUser() }

type Snapshot = ReturnType<typeof useAtol>

function Harness({ onReady }: { onReady: (s: Snapshot) => void }) {
  const state = useAtol()
  React.useEffect(() => {
    onReady(state)
  })
  return null
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('AtolProvider.logout()', () => {
  it('delegates to the client and fires onLogout', async () => {
    fake = makeFakeAuth({ initialSession: authedSession, accessToken: 'at', idToken: makeIDToken() })
    const onLogout = vi.fn()
    let latest: Snapshot | null = null
    render(
      <AtolProvider
        keyId="atol_kid_test"
        authority="https://atol.test"
        redirectUri="https://app.test/cb"
        onLogout={onLogout}
      >
        <Harness onReady={(s) => (latest = s)} />
      </AtolProvider>,
    )
    await waitFor(() => expect(latest!.isAuthenticated).toBe(true))

    await act(async () => {
      await latest!.logout()
    })

    expect(fake.spies.logout).toHaveBeenCalledTimes(1)
    expect(onLogout).toHaveBeenCalledTimes(1)
  })

  it('resets auth + permission + encryption state on logout', async () => {
    fake = makeFakeAuth({ initialSession: authedSession, accessToken: 'at', idToken: makeIDToken() })
    let latest: Snapshot | null = null
    render(
      <AtolProvider
        keyId="atol_kid_test"
        authority="https://atol.test"
        redirectUri="https://app.test/cb"
      >
        <Harness onReady={(s) => (latest = s)} />
      </AtolProvider>,
    )
    await waitFor(() => expect(latest!.isAuthenticated).toBe(true))

    await act(async () => {
      await latest!.logout()
    })

    await waitFor(() => expect(latest!.isAuthenticated).toBe(false))
    expect(latest!.user).toBeNull()
    expect(latest!.permissions.size).toBe(0)
    expect(latest!.encryptionKey).toBeNull()
  })

  it('returns a promise so callers can await it', async () => {
    fake = makeFakeAuth({ initialSession: authedSession, accessToken: 'at', idToken: makeIDToken() })
    let latest: Snapshot | null = null
    render(
      <AtolProvider
        keyId="atol_kid_test"
        authority="https://atol.test"
        redirectUri="https://app.test/cb"
      >
        <Harness onReady={(s) => (latest = s)} />
      </AtolProvider>,
    )
    await waitFor(() => expect(latest!.isAuthenticated).toBe(true))

    await act(async () => {
      const r = latest!.logout()
      expect(typeof (r as Promise<unknown>).then).toBe('function')
      await r
    })
    expect(fake.spies.logout).toHaveBeenCalledTimes(1)
  })
})
