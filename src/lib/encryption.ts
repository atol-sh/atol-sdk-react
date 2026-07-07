/**
 * Re-export shim. Zero-knowledge encryption helpers now live in the
 * framework-agnostic core `@atol-sh/js`. Preserves the `./lib/encryption`
 * path (and the public `extractKEKFromFragment` / `kekBase64ToBytes` /
 * `unwrapDEK` surface re-exported from the SDK barrel).
 */
export { extractKEKFromFragment, kekBase64ToBytes, unwrapDEK } from '@atol-sh/js'
