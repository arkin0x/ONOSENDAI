/**
 * useKeyboard.ts - the whole control scheme.
 *
 * Movement keys drive the *cursor*, expressed in screen directions and
 * resolved to world axes through the current view, so W is always "away from
 * you" in any of the 24 axis-aligned orientations. Nothing costs a proof
 * until Space commits the hop.
 *
 * WALK has its own keys, first-person style (lib/walkKeys.ts): W forward,
 * S back, A and D sideways, Space or R up, C or F down, every press a step;
 * W or S with A or D held steps diagonally, 45 degrees to that side. A held
 * key walks from the press on (store/walkHold.ts): the keyboard's own
 * repeats, which came after a pause, are ignored. They are answered before anything else, so in WALK Space never
 * commits, scrolls or presses a focused button. Z switches WALK's GRAVITY
 * (store/useWalk.ts); the workshop bench's own Z (undo) is never reached
 * from here, since nothing of WALK's is answered with the workshop open.
 */

import { useEffect } from 'react'
import { escapeTop } from './useEscape'
import { useCyberspace } from '../store/useCyberspace'
import { closeScrubber, useHyperspace } from '../store/useHyperspace'
import { useTv } from '../store/useTv'
import { useWorkshop } from '../store/useWorkshop'
import { useGame } from '../store/useGame'
import { useShards } from '../store/useShards'
import { stepChain, useBuilder, walkChain } from '../store/useBuilder'
import { useChat } from '../store/useChat'
import { nextAction, useOffer } from '../store/useOffer'
import { moveDirection, type MoveName } from '../lib/moves'
import type { RotateDirection } from '../lib/space'
import { stepBuild } from '../store/buildStep'
import { useWalk } from '../store/useWalk'
import { walkHeldDir, walkMove } from '../lib/walkKeys'
import { holdEnd, holdReleaseAll, holdStart } from '../store/walkHold'
import { addWalkInputCloser, setWalkMenuCovering, walkMenuCovering } from '../store/walkInput'
import { canFly, useViewFly } from '../lib/viewFly'
import { useRegion } from '../store/useRegion'
import { leaveWalk, viewToAvatar } from '../store/padMode'

// Cyberspace TV is watching only: WALK's input is closed while it is on (store/walkInput.ts).
addWalkInputCloser(() => useTv.getState().on)

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
export function setMenuCovering(covering: boolean): void {
  setWalkMenuCovering(covering)
}

/**
 * Escape closes one thing: the topmost modal, else the menu, else the most
 * recent chip (useEscape; arkinox, 2026-10-01). It no longer resets the view
 * to top down when nothing is open: that mapping predated the menu and the
 * chips, and was not useful (arkinox, 2026-10-01). TOP in the view menu still
 * does it. An Escape something else already handled (preventDefault) is left
 * alone. True when the key was Escape.
 */
export function escapeKey(event: Pick<KeyboardEvent, 'code' | 'defaultPrevented' | 'metaKey' | 'ctrlKey' | 'altKey' | 'preventDefault'>): boolean {
  if (event.code !== 'Escape') return false
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return true
  event.preventDefault()
  escapeTop()
  return true
}

/**
 * WALK's own keys (lib/walkKeys.ts), answered before anything else: true
 * when the key was one of them. Only while walking, with the scene not
 * covered and the workshop shut, so the bench keeps its own Z (undo).
 */
export function walkKeyDown(event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey' | 'preventDefault'> & { repeat?: boolean }): boolean {
  if (!useCyberspace.getState().walking || walkMenuCovering() || useWorkshop.getState().open || useGame.getState().session) return false
  const step = walkMove(event)
  if (step) {
    event.preventDefault()
    // Held, the key walks from the press on (store/walkHold.ts), so the
    // keyboard's repeats, which begin after a pause, add nothing. With the
    // input closed (a modal up) the key is still WALK's, and holds nothing.
    if (!event.repeat) holdStart(`key:${event.code}`, walkHeldDir(step))
    return true
  }
  // Space is WALK's up even when it is not a step (a modifier held):
  // never a commit, a scroll or a press of whatever has focus.
  if (event.code === 'Space') { event.preventDefault(); return true }
  // GRAVITY on or off. A modifier makes it something else (Ctrl+Z); a
  // held Z switches it once, not once per repeat.
  if (event.code === 'KeyZ' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
    event.preventDefault()
    if (event.repeat) return true
    const walk = useWalk.getState()
    walk.setGravity(!walk.gravity)
    return true
  }
  return false
}

