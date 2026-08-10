import { describe, expect, it, vi } from 'vitest'
import { makeFakeAuth } from './fake-auth'

describe('makeFakeAuth cancelLogin()', () => {
  it('rejects ordinary mode before checking lifecycle state', async () => {
    const fake = makeFakeAuth()
    await fake.init()

    await expect(fake.cancelLogin()).rejects.toThrowError(
      /^cancelLogin requires response-vault authorization$/,
    )
  })

  it('preserves signed-out state on supported pre-init cancellation', async () => {
    const fake = makeFakeAuth({ responseVault: true })
    const onSessionChange = vi.fn()
    const unsubscribe = fake.onSessionChange(onSessionChange)
    const initialSession = onSessionChange.mock.calls[0]?.[0]

    await expect(fake.cancelLogin()).resolves.toBeUndefined()

    expect(fake.spies.cancelLogin).toHaveBeenCalledTimes(1)
    expect(initialSession).toEqual({ isAuthenticated: false, user: null })
    expect(onSessionChange).toHaveBeenCalledTimes(1)
    expect(onSessionChange.mock.calls[0]?.[0]).toBe(initialSession)
    await expect(fake.getAccessToken()).resolves.toBeUndefined()
    expect(fake.getIdToken()).toBeUndefined()
    unsubscribe()
  })

  it('rejects supported cancellation after initialization', async () => {
    const fake = makeFakeAuth({ responseVault: true })
    await fake.init()

    await expect(fake.cancelLogin()).rejects.toThrowError(
      /^cancelLogin requires an uninitialized signed-out client$/,
    )
  })
})
