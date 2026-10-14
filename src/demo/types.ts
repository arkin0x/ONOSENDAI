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
  /** Scene layers to set on this step (useLayers); omitted layers stay as they are. */
  layers?: Partial<Record<SceneLayer, boolean>>
  /** Open the local chat dock. */
  chat?: boolean
}

/** Something the visitor does that a step waits for, detected from the stores. */
export type DemoAction =
  /** A new movement event on your own chain (a hop or a sidestep). */
  | 'hop'
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
  /** The one-line instruction shown while waiting. */
  hint?: string
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
