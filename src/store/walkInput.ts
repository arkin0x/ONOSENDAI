/**
 * walkInput.ts: whether WALK's controls are open to input now, the one
 * check the keyboard, the pad and the hold loop all ask (review of #651).
 *
 * | Closed while | Why |
 * |---|---|
 * | not walking | nothing to walk |
 * | the menu covers the scene (a phone with the panels open) | the pad steps aside and the keys follow (arkinox, 2026-10-01) |
 * | a modal is up (hooks/useEscape.ts modalUp) | a press is meant for the modal |
 * | the workshop is open | the bench has its own keys (its Z is undo) |
 * | Cyberspace TV is on (added by hooks/useKeyboard.ts) | watching only |
 * | a text field has focus | typing, not walking |
 *
 * The hold loop (store/walkHold.ts) asks it every beat and lets go of
 * everything held once it closes, so a key or a pad key held as a modal or
 * the menu comes up never walks underneath it.
 */

import { modalUp } from '../hooks/useEscape'
import { useCyberspace } from './useCyberspace'
import { useWorkshop } from './useWorkshop'

/**
 * Closers that live where their store is imported anyway: Cyberspace TV's is
 * added by hooks/useKeyboard.ts, so the walk store never imports TV's (a
 * large graph with side effects of its own).
 */
const closers: Array<() => boolean> = []
/** Add a check that closes WALK's input while it is true. */
export function addWalkInputCloser(closed: () => boolean): void {
  closers.push(closed)
}

/** Whether the menu covers the scene. Set by App, through hooks/useKeyboard.ts setMenuCovering. */
let menuCovering = false
export function setWalkMenuCovering(covering: boolean): void {
  menuCovering = covering
}
export function walkMenuCovering(): boolean {
  return menuCovering
}

/** Whether a text field (an input, a textarea, anything editable) has focus. */
function typing(): boolean {
  if (typeof document === 'undefined') return false
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true
}

/** Whether WALK's controls take input now. */
export function walkInputOpen(): boolean {
  return useCyberspace.getState().walking && !menuCovering && !modalUp() && !useWorkshop.getState().open && !typing() && !closers.some((closed) => closed())
}
