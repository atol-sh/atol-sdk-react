/**
 * Cross-tab credential invalidation.
 *
 * The signal-only BroadcastChannel and its DPoP-safety rule live entirely in
 * the `@atol-sh/js` browser-auth client: tabs never adopt another tab's
 * access, ID, or refresh token. A credential-invalidation message instead
 * causes each tab to renew with its own key. That behavior is covered by
 * @atol-sh/js's browser-auth.test.ts cross-tab suite.
 *
 * At the provider level, an invalidation-driven local renewal reaches the app
 * the same way any renewal does: the client emits a new session.
 * These tests assert the PROVIDER's observable reaction -- it mirrors the
 * rotated session into React state and re-loads permissions -- under both
 * DPoP-on and DPoP-off configurations.
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

vi.mock('../src/lib/permissions', () => ({
  loadPermissions: vi.fn().mockResolvedValue(new Map([['edit:publication', true]])),
  permissionKey: (a: string, r: string) => `${a}:${r}`,
}))

import { AtolProvider } from '../src/provider'
import { useAtol } from '../src/hooks/use-atol'
import { loadPermissions } from '../src/lib/permissions'

const mockLoad = vi.mocked(loadPermissions)
const authedSession: AtolSession = atolSession()

type Snapshot = ReturnType<typeof useAtol>

function Harness({ onState }: { onState: (s: Snapshot) => void }) {
  onState(useAtol())
  return null
}

function renderProvider(useDPoP: boolean, onState: (s: Snapshot) => void) {
  return render(
    <AtolProvider
      keyId="atol_kid_test"
      authority="https://auth.atol.test"
      redirectUri="https://app.test/cb"
      permissions={[{ action: 'edit', resource: 'publication' }]}
      useRefreshTokens
      useDPoP={useDPoP}
    >
      <Harness onState={onState} />
    </AtolProvider>,
  )
}

beforeEach(() => {
  window.history.replaceState({}, '', '/')
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('cross-tab revalidation reflected by the provider', () => {
  it('mirrors a rotated session and reloads permissions (DPoP on)', async () => {
    fake = makeFakeAuth({
      initialSession: authedSession,
      accessToken: 'at_1',
      idToken: makeIDToken(),
      dpopActive: true,
    })

    let latest: Snapshot | null = null
    renderProvider(true, (s) => (latest = s))
    await waitFor(() => expect(latest!.isAuthenticated).toBe(true))
    await waitFor(() => expect(latest!.permissions.get('edit:publication')).toBe(true))
    const loadsBefore = mockLoad.mock.calls.length

    // This tab renewed after an invalidation signal; the client surfaces it.
    await act(async () => {
      fake.authenticate(atolUser(), {
        accessToken: 'at_2',
        idToken: makeIDToken(),
        organizationId: ORGANIZATION_ID,
      })
    })

    // Provider stays authenticated and re-loads permissions on the rotation.
    expect(latest!.isAuthenticated).toBe(true)
    await waitFor(() => expect(mockLoad.mock.calls.length).toBeGreaterThan(loadsBefore))
    // The reload used the DPoP signer (DPoP active).
    const lastCall = mockLoad.mock.calls[mockLoad.mock.calls.length - 1][0]
    expect(lastCall.dpop).toBeTruthy()
  })

  it('mirrors a rotated session and reloads permissions (DPoP off, Bearer)', async () => {
    fake = makeFakeAuth({
      initialSession: authedSession,
      accessToken: 'at_1',
      idToken: makeIDToken(),
      dpopActive: false,
    })

    let latest: Snapshot | null = null
    renderProvider(false, (s) => (latest = s))
    await waitFor(() => expect(latest!.isAuthenticated).toBe(true))
    const loadsBefore = mockLoad.mock.calls.length

    await act(async () => {
      fake.authenticate(atolUser(), {
        accessToken: 'at_2',
        idToken: makeIDToken(),
        organizationId: ORGANIZATION_ID,
      })
    })

    expect(latest!.isAuthenticated).toBe(true)
    await waitFor(() => expect(mockLoad.mock.calls.length).toBeGreaterThan(loadsBefore))
    // Bearer mode: no DPoP signer passed to the permission load.
    const lastCall = mockLoad.mock.calls[mockLoad.mock.calls.length - 1][0]
    expect(lastCall.dpop).toBeUndefined()
  })
})
