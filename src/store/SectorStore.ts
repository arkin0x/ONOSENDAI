/* eslint-disable @typescript-eslint/no-explicit-any */
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { Event } from 'nostr-tools'
import Decimal from 'decimal.js'

export type SectorId = string

export type ScanAreaBoundaries = {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
  zMin: number
  zMax: number
}

export type ScanDirection = 'X-' | 'X+' | 'Y-' | 'Y+' | 'Z-' | 'Z+' | 0

export type ScanArea = {
  anchorSectorId: SectorId
  boundaries: ScanAreaBoundaries
  nextScanDirection: ScanDirection
  partialScanSet: SectorId[]
}

export type SectorData = {
  avatars: string[]
  constructs: Event[]
  hyperjumps: Event[]
  shards: Event[]
  isGenesis: boolean
}

export type SectorState = Record<SectorId, SectorData>

type SectorStore = {
  userCurrentSectorId: SectorId | null
  sectorState: SectorState
  globalAvatars: Set<string>
  globalConstructs: Set<Event>
  globalHyperjumps: Set<Event>
  globalShards: Set<Event>
  scanAreas: ScanArea[]
  currentScanAreaIndex: number
  updateUserCurrentSectorId: (id: SectorId) => void
  mountSector: (sectorId: SectorId, isGenesis?: boolean) => void
  unmountSector: (sectorId: SectorId) => void
  addAvatar: (sectorId: SectorId, pubkey: string) => void
  removeAvatar: (sectorId: SectorId, pubkey: string) => void
  addShard: (sectorId: SectorId, event: Event) => void
  addConstruct: (sectorId: SectorId, event: Event) => void
  addHyperjump: (sectorId: SectorId, event: Event) => void
  getGlobalAvatars: () => string[]
  getGlobalConstructs: () => Event[]
  getGlobalHyperjumps: () => Event[]
  getGlobalShards: () => Event[]
  createScanArea: (anchorSectorId: SectorId) => void
  getNextScanSet: () => SectorId[]
  updateScanArea: (scannedSectors: SectorId[]) => void
  isPointInScanArea: (sectorId: SectorId, scanAreaIndex: number) => boolean
  getCurrentScanArea: () => ScanArea | null
}

const MAX_SCAN_SET_SIZE = 225

