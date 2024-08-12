import { create } from 'zustand'

type ControlState = {
  forward: boolean
  backward: boolean
  left: boolean
  right: boolean
  up: boolean
  down: boolean
  rollLeft: boolean
  rollLeftCompleted: boolean
  rollRight: boolean
  rollRightCompleted: boolean
  freeze: boolean
  respawn: boolean
  cruise: boolean
  resetView: boolean
}

type ControlStore = {
  controlState: ControlState
  setControlState: (value: Partial<ControlState>) => void
  resetControlState: () => void
}

const initialControlState: ControlState = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  up: false,
  down: false,
  rollLeft: false,
  rollRight: false,
  freeze: false,
  respawn: false,
  rollLeftCompleted: false,
  rollRightCompleted: false,
  cruise: false,
  resetView: false,
}

export const useControlStore = create<ControlStore>((set) => ({
  controlState: { ...initialControlState },
  setControlState: (value) => set((state) => ({ controlState: { ...state.controlState, ...value } })),
  resetControlState: () => set({ controlState: { ...initialControlState} }),
}))