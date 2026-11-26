/**
 * terrainRoute.ts: SURVEY AND BUILD, the "Where next?" route through TERRAIN
 * (owner, 2026-11-26: "we should add surveying as an optional tutorial item
 * to the end tutorial list"; "it needs to walk them through mining and
 * building too. not just a 1 panel tutorial").
 *
 * One thing per panel (tutorial/script.ts TERRAIN_OPEN to TERRAIN_DONE), each
 * done by the real thing in the terrain store (store/useTerrain.ts `tally`,
 * bumped by survey, mine, place and a slot picked), and the control it
 * teaches pulsing:
 *
 *   1. open     TERRAIN on (TERRAIN (T) in the card, the T key, or the mode button);
 *   2. survey   a chunk surveyed, or the ground here surveyed already (by you
 *               before, or by someone else: yours to build in at once), which
 *               the next step then says;
 *   3. mine     a block mined;
 *   4. pick     a hotbar slot picked that holds a block (or one placed);
 *   5. place    a block placed;
 *   6. build    three more placed, counted on the card;
 *   7. done     what it means, and the bag where Crew is; done (the item
 *               ticked off) only when step 6 really happened this route.
 *
 * TERRAIN is off in the teaching list, so every step of the route lets it
 * through (TutorialStep `allows`: store/modeOrder.ts terrainTaught). Steps 2
 * to 6 need TERRAIN open: shown with it shut (a reload resumes on the step
 * itself, `resumes`; T or Esc mid-route), the route goes back to step 1, and
 * on to the step it was on once TERRAIN opens. Back at the choices, TERRAIN
 * is shut again, so the next route starts from the pad it knows. Nothing
 * here mines, places or publishes: those are the player's presses, as LIVE
 * or LOCAL says.
 */

import { onTutorialLifecycle, registerTutorialEffect, registerTutorialWatcher, useTutorial } from '../store/useTutorial'
import { hereSurveyedBy, terrainSession, useTerrain } from '../store/useTerrain'
import { enterTerrainMode, leaveTerrain } from '../store/padMode'
import { useCyberspace } from '../store/useCyberspace'
import { TERRAIN_OPEN } from './script'
import type { TutorialStep } from './types'
import { kvGet, kvRemove, kvSet } from '../lib/kvStore'

/** How many blocks the build step asks for. */
export const BUILD_BLOCKS = 3

/** The open step's line for a LIVE player, in place of its hint. */
export const LIVE_NOTE = "Tap TERRAIN (T) to open it. You're LIVE: switch to LOCAL to keep your blocks to yourself."

/** The mine step's line when the survey step found the ground surveyed already. */
export const ALREADY_NOTE: Readonly<Record<'you' | 'someone', string>> = {
  you: 'You surveyed the ground here before. Tap or click a block to mine it (Q).',
  someone: 'Someone already surveyed the ground here. Tap or click a block to mine it (Q).',
}

/** The pick step's line while nothing is carried, and the build step's lines. */
export const NOTHING_CARRIED = 'Nothing carried yet: mine a block first (Q).'
export const OUT_OF_BLOCKS = 'Out of blocks: mine a few more (Q).'
export const PICK_A_BLOCK = 'Pick a block from the hotbar (1 to 9).'
export const placedNote = (n: number): string => `${n} of ${BUILD_BLOCKS} placed.`

/** The step to come back to once TERRAIN opens (a reload, or TERRAIN shut mid-route), by id. */
let returnTo: string | null = null
/** Who had surveyed the ground here when the survey step counted it, or null when the player surveyed it then. */
let alreadyBy: 'you' | 'someone' | null = null

/**
 * Kept per npub while this route is run (lib/kvStore.ts, IndexedDB): the
 * build step really happened (three placed), so the last card is done and
 * the item ticked off, after a reload too. Cleared when the route is picked
 * again or the tutorial restarts. Skipping through to the last card never
 * ticks it (its wait is this).
 */
export const BUILT_PREFIX = 'onosendai:tutorial:terrain-built:'
const builtKey = (): string | null => { const pk = useTutorial.getState().pubkey; return pk ? BUILT_PREFIX + pk : null }
export function builtThisRoute(): boolean { const k = builtKey(); return k !== null && kvGet(k) === '1' }
function setBuilt(on: boolean): void {
  const k = builtKey()
  if (!k) return
  try { if (on) kvSet(k, '1'); else kvRemove(k) } catch { /* private mode: this visit only */ }
}

/** For tests: what the route remembers. */
export function terrainRouteMemory(): { returnTo: string | null; alreadyBy: 'you' | 'someone' | null } {
  return { returnTo, alreadyBy }
}

