import { create } from 'zustand'

type SectorStore = {
  sectorId: string
  updateSectorId: (id: string) => void
}

export const useSectorStore = create<SectorStore>((set) => ({
  sectorId: '',
  updateSectorId: (id) => {
    set({ sectorId: id })
  }
}))

