import type { UnsignedEvent } from 'nostr-tools'
import { useState, useEffect, createContext } from "react"
import NDK, { NDKEvent, NDKNip07Signer, NostrEvent } from '@nostr-dev-kit/ndk'
import { defaultRelays, getRelayList } from '../libraries/Nostr'
// import { defaultRelays, getRelayList } from "../libraries/Nostr"

type NDKContextType = {
  ndk?: NDK,
  publishEvent: (event: UnsignedEvent) => Promise<false | NDKEvent>
}

const defaultNDKContext: NDKContextType = {
  ndk: undefined,
  publishEvent: async () => false
}

export const NDKContext = createContext<NDKContextType>(defaultNDKContext)

type NDKProviderProps = {
  children: React.ReactNode
}

export const NDKProvider: React.FC<NDKProviderProps> = ({ children }) => {
  const [ndk, setNDK] = useState<NDK>()

  useEffect(() => {
    const setupNDK = async () => {
      const signer = new NDKNip07Signer(3000)
      const ndkRef = new NDK({
        signer,
        explicitRelayUrls: getRelayList(defaultRelays),
        enableOutboxModel: false,
        autoConnectUserRelays: false,
      })
      ndkRef.connect(1000)
      setNDK(ndkRef)
    }
    setupNDK()
  }, [])

  async function publishEvent(event: UnsignedEvent): Promise<NDKEvent|false> {
    if (ndk) {
      const ndkEvent = new NDKEvent(ndk, event as NostrEvent)
      ndkEvent.sign()
      const pubs = await ndkEvent.publish()
      console.log('Published NDKEvent: ', ndkEvent, 'to relays', pubs)
      return ndkEvent
    } else {
      console.warn(`publishEvent: Could not publish event because NDK is not ready.`, ndk, event)
      return false
    }
  }

  return (
    <NDKContext.Provider value={{ndk, publishEvent}}>
      {children}
    </NDKContext.Provider>
  )
}