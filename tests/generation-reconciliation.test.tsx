import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import { makeFakeAuth, type FakeAuth } from './fake-auth'
import { makeIDToken } from './helpers'
import { atolSession } from './fixtures'
import { loadMock } from './stubs/fingerprint'
import type { DeviceAuthorization } from '@atol-sh/js/device'

let fake: FakeAuth

vi.mock('@atol-sh/js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@atol-sh/js')>()
  return {
    ...actual,
    createAtolBrowserAuth: () => fake,
  }
})

vi.mock('../src/lib/permissions', () => ({
  loadPermissions: vi.fn().mockResolvedValue(
    new Map([['edit:publication', true]]),
  ),
  permissionKey: (action: string, resource: string) =>
    `${action}:${resource}`,
}))

import { AtolProvider } from '../src/provider'
import { useAtol } from '../src/hooks/use-atol'

type Snapshot = ReturnType<typeof useAtol>

function Harness({ onState }: { onState: (state: Snapshot) => void }) {
  onState(useAtol())
  return null
}

function testDEK(): Uint8Array {
  return new Uint8Array(32).map((_, index) => index + 1)
}

const smartSignals = {
  bot: false,
  vpn: false,
  proxy: false,
  tor: false,
  incognito: false,
  tampered: false,
  emulator: false,
  rooted: false,
  geo_mismatch: false,
  device_mismatch: false,
  device_shared: false,
  shared_user_count: 1,
  anomaly_score: 0,
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('AtolProvider -- generation reconciliation mirror', () => {
  it('clears every credential-derived cache on a core emission without BroadcastChannel', async () => {
    const originalBroadcastChannel = globalThis.BroadcastChannel
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      value: undefined,
    })
    try {
      const dek = testDEK()
      fake = makeFakeAuth({
        initialSession: atolSession(),
        accessToken: 'at_generation_a',
        idToken: makeIDToken(),
        encryptionKey: dek,
        dpopActive: true,
      })
      let identifyAuthorization: DeviceAuthorization | undefined
      loadMock.mockResolvedValue({
        identify: vi.fn().mockImplementation(async ({ authorize }) => {
          identifyAuthorization = await authorize({
            method: 'POST',
            url: 'https://api.atol.sh/api/v1/devices/identify',
          })
          return {
            device_id: 'device-generation-a',
            known: true,
            confidence: 0.99,
            new_device: false,
            platform: 'macOS',
            browser: 'Safari',
            os_version: '15.5',
            signals: smartSignals,
          }
        }),
      })

      let latest: Snapshot | null = null
      render(
        <AtolProvider
          keyId="atol_kid_test"
          authority="https://auth.atol.test"
          redirectUri="https://app.test/cb"
          deriveEncryptionKey
          permissions={[{ action: 'edit', resource: 'publication' }]}
          deviceIntelligence={{ enabled: true, collectOnMount: false }}
        >
          <Harness onState={(state) => (latest = state)} />
        </AtolProvider>,
      )

      await waitFor(() =>
        expect(latest!.permissions.get('edit:publication')).toBe(true),
      )
      await waitFor(() =>
        expect(latest!.device.deviceId).toBe('device-generation-a'),
      )
      expect(identifyAuthorization).toEqual({
        scheme: 'DPoP',
        accessToken: 'at_generation_a',
        dpopProof: 'fake.dpop.proof',
      })
      expect(fake.spies.getAccessToken).toHaveBeenCalledWith({
        dpop: {
          method: 'POST',
          url: 'https://api.atol.sh/api/v1/devices/identify',
        },
      })
      const exposedDEK = latest!.encryptionKey!
      expect(Array.from(exposedDEK)).toEqual(Array.from(dek))

      await act(async () => {
        fake.drop()
      })

      await waitFor(() => expect(latest!.isAuthenticated).toBe(false))
      await waitFor(() => expect(latest!.device.deviceId).toBeNull())
      expect(latest!.user).toBeNull()
      expect(await latest!.getAccessToken()).toBeUndefined()
      expect(latest!.permissions.size).toBe(0)
      expect(latest!.permissionsError).toBeNull()
      expect(latest!.encryptionKey).toBeNull()
      expect(latest!.encryptionError).toBeNull()
      expect(Array.from(exposedDEK)).toEqual(new Array(32).fill(0))
      expect(latest!.device).toMatchObject({
        deviceId: null,
        known: false,
        confidence: 0,
        newDevice: false,
        loading: false,
        error: null,
      })
    } finally {
      Object.defineProperty(globalThis, 'BroadcastChannel', {
        configurable: true,
        value: originalBroadcastChannel,
      })
    }
  })

  it('binds regional device identification to the exact DPoP request URL', async () => {
    fake = makeFakeAuth({
      initialSession: atolSession(),
      accessToken: 'at_regional_generation',
      dpopActive: true,
    })
    let identifyAuthorization: DeviceAuthorization | undefined
    const regionalIdentifyURL =
      'https://api.eu-1.atol.sh/api/v1/devices/identify'
    loadMock.mockResolvedValue({
      identify: vi.fn().mockImplementation(async ({ authorize }) => {
        identifyAuthorization = await authorize({
          method: 'POST',
          url: regionalIdentifyURL,
        })
        return {
          device_id: 'device-eu-generation',
          known: true,
          confidence: 0.99,
          new_device: false,
          platform: 'macOS',
          browser: 'Safari',
          os_version: '15.5',
          signals: smartSignals,
        }
      }),
    })

    let latest: Snapshot | null = null
    render(
      <AtolProvider
        keyId="atol_kid_test"
        authority="https://auth.atol.test"
        redirectUri="https://app.test/cb"
        apiUrl="https://api.eu-1.atol.sh"
        deviceIntelligence={{ enabled: true, collectOnMount: false }}
      >
        <Harness onState={(state) => (latest = state)} />
      </AtolProvider>,
    )

    await waitFor(() =>
      expect(latest!.device.deviceId).toBe('device-eu-generation'),
    )
    expect(fake.spies.getAccessToken).toHaveBeenCalledWith({
      dpop: {
        method: 'POST',
        url: regionalIdentifyURL,
      },
    })
    expect(identifyAuthorization).toEqual({
      scheme: 'DPoP',
      accessToken: 'at_regional_generation',
      dpopProof: 'fake.dpop.proof',
    })
  })
})
