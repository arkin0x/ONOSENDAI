import { create } from 'zustand'

type ThrottleStore = {
  throttle: number
  setThrottle: (value: number) => void
}

export const useThrottleStore = create<ThrottleStore>((set) => ({
  throttle: 1,
  setThrottle: (value) => {
    // console.log('set throttle to', value)
    set({ throttle: value })
  }
}))

