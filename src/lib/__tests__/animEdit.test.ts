/**
 * animEdit.test.ts: the motion editor's rules (lib/animEdit.ts). Presets
 * write the canonical motions, sized for the object; the controls' units
 * convert both ways (cycles a minute <-> c/b a block in lowest terms, gibsons
 * <-> ticks at the object's unit, the workshop's Z <-> the field's Z); every
 * limit of DECK-0003 §1.14 holds with a plain message; and whatever an edit
 * makes, a reader reads it back unchanged.
 */
import { describe, expect, it } from 'vitest'
import { readAnim, readMotion, writeMotion, MAX_RATE, REACH, type Motion } from '../anim'
import {
  addPoint, addPreset, amountOf, bestRational, cycleBlocks, gibsonsOf, LIMITS, listOf, moveMotion, movePoint, objectReach, perMinute, pointsOf, PRESETS,
  rateFor, rawOf, removeMotion, removePoint, reverse, setAmount, setAxis, setPhase, setPoint, setRest, setSpeed, stepSpeed, ticksOf, type Edited,
} from '../animEdit'

const T = 660.721 // seconds a paced block, about the pace of November 2026
const m = (raw: unknown): Motion => readMotion(raw)!
/** What a reader reads back from an edit's list, as written. */
const roundTrip = (e: Edited): unknown[][] => rawOf(listOf(rawOf(e.list)))

describe('presets write the canonical motions', () => {
  const size = 600
  const want: Record<string, unknown[]> = {
    spin: ['turn', 'y', 30, 1, 0],
    bob: ['slide', 'y', 75, 120, 1, 0],
    pendulum: ['swing', 'x', 30, 60, 1, 0],
    slide: ['slide', 'x', 600, 40, 1, 0],
    elevator: ['lift', 'y', 1200, 25, 20, 1, 0],
    orbit: ['orbit', 'z', 600, 20, 1, 0],
    path: ['path', 10, 1, 0, [600, 0, 0, 1], [0, 0, 0, 1]],
  }
  for (const p of PRESETS) {
    it(`${p.label} writes ${JSON.stringify(want[p.id])}`, () => {
      const e = addPreset([], p.id, size)
      expect(rawOf(e.list)).toEqual([want[p.id]])
      expect(roundTrip(e)).toEqual([want[p.id]])
    })
  }
  it('names live in the editor, never the data', () => {
    expect(PRESETS.map((p) => p.label)).toEqual(['SPIN', 'BOB', 'PENDULUM', 'BACK AND FORTH', 'ELEVATOR', 'FERRIS WHEEL', 'FOLLOW PATH'])
    for (const p of PRESETS) expect(['turn', 'swing', 'slide', 'orbit', 'lift', 'path']).toContain(p.make(240)[0])
  })
  it('size with the object, within the field\'s range', () => {
    expect(objectReach({ vertices: [{ p: [0, 0, 0], c: [1, 1, 1] }] } as never)).toBe(120)
    expect(objectReach({ vertices: [{ p: [3, -5, 1], c: [1, 1, 1] }] } as never)).toBe(600)
    expect(rawOf(addPreset([], 'slide', 99_999).list)[0][2]).toBe(REACH)
    expect(rawOf(addPreset([], 'bob', 120).list)[0][2]).toBe(15)
  })
  it('a fifth is refused with a plain message', () => {
    let list: Motion[] = []
    for (let i = 0; i < 4; i++) list = addPreset(list, 'spin', 120).list
    const e = addPreset(list, 'bob', 120)
    expect(e.list).toHaveLength(4)
    expect(e.note).toBe('Up to 4 motions')
  })
})

