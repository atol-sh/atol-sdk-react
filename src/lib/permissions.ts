/**
 * Re-export shim. Bulk permission loading now lives in the
 * framework-agnostic core `@atol-sh/js`. Preserves the `./lib/permissions`
 * path.
 */
export { loadPermissions, permissionKey } from '@atol-sh/js'
export type { LoadPermissionsOptions } from '@atol-sh/js'