/** Whether a step is one of the route's. */
export function inTerrainRoute(step: TutorialStep | undefined): boolean {
  return step?.allows?.includes('terrain') ?? false
}

/** The hotbar slot the pick step points at: the one in hand when it holds a block, else the first that does; -1 for none. */
export function slotToPick(inv: { hotbar: readonly number[]; counts: Readonly<Record<number, number>>; slot: number }): number {
  const carries = (i: number): boolean => { const id = inv.hotbar[i]; return !!id && (inv.counts[id] ?? 0) > 0 }
  if (carries(inv.slot)) return inv.slot
  return inv.hotbar.findIndex((_, i) => carries(i))
}

/** The block in hand is one carried. */
function holding(): boolean {
  const inv = useTerrain.getState().inventory
  const id = inv.hotbar[inv.slot]
  return !!id && (inv.counts[id] ?? 0) > 0
}

const tally = (): ReturnType<typeof useTerrain.getState>['tally'] => useTerrain.getState().tally

// --- what each step waits for -------------------------------------------------------------------------------

registerTutorialWatcher('terrain-open', (onDone) => {
  let fired = false
  const check = (): void => { if (!fired && useTerrain.getState().active) { fired = true; onDone() } }
  const off = useTerrain.subscribe(check)
  check()
  return off
})

/**
 * A survey since the step came up, or the chunk you stand in surveyed
 * already, once TERRAIN has read what it kept (a chunk you surveyed on an
 * earlier visit) and nothing is being surveyed now.
 */
registerTutorialWatcher('terrain-survey', (onDone) => {
  // Whatever an earlier visit to this step found is stale: the player may stand somewhere else now.
  alreadyBy = null
  const before = tally().surveyed
  let fired = false
  let stopped = false
  const fire = (by: 'you' | 'someone' | null): void => {
    if (fired || stopped) return
    fired = true
    alreadyBy = by
    onDone()
  }
  const check = (): void => {
    if (fired || stopped) return
    const t = useTerrain.getState()
    if (t.tally.surveyed > before) { fire(null); return }
    if (!t.active || t.loading || t.surveying.length > 0) return
    const s = terrainSession
    if (!s) return
    void s.ready.then(() => {
      if (fired || stopped || terrainSession !== s) return
      const now = useTerrain.getState()
      if (!now.active || now.surveying.length > 0) return
      const by = hereSurveyedBy(s)
      if (by) fire(by)
    })
  }
  const off = useTerrain.subscribe(check)
  // The chunk you stand in changes as you walk, which the store does not say: looked at again now and then.
  const timer = setInterval(check, 500)
  check()
  return () => { stopped = true; off(); clearInterval(timer) }
})

/** One more of `what` than when the step came up (`n` more for the build step). */
function countWatcher(what: 'mined' | 'placed', n = 1) {
  return (onDone: () => void): (() => void) => {
    const before = tally()[what]
    let fired = false
    return useTerrain.subscribe((s) => {
      if (fired || s.tally[what] < before + n) return
      fired = true
      onDone()
    })
  }
}

registerTutorialWatcher('terrain-mine', countWatcher('mined'))
registerTutorialWatcher('terrain-place', countWatcher('placed'))
registerTutorialWatcher('terrain-build', (onDone) => countWatcher('placed', BUILD_BLOCKS)(() => { setBuilt(true); onDone() }))

/** The last card: done (and so ticked off on FINISH) only once the build step really happened this route. */
registerTutorialWatcher('terrain-built', (onDone) => {
  if (builtThisRoute()) onDone()
  return () => {}
})

/** A slot picked that holds a block, or a block placed (which only a block in hand can be). */
registerTutorialWatcher('terrain-pick', (onDone) => {
  const picked = tally().picked
  const placed = tally().placed
  let fired = false
  return useTerrain.subscribe((s) => {
    if (fired) return
    if (s.tally.placed > placed || (s.tally.picked > picked && holding())) {
      fired = true
      onDone()
    }
  })
})

// --- what each step does while it is up ----------------------------------------------------------------------

/** TERRAIN (T) in the card: the pad's own way in (store/padMode.ts), which says why when it cannot. */
registerTutorialEffect('open-terrain', () => { enterTerrainMode() })

/** The step on screen, and whether it still is. */
function stepUp(): { index: number; id: string | undefined; still: () => boolean } {
  const t = useTutorial.getState()
  const index = t.index
  return { index, id: t.script.steps[index]?.id, still: () => useTutorial.getState().active && useTutorial.getState().index === index }
}

