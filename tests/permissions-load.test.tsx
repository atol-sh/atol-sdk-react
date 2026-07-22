/**
 * Bulk permission loading through the provider: success populates the
 * map; failure stays deny-by-default but SURFACES the error via
 * console.error, the onPermissionsError callback, and
 * usePermissions().error.
 *
 * This is a provider-owned concern (layered on top of the delegated auth
 * session): the provider calls loadPermissions with the client's access
 * token whenever the session changes to an authenticated identity. The auth
 * client is faked at the `@atol-sh/js` boundary; loadPermissions is mocked
 * to drive the success/failure branches.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import type { AtolSession } from '@atol-sh/js'
import { makeFakeAuth, type FakeAuth } from './fake-auth'
import { makeIDToken } from './helpers'
import { atolSession, atolUser, ORGANIZATION_ID } from './fixtures'

let fake: FakeAuth

vi.mock('@atol-sh/js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@atol-sh/js')>()
  return {
    ...actual,
    createAtolBrowserAuth: () => fake,
  }
})

vi.mock('../src/lib/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/permissions')>()
  return {
    ...actual,
    loadPermissions: vi.fn(),
  }
})

import { AtolProvider } from '../src/provider'
import { usePermissions } from '../src/hooks/use-permissions'
import { loadPermissions } from '../src/lib/permissions'

const mockLoad = vi.mocked(loadPermissions)
const OTHER_ORGANIZATION_ID = '01KV4BNVMVG66Q04WGMMD6W4PB'
const authedSession: AtolSession = atolSession()

type PermSnapshot = ReturnType<typeof usePermissions>

function Harness({ onState }: { onState: (s: PermSnapshot) => void }) {
  onState(usePermissions())
  return null
}

function renderProvider(
  opts: { onPermissionsError?: (e: Error) => void; useDPoP?: boolean },
  onState: (s: PermSnapshot) => void,
) {
  return render(
    <AtolProvider
      keyId="atol_kid_test"
      authority="https://auth.atol.test"
      redirectUri="https://app.test/cb"
      permissions={[{ action: 'edit', resource: 'publication' }]}
      onPermissionsError={opts.onPermissionsError}
      useDPoP={opts.useDPoP}
    >
      <Harness onState={onState} />
    </AtolProvider>,
  )
}

beforeEach(() => {
  window.history.replaceState({}, '', '/')
  fake = makeFakeAuth({
    initialSession: authedSession,
    accessToken: 'at_perm',
    idToken: makeIDToken(),
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('permission loading', () => {
  it('populates can() from a successful bulk load and reports no error', async () => {
    mockLoad.mockResolvedValue(new Map([['edit:publication', true]]))

    let latest: PermSnapshot | null = null
    renderProvider({}, (s) => (latest = s))

    await waitFor(() => expect(latest!.isLoading).toBe(false))
    await waitFor(() => expect(latest!.can('edit', 'publication')).toBe(true))
    expect(latest!.cannot('manage', 'team')).toBe(true)
    expect(latest!.error).toBeNull()
    // The load used the token the client handed back.
    expect(mockLoad).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'at_perm',
        userId: 'user-1',
        orgId: ORGANIZATION_ID,
      }),
    )
  })

  it('fails closed without calling AccessService when the credential is unscoped', async () => {
    fake = makeFakeAuth({
      initialSession: { isAuthenticated: true, user: atolUser() },
      accessToken: 'at_unscoped',
      idToken: makeIDToken({ 'atol:org_id': undefined }),
    })
    const onPermissionsError = vi.fn()
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    let latest: PermSnapshot | null = null
    renderProvider({ onPermissionsError }, (s) => (latest = s))

    await waitFor(() => expect(latest!.error).toBeInstanceOf(Error))
    expect(latest!.can('edit', 'publication')).toBe(false)
    expect(mockLoad).not.toHaveBeenCalled()
    expect(onPermissionsError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('not scoped to an organization'),
      }),
    )
    consoleSpy.mockRestore()
  })

  it('clears previously granted permissions when the credential becomes unscoped', async () => {
    mockLoad.mockResolvedValue(new Map([['edit:publication', true]]))
    const onPermissionsError = vi.fn()
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    let latest: PermSnapshot | null = null
    renderProvider({ onPermissionsError }, (s) => (latest = s))
    await waitFor(() => expect(latest!.can('edit', 'publication')).toBe(true))
    const scopedLoadCount = mockLoad.mock.calls.length

    await act(async () => {
      fake.emit({ isAuthenticated: true, user: atolUser() })
    })

    await waitFor(() => expect(latest!.error).toBeInstanceOf(Error))
    expect(latest!.can('edit', 'publication')).toBe(false)
    expect(mockLoad).toHaveBeenCalledTimes(scopedLoadCount)
    consoleSpy.mockRestore()
  })

  it('does not apply a stale permission response after the organization changes', async () => {
    fake = makeFakeAuth()
    let resolveFirst: ((permissions: Map<string, boolean>) => void) | undefined
    mockLoad.mockImplementation(({ orgId }) => {
      if (orgId === ORGANIZATION_ID) {
        return new Promise((resolve) => {
          resolveFirst = resolve
        })
      }
      return Promise.resolve(new Map([['edit:publication', false]]))
    })

    let latest: PermSnapshot | null = null
    renderProvider({}, (s) => (latest = s))

    await act(async () => {
      fake.authenticate(atolUser(), {
        accessToken: 'at_first',
        organizationId: ORGANIZATION_ID,
      })
    })
    await waitFor(() => expect(resolveFirst).toBeTypeOf('function'))

    await act(async () => {
      fake.authenticate(atolUser(), {
        accessToken: 'at_second',
        organizationId: OTHER_ORGANIZATION_ID,
      })
    })
    await waitFor(() =>
      expect(mockLoad).toHaveBeenCalledWith(
        expect.objectContaining({ orgId: OTHER_ORGANIZATION_ID }),
      ),
    )
    expect(latest!.can('edit', 'publication')).toBe(false)

    await act(async () => {
      resolveFirst!(new Map([['edit:publication', true]]))
    })
    expect(latest!.can('edit', 'publication')).toBe(false)
  })

  it('never sends token A with a DPoP proof resolved after switching to organization B', async () => {
    fake = makeFakeAuth({ dpopActive: true })
    let releaseFirstProof: (() => void) | undefined
    const firstProofGate = new Promise<void>((resolve) => {
      releaseFirstProof = resolve
    })
    let markFirstSettled: (() => void) | undefined
    const firstSettled = new Promise<void>((resolve) => {
      markFirstSettled = resolve
    })
    let firstLoadStarted = false
    let firstRequestSent = false

    mockLoad.mockImplementation(async (opts) => {
      if (opts.orgId !== ORGANIZATION_ID) {
        return new Map([['edit:publication', false]])
      }
      firstLoadStarted = true
      try {
        await firstProofGate
        expect(opts.dpop).toBeDefined()
        await opts.dpop!.signProof('POST', 'https://api.atol.test/permissions', {
          accessToken: opts.accessToken,
        })
        // Models the fetch boundary inside loadPermissions: no request may
        // pass this point if the proof was produced for a different token.
        firstRequestSent = true
        return new Map([['edit:publication', true]])
      } finally {
        markFirstSettled!()
      }
    })

    let latest: PermSnapshot | null = null
    renderProvider({ useDPoP: true }, (s) => (latest = s))

    await act(async () => {
      fake.authenticate(atolUser(), {
        accessToken: 'token-a',
        organizationId: ORGANIZATION_ID,
      })
    })
    await waitFor(() => expect(firstLoadStarted).toBe(true))

    await act(async () => {
      fake.authenticate(atolUser(), {
        accessToken: 'token-b',
        organizationId: OTHER_ORGANIZATION_ID,
      })
    })
    await waitFor(() =>
      expect(mockLoad).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: 'token-b',
          orgId: OTHER_ORGANIZATION_ID,
        }),
      ),
    )

    releaseFirstProof!()
    await firstSettled
    expect(firstRequestSent).toBe(false)
    expect(latest!.can('edit', 'publication')).toBe(false)
  })

  it('denies all and surfaces the failure when the bulk load throws', async () => {
    const boom = new Error('Permission check failed: HTTP 500')
    mockLoad.mockRejectedValue(boom)
    const onPermissionsError = vi.fn()
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    let latest: PermSnapshot | null = null
    renderProvider({ onPermissionsError }, (s) => (latest = s))

    await waitFor(() => expect(latest!.error).toBe(boom))

    // Deny by default holds.
    expect(latest!.can('edit', 'publication')).toBe(false)
    // ...but the failure is loud and distinguishable.
    expect(onPermissionsError).toHaveBeenCalledWith(boom)
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('permission load failed'),
      boom,
    )
    consoleSpy.mockRestore()
  })
})
