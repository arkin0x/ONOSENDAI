/**
 * modalStack.tsx: a modal opened from another modal comes back to it when
 * it closes (arkinox, 2026-11-14: "when I close the shard modal, I expect it
 * to take me back to the notifications modal").
 *
 * This is what a profile opened from an avatar's card already did: the card
 * stayed open under the profile, so closing the profile showed the card
 * again. Generalized, a stacked modal:
 *
 * - opens OVER whatever modal opened it, which stays open beneath it, its
 *   scroll and state untouched;
 * - is drawn at the end of the page (a portal to document.body), so the one
 *   opened last is on top without a z-index per pair;
 * - closes by ✕, a tap outside or Escape, all three the same, and the one
 *   beneath is simply there again. Escape takes the most recent first
 *   (useEscape), so it walks back down the stack one modal at a time.
 *
 * An action that leaves the modals for the world (fly to it, spectate,
 * place it, the chat line) closes the whole stack (leaveModals), so nothing
 * is left covering the scene it went to.
 */

import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useEscape } from '../hooks/useEscape'
import { useModalFocus } from '../store/useModalFocus'

/** The closers of the stacked modals that are open. */
const open = new Set<{ close: () => void }>()

/**
 * Register a stacked modal while `active`: on the Escape stack's modal layer,
 * and with leaveModals. Call it above any early return.
 */
export function useModalStack(active: boolean, close: () => void): void {
  useEscape('modal', active, close)
  const latest = useRef(close)
  latest.current = close
  useEffect(() => {
    if (!active) return
    const entry = { close: () => latest.current() }
    open.add(entry)
    // A landing VIEW asked for and this modal never drew (a muted comment,
    // a card with no reactions) goes with it, so no later card jumps to it.
    return () => { open.delete(entry); useModalFocus.getState().done() }
  }, [active])
}

/** Close every stacked modal: for an action that goes out into the world. */
export function leaveModals(): void {
  for (const entry of [...open]) entry.close()
}

/** How many stacked modals are open (tests). */
export function stackedOpen(): number {
  return open.size
}

/** Whether there is a real page to draw into: not a render to a string, nor a test's stand-in document. */
function hasPage(): boolean {
  return typeof document !== 'undefined' && typeof Node !== 'undefined' && document.body instanceof Node
}

/** Draw a stacked modal at the end of the page, over the modal that opened it. In place where there is no page. */
export function Stacked({ children }: { children: ReactNode }): JSX.Element {
  return hasPage() ? createPortal(children, document.body) : <>{children}</>
}
