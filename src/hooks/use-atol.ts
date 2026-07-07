import { useAtolContext } from '../context'
import { useDeviceContext } from '../device/context'
import { initialDeviceState, type DeviceState } from '../device/types'
import type { AtolHookValue } from '../types'

/**
 * Primary hook for Atol authentication, authorization, and device intelligence.
 *
 * ```tsx
 * const { isAuthenticated, user, login, logout, getAccessToken, device } = useAtol()
 * ```
 */
export function useAtol(): AtolHookValue {
  const ctx = useAtolContext()
  const deviceCtx = useDeviceContext()

  // If DeviceProvider is not mounted, deviceCtx will be the default (all nulls).
  // We expose it as-is — consumers check device.deviceId for presence.
  const device: DeviceState =
    deviceCtx.deviceId !== null ||
    deviceCtx.loading ||
    deviceCtx.error !== null
      ? deviceCtx
      : initialDeviceState

  return { ...ctx, device }
}
