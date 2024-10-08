import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { Event, UnsignedEvent } from 'nostr-tools'
import { CyberspaceAction, CyberspaceVirtualActionTemplate, getMillisecondsTimestampFromAction, getTime, simulateNextEvent, Time, validateCyberspaceAction } from "../libraries/Cyberspace"
import { getTag } from '../libraries/NostrUtils'

/**
 * The CyberspaceAction[] array is a list of actions with the genesis action at index 0 and the latest action at the end.
 */
type AvatarActionState = {
  [pubkey: string]: CyberspaceAction[]
}

/**
 * Events or UnsignedEvents with an event id go in. They are validated and come out in state as CyberspaceActions. 
 * If you put an Event in it will replace its UnsignedEvent counterpart in state.
 */
export type AvatarActionDispatched = 
  | { type: 'unshift' | 'push'; 
      pubkey: string; 
      actions: (Event|UnsignedEvent)[] }
  | { type: 'reset'; 
      pubkey: string 
      actions?: (Event|UnsignedEvent)[] }

interface AvatarStore {
  userHistoryComplete: boolean
  actionState: AvatarActionState
  simulatedStates: { [pubkey: string]: { state: CyberspaceVirtualActionTemplate | null, timestamp: Time } }
  setUserHistoryComplete: (complete: boolean) => void
  dispatchActionState: (action: AvatarActionDispatched) => void
  getSimulatedState: (pubkey: string, skipCache?: boolean) => CyberspaceVirtualActionTemplate | null
  getGenesis: (pubkey: string) => CyberspaceAction | null
  getLatest: (pubkey: string) => CyberspaceAction | null
  getGenesisSectorId: (pubkey: string) => string | null
  getLatestSectorId: (pubkey: string) => string | null
  getSimulatedSectorId: (pubkey: string) => string | null
}

const avatarActionStateReducer = (state: AvatarActionState, data: AvatarActionDispatched): AvatarActionState => {
  const newState = {...state} as AvatarActionState

  // Initialize the action array for this pubkey if it doesn't exist
  if (newState[data.pubkey] === undefined) {
    newState[data.pubkey] = [] as CyberspaceAction[]
  }

  // Get all existing actions for this pubkey
  const avatarActions: CyberspaceAction[] = newState[data.pubkey]

  // Reset the action array for this pubkey
  if (data.type === 'reset'){
    newState[data.pubkey] = [] as CyberspaceAction[]
    if (!data.actions) {
      // If no actions are provided, return the new empty state. Otherwise, continue to add the new actions.
      return newState
    }
  }

  // Validate the new actions
  const newActions = data.actions!.map(validateCyberspaceAction).filter(Boolean)


  // Do nothing if the new actions failed validation
  if (newActions.length === 0) {
    return state
  }

  // Add the new actions to the existing actions
  if (data.type === 'unshift') {
    newState[data.pubkey] = [...newActions, ...avatarActions] as CyberspaceAction[]
  }
  if (data.type === 'push') {
    newState[data.pubkey] = [...avatarActions, ...newActions] as CyberspaceAction[]
  }

  // Sort all actions by millisecond timestamp
  newState[data.pubkey].sort((a, b) => {
    const aMs = getMillisecondsTimestampFromAction(a)
    const bMs = getMillisecondsTimestampFromAction(b)
    return aMs - bMs
  })

  // Remove duplicate actions and favor ones with a signature
  newState[data.pubkey] = newState[data.pubkey].reduce((acc, currentAction) => {
    const existingAction = acc.find((action) => action.id === currentAction.id)

    // no duplicate
    if (!existingAction) {
      return [...acc, currentAction]
    }

    // keep the action with the signature only
    if (currentAction.sig && !existingAction.sig) {
      return [...acc.filter((action) => action.id !== currentAction.id), currentAction]
    }

    // skip adding duplicate
    return acc
  }, [] as CyberspaceAction[])

  return newState
}

const SIMULATED_STATE_CACHE_TIME = 250 // ms

export const useAvatarStore = create<AvatarStore>()(
  persist(
    (set, get) => ({
      userHistoryComplete: false,
      actionState: {},
      simulatedStates: {},
      setUserHistoryComplete: (complete: boolean) => set({ userHistoryComplete: complete }),
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
      partialize: (state) => ({ actionState: state.actionState, userHistoryComplete: state.userHistoryComplete }),
    }
  )
)