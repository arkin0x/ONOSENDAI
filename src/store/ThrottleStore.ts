import create from 'zustand'

type ThrottleStore = {
  throttle: number
  setThrottle: (value: number) => void
}

export const useThrottleStore = create<ThrottleStore>((set) => ({
  throttle: 5,
  setThrottle: (value) => set({ throttle: value }),
}))

