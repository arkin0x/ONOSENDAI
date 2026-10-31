/**
 * Grid divisions down to a single tick (arkinox, 2026-10-15): every one is
 * exact in 120ths, the stepper walks them in order, the bench draws a
 * readable divisor of the finest, and switching never moves a vertex.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { DIVISIONS, TICKS_PER_UNIT, ticksOf } from 'sno-core/shards'
import { stepDivision } from '../divisions'
import { useWorkshop } from '../../store/useWorkshop'

const w = () => useWorkshop.getState()

describe('the divisions offered', () => {
  it('include the finer steps, never fiftieths, and each divides 120', () => {
    for (const d of [12, 20, 24, 30, 40, 60, 120]) expect(DIVISIONS).toContain(d as never)
    expect(DIVISIONS).not.toContain(50 as never)
    for (const d of DIVISIONS) expect(TICKS_PER_UNIT % d).toBe(0)
  })

  it('the store snaps to whole ticks at every division', () => {
    for (const d of DIVISIONS) {
      w().setDivision(d)
      expect(w().division).toBe(d)
      expect(Number.isInteger(w().step())).toBe(true)
      expect(w().step() * d).toBe(TICKS_PER_UNIT)
    }
  })
})

describe('the stepper', () => {
  it('walks the list finer and coarser and holds at the ends', () => {
    expect(stepDivision(10, 1)).toBe(12)
    expect(stepDivision(12, -1)).toBe(10)
    expect(stepDivision(60, 1)).toBe(120)
    expect(stepDivision(120, 1)).toBe(120)
    expect(stepDivision(1, -1)).toBe(1)
    let d = DIVISIONS[0] as (typeof DIVISIONS)[number]
    const seen: number[] = [d]
    for (let i = 1; i < DIVISIONS.length; i++) { d = stepDivision(d, 1); seen.push(d) }
    expect(seen).toEqual([...DIVISIONS])
  })
})

describe('switching divisions', () => {
  beforeEach(() => {
    useWorkshop.setState({ shards: [], currentId: null, selection: [], past: [], future: [], division: 1 })
    w().create('t')
  })
  it('never moves a vertex already placed', () => {
    w().setDivision(120)
    w().addVertex([1, 2, 3])
    w().setDivision(10)
    w().addVertex([12, 24, -36])
    const before = w().current()!.vertices.map((v) => ticksOf(v))
    for (const d of DIVISIONS) w().setDivision(d)
    expect(w().current()!.vertices.map((v) => ticksOf(v))).toEqual(before)
    expect(before).toEqual([[1, 2, 3], [12, 24, -36]])
  })
})
