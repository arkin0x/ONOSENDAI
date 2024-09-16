import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { UIState } from '../types/UI'

interface UIStore {
  uiState: UIState
  setUIState: (state: UIState) => void
}

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      uiState: UIState.cyberspace,
      setUIState: (state) => set({ uiState: state }),
    }),
    {
      name: 'ui-storage',
    }
  )
)