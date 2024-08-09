import { create } from 'zustand'

type ZoomStore = {
  zoom: number
  ZOOM_MAX: number
  setZoom: (value: number) => void
}

const ZOOM_MAX = 32

export const useZoomStore = create<ZoomStore>((set) => ({
  zoom: 16,
  ZOOM_MAX,
  setZoom: (value) => {
    console.log("Setting zoom to", value)
    set({ zoom: value })
  }
}))

