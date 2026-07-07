/**
 * DeviceProvider contract tests.
 *
 * The fixture below is the EXACT shape the server returns from
 * POST /api/v1/devices/identify (atol/internal/api/device_handler.go):
 * snake_case top-level fields and the ten smart-signal keys emitted by
 * SignalsToMap. The provider must map those real fields and must not
 * fabricate any signal the server does not send.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import * as React from 'react'
import { DeviceProvider } from '../src/device/DeviceProvider'
import { useDevice } from '../src/device/use-device'
import type { DeviceState } from '../src/device/types'
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
    anomaly_score: 0.35,
  },
}

let identifyMock: ReturnType<typeof vi.fn>

function Harness({ onState }: { onState: (s: DeviceState) => void }) {
  onState(useDevice())
  return null
}

function renderDevice(
  config: Parameters<typeof DeviceProvider>[0]['config'],
  accessToken: string | undefined,
  onState: (s: DeviceState) => void,
) {
  return render(
    <DeviceProvider config={config} accessToken={accessToken}>
      <Harness onState={onState} />
    </DeviceProvider>,
  )
}

beforeEach(() => {
  identifyMock = vi.fn().mockResolvedValue(serverFixture)
  loadMock.mockReset()
  loadMock.mockResolvedValue({ identify: identifyMock })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('DeviceProvider', () => {
  it('maps the server identify response field-for-field', async () => {
    let latest: DeviceState | null = null
    renderDevice({ enabled: true }, 'at_token', (s) => (latest = s))

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

    // Signals: exactly the ten server-side keys, no fabrication
    // (no is_bot/is_vpn/risk_score aliases, no invented fields).
    expect(latest!.signals).toEqual(serverFixture.signals)
    expect(Object.keys(latest!.signals!).sort()).toEqual(
      [
        'anomaly_score',
        'bot',
        'emulator',
        'geo_mismatch',
        'incognito',
        'proxy',
        'rooted',
        'tampered',
        'tor',
        'vpn',
      ].sort(),
    )

    expect(identifyMock).toHaveBeenCalledWith({ token: 'at_token' })
  })

  it('targets the API host, not the OIDC authority: default apiUrl', async () => {
    let latest: DeviceState | null = null
    renderDevice({ enabled: true }, 'at_token', (s) => (latest = s))
    await waitFor(() => expect(latest!.deviceId).toBe('dev_01HXYZ'))
    expect(loadMock).toHaveBeenCalledWith({ endpoint: 'https://api.atol.sh' })
  })

  it('honors an explicit apiUrl', async () => {
    let latest: DeviceState | null = null
    renderDevice(
      { enabled: true, apiUrl: 'https://api.eu-1.atol.sh' },
      'at_token',
      (s) => (latest = s),
    )
    await waitFor(() => expect(latest!.deviceId).toBe('dev_01HXYZ'))
    expect(loadMock).toHaveBeenCalledWith({ endpoint: 'https://api.eu-1.atol.sh' })
  })

  it('handles a null signals payload without fabricating signals', async () => {
    identifyMock.mockResolvedValue({ ...serverFixture, signals: null })

    let latest: DeviceState | null = null
    renderDevice({ enabled: true }, 'at_token', (s) => (latest = s))
    await waitFor(() => expect(latest!.deviceId).toBe('dev_01HXYZ'))
    expect(latest!.signals).toBeNull()
  })

  it('does not identify before an access token exists', async () => {
    let latest: DeviceState | null = null
    renderDevice({ enabled: true }, undefined, (s) => (latest = s))

    // Agent pre-loads, but no identify without a token.
    await waitFor(() => expect(loadMock).toHaveBeenCalled())
    await waitFor(() => expect(latest!.loading).toBe(false))
    expect(identifyMock).not.toHaveBeenCalled()
    expect(latest!.deviceId).toBeNull()
  })

  it('surfaces identify failures as error state', async () => {
    identifyMock.mockRejectedValue(new Error('identify request failed: 500'))

    let latest: DeviceState | null = null
    renderDevice({ enabled: true }, 'at_token', (s) => (latest = s))
    await waitFor(() => expect(latest!.error).toBeInstanceOf(Error))
    expect(latest!.deviceId).toBeNull()
    expect(latest!.loading).toBe(false)
  })
})
