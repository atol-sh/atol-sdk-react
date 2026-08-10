/**
 * DeviceProvider contract tests.
 *
 * The fixture below is the EXACT shape the server returns from
 * POST /api/v1/devices/identify
 * (atol/internal/api/device_handler.go):
 * snake_case top-level fields and the thirteen smart-signal keys emitted by
 * SignalsToMap. The provider must map those real fields and must not
 * fabricate any signal the server does not send.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { DeviceProvider } from '../src/device/DeviceProvider'
import { useDevice } from '../src/device/use-device'
import type { DeviceState } from '../src/device/types'
import type { DeviceAuthorizationOwner } from '@atol-sh/js/device'
import { loadMock } from './stubs/fingerprint'

/** Server-shaped identify response (ground truth: device_handler.go). */
const serverFixture = {
  device_id: 'dev_01HXYZ',
  known: true,
  confidence: 0.92,
  new_device: false,
  platform: 'macOS',
  browser: 'Chrome',
  os_version: '15.5',
  signals: {
    bot: false,
    vpn: true,
    proxy: false,
    tor: false,
    incognito: true,
    tampered: false,
    emulator: false,
    rooted: false,
    geo_mismatch: true,
    device_mismatch: false,
    device_shared: true,
    shared_user_count: 2,
    anomaly_score: 0.35,
  },
}

let identifyMock: ReturnType<typeof vi.fn>
let authorize: DeviceAuthorizationOwner

function Harness({ onState }: { onState: (s: DeviceState) => void }) {
  onState(useDevice())
  return null
}

function renderDevice(
  config: Parameters<typeof DeviceProvider>[0]['config'],
  credentialGeneration: number | null,
  onState: (s: DeviceState) => void,
) {
  return render(
    <DeviceProvider
      config={config}
      credentialGeneration={credentialGeneration}
      authorize={authorize}
    >
      <Harness onState={onState} />
    </DeviceProvider>,
  )
}

