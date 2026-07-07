/**
 * The provider exposes signDPoPProof(method, url) so host apps can attach a
 * DPoP resource-server proof (RFC 9449 §7) to requests against their OWN
 * protected resource.
 *
 * The provider now DELEGATES this to the `@atol-sh/js` browser-auth client,
 * which produces the actual proof (fetching a fresh token so `ath` binds to
 * what is presented) -- the proof's JWT claims (htm/htu/iat/jti/ath) and htu
 * canonicalization are verified in @atol-sh/js's dpop.test.ts and
 * browser-auth.test.ts. These tests assert the PROVIDER's contract: it
 * passes (method, url) through to the client and returns the client's
 * result verbatim -- a bound proof when DPoP is active, and { token,
 * proof: undefined } (plain-Bearer) when it is not.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
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

describe('signDPoPProof', () => {
  it('delegates to the client and returns the bound proof when DPoP is on', async () => {
    fake = makeFakeAuth({
      initialSession: authedSession,
      accessToken: 'at_dpop',
      idToken: makeIDToken(),
      dpopActive: true,
    })

    let latest: Snapshot | null = null
    renderProvider(true, (s) => (latest = s))
    await waitFor(() => expect(latest!.isAuthenticated).toBe(true))

    const result = await latest!.signDPoPProof('GET', 'https://api.example.com/me')
    expect(result).toEqual({ token: 'at_dpop', proof: 'fake.dpop.proof' })
    // (method, url) passed straight through to the client.
    expect(fake.spies.signDPoPProof).toHaveBeenCalledWith('GET', 'https://api.example.com/me')
  })

  it('falls back to Bearer (proof undefined) when DPoP is off', async () => {
    fake = makeFakeAuth({
      initialSession: authedSession,
      accessToken: 'at_bearer',
      idToken: makeIDToken(),
      dpopActive: false,
    })

    let latest: Snapshot | null = null
    renderProvider(false, (s) => (latest = s))
    await waitFor(() => expect(latest!.isAuthenticated).toBe(true))

    const result = await latest!.signDPoPProof('GET', 'https://api.example.com/me')
    expect(result).toEqual({ token: 'at_bearer', proof: undefined })
  })

  it('resolves undefined when there is no session (no token to present)', async () => {
    fake = makeFakeAuth({ initialSession: { isAuthenticated: false, user: null } })

    let latest: Snapshot | null = null
    renderProvider(true, (s) => (latest = s))
    await waitFor(() => expect(latest!.isLoading).toBe(false))

    expect(await latest!.signDPoPProof('GET', 'https://api.example.com/me')).toBeUndefined()
  })
})
