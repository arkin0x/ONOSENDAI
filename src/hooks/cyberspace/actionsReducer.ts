import { actionChainIsValid } from "./actionChainIsValid"
import { ActionsState, ActionsReducer } from "./actionReducerTypes"

export const actionsReducer = (state: ActionsState, action: ActionsReducer) => {
  // add new action to state
  const newState = [...state, action.payload] as ActionsState
  // sort actions by created_at+ms tag from oldest to newest
  newState.sort((a, b) => {
    const aMs = a.tags.find(tag => tag[0] === 'ms')
    const bMs = b.tags.find(tag => tag[0] === 'ms')
    const aTs = a.created_at * 1000 + (aMs ? parseInt(aMs[1]) : 0)
    const bTs = b.created_at * 1000 + (bMs ? parseInt(bMs[1]) : 0)
    return aTs - bTs
  })
  // validate action chain
  // if action chain is valid, return the new state
  if (actionChainIsValid(newState)) {
    return newState
  }
  // a new event can invalidate the whole current action chain. if action chain is invalid, dump it and only return the latest action that invalidated the old chain
  console.warn('Invalid action chain detected. Dumping old chain and returning latest action.')
  return [action.payload]
}
