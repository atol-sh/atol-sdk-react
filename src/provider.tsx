import {
  type PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  type AtolBrowserAuth,
  type AtolSession,
  type DPoPProofResult,
  type DPoPSigner,
} from '@atol-sh/js'
import { AtolContext } from './context'
import { loadPermissions } from './lib/permissions'
import { DeviceProvider } from './device/DeviceProvider'
import type { DeviceAuthorizationOwner } from '@atol-sh/js/device'
import {
  closedDiagnosticError,
  diagnosticError,
  logDiagnostic,
} from './diagnostics'
import {
  acquireProviderClient,
  releaseProviderClient,
  resetProviderClientForTests,
  rollbackProviderClient,
} from './provider-client'
import type {
  AtolConfig,
  AtolDiagnosticCode,
  AtolDiagnosticError,
  AtolUser,
  PermissionCheck,
} from './types'

export type AtolProviderProps = PropsWithChildren<AtolConfig>

/** Control-plane API host that serves AccessService + device identify. */
const DEFAULT_API_URL = 'https://api.atol.sh'

async function runProviderAction<T>(
  auth: AtolBrowserAuth | null,
  failureCode: AtolDiagnosticCode,
  operation: (active: AtolBrowserAuth) => Promise<T>,
): Promise<T> {
  if (!auth) {
    throw diagnosticError('provider_not_mounted')
  }
  try {
    return await operation(auth)
  } catch {
    throw diagnosticError(failureCode)
  }
}

/**
 * TEST ONLY. Force-clear the module-scoped shared-client bridge and
 * synchronously destroy whatever client currently occupies it (whether its
 * teardown is pending or it is still actively mounted).
 *
 * The deferred-teardown window that makes Strict Mode's double-invoke safe
 * (see `provider-client.ts`) is scoped to "does a remount
 * follow synchronously in this effects flush", not "does another render()
 * call happen eventually". A test harness that unmounts one `<AtolProvider>`
 * render and mounts another with the same config (React Testing Library's
 * per-test `cleanup()`, run via a global `afterEach`) does NOT run inside
 * that flush, so without this reset the next test's mount would wrongly
 * adopt the previous test's still-pending-teardown client instead of
 * building its own. Not part of the public API -- call from a test setup
 * file's `afterEach`, e.g. `@atol-sh/react`'s own `tests/setup.ts`.
 */
export function __resetAtolSharedClientForTests(): void {
  resetProviderClientForTests()
}

/**
 * AtolProvider wraps your app with authentication (OIDC) and
 * frontend authorization (permission loading). Mount once at the root.
 *
 * The auth session and its renewal are owned by a single
 * `createAtolBrowserAuth` instance from `@atol-sh/js` -- the same
 * framework-agnostic client the Atol console uses. This provider is a thin
 * React binding over it: it subscribes to `onSessionChange` for React
 * state and layers the React-specific concerns (permission loading, device
 * intelligence) on top. Zero-knowledge encryption (KEK/DEK derivation,
 * vault management, fail-loud-on-tamper) is owned by the core client -- the
 * provider mirrors the resulting `encryptionKey` and converts only the
 * presence of `encryptionError` into a bounded React diagnostic.
 *
 * This is a client component: it uses React context, browser crypto, and
 * IndexedDB. Under Next.js App Router (or any RSC framework) it must be
 * imported from a `"use client"` module. The published bundle carries a
 * `"use client"` banner so importing it into a client boundary works
 * without extra wiring.
 *
 * ```tsx
 * <AtolProvider
 *   keyId="atol_kid_abc123"
 *   authority="https://auth.atol.sh"
 *   redirectUri="https://app.example.com/callback"
 *   postLogoutRedirectUri="https://app.example.com/signed-out"
 * >
 *   <App />
 * </AtolProvider>
 * ```
 *
 * Token storage: the OIDC user (access/ID/refresh tokens) lives in
 * memory only -- never localStorage or sessionStorage. sessionStorage
 * holds nothing but the OIDC state/PKCE verifier needed to survive the
 * login redirect. After a page reload the in-memory store is empty, so
 * the client attempts one silent renew against the IdP session cookie
 * before settling on unauthenticated.
 */
