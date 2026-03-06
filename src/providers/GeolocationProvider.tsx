import { createContext, type Dispatch, type SetStateAction, useState } from 'react'
import { useGeolocation } from '../hooks/useGeolocation'

type GeolocationContextType = {
  position: GeolocationPosition | null
  cursorPosition: CursorPositionType
  setCursorPosition: Dispatch<SetStateAction<CursorPositionType>>
}

export type CursorPositionType = {
  lng: number
  lat: number
} | null

const defaultGeolocationContext: GeolocationContextType = {
  position: null,
  cursorPosition: null,
  setCursorPosition: () => undefined,
}

export const GeolocationContext = createContext<GeolocationContextType>(defaultGeolocationContext)

type GeolocationProviderProps = {
  children: React.ReactNode
  trigger: boolean // this tells us the user clicked somewhere so we can request geo
}

export const GeolocationProvider: React.FC<GeolocationProviderProps> = ({ children, trigger }) => {
  const [position] = useGeolocation(trigger)
  const [cursorPosition, setCursorPosition] = useState<CursorPositionType>(null)

  return (
    <GeolocationContext.Provider value={{ position, cursorPosition, setCursorPosition }}>
      {children}
    </GeolocationContext.Provider>
  )
}
