/**
 * Re-export shim. JWT claim parsing now lives in the framework-agnostic
 * core `@atol-sh/js`. Preserves the internal `./lib/claims` import path.
 */
export { parseAtolUser, decodeJWTPayload, getTokenExpiry } from '@atol-sh/js'
