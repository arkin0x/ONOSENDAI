// AvatarContext.tsx
import React, { createContext, useReducer } from 'react'
import { Event } from 'nostr-tools'

type AvatarState = {
  [pubkey: string]: Event[]
}

export type AvatarAction =
  | { type: 'unshift' | 'push'; pubkey: string; actions: Event[] }
  | { type: 'reset'; pubkey: string }

const initialState: AvatarState = {}

const avatarReducer = (state: AvatarState, action: AvatarAction): AvatarState => {

  const newState = {...state} as AvatarState

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

  // dedupe actions
  newState[action.pubkey] = newState[action.pubkey].filter((action, index, self) =>
    index === self.findIndex((t) => (
      t.id === action.id
    ))
  )

  return newState
}

export const AvatarContext = createContext<{
  state: AvatarState;
  dispatch: React.Dispatch<AvatarAction>
}>({
  state: initialState,
  dispatch: () => {},
})

type AvatarProviderProps = {
  children: React.ReactNode
}

export const AvatarProvider = ({ children }: AvatarProviderProps) => {
  const [state, dispatch] = useReducer(avatarReducer, initialState)

  return (
    <AvatarContext.Provider value={{ state, dispatch }}>
      {children}
    </AvatarContext.Provider>
  )
}