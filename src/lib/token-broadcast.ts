/**
 * Re-export shim. The cross-tab token rotation broadcast now lives in the
 * framework-agnostic core `@atol-sh/js`. Preserves the
 * `./lib/token-broadcast` path.
 */
export { createTokenBroadcast, hasBroadcastSupport } from '@atol-sh/js'
export type {
  TokenBroadcast,
  BroadcastMessage,
  TokenRotatedMessage,
  SessionExpiredMessage,
} from '@atol-sh/js'
