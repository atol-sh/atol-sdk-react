/**
 * Zero-knowledge encryption, asserted through the PROVIDER's observable
 * contract now that the KEK/DEK flow is owned by the `@atol-sh/js`
 * browser-auth client.
 *
 * The provider used to orchestrate KEK derivation itself (extract the
 * fragment KEK, provision/rehydrate the vault, unwrap the DEK). That moved
 * into the core; the provider now only MIRRORS the core-derived
 * `encryptionKey` / `encryptionError` from the session-change payload into
 * React state. These tests assert exactly that mirroring -- including the
 * fail-loud tamper case -- via the mocked core boundary, instead of poking
 * at internal KEK calls the provider no longer makes.
 *
 * The core's own KEK orchestration (fragment capture before URL strip,
 * vault provision/rehydrate, AES-GCM unwrap + tamper detection) is covered
 * adversarially in @atol-sh/js's browser-auth-kek.test.ts.
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

type Snapshot = ReturnType<typeof useAtol>

function Harness({ onState }: { onState: (s: Snapshot) => void }) {
  onState(useAtol())
  return null
}

function renderProvider(onState: (s: Snapshot) => void, deriveEncryptionKey = true) {
  return render(
    <AtolProvider
      keyId="atol_kid_test"
      authority="https://auth.atol.test"
      redirectUri="https://app.test/cb"
      deriveEncryptionKey={deriveEncryptionKey}
    >
      <Harness onState={onState} />
    </AtolProvider>,
  )
}

const authedSession: AtolSession = { isAuthenticated: true, user: atolUser() }

/** A deterministic 32-byte "DEK" the core would have derived. */
function fakeDEK(): Uint8Array {
  const b = new Uint8Array(32)
  for (let i = 0; i < 32; i++) b[i] = (i * 3 + 1) & 0xff
  return b
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('AtolProvider -- encryption key mirroring', () => {
  it('surfaces the core-derived encryptionKey on a KEK session (no error)', async () => {
    const dek = fakeDEK()
    fake = makeFakeAuth({
      initialSession: authedSession,
      accessToken: 'at_1',
      idToken: makeIDToken(),
      encryptionKey: dek,
    })
    let latest: Snapshot | null = null
    renderProvider((s) => (latest = s))

    await waitFor(() => expect(latest!.isLoading).toBe(false))
    expect(latest!.isAuthenticated).toBe(true)
    // The key is mirrored from the session payload, byte-for-byte.
    expect(latest!.encryptionKey).toBeInstanceOf(Uint8Array)
    expect(Array.from(latest!.encryptionKey!)).toEqual(Array.from(dek))
    expect(latest!.encryptionError).toBeNull()
  })

  it('TAMPER: surfaces encryptionError with NO key (fail loud, not silent)', async () => {
    // The core reports a derivation failure (AES-GCM auth-tag failure on a
    // tampered wrapped-DEK): error set, key absent. The provider must
    // reflect that as encryptionError !== null AND encryptionKey === null --
    // never a silently-wrong key.
    const tamperError = new Error('unwrapDEK: AES-GCM auth tag failed')
    fake = makeFakeAuth({
      initialSession: authedSession,
      accessToken: 'at_1',
      idToken: makeIDToken(),
      encryptionError: tamperError,
    })
    let latest: Snapshot | null = null
    renderProvider((s) => (latest = s))

    await waitFor(() => expect(latest!.isLoading).toBe(false))
    expect(latest!.encryptionKey).toBeNull()
    expect(latest!.encryptionError).toBe(tamperError)
  })

  it('deriveEncryptionKey OFF: no key, no error even if the core reported one', async () => {
    // With the feature off the provider never mirrors encryption state; the
    // contract stays "encryption disabled" (both null).
    fake = makeFakeAuth({
      initialSession: authedSession,
      accessToken: 'at_1',
      idToken: makeIDToken(),
      encryptionKey: fakeDEK(),
    })
    let latest: Snapshot | null = null
    renderProvider((s) => (latest = s), false) // feature OFF

    await waitFor(() => expect(latest!.isLoading).toBe(false))
    expect(latest!.isAuthenticated).toBe(true)
    expect(latest!.encryptionKey).toBeNull()
    expect(latest!.encryptionError).toBeNull()
  })

  it('keeps the encryptionKey across a silent renew (re-emitted session)', async () => {
    const dek = fakeDEK()
    fake = makeFakeAuth({
      initialSession: authedSession,
      accessToken: 'at_1',
      idToken: makeIDToken(),
      encryptionKey: dek,
    })
    let latest: Snapshot | null = null
    renderProvider((s) => (latest = s))
    await waitFor(() => expect(latest!.encryptionKey).toBeInstanceOf(Uint8Array))

    // A renew re-emits the same session (same identity, same derived key).
    await act(async () => {
      await latest!.forceRenew()
    })
    expect(Array.from(latest!.encryptionKey!)).toEqual(Array.from(dek))
    expect(latest!.encryptionError).toBeNull()
  })

  it('clears the encryptionKey on logout', async () => {
    fake = makeFakeAuth({
      initialSession: authedSession,
      accessToken: 'at_1',
      idToken: makeIDToken(),
      encryptionKey: fakeDEK(),
    })
    let latest: Snapshot | null = null
    renderProvider((s) => (latest = s))
    await waitFor(() => expect(latest!.encryptionKey).toBeInstanceOf(Uint8Array))

    await act(async () => {
      await latest!.logout()
    })
    await waitFor(() => expect(latest!.isAuthenticated).toBe(false))
    expect(latest!.encryptionKey).toBeNull()
    expect(latest!.encryptionError).toBeNull()
  })

  it('surfaces a tamper error that arrives on a later renew (mid-session)', async () => {
    // Start clean (key present), then a renew emits a session where the core
    // now reports a tamper (failed rehydrate): error on, key dropped. The
    // provider must flip encryptionError on and clear the key -- deny-by-
    // default for encrypted ops, never a stale/silently-wrong key.
    fake = makeFakeAuth({
      initialSession: authedSession,
      accessToken: 'at_1',
      idToken: makeIDToken(),
      encryptionKey: fakeDEK(),
    })
    let latest: Snapshot | null = null
    renderProvider((s) => (latest = s))
    await waitFor(() => expect(latest!.encryptionKey).toBeInstanceOf(Uint8Array))

    const tamperError = new Error('rehydrate: auth-tag failed')
    await act(async () => {
      // The core newly reports a tamper on renew: error set, no key.
      fake.setEncryption({ key: undefined, error: tamperError })
    })
    await waitFor(() => expect(latest!.encryptionError).toBe(tamperError))
    // The stale key must be gone.
    expect(latest!.encryptionKey).toBeNull()
  })
})
