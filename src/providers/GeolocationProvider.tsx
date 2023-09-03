/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/no-empty-function */
import { createContext, useState } from 'react'
import { useGeolocation } from '../hooks/useGeolocation'

type GeolocationContextType = {
  position: GeolocationPosition | null
  cursorPosition: CursorPositionType
  setCursorPosition: Function
}

export type CursorPositionType = {
  lng: number
  lat: number
} | null

const defaultGeolocationContext: GeolocationContextType = {
  position: null,
  cursorPosition: null,
  setCursorPosition: () => {},
}

export const GeolocationContext = createContext<GeolocationContextType>(defaultGeolocationContext)

type GeolocationProviderProps = {
  children: React.ReactNode
  trigger: boolean // this tells us the user clicked somewhere so we can request geo
}

export const GeolocationProvider: React.FC<GeolocationProviderProps> = ({ children, trigger }) => {
  const [position] = useGeolocation(trigger)
  const [cursorPosition, setCursorPosition] = useState(null)

  return (
    <GeolocationContext.Provider value={{ position, cursorPosition, setCursorPosition }}>
      {children}
    </GeolocationContext.Provider>
  )
}
