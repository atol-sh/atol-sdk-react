import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { makeFakeAuth, type FakeAuth } from './fake-auth'

let fake: FakeAuth
let authFactory: (config?: unknown) => FakeAuth = () => fake

vi.mock('@atol-sh/js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@atol-sh/js')>()
  return {
    ...actual,
    createAtolBrowserAuth: (config: unknown) => authFactory(config),
  }
})

vi.mock('../src/lib/permissions', () => ({
  loadPermissions: vi.fn().mockResolvedValue(new Map()),
  permissionKey: (action: string, resource: string) =>
    `${action}:${resource}`,
}))

import { AtolProvider } from '../src/provider'
import { useAtol } from '../src/hooks/use-atol'
import {
  acquireProviderClient,
  resetProviderClientForTests,
} from '../src/provider-client'

type Snapshot = ReturnType<typeof useAtol>
type ProviderClientConfig = Parameters<typeof acquireProviderClient>[0]

function Harness({
  onState,
  children,
}: {
  onState: (state: Snapshot) => void
  children?: ReactNode
}) {
  onState(useAtol())
  return children ?? null
}

function renderProvider(onState: (state: Snapshot) => void) {
  return render(
    <AtolProvider
      keyId="atol_kid_test"
      authority="https://auth.atol.test"
      redirectUri="https://app.test/cb"
    >
      <Harness onState={onState} />
    </AtolProvider>,
  )
}

function providerClientConfig(
  overrides: Partial<ProviderClientConfig> = {},
): ProviderClientConfig {
  return {
    authority: 'https://auth.atol.test',
    keyId: 'atol_kid_test',
    redirectUri: 'https://app.test/cb',
    postLogoutRedirectUri: undefined,
    scope: 'openid profile email',
    audience: undefined,
    responseVault: false,
    useDPoP: undefined,
    useRefreshTokens: false,
    useRefreshTokensFallback: false,
    deriveEncryptionKey: false,
    allowTestSessions: false,
    initialTestSession: undefined,
    ...overrides,
  }
}

function ownErrorValues(error: Error): string {
  return Object.getOwnPropertyNames(error)
    .map((name) => String(Reflect.get(error, name)))
    .join('\n')
}

afterEach(() => {
  authFactory = () => fake
  vi.restoreAllMocks()
})

