/** Shared AtolUser fixture for provider tests. */
import type { AtolUser } from '@atol-sh/js'

/** The parsed user matching the claims in `makeIDToken()`. */
export function atolUser(overrides: Partial<AtolUser> = {}): AtolUser {
  return {
    id: 'user-1',
    email: 'remi@example.test',
    emailVerified: true,
    name: 'Remi',
    orgId: 'org-1',
    plan: 'pro',
    roles: ['admin'],
    authMethod: 'oidc',
    mfaVerified: true,
    ...overrides,
  }
}
