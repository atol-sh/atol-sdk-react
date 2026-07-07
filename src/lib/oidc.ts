/**
 * Re-export shim. The oidc-client-ts UserManager wiring now lives in the
 * framework-agnostic core `@atol-sh/js`. Preserves the `./lib/oidc` path.
 */
export {
  createUserManager,
  getAccessToken,
  getIdToken,
  userFromTokenResponse,
} from '@atol-sh/js'
