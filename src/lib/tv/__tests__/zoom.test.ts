/**
 * zoom.test.ts: a Cyberspace TV trip's zoom follows its moves (arkinox,
 * 2026-10-23: "Would we be able to zoom out to 2^17 when the actual larger
 * move is coming up?").
 */
import { describe, expect, it } from 'vitest'
import type { ActionEvent } from '../../events'
import { Director, JUMP_S, type Beat, type Shot } from '../director'
import { GLIDE_S, MIN_DIP_HOLD_S, MOVE_FIT_CELLS, WIDE_HOLD_S, ZOOM_MAX_S, ZOOM_SETTLE_S, fitScale, moveScale, scaleAt, zoomPlan, type ZoomStep } from '../zoom'

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

/** The zoom move `i` plays at: the one that fits it, never wider than the whole path's. */
const allowed = (s: Shot, i: number): number => Math.min(fitScale(s.beats), moveScale(s.beats[i], i === 0)!)

/** How long each dip (a zoom stepped in to and then out of) is held, from the step in landing to the first step out. */
function dipHolds(plan: ZoomStep[]): number[] {
  const holds: number[] = []
  for (let i = 1; i + 1 < plan.length; i++) {
    if (plan[i - 1].scaleExp > plan[i].scaleExp && plan[i + 1].scaleExp > plan[i].scaleExp) holds.push(plan[i + 1].at - plan[i].at)
  }
  return holds
}

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
    const fine = allowed(shot, 0)
    const wide = allowed(shot, 17)
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
    const wide = allowed(shot, 0)
    const fine = allowed(shot, 1)
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
    expect(plan).toEqual([{ at: 0, scaleExp: allowed(shot, 1) }])
    expect(plan[0].scaleExp).toBeLessThan(fitScale(shot.beats))
  })

  it('does not zoom in for a short pair of small moves between big ones, but does for a run that holds', () => {
    const pair = trip(chain('a', [{ at: 0, size: BIG }, { at: 1, size: TINY }, { at: 2, size: TINY }, { at: 3, size: BIG }]))
    expect(reversals(planOf(pair))).toBe(0)
    expect(planOf(pair).every((s) => s.scaleExp === planOf(pair)[0].scaleExp)).toBe(true)
    // Small moves three seconds apart: the run holds at its own zoom long past MIN_DIP_HOLD_S, so it is shown there.
    const run = trip(chain('a', [{ at: 0, size: BIG }, { at: 3, size: TINY }, { at: 6, size: TINY }, { at: 9, size: TINY }, { at: 12, size: BIG }]))
    const plan = planOf(run)
    const fine = allowed(run, 1)
    expect(scaleAt(plan, run.offsets[2])).toBe(fine)
    expect(dipHolds(plan)).toHaveLength(1)
    expect(dipHolds(plan)[0]).toBeGreaterThanOrEqual(MIN_DIP_HOLD_S)
    expect(scaleAt(plan, run.offsets[4])).toBe(allowed(run, 4))
    expect(reversals(plan)).toBe(1)
  })

  it('shows even a short run of nudges before the big move fine: an opening is no pump (review of #470)', () => {
    const shot = trip(chain('a', [{ at: 0, size: 1n }, { at: 1, size: 1n }, { at: 2, size: 1n }, { at: 3, size: BIG }]))
    const plan = planOf(shot)
    expect(plan[0].scaleExp).toBe(allowed(shot, 0))
    expect(scaleAt(plan, shot.offsets[3])).toBe(allowed(shot, 3))
    expect(reversals(plan)).toBe(0)
  })

  it('keeps each step of a widening staircase at its own zoom', () => {
    const steps = [1n, 1n, 1n, 1n << 8n, 1n << 8n, 1n << 8n, 1n << 16n, 1n << 16n, 1n << 16n]
    const shot = trip(chain('a', steps.map((size, i) => ({ at: i, size }))))
    const plan = planOf(shot)
    for (const i of [1, 4, 7]) expect(scaleAt(plan, shot.offsets[i])).toBe(allowed(shot, i))
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
    expect(scaleAt(plan, shot.offsets[3])).toBe(allowed(shot, 3))
  })

  it('holds a wider zoom a moment before stepping back in, so one larger move is not a breath out and in', () => {
    // The 2026-10-23 scene's seventh move: one 2^5 hop among one-gibson nudges.
    const nudges = (from: number) => Array.from({ length: 6 }, (_, i) => ({ at: from + i, size: 1n }))
    const shot = trip(chain('a', [...nudges(0), { at: 6, size: 1n << 5n }, ...nudges(7)]))
    const plan = planOf(shot)
    const outDone = plan.find((s) => s.scaleExp === allowed(shot, 6))!.at
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
      shot.offsets.forEach((o, j) => { if (needs[j] !== null) expect(scaleAt(plan, o)).toBeGreaterThanOrEqual(Math.min(fitScale(shot.beats), needs[j]!)) })
      for (let i = 1; i < plan.length; i++) {
        expect(Math.abs(plan[i].scaleExp - plan[i - 1].scaleExp)).toBe(1)
        expect(plan[i].at).toBeGreaterThanOrEqual(plan[i - 1].at)
        expect(plan[i].at).toBeGreaterThanOrEqual(shot.prelude ?? 0)
        if (plan[i].scaleExp < plan[i - 1].scaleExp) {
          // In: no move needing more than the new zoom is still gliding.
          shot.offsets.forEach((o, j) => {
            if (needs[j] !== null && Math.min(fitScale(shot.beats), needs[j]!) > plan[i].scaleExp) expect(plan[i].at < o || plan[i].at >= o + GLIDE_S - 0.05 - 1e-9).toBe(true)
          })
        }
      }
      expect(Math.max(...plan.map((p) => p.scaleExp))).toBeLessThanOrEqual(fitScale(shot.beats))
    }
  })

  it('fits each move in MOVE_FIT_CELLS, half a whole trip\'s FIT_CELLS, so the eased camera keeps up with it (review of #470)', () => {
    for (const size of [1n, 6n, 7n, 12n, 13n, 100n, 1n << 16n, (1n << 16n) * 6n, (1n << 16n) * 6n + 1n]) {
      const b = chain('f', [{ at: 0, size }])[0]
      const need = moveScale(b, false)!
      expect(size >> BigInt(need)).toBeLessThanOrEqual(BigInt(MOVE_FIT_CELLS))
      if (need > 0) expect(size >> BigInt(need - 1)).toBeGreaterThan(BigInt(MOVE_FIT_CELLS))
    }
    // A nudge of a few gibsons still plays at 2^0, as large as ever.
    expect(moveScale(chain('f', [{ at: 0, size: 3n }])[0], false)).toBe(0)
  })

  it('does not breathe in and out for six 0.7 s nudges between big hops, repeated (review of #470)', () => {
    // The reviewer's case: before, it zoomed in and out eight times in a 45 s shot, a third of a second at the fine zoom each.
    for (const big of [5, 16, 30]) {
      const moves: Array<{ at: number; size: bigint }> = []
      let at = 0
      while (at < 44) {
        for (let j = 0; j < 6 && at < 44; j++) { moves.push({ at, size: 3n }); at += 0.7 }
        moves.push({ at, size: 12n << BigInt(big) })
        at += 0.7
      }
      const plan = planOf(trip(chain(`alt${big}`, moves)))
      for (const h of dipHolds(plan)) expect(h).toBeGreaterThanOrEqual(MIN_DIP_HOLD_S)
      // The zoom out and in, at the engine's pace, leave six nudges too
      // little time at their own zoom: fine for the opening nudges, then out
      // once and held.
      expect(reversals(plan)).toBe(0)
    }
  })

  it('on any trip, a dip is held at its own zoom for MIN_DIP_HOLD_S or more (review of #470)', () => {
    let seed = 470
    const rand = (): number => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 }
    let dips = 0
    for (let run = 0; run < 800; run++) {
      const moves: Array<{ at: number; size: bigint; type?: ActionEvent['type'] }> = []
      let at = 0
      if (rand() < 0.2) moves.push({ at: 0, size: 0n, type: rand() < 0.5 ? 'hyperjump' : 'spawn' })
      const count = 2 + Math.floor(rand() * 60)
      for (let j = 0; j < count && at < 44; j++) {
        const r = rand()
        const need = r < 0.6 ? Math.floor(rand() * 2) : r < 0.85 ? Math.floor(rand() * 12) : Math.floor(rand() * 38)
        moves.push({ at, size: need === 0 ? 3n : 6n << BigInt(need) })
        at += rand() < 0.8 ? rand() * 0.7 : rand() * 4
      }
      const d = new Director()
      for (const b of chain(`h${run}`, moves)) d.add(b)
      for (const shot of d.release(Infinity)) {
        if (shot.kind !== 'trip') continue
        const plan = planOf(shot)
        const holds = dipHolds(plan)
        dips += holds.length
        for (const h of holds) expect(h).toBeGreaterThanOrEqual(MIN_DIP_HOLD_S - 1e-9)
        // And still every move at least as wide as it is allowed, a power of two a step.
        shot.offsets.forEach((o, j) => { if (j > 0 || !shot.prelude) expect(scaleAt(plan, o)).toBeGreaterThanOrEqual(allowed(shot, j)) })
        for (let i = 1; i < plan.length; i++) expect(Math.abs(plan[i].scaleExp - plan[i - 1].scaleExp)).toBe(1)
      }
    }
    // Dips are still taken where they hold.
    expect(dips).toBeGreaterThan(50)
  }, 30_000)

  it('holds a dip MIN_DIP_HOLD_S on screen as the engine plays it: in a power a tick, late ticks and all (review of #470)', () => {
    // The engine (useTv tick): every 100 ms, now and then up to 250 ms late;
    // in one power of two a tick, out at once. Before, a zoom in was planned
    // to take at most 1.5 s, and a 2^37 hop's took 3.7 s on screen and left
    // its nudges 0.1 s at their zoom.
    let seed = 4702
    const rand = (): number => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 }
    function onScreenDips(shot: Shot): number[] {
      const plan = planOf(shot)
      let cur = plan[0].scaleExp
      const seen: ZoomStep[] = [{ at: 0, scaleExp: cur }]
      for (let t = 0; t < shot.length;) {
        t += 0.1 + (rand() < 0.05 ? rand() * 0.25 : rand() * 0.01)
        const planned = scaleAt(plan, t)!
        const want = planned < cur ? cur - 1 : planned
        if (want !== cur) { cur = want; seen.push({ at: t, scaleExp: cur }) }
      }
      // A dip on screen: a step in followed straight by a step out, held from one to the other.
      const holds: number[] = []
      for (let i = 1; i + 1 < seen.length; i++) {
        if (seen[i].scaleExp < seen[i - 1].scaleExp && seen[i + 1].scaleExp > seen[i].scaleExp) holds.push(seen[i + 1].at - seen[i].at)
      }
      return holds
    }
    const size = (need: number): bigint => (need === 0 ? 3n : 6n << BigInt(need))
    let dips = 0
    // The deep case: a 2^37 hop, nudges, repeated.
    for (const gap of [0.7, 1, 1.5, 2]) for (const k of [4, 6, 9]) {
      const moves: Array<{ at: number; size: bigint }> = []
      let at = 0
      for (let r = 0; r < 4; r++) { moves.push({ at, size: size(37) }); at += gap; for (let j = 0; j < k; j++) { moves.push({ at, size: size(0) }); at += gap } }
      moves.push({ at, size: size(37) })
      const d = new Director()
      for (const b of chain(`deep${gap}-${k}`, moves)) d.add(b)
      for (const shot of d.release(Infinity)) {
        if (shot.kind !== 'trip') continue
        const holds = onScreenDips(shot)
        dips += holds.length
        for (const h of holds) expect(h).toBeGreaterThanOrEqual(MIN_DIP_HOLD_S)
      }
    }
    // And random trips, needs up to 2^38.
    for (let run = 0; run < 600; run++) {
      const moves: Array<{ at: number; size: bigint }> = []
      let at = 0
      const count = 2 + Math.floor(rand() * 80)
      for (let j = 0; j < count && at < 44; j++) {
        const r = rand()
        moves.push({ at, size: size(r < 0.6 ? Math.floor(rand() * 2) : r < 0.85 ? Math.floor(rand() * 12) : Math.floor(rand() * 39)) })
        at += rand() < 0.8 ? rand() * 0.7 : rand() * 4
      }
      const d = new Director()
      for (const b of chain(`eng${run}`, moves)) d.add(b)
      for (const shot of d.release(Infinity)) {
        if (shot.kind !== 'trip') continue
        const holds = onScreenDips(shot)
        dips += holds.length
        for (const h of holds) expect(h).toBeGreaterThanOrEqual(MIN_DIP_HOLD_S)
      }
    }
    expect(dips).toBeGreaterThan(100)
  }, 30_000)

  it('is empty for a segment, which has no beats', () => {
    expect(zoomPlan([], [], 7)).toEqual([])
    expect(scaleAt([], 3)).toBeNull()
  })
})
