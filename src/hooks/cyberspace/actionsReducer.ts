import { isGenesisAction } from "../../libraries/Cyberspace"
import { ActionsState, ActionsReducer } from "./actionReducerTypes"

// actions are not necessarily received in order by timestamp!
export const actionsReducer = (state: ActionsState, action: ActionsReducer) => {

  if (action.type === 'reset') {
    return []
  }
  if (!action.payload) {
    return state
  }

  // console.log('check state', state)

  const newState = [...state, action.payload]

  // console.log('check reducer', state, newState, action.payload)

  // sort actions by created_at+ms tag from oldest to newest
  newState.sort((a, b) => {
    const aMs = a.tags.find(tag => tag[0] === 'ms')
    const bMs = b.tags.find(tag => tag[0] === 'ms')
    const aTs = a.created_at * 1000 + (aMs ? parseInt(aMs[1]) : 0)
    const bTs = b.created_at * 1000 + (bMs ? parseInt(bMs[1]) : 0)
    return aTs - bTs
  })

  if (newState.length >= 2) {
    // find newest genesis action and dump everything before it
    for (let i = newState.length - 1; i >= 0; i--) {
      if (isGenesisAction(newState[i])) {
        newState.splice(0, i)
        break
      }
    }
  }

  // check if the newest action is a genesis action
  // if so, dump all previous actions
  // genesis should have zero velocity, a C tag matching the pubkey and no e tags.
  const latest = newState[newState.length - 1]
  if (isGenesisAction(latest)) {
    // dump all actions that aren't part of this genesis event's action chain
    return [latest]
  }

  // if we received an event belonging to a prior action chain, dump that too
  const currentChainGenesisID = latest.tags.find(tag => tag[0] === 'e' && tag[3] === 'genesis')![1]
  newState.filter(action => {
    if (isGenesisAction(action)) {
      return true
    }
    const actionGenesisID = action.tags.find(tag => tag[0] === 'e' && tag[3] === 'genesis')![1]
    return actionGenesisID === currentChainGenesisID
  })

  // return only the most recent action chain events in chronological order
  return newState
}
