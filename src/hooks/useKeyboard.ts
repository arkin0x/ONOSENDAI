/**
 * useKeyboard.ts - the whole control scheme.
 *
 * Movement keys drive the *cursor*, expressed in screen directions and
 * resolved to world axes through the current view, so W is always "away from
 * you" in any of the 24 axis-aligned orientations. Nothing costs a proof
 * until Space commits the hop.
 */

import { useEffect } from 'react'
import { escapeTop } from './useEscape'
import { useCyberspace } from '../store/useCyberspace'
import { exitHyperspaceView, useHyperspace } from '../store/useHyperspace'
import { useWorkshop } from '../store/useWorkshop'
import { useShards } from '../store/useShards'
import { useBuilder } from '../store/useBuilder'
import { useChat } from '../store/useChat'
import { nextAction, useOffer } from '../store/useOffer'
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

/**
 * Whether the menu covers the scene (a phone with the panels open). The
 * on-screen pad and scene taps already step aside then; the keys follow
 * (arkinox, 2026-10-01: "turn off the cyberspace controls while the menu is
 * open"). Set by App, which knows; Escape still works.
 */
let menuCovering = false
export function setMenuCovering(covering: boolean): void {
  menuCovering = covering
}

export function useKeyboard(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Let the browser keep its own shortcuts.
      if (event.metaKey || event.ctrlKey || event.altKey) return
      // Typing into a field, or building on the bench: not ours.
      const tag = (event.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      // Escape closes one thing: the topmost modal, else the menu, else the
      // most recent chip (useEscape; arkinox, 2026-10-01). It comes before
      // the menu and workshop checks below because both of those are things
      // it closes. It no longer resets the view to top down when nothing is
      // open: that mapping predated the menu and the chips, and was not
      // useful (arkinox, 2026-10-01). TOP in the view menu still does it.
      if (event.code === 'Escape') {
        event.preventDefault()
        escapeTop()
        return
      }
      if (menuCovering) return
      // Space and Enter on a focused control press that control. Space is
      // COMMIT here, a proof and possibly a paid one, so a Space meant for a
      // focused switch, checkbox or button used to try to move instead
      // (found adding the trail switch, arkinox 2026-10-01). Other keys keep
      // their shortcuts with a control focused.
      if ((event.code === 'Space' || event.key === 'Enter') && (event.target as HTMLElement | null)?.closest?.('button, a[href], select, summary, [role="switch"], [role="checkbox"], [role="button"], [role="menuitem"], [role="tab"]')) return
      if (useWorkshop.getState().open) return

      const store = useCyberspace.getState()
      // What is on screen, which under free orbit is not the snapped frame.
      // Without this, orbiting 180 degrees leaves WASD inverted.
      const axes = store.screenAxes ?? store.axes()
      // BUILD mode (store/useBuilder.ts): the same keys move the build cursor,
      // and the few that would reach the movement chain are answered here.
      const building = useBuilder.getState().active

      // B: into BUILD mode, or out of it, like the BUILD control. Leaving is
      // refused while a deploy is lined up (useBuilder `exit`): that is
      // CANCEL's (or Escape's) to end, not a letter's.
      if (event.code === 'KeyB') {
        event.preventDefault()
        useBuilder.getState().toggle()
        return
      }

      if (event.code === 'Tab') {
        event.preventDefault()
        store.popView()
        return
      }

      // The chain explorer: one action back or forward, held keys repeat
      // through the keyboard's own repeat; Home and End are the spawn and the
      // head. These work wherever the scene is anchored, head included.
      // Not while building: history is somewhere you cannot place anything,
      // and walking it would end BUILD mode on a stray key.
      if (building && (event.code === 'BracketLeft' || event.code === 'BracketRight' || event.code === 'Home' || event.code === 'End')) return
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

      // The chat: / unfolds it with the caret in the line. Escape inside the
      // line is handled by the line itself, which is an INPUT and never gets
      // here; with the caret elsewhere the unfolded dock is a chip on the
      // Escape stack.
      if (event.code === 'Slash') {
        event.preventDefault()
        useChat.setState({ open: true, unread: 0, focusOnOpen: true })
        return
      }

      // Commit the cursor's hop: the only key that costs a proof. While
      // deploying, Space places the shard at the cursor instead of moving.
      if (event.code === 'Space') {
        event.preventDefault()
        if (useShards.getState().pending) { void useShards.getState().deploy(); return }
        // Building never moves you: with nothing to place, Space does nothing.
        if (building) return
        // The next action, as the button names it: HOSAKA's step brings up the
        // card first (Space again goes); too far does nothing; the rest commit.
        const next = nextAction()
        if (next?.action === 'too-far') return
        if (next?.action === 'offload' && useOffer.getState().requestedFor !== next.cursorKey) useOffer.getState().request(next.cursorKey)
        else store.commit()
        return
      }

      // Cancel an in-flight proof, or recall the cursor when idle.
      // While building, X stops a move or a route from before, running,
      // paused or failed (that is stopping a move, not making one), and
      // otherwise brings the build cursor back to your avatar, the builder's
      // own recall.
      if (event.code === 'KeyX') {
        event.preventDefault()
        if (building && store.proof.status !== 'computing' && store.cloud.status === 'idle' && store.plan === null) useBuilder.getState().toAvatar()
        else store.cancel()
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
