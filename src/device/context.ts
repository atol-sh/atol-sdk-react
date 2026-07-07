import { createContext, useContext } from 'react'
import { initialDeviceState, type DeviceState } from './types'

export const DeviceContext = createContext<DeviceState>(initialDeviceState)

export function useDeviceContext(): DeviceState {
  return useContext(DeviceContext)
}
