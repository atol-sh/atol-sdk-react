import { useDeviceContext } from './context'
import type { DeviceState } from './types'

/**
 * Hook for device intelligence state.
 *
 * Returns the current device fingerprint, smart signals, and loading state.
 * Requires `deviceIntelligence.enabled: true` in the AtolProvider config.
 *
 * ```tsx
 * const { deviceId, known, confidence, signals, loading, error } = useDevice()
 *
 * if (signals?.bot) {
 *   // handle bot detection
 * }
 * ```
 */
export function useDevice(): DeviceState {
  return useDeviceContext()
}
