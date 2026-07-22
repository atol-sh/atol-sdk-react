import { createContext, useContext } from 'react'
import type { AtolContextValue } from './types'

const defaultContext: AtolContextValue = {
  isLoading: true,
  isAuthenticated: false,
  user: null,
  organizationId: null,
  error: null,
  permissions: new Map(),
  permissionsError: null,
  encryptionKey: null,
  encryptionError: null,
  login: async () => {
    throw new Error('AtolProvider not mounted')
  },
  selectOrganization: async () => {
    throw new Error('AtolProvider not mounted')
  },
  logout: async () => {
    throw new Error('AtolProvider not mounted')
  },
  getAccessToken: async () => {
    throw new Error('AtolProvider not mounted')
  },
  forceRenew: async () => {
    throw new Error('AtolProvider not mounted')
  },
  signDPoPProof: async () => {
    throw new Error('AtolProvider not mounted')
  },
}

export const AtolContext = createContext<AtolContextValue>(defaultContext)

export function useAtolContext(): AtolContextValue {
  const ctx = useContext(AtolContext)
  if (ctx === defaultContext) {
    throw new Error('useAtol must be used within an <AtolProvider>')
  }
  return ctx
}
