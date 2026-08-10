/**
 * Re-export shim. Silent renewal, the token endpoint helpers, and the
 * PKCE machinery now live in the framework-agnostic core `@atol-sh/js`.
 * Preserves the `./lib/silent-renew` import path used by the provider and
 * the renewal hook.
 */
export {
  LoginRequiredError,
  exchangeCode,
  refreshTokenGrant,
  DEFAULT_AUTHORIZE_TIMEOUT_MS,
  DEFAULT_SILENT_RENEW_RETRY_COUNT,
} from '@atol-sh/js'
export type { TokenResponse, DPoPSigner } from '@atol-sh/js'
