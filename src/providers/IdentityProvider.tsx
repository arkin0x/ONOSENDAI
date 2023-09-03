/* eslint-disable @typescript-eslint/no-empty-function */
import { createContext } from 'react'
import { IdentityType, IdentityContextType } from '../types/IdentityType.tsx'
import usePersistedState from '../hooks/usePersistedState'
import { RelayObject } from '../types/NostrRelay'
import { defaultRelays } from '../libraries/Nostr.ts'

const STALE_PROFILE = 1000 * 60 * 60 * 24 * 7

const defaultIdentityContext: IdentityContextType = {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  identity: null!,
  setIdentity: () => {},
  isIdentityFresh: () => {},
  relays: defaultRelays,
  setRelays: () => {},
}

export const IdentityContext = createContext<IdentityContextType>(defaultIdentityContext)

type IdentityProviderProps = {
  children: React.ReactNode
}

export const IdentityProvider: React.FC<IdentityProviderProps> = ({children})=> {
  const [identity, setIdentity] = usePersistedState<IdentityType>('identity')
  const [relays, setRelays] = usePersistedState<RelayObject>('relays', defaultRelays)

  const isIdentityFresh = (): boolean => {
    if (identity?.last_updated && +new Date() - identity.last_updated < STALE_PROFILE) {
      return true 
    }
    return false
  }

  return (
    <IdentityContext.Provider value={{identity, setIdentity, isIdentityFresh, relays, setRelays}}>
      {children}
    </IdentityContext.Provider>
  )
}