describe('speed: cycles a minute <-> c/b a block, lowest terms', () => {
  it('shows c/b as cycles a minute at today\'s pace', () => {
    expect(perMinute({ c: 30, b: 1 }, T)).toBeCloseTo(2.724, 3)
    expect(perMinute({ c: -1, b: 4 }, 600)).toBeCloseTo(-0.025, 6)
  })
  it('stores a typed speed as the nearest small fraction, in lowest terms, that reads back the same to two decimals', () => {
    for (const perMin of [0.1, 0.5, 1, 2.72, 3, 10, 25, 50]) {
      const r = rateFor(perMin, T)
      expect(Number.isInteger(r.c) && Number.isInteger(r.b)).toBe(true)
      expect(r.b).toBeGreaterThanOrEqual(1)
      expect(Math.abs(perMinute(r, T) - perMin)).toBeLessThan(0.006)
      const g = (a: number, b: number): number => (b ? g(b, a % b) : a)
      expect(g(Math.abs(r.c), r.b)).toBe(1)
    }
    expect(rateFor(-3, T).c).toBeLessThan(0)
  })
  it('clamps to 600 a block with a message, and never stops', () => {
    expect(rateFor(10_000, T)).toEqual({ c: MAX_RATE, b: 1, note: LIMITS.speed })
    expect(rateFor(0, T)).toEqual({ c: 1, b: 1000, note: LIMITS.slowest })
  })
  it('best rational: exact for simple fractions', () => {
    expect(bestRational(0.25)).toEqual({ c: 1, b: 4 })
    expect(bestRational(30)).toEqual({ c: 30, b: 1 })
    expect(bestRational(2 / 3)).toEqual({ c: 2, b: 3 })
  })
  it('the steppers walk a list of round speeds, keeping the direction', () => {
    expect(stepSpeed(2.72, 1)).toBe(3)
    expect(stepSpeed(2.72, -1)).toBe(2.5)
    expect(stepSpeed(-2.72, 1)).toBe(-3)
    expect(stepSpeed(50, 1)).toBe(50)
  })
  it('setSpeed and reverse write c/b', () => {
    const list = [m(['turn', 'y', 30, 1, 0])]
    expect(rawOf(setSpeed(list, 0, perMinute({ c: 1, b: 2 }, T), T).list)).toEqual([['turn', 'y', 1, 2, 0]])
    expect(rawOf(reverse(list, 0).list)).toEqual([['turn', 'y', -30, 1, 0]])
  })
})

describe('amounts: degrees, and gibsons <-> ticks at the object\'s unit', () => {
  it('converts both ways', () => {
    expect(gibsonsOf(120, 0)).toBe(1)
    expect(gibsonsOf(120, 3)).toBe(8)
    expect(ticksOf(1, 0)).toBe(120)
    expect(ticksOf(8, 3)).toBe(120)
    expect(ticksOf(0.25, 0)).toBe(30)
  })
  it('a slide\'s reach, a radius, a pendulum\'s degrees', () => {
    const list = readAnim([['slide', 'x', 120, 1, 1, 0], ['orbit', 'y', 240, 1, 1, 0], ['swing', 'z', 30, 1, 1, 0]])
    expect(amountOf(list[0], 0)).toBe(1)
    expect(rawOf(setAmount(list, 0, 2.5, 0).list)[0]).toEqual(['slide', 'x', 300, 1, 1, 0])
    expect(rawOf(setAmount(list, 1, 4, 2).list)[1]).toEqual(['orbit', 'y', 120, 1, 1, 0])
    expect(rawOf(setAmount(list, 2, 45, 0).list)[2]).toEqual(['swing', 'z', 45, 1, 1, 0])
  })
  it('limits: within 64 units, never zero, a pendulum 1 to 180 degrees', () => {
    const list = readAnim([['slide', 'x', 120, 1, 1, 0], ['swing', 'z', 30, 1, 1, 0], ['lift', 'y', 240, 10, 1, 1, 0]])
    expect(setAmount(list, 0, 1000, 0)).toMatchObject({ note: LIMITS.reach })
    expect(rawOf(setAmount(list, 0, 1000, 0).list)[0][2]).toBe(REACH)
    expect(rawOf(setAmount(list, 0, -5, 0).list)[0][2]).toBe(1)
    expect(rawOf(setAmount(list, 1, 400, 0).list)[1][2]).toBe(180)
    expect(rawOf(setAmount(list, 1, 0, 0).list)[1][2]).toBe(1)
    expect(rawOf(setAmount(list, 2, 0, 0).list)[2][2]).toBe(1)
    expect(rawOf(setAmount(list, 2, -2, 0).list)[2][2]).toBe(-240)
  })
  it('an elevator\'s travel along Z is negated between the workshop\'s frame and the field\'s', () => {
    const list = [m(['lift', 'z', 240, 10, 1, 1, 0])]
    expect(amountOf(list[0], 0)).toBe(-2)
    expect(rawOf(setAmount(list, 0, 3, 0).list)[0]).toEqual(['lift', 'z', -360, 10, 1, 1, 0])
  })
  it('rest share 0 to 49 at each stop', () => {
    const list = [m(['lift', 'y', 240, 25, 1, 1, 0])]
    expect(rawOf(setRest(list, 0, 30).list)[0]).toEqual(['lift', 'y', 240, 30, 1, 1, 0])
    expect(rawOf(setRest(list, 0, 80).list)[0][3]).toBe(49)
    expect(rawOf(setRest(list, 0, -5).list)[0][3]).toBe(0)
  })
  it('phase wraps into 0..359, the axis changes', () => {
    const list = [m(['turn', 'y', 1, 1, 0])]
    expect(rawOf(setPhase(list, 0, -15).list)[0]).toEqual(['turn', 'y', 1, 1, 345])
    expect(rawOf(setPhase(list, 0, 375).list)[0]).toEqual(['turn', 'y', 1, 1, 15])
    expect(rawOf(setAxis(list, 0, 0).list)[0]).toEqual(['turn', 'x', 1, 1, 0])
  })
})

