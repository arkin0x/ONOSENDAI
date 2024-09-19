import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { Event } from 'nostr-tools'
import { CyberspaceAction, CyberspaceVirtualActionTemplate, getTime, simulateNextEvent, Time, validateCyberspaceAction } from "../libraries/Cyberspace"
import { getTag } from '../libraries/NostrUtils'

type AvatarActionState = {
  [pubkey: string]: CyberspaceAction[]
}

export type AvatarActionDispatched = 
  | { type: 'unshift' | 'push'; pubkey: string; actions: Event[] }
  | { type: 'reset'; pubkey: string }

interface AvatarStore {
  actionState: AvatarActionState
  simulatedStates: { [pubkey: string]: { state: CyberspaceVirtualActionTemplate | null, timestamp: Time } }
  dispatchActionState: (action: AvatarActionDispatched) => void
  getSimulatedState: (pubkey: string, skipCache?: boolean) => CyberspaceVirtualActionTemplate | null
  getGenesis: (pubkey: string) => CyberspaceAction | null
  getLatest: (pubkey: string) => CyberspaceAction | null
  getGenesisSectorId: (pubkey: string) => string | null
  getLatestSectorId: (pubkey: string) => string | null
  getSimulatedSectorId: (pubkey: string) => string | null
}

const avatarActionStateReducer = (state: AvatarActionState, action: AvatarActionDispatched): AvatarActionState => {
  const newState = {...state} as AvatarActionState

  if (newState[action.pubkey] === undefined) {
    newState[action.pubkey] = [] as CyberspaceAction[]
  }

  const avatarActions: CyberspaceAction[] = newState[action.pubkey]

  if (action.type === 'reset'){
    newState[action.pubkey] = [] as CyberspaceAction[]
    return newState
  }

  const newActions = action.actions.map(validateCyberspaceAction).filter(Boolean)
  if (newActions.length === 0) {
    return state
  }

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

  return newState
}

const SIMULATED_STATE_CACHE_TIME = 250 // ms

export const useAvatarStore = create<AvatarStore>()(
  persist(
    (set, get) => ({
      actionState: {},
      simulatedStates: {},
      dispatchActionState: (action: AvatarActionDispatched) => set(state => {
        const newActionState = avatarActionStateReducer(state.actionState, action)
        return {
          actionState: newActionState,
          simulatedStates: {} // Clear cached simulated states when action state changes
        }
      }),
      getSimulatedState: (pubkey: string, skipCache: boolean = false) => {
        const now = getTime()
        const cachedState = get().simulatedStates[pubkey]
        if (skipCache === false) {
          if (cachedState && now.ms_timestamp - cachedState.timestamp.ms_timestamp < SIMULATED_STATE_CACHE_TIME) {
            return cachedState.state
          }
        }
        const actions = get().actionState[pubkey]
        if (actions && actions.length > 0) {
          const mostRecentAction = actions[actions.length - 1]
          const simulatedState = simulateNextEvent(mostRecentAction, now)
          if (skipCache === true) {
            if (cachedState && now.ms_timestamp - cachedState.timestamp.ms_timestamp < SIMULATED_STATE_CACHE_TIME) {
              set(state => ({
                simulatedStates: {
                  ...state.simulatedStates,
                  [pubkey]: { state: simulatedState, timestamp: now }
                }
              }))
            }
          }
          return simulatedState
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
    }),
    {
      name: 'avatar-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ actionState: state.actionState }),
    }
  )
)