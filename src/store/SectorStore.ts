import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { Event } from 'nostr-tools'

export type SectorId = string;

export type ScanAreaBoundaries = {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  zMin: number;
  zMax: number;
};

export type ScanDirection = 'X-' | 'X+' | 'Y-' | 'Y+' | 'Z-' | 'Z+' | 0;

export type ScanArea = {
  anchorSectorId: SectorId;
  boundaries: ScanAreaBoundaries;
  sectors: Set<SectorId>;
  nextScanDirection: ScanDirection;
  partialScanSet: SectorId[];
};

export type SectorData = {
  avatars: string[];
  constructs: Event[];
  hyperjumps: Event[];
  isGenesis: boolean;
};

type SectorState = Record<SectorId, SectorData>;

type SectorStore = {
  userCurrentSectorId: SectorId | null;
  sectorState: SectorState;
  globalConstructs: Set<Event>;
  globalHyperjumps: Set<Event>;
  globalAvatars: Set<string>;
  scanAreas: ScanArea[];
  currentScanArea: ScanArea | null;
  updateUserCurrentSectorId: (id: SectorId) => void;
  mountSector: (sectorId: SectorId, isGenesis?: boolean) => void;
  unmountSector: (sectorId: SectorId) => void;
  addAvatar: (sectorId: SectorId, pubkey: string) => void;
  removeAvatar: (sectorId: SectorId, pubkey: string) => void;
  addConstruct: (sectorId: SectorId, event: Event) => void;
  addHyperjump: (sectorId: SectorId, event: Event) => void;
  getGlobalHyperjumps: () => Event[];
  getGlobalConstructs: () => Event[];
  getGlobalAvatars: () => string[];
  createScanArea: (anchorSectorId: SectorId) => void;
  getNextScanSet: () => SectorId[];
  updateScanArea: (scannedSectors: SectorId[]) => void;
  isPointInScanArea: (sectorId: SectorId, scanArea: ScanArea) => boolean;
};

const MAX_SCAN_SET_SIZE = 225;