/** A key let go: it stops walking, and is no longer held into a diagonal (store/walkHold.ts). */
export function walkKeyUp(code: string): void {
  holdEnd(`key:${code}`)
}

/**
 * Everything held let go, keys and pad alike: the window lost focus or the
 * page was hidden, so no keyup or pointerup will come for what was held.
 */
export function walkKeysReleased(): void {
  holdReleaseAll()
}

/**
 * Meta (Cmd) down or up, or any key with it held: everything held is let go
 * (review of #651). macOS sends no keyup for a key let go while Cmd is down,
 * so W held through Cmd+Tab would otherwise walk on forever. True when it let go.
 */
export function walkMetaRelease(event: Pick<KeyboardEvent, 'code' | 'metaKey'> & { key?: string }): boolean {
  if (!(event.metaKey || event.code === 'MetaLeft' || event.code === 'MetaRight' || event.key === 'Meta')) return false
  holdReleaseAll()
  return true
}

/** The page hidden: no keyup or pointerup will come for what was held. */
function pageHidden(): void {
  if (typeof document !== 'undefined' && document.hidden) holdReleaseAll()
}

/** X in WALK: stop the steps still to prove (a fall still in the air is some), or with none, back to the mode WALK came from (padMode `leaveWalk`). */
export function walkCancel(): void {
  const walk = useWalk.getState()
  if (walk.behind > 0 || walk.open !== null || walk.falling || useCyberspace.getState().proof.status === 'computing') walk.stop()
  else leaveWalk()
}

/** Space (forward) or Shift (back) let go in VIEW: the fly that key drove stops, a different one held keeps its own. */
export function flyKeyUp(dir: 1 | -1): void {
  const f = useViewFly.getState()
  if (f.key === dir) f.setKey(0)
}

/**
 * The rotate keys (W A S D) held now. Shift flies the view back in VIEW, but
 * Shift with W A S D rotates it; while a rotate key is down Shift does not
 * fly, so steering the view by rotation never also drifts it backward
 * (review, 2026-11-11).
 */
const rotateHeld = new Set<string>()

/** The window lost focus: no keyup will come for a held Space or Shift, or a held rotate key. */
function flyKeysReleased(): void {
  useViewFly.getState().setKey(0)
  rotateHeld.clear()
}

