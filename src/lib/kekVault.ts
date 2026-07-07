/**
 * Re-export shim. The device-bound KEK vault now lives in the
 * framework-agnostic core `@atol-sh/js` (`src/crypto/kek-vault.ts`).
 * Preserves the `./lib/kekVault` import path and the public `KEKVault`
 * export.
 */
export { KEKVault } from '@atol-sh/js'
