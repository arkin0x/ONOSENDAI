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

  // debug time
  // const t = +new Date()
  // console.log(t, 'old avatar state', state[action.pubkey])

  // check for action's pubkey in state and initialize if necessary
  if (newState[action.pubkey] === undefined) {
    newState[action.pubkey] = [] as Event[]
  }

  const avatarActions: Event[] = newState[action.pubkey]

  if (action.type === 'reset'){
    newState[action.pubkey] = [] as Event[]
    // console.log(t, 'reset avatar state', newState[action.pubkey])
    return newState
  }
  if (action.type === 'unshift') {
    // console.log(t, 'unshift avatar state')
    newState[action.pubkey] = [...action.actions, ...avatarActions] as Event[]
  }
  if (action.type === 'push') {
    // console.log(t, 'push avatar state')
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
  newState[action.pubkey] = newState[action.pubkey].reduce((acc, currentAction) => {
    // Check if the current action already exists in the accumulator
    const existingAction = acc.find((action) => action.id === currentAction.id)

    // If the current action doesn't exist in the accumulator, add it
    if (!existingAction) {
      return [...acc, currentAction]
    }

    // The current action exists in the accumulator.
    // console.log('duplicate action:', currentAction.id.substring(0,8))

    // If the current action is signed and the existing action is not, replace the existing action with the current action
    if (currentAction.sig && !existingAction.sig) {
      return [...acc.filter((action) => action.id !== currentAction.id), currentAction]
    }

    // If none of the above conditions are met, keep the existing action in the accumulator
    return acc
  }, [] as Event[])

  // console.log(t,'new avatar state', newState[action.pubkey])
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

  // warn for info
  if(state[action.pubkey] === action.action) console.warn('duplicate event dispatched to simulated state')

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