import {
  type PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { DeviceContext } from './context'
import { initialDeviceState, type DeviceConfig, type DeviceState } from './types'
import { DeviceCollector, DEFAULT_DEVICE_API_URL } from '@atol-sh/js/device'

interface DeviceProviderProps extends PropsWithChildren {
  config: DeviceConfig
  accessToken: string | undefined
}

/**
 * DeviceProvider manages device intelligence collection via the
 * framework-agnostic `DeviceCollector` from `@atol-sh/js/device` (which
 * dynamically imports `@atol-sh/fingerprint`, an optional peer dependency,
 * to keep it out of the critical bundle path). This component is a thin
 * React wrapper: it owns the reactive DeviceState and drives the collector
 * on mount, on access-token change, and on the recheck interval.
 */
export function DeviceProvider({
  children,
  config,
  accessToken,
}: DeviceProviderProps) {
  const [state, setState] = useState<DeviceState>(initialDeviceState)

  const apiUrl = config.apiUrl ?? DEFAULT_DEVICE_API_URL
  const collectOnMount = config.collectOnMount ?? true
  const recheckInterval = config.recheckInterval ?? 0

  // The collector instance, recreated when the endpoint changes so a
  // changed apiUrl reloads the agent rather than pinning to the first host.
  const collectorRef = useRef<DeviceCollector | null>(null)
  const collectorApiUrlRef = useRef<string | null>(null)
  // The last access token we successfully identified with -- so a rotated
  // token re-identifies and a logout (token cleared) re-arms identify.
  const lastTokenRef = useRef<string | null>(null)

  const collect = useCallback(
    (token?: string): Promise<void> => {
      if (!collectorRef.current || collectorApiUrlRef.current !== apiUrl) {
        collectorRef.current = new DeviceCollector(apiUrl, setState)
        collectorApiUrlRef.current = apiUrl
      }
      const p = collectorRef.current.collect(token)
      if (token) lastTokenRef.current = token
      return p
    },
    [apiUrl],
  )

  // Collect on mount if configured (pre-loads the agent, no token yet).
  useEffect(() => {
    if (!config.enabled || !collectOnMount) return
    void collect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.enabled, collectOnMount])

  // Submit identify whenever the access token changes to a new value, so a
  // silent renew re-identifies with fresh credentials. Clearing the token
  // (logout) re-arms identify for the next login.
  useEffect(() => {
    if (!config.enabled) return
    if (!accessToken) {
      lastTokenRef.current = null
      return
    }
    if (lastTokenRef.current === accessToken) return
    void collect(accessToken)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.enabled, accessToken])

  // Recheck interval.
  useEffect(() => {
    if (!config.enabled || recheckInterval <= 0 || !accessToken) return
    const interval = setInterval(() => {
      void collect(accessToken)
    }, recheckInterval)
    return () => clearInterval(interval)
  }, [config.enabled, recheckInterval, accessToken, collect])

  const value = useMemo(() => state, [state])

  return (
    <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>
  )
}
