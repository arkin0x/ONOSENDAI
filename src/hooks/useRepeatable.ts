/**
 * useRepeatable.ts — press once, then repeat while held.
 *
 * Shared by the movement pad and the chain explorer. Crossing a lot of gibsons
 * one tap at a time would be miserable, and so would stepping through a
 * thousand-hop chain; holding is what the keyboard gives you for free through
 * key repeat, and this is the same thing for a button.
 */

import { useCallback, useEffect, useRef } from 'react'

/**
 * Suppress the long-press callout.
 *
 * Holding a direction is a first-class gesture here, it is how you cross more
 * than a few gibsons, and on a touch device a long press is also how you ask for
 * a context menu. So the very thing the pad is designed for is what pops a
 * "copy / share" sheet over it on Android and a magnifier on iOS. The CSS half
 * of this lives in `-webkit-touch-callout: none`; this is the half that stops
 * the event a desktop right-click would raise on the same element.
 */
export const noCallout = { onContextMenu: (e: React.MouseEvent) => e.preventDefault() }

/** Delay before a held button starts repeating, then the repeat period. */
const HOLD_DELAY = 380
const REPEAT_MS = 110
/** How far a finger may drift and still be pressing, not scrolling, in CSS pixels. */
const SCROLL_SLOP = 8

/**
 * Fire on press, then repeat while held.
 *
 * Crossing a lot of gibsons one tap at a time would be miserable, and holding
 * is what the keyboard gives you for free through key repeat.
 *
 * `scrollSafe` is for buttons inside something that scrolls (the deploy bar,
 * arkinox 2026-10-01: "if i accidentally touch them while scrolling, it
 * triggers instead"). The default fires the instant a finger lands and claims
 * the gesture, which is right for the movement pad and wrong in a scrolling
 * list: there a touch that starts on a button may be the start of a scroll.
 * So a scroll-safe button lets the browser pan (pair it with CSS
 * `touch-action: pan-y`), fires a tap on release, starts repeating only after
 * the finger has stayed put for HOLD_DELAY, and does nothing at all once the
 * finger moves past SCROLL_SLOP or the browser takes the gesture for a scroll
 * (pointercancel).
 */
export function useRepeatable(options: { scrollSafe?: boolean } = {}): (action: () => void) => {
  onPointerDown: (e: React.PointerEvent) => void
  onPointerMove?: (e: React.PointerEvent) => void
  onPointerUp: () => void
  onPointerCancel: () => void
  onPointerLeave: () => void
  onContextMenu: (e: React.MouseEvent) => void
} {
  const scrollSafe = options.scrollSafe === true
  const timers = useRef<{ delay?: number; repeat?: number }>({})
  // Scroll-safe only: where the press began, whether it has fired, and whether
  // it was abandoned as a scroll.
  const press = useRef<{ x: number; y: number; fired: boolean; live: boolean } | null>(null)

  const stop = useCallback(() => {
    if (timers.current.delay) clearTimeout(timers.current.delay)
    if (timers.current.repeat) clearInterval(timers.current.repeat)
    timers.current = {}
  }, [])

  useEffect(() => stop, [stop])

  return useCallback((action: () => void) => scrollSafe ? {
    onPointerDown: (e: React.PointerEvent) => {
      // No preventDefault: the browser must stay free to turn this into a scroll.
      e.stopPropagation()
      stop()
      press.current = { x: e.clientX, y: e.clientY, fired: false, live: true }
      timers.current.delay = window.setTimeout(() => {
        if (!press.current?.live) return
        press.current.fired = true
        action()
        timers.current.repeat = window.setInterval(action, REPEAT_MS)
      }, HOLD_DELAY)
    },
    onPointerMove: (e: React.PointerEvent) => {
      const at = press.current
      if (!at?.live) return
      if (Math.hypot(e.clientX - at.x, e.clientY - at.y) > SCROLL_SLOP) { at.live = false; stop() }
    },
    onPointerUp: () => {
      const at = press.current
      stop()
      // A tap: still pressing, nothing fired yet.
      if (at?.live && !at.fired) action()
      press.current = null
    },
    onPointerCancel: () => { press.current = null; stop() },
    onPointerLeave: () => { if (press.current) press.current.live = false; stop() },
    ...noCallout,
  } : {
    onPointerDown: (e: React.PointerEvent) => {
      // Keeps the press off the canvas and stops it becoming a scroll or a
      // synthetic click that would fire the action twice.
      e.preventDefault()
      e.stopPropagation()
      stop()
      action()
      timers.current.delay = window.setTimeout(() => {
        timers.current.repeat = window.setInterval(action, REPEAT_MS)
      }, HOLD_DELAY)
    },
    onPointerUp: stop,
    onPointerCancel: stop,
    onPointerLeave: stop,
    ...noCallout,
  }, [stop, scrollSafe])
}