export const useSectorStore = create<SectorStore>()(
  persist(
    (set, get) => ({
      userCurrentSectorId: null,
      sectorState: {},
      globalConstructs: new Set<Event>(),
      globalHyperjumps: new Set<Event>(),
      globalAvatars: new Set<string>(),
      scanAreas: [],
      currentScanArea: null,

      updateUserCurrentSectorId: (id) => {
        set({ userCurrentSectorId: id });
        const { scanAreas, createScanArea, isPointInScanArea } = get();
        const currentScanArea = scanAreas.find(area => isPointInScanArea(id, area));
        
        if (!currentScanArea) {
          if (scanAreas.length === 0 || !isPointInScanArea(id, scanAreas[scanAreas.length - 1])) {
            createScanArea(id);
          }
        } else {
          set({ currentScanArea });
        }
      },

      mountSector: (sectorId, isGenesis = false) => set((state) => {
        if (!state.sectorState[sectorId]) {
          return {
            sectorState: {
              ...state.sectorState,
              [sectorId]: { avatars: [], constructs: [], hyperjumps: [], isGenesis }
            } 
          }
        } else {
          return state
        }
      }),

      unmountSector: (sectorId) => set((state) => {
        const newState = { ...state.sectorState };
        delete newState[sectorId];
        return { sectorState: newState };
      }),

      addAvatar: (sectorId, pubkey) => set((state) => {
        const newGlobalAvatars = new Set(state.globalAvatars);
        newGlobalAvatars.add(pubkey);
        // Ensure the sectorId exists in sectorState
        if (!state.sectorState[sectorId]) {
          state.sectorState[sectorId] = { avatars: [], constructs: [], hyperjumps: [], isGenesis: false };
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
        };
      }),

      removeAvatar: (sectorId, pubkey) => set((state) => {
        const newGlobalAvatars = new Set(state.globalAvatars);
        newGlobalAvatars.delete(pubkey);
        return {
          sectorState: {
            ...state.sectorState,
            [sectorId]: {
              ...state.sectorState[sectorId],
              avatars: state.sectorState[sectorId].avatars.filter(avatar => avatar !== pubkey)
            }
          },
          globalAvatars: newGlobalAvatars
        };
      }),

      addConstruct: (sectorId, event) => set((state) => {
        const newGlobalConstructs = new Set(state.globalConstructs);
        newGlobalConstructs.add(event);
        // Ensure the sectorId exists in sectorState
        if (!state.sectorState[sectorId]) {
          state.sectorState[sectorId] = { avatars: [], constructs: [], hyperjumps: [], isGenesis: false };
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
        const newGlobalHyperjumps = new Set(state.globalHyperjumps);
        newGlobalHyperjumps.add(event);
        // Ensure the sectorId exists in sectorState
        if (!state.sectorState[sectorId]) {
          state.sectorState[sectorId] = { avatars: [], constructs: [], hyperjumps: [], isGenesis: false };
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

      getGlobalConstructs: () => Array.from(get().globalConstructs),
      getGlobalHyperjumps: () => Array.from(get().globalHyperjumps),
      getGlobalAvatars: () => Array.from(get().globalAvatars),

      createScanArea: (anchorSectorId) => set((state) => {
        const newScanArea: ScanArea = {
          anchorSectorId,
          boundaries: { xMin: 0, xMax: 0, yMin: 0, yMax: 0, zMin: 0, zMax: 0 },
          sectors: new Set([anchorSectorId]),
          nextScanDirection: 0,
          partialScanSet: []
        };
        return { 
          scanAreas: [...state.scanAreas, newScanArea],
          currentScanArea: newScanArea
        };
      }),

      getNextScanSet: () => {
        const state = get();
        if (!state.currentScanArea) return [];

        const { anchorSectorId, boundaries, nextScanDirection, partialScanSet } = state.currentScanArea;

        if (partialScanSet.length > 0) {
          const nextSet = partialScanSet.slice(0, MAX_SCAN_SET_SIZE);
          set(state => ({
            currentScanArea: {
              ...state.currentScanArea!,
              partialScanSet: state.currentScanArea!.partialScanSet.slice(MAX_SCAN_SET_SIZE)
            }
          }));
          return nextSet;
        }

        const [ax, ay, az] = anchorSectorId.split('-').map(Number);
        let nextSet: SectorId[] = [];

        if (nextScanDirection === 0) {
          nextSet = [anchorSectorId];
          const newDirection = ['X-', 'X+', 'Y-', 'Y+', 'Z-', 'Z+'][Math.floor(Math.random() * 6)] as ScanDirection;
          set(state => ({
            currentScanArea: {
              ...state.currentScanArea!,
              nextScanDirection: newDirection
            }
          }));
        } else {
          const { xMin, xMax, yMin, yMax, zMin, zMax } = boundaries;
          switch (nextScanDirection) {
            case 'X+':
              for (let y = yMin; y <= yMax; y++) {
                for (let z = zMin; z <= zMax; z++) {
                  nextSet.push(`${ax + xMax + 1}-${ay + y}-${az + z}`);
                }
              }
              break;
            case 'X-':
              for (let y = yMin; y <= yMax; y++) {
                for (let z = zMin; z <= zMax; z++) {
                  nextSet.push(`${ax + xMin - 1}-${ay + y}-${az + z}`);
                }
              }
              break;
            case 'Y+':
              for (let x = xMin; x <= xMax; x++) {
                for (let z = zMin; z <= zMax; z++) {
                  nextSet.push(`${ax + x}-${ay + yMax + 1}-${az + z}`);
                }
              }
              break;
            case 'Y-':
              for (let x = xMin; x <= xMax; x++) {
                for (let z = zMin; z <= zMax; z++) {
                  nextSet.push(`${ax + x}-${ay + yMin - 1}-${az + z}`);
                }
              }
              break;
            case 'Z+':
              for (let x = xMin; x <= xMax; x++) {
                for (let y = yMin; y <= yMax; y++) {
                  nextSet.push(`${ax + x}-${ay + y}-${az + zMax + 1}`);
                }
              }
              break;
            case 'Z-':
              for (let x = xMin; x <= xMax; x++) {
                for (let y = yMin; y <= yMax; y++) {
                  nextSet.push(`${ax + x}-${ay + y}-${az + zMin - 1}`);
                }
              }
              break;
          }
        }

        if (nextSet.length > MAX_SCAN_SET_SIZE) {
          set(state => ({
            currentScanArea: {
              ...state.currentScanArea!,
              partialScanSet: nextSet.slice(MAX_SCAN_SET_SIZE)
            }
          }));
          return nextSet.slice(0, MAX_SCAN_SET_SIZE);
        }

        return nextSet;
      },

      updateScanArea: (scannedSectors) => set((state) => {
        if (!state.currentScanArea) return state;

        const { anchorSectorId, boundaries, sectors, nextScanDirection } = state.currentScanArea;
        const [ax, ay, az] = anchorSectorId.split('-').map(Number);
        
        const newSectors = new Set([...sectors, ...scannedSectors]);
        let newBoundaries = { ...boundaries };

        scannedSectors.forEach(sectorId => {
          const [x, y, z] = sectorId.split('-').map(Number);
          const relX = x - ax, relY = y - ay, relZ = z - az;
          newBoundaries.xMin = Math.min(newBoundaries.xMin, relX);
          newBoundaries.xMax = Math.max(newBoundaries.xMax, relX);
          newBoundaries.yMin = Math.min(newBoundaries.yMin, relY);
          newBoundaries.yMax = Math.max(newBoundaries.yMax, relY);
          newBoundaries.zMin = Math.min(newBoundaries.zMin, relZ);
          newBoundaries.zMax = Math.max(newBoundaries.zMax, relZ);
        });

        let newNextScanDirection = nextScanDirection;
        if (state.currentScanArea.partialScanSet.length === 0) {
          newNextScanDirection = ['X-', 'X+', 'Y-', 'Y+', 'Z-', 'Z+'][Math.floor(Math.random() * 6)] as ScanDirection;
        }

        return {
          currentScanArea: {
            ...state.currentScanArea,
            boundaries: newBoundaries,
            sectors: newSectors,
            nextScanDirection: newNextScanDirection
          }
        };
      }),

      isPointInScanArea: (sectorId, scanArea) => {
        const [x, y, z] = sectorId.split('-').map(Number);
        const [ax, ay, az] = scanArea.anchorSectorId.split('-').map(Number);
        const { xMin, xMax, yMin, yMax, zMin, zMax } = scanArea.boundaries;
        
        return (
          x >= ax + xMin && x <= ax + xMax &&
          y >= ay + yMin && y <= ay + yMax &&
          z >= az + zMin && z <= az + zMax
        );
      },
    }),
    {
      name: 'sector-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ 
        sectorState: state.sectorState,
        globalConstructs: Array.from(state.globalConstructs),
        globalHyperjumps: Array.from(state.globalHyperjumps),
        globalAvatars: Array.from(state.globalAvatars),
        scanAreas: state.scanAreas,
        currentScanArea: state.currentScanArea,
      }),
      merge: (persistedState: any, currentState: SectorStore) => ({
        ...currentState,
        ...persistedState,
        globalConstructs: new Set(persistedState.globalConstructs || []),
        globalHyperjumps: new Set(persistedState.globalHyperjumps || []),
        globalAvatars: new Set(persistedState.globalAvatars || []),
        scanAreas: persistedState.scanAreas || [],
        currentScanArea: persistedState.currentScanArea || null,
      }),
    }
  )
);

export default useSectorStore;