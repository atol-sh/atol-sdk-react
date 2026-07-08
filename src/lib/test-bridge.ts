/**
 * Internal bridge between a mounted `AtolProvider` (which owns the live
 * `@atol-sh/js` auth client) and the `@atol-sh/react/testing` entrypoint
 * (which installs `window.__ATOL_TEST__.seedSession`). TEST ONLY: nothing
 * here runs unless the provider is created with `allowTestSessions`.
 *
 * The active client is stored on `globalThis`, NOT in a module-level
 * variable, on purpose. tsup builds the main entry (`src/index.ts`) and the
 * `./testing` entry (`src/testing.ts`) as SEPARATE, non-split bundles, so
 * this module is inlined into each. A module-level singleton would therefore
 * be two distinct singletons -- the provider (main bundle) would register
 * into one while `installAtolTestHook` (testing bundle) read the other, which
 * would always be empty and every `seedSession` call would throw "no provider
 * mounted". A registered `Symbol` (`Symbol.for`) is realm-global, so both
 * bundles resolve the SAME slot; it also keeps the live client off the
 * enumerable string-key surface (`Object.keys`/`for...in`/`JSON.stringify`
 * do not reveal it). This is defense in depth, NOT the security boundary --
 * the boundary is the provider's `allowTestSessions` flag (default false), and
 * the core `seedTestSession` throws while it is off. When that flag is on the
 * armed client is reachable regardless of this indirection.
 *
 * Single-slot, last-writer-wins: it represents exactly ONE mounted provider.
 * Mount a single `<AtolProvider allowTestSessions>` (the documented guidance),
 * which is the only shape browser e2e runs need.
 */
import type { AtolBrowserAuth } from '@atol-sh/js'

const SLOT = Symbol.for('@atol-sh/react/testing:activeClient')

type Host = Record<symbol, AtolBrowserAuth | null | undefined>

/** Publish the mounted provider's client as the active test client. */
export function registerTestClient(client: AtolBrowserAuth): void {
  ;(globalThis as Host)[SLOT] = client
}

/**
 * Clear the active test client, but only if it is still `client`. Guards
 * against a stale (unmounted / Strict-Mode throwaway) provider wiping a newer
 * provider's registration -- mirrors the provider's own `authRef` teardown.
 */
export function clearTestClient(client: AtolBrowserAuth): void {
  const host = globalThis as Host
  if (host[SLOT] === client) host[SLOT] = null
}

/** The currently registered test client, or null when none is mounted. */
export function activeTestClient(): AtolBrowserAuth | null {
  return (globalThis as Host)[SLOT] ?? null
}
