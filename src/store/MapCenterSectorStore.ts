import { create } from 'zustand'

type MapCenterSectorStore = {
  centerSectorId: string | null
  setCenter: (id: string) => void
}

export const useMapCenterSectorStore = create<MapCenterSectorStore>((set) => ({
  centerSectorId: null,
  setCenter: (id) => {
    set({ centerSectorId: id })
  }
}))