/** The first step: a word for a LIVE player, and on to where the route was once TERRAIN opens. */
registerTutorialEffect('terrain-open-step', () => {
  const { index, still } = stepUp()
  const say = (): void => {
    useTutorial.getState().noteStep(index, useCyberspace.getState().live && !useTerrain.getState().active ? LIVE_NOTE : null)
  }
  const onward = (): void => {
    if (!returnTo || !useTerrain.getState().active || !still()) return
    const to = returnTo
    returnTo = null
    queueMicrotask(() => { if (still()) useTutorial.getState().goTo(to) })
  }
  say()
  onward()
  const offs = [
    useCyberspace.subscribe((s, prev) => { if (s.live !== prev.live) say() }),
    useTerrain.subscribe((s, prev) => { if (s.active !== prev.active) { say(); onward() } }),
  ]
  return () => { for (const off of offs) off() }
})

/**
 * Steps 2 to 6: with TERRAIN shut, back to the first step, to come back here
 * once it opens (or to the step after, when this one was already done in the
 * moment before it moved on); and each step's own line or pulse. The last
 * card only on coming up (a reload resumed on it): there T leaves TERRAIN, as
 * it says, and stays on the card.
 */
registerTutorialEffect('terrain-step', () => {
  const { index, id, still } = stepUp()
  const t = useTutorial.getState()
  const step = t.script.steps[index]
  const back = (): void => {
    if (useTerrain.getState().active || !still() || !id) return
    const now = useTutorial.getState()
    returnTo = now.done && step?.wait && step.then ? step.then : id
    queueMicrotask(() => { if (still()) useTutorial.getState().goTo(TERRAIN_OPEN.id) })
  }
  back()
  const offs: Array<() => void> = []
  if (id !== 'terrain-done') offs.push(useTerrain.subscribe((s, prev) => { if (prev.active && !s.active) back() }))

  if (id === 'terrain-mine' && alreadyBy) t.noteStep(index, ALREADY_NOTE[alreadyBy])

  if (id === 'terrain-pick') {
    const point = (): void => {
      const at = slotToPick(useTerrain.getState().inventory)
      useTutorial.getState().noteStep(index, at < 0 ? NOTHING_CARRIED : null)
      useTutorial.getState().highlightStep(index, at < 0 ? '.terrain-crosshair' : `.terrain-hotbar > .terrain-slot:nth-child(${at + 1})`)
    }
    point()
    offs.push(useTerrain.subscribe((s, prev) => { if (s.inventory !== prev.inventory) point() }))
  }

  if (id === 'terrain-build') {
    const before = tally().placed
    const say = (): void => {
      const n = Math.min(BUILD_BLOCKS, tally().placed - before)
      const inv = useTerrain.getState().inventory
      // How many so far, and what to do when the hand is empty: pick another kind, or mine more.
      const lines = [n > 0 ? placedNote(n) : null, holding() ? null : slotToPick(inv) >= 0 ? PICK_A_BLOCK : OUT_OF_BLOCKS].filter((l): l is string => l !== null)
      useTutorial.getState().noteStep(index, lines.length ? lines.join(' ') : null)
    }
    say()
    offs.push(useTerrain.subscribe((s, prev) => { if (s.tally !== prev.tally || s.inventory !== prev.inventory) say() }))
  }

  return () => { for (const off of offs) off() }
})

// --- the route as a whole -------------------------------------------------------------------------------------

/** A run starting or stopping forgets where the route was. */
onTutorialLifecycle({
  start: (_pubkey, restart) => { returnTo = null; alreadyBy = null; if (restart) setBuilt(false) },
  stop: () => { returnTo = null },
})

/**
 * Off the route while the run goes on (FINISH or BACK to the choices, a
 * restart): TERRAIN shuts, so the next route starts from the pad it knows,
 * and where the route was is forgotten. Ending the run leaves TERRAIN as it
 * is: the player has the whole pad then.
 */
useTutorial.subscribe((s, prev) => {
  const was = prev.active ? prev.script.steps[prev.index] : undefined
  const now = s.active ? s.script.steps[s.index] : undefined
  if (was === now) return
  if (!inTerrainRoute(now)) { returnTo = null; alreadyBy = null }
  // The route picked on the choices card: a fresh run of it, built or not.
  if (s.active && was?.choices && now?.id === TERRAIN_OPEN.id) setBuilt(false)
  if (s.active && inTerrainRoute(was) && !inTerrainRoute(now) && useTerrain.getState().active) leaveTerrain()
})
