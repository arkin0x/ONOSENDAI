/**
 * usePad.ts - whether the touch controls are out, and their truce with the chat.
 *
 * The controls used to be a useState in App. They live here now because the
 * chat dock has to reach them: on a phone the unfolded dock runs the full
 * width above the menu button, straight through the controls' column, and the
 * two fought over the same pixels (arkinox, 2026-10-07: "opening chat should
 * close controls so there isn't any fighting").
 */

import { create } from 'zustand'
import { setHoldFolded, useChat } from './useChat'

interface PadState {
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
}

export const usePad = create<PadState>((set, get) => ({
  open: true,
  setOpen: (open) => set({ open }),
  toggle: () => set({ open: !get().open }),
}))

/**
 * Where the unfolded chat dock covers the controls' column. It has to agree
 * with the `max-width: 640px` rule on `.chatdock` in styles.css; wider than
 * that the dock stops short of the column on both layouts.
 */
export const CHAT_COVERS_PAD = '(max-width: 640px)'

/**
 * Where the two overlap, whichever was opened last wins. Opening the chat
 * puts the controls away, and folding it brings them back only if they were
 * out when it opened, so you return to exactly where you were. Bringing the
 * controls back while the chat is open (the CONTROLS chip, or a tap on the
 * scene) folds the chat. A line that arrives while the controls are out
 * does not unfold the chat at all: it chimes and the chip shows the dot
 * (useChat's holdFolded). Where they do not overlap, neither touches the
 * other. Returns the unsubscribe.
 */
export function linkChatAndPad(overlap: () => boolean): () => void {
  // True while the chat is open and the controls were out when it opened.
  let restore = false
  setHoldFolded(() => overlap() && usePad.getState().open)
  const offChat = useChat.subscribe((s, prev) => {
    if (s.open === prev.open) return
    if (s.open) {
      if (!overlap()) return
      restore = usePad.getState().open
      if (restore) usePad.getState().setOpen(false)
    } else if (restore) {
      restore = false
      usePad.getState().setOpen(true)
    }
  })
  const offPad = usePad.subscribe((s, prev) => {
    if (!s.open || prev.open) return
    restore = false
    if (useChat.getState().open && overlap()) useChat.getState().setOpen(false)
  })
  return () => { offChat(); offPad(); setHoldFolded(() => false) }
}
