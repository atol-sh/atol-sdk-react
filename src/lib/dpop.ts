/**
 * Re-export shim. The DPoP (RFC 9449) key manager now lives in the
 * framework-agnostic core `@atol-sh/js`. Preserves the `./lib/dpop` path.
 */
export { createDPoPKeyManager } from '@atol-sh/js'
export type { DPoPKeyManager, DPoPProofOptions } from '@atol-sh/js'
