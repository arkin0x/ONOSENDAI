import { create } from 'zustand'
import NDK, { NDKEvent, NDKFilter, NDKPrivateKeySigner, NDKRelay, NDKUser, NDKUserProfile, NDKSubscriptionOptions, NDKNip07Signer, NDKRelaySet, NDKSubscription } from '@nostr-dev-kit/ndk'
// import NDKRedisCacheAdapter from '@nostr-dev-kit/ndk-cache-redis'
import { initializeIdentity, loadNpub, unlockKeyForSigning } from '../libraries/LocalIdentity'
import { nip19, UnsignedEvent } from 'nostr-tools'
import { hexToBytes } from '@noble/hashes/utils'

// This declaration allows us to access window.nostr without TS errors.
// https://stackoverflow.com/a/47130953
declare global {
    interface Window {
      ndk: NDK;
    }
}

interface NDKState {
  ndk: NDK | undefined
  relays: string[] | undefined
  isConnected: boolean
  isUserLoaded: boolean
  isProfileLoaded: boolean
  initNDK: (opts: NDKStoreConfig) => Promise<void>
  getNDK: () => NDK
  unlockLocalKeySigner: () => void
  lockLocalKeySigner: () => void
  initLocalKeyUser: (callback?: () => void) => Promise<void>
  initExtensionUser: (callback?: () => void) => Promise<void>
  resetUser: () => void
  fetchUserProfile: () => Promise<void>
  getUser: () => NDKUser | undefined
  getUserProfile: () => NDKUserProfile | undefined
  getPubkey: () => string | undefined
  fetchEvent: (filter: NDKFilter) => Promise<NDKEvent | null>
  fetchEvents: (filter: NDKFilter) => Promise<Set<NDKEvent>>
  exportPrivkey: () => string | undefined
  rawEventToNDKEvent: (rawEvent: UnsignedEvent) => NDKEvent
  publishRaw: (rawEvent: UnsignedEvent) => Promise<Set<NDKRelay>>
  publish: (event: NDKEvent) => Promise<Set<NDKRelay>>
  subscribe: (filter: NDKFilter, options: NDKSubscriptionOptions, relays?: string[]) => NDKSubscription
  createNDKRelaySet: (relays: string[]) => NDKRelaySet
}

export interface NDKStoreConfig {
  relayUrls: string[],
  redisUrl?: string
  useExtension?: boolean
}

export const defaultRelays = [
  'wss://cyberspace.nostr1.com'
]

