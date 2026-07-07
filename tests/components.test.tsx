/**
 * <Can> and <ProtectedRoute> rendering behavior against a controlled
 * context value (no network, no OIDC).
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { AtolContext } from '../src/context'
import { Can } from '../src/components/can'
import { ProtectedRoute } from '../src/components/protected-route'
import type { AtolContextValue, AtolUser } from '../src/types'

const user: AtolUser = {
  id: 'user-1',
  email: 'remi@example.test',
  emailVerified: true,
  name: 'Remi',
  orgId: 'org-1',
  plan: 'pro',
  roles: ['admin'],
  authMethod: 'oidc',
  mfaVerified: true,
}

function ctx(overrides: Partial<AtolContextValue> = {}): AtolContextValue {
  return {
    isLoading: false,
    isAuthenticated: true,
    user,
    error: null,
    permissions: new Map([['edit:publication', true]]),
    permissionsError: null,
    encryptionKey: null,
    login: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    getAccessToken: vi.fn().mockResolvedValue('at'),
    forceRenew: vi.fn().mockResolvedValue('at'),
    ...overrides,
  }
}

function renderWith(value: AtolContextValue, ui: React.ReactNode) {
  return render(<AtolContext.Provider value={value}>{ui}</AtolContext.Provider>)
}

describe('<Can>', () => {
  it('renders children when the permission is granted', () => {
    renderWith(
      ctx(),
      <Can action="edit" resource="publication">
        <span>allowed</span>
      </Can>,
    )
    expect(screen.getByText('allowed')).toBeInTheDocument()
  })

  it('renders nothing when the permission is missing (deny by default)', () => {
    renderWith(
      ctx(),
      <Can action="manage" resource="billing">
        <span>allowed</span>
      </Can>,
    )
    expect(screen.queryByText('allowed')).toBeNull()
  })

  it('renders the fallback when denied', () => {
    renderWith(
      ctx(),
      <Can action="manage" resource="billing" fallback={<span>upgrade</span>}>
        <span>allowed</span>
      </Can>,
    )
    expect(screen.getByText('upgrade')).toBeInTheDocument()
  })

  it('denies when permissions failed to load (empty map + error)', () => {
    renderWith(
      ctx({ permissions: new Map(), permissionsError: new Error('HTTP 500') }),
      <Can action="edit" resource="publication" fallback={<span>nope</span>}>
        <span>allowed</span>
      </Can>,
    )
    expect(screen.getByText('nope')).toBeInTheDocument()
  })
})

describe('<ProtectedRoute>', () => {
  it('renders nothing while loading', () => {
    renderWith(
      ctx({ isLoading: true, isAuthenticated: false, user: null }),
      <ProtectedRoute>
        <span>secret</span>
      </ProtectedRoute>,
    )
    expect(screen.queryByText('secret')).toBeNull()
  })

  it('starts login exactly once when unauthenticated', async () => {
    const login = vi.fn().mockResolvedValue(undefined)
    renderWith(
      ctx({ isAuthenticated: false, user: null, login }),
      <ProtectedRoute>
        <span>secret</span>
      </ProtectedRoute>,
    )
    await waitFor(() => expect(login).toHaveBeenCalledTimes(1))
    expect(login).toHaveBeenCalledWith({
      returnTo: window.location.pathname + window.location.search,
    })
    expect(screen.queryByText('secret')).toBeNull()
  })

  it('renders children when authenticated and no permission required', () => {
    renderWith(
      ctx(),
      <ProtectedRoute>
        <span>secret</span>
      </ProtectedRoute>,
    )
    expect(screen.getByText('secret')).toBeInTheDocument()
  })

  it('renders children when the required permission is granted', () => {
    renderWith(
      ctx(),
      <ProtectedRoute action="edit" resource="publication">
        <span>secret</span>
      </ProtectedRoute>,
    )
    expect(screen.getByText('secret')).toBeInTheDocument()
  })

  it('renders the fallback when the required permission is denied', () => {
    renderWith(
      ctx(),
      <ProtectedRoute action="manage" resource="team" fallback={<span>denied</span>}>
        <span>secret</span>
      </ProtectedRoute>,
    )
    expect(screen.getByText('denied')).toBeInTheDocument()
    expect(screen.queryByText('secret')).toBeNull()
  })
})
