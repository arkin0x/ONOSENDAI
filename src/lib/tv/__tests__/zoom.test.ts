/**
 * zoom.test.ts: a Cyberspace TV trip's zoom follows its moves (arkinox,
 * 2026-10-23: "Would we be able to zoom out to 2^17 when the actual larger
 * move is coming up?").
 */
import { describe, expect, it } from 'vitest'
import type { ActionEvent } from '../../events'
import { Director, JUMP_S, type Beat, type Shot } from '../director'
import { GLIDE_S, MIN_HOLD_S, WIDE_HOLD_S, ZOOM_MAX_S, ZOOM_SETTLE_S, fitScale, moveScale, scaleAt, zoomPlan, type ZoomStep } from '../zoom'

let n = 0
/** A move along x of `size` gibsons, from where the last one ended. */
function chain(pubkey: string, moves: Array<{ at: number; size: bigint; type?: ActionEvent['type'] }>): Beat[] {
  let x = 1n << 30n
  return moves.map((m) => {
    const id = (n++).toString(16).padStart(64, '0')
    const from = x
    if (m.type !== 'spawn') x += m.size
    return {
      id,
      pubkey,
      at: m.at,
      action: { id, pubkey, createdAt: m.at, type: m.type ?? 'hop', name: m.type ?? 'hop', role: 'base', coordHex: '', position: { x, y: 0n, z: 0n }, plane: 0 as 0, prevCoordHex: '', genesisId: null, previousId: null, proofHash: null, sector: '' },
      from: { position: { x: from, y: 0n, z: 0n }, plane: 0 },
    }
  })
}

/** The one trip the director makes of `beats`. */
function trip(beats: Beat[]): Shot {
  const d = new Director()
  for (const b of beats) d.add(b)
  const shots = d.release(Infinity)
  expect(shots).toHaveLength(1)
  return shots[0]
}

const planOf = (s: Shot): ZoomStep[] => zoomPlan(s.beats, s.offsets, s.length, s.prelude ?? 0)

/** How many times the zoom turns round: in after out, or out after in. */
function reversals(plan: ZoomStep[]): number {
  let turns = 0
  let dir = 0
  for (let i = 1; i < plan.length; i++) {
    const d = Math.sign(plan[i].scaleExp - plan[i - 1].scaleExp)
    if (d !== 0 && dir !== 0 && d !== dir) turns++
    if (d !== 0) dir = d
  }
  return turns
}

const TINY = 16n
const BIG = 1n << 17n

