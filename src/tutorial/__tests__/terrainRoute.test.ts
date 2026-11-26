/**
 * terrainRoute.test.ts - SURVEY AND BUILD, the last "Where next?" route
 * (owner, 2026-11-26: "we should add surveying as an optional tutorial item
 * to the end tutorial list"; "it needs to walk them through mining and
 * building too"; "Survey is G btw"), on the real terrain store:
 *
 * - the item is on the end list, last, with TERRAIN's icon, and its route is
 *   seven steps with every key printed beside its button;
 * - each step is done by the real thing: TERRAIN open, a survey (or ground
 *   surveyed already, said on the next step), a block mined, a slot picked, a
 *   block placed, three more; FINISH ticks the item off;
 * - SKIP passes a step, the ✕ ends the run;
 * - a reload resumes on the step it was on: TERRAIN shut sends it to the
 *   first step, and opening TERRAIN comes back;
 * - back at the choices TERRAIN shuts;
 * - completion is kept per npub, in IndexedDB;
 * - a newcomer mid-tour can open TERRAIN on the route (T, the card's button,
 *   the mode ring), and nowhere else in the tour.
 */

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    get length() { return mem.size },
    key: (i: number) => [...mem.keys()][i] ?? null,
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { useCyberspace } from '../../store/useCyberspace'
import { useWalk } from '../../store/useWalk'
import { ADVANCE_MS, choiceOffered, routeOf, runTutorialEffect, useTutorial } from '../../store/useTutorial'
import { setTerrainSession, terrainSession, useTerrain } from '../../store/useTerrain'
import { currentPadMode, enterTerrainMode } from '../../store/padMode'
import { TEACHING_MODES, TERRAIN_TEACHING_MODES, effectiveModes, terrainTaught } from '../../store/modeOrder'
import { useNewcomer } from '../../newcomer/useNewcomer'
import { chunkKey, chunkOf } from '../../lib/terrain/coords'
import { EMPTY } from '../../lib/terrain/blocks'
import { hydrateKv, kvFlush, kvSet, movesToKv, resetKvForTests } from '../../lib/kvStore'
import { PROGRESS_PREFIX, readProgress, setTutorialSwitch } from '../gate'
import { CHOICE, TUTORIAL_SCRIPT } from '../script'
import { CHOICE_ICONS } from '../../hud/TutorialCoach'
import { ALREADY_NOTE, BUILD_BLOCKS, BUILT_PREFIX, LIVE_NOTE, NOTHING_CARRIED, OUT_OF_BLOCKS, builtThisRoute, placedNote, slotToPick, terrainRouteMemory } from '../terrainRoute'
import type { Position } from '../../lib/space'

const HEAD = { x: 0x1234567890abcdef12350n, y: 0xfedcba0987654321fed90n, z: 0x0f0f0f0f0f0f0f0f0f0f0n }
const ROUTE = ['terrain-open', 'terrain-survey', 'terrain-mine', 'terrain-pick', 'terrain-place', 'terrain-build', 'terrain-done']
const T = () => useTerrain.getState()
const tut = () => useTutorial.getState()
const stepId = (): string | undefined => tut().script.steps[tut().index]?.id
const stepOf = (id: string) => TUTORIAL_SCRIPT.steps.find((s) => s.id === id)!
const settle = (ms = 40): Promise<void> => new Promise((r) => setTimeout(r, ms))

let run = 0
let A = ''

function as(pubkey: string, at: Position = HEAD): void {
  useCyberspace.setState({ identity: { pubkey, npub: '' }, position: { ...at }, cursor: { ...at }, anchor: { ...at }, plane: 0, walking: false, spectate: null, exploreIndex: null, transit: null, live: false })
}

/** Gone as a reload leaves it: no exit, nothing folded. */
function reload(): void {
  setTerrainSession(null)
  useTerrain.setState({ active: false, loading: false })
  useCyberspace.setState({ walking: false })
}

const headKey = (): string => chunkKey(chunkOf(HEAD.x, HEAD.y, HEAD.z, 0))

/** A solid cell with a solid one under it, in the chunk round the head and clear of where you stand: mined, then put back on the face below. */
function cellToMine(): [number, number, number] {
  const s = terrainSession!
  for (let y = 1; y < 32; y++) for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) {
    if (x === 16 && y === 16 && z === 16) continue
    if (s.world.blockCs(x, y, z) !== EMPTY && s.world.blockCs(x, y - 1, z) !== EMPTY) return [x, y, z]
  }
  throw new Error('no solid cell')
}
const mineAt = (c: [number, number, number]): boolean => T().mine({ cell: c, normal: [0, 1, 0], distance: 1 })
const placeAt = (c: [number, number, number]): boolean => T().place({ cell: [c[0], c[1] - 1, c[2]], normal: [0, 1, 0], distance: 1 })

