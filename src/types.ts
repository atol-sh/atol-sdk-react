import type { DeviceConfig, DeviceState } from './device/types'

// Shared, framework-agnostic types are owned by the core. Re-exported here
// so the SDK's public type surface is unchanged for consumers.
import type {
  AtolUser,
  PermissionCheck,
  PermissionResult,
  DPoPProofResult,
  TokenResponse,
} from '@atol-sh/js'
export type { AtolUser, PermissionCheck, PermissionResult, DPoPProofResult, TokenResponse }

/** Configuration for the AtolProvider. */
export interface AtolConfig {
  /** Publishable key ID (atol_kid_...). Safe for frontend code. */
  keyId: string

  /** OIDC issuer URL (e.g. https://auth.atol.sh). */
  authority: string

  /**
   * Control-plane API base URL that serves AccessService (permission
   * checks) and device identify. This is the API host
   * (https://api.atol.sh), NOT the OIDC issuer (`authority`). Default:
   * "https://api.atol.sh". Device intelligence inherits this unless
   * `deviceIntelligence.apiUrl` overrides it.
   */
  apiUrl?: string

  /** URL to redirect to after login. */
  redirectUri: string

  /** OIDC scopes. Default: "openid profile email". */
  scope?: string

  /** API audience identifier. */
  audience?: string

  /** Permissions to bulk-load after login. */
  permissions?: PermissionCheck[]

  /** Called after successful login + permission load. */
  onLogin?: (user: AtolUser) => void

  /** Called after logout. */
  onLogout?: () => void

  /**
   * Called when bulk permission loading fails after login. The SDK keeps
   * its deny-by-default posture (every `can()` returns false), but the
   * failure is surfaced here and via `usePermissions().error` so apps can
   * distinguish "user has no permissions" from "permissions failed to
   * load" (and e.g. show a retry UI instead of a permanent access-denied).
   */
  onPermissionsError?: (error: Error) => void

  /** Device intelligence configuration. */
  deviceIntelligence?: DeviceConfig

  /** Enable zero-knowledge encryption key derivation during login. */
  deriveEncryptionKey?: boolean

  /**
   * Silent renewal strategy. Default (false): hidden-iframe silent
   * authentication against the IdP session cookie (`prompt=none`) -- no
   * refresh token is requested or stored. The iframe
   * path relies on the IdP session cookie being sent from a third-party
   * context, which Safari ITP blocks and Chrome's third-party-cookie
   * phase-out removes, so it fails UNCONDITIONALLY for a cross-site app (a
   * UI on a different registrable domain from the IdP). Cross-site apps MUST
   * set this true: it appends `offline_access`, so the server issues a
   * refresh token, and renews via the refresh-token grant (memory-only,
   * rotated, DPoP-bound when `useDPoP` is on).
   *
   * Same-site apps (e.g. an admin console on a subdomain of the IdP) reach
   * the first-party session cookie in the iframe and leave this false; no
   * refresh token ever leaves the token endpoint.
   */
  useRefreshTokens?: boolean

  /**
   * If refresh-token renewal fails with a transient error (not
   * invalid_grant / login_required), fall back to the iframe path once
   * before surfacing the failure. Defaults to false.
   */
  useRefreshTokensFallback?: boolean

  /**
   * Request DPoP-bound tokens (RFC 9449). When enabled, the SDK
   * generates a per-tab non-exportable ES256 keypair on mount and sends
   * a DPoP proof on every token-endpoint call. The server binds the
   * issued access + refresh tokens to the key via `cnf.jkt`, so a stolen
   * refresh token cannot be redeemed from a different browser.
   *
   * Requires the server to be configured with `dpopMode: optional` or
   * `required`. Defaults to false for backwards compatibility; turn on
   * alongside `useRefreshTokens: true` for the strongest SPA posture.
   */
  useDPoP?: boolean

  /**
   * TEST ONLY. Enable the browser test-session seam: register the mounted
   * provider's auth client so `installAtolTestHook()` (from
   * `@atol-sh/react/testing`) can seed an authenticated session via
   * `window.__ATOL_TEST__.seedSession(tokens)` -- no OIDC redirect, no live
   * IdP round-trip, works against in-memory token storage and route guards.
   *
   * Defaults to `false`. Set it ONLY in test builds (e.g. gate it behind a
   * Vite env flag): it bypasses OIDC signature/state/nonce validation, and
   * shipping it enabled would let an XSS payload forge a session -- exactly
   * the risk in-memory token storage exists to close. The underlying core
   * client also logs a one-time `console.warn` when this is on. See
   * `EXAMPLES.md` for the Cypress recipe.
   */
  allowTestSessions?: boolean

