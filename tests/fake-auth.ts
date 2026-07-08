/**
 * Controllable fake of the `@atol-sh/js` browser-auth client.
 *
 * The AtolProvider now delegates its auth session + renewal to a single
 * `createAtolBrowserAuth` instance from the framework-agnostic core (the
 * duplicate React-side renewal orchestration was removed). The core client
 * is exhaustively tested in `@atol-sh/js` (`tests/client/browser-auth.test.ts`
 * covers callback/restore/renew/logout/DPoP/broadcast). These React tests
 * therefore assert the PROVIDER's observable behavior -- that it delegates
 * to the client and mirrors its session, permission, DPoP, and encryption
 * state into React -- by mocking the client at the `@atol-sh/js` boundary.
 *
 * `makeFakeAuth` builds a spyable client whose session can be driven from
 * a test (`emit`, `authenticate`, `drop`), so each behavioral assertion the
 * old internal-mock tests made maps onto an observable provider outcome.
 */
import { vi } from 'vitest'
import { parseAtolUser } from '@atol-sh/js'
import type {
  AtolBrowserAuth,
  AtolSession,
  AtolUser,
  DPoPProofResult,
  TokenResponse,
} from '@atol-sh/js'

export interface FakeAuthConfig {
  /** Session the client settles into when `init()` runs. */
  initialSession?: AtolSession
  /** Access token returned by getAccessToken()/signDPoPProof(). */
  accessToken?: string
  /** Raw ID token returned by getIdToken() (for the wrapped-DEK claim). */
  idToken?: string
  /** Whether DPoP is active (drives signDPoPProof's proof + isDPoPActive). */
  dpopActive?: boolean
  /**
   * Zero-knowledge encryption key the core would have derived. When set,
   * the initial (and re-emitted) session carries it as `encryptionKey`,
   * exactly as the real client does under `deriveEncryptionKey`. The
   * provider mirrors this into React state -- it no longer derives it.
   */
  encryptionKey?: Uint8Array
  /**
   * Zero-knowledge derivation error the core would have surfaced (e.g. an
   * AES-GCM auth-tag failure on a tampered wrapped-DEK). When set, the
   * session carries it as `encryptionError` with no key -- the fail-loud
   * signal the provider must reflect.
   */
  encryptionError?: Error
}

export interface FakeAuth extends AtolBrowserAuth {
  /** Test-only: push a new session to all subscribers. */
  emit(session: AtolSession): void
  /**
   * Test-only: transition to an authenticated session for `user`. Optionally
   * override the access/ID token and the zero-knowledge encryption
   * key/error carried on the emitted session (mirroring what the core would
   * derive under `deriveEncryptionKey`).
   */
  authenticate(
    user: AtolUser,
    opts?: {
      accessToken?: string
      idToken?: string
      encryptionKey?: Uint8Array
      encryptionError?: Error
    },
  ): void
  /** Test-only: drop to an unauthenticated session. */
  drop(): void
  /**
   * Test-only: set the zero-knowledge key/error the client currently holds
   * (as if the core derived/failed them), then re-emit the current session
   * carrying them. Drives a mid-session transition (e.g. a rehydrate that
   * newly fails on a silent renew -> tamper error, no key).
   */
  setEncryption(next: { key?: Uint8Array; error?: Error }): void
  /** Spies for asserting delegation. */
  spies: {
    init: ReturnType<typeof vi.fn>
    beginLogin: ReturnType<typeof vi.fn>
    logout: ReturnType<typeof vi.fn>
    forceRenew: ReturnType<typeof vi.fn>
    getAccessToken: ReturnType<typeof vi.fn>
    signDPoPProof: ReturnType<typeof vi.fn>
    seedTestSession: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
  }
}

const UNAUTH: AtolSession = { isAuthenticated: false, user: null }