/** The run on the choices card, then SURVEY AND BUILD picked. */
function chooseTerrain(): void {
  tut().start({ at: 'choice' })
  expect(stepId()).toBe('choice')
  tut().choose('terrain')
}

beforeEach(async () => {
  if (tut().active) tut().pause()
  if (T().active) await T().exit()
  reload()
  run++
  A = run.toString(16).padStart(64, 'c')
  useWalk.setState({ gravity: false })
  useTutorial.setState({ script: TUTORIAL_SCRIPT, doneChoices: [] })
  useNewcomer.setState({ pubkey: null, record: { seen: [] } })
  setTutorialSwitch(true)
  as(A)
})

describe('the end list', () => {
  it('offers SURVEY AND BUILD last, with TERRAIN\'s icon, going to a route of seven steps', () => {
    const offered = CHOICE.choices!.filter(choiceOffered)
    const last = offered[offered.length - 1]
    expect(last.id).toBe('terrain')
    expect(last.label).toBe('SURVEY AND BUILD')
    expect(last.about).toContain('TERRAIN (T)')
    expect(CHOICE_ICONS.terrain).toBeDefined()
    expect(routeOf(TUTORIAL_SCRIPT.steps, 'terrain-open')).toEqual(ROUTE)
    for (const id of ROUTE) {
      const s = stepOf(id)
      expect(s.branch, id).toBe(true)
      expect(s.allows, id).toEqual(['terrain'])
      expect(s.modal, id).toBeUndefined()
    }
  })

  it('prints every key beside its button, and says no em dash', () => {
    const said = (id: string): string => { const s = stepOf(id); return [s.title, s.caption, s.captionDone, s.hint, s.explain, s.action?.label].filter(Boolean).join(' ') }
    expect(stepOf('terrain-open').action?.label).toBe('TERRAIN (T)')
    expect(said('terrain-open')).toContain('LOCAL keeps your blocks to yourself')
    expect(said('terrain-survey')).toContain('SURVEY (G)')
    expect(said('terrain-mine')).toContain('(Q)')
    expect(said('terrain-mine')).toMatch(/[Tt]ap or click/)
    expect(said('terrain-pick')).toContain('1 to 9')
    expect(said('terrain-pick')).toContain('wheel')
    expect(said('terrain-place')).toContain('PLACE (E)')
    expect(said('terrain-place')).toContain('right click')
    expect(said('terrain-build')).toContain('PLACE (E)')
    expect(said('terrain-done')).toContain('bag (I)')
    expect(said('terrain-done')).toContain('Crew')
    expect(stepOf('terrain-done').captionDone).toContain('FINISH leaves TERRAIN')
    expect(stepOf('terrain-done').keepPulse).toBe(true)
    for (const line of [...ROUTE.map(said), LIVE_NOTE, ...Object.values(ALREADY_NOTE), NOTHING_CARRIED, OUT_OF_BLOCKS, CHOICE.choices!.find((c) => c.id === 'terrain')!.about]) {
      expect(line).not.toContain('—')
    }
  })
})

