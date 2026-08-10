import {
  createAtolBrowserAuth,
  type AtolBrowserAuth,
} from '@atol-sh/js'
import { clearTestClient, registerTestClient } from './lib/test-bridge'
import { diagnosticError } from './diagnostics'
import type { AtolConfig, AtolDiagnosticError } from './types'

interface ProviderClientConfig {
  authority: string
  keyId: string
  redirectUri: string
  postLogoutRedirectUri: string | undefined
  scope: string
  audience: string | undefined
  responseVault: boolean
  useDPoP: boolean | undefined
  useRefreshTokens: boolean
  useRefreshTokensFallback: boolean
  deriveEncryptionKey: boolean
  allowTestSessions: boolean
  initialTestSession: AtolConfig['initialTestSession']
}

/**
 * Module-scoped bridge across React 19 Strict Mode's synchronous
 * mount -> cleanup -> remount cycle.
 *
 * Callback processing removes the single-use OIDC state/PKCE entry before
 * the token exchange begins. If each Strict Mode effect mount created an
 * independent client, those clients could race to consume that state and
 * leave the surviving mount unauthenticated. A matching remount therefore
 * adopts the client whose teardown is still pending.
 *
 * Teardown is deferred by one macrotask. A synchronous Strict Mode remount
 * cancels that task and adopts the client; a genuine unmount lets it run.
 */
interface SharedClientSlot {
  key: string
  auth: AtolBrowserAuth
  allowTestSessions: boolean
  state: 'active' | 'teardown_pending' | 'cleanup_failed'
  teardownTimer: ReturnType<typeof setTimeout> | null
  clientDestroyed: boolean
  testClientCleared: boolean
}

let sharedClientSlot: SharedClientSlot | null = null

// `initialTestSession` contains bearer credentials and refresh-token
// material, so it must never participate in a serialized config key. Object
// identity is deliberately conservative: the same object can be reused
// across Strict Mode replay, while a newly supplied response creates a
// distinct client even when its non-secret configuration is unchanged.
const initialTestSessionIDs = new WeakMap<object, number>()
let nextInitialTestSessionID = 1

function initialTestSessionID(
  session: AtolConfig['initialTestSession'],
): number {
  if (!session) return 0
  const existing = initialTestSessionIDs.get(session)
  if (existing !== undefined) return existing
  const id = nextInitialTestSessionID++
  initialTestSessionIDs.set(session, id)
  return id
}

/**
 * Stable identity for the core client's construction config. Runtime
 * callbacks and permission checks are deliberately absent because the
 * provider reads their current values through refs.
 */
function clientConfigKey(config: ProviderClientConfig): string {
  return JSON.stringify([
    config.authority,
    config.keyId,
    config.redirectUri,
    config.postLogoutRedirectUri,
    config.scope,
    config.audience ?? '',
    config.responseVault,
    config.useDPoP,
    config.useRefreshTokens,
    config.useRefreshTokensFallback,
    config.deriveEncryptionKey,
    config.allowTestSessions,
    config.allowTestSessions
      ? initialTestSessionID(config.initialTestSession)
      : 0,
  ])
}

function closeProviderClientSlot(slot: SharedClientSlot): void {
  if (slot.teardownTimer !== null) {
    clearTimeout(slot.teardownTimer)
    slot.teardownTimer = null
  }
  if (!slot.clientDestroyed) {
    try {
      slot.auth.destroy()
      slot.clientDestroyed = true
    } catch {
      // Keep ownership of the client until a later deterministic retry
      // confirms that its credential state and listeners were destroyed.
    }
  }
  if (!slot.testClientCleared) {
    try {
      clearTestClient(slot.auth)
      slot.testClientCleared = true
    } catch {
      // The test bridge is credential-bearing. It remains part of this
      // poisoned slot until its own cleanup succeeds.
    }
  }
  if (!slot.clientDestroyed || !slot.testClientCleared) {
    slot.state = 'cleanup_failed'
    throw diagnosticError('provider_client_cleanup_failed')
  }
  if (sharedClientSlot === slot) sharedClientSlot = null
}