beforeEach(() => {
  identifyMock = vi.fn().mockResolvedValue(serverFixture)
  authorize = vi.fn().mockResolvedValue({
    scheme: 'Bearer',
    accessToken: 'at_token',
  })
  loadMock.mockReset()
  loadMock.mockResolvedValue({ identify: identifyMock })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('DeviceProvider', () => {
  it('maps the server identify response field-for-field', async () => {
    let latest: DeviceState | null = null
    renderDevice({ enabled: true }, 1, (s) => (latest = s))

    await waitFor(() => expect(latest!.deviceId).toBe('dev_01HXYZ'))
    expect(latest!).toMatchObject({
      deviceId: 'dev_01HXYZ',
      known: true,
      confidence: 0.92,
      newDevice: false,
      platform: 'macOS',
      browser: 'Chrome',
      osVersion: '15.5',
      loading: false,
      error: null,
    })

    // Signals: exactly the thirteen server-side keys, no fabrication
    // (no is_bot/is_vpn/risk_score aliases, no invented fields).
    expect(latest!.signals).toEqual(serverFixture.signals)
    expect(Object.keys(latest!.signals!).sort()).toEqual(
      [
        'anomaly_score',
        'bot',
        'device_mismatch',
        'device_shared',
        'emulator',
        'geo_mismatch',
        'incognito',
        'proxy',
        'rooted',
        'shared_user_count',
        'tampered',
        'tor',
        'vpn',
      ].sort(),
    )

    expect(identifyMock).toHaveBeenCalledWith({ authorize })
  })

  it('targets the API host, not the OIDC authority: default apiUrl', async () => {
    let latest: DeviceState | null = null
    renderDevice({ enabled: true }, 1, (s) => (latest = s))
    await waitFor(() => expect(latest!.deviceId).toBe('dev_01HXYZ'))
    expect(loadMock).toHaveBeenCalledWith({ endpoint: 'https://api.atol.sh' })
  })

  it('honors an explicit apiUrl', async () => {
    let latest: DeviceState | null = null
    renderDevice(
      { enabled: true, apiUrl: 'https://api.eu-1.atol.sh' },
      1,
      (s) => (latest = s),
    )
    await waitFor(() => expect(latest!.deviceId).toBe('dev_01HXYZ'))
    expect(loadMock).toHaveBeenCalledWith({ endpoint: 'https://api.eu-1.atol.sh' })
  })

  it('hides old-region state synchronously and re-identifies after the API host changes', async () => {
    let latest: DeviceState | null = null
    const history: DeviceState[] = []
    identifyMock
      .mockResolvedValueOnce(serverFixture)
      .mockResolvedValueOnce({
        ...serverFixture,
        device_id: 'dev_eu_region',
      })
    const rendered = renderDevice(
      { enabled: true, collectOnMount: false },
      1,
      (state) => {
        latest = state
        history.push(state)
      },
    )
    await waitFor(() => expect(latest!.deviceId).toBe('dev_01HXYZ'))
    const regionChangeStart = history.length

    rendered.rerender(
      <DeviceProvider
        config={{
          enabled: true,
          collectOnMount: false,
          apiUrl: 'https://api.eu-1.atol.sh',
        }}
        credentialGeneration={1}
        authorize={authorize}
      >
        <Harness
          onState={(state) => {
            latest = state
            history.push(state)
          }}
        />
      </DeviceProvider>,
    )

    expect(history.slice(regionChangeStart)).not.toContainEqual(
      expect.objectContaining({ deviceId: 'dev_01HXYZ' }),
    )
    await waitFor(() => expect(identifyMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(latest!.deviceId).toBe('dev_eu_region'))
    expect(loadMock).toHaveBeenLastCalledWith({
      endpoint: 'https://api.eu-1.atol.sh',
    })
    expect(history.slice(regionChangeStart)).not.toContainEqual(
      expect.objectContaining({ deviceId: 'dev_01HXYZ' }),
    )
  })

  it('rejects a null signals payload instead of treating it as clean', async () => {
    identifyMock.mockResolvedValue({ ...serverFixture, signals: null })

    let latest: DeviceState | null = null
    renderDevice({ enabled: true }, 1, (s) => (latest = s))
    await waitFor(() =>
      expect(latest!.error).toMatchObject({
        code: 'device_response_invalid',
      }),
    )
    expect(latest!.deviceId).toBeNull()
    expect(latest!.signals).toBeNull()
  })

  it('does not identify before a credential generation exists', async () => {
    let latest: DeviceState | null = null
    renderDevice({ enabled: true }, null, (s) => (latest = s))

    // Agent pre-loads, but no identify without credential authority.
    await waitFor(() => expect(loadMock).toHaveBeenCalled())
    await waitFor(() => expect(latest!.loading).toBe(false))
    expect(identifyMock).not.toHaveBeenCalled()
    expect(latest!.deviceId).toBeNull()
  })

  it('clears identified state and ignores an in-flight result after credential removal', async () => {
    let resolveIdentify:
      | ((value: typeof serverFixture) => void)
      | undefined
    identifyMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveIdentify = resolve
        }),
    )
    let latest: DeviceState | null = null
    const rendered = renderDevice(
      { enabled: true, collectOnMount: false },
      1,
      (state) => (latest = state),
    )
    await waitFor(() => expect(identifyMock).toHaveBeenCalledTimes(1))

    rendered.rerender(
      <DeviceProvider
        config={{ enabled: true, collectOnMount: false }}
        credentialGeneration={null}
        authorize={authorize}
      >
        <Harness onState={(state) => (latest = state)} />
      </DeviceProvider>,
    )
    await waitFor(() =>
      expect(latest!).toMatchObject({ deviceId: null, loading: false }),
    )

    resolveIdentify!(serverFixture)
    await Promise.resolve()
    expect(latest!.deviceId).toBeNull()
    expect(latest!.loading).toBe(false)
  })

  it('never renders successful state from a removed credential generation', async () => {
    let latest: DeviceState | null = null
    const history: DeviceState[] = []
    const rendered = renderDevice(
      { enabled: true, collectOnMount: false },
      1,
      (state) => {
        latest = state
        history.push(state)
      },
    )
    await waitFor(() => expect(latest!.deviceId).toBe('dev_01HXYZ'))
    const removalStart = history.length

    rendered.rerender(
      <DeviceProvider
        config={{ enabled: true, collectOnMount: false }}
        credentialGeneration={null}
        authorize={authorize}
      >
        <Harness
          onState={(state) => {
            latest = state
            history.push(state)
          }}
        />
      </DeviceProvider>,
    )

    expect(latest!.deviceId).toBeNull()
    expect(history.slice(removalStart)).not.toContainEqual(
      expect.objectContaining({ deviceId: 'dev_01HXYZ' }),
    )
  })

  it('never renders state from the prior generation while the next is pending', async () => {
    let resolveSecond:
      | ((value: typeof serverFixture) => void)
      | undefined
    identifyMock
      .mockResolvedValueOnce(serverFixture)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve
          }),
      )
    let latest: DeviceState | null = null
    const history: DeviceState[] = []
    const rendered = renderDevice(
      { enabled: true, collectOnMount: false },
      1,
      (state) => {
        latest = state
        history.push(state)
      },
    )
    await waitFor(() => expect(latest!.deviceId).toBe('dev_01HXYZ'))
    const rotationStart = history.length

    rendered.rerender(
      <DeviceProvider
        config={{ enabled: true, collectOnMount: false }}
        credentialGeneration={2}
        authorize={authorize}
      >
        <Harness
          onState={(state) => {
            latest = state
            history.push(state)
          }}
        />
      </DeviceProvider>,
    )

    expect(latest!.deviceId).toBeNull()
    await waitFor(() => expect(resolveSecond).toBeDefined())
    expect(history.slice(rotationStart)).not.toContainEqual(
      expect.objectContaining({ deviceId: 'dev_01HXYZ' }),
    )

    resolveSecond!({
      ...serverFixture,
      device_id: 'dev_generation_two',
    })
    await waitFor(() =>
      expect(latest!.deviceId).toBe('dev_generation_two'),
    )
    expect(history.slice(rotationStart)).not.toContainEqual(
      expect.objectContaining({ deviceId: 'dev_01HXYZ' }),
    )
  })

  it('surfaces identify failures as error state', async () => {
    identifyMock.mockRejectedValue(new Error('identify request failed: 500'))

    let latest: DeviceState | null = null
    renderDevice({ enabled: true }, 1, (s) => (latest = s))
    await waitFor(() => expect(latest!.error).toBeInstanceOf(Error))
    expect(latest!.deviceId).toBeNull()
    expect(latest!.loading).toBe(false)
  })
})
