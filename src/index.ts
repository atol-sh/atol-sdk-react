// Provider
export { AtolProvider } from './provider'
export type { AtolProviderProps } from './provider'

// Zero-knowledge encryption primitives. The provider uses the KEKVault
// internally; most consumers never touch these directly, but they are
// exposed for apps that want custom DEK-lifetime control or tests.
export { KEKVault } from './lib/kekVault'
export { extractKEKFromFragment, kekBase64ToBytes, unwrapDEK } from './lib/encryption'

// Hooks
export { useAtol } from './hooks/use-atol'
export { usePermissions } from './hooks/use-permissions'
export { useUser } from './hooks/use-user'

// Device Intelligence. DeviceProvider is mounted automatically by
// AtolProvider when `deviceIntelligence.enabled` is set -- consumers use
// the `useDevice` hook, not the provider directly.
export { useDevice } from './device/use-device'
export type {
  DeviceConfig,
  DeviceState,
  IdentifyResult,
  SmartSignals,
} from './device/types'

// Components
export { ProtectedRoute } from './components/protected-route'
export { Can } from './components/can'
export { LoginButton, LogoutButton } from './components/auth-buttons'

// Types
export type {
  AtolConfig,
  AtolUser,
  AtolState,
  AtolActions,
  AtolContextValue,
  AtolHookValue,
  DPoPProofResult,
  PermissionCheck,
  TokenResponse,
} from './types'
