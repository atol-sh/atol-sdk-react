import type { AtolBrowserAuth } from '@atol-sh/js'
import { diagnosticError } from './diagnostics'
import type { AtolDiagnosticCode } from './types'

export async function runProviderAction<T>(
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
