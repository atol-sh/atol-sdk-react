import type {
  AtolDiagnosticCode,
  AtolDiagnosticError,
} from './types'

const DIAGNOSTIC_MESSAGES: Record<AtolDiagnosticCode, string> = {
  auth_initialization_failed:
    'Authentication could not be initialized. Retry sign-in.',
  provider_already_mounted:
    'Only one active AtolProvider may own browser credentials.',
  provider_not_mounted: 'AtolProvider is not mounted.',
  provider_client_cleanup_failed:
    'AtolProvider credential client cleanup failed.',
  login_failed: 'Sign-in could not be started. Retry.',
  organization_selection_failed:
    'Organization selection failed. Retry or sign in again.',
  logout_failed: 'Sign-out cleanup did not complete. Retry sign-out.',
  session_token_unavailable:
    'The session access token is unavailable. Sign in again.',
  session_renewal_failed:
    'Session renewal failed. Sign in again.',
  dpop_proof_unavailable:
    'The DPoP proof could not be created. Retry with an active session.',
  permissions_organization_required:
    'Permissions require an organization-scoped session. Select an organization and retry.',
  permissions_load_failed:
    'Permissions could not be loaded. Retry or sign in again.',
  encryption_key_unavailable:
    "Encryption key unavailable. Sign in again or clear this site's stored data.",
}

class ProviderDiagnosticError
  extends Error
  implements AtolDiagnosticError
{
  readonly code: AtolDiagnosticCode

  constructor(code: AtolDiagnosticCode) {
    super(DIAGNOSTIC_MESSAGES[code])
    this.code = code
    this.name = 'AtolDiagnosticError'
  }
}

export function diagnosticError(
  code: AtolDiagnosticCode,
): AtolDiagnosticError {
  return new ProviderDiagnosticError(code)
}

export function closedDiagnosticError(
  error: unknown,
  fallback: AtolDiagnosticCode,
): AtolDiagnosticError {
  try {
    if (error instanceof ProviderDiagnosticError) {
      const code = error.code
      if (
        Object.prototype.hasOwnProperty.call(
          DIAGNOSTIC_MESSAGES,
          code,
        )
      ) {
        return new ProviderDiagnosticError(code)
      }
    }
  } catch {
    // A hostile caught value cannot escape through diagnostic classification.
  }
  return new ProviderDiagnosticError(fallback)
}

export function logDiagnostic(
  scope:
    | 'auth init'
    | 'permission load'
    | 'provider client cleanup'
    | 'session token',
  error: AtolDiagnosticError,
): void {
  console.error(
    `[Atol] ${scope} failed (${error.code}): ${error.message}`,
  )
}
