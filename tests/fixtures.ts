/** Shared authenticated identity and credential fixtures for provider tests. */
import type { AtolSession, AtolUser } from '@atol-sh/js'

export const ORGANIZATION_ID = '01KV4BNVVNZ4TNY0PP0CVXPZWP'

/** The parsed user matching the claims in `makeIDToken()`. */
export function atolUser(overrides: Partial<AtolUser> = {}): AtolUser {
  return {
    id: 'user-1',
    email: 'remi@example.test',
    emailVerified: true,
    name: 'Remi',
    authMethod: 'oidc',
    mfaVerified: true,
    ...overrides,
  }
}

/** Authenticated session scoped to the default organization fixture. */
export function atolSession(overrides: Partial<AtolSession> = {}): AtolSession {
  return {
    isAuthenticated: true,
    user: atolUser(),
    organizationId: ORGANIZATION_ID,
    ...overrides,
  }
}
