/**
 * useCanvasTap.ts — distinguish a tap on the scene from an orbit drag.
 *
 * The camera owns dragging and pinching, and that must not change: those are
 * the gestures that already worked on a phone. A tap is what is left over, so
 * it is the only gesture free to summon the controls.
 *
 * Telling them apart is a matter of thresholds. A press that stays within a few
 * pixels and lifts quickly is a tap; anything else is the camera's. The slop
 * allowance matters more than it looks, because a thumb never lands and lifts
 * on exactly the same pixel.
 */

import { useEffect } from 'react'

/**
 * Marks the current gesture as already meaning something.
 *
 * A tap on a block, a shard or the planet lands on the canvas like any other,
 * so without this the same press both selected the thing and toggled the
 * controls away. Scene handlers call stopPropagation, but that is R3F's own
 * event and says nothing to a window listener, so they say it here instead.
 *
 * A timestamp rather than a flag: the scene handler runs during the click
 * that this hook is also watching, so the mark only has to outlive one event,
 * and one that is never cleared cannot strand the gesture after it.
 */
let handledAt = 0

export function markSceneTapHandled(): void {
  handledAt = performance.now()
}

/** How long a scene handler's claim on the gesture lasts, in milliseconds. */
const HANDLED_MS = 50

/** How far a press may wander and still count as a tap, in CSS pixels. */
const SLOP = 12
/** How long it may last, in milliseconds. */
const MAX_MS = 400
/**
 * Canvases that are not the scene: the compass, the workshop's bench, the
 * thumbnail stage, a card's turning shard. A press on one is that control's
 * business, as a press on a button is (review of #398: a click on the
 * workshop's compass flipped the hidden pad).
 */
const NOT_SCENE = '.compass-3d, .workshop, .thumbstage, .shardspin, .modal'

/** How long after the lift its click may come and still be the tap's, in milliseconds. */
const CLICK_WITHIN_MS = 1000

/**
 * The tap is decided at its click, not at the lift. The scene's handlers
 * (onClick: a shard, a block, the planet) run on the click, after the lift,
 * so a decision at the lift came before any of them could claim the tap: the
 * controls toggled, and when they were drawn under the finger before the
 * phone sent the click, the click landed on them and the shard never opened
 * (arkinox, 2026-10-20, Brave on Android: "it seems like they are fighting
 * for precedence"). On the click the scene has had its say first: R3F
 * listens on the canvas, below the window.
 */

/** Install on a window-like target; returns the uninstall. */
export function installCanvasTap(
  win: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
  onTap: () => void,
  now: () => number = () => performance.now(),
): () => void {
  let startX = 0
  let startY = 0
  let startedAt = 0
  let tracking = false
  /** When the last lift that qualified as a tap happened (now()), or 0. */
  let liftedAt = 0

  const onCanvas = (e: Event): boolean => {
    const t = e.target as HTMLElement | null
    return t?.tagName === 'CANVAS' && !t.closest?.(NOT_SCENE)
  }

  // Every press, even one a control stops on its way (the compass, a modal's
  // card), clears what an earlier lift left: heard in the capture phase. It
  // only clears; a press starts a tap below, in the bubbling phase, so one
  // that was stopped never does (review of #398).
  const reset = (): void => { tracking = false; liftedAt = 0 }

  const down = (ev: Event): void => {
    const e = ev as PointerEvent
    liftedAt = 0
    // Only presses that land on the scene itself. Anything over a button or a
    // panel is that control's business.
    if (!onCanvas(e)) { tracking = false; return }
    // A second finger means a pinch, which belongs to the camera.
    if (!e.isPrimary) { tracking = false; return }
    tracking = true
    startX = e.clientX
    startY = e.clientY
    startedAt = e.timeStamp
  }

  const up = (ev: Event): void => {
    const e = ev as PointerEvent
    if (!tracking) return
    tracking = false
    if (e.timeStamp - startedAt > MAX_MS) return
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > SLOP) return
    liftedAt = now()
  }

  const click = (e: Event): void => {
    const lifted = liftedAt
    liftedAt = 0
    if (!lifted || now() - lifted > CLICK_WITHIN_MS) return
    if (!onCanvas(e)) return
    if (now() - handledAt < HANDLED_MS) return
    onTap()
  }

  const cancel = (): void => { tracking = false; liftedAt = 0 }

  win.addEventListener('pointerdown', reset, { capture: true, passive: true })
  win.addEventListener('pointerdown', down, { passive: true })
  win.addEventListener('pointerup', up, { passive: true })
  win.addEventListener('click', click, { passive: true })
  win.addEventListener('pointercancel', cancel, { passive: true })
  return () => {
    win.removeEventListener('pointerdown', reset, { capture: true })
    win.removeEventListener('pointerdown', down)
    win.removeEventListener('pointerup', up)
    win.removeEventListener('click', click)
    win.removeEventListener('pointercancel', cancel)
  }
}

export function useCanvasTap(onTap: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return
    return installCanvasTap(window, onTap)
  }, [onTap, enabled])
}
