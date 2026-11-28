/**
 * useFingerInput.ts: whether the player is on a touch screen with a finger
 * now, which decides whether WALK and TERRAIN show the stick
 * (hud/WalkStick.tsx) or WASD's key hints.
 *
 * | What happens | Fingers? |
 * |---|---|
 * | at load: a touch screen whose main pointer is a finger (`pointer: coarse`, a phone or a tablet) | yes |
 * | at load: anything else (a desktop, or a laptop with a touch screen as well as its trackpad) | no |
 * | a finger touches the page | yes, from then on |
 * | a mouse moves or presses, or a movement key (W, A, S, D, the arrows) goes down | no, until the next touch |
 *
 * So a phone always has the stick, a desktop never does (WASD walks, and
 * the stick's spot prints the keys), and a laptop with a touch screen, or a
 * tablet with a keyboard, follows whatever was used last. Watched on the
 * window in the capture phase, before anything else handles the event.
 */

import { useSyncExternalStore } from 'react'

/** The main pointer is a finger (a phone, a tablet). */
function coarsePrimary(): boolean {
  try { return typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches } catch { return false }
}

const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

let finger: boolean | null = null
const listeners = new Set<() => void>()
let attached = false

function set(next: boolean): void {
  if (finger === next) return
  finger = next
  for (const l of listeners) l()
}

/** What the last input says, from what a pointer or key event is. Exported for the tests. */
export function noteInput(e: { pointerType?: string; code?: string; type: string }): void {
  if (e.type === 'keydown') { if (e.code && MOVE_KEYS.has(e.code)) set(false); return }
  if (e.pointerType === 'touch') set(true)
  else if (e.pointerType === 'mouse') set(false)
}

function attach(): void {
  if (attached || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
  attached = true
  const opts = { capture: true, passive: true }
  window.addEventListener('pointerdown', noteInput, opts)
  window.addEventListener('pointermove', noteInput, opts)
  window.addEventListener('keydown', noteInput, opts)
}

/** Whether fingers drive the page now (see the table above). */
export function fingerInput(): boolean {
  if (finger === null) finger = coarsePrimary()
  return finger
}

/** Set by hand (tests, the layout script). */
export function setFingerInput(on: boolean): void { set(on) }

/** fingerInput, re-rendered whenever it changes. */
export function useFingerInput(): boolean {
  return useSyncExternalStore(
    (l) => { attach(); listeners.add(l); return () => { listeners.delete(l) } },
    fingerInput,
    fingerInput,
  )
}
