import { useAtolContext } from '../context'
import type { AtolUser } from '../types'

/**
 * Convenience hook that returns just the authenticated user.
 * Returns null if not authenticated.
 *
 * ```tsx
 * const user = useUser()
 * // user?.orgId, user?.plan, user?.roles, etc.
 * ```
 */
export function useUser(): AtolUser | null {
  const { user } = useAtolContext()
  return user
}
