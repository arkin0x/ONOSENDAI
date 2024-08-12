import { create } from 'zustand'

type SectorStore = {
  currentSectorId: string
  updateSectorId: (id: string) => void
}

export const useSectorStore = create<SectorStore>((set) => ({
  currentSectorId: '',
  updateSectorId: (id) => {
    set({ currentSectorId: id })
  }
}))

