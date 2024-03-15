import { Event } from "nostr-tools"
import { ActionReducer } from "./actionReducerTypes"

// actions are not necessarily received in order by timestamp!
export const actionsReducer = (state: Event[], action: ActionReducer): Event[] => {
  console.log('reducer: event', action.payload || action.type)

  let newState = [] as Event[]

  if (action.type === 'reset'){
    return [] as Event[]
  }
  if (action.type === 'unshift') {
    newState = [action.payload, ...state] as Event[]
  }
  if (action.type === 'push') {
    newState = [...state, action.payload] as Event[]
  }

  // sort actions by created_at+ms tag from oldest to newest
  newState.sort((a, b) => {
    const aMs = a.tags.find(tag => tag[0] === 'ms')
    const bMs = b.tags.find(tag => tag[0] === 'ms')
    const aTs = a.created_at * 1000 + (aMs ? parseInt(aMs[1]) : 0)
    const bTs = b.created_at * 1000 + (bMs ? parseInt(bMs[1]) : 0)
    return aTs - bTs
  })

  // dedupe actions
  const dedupeState = newState.filter((action, index, self) =>
    index === self.findIndex((t) => (
      t.id === action.id
    ))
  )    

  return dedupeState
}