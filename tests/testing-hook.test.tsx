/**
 * The `@atol-sh/react/testing` test-session seam, asserted end to end through
 * the provider + the `window.__ATOL_TEST__` hook:
 *   - installAtolTestHook publishes window.__ATOL_TEST__ and warns
 *   - with <AtolProvider allowTestSessions>, seedSession flips the provider to
 *     authenticated with the user parsed from the seeded id token
 *   - WITHOUT allowTestSessions the provider never registers, so seedSession
 *     rejects (defense in depth: both gates must align)
 *   - unmounting the provider clears the registration (guarded)
 *
 * The `@atol-sh/js` client is mocked to a controllable fake (as in the other
 * provider tests); the fake's seedTestSession emits an authenticated session,
 * exactly as the real core client does. The real core's own throw-when-off
 * guard is covered in @atol-sh/js's browser-auth-seed.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import type { TokenResponse } from '@atol-sh/js'
import { makeFakeAuth, type FakeAuth } from './fake-auth'
import { makeAccessToken, makeIDToken } from './helpers'

let fake: FakeAuth
let authFactory: () => FakeAuth = () => fake

vi.mock('@atol-sh/js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@atol-sh/js')>()
  return {
    ...actual,
    createAtolBrowserAuth: () => authFactory(),
  }
})

vi.mock('../src/lib/permissions', () => ({
  loadPermissions: vi.fn().mockResolvedValue(new Map()),
  permissionKey: (a: string, r: string) => `${a}:${r}`,
}))

import { AtolProvider } from '../src/provider'
import { useAtol } from '../src/hooks/use-atol'
import { installAtolTestHook } from '../src/testing'
import { activeTestClient } from '../src/lib/test-bridge'

type Snapshot = ReturnType<typeof useAtol>

function Harness({ onState }: { onState: (s: Snapshot) => void }) {
  onState(useAtol())
  return null
}

function renderProvider(onState: (s: Snapshot) => void, allowTestSessions = false) {
  return render(
    <AtolProvider
      keyId="atol_kid_test"
      authority="https://auth.atol.test"
      redirectUri="https://app.test/cb"
      allowTestSessions={allowTestSessions}
    >
      <Harness onState={onState} />
    </AtolProvider>,
  )
}

function seedTokens(overrides: Partial<TokenResponse> = {}): TokenResponse {
  return {
    access_token: makeAccessToken(3600),
    id_token: makeIDToken(),
    refresh_token: 'rt-seed',
    token_type: 'Bearer',
    scope: 'openid profile email offline_access',
    expires_in: 3600,
    ...overrides,
  }
}

beforeEach(() => {
  window.history.replaceState({}, '', '/')
  fake = makeFakeAuth()
  authFactory = () => fake
})

afterEach(() => {
  // Auto-cleanup unmounts the provider (which clears the bridge when it was
  // registered); drop the window hook so it never leaks across tests.
  delete window.__ATOL_TEST__
  vi.clearAllMocks()
})

describe('installAtolTestHook', () => {
  it('publishes window.__ATOL_TEST__ and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(window.__ATOL_TEST__).toBeUndefined()
    installAtolTestHook()
    expect(typeof window.__ATOL_TEST__?.seedSession).toBe('function')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toMatch(/TEST HOOK installed/)
  })
})

describe('seedSession with allowTestSessions', () => {
  it('flips the provider to authenticated with the seeded user', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let latest: Snapshot | null = null
    renderProvider((s) => (latest = s), true)
    await waitFor(() => expect(latest!.isLoading).toBe(false))
    expect(latest!.isAuthenticated).toBe(false)

    installAtolTestHook()
    await act(async () => {
      await window.__ATOL_TEST__!.seedSession(seedTokens())
    })

    await waitFor(() => expect(latest!.isAuthenticated).toBe(true))
    expect(latest!.user?.id).toBe('user-1')
    expect(fake.spies.seedTestSession).toHaveBeenCalledTimes(1)
  })

  it('registers the mounted provider client on the bridge', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let latest: Snapshot | null = null
    renderProvider((s) => (latest = s), true)
    await waitFor(() => expect(latest!.isLoading).toBe(false))
    expect(activeTestClient()).toBe(fake)
  })
})

describe('seedSession without allowTestSessions', () => {
  it('rejects because no provider is registered', async () => {
    let latest: Snapshot | null = null
    renderProvider((s) => (latest = s), false)
    await waitFor(() => expect(latest!.isLoading).toBe(false))
    expect(activeTestClient()).toBeNull()

    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    installAtolTestHook()
    await expect(window.__ATOL_TEST__!.seedSession(seedTokens())).rejects.toThrow(
      /no <AtolProvider allowTestSessions>/,
    )
    expect(fake.spies.seedTestSession).not.toHaveBeenCalled()
  })
})

describe('bridge teardown', () => {
  it('clears the registration when the provider unmounts', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let latest: Snapshot | null = null
    const { unmount } = renderProvider((s) => (latest = s), true)
    await waitFor(() => expect(latest!.isLoading).toBe(false))
    expect(activeTestClient()).toBe(fake)

    unmount()
    expect(activeTestClient()).toBeNull()
  })
})
