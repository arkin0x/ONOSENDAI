// RotationStore.ts
import { Quaternion } from 'three'
import { create } from 'zustand'

type RotationStore = {
  rotation: Quaternion,
  setRotation: (rotation: Quaternion) => void
}

export const useRotationStore = create<RotationStore>((set) => ({
  rotation: new Quaternion(),
  setRotation: (rotation: Quaternion) => set({ rotation }),
}))