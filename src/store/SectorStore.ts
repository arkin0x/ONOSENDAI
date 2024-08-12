import { create } from 'zustand'

type SectorStore = {
  userCurrentSectorId: string
  updateUserCurrentSectorId: (id: string) => void
}

export const useSectorStore = create<SectorStore>((set) => ({
  userCurrentSectorId: '',
  updateUserCurrentSectorId: (id) => {
    set({ userCurrentSectorId: id })
  }
}))

