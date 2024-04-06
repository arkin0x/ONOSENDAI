/* eslint-disable @typescript-eslint/ban-types */
import { RelayObject } from './NostrRelay'

export type IdentityType = {
  pubkey: string
  npub?: string
  created_at?: number // record the last time the profile was updated from relays. This also serves as a marker that the account has been loaded. Updated in Login component.
  name?: string
  username?: string
  display_name?: string
  displayName?: string
  about?: string
  nip05?: string
  website?: string
  picture?: string
  image?: string
  banner?: string
  lud06?: string
  lud16?: string
  // [key: string]: string | undefined
}

export type IdentityContextType = {
  identity: IdentityType,
  setIdentity: Function,
  profileLoaded: Function,
  relays: RelayObject,
  setRelays: Function,
}
