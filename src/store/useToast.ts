/**
 * useToast.ts - one chip in the instrument stack for something that just
 * finished elsewhere, the way KEY FOUND announces a find: a cloud job done,
 * a place starred, BUILD mode ended by something other than EXIT
 * (store/useBuilder.ts), a WALK stopped short (store/useWalk.ts), or what a
 * /C/ link named (store/useCoordRoute.ts). One at a time; a new one replaces the last.
 */

import { create } from 'zustand'

export interface Toast {
  id: string
  label: string
  meta: string
  /** What stands as the chip's glyph: the cloud provider's mark, a yellow star, the Builder's wrench, WALK's footprints, or a pin for a /C/ link. */
  mark: 'hosaka' | 'star' | 'build' | 'walk' | 'place'
  /** How long it stays up once on screen; TOAST_MS when not given. */
  ms?: number
  /**
   * Stays until tapped, with no clock at all (arkinox, 2026-10-14: the
   * block a /C/ link named should not vanish before it is read).
   */
  sticky?: boolean
  at: number
}

interface ToastState {
  toast: Toast | null
  show: (toast: Omit<Toast, 'id' | 'at'>) => void
  dismiss: () => void
}

/** How long the chip stays up once it is on screen. */
export const TOAST_MS = 10_000

/** A brief one: long enough to read a sentence, short enough not to linger. */
export const BRIEF_TOAST_MS = 4_000

/** How long a toast stays once on screen, or null when it waits for a tap (sticky). */
export function toastClockMs(toast: Pick<Toast, 'ms' | 'sticky'>): number | null {
  return toast.sticky ? null : toast.ms ?? TOAST_MS
}

export const useToast = create<ToastState>((set) => ({
  toast: null,
  show: (toast) => {
    const now = Date.now()
    set({ toast: { ...toast, id: `${now}`, at: now } })
  },
  dismiss: () => set({ toast: null }),
}))
