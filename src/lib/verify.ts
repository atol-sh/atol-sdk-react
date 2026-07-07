/**
 * Re-export shim. JWKS-based ID token verification now lives in the
 * framework-agnostic core `@atol-sh/js`. Preserves the `./lib/verify` path.
 */
export { verifyIdToken, _resetDiscoveryCache } from '@atol-sh/js'