/** Build a controllable fake browser-auth client. */
export function makeFakeAuth(config: FakeAuthConfig = {}): FakeAuth {
  let encKey = config.encryptionKey
  let encError = config.encryptionError
  // The initial session carries the configured encryption key/error, exactly
  // as the real client's session() does once it has derived them.
  let session: AtolSession = config.initialSession
    ? { ...config.initialSession, encryptionKey: encKey, encryptionError: encError }
    : UNAUTH
  let accessToken = config.accessToken
  let idToken = config.idToken
  const dpopActive = config.dpopActive ?? false
  const subscribers = new Set<(s: AtolSession) => void>()

  const spies = {
    init: vi.fn(),
    beginLogin: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    forceRenew: vi.fn(),
    getAccessToken: vi.fn(),
    signDPoPProof: vi.fn(),
    seedTestSession: vi.fn(),
    destroy: vi.fn(),
  }

  function emit(next: AtolSession): void {
    // Stamp the CURRENT zero-knowledge state onto every emitted session, as
    // the real client's session() does. logout()/drop() clear encKey/encError
    // before emitting UNAUTH, so an unauthenticated session carries none.
    session = { ...next, encryptionKey: encKey, encryptionError: encError }
    for (const cb of subscribers) cb(session)
  }

  const proofResult = (): DPoPProofResult | undefined => {
    if (!accessToken) return undefined
    return { token: accessToken, proof: dpopActive ? 'fake.dpop.proof' : undefined }
  }

  const auth: FakeAuth = {
    init: spies.init.mockImplementation(async () => {
      // Settle into the configured session and notify subscribers, exactly
      // as the real client does at the end of init().
      emit(config.initialSession ?? UNAUTH)
      return session
    }),
    beginLogin: spies.beginLogin,
    stepUp: vi.fn().mockResolvedValue(undefined),
    completeLogin: vi.fn().mockImplementation(async () => session),
    getAccessToken: spies.getAccessToken.mockImplementation(async () => proofResult()),
    getIdToken: () => idToken,
    getEncryptionKey: () => encKey,
    getEncryptionError: () => encError,
    logout: spies.logout.mockImplementation(async () => {
      // The real client clears its derived key + wipes the vault on logout.
      accessToken = undefined
      idToken = undefined
      encKey = undefined
      encError = undefined
      emit(UNAUTH)
    }),
    forceRenew: spies.forceRenew.mockImplementation(async () => {
      // Re-emit the current session (renewal keeps the same identity and the
      // already-derived encryption key).
      emit(session)
      return accessToken
    }),
    signDPoPProof: spies.signDPoPProof.mockImplementation(async () => proofResult()),
    seedTestSession: spies.seedTestSession.mockImplementation(
      async (tokens: TokenResponse): Promise<AtolSession> => {
        // Mirror the real client: adopt the seeded tokens and emit an
        // authenticated session parsed from the id token. The provider (which
        // owns this fake under allowTestSessions) then flips to authenticated.
        if (tokens.access_token) accessToken = tokens.access_token
        if (tokens.id_token) idToken = tokens.id_token
        const user = tokens.id_token ? parseAtolUser(tokens.id_token) : null
        if (user?.id) {
          emit({ isAuthenticated: true, user })
        }
        return session
      },
    ),
    isDPoPActive: () => dpopActive,
    onSessionChange: (cb: (s: AtolSession) => void) => {
      subscribers.add(cb)
      cb(session) // immediate fire, like the real client
      return () => {
        subscribers.delete(cb)
      }
    },
    destroy: spies.destroy,
    emit,
    authenticate: (user: AtolUser, opts) => {
      if (opts?.accessToken !== undefined) accessToken = opts.accessToken
      if (opts?.idToken !== undefined) idToken = opts.idToken
      if (opts?.encryptionKey !== undefined) encKey = opts.encryptionKey
      if (opts?.encryptionError !== undefined) encError = opts.encryptionError
      emit({ isAuthenticated: true, user })
    },
    drop: () => {
      accessToken = undefined
      idToken = undefined
      encKey = undefined
      encError = undefined
      emit(UNAUTH)
    },
    setEncryption: (next: { key?: Uint8Array; error?: Error }) => {
      encKey = next.key
      encError = next.error
      // Re-emit the current identity; emit() stamps the new enc state.
      emit(session)
    },
    spies,
  }
  return auth
}
