import { Event } from 'nostr-tools'

export type ID = string

export type BeaconCollection = {
  [key: ID]: Event<37515>
}
