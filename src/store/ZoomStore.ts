import { create } from 'zustand'

type ZoomStore = {
  zoom: number
  setZoom: (value: number) => void
}

export const useZoomStore = create<ZoomStore>((set) => ({
  zoom: 16,
  setZoom: (value) => {
    console.log("Setting zoom to", value)
    set({ zoom: value })
  }
}))