const useNDKStore = create<NDKState>((set, get) => ({
  ndk: undefined,
  relays: undefined,
  isConnected: false,
  isUserLoaded: false,
  isProfileLoaded: false,

  initNDK: async (opts: NDKStoreConfig) => {

    let redisAdapter
    // if (opts.redisURL) redisAdapter = new NDKRedisCacheAdapter({path: redisURL})

    let signer
    try {
      if (opts.useExtension) {
        signer = new NDKNip07Signer()
        await signer.blockUntilReady()
      }
    } catch (e) {
      alert("Extension prompt was cancelled. Refresh the page to try again.")
    }

    const ndk = new NDK({ 
      cacheAdapter: redisAdapter,
      explicitRelayUrls: opts.relayUrls,
      autoConnectUserRelays: false,
      signer,
    })
    await ndk.connect()
    set({ ndk, isConnected: true, relays: opts.relayUrls || defaultRelays })
    // DEBUG
    window.ndk = ndk
  },

  getNDK: function() {
    // use this function to get the NDK instance so that all the check logic can be in one spot.
    const { ndk, isConnected } = get()
    if (!isConnected || !ndk) throw new Error('NDK not initialized')
    return ndk
  },

  unlockLocalKeySigner: function() {
    const ndk = get().getNDK()
    const signer = unlockKeyForSigning()
    ndk.signer = signer
    set({ ndk })
  },

  lockLocalKeySigner: function() {
    const ndk = get().getNDK()
    ndk.signer = undefined 
    set({ ndk })
  },

  initLocalKeyUser: async (callback=function(){}) => {
    console.log('INITLOCAL')
    const ndk = get().getNDK()
    const signer = initializeIdentity() // sets up a newly generated identity if one doesn't exist
    ndk.signer = signer
    ndk.activeUser = new NDKUser({npub: loadNpub()})
    ndk.activeUser.ndk = ndk
    localStorage.removeItem('useExtension')
    set({ isUserLoaded: true, ndk })
    callback()
  },

  initExtensionUser: async (callback=function(){}) => {
    console.log('INITEXTENSION')
    const ndk = get().getNDK()
    let signer
    try {
      signer = new NDKNip07Signer()
      await signer.blockUntilReady()
      ndk.activeUser = await signer.user()
      ndk.activeUser.ndk = ndk
      ndk.signer = signer
      localStorage.setItem('useExtension', 'true')
      set({ isUserLoaded: true, ndk })
      callback()
    } catch (e) {
      alert("Extension prompt was cancelled. Refresh the page to try again.")
      window.location.reload()
    }
  },

  resetUser: () => {
    const ndk = get().getNDK()
    ndk.activeUser = undefined
    // this also resets activeUser.profile in the process.
    localStorage.removeItem('avatar-storage')
    localStorage.removeItem('ui-storage')
    localStorage.removeItem('sector-storage')
    localStorage.removeItem('useExtension')
    set({ isUserLoaded: false, isProfileLoaded: false, ndk })
  },

  fetchUserProfile: async () => {
    const ndk = get().getNDK()
    if (ndk.activeUser) {
      const profile = await ndk.activeUser.fetchProfile()
      ndk.activeUser.profile = profile || undefined
      set({ ndk, isProfileLoaded: true }) // Force a state update
      console.log("ndk-store: Profile fetched", profile)
    }
  },

  getUser: function(): NDKUser | undefined {
    const ndk = get().getNDK()
    return ndk.activeUser
  },

  getUserProfile: function(): NDKUserProfile | undefined {
    const ndk = get().getNDK()
    return ndk.activeUser?.profile
  },

  getPubkey: function(): string | undefined {
    const ndk = get().getNDK()
    return ndk.activeUser?.pubkey
  },

  exportPrivkey: () => {
    const ndk = get().getNDK()
    get().unlockLocalKeySigner()
    const hexsec = (ndk.signer as NDKPrivateKeySigner).privateKey
    get().lockLocalKeySigner()
    if (!hexsec) return undefined
    const binsec = hexToBytes(hexsec)
    const nsec = nip19.nsecEncode(binsec)
    return nsec
  },

  fetchEvent: async (filter: NDKFilter) => {
    const ndk = get().getNDK()
    return await ndk.fetchEvent(filter)
  },

  fetchEvents: async (filter: NDKFilter) => {
    const ndk = get().getNDK()
    return await ndk.fetchEvents(filter)
  },

  rawEventToNDKEvent: (rawEvent: UnsignedEvent): NDKEvent => {
    const ndk = get().getNDK()
    const ndkEvent = new NDKEvent(ndk, rawEvent)
    return ndkEvent
  },

  publishRaw: async (rawEvent: UnsignedEvent) => {
    return await get().publish(get().rawEventToNDKEvent(rawEvent))
  },

  publish: async (event: NDKEvent) => {
    const ndk = get().getNDK()
    if (!event.ndk) event.ndk = ndk
    if (!ndk.signer) get().unlockLocalKeySigner()
    return await event.publish()
  },

  subscribe: (filter: NDKFilter, options: NDKSubscriptionOptions, relays?: string[]) => {
    const ndk = get().getNDK()
    const relaySet = get().createNDKRelaySet(relays || defaultRelays)
    return ndk.subscribe(filter, options, relaySet)
  },

  createNDKRelaySet(relays: string[]): NDKRelaySet {
    const ndk = get().getNDK()
    const newSet = new Set<NDKRelay>()
    relays.forEach(relay => {
      newSet.add(new NDKRelay(relay))
    })
    return new NDKRelaySet(newSet, ndk)
  }
  // Add more NDK methods and state as needed
}))

// init immediately
useNDKStore.getState().initNDK({
  relayUrls: defaultRelays,
  useExtension: !!localStorage.getItem('useExtension')
}).then(() => {
  if (localStorage.getItem('useExtension')) useNDKStore.getState().initExtensionUser(() => {})
    else useNDKStore.getState().initLocalKeyUser(() => {})
})

export default useNDKStore
