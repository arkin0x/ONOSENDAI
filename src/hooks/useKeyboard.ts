/**
 * useKeyboard.ts — the whole control scheme.
 *
 * Movement is expressed in *screen* directions and resolved to world axes
 * through the current view, so W is always "away from you" no matter which of
 * the 24 axis-aligned orientations you are in.
 */

import { useEffect } from 'react'
import { useCyberspace } from '../store/useCyberspace'
import type { AxisDirection, RotateDirection } from '../lib/space'

type ScreenDirection = 'up' | 'down' | 'left' | 'right'

const MOVE_KEYS: Record<string, ScreenDirection> = {
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
}

const ROTATE_KEYS: Record<string, RotateDirection> = {
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
}

/**
 * Flip an axis direction.
 */
function invert(d: AxisDirection): AxisDirection {
  return { axis: d.axis, dir: d.dir === 1 ? -1 : 1 }
}

export function useKeyboard(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Let the browser keep its own shortcuts.
      if (event.metaKey || event.ctrlKey || event.altKey) return

      const store = useCyberspace.getState()
      const axes = store.axes()

      if (event.code === 'Tab') {
        event.preventDefault()
        store.popView()
        return
      }

      if (event.code === 'Space') {
        event.preventDefault()
        store.resetView()
        return
      }

      // The spec-canonical "facing the black sun" orientation (section 11.3).
      if (event.code === 'KeyC') {
        event.preventDefault()
        store.canonicalView()
        return
      }

      if (event.code === 'KeyP') {
        event.preventDefault()
        store.togglePlane()
        return
      }

      if (event.code === 'KeyQ' || event.code === 'KeyE') {
        event.preventDefault()
        store.adjustScale(event.code === 'KeyE' ? 1 : -1)
        return
      }

      // R and F travel along the axis perpendicular to the screen, which is
      // otherwise unreachable without rotating the view first.
      if (event.code === 'KeyR' || event.code === 'KeyF') {
        event.preventDefault()
        store.move(event.code === 'KeyR' ? axes.out : invert(axes.out))
        return
      }

      if (event.shiftKey) {
        const rotation = ROTATE_KEYS[event.code]
        if (!rotation) return
        event.preventDefault()
        store.rotate(rotation)
        return
      }

      const screenDir = MOVE_KEYS[event.code]
      if (!screenDir) return
      event.preventDefault()

      switch (screenDir) {
        case 'up':
          store.move(axes.up)
          break
        case 'down':
          store.move(invert(axes.up))
          break
        case 'right':
          store.move(axes.right)
          break
        case 'left':
          store.move(invert(axes.right))
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
