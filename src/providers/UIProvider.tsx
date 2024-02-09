/* eslint-disable @typescript-eslint/no-empty-function */
import { createContext } from 'react'
import usePersistedState from '../hooks/usePersistedState'
import { UIState } from '../types/UI.tsx'

type UIContextType = {
  uiState: UIState
  setUIState: (uiState: UIState) => void
}

const defaultUIState: UIContextType = {
  uiState: UIState.telemetry,
  setUIState: () => {}
}

export const UIContext = createContext<UIContextType>(defaultUIState)

type UIProviderProps = {
  children: React.ReactNode
}

export const UIProvider: React.FC<UIProviderProps> = ({children}) => {

  const [uiState, setUIState] = usePersistedState<UIState>('ui', UIState.telemetry)

  return (
    <UIContext.Provider value={{uiState, setUIState}}>
      {children}
    </UIContext.Provider>
  )
}
