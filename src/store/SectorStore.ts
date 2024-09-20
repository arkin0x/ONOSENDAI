import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { Event } from 'nostr-tools'

// sectorid -> sector data
export type SectorState = Record<string, SectorData>

export type SectorData = {
  avatars: string[]
  constructs: Event[]
  hyperjumps: Event[]
  isGenesis: boolean
}

type SectorStore = {
  userCurrentSectorId: string | null
  sectorState: SectorState
  globalHyperjumps: Set<Event>
  globalConstructs: Set<Event>
  globalAvatars: Set<string>
  updateUserCurrentSectorId: (id: string) => void
  mountSector: (sectorId: string, isGenesis?: boolean) => void
  unmountSector: (sectorId: string) => void
  addAvatar: (sectorId: string, pubkey: string) => void
  removeAvatar: (sectorId: string, pubkey: string) => void
  addConstruct: (sectorId: string, event: Event) => void
  addHyperjump: (sectorId: string, event: Event) => void
  getGlobalHyperjumps: () => Event[]
  getGlobalConstructs: () => Event[]
  getGlobalAvatars: () => string[]
}

export const useSectorStore = create<SectorStore>()(
  persist(
    (set, get) => ({
      userCurrentSectorId: null,
      sectorState: {},
      globalHyperjumps: new Set<Event>(),
      globalConstructs: new Set<Event>(),
      globalAvatars: new Set<string>(),
      updateUserCurrentSectorId: (id) => set({ userCurrentSectorId: id }),
      mountSector: (sectorId, isGenesis = false) => set((state) => ({
        sectorState: {
          ...state.sectorState,
          [sectorId]: { avatars: [], constructs: [], hyperjumps: [], isGenesis }
        }
      })),
      unmountSector: (sectorId) => set((state) => {
        const newState = { ...state.sectorState }
        delete newState[sectorId]
        return { sectorState: newState }
      }),
      addAvatar: (sectorId, pubkey) => set((state) => {
        const newGlobalAvatars = new Set(state.globalAvatars)
        newGlobalAvatars.add(pubkey)
        return {
          sectorState: {
            ...state.sectorState,
            [sectorId]: {
              ...state.sectorState[sectorId],
              avatars: [...new Set([...state.sectorState[sectorId].avatars, pubkey])]
            }
          },
          globalAvatars: newGlobalAvatars
        }
      }),
      removeAvatar: (sectorId, pubkey) => set((state) => {
        const newGlobalAvatars = new Set(state.globalAvatars)
        newGlobalAvatars.delete(pubkey)
        return {
          sectorState: {
            ...state.sectorState,
            [sectorId]: {
              ...state.sectorState[sectorId],
              avatars: state.sectorState[sectorId].avatars.filter(avatar => avatar !== pubkey)
            }
          },
          globalAvatars: newGlobalAvatars
        }
      }),
      addConstruct: (sectorId, event) => set((state) => {
        const newGlobalConstructs = new Set(state.globalConstructs)
        newGlobalConstructs.add(event)
        return {
          sectorState: {
            ...state.sectorState,
            [sectorId]: {
              ...state.sectorState[sectorId],
              constructs: [...new Set([...state.sectorState[sectorId].constructs, event])]
            }
          },
          globalConstructs: newGlobalConstructs
        }
      }),
      addHyperjump: (sectorId, event) => set((state) => {
        const currentHyperjumps = state.sectorState[sectorId]?.hyperjumps || [];
        const hyperjumpExists = currentHyperjumps.some(hyperjump => hyperjump.id === event.id);
        
        if (!hyperjumpExists) {
          const newGlobalHyperjumps = new Set(state.globalHyperjumps)
          newGlobalHyperjumps.add(event)
          return {
            sectorState: {
              ...state.sectorState,
              [sectorId]: {
                ...state.sectorState[sectorId],
                hyperjumps: [...currentHyperjumps, event]
              }
            },
            globalHyperjumps: newGlobalHyperjumps
          };
        }
        return state
      }),
      getGlobalHyperjumps: () => Array.from(get().globalHyperjumps),
      getGlobalConstructs: () => Array.from(get().globalConstructs),
      getGlobalAvatars: () => Array.from(get().globalAvatars),
    }),
    {
      name: 'sector-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ 
        sectorState: state.sectorState,
        globalHyperjumps: Array.from(state.globalHyperjumps),
        globalConstructs: Array.from(state.globalConstructs),
        globalAvatars: Array.from(state.globalAvatars),
      }),
      merge: (persistedState: any, currentState: SectorStore) => ({
        ...currentState,
        ...persistedState,
        globalHyperjumps: new Set(persistedState.globalHyperjumps || []),
        globalConstructs: new Set(persistedState.globalConstructs || []),
        globalAvatars: new Set(persistedState.globalAvatars || []),
      }),
    }
  )
)