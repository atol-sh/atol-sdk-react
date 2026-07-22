# Atol SDK for React

Frontend SDK for [Atol](https://atol.sh) -- OIDC authentication, bulk-loaded permissions, and permission-based UI gating. Zero API calls on the render path.

- **Package:** `@atol-sh/react`
- **License:** Apache 2.0, TypeScript 5.7, React 18/19
- **Build:** tsup (ESM + CJS + dts)
- **Test:** Vitest + React Testing Library (jsdom)

## Output Control

- Answer starts on line 1. No openers ("Sure!", "Great question!", "Absolutely!").
- No closings ("Hope this helps!", "Let me know!"). Stop when done.
- No restating the question. Execute immediately.
- No "As an AI..." framing. No unnecessary disclaimers.
- No unsolicited suggestions beyond requested scope.
- Corrections from user become ground truth. Never agree with incorrect statements.
- ASCII only. No em dashes, smart quotes, or Unicode bullets. Plain hyphens and straight quotes.
- If unsure: say so. Never guess file paths, function names, or API endpoints.
- User instructions override this file.

## Workflow

- Read before writing. Understand existing code before modifying.
- No redundant file reads. Read each file once per session.
- One focused coding pass. No write-delete-rewrite cycles.
- Test once, fix if needed, verify once.
- Prefer editing over rewriting whole files.

## Related Projects

| Project | Repo |
|---------|------|
| Control plane | `atol-sh/atol` |
| Go SDK (backend) | `atol-sh/atol-sdk-go` |
| Fingerprint SDK | `atol-sh/atol-fingerprint-js` (npm: `@atol-sh/fingerprint`) |

## Architecture

```
Browser
+-- <AtolProvider> (mount once at root)
|   +-- OIDC login via oidc-client-ts (Authorization Code + PKCE)
|   +-- JWT claims parsing -> AtolUser (sub, email, name, auth method, mfa)
|   +-- Credential scope -> AtolSession.organizationId
|   +-- Bulk permission loading -> Map<"action:resource", boolean>
|   `-- Device intelligence (optional, lazy-loads @atol-sh/fingerprint)
|
+-- useAtol()         -> { user, organizationId, selectOrganization(), login(), logout(), getAccessToken() }
+-- usePermissions()  -> { can(action, resource), cannot(action, resource) }
+-- <Can>             -> conditional render based on permission
`-- <ProtectedRoute>  -> auth guard + optional permission check
```

**Key flow:** Mount provider -> check for OIDC callback -> exchange code for tokens -> parse JWT claims -> bulk-load permissions via `BatchCheckAccess` -> expose via hooks. All `can()` calls are synchronous Map lookups.

## Code Principles

1. **Zero secrets in frontend.** Only publishable key (`atol_kid_...`). Never API secret.
2. **No network on render path.** Permissions pre-loaded at login. `can()` is a Map lookup.
3. **Deny by default.** Missing permission -> `false`. Error loading permissions -> all denied.
4. **In-memory tokens.** The oidc-client-ts `userStore` is an `InMemoryWebStorage` -- tokens never touch localStorage or sessionStorage. sessionStorage holds the OIDC state/PKCE verifier only (survives redirects). Page reload recovers the session via one silent renew against the IdP cookie.
5. **Device intelligence is optional.** Lazy-loaded via dynamic import. No bundle bloat if disabled.
6. **Minimal deps.** One production dep: `oidc-client-ts`. React/react-dom are peer deps.

## File Organization

```
src/
├─ index.ts              # Public API exports
├─ types.ts              # AtolConfig, AtolUser, AtolState, PermissionCheck
├─ context.ts            # AtolContext
├─ provider.tsx          # <AtolProvider>
├─ hooks/                # useAtol, usePermissions, useUser, useTokenRenewal (renewal engine)
├─ components/           # <Can>, <ProtectedRoute>, <LoginButton>, <LogoutButton>
├─ device/               # DeviceProvider (lazy @atol-sh/fingerprint), useDevice
└─ lib/                  # oidc.ts (UserManager), claims.ts (JWT parser), permissions.ts (batch loader),
                         # base64url.ts (shared codec), silent-renew, dpop, kekVault, encryption,
                         # token-broadcast, cross-tab-lock, token-recovery
tests/                   # Vitest tests (provider init, components, permissions, device, libs)
```

## TypeScript Standards

- Strict mode enabled. No `any` unless unavoidable (type-cast with comment).
- Functional components + hooks only. No class components.
- Props interfaces colocated with component. Exported if part of public API.
- No barrel re-exports beyond `index.ts`.
- Error boundaries for provider-level failures. Graceful degradation over crashes.

## Running

```bash
npm run build            # tsup -> dist/ (ESM + CJS + dts)
npm test                 # Vitest
npm run test:watch       # Vitest watch mode
npm run typecheck        # tsc --noEmit
```
