/**
 * AtolProvider init paths, asserted through the PROVIDER's observable
 * contract now that the session + renewal are owned by the `@atol-sh/js`
 * browser-auth client:
 *   - the provider calls auth.init() once on mount
 *   - it mirrors the client's session (authenticated/user) into React state
 *   - an init failure surfaces as error state (not a crash)
 *   - a login_required restore settles unauthenticated with no error
 *   - forceRenew / getAccessToken delegate to the client
 *
 * The client's own token-store write-back (refresh-token retained under
 * useRefreshTokens, stripped in the default iframe model) and silent-renew
 * mechanics are covered by @atol-sh/js's browser-auth.test.ts. Re-asserting
 * them here would only re-test the mock, so these tests assert the
 * delegation + state mirroring the provider is responsible for.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import * as React from 'react'
import type { AtolSession } from '@atol-sh/js'
import { makeFakeAuth, type FakeAuth } from './fake-auth'
import { makeIDToken } from './helpers'
import { atolUser } from './fixtures'

let fake: FakeAuth
// Overridable factory: each createAtolBrowserAuth() call routes here so a
// test can return fresh instances (e.g. to exercise Strict Mode recreation).
let authFactory: () => FakeAuth = () => fake

vi.mock('@atol-sh/js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@atol-sh/js')>()
  return {
    ...actual,
    createAtolBrowserAuth: () => authFactory(),
  }
})

// Permissions are out of scope here; the provider only loads them when
// `permissions` is non-empty (default []), so this is belt-and-suspenders.
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

function renderProvider(onState: (s: Snapshot) => void, useRefreshTokens = false) {
  return render(
    <AtolProvider
      keyId="atol_kid_test"
      authority="https://auth.atol.test"
      redirectUri="https://app.test/cb"
      useRefreshTokens={useRefreshTokens}
    >
      <Harness onState={onState} />
    </AtolProvider>,
  )
}

const authedSession: AtolSession = { isAuthenticated: true, user: atolUser() }

beforeEach(() => {
  window.history.replaceState({}, '', '/')
})

afterEach(() => {
  authFactory = () => fake
  vi.clearAllMocks()
})

describe('AtolProvider init', () => {
  it('calls auth.init() once on mount', async () => {
    fake = makeFakeAuth()
    let latest: Snapshot | null = null
    renderProvider((s) => (latest = s))
    await waitFor(() => expect(latest!.isLoading).toBe(false))
    expect(fake.spies.init).toHaveBeenCalledTimes(1)
  })

  it('mirrors an authenticated session into React state', async () => {
    fake = makeFakeAuth({
      initialSession: authedSession,
      accessToken: 'at_1',
      idToken: makeIDToken(),
    })
    let latest: Snapshot | null = null
    renderProvider((s) => (latest = s))

    await waitFor(() => expect(latest!.isLoading).toBe(false))
    expect(latest!.isAuthenticated).toBe(true)
    expect(latest!.user).toMatchObject({
      id: 'user-1',
      email: 'remi@example.test',
      orgId: 'org-1',
      plan: 'pro',
      roles: ['admin'],
    })
    expect(latest!.error).toBeNull()
  })

  it('surfaces an init failure as error state, not a crash', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    fake = makeFakeAuth()
    fake.spies.init.mockRejectedValue(new Error('No matching state found in storage'))

    let latest: Snapshot | null = null
    renderProvider((s) => (latest = s))

    await waitFor(() => expect(latest!.isLoading).toBe(false))
    expect(latest!.isAuthenticated).toBe(false)
    expect(latest!.error).toBeInstanceOf(Error)
    consoleSpy.mockRestore()
  })

  it('settles unauthenticated when the client restores no session', async () => {
    // login_required inside the client resolves init() to an unauthenticated
    // session (no throw) -- the provider settles signed-out with no error.
    fake = makeFakeAuth({ initialSession: { isAuthenticated: false, user: null } })

    let latest: Snapshot | null = null
    renderProvider((s) => (latest = s))

    await waitFor(() => expect(latest!.isLoading).toBe(false))
    expect(latest!.isAuthenticated).toBe(false)
    expect(latest!.error).toBeNull()
  })

  it('delegates forceRenew to the client', async () => {
    fake = makeFakeAuth({
      initialSession: authedSession,
      accessToken: 'at_1',
      idToken: makeIDToken(),
    })
    let latest: Snapshot | null = null
    renderProvider((s) => (latest = s))
    await waitFor(() => expect(latest!.isAuthenticated).toBe(true))

    await act(async () => {
      await latest!.forceRenew()
    })
    expect(fake.spies.forceRenew).toHaveBeenCalledTimes(1)
  })

  it('delegates getAccessToken to the client and returns the token', async () => {
    fake = makeFakeAuth({
      initialSession: authedSession,
      accessToken: 'at_from_client',
      idToken: makeIDToken(),
    })
    let latest: Snapshot | null = null
    renderProvider((s) => (latest = s), true)
    await waitFor(() => expect(latest!.isAuthenticated).toBe(true))

    const token = await latest!.getAccessToken()
    expect(token).toBe('at_from_client')
    expect(fake.spies.getAccessToken).toHaveBeenCalled()
  })

  it('fires onLogin once when a session becomes authenticated', async () => {
    // Start unauthenticated, then have the client emit an authenticated
    // session (a login callback completing). onLogin must fire exactly once.
    fake = makeFakeAuth({ accessToken: 'at_1', idToken: makeIDToken() })
    const onLogin = vi.fn()
    let latest: Snapshot | null = null
    render(
      <AtolProvider
        keyId="atol_kid_test"
        authority="https://auth.atol.test"
        redirectUri="https://app.test/cb"
        onLogin={onLogin}
      >
        <Harness onState={(s) => (latest = s)} />
      </AtolProvider>,
    )
    await waitFor(() => expect(latest!.isLoading).toBe(false))
    expect(onLogin).not.toHaveBeenCalled()

    await act(async () => {
      fake.authenticate(atolUser())
    })
    await waitFor(() => expect(onLogin).toHaveBeenCalledTimes(1))
    expect(onLogin).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }))
  })

  it('keeps isLoading true through the pre-init fire until restore settles', async () => {
    // The client fires onSessionChange immediately with the CURRENT
    // (pre-init, unauthenticated) session, then init() runs the silent
    // restore. isLoading must NOT flip to false on that first fire -- a
    // reload would otherwise flash "signed out" before the restore lands.
    fake = makeFakeAuth({ accessToken: 'at_restore', idToken: makeIDToken() })
    let resolveInit: (() => void) | undefined
    fake.spies.init.mockImplementation(
      () =>
        new Promise<void>((res) => {
          // Emit the authenticated session, then settle init on demand.
          fake.emit(authedSession)
          resolveInit = () => res()
        }),
    )

    const states: Array<{ loading: boolean; authed: boolean }> = []
    render(
      <AtolProvider
        keyId="atol_kid_test"
        authority="https://auth.atol.test"
        redirectUri="https://app.test/cb"
      >
        <Harness
          onState={(s) => states.push({ loading: s.isLoading, authed: s.isAuthenticated })}
        />
      </AtolProvider>,
    )

    // Before init resolves: the immediate pre-init fire must not have
    // cleared loading.
    await waitFor(() => expect(states.some((s) => s.authed)).toBe(true))
    expect(states.filter((s) => s.authed).every((s) => s.loading)).toBe(true)

    // Now settle init -> loading clears.
    await act(async () => {
      resolveInit!()
      await Promise.resolve()
    })
    await waitFor(() => {
      const last = states[states.length - 1]
      expect(last.loading).toBe(false)
      expect(last.authed).toBe(true)
    })
  })

  it('is Strict Mode-safe: destroys the throwaway client and runs on a fresh one', async () => {
    // Strict Mode mounts -> unmounts -> remounts. The effect destroys the
    // first (throwaway) client on cleanup; the provider must construct and
    // subscribe to a FRESH client on remount, not re-use the torn-down one.
    const created: FakeAuth[] = []
    authFactory = () => {
      const f = makeFakeAuth({
        initialSession: authedSession,
        accessToken: 'at_strict',
        idToken: makeIDToken(),
      })
      created.push(f)
      return f
    }

    let latest: Snapshot | null = null
    render(
      <React.StrictMode>
        <AtolProvider
          keyId="atol_kid_test"
          authority="https://auth.atol.test"
          redirectUri="https://app.test/cb"
        >
          <Harness onState={(s) => (latest = s)} />
        </AtolProvider>
      </React.StrictMode>,
    )

    await waitFor(() => expect(latest!.isAuthenticated).toBe(true))
    // Two clients created (throwaway + real); the throwaway was destroyed.
    expect(created.length).toBe(2)
    expect(created[0].spies.destroy).toHaveBeenCalled()
    // The live client (the last created) drives the session.
    expect(created.at(-1)!.spies.init).toHaveBeenCalled()
  })
})
