/**
 * useKeyboard.ts - the whole control scheme.
 *
 * Movement keys drive the *cursor*, expressed in screen directions and
 * resolved to world axes through the current view, so W is always "away from
 * you" in any of the 24 axis-aligned orientations. Nothing costs a proof
 * until Space commits the hop.
 */

import { useEffect } from 'react'
import { useCyberspace } from '../store/useCyberspace'
import { exitHyperspaceView, useHyperspace } from '../store/useHyperspace'
import { useWorkshop } from '../store/useWorkshop'
import { useShards } from '../store/useShards'
import { moveDirection, type MoveName } from '../lib/moves'
import type { RotateDirection } from '../lib/space'

const MOVE_KEYS: Record<string, MoveName> = {
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
  KeyR: 'away',
  KeyF: 'toward',
}

const ROTATE_KEYS: Record<string, RotateDirection> = {
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
}

export function useKeyboard(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Let the browser keep its own shortcuts.
      if (event.metaKey || event.ctrlKey || event.altKey) return
      // Typing into a field, or building on the bench: not ours.
      const tag = (event.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (useWorkshop.getState().open) return

      const store = useCyberspace.getState()
      // What is on screen, which under free orbit is not the snapped frame.
      // Without this, orbiting 180 degrees leaves WASD inverted.
      const axes = store.screenAxes ?? store.axes()

      if (event.code === 'Tab') {
        event.preventDefault()
        store.popView()
        return
      }

      // The chain explorer: one action back or forward, held keys repeat
      // through the keyboard's own repeat; Home and End are the spawn and the
      // head. These work wherever the scene is anchored, head included.
      if (event.code === 'BracketLeft' || event.code === 'BracketRight') {
        event.preventDefault()
        store.exploreStep(event.code === 'BracketLeft' ? -1 : 1)
        return
      }
      if (event.code === 'Home') {
        event.preventDefault()
        store.explore(0)
        return
      }
      if (event.code === 'End') {
        event.preventDefault()
        store.explore(null)
        return
      }

      if (event.code === 'Escape') {
        event.preventDefault()
        // Deploying: back out of it rather than resetting the view.
        if (useShards.getState().pending) { useShards.getState().cancelDeploy(); return }
        // Viewing a stop or EARTH: come home before anything else.
        const hs = useHyperspace.getState()
        if (hs.scrubHeight !== null || hs.viewOwned) { exitHyperspaceView(); return }
        store.resetView()
        return
      }

      // Commit the cursor's hop: the only key that costs a proof. While
      // deploying, Space places the shard at the cursor instead of moving.
      if (event.code === 'Space') {
        event.preventDefault()
        if (useShards.getState().pending) void useShards.getState().deploy()
        else store.commit()
        return
      }

      // Cancel an in-flight proof, or recall the cursor when idle.
      if (event.code === 'KeyX') {
        event.preventDefault()
        store.cancel()
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

      // The hyperspace line scrubber: H opens it at the tip of the line, H
      // again puts it away. The camera fly-to and its clearing live in
      // LineScrubber's effect, so the key and the chip drive one mechanism.
      if (event.code === 'KeyH') {
        event.preventDefault()
        const hs = useHyperspace.getState()
        if (hs.scrubHeight === null) hs.setScrubHeight(hs.tipHeight ?? 0)
        else exitHyperspaceView()
        return
      }

      if (event.code === 'KeyQ' || event.code === 'KeyE') {
        event.preventDefault()
        store.adjustScale(event.code === 'KeyQ' ? 1 : -1)
        return
      }

      // R and F travel along the axis perpendicular to the screen, which is
      // otherwise unreachable without rotating the view first.
      if (event.code === 'KeyR' || event.code === 'KeyF') {
        event.preventDefault()
        store.moveCursor(moveDirection(axes, MOVE_KEYS[event.code]))
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
      store.moveCursor(moveDirection(axes, screenDir))
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
