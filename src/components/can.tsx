import { type PropsWithChildren, type ReactNode } from 'react'
import { usePermissions } from '../hooks/use-permissions'

interface CanProps {
  /** Action to check (e.g. "edit", "manage"). */
  action: string
  /** Resource to check against (e.g. "publication", "team:team-123"). */
  resource: string
  /** Rendered when permission is denied. Default: null. */
  fallback?: ReactNode
}

/**
 * Conditionally renders children based on a permission check.
 *
 * ```tsx
 * <Can action="edit" resource="publication">
 *   <EditButton />
 * </Can>
 * ```
 */
export function Can({
  children,
  action,
  resource,
  fallback = null,
}: PropsWithChildren<CanProps>) {
  const { can } = usePermissions()

  if (can(action, resource)) {
    return <>{children}</>
  }

  return <>{fallback}</>
}
