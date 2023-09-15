
// 1. Get EOSE for drift events for the identity.pubkey. "Loading" state until then.
// 2. Query for nearby aggressive events
// 3. Reconcile the avatars state from a chronological timeline of both drift and aggressive events

import { Event, Filter } from "nostr-tools"
import { useContext, useEffect, useState } from "react"
import { getRelayList, pool } from "../libraries/Nostr"
import { IdentityContext } from "../providers/IdentityProvider"
import { IdentityContextType } from "../types/IdentityType"
import { RelayList } from "../types/NostrRelay"

type Action = Event<333> & {
  kind: 333,
}

type ActionsState = Action[]
type ActionsReducer = {
  type: 'add',
  payload: Action
}

const actionChainIsValid = (actions: ActionsState): boolean => {
  // check the p tags for valid references. Every subsequent action must reference the previous one
  let testHashState = [...actions]
  return testHashState.reverse().every((action, index) => {
    // the first action in the chain is always valid because it has no predicate to reference
    if (index === testHashState.length - 1) {
      return true
    }
    // check if the next action is referenced in the current action
    const nextAction = testHashState[index + 1]
    if (action.tags.find(tag => tag[0] === 'p' && tag[1] === nextAction.id)) {
      return true
    }
    return false
  })
}

const actionsReducer = (state: ActionsState, action: ActionsReducer) => {
  // add new action to state
  let newState = [...state, action.payload] as ActionsState
  // sort actions by created_at, ms tag from oldest to newest
  newState.sort((a, b) => {
    const aMs = a.tags.find(tag => tag[0] === 'ms')
    const bMs = b.tags.find(tag => tag[0] === 'ms')
    if (aMs && bMs) {
      return parseInt(aMs[1]) - parseInt(bMs[1])
    } else {
      return 0
    }
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

export const useCyberspaceStateReconciler = () => {
  const {identity, relays} = useContext<IdentityContextType>(IdentityContext)
  const [actions, actionDispatch] = useReducer<ActionsReducer, ActionsState>(actionsReducer, initialState)
  useEffect(() => {
    const filter: Filter<333> = {kinds: [333], authors: [identity.pubkey]}
    const relayList: RelayList = getRelayList(relays, ['read'])
    const sub = pool.sub(relayList, [filter])
    // get actions from your relays
    sub.on('event', (event) => {

    })

}