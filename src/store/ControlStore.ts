import { create } from 'zustand'

type ControlState = {
  cruise: boolean
  forward: boolean
  forwardReleased: boolean
  reverse: boolean
  reverseReleased: boolean
  respawn: boolean
  freeze: boolean
  pitchUp: boolean
  pitchDown: boolean
  yawLeft: boolean
  yawRight: boolean
}

type ControlStore = {
  controlState: ControlState
  setControlState: (value: Partial<ControlState>) => void
  resetControlState: () => void
}

const initialControlState: ControlState = {
  cruise: false,
  forward: false,
  forwardReleased: false,
  reverse: false,
  reverseReleased: false,
  respawn: false,
  freeze: false,
  pitchUp: false,
  pitchDown: false,
  yawLeft: false,
  yawRight: false,
}

export const useControlStore = create<ControlStore>((set) => ({
  controlState: initialControlState,
  setControlState: (value) => set((state) => ({ controlState: { ...state.controlState, ...value } })),
  resetControlState: () => set({ controlState: initialControlState }),
}))