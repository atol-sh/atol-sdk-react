import {
  type PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  createAtolBrowserAuth,
  type AtolBrowserAuth,
  type AtolSession,
  type DPoPProofResult,
  type DPoPSigner,
} from '@atol-sh/js'
import { AtolContext } from './context'
import { loadPermissions } from './lib/permissions'
import { DeviceProvider } from './device/DeviceProvider'
import type { AtolConfig, AtolUser, PermissionCheck } from './types'

export type AtolProviderProps = PropsWithChildren<AtolConfig>

/** Control-plane API host that serves AccessService + device identify. */
const DEFAULT_API_URL = 'https://api.atol.sh'

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
 * provider only mirrors the resulting `encryptionKey` / `encryptionError`
 * from the session payload into React state.
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
  scope = 'openid profile email',
  audience,
  permissions: permissionChecks = [],
  onLogin,
  onLogout,
  onPermissionsError,
  deviceIntelligence,
  deriveEncryptionKey,
  useRefreshTokens = false,
  useRefreshTokensFallback = false,
  useDPoP = false,
}: AtolProviderProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [user, setUser] = useState<AtolUser | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [permissions, setPermissions] = useState<Map<string, boolean>>(new Map())
  const [permissionsError, setPermissionsError] = useState<Error | null>(null)
  const [accessToken, setAccessToken] = useState<string | undefined>()
  // Zero-knowledge encryption key/error. Derived by the core client (KEK
  // from the URL fragment, wrapped DEK from the ID token, unwrap +
  // device-bound vault); the provider only mirrors the result from the
  // session-change payload. Starts null and is populated once the core
  // settles a session under `deriveEncryptionKey`.
  const [encryptionKey, setEncryptionKey] = useState<Uint8Array | null>(null)
  // Non-null when the core reports an expected DEK could not be unwrapped
  // (wrong KEK, a tampered wrapped-DEK auth-tag failure, or a vault error).
  // Surfaced so the app can deny encrypted operations instead of silently
  // treating a failure as "encryption off".
  const [encryptionError, setEncryptionError] = useState<Error | null>(null)

  // The single auth client that owns the session + renewal. Every
  // credential decision (token access, renewal, DPoP proof, login, logout)
  // delegates here. The instance is created and torn down inside the mount
  // effect below -- NOT in the render body -- so React Strict Mode's
  // mount/unmount/remount cycle always runs against a fresh, live client
  // (the throwaway first client is destroyed and a new one built on
  // remount). The action callbacks read this ref only after mount, by which
  // point the effect has populated it.
  const authRef = useRef<AtolBrowserAuth | null>(null)

  // Mirror volatile state/props into refs so the stable callbacks below can
  // read current values without listing them in dep arrays (which would
  // churn the effect that owns the auth-session subscription).
  const permissionChecksRef = useRef<PermissionCheck[]>(permissionChecks)
  permissionChecksRef.current = permissionChecks
  const callbacksRef = useRef({ onLogin, onLogout, onPermissionsError })
  callbacksRef.current = { onLogin, onLogout, onPermissionsError }

  /**
   * DPoP signer adapter for `loadPermissions`. When DPoP is active the
   * batch-check call must present the token under the `DPoP` auth scheme
   * with an `ath`-bound proof; the core's `signDPoPProof` produces exactly
   * that (fetching a fresh token so `ath` binds to what is presented).
   * Passed to loadPermissions only when DPoP is active; otherwise the call
   * runs plain Bearer.
   */
  const permissionDPoPSigner = useMemo<DPoPSigner>(
    () => ({
      async signProof(method: string, url: string): Promise<string> {
        const result = await authRef.current?.signDPoPProof(method, url)
        // signDPoPProof only omits the proof when DPoP is inactive; this
        // signer is only wired in when it IS active, so the proof exists.
        return result?.proof ?? ''
      },
    }),
    [],
  )

  /**
   * (Re)load permissions for the current identity. Called on initial login
   * AND on every token renewal (via onSessionChange) so a server-side
   * grant/revocation is picked up within the session. Deny-by-default holds
   * while the load is in flight and on failure (the map is left empty /
   * replaced only on success).
   */
  const reloadPermissions = useCallback(
    async (atolUser: AtolUser, token: string): Promise<void> => {
      const checks = permissionChecksRef.current
      if (checks.length === 0) return
      try {
        const perms = await loadPermissions({
          apiUrl,
          keyId,
          accessToken: token,
          userId: atolUser.id,
          orgId: atolUser.orgId,
          checks,
          dpop: authRef.current?.isDPoPActive() ? permissionDPoPSigner : undefined,
        })
        setPermissions(perms)
        setPermissionsError(null)
      } catch (err) {
        // Deny-by-default stays in force (the permission map is unchanged),
        // but the failure is surfaced so the app can tell "no permissions"
        // apart from "failed to load".
        const permErr = err instanceof Error ? err : new Error(String(err))
        console.error('[Atol] permission load failed, denying all:', permErr)
        setPermissionsError(permErr)
        callbacksRef.current.onPermissionsError?.(permErr)
      }
    },
    [apiUrl, keyId, permissionDPoPSigner],
  )

  /**
   * Own the auth session for the provider's lifetime. Subscribe to the core
   * client's session changes (login, logout, renewal, cross-tab rotation)
   * and mirror them into React state, layering permission loading on each
   * change and mirroring the core-derived encryption key/error. Then init()
   * the client (handles a redirect callback or a silent restore). Runs once
   * on mount; the client is torn down on unmount.
   */
  useEffect(() => {
    // Build the client here (once per effect-mount) so Strict Mode's
    // throwaway mount gets its own instance that is fully destroyed on
    // cleanup, and the real mount gets a fresh, live one. The client owns
    // the zero-knowledge KEK/DEK flow entirely (fragment capture before the
    // callback URL is stripped, vault provision/rehydrate, fail-loud unwrap)
    // -- gated on deriveEncryptionKey -- so the provider does none of it.
    const auth = createAtolBrowserAuth({
      issuer: authority,
      clientId: keyId,
      redirectUri,
      scopes: scope,
      audience,
      dpop: useDPoP,
      useRefreshTokens,
      useRefreshTokensFallback,
      deriveEncryptionKey: deriveEncryptionKey === true,
      storage: 'memory',
    })
    authRef.current = auth
    let cancelled = false
    // Track identity so callbacks fire once per login/logout transition,
    // not on every proactive token renewal.
    let lastUserId: string | null = null

    async function onSession(session: AtolSession): Promise<void> {
      if (cancelled) return
      const atolUser = session.user
      setUser(atolUser)

      // Mirror the core-derived zero-knowledge key/error into React state on
      // every session change. The core owns derivation (provision on a fresh
      // callback, rehydrate on restore/renew) and fails loud on tamper (an
      // AES-GCM auth-tag failure sets encryptionError with no key). The
      // provider only reflects the result. Undefined maps to null so the
      // React contract stays `T | null`.
      if (deriveEncryptionKey) {
        setEncryptionKey(session.encryptionKey ?? null)
        setEncryptionError(session.encryptionError ?? null)
      }

      if (atolUser) {
        const res = await auth.getAccessToken()
        const token = res?.token
        setAccessToken(token)

        // Permissions are tied to identity; refresh on every renewal so
        // grants/revocations take effect mid-session.
        if (token) await reloadPermissions(atolUser, token)

        if (atolUser.id !== lastUserId) {
          lastUserId = atolUser.id
          callbacksRef.current.onLogin?.(atolUser)
        }
      } else {
        setAccessToken(undefined)
        if (lastUserId !== null) {
          lastUserId = null
          // A session drop from the core (terminal renewal failure /
          // cross-tab session-expired) resets local derived state. The core
          // already cleared its own encryption key; the mirror above (with
          // the now-empty session) reflects that, and permissions reset here.
          setPermissions(new Map())
          setPermissionsError(null)
        }
      }
    }

    const unsubscribe = auth.onSessionChange((session) => {
      void onSession(session)
    })

    // Clear the loading gate only when the initial settle completes (the
    // redirect callback or the silent restore), NOT on the immediate
    // pre-init unauthenticated fire from onSessionChange -- otherwise a
    // reload would flash "signed out" before the restore finishes.
    auth
      .init()
      .catch((err) => {
        // A stale/failed callback settles unauthenticated; surface it as
        // error state (not a crash). Never surface token material.
        if (!cancelled) {
          console.error('[Atol] auth init failed:', err)
          setError(err instanceof Error ? err : new Error(String(err)))
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
      unsubscribe()
      auth.destroy()
      // Drop the ref if it still points at the client we are tearing down,
      // so a stale (destroyed) instance is never read by an action callback.
      if (authRef.current === auth) authRef.current = null
    }
    // Only run on mount. The client is built once from the initial props;
    // props are captured at construction (the client owns the session for
    // the provider's lifetime), so this effect intentionally has no deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const login = useCallback(
    async (options?: { returnTo?: string }) => {
      await authRef.current!.beginLogin({ returnTo: options?.returnTo })
    },
    [],
  )

  const logout = useCallback(async () => {
    // Reset the React-derived state first; the core client handles refresh-
    // token revocation, RP-initiated end_session (with id_token_hint), AND
    // clearing the zero-knowledge key + wiping the device-bound KEK vault.
    setUser(null)
    setAccessToken(undefined)
    setPermissions(new Map())
    setPermissionsError(null)
    setEncryptionKey(null)
    setEncryptionError(null)
    callbacksRef.current.onLogout?.()
    await authRef.current!.logout()
  }, [])

  const getAccessToken = useCallback(async (): Promise<string | undefined> => {
    const res = await authRef.current?.getAccessToken()
    return res?.token
  }, [])

  const forceRenew = useCallback(async (): Promise<string | undefined> => {
    return authRef.current?.forceRenew()
  }, [])

  /**
   * Sign a DPoP resource-server proof (RFC 9449 §7) for a request to the
   * host app's OWN protected resource. Delegates to the core client, which
   * resolves the current access token first so the proof's `ath` binds to
   * the token actually presented. When DPoP is inactive (`useDPoP` off or
   * WebCrypto unavailable) the proof is undefined and the caller falls back
   * to plain Bearer.
   */
  const signDPoPProof = useCallback(
    async (method: string, url: string): Promise<DPoPProofResult | undefined> => {
      return authRef.current?.signDPoPProof(method, url)
    },
    [],
  )

  const value = useMemo(
    () => ({
      isLoading,
      isAuthenticated: user !== null,
      user,
      error,
      permissions,
      permissionsError,
      encryptionKey,
      encryptionError,
      login,
      logout,
      getAccessToken,
      forceRenew,
      signDPoPProof,
    }),
    [
      isLoading,
      user,
      error,
      permissions,
      permissionsError,
      encryptionKey,
      encryptionError,
      login,
      logout,
      getAccessToken,
      forceRenew,
      signDPoPProof,
    ],
  )

  const content = deviceIntelligence?.enabled ? (
    // Device intelligence shares the control-plane API host by default;
    // an explicit deviceIntelligence.apiUrl still wins.
    <DeviceProvider config={{ apiUrl, ...deviceIntelligence }} accessToken={accessToken}>
      {children}
    </DeviceProvider>
  ) : (
    children
  )

  return <AtolContext.Provider value={value}>{content}</AtolContext.Provider>
}
