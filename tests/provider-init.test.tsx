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
import type { AtolSession, TokenResponse } from '@atol-sh/js'
import { makeFakeAuth, type FakeAuth } from './fake-auth'
import { makeIDToken } from './helpers'
import { atolSession, atolUser, ORGANIZATION_ID } from './fixtures'

let fake: FakeAuth
// Overridable factory: each createAtolBrowserAuth() call routes here so a
// test can return fresh instances (e.g. to exercise Strict Mode recreation).
let authFactory: (config?: unknown) => FakeAuth = () => fake

vi.mock('@atol-sh/js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@atol-sh/js')>()
  return {
    ...actual,
    createAtolBrowserAuth: (config: unknown) => authFactory(config),
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

function ownErrorValues(error: Error | null): string {
  if (!error) throw new Error('expected an Error')
  return Object.getOwnPropertyNames(error)
    .map((name) => String(Reflect.get(error, name)))
    .join('\n')
}

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

const authedSession: AtolSession = atolSession()
const OTHER_ORGANIZATION_ID = '01KV4BNVMVG66Q04WGMMD6W4PB'
const THIRD_ORGANIZATION_ID = '01KV4BNVMPYVAA6Q88CXJKSZJM'

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

  it('forwards the response-vault profile and distinct logout landing', async () => {
    fake = makeFakeAuth()
    let captured: Record<string, unknown> | undefined
    authFactory = (config) => {
      captured = config as Record<string, unknown>
      return fake
    }

    let latest: Snapshot | null = null
    render(
      <AtolProvider
        keyId="atol_kid_test"
        authority="https://id.app.test"
        redirectUri="https://app.test/callback"
        postLogoutRedirectUri="https://app.test/signed-out"
        audience="https://api.app.test"
        responseVault
        useDPoP
      >
        <Harness onState={(s) => (latest = s)} />
      </AtolProvider>,
    )

    await waitFor(() => expect(latest!.isLoading).toBe(false))
    expect(captured).toMatchObject({
      redirectUri: 'https://app.test/callback',
      postLogoutRedirectUri: 'https://app.test/signed-out',
      audience: 'https://api.app.test',
      responseVault: true,
      dpop: true,
    })
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
    expect(latest!.organizationId).toBe(ORGANIZATION_ID)
    expect(latest!.user).toMatchObject({
      id: 'user-1',
      email: 'remi@example.test',
      name: 'Remi',
      authMethod: 'oidc',
      mfaVerified: true,
    })
    expect(latest!.user).not.toHaveProperty('orgId')
    expect(latest!.user).not.toHaveProperty('plan')
    expect(latest!.user).not.toHaveProperty('roles')
    expect(latest!.error).toBeNull()
  })

  it('surfaces an init failure as error state, not a crash', async () => {
    const sentinel = 'sentinel-secret-auth-init'
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    fake = makeFakeAuth()
    fake.spies.init.mockRejectedValue(
      new Error(
        `No matching state for https://app.test/cb?code=${sentinel}`,
      ),
    )

    let latest: Snapshot | null = null
    renderProvider((s) => (latest = s))

    await waitFor(() => expect(latest!.isLoading).toBe(false))
    expect(latest!.isAuthenticated).toBe(false)
    expect(latest!.error).toMatchObject({
      name: 'AtolDiagnosticError',
      code: 'auth_initialization_failed',
      message:
        'Authentication could not be initialized. Retry sign-in.',
    })
    expect(latest!.error).not.toHaveProperty('cause')
    expect(JSON.stringify(latest!.error)).not.toContain(sentinel)
    expect(String(latest!.error)).not.toContain(sentinel)
    expect(ownErrorValues(latest!.error)).not.toContain(sentinel)
    expect(consoleSpy).toHaveBeenCalledWith(
      '[Atol] auth init failed (auth_initialization_failed): Authentication could not be initialized. Retry sign-in.',
    )
    expect(
      consoleSpy.mock.calls.every(
        (args) =>
          args.length === 1 && typeof args[0] === 'string',
      ),
    ).toBe(true)
    expect(consoleSpy.mock.calls.flat().join('\n')).not.toContain(
      sentinel,
    )
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

  it('surfaces token acquisition failure without retaining the thrown value', async () => {
    const sentinel = 'sentinel-secret-token-error'
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {})
    fake = makeFakeAuth({
      initialSession: authedSession,
      accessToken: 'at_1',
      idToken: makeIDToken(),
    })
    fake.spies.getAccessToken.mockRejectedValue(
      new Error(`token ${sentinel} could not be renewed`),
    )

    let latest: Snapshot | null = null
    renderProvider((state) => (latest = state))

    await waitFor(() =>
      expect(latest!.error).toMatchObject({
        code: 'session_token_unavailable',
        message:
          'The session access token is unavailable. Sign in again.',
      }),
    )
    expect(latest!.error).not.toHaveProperty('cause')
    expect(JSON.stringify(latest!.error)).not.toContain(sentinel)
    expect(String(latest!.error)).not.toContain(sentinel)
    expect(ownErrorValues(latest!.error)).not.toContain(sentinel)
    expect(
      consoleSpy.mock.calls.every(
        (args) =>
          args.length === 1 && typeof args[0] === 'string',
      ),
    ).toBe(true)
    expect(consoleSpy.mock.calls.flat().join('\n')).not.toContain(
      sentinel,
    )
    consoleSpy.mockRestore()
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

  it('selects an organization through the core atomic credential operation', async () => {
    fake = makeFakeAuth({
      initialSession: authedSession,
      accessToken: 'at_first',
      idToken: makeIDToken(),
    })
    fake.selectOrganization = vi.fn(async (organizationId: string) => {
      const selected = atolSession({ organizationId })
      fake.emit(selected)
      return selected
    })

    let latest: Snapshot | null = null
    renderProvider((s) => (latest = s))
    await waitFor(() => expect(latest!.organizationId).toBe(ORGANIZATION_ID))

    expect(latest!.selectOrganization).toBeTypeOf('function')
    let selected: AtolSession | undefined
    await act(async () => {
      selected = await latest!.selectOrganization(OTHER_ORGANIZATION_ID)
    })

    expect(fake.selectOrganization).toHaveBeenCalledWith(OTHER_ORGANIZATION_ID)
    expect(selected!.organizationId).toBe(OTHER_ORGANIZATION_ID)
    expect(latest!.organizationId).toBe(OTHER_ORGANIZATION_ID)
  })

  it('preserves the current organization when core selection rejects', async () => {
    fake = makeFakeAuth({
      initialSession: authedSession,
      accessToken: 'at_first',
      idToken: makeIDToken(),
    })
    fake.selectOrganization = vi
      .fn()
      .mockRejectedValue(new Error('organization selection denied'))

    let latest: Snapshot | null = null
    renderProvider((s) => (latest = s))
    await waitFor(() => expect(latest!.organizationId).toBe(ORGANIZATION_ID))

    expect(latest!.selectOrganization).toBeTypeOf('function')
    await expect(
      latest!.selectOrganization(OTHER_ORGANIZATION_ID),
    ).rejects.toMatchObject({
      name: 'AtolDiagnosticError',
      code: 'organization_selection_failed',
      message:
        'Organization selection failed. Retry or sign in again.',
    })
    expect(latest!.organizationId).toBe(ORGANIZATION_ID)
  })

  it('keeps the latest intent when competing organization selections settle out of order', async () => {
    fake = makeFakeAuth({
      initialSession: authedSession,
      accessToken: 'at_first',
      idToken: makeIDToken(),
    })
    let rejectFirst: ((reason: Error) => void) | undefined
    let resolveSecond: ((session: AtolSession) => void) | undefined
    fake.selectOrganization = vi.fn((organizationId: string) => {
      if (organizationId === OTHER_ORGANIZATION_ID) {
        return new Promise<AtolSession>((_resolve, reject) => {
          rejectFirst = reject
        })
      }
      return new Promise<AtolSession>((resolve) => {
        resolveSecond = resolve
      })
    })

    let latest: Snapshot | null = null
    renderProvider((s) => (latest = s))
    await waitFor(() => expect(latest!.organizationId).toBe(ORGANIZATION_ID))

    expect(latest!.selectOrganization).toBeTypeOf('function')
    const first = latest!.selectOrganization(OTHER_ORGANIZATION_ID)
    const second = latest!.selectOrganization(THIRD_ORGANIZATION_ID)
    const firstRejected = expect(first).rejects.toMatchObject({
      name: 'AtolDiagnosticError',
      code: 'organization_selection_failed',
      message:
        'Organization selection failed. Retry or sign in again.',
    })

    const latestSession = atolSession({ organizationId: THIRD_ORGANIZATION_ID })
    await act(async () => {
      fake.emit(latestSession)
      resolveSecond!(latestSession)
      await second
    })
    await act(async () => {
      rejectFirst!(new Error('stale organization selection'))
      await firstRejected
    })

    expect(fake.selectOrganization).toHaveBeenNthCalledWith(
      1,
      OTHER_ORGANIZATION_ID,
    )
    expect(fake.selectOrganization).toHaveBeenNthCalledWith(
      2,
      THIRD_ORGANIZATION_ID,
    )
    expect(latest!.organizationId).toBe(THIRD_ORGANIZATION_ID)
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

  it('is Strict Mode-safe: reuses ONE client across the double-mount instead of racing two', async () => {
    // Strict Mode mounts -> unmounts -> remounts, synchronously, within the
    // same passive-effects flush. The provider must collapse this onto a
    // SINGLE `createAtolBrowserAuth` instance -- building (and destroying) a
    // second, independent one is exactly the regression this guards against
    // (see the next test for the mechanism it would trigger).
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
    // Exactly one client is ever constructed for the double-mount.
    expect(created.length).toBe(1)
    // It drives the session and is NOT torn down while the provider is
    // mounted (the throwaway mount's cleanup must not destroy the instance
    // the real mount goes on to use).
    expect(created[0].spies.init).toHaveBeenCalled()
    expect(created[0].spies.destroy).not.toHaveBeenCalled()
  })

  it('Strict Mode double-mount does not race a second completeLogin() over the single-use OIDC state', async () => {
    // Regression test for PIK-116 / the atol-sdk-react StrictMode callback
    // bug: a genuine authorization-code exchange whose token the app never
    // sees because two independent client instances raced each other over
    // the single-use OIDC state/PKCE entry that oidc-client-ts removes from
    // sessionStorage as the FIRST step of processing a callback (before the
    // token-endpoint exchange even starts). Model that shared, single-use
    // resource directly: the FIRST client instance to call init() consumes
    // it and (after a simulated network round trip) settles authenticated;
    // any OTHER, independent instance that raced it finds the resource
    // already gone and settles unauthenticated -- exactly like the real
    // core swallowing "No matching state found in storage" inside init().
    //
    // Before the fix (a fresh client built and destroyed on every effect
    // run) this reproduces the bug: two instances are built, the throwaway
    // one wins the race and its result lands nowhere (destroyed, no
    // subscribers), and the LIVE instance loses the race and settles
    // permanently unauthenticated. After the fix, Strict Mode's double
    // mount collapses onto one instance, so there is no race to lose.
    const created: FakeAuth[] = []
    const initPromises = new WeakMap<FakeAuth, Promise<AtolSession>>()
    let singleUseStateConsumed = false

    authFactory = () => {
      const f = makeFakeAuth({
        accessToken: 'at_race',
        idToken: makeIDToken(),
      })
      // Memoize init() PER INSTANCE, mirroring the real core's own
      // `initPromise` cache -- a second call on the SAME instance (as this
      // provider now makes, once per effect-mount that adopts it) must
      // return the original in-flight/settled promise, not re-run and
      // re-race the shared resource against itself.
      f.spies.init.mockImplementation(() => {
        let p = initPromises.get(f)
        if (!p) {
          p = (async () => {
            if (singleUseStateConsumed) {
              f.emit({ isAuthenticated: false, user: null })
              return { isAuthenticated: false, user: null }
            }
            singleUseStateConsumed = true
            // Simulate the token-endpoint network round trip.
            await new Promise((resolve) => setTimeout(resolve, 0))
            f.emit(authedSession)
            return authedSession
          })()
          initPromises.set(f, p)
        }
        return p
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

    await waitFor(() => expect(latest!.isLoading).toBe(false))
    // The exchanged session must be visible to the LIVE provider -- not
    // lost to a race with a throwaway instance.
    expect(latest!.isAuthenticated).toBe(true)
    expect(latest!.user?.id).toBe('user-1')
    expect(created.length).toBe(1)
  })

  it('does not reuse a pending client for a different initial test session', async () => {
    const created: FakeAuth[] = []
    const configs: Array<{ initialTestSession?: TokenResponse }> = []
    authFactory = (config) => {
      configs.push(config as { initialTestSession?: TokenResponse })
      const client = makeFakeAuth()
      created.push(client)
      return client
    }

    const firstSession = {
      access_token: 'first-secret-access-token',
      id_token: 'first-secret-id-token',
      token_type: 'Bearer',
      expires_in: 3600,
    } satisfies TokenResponse
    const secondSession = {
      access_token: 'second-secret-access-token',
      id_token: 'second-secret-id-token',
      token_type: 'Bearer',
      expires_in: 3600,
    } satisfies TokenResponse

    const first = render(
      <AtolProvider
        keyId="atol_kid_test"
        authority="https://auth.atol.test"
        redirectUri="https://app.test/cb"
        allowTestSessions
        initialTestSession={firstSession}
      >
        <Harness onState={() => undefined} />
      </AtolProvider>,
    )
    first.unmount()

    render(
      <AtolProvider
        keyId="atol_kid_test"
        authority="https://auth.atol.test"
        redirectUri="https://app.test/cb"
        allowTestSessions
        initialTestSession={secondSession}
      >
        <Harness onState={() => undefined} />
      </AtolProvider>,
    )

    expect(created).toHaveLength(2)
    expect(created[0].spies.destroy).toHaveBeenCalledTimes(1)
    expect(created[1].spies.destroy).not.toHaveBeenCalled()
    expect(configs[0].initialTestSession).toBe(firstSession)
    expect(configs[1].initialTestSession).toBe(secondSession)
  })

  it('keys initial test sessions without serializing credential material', () => {
    const session = {
      access_token: 'must-not-be-serialized',
      id_token: 'must-not-be-serialized-either',
      token_type: 'Bearer',
      expires_in: 3600,
    } satisfies TokenResponse
    Object.defineProperty(session, 'toJSON', {
      value: () => {
        throw new Error('credential material was serialized')
      },
    })

    expect(() => render(
      <React.StrictMode>
        <AtolProvider
          keyId="atol_kid_test"
          authority="https://auth.atol.test"
          redirectUri="https://app.test/cb"
          allowTestSessions
          initialTestSession={session}
        >
          <Harness onState={() => undefined} />
        </AtolProvider>
      </React.StrictMode>,
    )).not.toThrow()
  })
})
