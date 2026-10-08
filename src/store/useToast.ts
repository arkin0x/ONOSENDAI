/**
 * useToast.ts - one chip in the instrument stack for something that just
 * finished elsewhere, the way KEY FOUND announces a find: a cloud job done,
 * a place starred, or BUILD mode ended by something other than EXIT
 * (store/useBuilder.ts). One at a time; a new one replaces the last.
 */

import { create } from 'zustand'

export interface Toast {
  id: string
  label: string
  meta: string
  /** What stands as the chip's glyph: the cloud provider's mark, a yellow star, or the Builder's wrench. */
  mark: 'hosaka' | 'star' | 'build'
  /** How long it stays up once on screen; TOAST_MS when not given. */
  ms?: number
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

export const useToast = create<ToastState>((set) => ({
  toast: null,
  show: (toast) => {
    const now = Date.now()
    set({ toast: { ...toast, id: `${now}`, at: now } })
  },
  dismiss: () => set({ toast: null }),
}))
