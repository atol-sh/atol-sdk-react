/**
 * Re-export shim. The base64 / base64url helpers now live in the
 * framework-agnostic core `@atol-sh/js`. This file preserves the internal
 * `./lib/base64url` import path used across the SDK.
 */
export { base64ToBytes, bytesToBase64Url, stringToBase64Url } from '@atol-sh/js'