describe('zoomPlan', () => {
  it('plays a run of tiny moves fine, then zooms out before the big one starts', () => {
    // The 2026-10-23 broadcast: XOR's seventeen nudges, then the hop that took the shot to 2^17.
    const moves = Array.from({ length: 17 }, (_, i) => ({ at: i, size: TINY }))
    const shot = trip(chain('xor', [...moves, { at: 18, size: BIG }]))
    const plan = planOf(shot)
    const big = shot.offsets[17]
    const fine = moveScale(shot.beats[0], true)!
    const wide = moveScale(shot.beats[17], false)!
    expect(wide).toBeGreaterThan(fine + 8)
    // Fine from the start and over every tiny move...
    expect(plan[0].scaleExp).toBe(fine)
    for (let i = 0; i < 17; i++) expect(scaleAt(plan, shot.offsets[i])).toBe(fine)
    // ...wide when the big move starts, and it started zooming out before it.
    expect(scaleAt(plan, big)).toBe(wide)
    const out = plan.slice(1)
    expect(out.length).toBe(wide - fine)
    expect(Math.min(...out.map((s) => s.at))).toBeLessThan(big)
    expect(Math.max(...out.map((s) => s.at))).toBeLessThanOrEqual(big - ZOOM_SETTLE_S + 1e-9)
    // One power of two a step, never longer than ZOOM_MAX_S in all.
    out.forEach((s, i) => expect(s.scaleExp).toBe(fine + i + 1))
    expect(out[out.length - 1].at - out[0].at).toBeLessThanOrEqual(ZOOM_MAX_S)
    // Never wider than the whole path's zoom, the one it used to play at throughout.
    expect(Math.max(...plan.map((s) => s.scaleExp))).toBe(fitScale(shot.beats))
  })

  it('zooms back in for a run of small moves after a big one, once its glide has landed', () => {
    const moves = [{ at: 0, size: BIG }, ...Array.from({ length: 8 }, (_, i) => ({ at: 2 + i, size: TINY }))]
    const shot = trip(chain('a', moves))
    const plan = planOf(shot)
    const wide = moveScale(shot.beats[0], true)!
    const fine = moveScale(shot.beats[1], false)!
    expect(plan[0].scaleExp).toBe(wide)
    expect(plan[plan.length - 1].scaleExp).toBe(fine)
    // Nothing changes while the big move glides, nor until the camera has caught up with it.
    expect(plan[1].at).toBeGreaterThanOrEqual(shot.offsets[0] + WIDE_HOLD_S - 1e-9)
    expect(WIDE_HOLD_S).toBeGreaterThanOrEqual(GLIDE_S)
    expect(scaleAt(plan, shot.offsets[0] + WIDE_HOLD_S - 0.01)).toBe(wide)
    expect(reversals(plan)).toBe(0)
  })

  it('holds the wide zoom when small and big moves alternate, instead of pumping', () => {
    const moves = Array.from({ length: 12 }, (_, i) => ({ at: i * 2, size: i % 2 === 0 ? TINY : BIG }))
    const shot = trip(chain('a', moves))
    const plan = planOf(shot)
    expect(reversals(plan)).toBe(0)
    // At the big moves' zoom from the start: the first nudge alone is not
    // worth zooming in for. (Finer than the whole six-hop path's zoom: each
    // move is shown, not the trip end to end.)
    expect(plan).toEqual([{ at: 0, scaleExp: moveScale(shot.beats[1], false) }])
    expect(plan[0].scaleExp).toBeLessThan(fitScale(shot.beats))
  })

  it('does not zoom in for a short pair of small moves between big ones, but does for a run that holds', () => {
    const pair = trip(chain('a', [{ at: 0, size: BIG }, { at: 1, size: TINY }, { at: 2, size: TINY }, { at: 3, size: BIG }]))
    expect(reversals(planOf(pair))).toBe(0)
    expect(planOf(pair).every((s) => s.scaleExp === planOf(pair)[0].scaleExp)).toBe(true)
    // Small moves three seconds apart: the run holds long past MIN_HOLD_S, so it is shown at its own zoom.
    const run = trip(chain('a', [{ at: 0, size: BIG }, { at: 3, size: TINY }, { at: 6, size: TINY }, { at: 9, size: TINY }, { at: 12, size: BIG }]))
    const plan = planOf(run)
    const fine = moveScale(run.beats[1], false)!
    expect(scaleAt(plan, run.offsets[2])).toBe(fine)
    expect(run.offsets[4] - run.offsets[1]).toBeGreaterThan(MIN_HOLD_S)
    expect(scaleAt(plan, run.offsets[4])).toBe(moveScale(run.beats[4], false))
    expect(reversals(plan)).toBe(1)
  })

  it('shows even a short run of nudges before the big move fine: an opening is no pump (review of #470)', () => {
    const shot = trip(chain('a', [{ at: 0, size: 1n }, { at: 1, size: 1n }, { at: 2, size: 1n }, { at: 3, size: BIG }]))
    const plan = planOf(shot)
    expect(plan[0].scaleExp).toBe(moveScale(shot.beats[0], true))
    expect(scaleAt(plan, shot.offsets[3])).toBe(moveScale(shot.beats[3], false))
    expect(reversals(plan)).toBe(0)
  })

  it('keeps each step of a widening staircase at its own zoom', () => {
    const steps = [1n, 1n, 1n, 1n << 8n, 1n << 8n, 1n << 8n, 1n << 16n, 1n << 16n, 1n << 16n]
    const shot = trip(chain('a', steps.map((size, i) => ({ at: i, size }))))
    const plan = planOf(shot)
    for (const i of [1, 4, 7]) expect(scaleAt(plan, shot.offsets[i])).toBe(moveScale(shot.beats[i], false))
    expect(reversals(plan)).toBe(0)
  })

  it('does not zoom in for one last nudge after a big move', () => {
    const shot = trip(chain('a', [{ at: 0, size: BIG }, { at: 3, size: BIG }, { at: 6, size: 1n }]))
    expect(planOf(shot)).toEqual([{ at: 0, scaleExp: moveScale(shot.beats[0], true) }])
  })

  it('leaves a one-move trip at the zoom it always had', () => {
    const one = trip(chain('a', [{ at: 0, size: BIG }]))
    expect(planOf(one)).toEqual([{ at: 0, scaleExp: fitScale(one.beats) }])
    const spawned = trip(chain('a', [{ at: 0, size: 0n, type: 'spawn' }, { at: 2, size: 1n << 12n }]))
    expect(planOf(spawned)).toEqual([{ at: 0, scaleExp: fitScale(spawned.beats) }])
  })

  it('keeps one zoom for moves of about the same size', () => {
    const shot = trip(chain('a', Array.from({ length: 10 }, (_, i) => ({ at: i, size: i % 2 === 0 ? 1000n : 1500n }))))
    expect(planOf(shot)).toHaveLength(1)
  })

  it('changes nothing during a hyperjump ride: the ride has its own camera', () => {
    const shot = trip(chain('a', [{ at: 0, size: 0n, type: 'hyperjump' }, { at: 1, size: TINY }, { at: 2, size: TINY }, { at: 3, size: BIG }]))
    expect(shot.prelude).toBe(JUMP_S)
    const plan = planOf(shot)
    expect(plan.slice(1).every((s) => s.at >= JUMP_S)).toBe(true)
    expect(scaleAt(plan, shot.offsets[3])).toBe(moveScale(shot.beats[3], false))
  })

  it('holds a wider zoom a moment before stepping back in, so one larger move is not a breath out and in', () => {
    // The 2026-10-23 scene's seventh move: one 2^5 hop among one-gibson nudges.
    const nudges = (from: number) => Array.from({ length: 6 }, (_, i) => ({ at: from + i, size: 1n }))
    const shot = trip(chain('a', [...nudges(0), { at: 6, size: 1n << 5n }, ...nudges(7)]))
    const plan = planOf(shot)
    const outDone = plan.find((s) => s.scaleExp === moveScale(shot.beats[6], false))!.at
    const backIn = plan.filter((s) => s.at > outDone)
    expect(backIn.length).toBeGreaterThan(0)
    expect(backIn[0].at - outDone).toBeGreaterThanOrEqual(WIDE_HOLD_S - 1e-9)
  })

  it('on any trip: every move plays at least as wide as it needs, a power of two a step, never during a wider move\'s glide', () => {
    let seed = 42
    const rand = (): number => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 }
    for (let run = 0; run < 400; run++) {
      const moves: Array<{ at: number; size: bigint; type?: ActionEvent['type'] }> = []
      let t = 0
      if (rand() < 0.2) moves.push({ at: 0, size: 0n, type: rand() < 0.5 ? 'spawn' : 'hyperjump' })
      const count = 1 + Math.floor(rand() * 20)
      for (let i = 0; i < count; i++) {
        t += rand() < 0.5 ? 0 : Math.floor(rand() * 4)
        moves.push({ at: t, size: 1n << BigInt(Math.floor(rand() * 30)) })
      }
      const shot = trip(chain('p', moves))
      const plan = planOf(shot)
      const needs = shot.beats.map((b, i) => moveScale(b, i === 0))
      shot.offsets.forEach((o, j) => { if (needs[j] !== null) expect(scaleAt(plan, o)).toBeGreaterThanOrEqual(needs[j]!) })
      for (let i = 1; i < plan.length; i++) {
        expect(Math.abs(plan[i].scaleExp - plan[i - 1].scaleExp)).toBe(1)
        expect(plan[i].at).toBeGreaterThanOrEqual(plan[i - 1].at)
        expect(plan[i].at).toBeGreaterThanOrEqual(shot.prelude ?? 0)
        if (plan[i].scaleExp < plan[i - 1].scaleExp) {
          // In: no move needing more than the new zoom is still gliding.
          shot.offsets.forEach((o, j) => {
            if (needs[j] !== null && needs[j]! > plan[i].scaleExp) expect(plan[i].at < o || plan[i].at >= o + GLIDE_S - 0.05 - 1e-9).toBe(true)
          })
        }
      }
      expect(Math.max(...plan.map((p) => p.scaleExp))).toBeLessThanOrEqual(fitScale(shot.beats))
    }
  })

  it('is empty for a segment, which has no beats', () => {
    expect(zoomPlan([], [], 7)).toEqual([])
    expect(scaleAt([], 3)).toBeNull()
  })
})
