/* eslint-disable @typescript-eslint/no-empty-function */
import { createContext } from 'react'
import {
  DraftPlace,
  DraftPlaceContextType,
  DraftPlaceProviderProps
} from '../types/Place'
import usePersistedState from '../hooks/usePersistedState'
import { defaultPlace } from '../libraries/defaultPlace'

const defaultDraftPlaceContext: DraftPlaceContextType = {
  draftPlace: defaultPlace,
  setDraftPlace: () => {}
}

export const DraftPlaceContext = createContext<DraftPlaceContextType>(defaultDraftPlaceContext)

export const DraftPlaceProvider: React.FC<DraftPlaceProviderProps> = ({children})=> {
  const [draftPlace, setDraftPlace] = usePersistedState<DraftPlace>('draftPlace', defaultPlace)

  return (
    <DraftPlaceContext.Provider value={{draftPlace, setDraftPlace}}>
      {children}
    </DraftPlaceContext.Provider>
  )
}