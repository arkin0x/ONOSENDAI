import React, { createContext, useReducer } from 'react'
import { Event, UnsignedEvent } from 'nostr-tools'

// type for storing avatar actions in state
type AvatarActionState = {
  [pubkey: string]: Event[]
}

// dispatch action type to update the action state
export type AvatarActionDispatched = 
  | { type: 'unshift' | 'push'; pubkey: string; actions: Event[] }
  | { type: 'reset'; pubkey: string }

const initialActionState: AvatarActionState = {}

const avatarActionStateReducer = (state: AvatarActionState, action: AvatarActionDispatched): AvatarActionState => {

  const newState = {...state} as AvatarActionState

  // check for action's pubkey in state and initialize if necessary
  if (newState[action.pubkey] === undefined) {
    newState[action.pubkey] = [] as Event[]
  }

  const avatarActions: Event[] = newState[action.pubkey]

  if (action.type === 'reset'){
    newState[action.pubkey] = [] as Event[]
    return newState
  }
  if (action.type === 'unshift') {
    newState[action.pubkey] = [...action.actions, ...avatarActions] as Event[]
  }
  if (action.type === 'push') {
    newState[action.pubkey] = [...avatarActions, ...action.actions] as Event[]
  }

  // sort actions by created_at+ms tag from oldest to newest
  newState[action.pubkey].sort((a, b) => {
    const aMs = a.tags.find(tag => tag[0] === 'ms')
    const bMs = b.tags.find(tag => tag[0] === 'ms')
    const aTs = a.created_at * 1000 + (aMs ? parseInt(aMs[1]) : 0)
    const bTs = b.created_at * 1000 + (bMs ? parseInt(bMs[1]) : 0)
    return aTs - bTs
  })

  // dedupe actions and prefer signed events
  /////// gpt code below
  newState[action.pubkey] = newState[action.pubkey].reduce((acc, currentAction) => {
    const existingAction = acc.find((action) => action.id === currentAction.id)

    if (!existingAction) {
      return [...acc, currentAction]
    }

    if (currentAction.sig && !existingAction.sig) {
      return [...acc.filter((action) => action.id !== currentAction.id), currentAction]
    }

    return acc
  }, [] as Event[])
  //////////// gpt code above

  return newState
}

// type for storing avatars' most recent simulated state. This will sometimes be an UnsignedEvent copy of the most recent Event in the action state.
type AvatarSimulatedState = {
  [pubkey: string]: UnsignedEvent 
}

// dispatch action type to update the simulated state
export type AvatarSimulatedDispatched = {
  type: 'update',
  pubkey: string,
  action: UnsignedEvent
}

const initialSimulatedState: AvatarSimulatedState = {}

const avatarSimulatedStateReducer = (state: AvatarSimulatedState, action: AvatarSimulatedDispatched): AvatarSimulatedState => {
  const newState = {...state} as AvatarSimulatedState

  newState[action.pubkey] = action.action

  return newState
}

// ---  AvatarContext  ---

export type AvatarContextType = {
  actionState: AvatarActionState;
  dispatchActionState: React.Dispatch<AvatarActionDispatched>
  simulatedState: AvatarSimulatedState;
  dispatchSimulatedState: React.Dispatch<AvatarSimulatedDispatched>
}

/**
 * AvatarContext.tsx
 * 
 * @description AvatarContext provides a react context for managing the state of all avatars encountered, including the current user.
 * - There are two states: actionState and simulatedState. actionState is the state of the avatar as it has been recorded in POW events. simulatedState is the state of the avatar as it is being simulated in the cyberspace from the most recent actionState until the current timestamp.
 * - The simulatedState contains an unmined action with the values used to display the avatar in the cyberspace and mine new valid actions.
*/
export const AvatarContext = createContext<AvatarContextType>({
  actionState: initialActionState,
  dispatchActionState: () => {},
  simulatedState: initialSimulatedState,
  dispatchSimulatedState: () => {},
})

type AvatarProviderProps = {
  children: React.ReactNode
}

export const AvatarProvider = ({ children }: AvatarProviderProps) => {
  const [actionState, dispatchActionState] = useReducer(avatarActionStateReducer, initialActionState)
  const [simulatedState, dispatchSimulatedState] = useReducer(avatarSimulatedStateReducer, initialSimulatedState)

  return (
    <AvatarContext.Provider value={{ actionState, dispatchActionState, simulatedState, dispatchSimulatedState }}>
      {children}
    </AvatarContext.Provider>
  )
}