describe('the list and a path\'s points', () => {
  it('reorders and removes motions; order is meaning', () => {
    const list = readAnim([['turn', 'y', 1, 1, 0], ['slide', 'x', 120, 1, 1, 0]])
    expect(rawOf(moveMotion(list, 1, -1).list).map((x) => x[0])).toEqual(['slide', 'turn'])
    expect(rawOf(moveMotion(list, 0, -1).list).map((x) => x[0])).toEqual(['turn', 'slide'])
    expect(rawOf(removeMotion(list, 0).list).map((x) => x[0])).toEqual(['slide'])
  })
  it('adds a point before the last (the home point stays last), up to 32, and keeps at least 2', () => {
    let list = [m(['path', 1, 1, 0, [600, 0, 0, 1], [0, 0, 0, 1]])]
    list = addPoint(list, 0).list
    expect(rawOf(list)[0].slice(4)).toEqual([[600, 0, 0, 1], [600, 120, 0, 1], [0, 0, 0, 1]])
    for (let i = 0; i < 40; i++) list = addPoint(list, 0).list
    expect(list[0].pts.length / 4).toBe(32)
    expect(addPoint(list, 0).note).toBe('Up to 32 points')
    const two = [m(['path', 1, 1, 0, [600, 0, 0, 1], [0, 0, 0, 1]])]
    expect(removePoint(two, 0, 0)).toMatchObject({ note: 'A path needs 2 points' })
    expect(rawOf(movePoint(two, 0, 0, 1).list)[0].slice(4)).toEqual([[0, 0, 0, 1], [600, 0, 0, 1]])
  })
  it('points in gibsons, Z in the workshop\'s frame; times written with no common factor', () => {
    const list = [m(['path', 1, 1, 0, [120, 240, -360, 2], [0, 0, 0, 2]])]
    expect(pointsOf(list[0], 0)[0]).toEqual({ x: 1, y: 2, z: 3, time: 2 })
    expect(rawOf(list)[0].slice(4)).toEqual([[120, 240, -360, 1], [0, 0, 0, 1]])
    expect(rawOf(setPoint(list, 0, 0, 'z', -1, 0).list)[0][4]).toEqual([120, 240, 120, 1])
    expect(rawOf(setPoint(list, 0, 1, 'time', 6, 0).list)[0].slice(4)).toEqual([[120, 240, -360, 1], [0, 0, 0, 3]])
    expect(setPoint(list, 0, 0, 'x', 500, 0).note).toBe(LIMITS.reach)
    const capped = setPoint(list, 0, 0, 'time', 5000, 0)
    expect(capped.list[0].pts[3]).toBe(1000)
    expect(capped.note).toBe(LIMITS.reach)
    // Written with no common factor: 1000 and 2 are 500 and 1.
    expect(rawOf(capped.list)[0].slice(4).map((p) => (p as number[])[3])).toEqual([500, 1])
  })
  it('the scrub runs through the longest motion\'s cycle', () => {
    expect(cycleBlocks([{ c: 30, b: 1 }, { c: 1, b: 4 }])).toBe(4)
    expect(cycleBlocks([])).toBe(1)
  })
  it('whatever an edit makes, a reader reads back unchanged', () => {
    let list: Motion[] = []
    for (const id of ['spin', 'elevator', 'path', 'orbit'] as const) list = addPreset(list, id, 777).list
    list = setSpeed(list, 1, 7.3, T).list
    list = setAmount(list, 3, 9.75, 1).list
    list = addPoint(list, 2).list
    list = setPoint(list, 2, 1, 'y', -4.5, 0).list
    const raw = rawOf(list)
    expect(readAnim(raw).map(writeMotion)).toEqual(raw)
  })
})