export const useSectorStore = create<SectorStore>()(
  persist(
    (set, get) => ({
      userCurrentSectorId: null,
      sectorState: {},
      globalAvatars: new Set<string>(),
      globalConstructs: new Set<Event>(),
      globalHyperjumps: new Set<Event>(),
      globalShards: new Set<Event>(),
      scanAreas: [],
      currentScanAreaIndex: -1,

      updateUserCurrentSectorId: (id) => {
        set({ userCurrentSectorId: id })
        const { scanAreas, createScanArea, isPointInScanArea } = get()
        const currentScanAreaIndex = scanAreas.findIndex(area => isPointInScanArea(id, scanAreas.indexOf(area)))
        
        if (currentScanAreaIndex === -1) {
          if (scanAreas.length === 0 || !isPointInScanArea(id, scanAreas.length - 1)) {
            createScanArea(id)
          }
        } else {
          set({ currentScanAreaIndex })
        }
      },

      mountSector: (sectorId, isGenesis = false) => set((state) => {
        if (!state.sectorState[sectorId]) {
          return {
            sectorState: {
              ...state.sectorState,
              [sectorId]: { avatars: [], constructs: [], hyperjumps: [], shards: [], isGenesis }
            } 
          }
        } else {
          return state
        }
      }),

      unmountSector: (sectorId) => set((state) => {
        const newState = { ...state.sectorState }
        delete newState[sectorId]
        return { sectorState: newState }
      }),

      addAvatar: (sectorId, pubkey) => set((state) => {
        const newGlobalAvatars = new Set(state.globalAvatars)
        newGlobalAvatars.add(pubkey)
        // Ensure the sectorId exists in sectorState
        if (!state.sectorState[sectorId]) {
          state.sectorState[sectorId] = { avatars: [], constructs: [], hyperjumps: [], shards: [], isGenesis: false }

        }
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

      addShard: (sectorId, event) => set((state) => {
        const newGlobalShards = new Set(state.globalShards)
        newGlobalShards.add(event)
        // Ensure the sectorId exists in sectorState
        if (!state.sectorState[sectorId]) {
          state.sectorState[sectorId] = { avatars: [], constructs: [], hyperjumps: [], shards: [], isGenesis: false }
        }
        
        return {
          sectorState: {
            ...state.sectorState,
            [sectorId]: {
              ...state.sectorState[sectorId],
              shards: [...new Set([...state.sectorState[sectorId].shards, event])]
            }
          },
          globalShards: newGlobalShards
        }
      }),

      addConstruct: (sectorId, event) => set((state) => {
        const newGlobalConstructs = new Set(state.globalConstructs)
        newGlobalConstructs.add(event)
        // Ensure the sectorId exists in sectorState
        if (!state.sectorState[sectorId]) {
          state.sectorState[sectorId] = { avatars: [], constructs: [], hyperjumps: [], shards: [], isGenesis: false }
        }
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
        const newGlobalHyperjumps = new Set(state.globalHyperjumps)
        newGlobalHyperjumps.add(event)
        // Ensure the sectorId exists in sectorState
        if (!state.sectorState[sectorId]) {
          state.sectorState[sectorId] = { avatars: [], constructs: [], hyperjumps: [], shards: [], isGenesis: false }
        }
        
        return {
          sectorState: {
            ...state.sectorState,
            [sectorId]: {
              ...state.sectorState[sectorId],
              hyperjumps: [...new Set([...state.sectorState[sectorId].hyperjumps, event])]
            }
          },
          globalHyperjumps: newGlobalHyperjumps
        }
      }),

      getGlobalAvatars: () => Array.from(get().globalAvatars),
      getGlobalConstructs: () => Array.from(get().globalConstructs),
      getGlobalHyperjumps: () => Array.from(get().globalHyperjumps),
      getGlobalShards: () => Array.from(get().globalShards),


      createScanArea: (anchorSectorId) => set((state) => {
        const newScanArea: ScanArea = {
          anchorSectorId,
          boundaries: { xMin: 0, xMax: 0, yMin: 0, yMax: 0, zMin: 0, zMax: 0 },
          nextScanDirection: 0,
          partialScanSet: []
        }
        return { 
          scanAreas: [...state.scanAreas, newScanArea],
          currentScanAreaIndex: state.scanAreas.length
        }
      }),

      getNextScanSet: () => {
        const state = get()
        const currentScanArea = state.scanAreas[state.currentScanAreaIndex]
        if (!currentScanArea) return []

        const { anchorSectorId, boundaries, nextScanDirection, partialScanSet } = currentScanArea

        if (partialScanSet.length > 0) {
          const nextSet = partialScanSet.slice(0, MAX_SCAN_SET_SIZE)
          set(state => ({
            scanAreas: state.scanAreas.map((area, index) => 
              index === state.currentScanAreaIndex
                ? { ...area, partialScanSet: area.partialScanSet.slice(MAX_SCAN_SET_SIZE) }
                : area
            )
          }))
          return nextSet
        }

        const [ax, ay, az] = anchorSectorId.split('-').map( x => new Decimal(x))
        let nextSet: SectorId[] = []

        if (nextScanDirection === 0) {
          nextSet = [anchorSectorId]
          const newDirection = ['X-', 'X+', 'Y-', 'Y+', 'Z-', 'Z+'][Math.floor(Math.random() * 6)] as ScanDirection
          set(state => ({
            scanAreas: state.scanAreas.map((area, index) => 
              index === state.currentScanAreaIndex
                ? { ...area, nextScanDirection: newDirection }
                : area
            )
          }))
        } else {
          const { xMin, xMax, yMin, yMax, zMin, zMax } = boundaries
          switch (nextScanDirection) {
            case 'X+':
              for (let y = yMin; y <= yMax; y++) {
                for (let z = zMin; z <= zMax; z++) {
                  nextSet.push(`${ax.add(xMax+1)}-${ay.add(y)}-${az.add(z)}`)
                }
              }
              break
            case 'X-':
              for (let y = yMin; y <= yMax; y++) {
                for (let z = zMin; z <= zMax; z++) {
                  nextSet.push(`${ax.add(xMin-1)}-${ay.add(y)}-${az.add(z)}`)
                }
              }
              break
            case 'Y+':
              for (let x = xMin; x <= xMax; x++) {
                for (let z = zMin; z <= zMax; z++) {
                  nextSet.push(`${ax.add(x)}-${ay.add(yMax+1)}-${az.add(z)}`)
                }
              }
              break
            case 'Y-':
              for (let x = xMin; x <= xMax; x++) {
                for (let z = zMin; z <= zMax; z++) {
                  nextSet.push(`${ax.add(x)}-${ay.add(yMin-1)}-${az.add(z)}`)
                }
              }
              break
            case 'Z+':
              for (let x = xMin; x <= xMax; x++) {
                for (let y = yMin; y <= yMax; y++) {
                  nextSet.push(`${ax.add(x)}-${ay.add(y)}-${az.add(zMax+1)}`)
                }
              }
              break
            case 'Z-':
              for (let x = xMin; x <= xMax; x++) {
                for (let y = yMin; y <= yMax; y++) {
                  nextSet.push(`${ax.add(x)}-${ay.add(y)}-${az.add(zMin-1)}`)
                }
              }
              break
          }
        }

        if (nextSet.length > MAX_SCAN_SET_SIZE) {
          set(state => ({
            scanAreas: state.scanAreas.map((area, index) => 
              index === state.currentScanAreaIndex
                ? { ...area, partialScanSet: nextSet.slice(MAX_SCAN_SET_SIZE) }
                : area
            )
          }))
          return nextSet.slice(0, MAX_SCAN_SET_SIZE)
        }

        return nextSet
      },

      updateScanArea: (scannedSectors) => set((state) => {
        if (state.currentScanAreaIndex === -1) return state

        const currentScanArea = state.scanAreas[state.currentScanAreaIndex]
        const { anchorSectorId, boundaries, nextScanDirection } = currentScanArea
        const [ax, ay, az] = anchorSectorId.split('-').map(x => new Decimal(x))
        
        const newBoundaries = { ...boundaries }

        scannedSectors.forEach(sectorId => {
          const [x, y, z] = sectorId.split('-').map(x => new Decimal(x))
          const relX = x.sub(ax), relY = y.sub(ay), relZ = z.sub(az)
          newBoundaries.xMin = Math.min(newBoundaries.xMin, relX.toNumber())
          newBoundaries.xMax = Math.max(newBoundaries.xMax, relX.toNumber())
          newBoundaries.yMin = Math.min(newBoundaries.yMin, relY.toNumber())
          newBoundaries.yMax = Math.max(newBoundaries.yMax, relY.toNumber())
          newBoundaries.zMin = Math.min(newBoundaries.zMin, relZ.toNumber())
          newBoundaries.zMax = Math.max(newBoundaries.zMax, relZ.toNumber())
        })

        let newNextScanDirection = nextScanDirection
        if (currentScanArea.partialScanSet.length === 0) {
          newNextScanDirection = ['X-', 'X+', 'Y-', 'Y+', 'Z-', 'Z+'][Math.floor(Math.random() * 6)] as ScanDirection
        }

        return {
          scanAreas: state.scanAreas.map((area, index) => 
            index === state.currentScanAreaIndex
              ? {
                  ...area,
                  boundaries: newBoundaries,
                  nextScanDirection: newNextScanDirection
                }
              : area
          )
        }
      }),

      isPointInScanArea: (sectorId, scanAreaIndex) => {
        const state = get()
        if (scanAreaIndex < 0 || scanAreaIndex >= state.scanAreas.length) return false

        const scanArea = state.scanAreas[scanAreaIndex]
        const [x, y, z] = sectorId.split('-').map(x => new Decimal(x))
        const [ax, ay, az] = scanArea.anchorSectorId.split('-').map(x => new Decimal(x))
        const { xMin, xMax, yMin, yMax, zMin, zMax } = scanArea.boundaries

        return (
          x.gte(ax.add(xMin)) && x.lte(ax.add(xMax)) &&
          y.gte(ay.add(yMin)) && y.lte(ay.add(yMax)) &&
          z.gte(az.add(zMin)) && z.lte(az.add(zMax))
        )
      },

      getCurrentScanArea: () => {
        const state = get()
        return state.currentScanAreaIndex !== -1 ? state.scanAreas[state.currentScanAreaIndex] : null
      },
    }),
    {
      name: 'sector-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ 
        sectorState: state.sectorState,
        globalAvatars: Array.from(state.globalAvatars),
        globalConstructs: Array.from(state.globalConstructs),
        globalHyperjumps: Array.from(state.globalHyperjumps),
        globalShards: Array.from(state.globalShards),
        scanAreas: state.scanAreas.map(area => ({
          ...area,
        })),
        currentScanAreaIndex: state.currentScanAreaIndex,
      }),
      merge: (persistedState: any, currentState: SectorStore) => ({
        ...currentState,
        ...persistedState,
        sectorState: persistedState.sectorState || {},
        globalAvatars: new Set(persistedState.globalAvatars || []),
        globalConstructs: new Set(persistedState.globalConstructs || []),
        globalHyperjumps: new Set(persistedState.globalHyperjumps || []),
        globalShards: new Set(persistedState.globalShards || []),
        scanAreas: (persistedState.scanAreas || []).map((area: any) => ({
          ...area,
          sectors: new Set(area.sectors)
        })),
        currentScanAreaIndex: persistedState.currentScanAreaIndex ?? -1,
      }),
    }
  )
)

export default useSectorStore