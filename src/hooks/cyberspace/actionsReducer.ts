import { ActionsState, ActionsReducer } from "./actionReducerTypes"

// actions are not necessarily received in order by timestamp!
export const actionsReducer = (state: ActionsState, action: ActionsReducer) => {

  const newState = [...state, action.payload]

  // sort actions by created_at+ms tag from oldest to newest
  newState.sort((a, b) => {
    const aMs = a.tags.find(tag => tag[0] === 'ms')
    const bMs = b.tags.find(tag => tag[0] === 'ms')
    const aTs = a.created_at * 1000 + (aMs ? parseInt(aMs[1]) : 0)
    const bTs = b.created_at * 1000 + (bMs ? parseInt(bMs[1]) : 0)
    return aTs - bTs
  })

  // check if the newest action is a genesis action
  // if so, dump all previous actions
  // genesis should have zero velocity, a C tag matching the pubkey and no e tags.
  const latest = newState[newState.length - 1]
  const hasPubkeyCoordinate = latest.pubkey === latest.tags.find(tag => tag[0] === 'C')![1] 
  const hasNoETags = !latest.tags.find(tag => tag[0] === 'e')
  const hasZeroVelocity = latest.tags.find(tag => tag[0] === 'velocity')!.slice(1).join('') === "000"
  const isGenesisEvent = hasPubkeyCoordinate && hasNoETags && hasZeroVelocity
  if (isGenesisEvent) {
    // dump all actions that aren't part of this genesis event's action chain
    return [latest]
  }

  // if we received an event belonging to a prior action chain, dump that too
  const currentChainGenesisID = latest.tags.find(tag => tag[0] === 'e' && tag[3] === 'genesis')![1]
  newState.filter(action => {
    const actionGenesisID = action.tags.find(tag => tag[0] === 'e' && tag[3] === 'genesis')![1]
    return actionGenesisID === currentChainGenesisID
  })

  // return only the most recent action chain events in chronological order
  return newState
}
