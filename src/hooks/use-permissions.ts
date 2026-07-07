import { useCallback } from 'react'
import { useAtolContext } from '../context'
import { permissionKey } from '../lib/permissions'

/**
 * Permission checker for UI gating. Permissions are loaded in bulk at login
 * time — can() is a synchronous Map lookup, not an API call.
 *
 * ```tsx
 * const { can, cannot } = usePermissions()
 *
 * if (can("edit", "publication")) {
 *   // show edit button
 * }
 * ```
 *
 * For permissions not pre-loaded in the AtolProvider `permissions` prop,
 * can() returns false (deny by default).
 *
 * `error` is non-null when the bulk permission load failed -- checks
 * still deny, but the app can distinguish "no permissions" from "failed
 * to load" and offer a retry instead of a permanent access-denied.
 */
export function usePermissions() {
  const { permissions, isLoading, permissionsError } = useAtolContext()

  const can = useCallback(
    (action: string, resource: string): boolean => {
      return permissions.get(permissionKey(action, resource)) === true
    },
    [permissions],
  )

  const cannot = useCallback(
    (action: string, resource: string): boolean => {
      return !can(action, resource)
    },
    [can],
  )

  return { can, cannot, isLoading, error: permissionsError }
}
