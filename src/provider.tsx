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
import { registerTestClient, clearTestClient } from './lib/test-bridge'
import { DeviceProvider } from './device/DeviceProvider'
import type { AtolConfig, AtolUser, PermissionCheck } from './types'

export type AtolProviderProps = PropsWithChildren<AtolConfig>

/** Control-plane API host that serves AccessService + device identify. */
const DEFAULT_API_URL = 'https://api.atol.sh'

/**
 * Module-scoped bridge across React 19 Strict Mode's synchronous
 * mount -> cleanup -> remount cycle.
 *
 * The core client's callback processing (oidc-client-ts's
 * `signinRedirectCallback` -> `readSigninResponseState`) removes the
 * single-use OIDC state/PKCE entry from sessionStorage as the FIRST step of
 * validating an authorization-code callback -- before the token-endpoint
 * exchange even starts. Building a SECOND, independent
 * `createAtolBrowserAuth` client for Strict Mode's real mount (as this
 * provider used to: fresh client per effect run, `destroy()`ed on cleanup)
 * races that removal against the throwaway mount's client: whichever
 * client's `init()` reaches the state store first wins the exchange, and
 * the other's `completeLogin()` fails with "No matching state found in
 * storage" and settles permanently unauthenticated -- the core swallows
 * that failure into `clearSession()` inside `init()`, so no error ever
 * reaches this provider or the app. The throwaway client's own exchange can
 * still succeed against the live token endpoint (which is why a manual curl
 * replay of the same flow is accepted server-side), but its result lands
 * nowhere: `destroy()` already cleared its subscriber set before the
 * exchange resolved.
 *
 * The fix: collapse Strict Mode's double mount onto a SINGLE client
 * instance instead of racing two. `auth.init()` is memoized on the core
 * client (a second call returns the same in-flight/settled promise), so
 * reusing the same instance for both the throwaway and the real mount means
 * only one `completeLogin()` ever runs against sessionStorage -- no race.
 * Teardown is deferred by one macrotask on cleanup: if a remount follows
 * synchronously -- which Strict Mode's double-invoke always does, within
 * the same passive-effects flush, before any timer can fire -- it cancels
 * the pending teardown and adopts the client instead of building a new one.
 * A genuine unmount (no remount follows in that tick) lets the timer fire
 * and destroys the client for real, exactly once.
 */
interface SharedClientSlot {
  key: string
  auth: AtolBrowserAuth
  teardownTimer: ReturnType<typeof setTimeout> | null
}
let sharedClientSlot: SharedClientSlot | null = null

// `initialTestSession` contains bearer credentials and refresh-token material,
// so it must never participate in a serialized config key. Object identity is
// deliberately conservative: the same object can be reused across React's
// Strict Mode effect replay, while any newly supplied token response forces a
// fresh core client even when its non-secret configuration is unchanged.
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
 * Stable identity for the auth client's construction config. Only fields
 * that actually shape `createAtolBrowserAuth()` participate -- callbacks
 * (onLogin/onLogout/onPermissionsError) and the permission-check list are
 * mirrored into refs and read live by the effect, never baked into the
 * client, so they are deliberately excluded.
 */
function clientConfigKey(cfg: {
  authority: string
  keyId: string
  redirectUri: string
  scope: string
  audience: string | undefined
  useDPoP: boolean
  useRefreshTokens: boolean
  useRefreshTokensFallback: boolean
  deriveEncryptionKey: boolean
  allowTestSessions: boolean
  initialTestSession: AtolConfig['initialTestSession']
}): string {
  return JSON.stringify([
    cfg.authority,
    cfg.keyId,
    cfg.redirectUri,
    cfg.scope,
    cfg.audience ?? '',
    cfg.useDPoP,
    cfg.useRefreshTokens,
    cfg.useRefreshTokensFallback,
    cfg.deriveEncryptionKey,
    cfg.allowTestSessions,
    cfg.allowTestSessions ? initialTestSessionID(cfg.initialTestSession) : 0,
  ])
}

