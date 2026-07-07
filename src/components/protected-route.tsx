import { type PropsWithChildren, type ReactNode, useEffect, useRef } from 'react'
import { useAtol } from '../hooks/use-atol'
import { usePermissions } from '../hooks/use-permissions'

interface ProtectedRouteProps {
  /** Action to check (optional — if omitted, only auth is required). */
  action?: string
  /** Resource to check against. */
  resource?: string
  /** Rendered when permission is denied. Default: null. */
  fallback?: ReactNode
}

/**
 * Route guard. Redirects to login if not authenticated.
 * Optionally checks a permission — renders fallback if denied.
 *
 * ```tsx
 * <ProtectedRoute action="manage" resource="team">
 *   <TeamSettings />
 * </ProtectedRoute>
 * ```
 */
export function ProtectedRoute({
  children,
  action,
  resource,
  fallback = null,
}: PropsWithChildren<ProtectedRouteProps>) {
  const { isAuthenticated, isLoading, login } = useAtol()
  const { can } = usePermissions()
  const loginStarted = useRef(false)

  useEffect(() => {
    if (!isLoading && !isAuthenticated && !loginStarted.current) {
      loginStarted.current = true
      void login({
        returnTo: window.location.pathname + window.location.search,
      })
    }
  }, [isLoading, isAuthenticated, login])

  if (isLoading) {
    return null
  }

  if (!isAuthenticated) {
    return null
  }

  // If a permission is specified, check it.
  if (action && resource && !can(action, resource)) {
    return <>{fallback}</>
  }

  return <>{children}</>
}
