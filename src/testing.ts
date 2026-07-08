/**
 * `@atol-sh/react/testing` -- the browser test-session seam.
 *
 * TEST ONLY. This subpath exists so an app's e2e test harness (Cypress,
 * Playwright) can bootstrap an authenticated session without a live OIDC
 * round-trip, which stopped being possible once tokens moved to in-memory
 * storage (priming `sessionStorage` no longer reaches the private in-memory
 * token store). It lives on its own entrypoint so the `window.__ATOL_TEST__`
 * glue is NOT bundled into an app that never imports it.
 *
 * Usage (test build only):
 *   1. Render the provider with the seam enabled -- gate it behind a build/env
 *      flag so it is off in production:
 *        <AtolProvider allowTestSessions={import.meta.env.MODE === 'test'} ... />
 *   2. Call `installAtolTestHook()` once from your test setup / test-build
 *      entry to publish `window.__ATOL_TEST__`.
 *   3. In a spec, after the app has mounted:
 *        cy.window().then((w) =>
 *          w.__ATOL_TEST__!.seedSession({
 *            access_token, id_token, refresh_token,
 *            token_type: 'Bearer', scope: 'openid profile email offline_access',
 *            expires_in: 3600,
 *          }),
 *        )
 *      The provider flips to authenticated with no IdP round-trip and no live
 *      backend. The presented tokens are still validated server-side by your
 *      API on the first real request.
 *
 * SECURITY: the single security boundary is the provider's `allowTestSessions`
 * flag. It defaults to false, and the core `seedTestSession` throws while it
 * is off, so with it off nothing here can forge a session. `installAtolTestHook`
 * is ergonomics -- the `window.__ATOL_TEST__` convenience API -- NOT a second
 * security gate: whenever `allowTestSessions` is on, the armed client is
 * reachable (a script could seed a session without this hook at all), so never
 * treat "we didn't call installAtolTestHook" as protection. The one rule is:
 * never enable `allowTestSessions` in a production build. Gate it behind a
 * build/env flag. The seam skips OIDC signature/state/nonce checks, so
 * shipping it enabled reopens the XSS-forged-session surface that in-memory
 * token storage exists to close.
 *
 * REALM: `installAtolTestHook()` and the `<AtolProvider>` must run in the SAME
 * realm -- the application-under-test window -- for the `globalThis` bridge to
 * connect. In Cypress, call it from your test-build app entry, NOT the
 * spec/support file (which runs in the runner's realm); otherwise seedSession
 * rejects with "no provider mounted". Mount a single provider: the bridge
 * tracks exactly one.
 */
import type { AtolSession, TokenResponse } from '@atol-sh/js'
import { activeTestClient } from './lib/test-bridge'

/** The shape installed on `window.__ATOL_TEST__` by {@link installAtolTestHook}. */
export interface AtolTestHook {
  /**
   * Establish an authenticated session in the mounted `<AtolProvider
   * allowTestSessions>` directly from a token response, bypassing the OIDC
   * redirect/callback. Rejects when no such provider is mounted, and (from
   * the core) when the provider was not created with `allowTestSessions`.
   */
  seedSession(tokens: TokenResponse): Promise<AtolSession>
}

declare global {
  interface Window {
    /** TEST ONLY. Installed by {@link installAtolTestHook}; absent otherwise. */
    __ATOL_TEST__?: AtolTestHook
  }
}

/**
 * Publish `window.__ATOL_TEST__.seedSession`, wired to the auth client of a
 * mounted `<AtolProvider allowTestSessions>`. Call once from a test build.
 * Throws outside a browser (no `window`).
 */
export function installAtolTestHook(): void {
  if (typeof window === 'undefined') {
    throw new Error('installAtolTestHook must run in a browser context (no window)')
  }
  // Loud guard against an accidental production import of this subpath.
  console.warn(
    '[Atol] TEST HOOK installed: window.__ATOL_TEST__.seedSession can create a ' +
      'session without OIDC validation. Test builds only -- never production.',
  )
  window.__ATOL_TEST__ = {
    seedSession(tokens: TokenResponse): Promise<AtolSession> {
      const client = activeTestClient()
      if (!client) {
        return Promise.reject(
          new Error(
            'window.__ATOL_TEST__.seedSession: no <AtolProvider allowTestSessions> is ' +
              'mounted. Render it with allowTestSessions enabled and call seedSession ' +
              'after the app has mounted.',
          ),
        )
      }
      return client.seedTestSession(tokens)
    },
  }
}
