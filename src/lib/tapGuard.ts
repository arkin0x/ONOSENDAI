/**
 * tapGuard.ts: a tap on a modal's backdrop closes the modal and does
 * nothing else (arkinox, 2026-10-11: "tapping outside of a modal not only
 * closes it but also clicks whatever was tapped").
 *
 * Every backdrop closes on pointerdown, so by the time the finger lifts the
 * modal is gone, and the pointerup and the click land on whatever was under
 * it: a HUD button, a panel row, the scene. One guard for all of them,
 * installed once at startup: a pointerdown that starts on a backdrop itself
 * (an element with the class `modal`, or the bench's `benchpaste__away`)
 * arms a swallow of that pointer's pointerup and the click that follows, in
 * the capture phase on the window, before React or the scene see them.
 * The swallow ends at the first click, or after SWALLOW_MS, whichever comes
 * first, so it can never eat a later, real tap.
 */

/** Classes of the elements that close something when pressed. */
export const BACKDROP_CLASSES = ['modal', 'benchpaste__away'] as const

/** Longest a press may last and still have its release swallowed. */
export const SWALLOW_MS = 1000

interface Target { classList?: { contains: (c: string) => boolean } }

/** Whether a pointerdown's target is a backdrop itself (not something inside one). */
export function isBackdrop(target: unknown): boolean {
  const cl = (target as Target | null)?.classList
  return !!cl && BACKDROP_CLASSES.some((c) => cl.contains(c))
}

type Listen = (type: string, fn: (e: Event) => void, opts: { capture: true }) => void

/** Install on a window-like target; returns the uninstall. */
export function installTapGuard(win: { addEventListener: Listen; removeEventListener: Listen }, now: () => number = () => Date.now()): () => void {
  let armed: { pointerId: number; until: number } | null = null
  const swallow = (e: Event): void => {
    e.preventDefault()
    e.stopPropagation()
    ;(e as Event & { stopImmediatePropagation?: () => void }).stopImmediatePropagation?.()
  }
  const down = (e: Event): void => {
    if (isBackdrop(e.target)) armed = { pointerId: (e as PointerEvent).pointerId, until: now() + SWALLOW_MS }
  }
  const up = (e: Event): void => {
    if (!armed) return
    if (now() > armed.until) { armed = null; return }
    if ((e as PointerEvent).pointerId === armed.pointerId) swallow(e)
  }
  const click = (e: Event): void => {
    if (!armed) return
    const live = now() <= armed.until
    armed = null
    if (live) swallow(e)
  }
  win.addEventListener('pointerdown', down, { capture: true })
  win.addEventListener('pointerup', up, { capture: true })
  win.addEventListener('click', click, { capture: true })
  return () => {
    win.removeEventListener('pointerdown', down, { capture: true })
    win.removeEventListener('pointerup', up, { capture: true })
    win.removeEventListener('click', click, { capture: true })
  }
}