describe('each step is done by the real thing', () => {
  it('open, survey, mine, pick, place, build three, then FINISH ticks the item off', async () => {
    chooseTerrain()
    expect(stepId()).toBe('terrain-open')
    expect(tut().done).toBe(false)

    // 1. TERRAIN (T) in the card (the T key is the same call: hooks/useKeyboard.ts enterTerrainMode).
    runTutorialEffect('open-terrain')
    await settle(60)
    expect(T().active).toBe(true)
    expect(tut().done).toBe(true)
    // On by itself after the ✓.
    await settle(ADVANCE_MS + 60)
    expect(stepId()).toBe('terrain-survey')

    // 2. Unsurveyed ground waits for SURVEY; the survey counts it.
    await terrainSession!.ready
    await settle(600)
    expect(tut().done).toBe(false)
    await T().survey(headKey())
    expect(tut().done).toBe(true)
    expect(terrainRouteMemory().alreadyBy).toBe(null)
    tut().next()
    expect(stepId()).toBe('terrain-mine')
    // Surveyed by the player just now: no "already" line.
    expect(tut().stepNote).toBe(null)

    // 3. A block mined.
    const c = cellToMine()
    expect(mineAt(c)).toBe(true)
    expect(tut().done).toBe(true)
    tut().next()
    expect(stepId()).toBe('terrain-pick')

    // 4. The slot holding the block glows; picking it counts.
    const at = slotToPick(T().inventory)
    expect(at).toBeGreaterThanOrEqual(0)
    expect(tut().stepHighlight).toBe(`.terrain-hotbar > .terrain-slot:nth-child(${at + 1})`)
    T().selectSlot(at)
    expect(tut().done).toBe(true)
    tut().next()
    expect(stepId()).toBe('terrain-place')

    // 5. Placed.
    expect(placeAt(c)).toBe(true)
    expect(tut().done).toBe(true)
    tut().next()
    expect(stepId()).toBe('terrain-build')

    // 6. Three more, counted on the card; out of blocks says so.
    expect(tut().stepNote).toBe(OUT_OF_BLOCKS)
    for (let i = 1; i <= BUILD_BLOCKS; i++) {
      expect(mineAt(c)).toBe(true)
      expect(tut().stepNote).toBe(i === 1 ? null : placedNote(i - 1))
      expect(placeAt(c)).toBe(true)
      // Each one placed is the last carried here: the count, then what to do next.
      if (i < BUILD_BLOCKS) { expect(tut().done).toBe(false); expect(tut().stepNote).toBe(`${placedNote(i)} ${OUT_OF_BLOCKS}`) }
    }
    expect(tut().done).toBe(true)
    expect(builtThisRoute()).toBe(true)
    tut().next()
    expect(stepId()).toBe('terrain-done')
    // Built this route: the last card is done (and the item ticked) and stays for FINISH.
    expect(tut().done).toBe(true)
    await settle(ADVANCE_MS + 60)
    expect(stepId()).toBe('terrain-done')

    // 7. FINISH: back at the choices with the item checked off, and TERRAIN shut.
    tut().next()
    expect(stepId()).toBe('choice')
    expect(tut().doneChoices).toContain('terrain')
    expect(readProgress(A)?.choices).toContain('terrain')
    expect(T().active).toBe(false)
    expect(currentPadMode()).toBe('hop')
  })

  it('ground surveyed already counts at once, and the next step says so', async () => {
    // Surveyed on an earlier visit, outside the tour.
    await T().enter()
    await terrainSession!.ready
    await T().survey(headKey())
    await T().exit()
    chooseTerrain()
    runTutorialEffect('open-terrain')
    await settle(60)
    tut().next()
    expect(stepId()).toBe('terrain-survey')
    await terrainSession!.ready
    await settle(120)
    expect(tut().done).toBe(true)
    expect(terrainRouteMemory().alreadyBy).toBe('you')
    tut().next()
    expect(stepId()).toBe('terrain-mine')
    expect(tut().stepNote).toBe(ALREADY_NOTE.you)
    // Off the route, the finding is forgotten: no stale line on a later visit.
    tut().goTo('choice')
    expect(terrainRouteMemory().alreadyBy).toBe(null)
  })

  it('a LIVE player hears that LOCAL keeps the blocks on the device', () => {
    useCyberspace.setState({ live: true })
    chooseTerrain()
    expect(tut().stepNote).toBe(LIVE_NOTE)
    useCyberspace.setState({ live: false })
    expect(tut().stepNote).toBe(null)
  })
})

