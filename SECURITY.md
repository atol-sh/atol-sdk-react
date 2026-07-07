# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in `@atol-sh/react`, please report it
responsibly.

**Email:** security@atol.sh

Do NOT open a public GitHub issue for security vulnerabilities.

## Response Timeline

- **48 hours** -- initial acknowledgment of your report.
- **7 days** -- preliminary assessment and severity classification.
- **30 days** -- target for fix development and coordinated disclosure.

We will keep you informed throughout the process.

## Scope

This SDK runs in the browser and handles OIDC tokens, permission checks, and
optional client-side encryption keys. The following are in scope:

- Token leakage from the in-memory store to persistent storage (localStorage,
  sessionStorage, IndexedDB) or to third parties
- Authentication or authorization bypasses, including `can()` / `<Can>` /
  `<ProtectedRoute>` returning allow when the server would deny
- PKCE, state, or DPoP proof handling flaws enabling code interception or
  token replay
- Cross-site scripting (XSS) vectors introduced by the SDK
- Silent-renew or cross-tab coordination flaws enabling refresh-token reuse or
  session fixation
- Weaknesses in the zero-knowledge encryption path (KEK/DEK derivation,
  unwrapping, or `KEKVault` storage)
- Information disclosure of sensitive data (tokens, keys, claims, device
  signals)
- Vulnerabilities in dependencies used by this SDK

## Out of Scope

- Vulnerabilities in the Atol control plane or APIs (report those against the
  `atol-sh/atol` repository)
- Social engineering or phishing attacks
- Denial of service (DoS/DDoS) attacks
- Misconfiguration in a consuming application (e.g. exposing a secret key in
  frontend code) that is not caused by the SDK
- Reports from automated scanners without a demonstrated proof of concept
- Issues already reported and under active remediation

## Safe Harbor

We consider security research conducted in good faith to be authorized
activity. We will not pursue legal action against researchers who:

- Make a good faith effort to avoid privacy violations, data destruction, and
  service disruption.
- Only interact with accounts they own or with explicit permission from the
  account holder.
- Report vulnerabilities through the process described above.
- Allow reasonable time for remediation before public disclosure.

## Preferred Languages

Reports may be submitted in English.

## Recognition

We are happy to credit researchers who report valid vulnerabilities, unless
they prefer to remain anonymous. Let us know your preference when you submit
your report.
