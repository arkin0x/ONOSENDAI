/**
 * types.ts: the shape of the first-arrival tutorial's script
 * (src/tutorial/script.ts; first-arrival tutorial design, 2026-11-10).
 *
 * The tutorial reuses the /demo tour's machinery (demo/types.ts DemoScene,
 * store/useDemo.ts applyScene, watchAction, aimCursor) and keeps the script
 * as data in the same way, so the wording can change without touching the
 * engine (store/useTutorial.ts) or the coach (hud/TutorialCoach.tsx). What
 * differs from /demo: the player's own moves publish as the publishing
 * switch says (a new identity is LIVE), the step is kept per player pubkey,
 * and the steps wait on things the tutorial itself stages (a region entered,
 * a chest opened, an item taken).
 */

import type { DemoAction, DemoScene, DemoStep } from '../demo/types'

/**
 * Something the player does that a step waits for. A /demo action
 * (demo/types.ts DemoAction) is watched by the /demo engine's own watcher;
 * any other name is a tutorial watcher (store/useTutorial.ts
 * TUTORIAL_WATCHERS), registered by the part of the tutorial that stages it.
 * Not the tour's 'spawn', which is about the tour's own key and counts at
 * once anywhere else.
 */
export type TutorialWait = Exclude<DemoAction, 'spawn'> | TutorialAction

/**
 * The tutorial's own waits, one per staged thing (tutorial/director.ts):
 * the treasure chest found, opened by hand, and something in it taken; the
 * course's start reached, gravity on in WALK, the finish chest found and
 * something in it taken; the workshop opened and closed again.
 */
export type TutorialAction = 'see-chest' | 'open-chest' | 'take' | 'at-start' | 'gravity' | 'see-finish' | 'take-finish' | 'workshop' | 'at-plot' | 'plant'

export interface TutorialStep {
  /** Unique across the script; also what a player's saved progress names. */
  id: string
  title: string
  /** One or two short lines (T2): the coach is the one place prose is shown. */
  caption: string
  /** Shown instead of `caption` once the step's `wait` has happened. */
  captionDone?: string
  /**
   * A centered card instead of the top panel, with one button (`go`): the
   * welcome. The card has no SKIP of its own beyond SKIP TUTORIAL, so a
   * modal step never has a `wait` or a `gate` (tested on the script).
   */
  modal?: boolean
  /** The modal card's button. */
  go?: string
  /**
   * Top-left chips this step still needs, by name (tutorial feedback
   * 2026-11-11, item 3): the tutorial hides them all while it runs, and a step
   * names the few it teaches with. 'found' is the FOUND HERE chip (opening a
   * chest); 'chain' is the chain chip (spectating a friend's history).
   */
  keepChips?: Array<'found' | 'chain'>
  /**
   * Who says the caption, by pubkey: their profile picture stands to the left
   * of it, from the profile cache (hud/ProfileBadge ProfilePic), with the
   * colour-and-initial face until it loads. Nothing waits on it.
   */
  speaker?: string
  /** A picture under the caption (T2: one or two lines plus a picture), by its path under public/. */
  image?: { src: string; alt: string }
  /** A longer explanation behind an EXPLAIN pill (T2); never shown unasked. */
  explain?: string
  /** What the scene should show as the step comes up; omitted leaves it as it is. */
  scene?: DemoScene
  wait?: TutorialWait
  /** The one-line instruction shown while waiting. */
  hint?: string
  /** NEXT stays off until the `wait` has happened; otherwise NEXT reads SKIP while waiting. */
  gate?: boolean
  /** As the /demo step's: where to put the cursor on entering the step. */
  aim?: DemoStep['aim']
  /**
   * The step needs WALK: shown while not walking (a reload, which never
   * keeps WALK; the lit WALK or the dim mode button; leaving WALK mid-run), the tutorial goes back to the
   * step with this id instead. Passed by SKIP on that step, the steps that
   * need WALK are passed over too.
   */
  needsWalk?: string
  /** A registered effect run as the step comes up (store/useTutorial.ts registerTutorialEffect). */
  effect?: string
  /**
   * A registered effect run on this step's NEXT only, never on BACK or a
   * choice (store/useTutorial.ts next): the ITEMS step closes the menu it
   * opened, so on a phone the course is not behind it (feedback 2026-11-12,
   * item 15).
   */
  onNext?: string
  /** A button in the coach that runs a registered effect when tapped (OPEN WORKSHOP); nothing runs untapped. */
  action?: { label: string; effect: string }
  /**
   * Reached only by a choice (`choices` on the step before it): NEXT on the
   * way through the script passes over it, and its own NEXT is FINISH.
   */
  branch?: boolean
  /**
   * A modal step's choices, one button each, above its own button (which
   * ends the run). A choice runs what was registered for it, if anything
   * (store/useTutorial.ts registerTutorialChoice), then goes to its `step` or
   * ends the run; one that names `when` is shown only once something
   * registered it (the dungeon: tutorial/dungeon.ts, with games on).
   */
  choices?: TutorialChoice[]
}

export interface TutorialChoice {
  id: string
  label: string
  /** One short line under the button. */
  about: string
  /** The branch step it goes to. */
  step?: string
  /** Shown only when a choice by this name is registered. */
  when?: string
}

export interface TutorialScript {
  steps: TutorialStep[]
}