/**
 * Resolve the core auth client for an effect mount. A matching client with
 * deferred teardown is adopted. A different pending client is closed before
 * replacement. A second active provider is rejected because two clients
 * cannot safely share single-use OIDC state or browser credential authority.
 */
export function acquireProviderClient(
  config: ProviderClientConfig,
): AtolBrowserAuth {
  const key = clientConfigKey(config)
  const pending = sharedClientSlot
  if (pending) {
    if (pending.state === 'active') {
      throw diagnosticError('provider_already_mounted')
    }
    if (pending.state === 'teardown_pending' && pending.key === key) {
      if (pending.teardownTimer !== null) {
        clearTimeout(pending.teardownTimer)
      }
      pending.teardownTimer = null
      pending.state = 'active'
      return pending.auth
    }
    // A different pending client, or a previously poisoned client, must be
    // closed completely before a new credential owner can be constructed.
    // Any failed step remains recorded on the slot and blocks acquisition.
    closeProviderClientSlot(pending)
  }

  const auth = createAtolBrowserAuth({
    issuer: config.authority,
    clientId: config.keyId,
    redirectUri: config.redirectUri,
    postLogoutRedirectUri: config.postLogoutRedirectUri,
    scopes: config.scope,
    audience: config.audience,
    responseVault: config.responseVault,
    dpop: config.useDPoP,
    useRefreshTokens: config.useRefreshTokens,
    useRefreshTokensFallback: config.useRefreshTokensFallback,
    deriveEncryptionKey: config.deriveEncryptionKey,
    storage: 'memory',
    allowTestSessions: config.allowTestSessions,
    initialTestSession: config.initialTestSession,
  })
  const slot: SharedClientSlot = {
    key,
    auth,
    allowTestSessions: config.allowTestSessions,
    state: 'active',
    teardownTimer: null,
    clientDestroyed: false,
    testClientCleared: !config.allowTestSessions,
  }
  sharedClientSlot = slot

  if (config.allowTestSessions) {
    try {
      registerTestClient(auth)
    } catch {
      slot.state = 'teardown_pending'
      closeProviderClientSlot(slot)
      throw diagnosticError('auth_initialization_failed')
    }
  }
  return auth
}

/**
 * Defer ownership release long enough for React Strict Mode to synchronously
 * remount and adopt the same client.
 */
export function releaseProviderClient(
  auth: AtolBrowserAuth,
  reportCleanupFailure: (error: AtolDiagnosticError) => void,
): void {
  if (!sharedClientSlot || sharedClientSlot.auth !== auth) return

  const slot = sharedClientSlot
  if (slot.state !== 'active') return
  slot.state = 'teardown_pending'
  slot.teardownTimer = setTimeout(() => {
    try {
      closeProviderClientSlot(slot)
    } catch {
      try {
        reportCleanupFailure(
          diagnosticError('provider_client_cleanup_failed'),
        )
      } catch {
        // The poisoned slot remains authoritative even if diagnostics cannot
        // be reported. A later acquisition still fails closed.
      }
    }
  }, 0)
}

/**
 * Close an acquired client immediately when effect setup cannot return its
 * normal cleanup. Failed teardown remains authoritative and retryable.
 */
export function rollbackProviderClient(auth: AtolBrowserAuth): void {
  if (!sharedClientSlot || sharedClientSlot.auth !== auth) return
  const slot = sharedClientSlot
  slot.state = 'teardown_pending'
  closeProviderClientSlot(slot)
}

/**
 * TEST ONLY. Force-close the shared client so separate test renders cannot
 * adopt one another across Testing Library's per-test cleanup boundary.
 */
export function resetProviderClientForTests(): void {
  const slot = sharedClientSlot
  if (!slot) return
  closeProviderClientSlot(slot)
}
