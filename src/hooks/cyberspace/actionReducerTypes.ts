import { Event } from 'nostr-tools'
export type ActionsState = Event[]
export type ActionReducer = {
  type: 'push' | 'unshift' | 'reset'
  payload?: Event
}