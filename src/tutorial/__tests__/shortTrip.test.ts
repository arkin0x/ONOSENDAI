/**
 * shortTrip.test.ts: the tour's first trip is short (new-user write-up,
 * 2026-11-21: a first trip could take 22 minutes to 2.5 days). The tour
 * offers only landfalls a few minutes of computing away on this device
 * (tutorial/shortTrip.ts), refuses a tapped stop further than that, and on
 * a browser that cannot ride at all (#896) offers Earth to look at instead.
 */
import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const m = new Map<string, string>()
  ;(globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
  }
})
const cap = vi.hoisted(() => ({ canRide: true }))
vi.mock('../../lib/proofCapability', async (orig) => ({ ...(await orig() as object), canRideBigints: () => cap.canRide }))
vi.mock('../../lib/relay', async (orig) => ({ ...(await orig() as object), publish: vi.fn(async () => ({ ok: true, accepted: [] })), publishMany: vi.fn(async () => ({ ok: true, accepted: [] })), query: vi.fn(async () => []) }))

import { FALLBACK_TRIP_BLOCKS, SHORT_TRIP_MS, TRIP_COUNT, isShortLength, longestShortRide, shortTripsOn, tripTime, type TripLine } from '../shortTrip'
import { rideEstimateMs, type RideBench } from '../../lib/hyperspace/ridePool'
import { choiceOffered, runTutorialEffect } from '../../store/useTutorial'
import { CHOICE, EARTH_LOOK, EARTH_PICK, EARTH_RIDE, TUTORIAL_SCRIPT } from '../script'
import { RIDE_CANNOT_NOTE } from '../earthRoute'

/** A desktop's pool and a slow phone's (ms per mean block, all workers busy). */
const DESKTOP: RideBench = { msPerBlock: 140 / 8, workers: 8 }
const PHONE: RideBench = { msPerBlock: 2400 / 4, workers: 4 }

/** A line where every other block is a landfall, every block hashed. */
function line(from: number, tip = from + 100_000): TripLine {
  return {
    from,
    tip,
    stopAt: (h) => ({ kind: h % 2 === 0 ? 'landfall' : 'port', coordApprox: BigInt(h) << 128n }),
    hashed: () => true,
  }
}

describe('short trips', () => {
  for (const [name, bench] of [['desktop', DESKTOP], ['slow phone', PHONE], ['not measured yet', null]] as const) {
    it(`never offers a trip longer than a few minutes (${name})`, () => {
      const trips = shortTripsOn(line(870_199), bench)
      expect(trips.length).toBeGreaterThan(0)
      expect(trips.length).toBeLessThanOrEqual(TRIP_COUNT)
      for (const t of trips) {
        expect(t.height).not.toBe(870_199)
        expect(t.height % 2).toBe(0)
        if (bench) expect(rideEstimateMs(t.blocks, bench)).toBeLessThanOrEqual(SHORT_TRIP_MS)
        else expect(t.blocks).toBeLessThanOrEqual(FALLBACK_TRIP_BLOCKS)
      }
      // Nearest first, and no two the same.
      expect(trips.map((t) => t.blocks)).toEqual([...trips.map((t) => t.blocks)].sort((a, b) => a - b))
      expect(new Set(trips.map((t) => t.height)).size).toBe(trips.length)
    })
  }

  it('the trip that took 22 minutes to 2.5 days in the feedback is not short', () => {
    // 9,377 blocks: the ride on the screenshot. On a slow phone it is far past a few minutes.
    expect(isShortLength(9_377, PHONE)).toBe(false)
    expect(isShortLength(517_354, DESKTOP)).toBe(false)
    expect(isShortLength(0, DESKTOP)).toBe(false)
  })

  it('the longest short ride is short, and one block more is not', () => {
    for (const bench of [DESKTOP, PHONE]) {
      const n = longestShortRide(bench)
      expect(n).toBeGreaterThan(0)
      expect(isShortLength(n, bench)).toBe(true)
      expect(isShortLength(n * 4, bench)).toBe(false)
    }
  })

  it('skips blocks without a hash, ports, and anything past the synced tip', () => {
    const l = { ...line(1000, 1003), hashed: (lo: number, hi: number) => !(lo <= 1001 && 1001 <= hi) }
    const trips = shortTripsOn(l, DESKTOP)
    // 1002 needs 1001's hash; 1004 is past the tip; 998 and below are fine.
    for (const t of trips) expect(t.height).toBeLessThan(1000)
  })

  it('says a trip time the way people do', () => {
    expect(tripTime(40_000)).toBe('40 s')
    expect(tripTime(130_000)).toBe('2 min')
    expect(tripTime(3.2 * 3_600_000)).toBe('3.2 h')
    expect(tripTime(60 * 3_600_000)).toBe('2.5 days')
  })
})

describe('the Earth route', () => {
  it('the pick step lists the short trips and explains plainly, with no em dash', () => {
    expect(EARTH_PICK.panel).toBe('earth-trips')
    expect(EARTH_PICK.caption).toMatch(/short trip/)
    expect(`${EARTH_PICK.caption} ${EARTH_PICK.explain} ${EARTH_LOOK.caption}`).not.toMatch(/\u2014|bitcoin/i)
    expect(EARTH_RIDE.effect).toBe('ride-step')
  })

  it('on a browser that can ride, TRAVEL TO EARTH is offered and SEE EARTH is not', () => {
    cap.canRide = true
    runTutorialEffect('ride-check')
    const offered = CHOICE.choices!.filter(choiceOffered).map((c) => c.id)
    expect(offered).toContain('hyperspace')
    expect(offered).not.toContain('earth-look')
  })

  it('a browser that cannot ride (Firefox, Safari) gets SEE EARTH in its place, which ends back on the choices', async () => {
    vi.resetModules()
    cap.canRide = false
    const t = await import('../../store/useTutorial')
    const s = await import('../script')
    await import('../earthRoute')
    t.runTutorialEffect('ride-check')
    const offered = s.CHOICE.choices!.filter(t.choiceOffered).map((c) => c.id)
    expect(offered).toContain('earth-look')
    expect(offered).not.toContain('hyperspace')
    // One panel, its own last step: FINISH returns to the choices, nothing to wait on.
    expect(s.EARTH_LOOK.branch).toBe(true)
    expect(s.EARTH_LOOK.then).toBeUndefined()
    expect(s.EARTH_LOOK.wait).toBeUndefined()
    expect(TUTORIAL_SCRIPT.steps.some((st) => st.id === 'earth-look')).toBe(true)
    // Walked: SEE EARTH, then FINISH back to the choices with it checked off.
    t.useTutorial.setState({ script: s.TUTORIAL_SCRIPT, doneChoices: [] })
    t.useTutorial.getState().start({ at: 'choice' })
    t.useTutorial.getState().choose('earth-look')
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    const at = (): string => t.useTutorial.getState().script.steps[t.useTutorial.getState().index].id
    expect(at()).toBe('earth-look')
    t.useTutorial.getState().next()
    expect(at()).toBe('choice')
    expect(t.useTutorial.getState().doneChoices).toEqual(['earth-look'])
    t.useTutorial.getState().pause()
  })

  it('the RIDE step on such a browser says why and how to go on', () => {
    expect(RIDE_CANNOT_NOTE).toMatch(/Chrome, Edge or Brave/)
    expect(RIDE_CANNOT_NOTE).toMatch(/SKIP/)
    expect(EARTH_RIDE.gate).not.toBe(true)
  })
})
