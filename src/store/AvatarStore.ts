import { create } from 'zustand'
import { Event, UnsignedEvent } from 'nostr-tools'
import { CyberspaceAction, CyberspaceVirtualAction, CyberspaceVirtualActionTemplate, getTime, simulateNextEvent, validateCyberspaceAction } from "../libraries/Cyberspace"
import { getTag } from '../libraries/Nostr'

type AvatarActionState = {
  [pubkey: string]: CyberspaceAction[]
}

export type AvatarActionDispatched = 
  | { type: 'unshift' | 'push'; pubkey: string; actions: Event[] }
  | { type: 'reset'; pubkey: string }

interface AvatarStore {
  actionState: AvatarActionState
  dispatchActionState: (action: AvatarActionDispatched) => void
  getSimulatedState: (pubkey: string) => CyberspaceVirtualActionTemplate | null
  getGenesis: (pubkey: string) => CyberspaceAction | null
  getLatest: (pubkey: string) => CyberspaceAction | null
  getGenesisSectorId: (pubkey: string) => string | null
  getLatestSectorId: (pubkey: string) => string | null
  getSimulatedSectorId: (pubkey: string) => string | null
}

const avatarActionStateReducer = (state: AvatarActionState, action: AvatarActionDispatched): AvatarActionState => {
  console.log('avatarActionStateReducer', state, action)
  const newState = {...state} as AvatarActionState

  if (newState[action.pubkey] === undefined) {
    newState[action.pubkey] = [] as CyberspaceAction[]
  }

  const avatarActions: CyberspaceAction[] = newState[action.pubkey]

  if (action.type === 'reset'){
    newState[action.pubkey] = [] as CyberspaceAction[]
    return newState
  }

  console.log('check 1')

  const newActions = action.actions.map(validateCyberspaceAction).filter(Boolean)
  if (newActions.length === 0) {
    return state
  }

  console.log('check 2')

  if (action.type === 'unshift') {
    newState[action.pubkey] = [...newActions, ...avatarActions] as CyberspaceAction[]
  }
  if (action.type === 'push') {
    newState[action.pubkey] = [...avatarActions, ...newActions] as CyberspaceAction[]
  }

  newState[action.pubkey].sort((a, b) => {
    const aMs = a.tags.find(tag => tag[0] === 'ms')
    const bMs = b.tags.find(tag => tag[0] === 'ms')
    const aTs = a.created_at * 1000 + (aMs ? parseInt(aMs[1]) : 0)
    const bTs = b.created_at * 1000 + (bMs ? parseInt(bMs[1]) : 0)
    return aTs - bTs
  })

  newState[action.pubkey] = newState[action.pubkey].reduce((acc, currentAction) => {
    const existingAction = acc.find((action) => action.id === currentAction.id)

    if (!existingAction) {
      return [...acc, currentAction]
    }

    if (currentAction.sig && !existingAction.sig) {
      return [...acc.filter((action) => action.id !== currentAction.id), currentAction]
    }

    return acc
  }, [] as CyberspaceAction[])

  console.log('final newState', newState)

  return newState
}

export const useAvatarStore = create<AvatarStore>((set, get) => ({
  actionState: {},
  dispatchActionState: (action: AvatarActionDispatched) => set(state => ({
    actionState: avatarActionStateReducer(state.actionState, action)
  })),
  getSimulatedState: function(pubkey: string) {
    const actions = get().actionState[pubkey]
    if (actions && actions.length > 0) {
      const mostRecentAction = actions[actions.length - 1]
      const now = getTime()
      return simulateNextEvent(mostRecentAction, now)
    }
    return null
  },
  getGenesis: (pubkey: string) => get().actionState[pubkey]?.[0] ?? null,
  getLatest: (pubkey: string) => {
    const actions = get().actionState[pubkey]
    return actions ? actions[actions.length - 1] : null
  },
  getGenesisSectorId: (pubkey: string) => {
    const genesis = get().getGenesis(pubkey)
    return genesis ? genesis.tags.find(getTag('S'))?.[1] ?? null : null
  },
  getLatestSectorId: (pubkey: string) => {
    const latest = get().getLatest(pubkey)
    return latest ? latest.tags.find(getTag('S'))?.[1] ?? null : null
  },
  getSimulatedSectorId: (pubkey: string) => {
    const latest = get().getSimulatedState(pubkey)
    return latest ? latest.tags.find(getTag('S'))?.[1] ?? null : null
  },
}))