describe('AtolProvider security boundaries', () => {
  it('rolls back a client when synchronous subscription setup fails', () => {
    const sentinel = 'sentinel-secret-provider-subscription-setup'
    const firstClient = makeFakeAuth()
    const replacementClient = makeFakeAuth()
    firstClient.onSessionChange = vi.fn(() => {
      throw new Error(sentinel)
    })
    const factory = vi
      .fn()
      .mockReturnValueOnce(firstClient)
      .mockReturnValue(replacementClient)
    authFactory = factory
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {})

    try {
      let error: unknown
      try {
        renderProvider(() => undefined)
      } catch (caught) {
        error = caught
      }

      expect(error).toMatchObject({
        name: 'AtolDiagnosticError',
        code: 'auth_initialization_failed',
        message:
          'Authentication could not be initialized. Retry sign-in.',
      })
      expect(error).not.toHaveProperty('cause')
      expect(JSON.stringify(error)).not.toContain(sentinel)
      expect(String(error)).not.toContain(sentinel)
      expect(consoleSpy.mock.calls.flat().join('\n')).not.toContain(
        sentinel,
      )
      expect(firstClient.spies.destroy).toHaveBeenCalledTimes(1)
      expect(acquireProviderClient(providerClientConfig())).toBe(
        replacementClient,
      )
      expect(factory).toHaveBeenCalledTimes(2)
    } finally {
      resetProviderClientForTests()
    }
  })

  it('rolls back a client when test-bridge registration fails', () => {
    const sentinel = 'sentinel-secret-test-bridge-registration'
    const bridgeSlot = Symbol.for(
      '@atol-sh/react/testing:activeClient',
    )
    const previousDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      bridgeSlot,
    )
    const restoreBridgeSlot = () => {
      if (previousDescriptor) {
        Object.defineProperty(
          globalThis,
          bridgeSlot,
          previousDescriptor,
        )
      } else {
        Reflect.deleteProperty(globalThis, bridgeSlot)
      }
    }
    const firstClient = makeFakeAuth()
    const replacementClient = makeFakeAuth()
    const factory = vi
      .fn()
      .mockReturnValueOnce(firstClient)
      .mockReturnValue(replacementClient)
    authFactory = factory
    Object.defineProperty(globalThis, bridgeSlot, {
      configurable: true,
      get: () => undefined,
      set: () => {
        throw new Error(sentinel)
      },
    })

    try {
      const config = providerClientConfig({
        allowTestSessions: true,
      })
      let error: unknown
      try {
        acquireProviderClient(config)
      } catch (caught) {
        error = caught
      }

      expect(error).toMatchObject({
        name: 'AtolDiagnosticError',
        code: 'auth_initialization_failed',
        message:
          'Authentication could not be initialized. Retry sign-in.',
      })
      expect(error).not.toHaveProperty('cause')
      expect(JSON.stringify(error)).not.toContain(sentinel)
      expect(String(error)).not.toContain(sentinel)
      expect(firstClient.spies.destroy).toHaveBeenCalledTimes(1)

      restoreBridgeSlot()
      expect(acquireProviderClient(config)).toBe(replacementClient)
      expect(factory).toHaveBeenCalledTimes(2)
    } finally {
      restoreBridgeSlot()
      resetProviderClientForTests()
      restoreBridgeSlot()
    }
  })

  it('releases client custody even when subscription teardown throws', async () => {
    const sentinel = 'sentinel-secret-provider-unsubscribe'
    const firstClient = makeFakeAuth()
    const replacementClient = makeFakeAuth()
    const subscribe = firstClient.onSessionChange.bind(firstClient)
    firstClient.onSessionChange = vi.fn((callback) => {
      const unsubscribe = subscribe(callback)
      return () => {
        unsubscribe()
        throw new Error(sentinel)
      }
    })
    const factory = vi
      .fn()
      .mockReturnValueOnce(firstClient)
      .mockReturnValue(replacementClient)
    authFactory = factory
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {})

    try {
      const mounted = renderProvider(() => undefined)
      await waitFor(() => {
        expect(firstClient.spies.init).toHaveBeenCalledTimes(1)
      })
      let error: unknown
      try {
        mounted.unmount()
      } catch (caught) {
        error = caught
      }

      expect(error).toMatchObject({
        name: 'AtolDiagnosticError',
        code: 'provider_client_cleanup_failed',
        message: 'AtolProvider credential client cleanup failed.',
      })
      expect(error).not.toHaveProperty('cause')
      expect(JSON.stringify(error)).not.toContain(sentinel)
      expect(String(error)).not.toContain(sentinel)
      expect(consoleSpy.mock.calls.flat().join('\n')).not.toContain(
        sentinel,
      )
      await waitFor(() => {
        expect(firstClient.spies.destroy).toHaveBeenCalledTimes(1)
      })
      expect(acquireProviderClient(providerClientConfig())).toBe(
        replacementClient,
      )
      expect(factory).toHaveBeenCalledTimes(2)
    } finally {
      resetProviderClientForTests()
    }
  })

  it('rejects a second active credential owner without replacing or leaking the first client', async () => {
    const sentinel = 'sentinel-secret-second-provider'
    const created: FakeAuth[] = []
    authFactory = () => {
      const client = makeFakeAuth()
      created.push(client)
      return client
    }
    const first = renderProvider(() => undefined)
    await waitFor(() => {
      expect(created[0]?.spies.init).toHaveBeenCalledTimes(1)
    })

    let caught: unknown
    try {
      acquireProviderClient({
        authority: `https://auth.atol.test/${sentinel}`,
        keyId: 'atol_kid_second',
        redirectUri: `https://app.test/${sentinel}`,
        postLogoutRedirectUri: undefined,
        scope: 'openid',
        audience: undefined,
        responseVault: false,
        useDPoP: false,
        useRefreshTokens: false,
        useRefreshTokensFallback: false,
        deriveEncryptionKey: false,
        allowTestSessions: false,
        initialTestSession: undefined,
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toMatchObject({
      name: 'AtolDiagnosticError',
      code: 'provider_already_mounted',
      message:
        'Only one active AtolProvider may own browser credentials.',
    })
    expect(caught).not.toHaveProperty('cause')
    expect(JSON.stringify(caught)).not.toContain(sentinel)
    expect(String(caught)).not.toContain(sentinel)
    expect(created).toHaveLength(1)
    expect(created[0].spies.destroy).not.toHaveBeenCalled()

    first.unmount()
  })

  it('keeps a failed deferred teardown as the credential owner and reports only a closed diagnostic', async () => {
    const sentinel = 'sentinel-secret-deferred-provider-cleanup'
    fake = makeFakeAuth()
    let cleanupFails = true
    fake.spies.destroy.mockImplementation(() => {
      if (cleanupFails) throw new Error(sentinel)
    })
    const factory = vi.fn(() => fake)
    authFactory = factory
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {})

    try {
      const mounted = renderProvider(() => undefined)
      await waitFor(() => {
        expect(fake.spies.init).toHaveBeenCalledTimes(1)
      })
      mounted.unmount()
      await waitFor(() => {
        expect(fake.spies.destroy).toHaveBeenCalledTimes(1)
      })

      expect(consoleSpy).toHaveBeenCalledWith(
        '[Atol] provider client cleanup failed (provider_client_cleanup_failed): AtolProvider credential client cleanup failed.',
      )
      expect(consoleSpy.mock.calls.flat().join('\n')).not.toContain(
        sentinel,
      )

      let error: unknown
      try {
        acquireProviderClient(providerClientConfig())
      } catch (caught) {
        error = caught
      }
      expect(error).toMatchObject({
        name: 'AtolDiagnosticError',
        code: 'provider_client_cleanup_failed',
        message: 'AtolProvider credential client cleanup failed.',
      })
      expect(error).not.toHaveProperty('cause')
      expect(JSON.stringify(error)).not.toContain(sentinel)
      expect(String(error)).not.toContain(sentinel)
      if (!(error instanceof Error)) {
        throw new Error('expected a closed provider cleanup Error')
      }
      expect(ownErrorValues(error)).not.toContain(sentinel)
      expect(factory).toHaveBeenCalledTimes(1)
      expect(fake.spies.destroy).toHaveBeenCalledTimes(2)
    } finally {
      cleanupFails = false
      resetProviderClientForTests()
    }
  })

  it('blocks pending-different replacement until every failed cleanup step succeeds', async () => {
    const sentinel = 'sentinel-secret-pending-provider-cleanup'
    const firstClient = makeFakeAuth()
    const replacementClient = makeFakeAuth()
    let cleanupFails = true
    firstClient.spies.destroy.mockImplementation(() => {
      if (cleanupFails) throw new Error(sentinel)
    })
    const factory = vi
      .fn()
      .mockReturnValueOnce(firstClient)
      .mockReturnValue(replacementClient)
    authFactory = factory

    try {
      const mounted = renderProvider(() => undefined)
      await waitFor(() => {
        expect(firstClient.spies.init).toHaveBeenCalledTimes(1)
      })
      mounted.unmount()

      const replacementConfig = providerClientConfig({
        authority: 'https://other-auth.atol.test',
        keyId: 'atol_kid_other',
        redirectUri: 'https://other-app.test/cb',
      })
      let error: unknown
      try {
        acquireProviderClient(replacementConfig)
      } catch (caught) {
        error = caught
      }

      expect(error).toMatchObject({
        name: 'AtolDiagnosticError',
        code: 'provider_client_cleanup_failed',
        message: 'AtolProvider credential client cleanup failed.',
      })
      expect(error).not.toHaveProperty('cause')
      expect(JSON.stringify(error)).not.toContain(sentinel)
      expect(String(error)).not.toContain(sentinel)
      expect(factory).toHaveBeenCalledTimes(1)
      expect(firstClient.spies.destroy).toHaveBeenCalledTimes(1)

      cleanupFails = false
      expect(acquireProviderClient(replacementConfig)).toBe(
        replacementClient,
      )
      expect(firstClient.spies.destroy).toHaveBeenCalledTimes(2)
      expect(factory).toHaveBeenCalledTimes(2)
    } finally {
      cleanupFails = false
      resetProviderClientForTests()
    }
  })

  it('sanitizes every public action rejection and the unmounted boundary', async () => {
    const sentinel = 'sentinel-secret-provider-action'
    const rawFailure = {
      credential: sentinel,
      callbackUrl: `https://app.test/cb?token=${sentinel}`,
      toString: () => sentinel,
    }
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {})
    fake = makeFakeAuth()
    fake.spies.beginLogin.mockRejectedValue(rawFailure)
    fake.selectOrganization = vi.fn().mockRejectedValue(rawFailure)
    fake.spies.logout.mockRejectedValue(rawFailure)
    fake.spies.getAccessToken.mockRejectedValue(rawFailure)
    fake.spies.forceRenew.mockRejectedValue(rawFailure)
    fake.spies.signDPoPProof.mockRejectedValue(rawFailure)

    let latest: Snapshot | null = null
    const mounted = renderProvider((state) => (latest = state))
    await waitFor(() => expect(latest!.isLoading).toBe(false))
    const actions = latest!

    const cases = [
      {
        code: 'login_failed',
        message: 'Sign-in could not be started. Retry.',
        invoke: () =>
          actions.login({
            returnTo: `/account?credential=${sentinel}`,
          }),
      },
      {
        code: 'organization_selection_failed',
        message:
          'Organization selection failed. Retry or sign in again.',
        invoke: () => actions.selectOrganization(sentinel),
      },
      {
        code: 'logout_failed',
        message:
          'Sign-out cleanup did not complete. Retry sign-out.',
        invoke: () => actions.logout(),
      },
      {
        code: 'session_token_unavailable',
        message:
          'The session access token is unavailable. Sign in again.',
        invoke: () => actions.getAccessToken(),
      },
      {
        code: 'session_renewal_failed',
        message: 'Session renewal failed. Sign in again.',
        invoke: () => actions.forceRenew(),
      },
      {
        code: 'dpop_proof_unavailable',
        message:
          'The DPoP proof could not be created. Retry with an active session.',
        invoke: () =>
          actions.signDPoPProof(
            'GET',
            `https://api.test/resource?token=${sentinel}`,
          ),
      },
    ] as const

    for (const action of cases) {
      let error: unknown
      await act(async () => {
        error = await action.invoke().catch(
          (caught: unknown) => caught,
        )
      })
      expect(error).toMatchObject({
        name: 'AtolDiagnosticError',
        code: action.code,
        message: action.message,
      })
      expect(error).not.toHaveProperty('cause')
      expect(JSON.stringify(error)).not.toContain(sentinel)
      expect(String(error)).not.toContain(sentinel)
      if (!(error instanceof Error)) {
        throw new Error('expected an Error')
      }
      expect(ownErrorValues(error)).not.toContain(sentinel)
    }

    mounted.unmount()
    const unmounted = await actions.login().catch(
      (caught: unknown) => caught,
    )
    expect(unmounted).toMatchObject({
      name: 'AtolDiagnosticError',
      code: 'provider_not_mounted',
      message: 'AtolProvider is not mounted.',
    })
    expect(unmounted).not.toHaveProperty('cause')
    expect(JSON.stringify(unmounted)).not.toContain(sentinel)
    expect(consoleSpy.mock.calls.flat().join('\n')).not.toContain(
      sentinel,
    )
  })

  it('restarts an eligible response-vault login instead of beginning a new one', async () => {
    fake = makeFakeAuth()
    fake.spies.canRestartLogin.mockReturnValue(true)

    let latest: Snapshot | null = null
    renderProvider((state) => (latest = state))
    await waitFor(() => expect(latest!.isLoading).toBe(false))

    await act(async () => {
      await latest!.login({ returnTo: '/account' })
    })

    expect(fake.spies.restartLogin).toHaveBeenCalledOnce()
    expect(fake.spies.restartLogin).toHaveBeenCalledWith({
      returnTo: '/account',
    })
    expect(fake.spies.beginLogin).not.toHaveBeenCalled()
  })

  it('sanitizes an eligible response-vault restart rejection', async () => {
    const sentinel = 'sentinel-secret-login-restart'
    fake = makeFakeAuth()
    fake.spies.canRestartLogin.mockReturnValue(true)
    fake.spies.restartLogin.mockRejectedValue({
      authorizationResponse: sentinel,
      toString: () => sentinel,
    })

    let latest: Snapshot | null = null
    renderProvider((state) => (latest = state))
    await waitFor(() => expect(latest!.isLoading).toBe(false))

    let error: unknown
    await act(async () => {
      error = await latest!.login().catch(
        (caught: unknown) => caught,
      )
    })

    expect(error).toMatchObject({
      name: 'AtolDiagnosticError',
      code: 'login_failed',
      message: 'Sign-in could not be started. Retry.',
    })
    expect(error).not.toHaveProperty('cause')
    expect(JSON.stringify(error)).not.toContain(sentinel)
    expect(String(error)).not.toContain(sentinel)
    expect(fake.spies.beginLogin).not.toHaveBeenCalled()
  })

  it('begins an ordinary login when response-vault restart is unavailable', async () => {
    fake = makeFakeAuth()

    let latest: Snapshot | null = null
    renderProvider((state) => (latest = state))
    await waitFor(() => expect(latest!.isLoading).toBe(false))

    await act(async () => {
      await latest!.login({ returnTo: '/account' })
    })

    expect(fake.spies.beginLogin).toHaveBeenCalledOnce()
    expect(fake.spies.beginLogin).toHaveBeenCalledWith({
      returnTo: '/account',
    })
    expect(fake.spies.restartLogin).not.toHaveBeenCalled()
  })
})
