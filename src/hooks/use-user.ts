import { useAtolContext } from '../context'
import type { AtolUser } from '../types'

/**
 * Convenience hook that returns just the authenticated user.
 * Returns null if not authenticated.
 *
 * ```tsx
 * const user = useUser()
 * // user?.id, user?.email, user?.name, etc.
 * ```
 */
export function useUser(): AtolUser | null {
  const { user } = useAtolContext()
  return user
}
