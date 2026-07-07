/**
 * Re-export shim. Device intelligence types now live in the
 * framework-agnostic core `@atol-sh/js/device`. This file preserves the
 * internal `./device/types` import path and the SDK's public device type
 * surface (DeviceConfig, DeviceState, IdentifyResult, SmartSignals,
 * initialDeviceState).
 */
export {
  initialDeviceState,
  type DeviceConfig,
  type DeviceState,
  type IdentifyResult,
  type SmartSignals,
} from '@atol-sh/js/device'