export function useKeyboard(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Cmd swallows keyups on macOS: let go of every held walk first.
      walkMetaRelease(event)
      // Escape closes the top layer even from a field: a modal that focuses
      // its own input (ITEM FEED's search, a chest's name, the login box)
      // otherwise could not be closed from the keyboard at all (pre-class
      // smoke test, 2026-10-16). A field that uses Escape itself (the chat
      // line's mention list) says so with preventDefault, and keeps it.
      // In a game nothing of cyberspace's is on screen, so Escape closes none of it out of sight.
      if (useGame.getState().session) return
      if (escapeKey(event)) return
      // Cyberspace TV is watching only: no key moves, zooms or commits.
      if (useTv.getState().on) return
      // Typing into a field, or building on the bench: not ours.
      const tag = (event.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      // WALK's keys first, so Space and the letters it takes over never reach
      // their HOP meanings below.
      if (walkKeyDown(event)) return
      // Let the browser keep its own shortcuts.
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (walkMenuCovering()) return
      // Space and Enter on a focused control press that control. Space is
      // COMMIT here, a proof and possibly a paid one, so a Space meant for a
      // focused switch, checkbox or button used to try to move instead
      // (found adding the trail switch, arkinox 2026-10-01). Other keys keep
      // their shortcuts with a control focused.
      if ((event.code === 'Space' || event.key === 'Enter') && (event.target as HTMLElement | null)?.closest?.('button, a[href], select, summary, [role="switch"], [role="checkbox"], [role="button"], [role="menuitem"], [role="tab"]')) return
      if (useWorkshop.getState().open) return
      // In a game its own keys answer (game/GameView.tsx): nothing here moves you in cyberspace meanwhile.
      if (useGame.getState().session) return

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
      // While building they aim the build cursor at the action instead of
      // going into history, as the CHAIN chip does (useBuilder walkChain).
      if (event.code === 'BracketLeft' || event.code === 'BracketRight') {
        event.preventDefault()
        stepChain(event.code === 'BracketLeft' ? -1 : 1)
        return
      }
      if (event.code === 'Home') {
        event.preventDefault()
        walkChain(0)
        return
      }
      if (event.code === 'End') {
        event.preventDefault()
        walkChain(null)
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
        // In VIEW, Space flies the view forward while held, the way the camera
        // faces (arkinox, 2026-11-11), as the Forward button does; it never
        // commits there. R and F are FAR and NEAR again, a cell at a time.
        if (canFly(store, building)) { useViewFly.getState().setKey(1); return }
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
      // own recall. In VIEW, X brings the cursor and the view home and VIEW
      // stays, as the pad's RECALL does (store/padMode.ts viewToAvatar;
      // arkinox, 2026-11-12); Esc is VIEW's RETURN.
      if (event.code === 'KeyX') {
        event.preventDefault()
        if (store.walking) { walkCancel(); return }
        // In region mode, X resets the cursor to where region mode started and
        // collapses the region to that one cell at the zoom you are now at
        // (store/useRegion.ts; arkinox, 2026-11-11).
        if (useRegion.getState().active) { useRegion.getState().collapseToEntry(); return }
        const idle = store.proof.status !== 'computing' && store.cloud.status === 'idle' && store.plan === null
        if (building && idle) useBuilder.getState().toAvatar()
        else if (idle && store.viewing()) viewToAvatar()
        else store.cancel()
        return
      }

      // The spec-canonical "facing the black sun" orientation (section 11.3).
      // In WALK, C is down (answered above).
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
        if (hs.scrubHeight === null) hs.setScrubHeight(hs.viewedStop ?? hs.tipHeight ?? 0)
        else closeScrubber()
        return
      }

      // The build STEP while a deploy is lined up (store/buildStep.ts): comma
      // is finer, period coarser, the < and > on the same keys.
      if (event.code === 'Comma' || event.code === 'Period') {
        if (!useShards.getState().pending) return
        event.preventDefault()
        stepBuild(event.code === 'Comma' ? -1 : 1)
        return
      }

      if (event.code === 'KeyQ' || event.code === 'KeyE') {
        event.preventDefault()
        store.adjustScale(event.code === 'KeyQ' ? 1 : -1)
        return
      }

      // R and F travel along the axis perpendicular to the screen, which is
      // otherwise unreachable without rotating the view first. FAR and NEAR,
      // one cell at a time, in VIEW as everywhere else (arkinox, 2026-11-11:
      // "R = FAR, F = NEAR again"); flying the view is Space and Shift now.
      if (event.code === 'KeyR' || event.code === 'KeyF') {
        event.preventDefault()
        // In WALK R and F are up and down, answered above.
        if (store.walking) return
        store.moveCursor(moveDirection(axes, MOVE_KEYS[event.code]))
        return
      }

      // Which rotate keys are held, so Shift can fly only when none is.
      if (ROTATE_KEYS[event.code]) rotateHeld.add(event.code)

      // In VIEW, Shift flies the view backward while held (arkinox, 2026-11-11),
      // as the Back button does. Not while a rotate key is down: Shift with
      // W A S D rotates (below), and a rotate must not also drift the view back.
      if ((event.code === 'ShiftLeft' || event.code === 'ShiftRight') && canFly(store, building) && rotateHeld.size === 0) {
        event.preventDefault()
        useViewFly.getState().setKey(-1)
        return
      }

      if (event.shiftKey) {
        const rotation = ROTATE_KEYS[event.code]
        if (!rotation) return
        event.preventDefault()
        // Starting a rotate ends any backward fly Shift had begun, so you steer
        // by rotation without the view sliding back under you.
        useViewFly.getState().setKey(0)
        store.rotate(rotation)
        return
      }

      const screenDir = MOVE_KEYS[event.code]
      if (!screenDir) return
      event.preventDefault()
      // WALK's own letters were answered above; nothing else moves a walk.
      if (store.walking) return
      store.moveCursor(moveDirection(axes, screenDir))
    }

    const onKeyUp = (event: KeyboardEvent) => {
      walkKeyUp(event.code)
      walkMetaRelease(event)
      if (ROTATE_KEYS[event.code]) rotateHeld.delete(event.code)
      // Space or Shift let go: VIEW's fly from that key stops.
      if (event.code === 'Space') flyKeyUp(1)
      if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') flyKeyUp(-1)
      // A button with focus activates on Space's keyup: in WALK that Space
      // was a step up, not a press of the button.
      if (event.code === 'Space' && useCyberspace.getState().walking) event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', walkKeysReleased)
    window.addEventListener('blur', flyKeysReleased)
    // A page hidden (a tab switch, a phone's home button) sends no keyup.
    const doc = typeof document === 'undefined' ? null : document
    doc?.addEventListener('visibilitychange', pageHidden)
    return () => {
      doc?.removeEventListener('visibilitychange', pageHidden)
      window.removeEventListener('blur', flyKeysReleased)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', walkKeysReleased)
    }
  }, [])
}
