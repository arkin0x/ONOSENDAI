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

/**
 * Fire on press, then repeat while held.
 *
 * Crossing a lot of gibsons one tap at a time would be miserable, and holding
 * is what the keyboard gives you for free through key repeat.
 */
export function useRepeatable(): (action: () => void) => {
  onPointerDown: (e: React.PointerEvent) => void
  onPointerUp: () => void
  onPointerCancel: () => void
  onPointerLeave: () => void
  onContextMenu: (e: React.MouseEvent) => void
} {
  const timers = useRef<{ delay?: number; repeat?: number }>({})

  const stop = useCallback(() => {
    if (timers.current.delay) clearTimeout(timers.current.delay)
    if (timers.current.repeat) clearInterval(timers.current.repeat)
    timers.current = {}
  }, [])

  useEffect(() => stop, [stop])

  return useCallback((action: () => void) => ({
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
  }), [stop])
}

