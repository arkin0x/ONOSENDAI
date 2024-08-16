import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { Event } from 'nostr-tools'

export type SectorData = {
  avatars: string[]
  constructs: Event[]
  hyperjumps: Event[]
  isScanned: boolean
  isGenesis: boolean
}

export type SectorState = Record<string, SectorData>

type SectorStore = {
  userCurrentSectorId: string
  sectorState: SectorState
  updateUserCurrentSectorId: (id: string) => void
  mountSector: (sectorId: string, isGenesis?: boolean) => void
  unmountSector: (sectorId: string) => void
  addAvatar: (sectorId: string, pubkey: string) => void
  removeAvatar: (sectorId: string, pubkey: string) => void
  addConstruct: (sectorId: string, event: Event) => void
  addHyperjump: (sectorId: string, event: Event) => void
  scanSector: (sectorId: string) => void
}

export const useSectorStore = create<SectorStore>()(
  persist(
    (set) => ({
      userCurrentSectorId: '',
      sectorState: {},
      updateUserCurrentSectorId: (id) => set({ userCurrentSectorId: id }),
      mountSector: (sectorId, isGenesis = false) => set((state) => ({
        sectorState: {
          ...state.sectorState,
          [sectorId]: { avatars: [], constructs: [], hyperjumps: [], isScanned: false, isGenesis }
        }
      })),
      unmountSector: (sectorId) => set((state) => {
        const newState = { ...state.sectorState }
        delete newState[sectorId]
        return { sectorState: newState }
      }),
      addAvatar: (sectorId, pubkey) => set((state) => ({
        sectorState: {
          ...state.sectorState,
          [sectorId]: {
            ...state.sectorState[sectorId],
            avatars: [...new Set([...state.sectorState[sectorId].avatars, pubkey])]
          }
        }
      })),
      removeAvatar: (sectorId, pubkey) => set((state) => ({
        sectorState: {
          ...state.sectorState,
          [sectorId]: {
            ...state.sectorState[sectorId],
            avatars: state.sectorState[sectorId].avatars.filter(avatar => avatar !== pubkey)
          }
        }
      })),
      addConstruct: (sectorId, event) => set((state) => ({
        sectorState: {
          ...state.sectorState,
          [sectorId]: {
            ...state.sectorState[sectorId],
            constructs: [...new Set([...state.sectorState[sectorId].constructs, event])]
          }
        }
      })),
      addHyperjump: (sectorId, event) => set((state) => ({
        sectorState: {
          ...state.sectorState,
          [sectorId]: {
            ...state.sectorState[sectorId],
            hyperjumps: [...new Set([...state.sectorState[sectorId].hyperjumps, event])]
          }
        }
      })),
      scanSector: (sectorId) => set((state) => ({
        sectorState: {
          ...state.sectorState,
          [sectorId]: {
            ...state.sectorState[sectorId],
            isScanned: true
          }
        }
      }))
    }),
    {
      name: 'sector-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ sectorState: state.sectorState }),
    }
  )
)