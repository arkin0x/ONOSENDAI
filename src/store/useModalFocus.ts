/**
 * useModalFocus: where a modal opened by VIEW should land (arkinox,
 * 2026-11-14: "when I click view item it takes me to the shard modal at the
 * top, and I have to scroll down to the reactions/comment section to see the
 * comment").
 *
 * The opener says where (a comment by id, or the reactions) before it opens
 * the modal; the comment row or the reactions section, once it is drawn,
 * scrolls itself into view and glows for a moment (useLandOn). Comments and
 * reactions arrive from the relays after the modal is up, so the landing
 * waits for them, but not forever: one older than LAND_WAIT_MS is dropped,
 * so a later modal never jumps to a stale target.
 */

import { useEffect, useRef, useState, type RefObject } from 'react'
import { create } from 'zustand'
import type { LandOn } from '../lib/notifications'

/** How long a landing waits for its comment or reactions to be drawn. */
export const LAND_WAIT_MS = 12_000
/** How long the landed-on thing glows. */
export const LAND_GLOW_MS = 4000
/**
 * Scrolled again after these delays: what loads above it (reactions above
 * comments, a profile's about above both) moves it down as it arrives.
 */
const RESCROLL_MS = [350, 1200]

interface ModalFocus {
  target: LandOn | null
  /** When it was asked for (Date.now()). */
  at: number
  land: (target: LandOn | null) => void
  /** The landing happened, or will not: clear it. */
  done: () => void
}

export const useModalFocus = create<ModalFocus>((set) => ({
  target: null,
  at: 0,
  land: (target) => set({ target, at: Date.now() }),
  done: () => set({ target: null }),
}))

/** Whether `target` asks for this comment or for the reactions, and is still fresh at `now`. */
export function landsHere(state: Pick<ModalFocus, 'target' | 'at'>, want: { comment: string } | 'reactions', now: number): boolean {
  const t = state.target
  if (!t || now - state.at > LAND_WAIT_MS) return false
  return want === 'reactions' ? 'reactions' in t : 'comment' in t && t.comment === want.comment
}

/**
 * Land on this element when the focus asks for it and it is `ready` (drawn
 * with what it shows): scroll it to the middle of its modal and glow. The
 * returned flag is true while it glows.
 */
export function useLandOn<T extends HTMLElement>(want: { comment: string } | 'reactions', ready = true): { ref: RefObject<T>; lit: boolean } {
  const ref = useRef<T>(null)
  const key = want === 'reactions' ? 'reactions' : want.comment
  const asked = useModalFocus((s) => landsHere(s, want, Date.now()))
  const [lit, setLit] = useState(false)
  // Kept past the re-render that clearing the focus causes; cleared only when this unmounts.
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => { for (const t of timers.current) clearTimeout(t) }, [])
  useEffect(() => {
    if (!asked || !ready) return
    useModalFocus.getState().done()
    const scroll = (): void => ref.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    scroll()
    setLit(true)
    timers.current.push(...RESCROLL_MS.map((ms) => setTimeout(scroll, ms)), setTimeout(() => setLit(false), LAND_GLOW_MS))
  }, [asked, ready, key])
  return { ref, lit }
}
