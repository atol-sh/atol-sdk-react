/**
 * Re-export shim. The signal-only cross-tab credential channel lives in the
 * framework-agnostic core `@atol-sh/js`. Preserves the
 * `./lib/token-broadcast` path.
 */
export { createTokenBroadcast, hasBroadcastSupport } from '@atol-sh/js'
export type {
  TokenBroadcast,
  BroadcastMessage,
  CredentialsInvalidatedMessage,
  SessionEndedMessage,
} from '@atol-sh/js'
