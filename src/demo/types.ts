/**
 * types.ts: the shape of the /demo tour's script (src/demo/script.ts).
 *
 * The script is data, so the wording can be edited without touching the
 * engine (store/useDemo.ts) or the coach panel (hud/DemoCoach.tsx). Each step
 * says what the scene should show, what the caption says, and whether the
 * tour waits for the visitor to do something before it counts as done.
 */

import type { SceneLayer } from '../store/useLayers'

/**
 * Where a step looks.
 * - 'self': your own avatar, where you stand (no view).
 * - 'spawn': the coordinate your public key names (spec §3.1).
 * - 'district': the demo district (DEMO_DISTRICT in script.ts).
 * - 'keep': wherever the previous step left the view.
 * - { coord }: a 64-hex coordinate; { block } a /C/ argument (a merkle root
 *   or block hash) that the /C/ machinery resolves to its hyperspace stop.
 */
export type DemoTarget = 'self' | 'spawn' | 'district' | 'keep' | { coord: string; label: string } | { block: string }

export interface DemoScene {
  target: DemoTarget
  /** The zoom, as a power of two (2^0 to 2^84); omitted keeps the current zoom. */
  scale?: number
  /**
   * How far the camera stands from what it orbits, in render cells, as a
   * pinch or the wheel leaves it; set once as the step comes up, and the
   * distance from before comes back on the first step without one.
   * Omitted keeps the camera where it is.
   */
  distance?: number
  /** Scene layers to set on this step (useLayers); omitted layers stay as they are. */
  layers?: Partial<Record<SceneLayer, boolean>>
  /** Open the local chat dock. */
  chat?: boolean
  /**
   * Show this plane where you stand (0 dataspace, 1 ideaspace), as the
   * plane switch does (setPlane); only with target 'self'. The next step at
   * 'self' brings your own plane back (homeCursor).
   */
  plane?: 0 | 1
  /**
   * Draw the hyperspace line running station to station (scene/TourLine.tsx);
   * it stops and is freed on the first step without it.
   */
  hyperline?: boolean
  /**
   * A control to point at, as a CSS selector: it wears a pulsing ring
   * (.demo-pulse) while the step is on screen. Nothing is clicked or opened.
   */
  highlight?: string
  /**
   * Draw only the hidden things the tour's curators placed (DEMO_CURATORS in
   * script.ts) while the step is on screen; the rest of the world comes back
   * on the first step without it, and when the tour ends.
   */
  curated?: boolean
}

/** Something the visitor does that a step waits for, detected from the stores. */
export type DemoAction =
  /** A new movement event on your own chain (a hop or a sidestep). */
  | 'hop'
  /**
   * Your spawn, signed with the coach's SPAWN button. Asked only of a key
   * the tour generated that has no chain yet; for any other identity it
   * counts at once, and the tour never offers SPAWN or signs a spawn.
   */
  | 'spawn'
  /** A hop or sidestep anywhere on your chain; one already there counts at once. */
  | 'own-hop'
  /** A discovery scan that started and finished after the step began. */
  | 'scan'
  /** A hidden thing opened (its modal shown). */
  | 'open-item'
  /** WALK mode turned on. */
  | 'walk'

/** A panel the coach shows under the caption. */
export type DemoPanel =
  /** Your newest movement event, as JSON. */
  | 'event-json'
  /** The same event's id and signature, checked live. */
  | 'verify'
  /** Your relays, and which of them hold your chain. */
  | 'relays'
  /** The Cyberspace kinds table. */
  | 'kinds'
  /** Your newest event's link to the one before it. */
  | 'chain'
  /** GO LIVE and links to read more. */
  | 'finish'

export interface DemoStep {
  /** Unique across the script; also the deep link /demo/<id>. */
  id: string
  /** The chapter's id (DemoChapter.id). */
  chapter: string
  title: string
  /** Plain text, one to three short sentences. Read aloud by SPEAK. */
  caption: string
  /** Shown instead of `caption` for an identity with no chain yet (never moved). */
  captionNew?: string
  scene: DemoScene
  /** What the visitor is asked to do; omitted for a step that only shows. */
  wait?: DemoAction
  /**
   * Shown instead of `caption` to an identity that is not new: one with a
   * chain, or with an avatar of its own rather than the default shape.
   */
  captionReturning?: string
  /** Shown instead of `caption` while the step's `wait` has not happened. */
  captionWaiting?: string
  /** The one-line instruction shown while waiting. */
  hint?: string
  /**
   * For an 'open-item' wait: shown instead when the scan has finished and
   * there is nothing here to open, and the step counts as done, so it never
   * waits on an empty place.
   */
  emptyHint?: string
  /**
   * NEXT (and the keys that present the tour) stay off until the `wait` has
   * happened; without it, waiting is an invitation and NEXT reads SKIP.
   */
  gate?: boolean
  /**
   * The gate is for newcomers only: an identity that came into the tour
   * with hops of its own on its chain (TourSession.hadHops) may go on at
   * once, and the wait is only an invitation for it (arkinox, 2026-10-15).
   */
  gateUnlessHadHops?: boolean
  /**
   * Where to put the cursor on entering the step, in gibsons from where you
   * stand along the pad's own up, right and forward (into the screen): as a
   * preview on a step with no `wait`, else while the `wait` has not happened, with the zoom set to `scale` so the
   * cursor shows where it went (2^0: one cell is one gibson).
   */
  aim?: { up: number; right: number; forward: number; scale?: number }
  panel?: DemoPanel
}

export interface DemoChapter {
  id: string
  title: string
}

export interface DemoScript {
  chapters: DemoChapter[]
  steps: DemoStep[]
}
