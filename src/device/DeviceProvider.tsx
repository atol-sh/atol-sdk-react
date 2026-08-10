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
import {
  DeviceCollector,
  DEFAULT_DEVICE_API_URL,
  type DeviceAuthorizationOwner,
} from '@atol-sh/js/device'

interface DeviceProviderProps extends PropsWithChildren {
  config: DeviceConfig
  credentialGeneration: number | null
  authorize: DeviceAuthorizationOwner
}

interface PublishedDeviceState {
  state: DeviceState
  credentialGeneration: number | null
  apiUrl: string
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
  credentialGeneration,
  authorize,
}: DeviceProviderProps) {
  const [published, setPublished] = useState<PublishedDeviceState | null>(null)

  const apiUrl = config.apiUrl ?? DEFAULT_DEVICE_API_URL
  const collectOnMount = config.collectOnMount ?? true
  const recheckInterval = config.recheckInterval ?? 0

  // The collector instance, recreated when the endpoint changes so a
  // changed apiUrl reloads the agent rather than pinning to the first host.
  const collectorRef = useRef<DeviceCollector | null>(null)
  const collectorApiUrlRef = useRef<string | null>(null)
  const collectorGenerationRef = useRef<number | null>(null)
  // Each collector callback is bound to the credential lifecycle that
  // created it. Dropping a token invalidates the old sink so an identify
  // response already in flight cannot repopulate signed-out device state.
  const collectorEpochRef = useRef(0)
  // Non-secret credential generation last submitted. Raw access tokens and
  // DPoP proofs remain inside the operation-scoped authorization owner.
  const lastGenerationRef = useRef<number | null>(null)

  const collect = useCallback(
    (generation: number | null): Promise<void> => {
      if (
        !collectorRef.current ||
        collectorApiUrlRef.current !== apiUrl ||
        collectorGenerationRef.current !== generation
      ) {
        const collectorEpoch = ++collectorEpochRef.current
        collectorRef.current?.invalidate()
        collectorRef.current = new DeviceCollector(apiUrl, (next) => {
          if (collectorEpoch === collectorEpochRef.current) {
            setPublished({
              state: next,
              credentialGeneration: generation,
              apiUrl,
            })
          }
        })
        collectorApiUrlRef.current = apiUrl
        collectorGenerationRef.current = generation
      }
      const p =
        generation === null
          ? collectorRef.current.prepare()
          : collectorRef.current.collect({
              credentialGeneration: generation,
              authorize,
            })
      if (generation !== null) lastGenerationRef.current = generation
      return p
    },
    [apiUrl, authorize],
  )

  // Collect on mount if configured (pre-loads the agent, no token yet).
  useEffect(() => {
    if (
      !config.enabled ||
      !collectOnMount ||
      credentialGeneration !== null
    ) {
      return
    }
    void collect(null)
  }, [config.enabled, collectOnMount, collect, credentialGeneration])

  // Submit identify for each non-secret credential generation. The operation
  // owner resolves the exact token/proof pair only after collection begins.
  useEffect(() => {
    if (!config.enabled) {
      collectorEpochRef.current++
      collectorRef.current?.invalidate()
      collectorRef.current = null
      collectorApiUrlRef.current = null
      collectorGenerationRef.current = null
      lastGenerationRef.current = null
      setPublished(null)
      return
    }
    if (credentialGeneration === null) {
      if (lastGenerationRef.current !== null) {
        collectorEpochRef.current++
        collectorRef.current?.invalidate()
        collectorRef.current = null
        collectorApiUrlRef.current = null
        collectorGenerationRef.current = null
        setPublished(null)
      }
      lastGenerationRef.current = null
      return
    }
    if (
      lastGenerationRef.current === credentialGeneration &&
      collectorApiUrlRef.current === apiUrl
    ) {
      return
    }
    void collect(credentialGeneration)
  }, [apiUrl, collect, config.enabled, credentialGeneration])

  useEffect(
    () => () => {
      collectorEpochRef.current++
      collectorRef.current?.invalidate()
      collectorRef.current = null
      collectorApiUrlRef.current = null
      collectorGenerationRef.current = null
    },
    [],
  )

  // Recheck interval.
  useEffect(() => {
    if (
      !config.enabled ||
      recheckInterval <= 0 ||
      credentialGeneration === null
    ) {
      return
    }
    const interval = setInterval(() => {
      void collect(credentialGeneration)
    }, recheckInterval)
    return () => clearInterval(interval)
  }, [config.enabled, recheckInterval, credentialGeneration, collect])

  // State belongs to the exact credential generation and API region that
  // produced it. This render-time check hides stale state before passive
  // effects run when credentials disappear, rotate, or move to another host.
  const value = useMemo(
    () =>
      config.enabled &&
      published?.credentialGeneration === credentialGeneration &&
      published.apiUrl === apiUrl
        ? published.state
        : initialDeviceState,
    [apiUrl, config.enabled, credentialGeneration, published],
  )

  return (
    <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>
  )
}
