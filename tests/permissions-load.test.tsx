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
import { render, waitFor } from '@testing-library/react'
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
const authedSession: AtolSession = { isAuthenticated: true, user: atolUser() }

type PermSnapshot = ReturnType<typeof usePermissions>

function Harness({ onState }: { onState: (s: PermSnapshot) => void }) {
  onState(usePermissions())
  return null
}

function renderProvider(
  opts: { onPermissionsError?: (e: Error) => void },
  onState: (s: PermSnapshot) => void,
) {
  return render(
    <AtolProvider
      keyId="atol_kid_test"
      authority="https://auth.atol.test"
      redirectUri="https://app.test/cb"
      permissions={[{ action: 'edit', resource: 'publication' }]}
      onPermissionsError={opts.onPermissionsError}
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
      expect.objectContaining({ accessToken: 'at_perm', userId: 'user-1', orgId: 'org-1' }),
    )
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