describe('skip, close, resume', () => {
  it('the first step cannot be skipped (every later one needs TERRAIN): BACK and the ✕ are the ways out', () => {
    chooseTerrain()
    expect(stepOf('terrain-open').gate).toBe(true)
    tut().next()
    expect(stepId()).toBe('terrain-open')
    tut().back()
    expect(stepId()).toBe('choice')
  })

  it('skipping through to the last card ticks nothing off', async () => {
    chooseTerrain()
    runTutorialEffect('open-terrain')
    await settle(60)
    for (let i = 0; i < 6; i++) tut().next()
    expect(stepId()).toBe('terrain-done')
    expect(tut().done).toBe(false)
    tut().next()
    expect(stepId()).toBe('choice')
    expect(tut().doneChoices).not.toContain('terrain')
  })

  it('picking the route again starts it fresh: the last build no longer counts', () => {
    kvSet(BUILT_PREFIX + A, '1')
    chooseTerrain()
    expect(builtThisRoute()).toBe(false)
  })

  it('SKIP passes a step still waiting, and the ✕ ends the run', async () => {
    chooseTerrain()
    runTutorialEffect('open-terrain')
    await settle(60)
    tut().next()
    expect(stepId()).toBe('terrain-survey')
    expect(tut().done).toBe(false)
    // SKIP (NEXT while waiting) goes on along the route.
    tut().next()
    expect(stepId()).toBe('terrain-mine')
    tut().end('skipped')
    expect(tut().active).toBe(false)
    expect(readProgress(A)?.ended).toBe('skipped')
  })

  it('a reload resumes on the step it was on: TERRAIN shut, it opens TERRAIN first, then comes back', async () => {
    chooseTerrain()
    runTutorialEffect('open-terrain')
    await settle(60)
    tut().next()
    tut().next()
    expect(stepId()).toBe('terrain-mine')
    expect(readProgress(A)?.step).toBe('terrain-mine')
    // The page goes: nothing kept but the progress.
    tut().pause()
    reload()
    tut().start({ at: readProgress(A)!.step })
    await settle(0)
    expect(stepId()).toBe('terrain-open')
    expect(terrainRouteMemory().returnTo).toBe('terrain-mine')
    runTutorialEffect('open-terrain')
    await settle(60)
    expect(stepId()).toBe('terrain-mine')
  })

  it('a reload on the last card with TERRAIN shut opens TERRAIN first, then comes back to it', async () => {
    kvSet(BUILT_PREFIX + A, '1')
    tut().start({ at: 'terrain-done' })
    await settle(0)
    expect(stepId()).toBe('terrain-open')
    runTutorialEffect('open-terrain')
    await settle(60)
    expect(stepId()).toBe('terrain-done')
    expect(tut().done).toBe(true)
    // T on the last card leaves TERRAIN, as the card says, and the card stays.
    await T().exit()
    await settle(0)
    expect(stepId()).toBe('terrain-done')
  })

  it('TERRAIN shut in the moment after a step was done goes on to the next step, not back to it', async () => {
    chooseTerrain()
    runTutorialEffect('open-terrain')
    await settle(60)
    tut().next()
    tut().next()
    expect(stepId()).toBe('terrain-mine')
    await terrainSession!.ready
    await T().survey(headKey())
    expect(mineAt(cellToMine())).toBe(true)
    expect(tut().done).toBe(true)
    await T().exit()
    await settle(0)
    expect(stepId()).toBe('terrain-open')
    expect(terrainRouteMemory().returnTo).toBe('terrain-pick')
  })

  it('TERRAIN shut mid-route goes back to opening it, and on to the same step', async () => {
    chooseTerrain()
    runTutorialEffect('open-terrain')
    await settle(60)
    tut().next()
    tut().next()
    tut().next()
    expect(stepId()).toBe('terrain-pick')
    await T().exit()
    await settle(0)
    expect(stepId()).toBe('terrain-open')
    runTutorialEffect('open-terrain')
    await settle(60)
    expect(stepId()).toBe('terrain-pick')
  })

  it('BACK off the route shuts TERRAIN and keeps nothing checked', async () => {
    chooseTerrain()
    runTutorialEffect('open-terrain')
    await settle(60)
    tut().back()
    expect(stepId()).toBe('choice')
    expect(T().active).toBe(false)
    expect(tut().doneChoices).not.toContain('terrain')
  })
})

describe('a newcomer mid-tour', () => {
  beforeEach(() => { useNewcomer.setState({ pubkey: A, record: { stage: 'newcomer', seen: [] } }) })

  it('opens TERRAIN only on the route: by T (enterTerrainMode), the card, and the mode ring', async () => {
    tut().start({ at: 'choice' })
    expect(terrainTaught()).toBe(false)
    expect(effectiveModes()).toBe(TEACHING_MODES)
    expect(enterTerrainMode()).toBe(false)
    await settle(20)
    expect(T().active).toBe(false)
    tut().choose('terrain')
    expect(terrainTaught()).toBe(true)
    expect(effectiveModes()).toBe(TERRAIN_TEACHING_MODES)
    expect(effectiveModes().off).not.toContain('terrain')
    expect(enterTerrainMode()).toBe(true)
    await settle(60)
    expect(T().active).toBe(true)
    expect(tut().done).toBe(true)
  })
})

describe('kept per npub, in IndexedDB', () => {
  afterAll(() => { resetKvForTests() })

  it('the progress record is one the database keeps, and so is the route\'s', () => {
    expect(movesToKv(PROGRESS_PREFIX + A)).toBe(true)
    expect(movesToKv(BUILT_PREFIX + A)).toBe(true)
  })

  it('the item ticked off reads back after a reload from IndexedDB, for that npub only', async () => {
    resetKvForTests()
    ;(globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory()
    expect(await hydrateKv()).toBe('idb')
    useTutorial.setState({ doneChoices: [] })
    // Built this route before a reload (kept in IndexedDB too), resumed on the last card.
    kvSet(BUILT_PREFIX + A, '1')
    tut().start({ at: 'terrain-done' })
    await settle(0)
    runTutorialEffect('open-terrain')
    await settle(60)
    expect(stepId()).toBe('terrain-done')
    tut().next()
    expect(tut().doneChoices).toEqual(['terrain'])
    expect(await kvFlush()).toBe(true)
    // Not in localStorage: the database has it.
    expect(localStorage.getItem(PROGRESS_PREFIX + A)).toBe(null)
    resetKvForTests()
    expect(await hydrateKv()).toBe('idb')
    expect(readProgress(A)?.choices).toEqual(['terrain'])
    expect(readProgress('d'.repeat(64))).toBe(null)
  })
})
