import { Event } from 'nostr-tools'
export type ActionsState = Event[]
export type ActionsReducer = {
  type: 'add' | 'reset'
  payload?: Event
}
