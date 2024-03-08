import { useState, useEffect, createContext } from "react"
import NDK, { NDKNip07Signer } from '@nostr-dev-kit/ndk'

type NDKContextType = NDK | null 

export const NDKContext = createContext<NDKContextType>(null)

type NDKProviderProps = {
  children: React.ReactNode
}

export const NDKProvider: React.FC<NDKProviderProps> = ({ children }) => {
  const [ndk, setNDK] = useState<NDKContextType>(null)

  useEffect(() => {
    const setupNDK = async () => {
      const signer = new NDKNip07Signer(3000)
      const ndkRef = new NDK({
        signer,
        explicitRelayUrls: ["wss://cyberspace.nostr1.com"]
      })
      await ndkRef.connect()
      setNDK(ndkRef)
    }
    setupNDK()
  }, [])

  return (
    <NDKContext.Provider value={ndk}>
      {children}
    </NDKContext.Provider>
  )
}