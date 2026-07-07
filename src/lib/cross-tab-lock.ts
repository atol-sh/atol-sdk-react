/**
 * Re-export shim. Cross-tab locking now lives in the framework-agnostic
 * core `@atol-sh/js`. Preserves the internal `./lib/cross-tab-lock` path.
 */
export { withTabLock, hasTabLockSupport } from '@atol-sh/js'