export function AtolProvider({
  children,
  keyId,
  authority,
  apiUrl = DEFAULT_API_URL,
  redirectUri,
  postLogoutRedirectUri,
  scope = 'openid profile email',
  audience,
  responseVault = false,
  permissions: permissionChecks = [],
  onLogin,
  onLogout,
  onPermissionsError,
  deviceIntelligence,
  deriveEncryptionKey,
  useRefreshTokens = false,
  useRefreshTokensFallback = false,
  useDPoP,
  allowTestSessions = false,
  initialTestSession,
}: AtolProviderProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [user, setUser] = useState<AtolUser | null>(null)
  const [organizationId, setOrganizationId] = useState<string | null>(null)
  const [error, setError] =
    useState<AtolDiagnosticError | null>(null)
  const [permissions, setPermissions] = useState<Map<string, boolean>>(new Map())
  const [permissionsError, setPermissionsError] =
    useState<AtolDiagnosticError | null>(null)
  const [deviceCredentialGeneration, setDeviceCredentialGeneration] =
    useState<number | null>(null)
  // Zero-knowledge encryption key/error. Derived by the core client (KEK
  // from the URL fragment, wrapped DEK from the ID token, unwrap +
  // device-bound vault); the provider only mirrors the result from the
  // session-change payload. Starts null and is populated once the core
  // settles a session under `deriveEncryptionKey`.
  const [encryptionKey, setEncryptionKey] = useState<Uint8Array | null>(null)
  // Non-null when the core reports an expected DEK could not be unwrapped.
  // The core Error object is never retained; React exposes one closed
  // diagnostic so the app can deny encrypted operations safely.
  const [encryptionError, setEncryptionError] =
    useState<AtolDiagnosticError | null>(null)

  // The single auth client that owns the session + renewal. Every
  // credential decision (token access, renewal, DPoP proof, login, logout)
  // delegates here. The instance is created (or, on a Strict Mode remount,
  // adopted through `provider-client.ts`)
  // inside the mount effect below, NOT in the render body, so its lifetime
  // is tied to the effect rather than to a single render. The action
  // callbacks read this ref only after mount, by which point the effect has
  // populated it.
  const authRef = useRef<AtolBrowserAuth | null>(null)
  // Every session change advances this epoch. Manual logout advances it
  // synchronously before awaiting the core so deferred credential work can
  // never repopulate state after the user has chosen to sign out.
  const sessionEpochRef = useRef(0)

  // Mirror volatile state/props into refs so the stable callbacks below can
  // read current values without listing them in dep arrays (which would
  // churn the effect that owns the auth-session subscription).
  const permissionChecksRef = useRef<PermissionCheck[]>(permissionChecks)
  permissionChecksRef.current = permissionChecks
  const callbacksRef = useRef({ onLogin, onLogout, onPermissionsError })
  callbacksRef.current = { onLogin, onLogout, onPermissionsError }

  /**
   * (Re)load permissions for the current identity. Called on initial login
   * AND on every token renewal (via onSessionChange) so a server-side
   * grant/revocation is picked up within the session. Deny-by-default holds
   * while the load is in flight and on failure (the map is cleared before
   * each credential transition and replaced only on success).
   */
  const reloadPermissions = useCallback(
    async (
      atolUser: AtolUser,
      credentialOrganizationId: string | undefined,
      token: string | undefined,
      isCurrent: () => boolean,
    ): Promise<void> => {
      const checks = permissionChecksRef.current
      if (checks.length === 0) return
      const publishFailure = (
        code: Extract<
          AtolDiagnosticCode,
          | 'permissions_organization_required'
          | 'session_token_unavailable'
          | 'permissions_load_failed'
        >,
      ): void => {
        if (!isCurrent()) return
        const diagnostic = diagnosticError(code)
        logDiagnostic('permission load', diagnostic)
        setPermissionsError(diagnostic)
        try {
          callbacksRef.current.onPermissionsError?.(diagnostic)
        } catch {
          // A host callback cannot change the deny-by-default result.
        }
      }
      if (!credentialOrganizationId) {
        publishFailure('permissions_organization_required')
        return
      }
      if (!token) {
        publishFailure('session_token_unavailable')
        return
      }
      try {
        let dpop: DPoPSigner | undefined
        if (authRef.current?.isDPoPActive()) {
          const expectedAccessToken = token
          dpop = {
            async signProof(method, url, options): Promise<string> {
              if (options?.accessToken !== expectedAccessToken) {
                throw new Error(
                  'Cannot load permissions: DPoP signer received a different access token',
                )
              }
              // Resolve the token and its proof atomically from the core.
              // If an organization transition committed since this load
              // captured its token, reject before loadPermissions reaches
              // fetch rather than pairing token A with a proof for token B.
              const result = await authRef.current?.getAccessToken({
                dpop: { method, url },
              })
              if (!result?.proof) {
                throw new Error(
                  'Cannot load permissions: DPoP proof is unavailable',
                )
              }
              if (result.token !== expectedAccessToken) {
                throw new Error(
                  'Cannot load permissions: credential changed while producing the DPoP proof',
                )
              }
              return result.proof
            },
          }
        }
        const perms = await loadPermissions({
          apiUrl,
          keyId,
          accessToken: token,
          userId: atolUser.id,
          orgId: credentialOrganizationId,
          checks,
          dpop,
        })
        if (!isCurrent()) return
        setPermissions(perms)
        setPermissionsError(null)
      } catch {
        // Deny-by-default stays in force (the permission map was cleared).
        // The caught value is deliberately discarded before state, callbacks,
        // or console diagnostics are updated.
        publishFailure('permissions_load_failed')
      }
    },
    [apiUrl, keyId],
  )

  /**
   * Own the auth session for the provider's lifetime. Subscribe to the core
   * client's session changes (login, logout, renewal, cross-tab revalidation)
   * and mirror them into React state, layering permission loading on each
   * change and mirroring the core-derived encryption key/error. Then init()
   * the client (handles a redirect callback or a silent restore). Runs once
   * on mount; the client is torn down on unmount.
   */
  useEffect(() => {
    let auth: AtolBrowserAuth
    try {
      auth = acquireProviderClient({
        authority,
        keyId,
        redirectUri,
        postLogoutRedirectUri,
        scope,
        audience,
        responseVault,
        useDPoP,
        useRefreshTokens,
        useRefreshTokensFallback,
        deriveEncryptionKey: deriveEncryptionKey === true,
        allowTestSessions,
        initialTestSession,
      })
    } catch (error) {
      throw closedDiagnosticError(error, 'auth_initialization_failed')
    }
    authRef.current = auth
    let cancelled = false
    let sessionWasAuthenticated = false
    // Track identity so callbacks fire once per login/logout transition,
    // not on every proactive token renewal.
    let lastUserId: string | null = null

    async function onSession(session: AtolSession): Promise<void> {
      if (cancelled) return
      const epoch = ++sessionEpochRef.current
      const isCurrent = () => !cancelled && epoch === sessionEpochRef.current
      const atolUser = session.user
      const wasAuthenticated = sessionWasAuthenticated
      sessionWasAuthenticated = atolUser !== null
      const credentialOrganizationId = atolUser ? session.organizationId : undefined
      setUser(atolUser)
      setOrganizationId(credentialOrganizationId ?? null)
      setDeviceCredentialGeneration(null)
      // A permission result is valid only for the exact credential context
      // that produced it. Clear it before resolving the new token/scope so a
      // failed or superseded organization transition cannot retain grants
      // from the previous organization.
      setPermissions(new Map())
      setPermissionsError(null)
      if (!atolUser && wasAuthenticated) {
        callbacksRef.current.onLogout?.()
      }

      // Mirror the core-derived zero-knowledge key into React state and map
      // only the presence of its error into a closed diagnostic on
      // every session change. The core owns derivation (provision on a fresh
      // callback, rehydrate on restore/renew) and fails loud on tamper (an
      // AES-GCM auth-tag failure sets encryptionError with no key). The
      // provider only reflects the result. Undefined maps to null so the
      // React contract stays `T | null`.
      if (deriveEncryptionKey) {
        setEncryptionKey(session.encryptionKey ?? null)
        setEncryptionError(
          session.encryptionError
            ? diagnosticError('encryption_key_unavailable')
            : null,
        )
      }

      if (atolUser) {
        let res: Awaited<ReturnType<typeof auth.getAccessToken>>
        try {
          res = await auth.getAccessToken()
        } catch {
          if (!isCurrent()) return
          const diagnostic = diagnosticError(
            'session_token_unavailable',
          )
          logDiagnostic('session token', diagnostic)
          setError(diagnostic)
          await reloadPermissions(
            atolUser,
            credentialOrganizationId,
            undefined,
            isCurrent,
          )
          return
        }
        if (!isCurrent()) return
        const token = res?.token
        setDeviceCredentialGeneration(token ? epoch : null)

        // Permissions are tied to identity; refresh on every renewal so
        // grants/revocations take effect mid-session.
        await reloadPermissions(
          atolUser,
          credentialOrganizationId,
          token,
          isCurrent,
        )
        if (!isCurrent()) return

        if (atolUser.id !== lastUserId) {
          lastUserId = atolUser.id
          callbacksRef.current.onLogin?.(atolUser)
        }
      } else {
        setDeviceCredentialGeneration(null)
        if (lastUserId !== null) {
          lastUserId = null
          // A session drop from the core (terminal renewal failure /
          // cross-tab session-ended) resets local derived state. The core
          // already cleared its own encryption key; the mirror above (with
          // the now-empty session) reflects that, and permissions reset here.
          setPermissions(new Map())
          setPermissionsError(null)
        }
      }
    }

    let unsubscribe: (() => void) | undefined
    try {
      unsubscribe = auth.onSessionChange((session) => {
        void onSession(session)
      })
      auth
        .init()
        .catch(() => {
          if (!cancelled) {
            const diagnostic = diagnosticError(
              'auth_initialization_failed',
            )
            logDiagnostic('auth init', diagnostic)
            setError(diagnostic)
          }
        })
        .finally(() => {
          if (!cancelled) setIsLoading(false)
        })
    } catch {
      cancelled = true
      if (authRef.current === auth) authRef.current = null
      let cleanupFailed = false
      try {
        unsubscribe?.()
      } catch {
        cleanupFailed = true
      }
      try {
        rollbackProviderClient(auth)
      } catch {
        cleanupFailed = true
      }
      throw diagnosticError(
        cleanupFailed
          ? 'provider_client_cleanup_failed'
          : 'auth_initialization_failed',
      )
    }

    return () => {
      cancelled = true
      let cleanupFailed = false
      try {
        unsubscribe()
      } catch {
        cleanupFailed = true
      } finally {
        if (authRef.current === auth) authRef.current = null
        releaseProviderClient(auth, (diagnostic) => {
          logDiagnostic('provider client cleanup', diagnostic)
        })
      }
      if (cleanupFailed) {
        throw diagnosticError('provider_client_cleanup_failed')
      }
    }
    // Only run on mount. The client is built (or adopted) once from the
    // initial props; props are captured at construction (the client owns
    // the session for the provider's lifetime), so this effect intentionally
    // has no deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const login = useCallback(
    (options?: { returnTo?: string }) =>
      runProviderAction(
        authRef.current,
        'login_failed',
        (auth) =>
          auth.beginLogin({ returnTo: options?.returnTo }),
      ),
    [],
  )

  const selectOrganization = useCallback(
    (organizationId: string): Promise<AtolSession> =>
      runProviderAction(
        authRef.current,
        'organization_selection_failed',
        (auth) => auth.selectOrganization(organizationId),
      ),
    [],
  )

  const logout = useCallback(async () => {
    // Reset the React-derived state first; the core client handles refresh-
    // token revocation, RP-initiated end_session (with id_token_hint), AND
    // clearing the zero-knowledge key + wiping the device-bound KEK vault.
    sessionEpochRef.current++
    setUser(null)
    setOrganizationId(null)
    setDeviceCredentialGeneration(null)
    setPermissions(new Map())
    setPermissionsError(null)
    setEncryptionKey(null)
    setEncryptionError(null)
    await runProviderAction(
      authRef.current,
      'logout_failed',
      (auth) => auth.logout(),
    )
  }, [])

  const getAccessToken = useCallback(
    (): Promise<string | undefined> =>
      runProviderAction(
        authRef.current,
        'session_token_unavailable',
        async (auth) => (await auth.getAccessToken())?.token,
      ),
    [],
  )

  const forceRenew = useCallback(
    (): Promise<string | undefined> =>
      runProviderAction(
        authRef.current,
        'session_renewal_failed',
        (auth) => auth.forceRenew(),
      ),
    [],
  )

  /**
   * Sign a DPoP resource-server proof (RFC 9449 §7) for a request to the
   * host app's OWN protected resource. Delegates to the core client, which
   * resolves the current access token first so the proof's `ath` binds to
   * the token actually presented. When DPoP is inactive (`useDPoP` off or
   * WebCrypto unavailable) the proof is undefined and the caller falls back
   * to plain Bearer.
   */
  const signDPoPProof = useCallback(
    (
      method: string,
      url: string,
    ): Promise<DPoPProofResult | undefined> =>
      runProviderAction(
        authRef.current,
        'dpop_proof_unavailable',
        (auth) => auth.signDPoPProof(method, url),
      ),
    [],
  )

  const authorizeDeviceIdentify = useCallback<DeviceAuthorizationOwner>(
    async ({ method, url }) => {
      const credential = await authRef.current?.getAccessToken({
        dpop: { method, url },
      })
      if (!credential) {
        throw diagnosticError('session_token_unavailable')
      }
      return credential.proof
        ? {
            scheme: 'DPoP',
            accessToken: credential.token,
            dpopProof: credential.proof,
          }
        : {
            scheme: 'Bearer',
            accessToken: credential.token,
          }
    },
    [],
  )

  const value = useMemo(
    () => ({
      isLoading,
      isAuthenticated: user !== null,
      user,
      organizationId,
      error,
      permissions,
      permissionsError,
      encryptionKey,
      encryptionError,
      login,
      selectOrganization,
      logout,
      getAccessToken,
      forceRenew,
      signDPoPProof,
    }),
    [
      isLoading,
      user,
      organizationId,
      error,
      permissions,
      permissionsError,
      encryptionKey,
      encryptionError,
      login,
      selectOrganization,
      logout,
      getAccessToken,
      forceRenew,
      signDPoPProof,
    ],
  )

  const content = deviceIntelligence?.enabled ? (
    // Device intelligence shares the control-plane API host by default;
    // an explicit deviceIntelligence.apiUrl still wins.
    <DeviceProvider
      config={{ apiUrl, ...deviceIntelligence }}
      credentialGeneration={deviceCredentialGeneration}
      authorize={authorizeDeviceIdentify}
    >
      {children}
    </DeviceProvider>
  ) : (
    children
  )

  return <AtolContext.Provider value={value}>{content}</AtolContext.Provider>
}
