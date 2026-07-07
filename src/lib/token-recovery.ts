/**
 * Re-export shim. Renewal-error classification now lives in the
 * framework-agnostic core `@atol-sh/js`. Preserves the
 * `./lib/token-recovery` path.
 */
export {
  OAuthProtocolError,
  LoginRequiredError,
  NetworkError,
  RecoveryAction,
  classifyRenewalError,
  backoffDelay,
} from '@atol-sh/js'