/**
 * TEST ONLY. Force-clear the module-scoped shared-client bridge and
 * synchronously destroy whatever client currently occupies it (whether its
 * teardown is pending or it is still actively mounted).
 *
 * The deferred-teardown window that makes Strict Mode's double-invoke safe
 * (see the comment above `sharedClientSlot`) is scoped to "does a remount
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
  const slot = sharedClientSlot
  sharedClientSlot = null
  if (!slot) return
  if (slot.teardownTimer !== null) clearTimeout(slot.teardownTimer)
  slot.auth.destroy()
  // Mirror the deferred-teardown path's bridge cleanup (see the effect
  // cleanup below). A no-op when this client was never the registered test
  // client (allowTestSessions off, or already superseded).
  clearTestClient(slot.auth)
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
  allowTestSessions = false,
  initialTestSession,
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
  // delegates here. The instance is created (or, on a Strict Mode remount,
  // adopted from `sharedClientSlot` -- see the module-scoped comment above)
  // inside the mount effect below, NOT in the render body, so its lifetime
  // is tied to the effect rather than to a single render. The action
  // callbacks read this ref only after mount, by which point the effect has
  // populated it.
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
    // Resolve the client for this effect-mount: adopt the shared instance
    // from a still-pending teardown (a Strict Mode remount landing on the
    // throwaway mount's client) when its config matches, otherwise build a
    // fresh one. See the module-scoped comment above `sharedClientSlot` for
    // why reuse -- not "always fresh" -- is what makes this Strict
    // Mode-safe. The client owns the zero-knowledge KEK/DEK flow entirely
    // (fragment capture before the callback URL is stripped, vault
    // provision/rehydrate, fail-loud unwrap) -- gated on deriveEncryptionKey
    // -- so the provider does none of it.
    const key = clientConfigKey({
      authority,
      keyId,
      redirectUri,
      scope,
      audience,
      useDPoP,
      useRefreshTokens,
      useRefreshTokensFallback,
      deriveEncryptionKey: deriveEncryptionKey === true,
      allowTestSessions,
      initialTestSession,
    })

    let auth: AtolBrowserAuth
    const pending = sharedClientSlot
    if (pending && pending.key === key && pending.teardownTimer !== null) {
      // A remount landed on the still-torn-down-pending client from a
      // throwaway mount in the same synchronous effects flush. Cancel the
      // scheduled teardown and adopt it instead of building (and racing) a
      // second one.
      clearTimeout(pending.teardownTimer)
      pending.teardownTimer = null
      auth = pending.auth
    } else {
      auth = createAtolBrowserAuth({
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
        allowTestSessions,
        initialTestSession,
      })
      sharedClientSlot = { key, auth, teardownTimer: null }
      // TEST ONLY: when the seam is enabled, publish this client so
      // `installAtolTestHook()` (from `@atol-sh/react/testing`) can seed a
      // session into it. Inert -- and the bridge is never touched --
      // otherwise.
      if (allowTestSessions) registerTestClient(auth)
    }
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
    // reload would flash "signed out" before the restore finishes. `init()`
    // is memoized on the client (a second call, from a remount that adopted
    // this same instance, returns the SAME promise) -- calling it here
    // unconditionally is what makes the redirect-callback exchange run
    // exactly once across a Strict Mode double-mount.
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
      // Drop the ref if it still points at the client this cleanup is
      // (maybe) tearing down, so a stale/destroyed instance is never read by
      // an action callback in the gap before a possible remount re-populates
      // it.
      if (authRef.current === auth) authRef.current = null
      // Defer the actual teardown by one macrotask instead of destroying
      // synchronously. Strict Mode's double-invoke runs mount -> cleanup ->
      // remount synchronously within the same passive-effects flush -- well
      // before any timer fires -- so a remount reusing this instance (the
      // branch above) always cancels this timer first. Only a genuine
      // unmount, where no remount follows, lets it fire and tear the client
      // down for real, exactly once.
      if (sharedClientSlot && sharedClientSlot.auth === auth) {
        const slot = sharedClientSlot
        slot.teardownTimer = setTimeout(() => {
          auth.destroy()
          if (allowTestSessions) clearTestClient(auth)
          if (sharedClientSlot === slot) sharedClientSlot = null
        }, 0)
      }
    }
    // Only run on mount. The client is built (or adopted) once from the
    // initial props; props are captured at construction (the client owns
    // the session for the provider's lifetime), so this effect intentionally
    // has no deps.
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