  /**
   * TEST ONLY. A token response the provider adopts during mount instead of
   * the cold-load restore, so the app renders authenticated at first paint --
   * no OIDC round-trip and, crucially, no silent-renew iframe (which, against a
   * stubbed backend with no IdP, would otherwise block until it times out).
   * Requires `allowTestSessions: true` (ignored otherwise). Read the token from
   * your test harness (e.g. a value your e2e command stashed) and pass it here
   * only in test builds. Deterministic and race-free -- preferred over seeding
   * via `@atol-sh/react/testing` after mount when you control the provider
   * config. Never set in production. See `EXAMPLES.md`.
   */
  initialTestSession?: TokenResponse
}

/** Full auth + permission state exposed by the provider. */
export interface AtolState {
  isLoading: boolean
  isAuthenticated: boolean
  user: AtolUser | null
  error: Error | null
  permissions: Map<string, boolean>

  /**
   * Non-null when the bulk permission load failed. Permission checks
   * still deny by default; this flag lets the app tell "denied" apart
   * from "failed to load". Cleared on the next successful load.
   */
  permissionsError: Error | null

  /** Unwrapped data encryption key (DEK) for client-side encryption.
   * Non-null after login when deriveEncryptionKey is enabled. */
  encryptionKey: Uint8Array | null

  /**
   * Non-null when an expected DEK could not be unwrapped: a wrong KEK, a
   * tampered wrapped-DEK (GCM auth-tag failure), or a vault error. Lets
   * the app deny encrypted operations instead of silently treating a
   * failure as "encryption disabled". Distinct from "feature off", where
   * both `encryptionKey` and `encryptionError` are null.
   */
  encryptionError: Error | null
}

/** Auth methods exposed by the provider. */
export interface AtolActions {
  login: (options?: { returnTo?: string }) => Promise<void>
  /**
   * Sign out via OIDC RP-Initiated Logout. Async because the SDK first
   * looks up the current ID token to include as `id_token_hint`. The
   * returned promise resolves when oidc-client-ts has issued the
   * navigation; existing fire-and-forget callers (`logout()`) keep
   * working without awaiting.
   */
  logout: () => Promise<void>
  getAccessToken: () => Promise<string | undefined>

  /**
   * Force an immediate silent renew, bypassing the local expiry check.
   * Resolves to the newly-issued access token (or undefined on failure).
   *
   * Reloads permissions as part of the renew, so this is the way to pick
   * up an out-of-band grant/revocation on demand. Normal callers should
   * rely on `getAccessToken`, which renews automatically at `exp - 60s`
   * (and also reloads permissions on each renewal).
   */
  forceRenew: () => Promise<string | undefined>

  /**
   * Sign a DPoP resource-server proof (RFC 9449 §7) for an outgoing
   * request to your OWN protected resource. Fetches a fresh access token
   * (renewing if needed) and, when DPoP is active, returns a proof JWT
   * bound to that token via `ath`.
   *
   * ```tsx
   * const { token, proof } = (await signDPoPProof('GET', 'https://api.example.com/me')) ?? {}
   * const headers = proof
   *   ? { Authorization: `DPoP ${token}`, DPoP: proof }
   *   : { Authorization: `Bearer ${token}` }
   * ```
   *
   * Resolves to `undefined` when there is no active session (no token to
   * present). `proof` is `undefined` -- signalling plain `Bearer` -- when
   * `useDPoP` is off or WebCrypto is unavailable.
   *
   * `url` MUST be an absolute URL. The proof's `htu` is the scheme +
   * authority + path with query/fragment stripped; a relative or
   * unparseable URL throws rather than shipping a proof the resource
   * server would reject.
   */
  signDPoPProof: (method: string, url: string) => Promise<DPoPProofResult | undefined>
}

/** Combined state + actions from the Atol context. */
export type AtolContextValue = AtolState & AtolActions

/**
 * Return type of `useAtol()`: the full context value plus device
 * intelligence state. Exported so consumers can annotate variables and
 * build wrappers without re-deriving via `ReturnType<typeof useAtol>`.
 */
export type AtolHookValue = AtolContextValue & { device: DeviceState }
