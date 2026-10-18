/**
 * director.test.ts: Cyberspace TV plays one avatar at a time, in the order
 * they started, going back a little in time for whoever overlapped, and
 * loses nothing (arkinox, 2026-10-18).
 */
import { describe, expect, it } from 'vitest'
import type { ActionEvent } from '../../events'
import { Director, shotFraming, HOLD_S, LEAD_S, MAX_SHOT_S, MAX_STEP_S, MIN_STEP_S, TRIP_GAP_S, beatOffsets, isJump, type Beat, type Shot } from '../director'

let n = 0
function beat(pubkey: string, at: number, opts: { type?: ActionEvent['type']; x?: bigint; fromX?: bigint; plane?: number } = {}): Beat {
  const id = (n++).toString(16).padStart(64, '0')
  const x = opts.x ?? 1000n
  return {
    id,
    pubkey,
    at,
    action: { id, pubkey, createdAt: at, type: opts.type ?? 'hop', name: opts.type ?? 'hop', role: 'base', coordHex: '', position: { x, y: 0n, z: 0n }, plane: (opts.plane ?? 0) as 0, prevCoordHex: '', genesisId: null, previousId: null, proofHash: null, sector: '' },
    from: { position: { x: opts.fromX ?? x - 1n, y: 0n, z: 0n }, plane: 0 },
  }
}

/** Everything a director hands out once the whole tape has been read. */
function play(beats: Beat[]): Shot[] {
  const d = new Director()
  for (const b of beats) d.add(b)
  return d.release(Infinity)
}

describe('Director', () => {
  it('makes one shot of a trip and a new one after a long pause', () => {
    const shots = play([beat('a', 0), beat('a', 5), beat('a', 9), beat('a', 9 + TRIP_GAP_S + 1)])
    expect(shots.map((s) => s.beats.length)).toEqual([3, 1])
  })

  it('plays overlapping avatars one after another, each from its own start', () => {
    const shots = play([beat('a', 0), beat('b', 2), beat('a', 4), beat('c', 5), beat('b', 6), beat('a', 8)])
    expect(shots.map((s) => s.pubkey)).toEqual(['a', 'b', 'c'])
    expect(shots.map((s) => s.beats.length)).toEqual([3, 2, 1])
    // B is shown from its first hop, signed before A's last.
    expect(shots[1].start).toBeLessThan(shots[0].end)
  })

  it('cuts a long trip so the others take turns, and drops nothing', () => {
    const beats: Beat[] = []
    for (let t = 0; t <= MAX_SHOT_S * 3; t += 5) beats.push(beat('a', t))
    beats.push(beat('b', MAX_SHOT_S + 10))
    beats.sort((x, y) => x.at - y.at)
    const shots = play(beats)
    expect(shots.filter((s) => s.pubkey === 'a').length).toBeGreaterThanOrEqual(3)
    const order = shots.map((s) => s.pubkey).join('')
    expect(order.indexOf('b')).toBeGreaterThan(0)
    expect(order.indexOf('b')).toBeLessThan(order.lastIndexOf('a'))
    expect(shots.reduce((k, s) => k + s.beats.length, 0)).toBe(beats.length)
  })

  it('cuts at a hyperjump and at a change of plane', () => {
    const shots = play([beat('a', 0), beat('a', 2, { type: 'hyperjump' }), beat('a', 4), beat('a', 6, { plane: 1 })])
    expect(shots.map((s) => s.beats.length)).toEqual([1, 2, 1])
  })

  it('holds a shot back while an earlier-started trip is still open', () => {
    const d = new Director()
    d.add(beat('a', 0))
    d.add(beat('b', 2))
    d.add(beat('b', 3))
    // Read past both trips' gaps: both are over, and go out in start order.
    expect(d.release(3 + TRIP_GAP_S + 1).map((s) => s.pubkey)).toEqual(['a', 'b'])
    const e = new Director()
    e.add(beat('a', 0))
    e.add(beat('b', 2))
    e.add(beat('a', 20))
    // b's trip has closed, a's is open and started first: nothing may go out yet.
    expect(e.release(2 + TRIP_GAP_S + 1)).toEqual([])
    expect(e.release(Infinity).map((s) => s.pubkey)).toEqual(['a', 'b'])
  })
})

describe('arrivals', () => {
  it('a spawn with nothing after it is an arrival; one followed by a hop starts a trip', () => {
    const shots = play([beat('a', 0, { type: 'spawn' }), beat('b', 1, { type: 'spawn' }), beat('b', 4)])
    expect(shots.map((s) => [s.pubkey, s.kind, s.beats.length])).toEqual([['a', 'arrival', 1], ['b', 'trip', 2]])
  })
})

describe('beatOffsets', () => {
  it('keeps the real gaps between the minimum and the maximum, after a lead', () => {
    const o = beatOffsets([beat('a', 0), beat('a', 0), beat('a', 2), beat('a', 600)])
    expect(o[0]).toBe(LEAD_S)
    expect(o[1] - o[0]).toBeCloseTo(MIN_STEP_S)
    expect(o[2] - o[1]).toBeCloseTo(2)
    expect(o[3] - o[2]).toBeCloseTo(MAX_STEP_S)
  })

  it('a shot lasts until its hold is over', () => {
    const [s] = play([beat('a', 0), beat('a', 1)])
    expect(s.length).toBeCloseTo(s.offsets[1] + HOLD_S)
  })
})

describe('isJump', () => {
  it('is a cut for far steps only', () => {
    expect(isJump(beat('a', 0, { x: 10n, fromX: 9n }))).toBe(false)
    expect(isJump(beat('a', 0, { x: 1n << 50n, fromX: 0n }))).toBe(true)
  })
})

describe('shotFraming', () => {
  it('varies the framing between shots, mostly close and medium, and never changes for one shot', () => {
    const names: Record<string, number> = {}
    for (let i = 0; i < 400; i++) {
      const id = (i * 2654435761 % 2 ** 32).toString(16).padStart(8, '0') + (i * 40503 % 2 ** 32).toString(16).padStart(8, '0') + '0'.repeat(48)
      const f = shotFraming(id)
      names[f.name] = (names[f.name] ?? 0) + 1
      expect(f.from).toBeGreaterThan(f.to)
      expect(f.polar).toBeGreaterThanOrEqual(0.35)
      expect(f.polar).toBeLessThanOrEqual(1.05)
      expect(shotFraming(id)).toEqual(f)
    }
    expect(names.close).toBeGreaterThan(names.wide)
    expect(names.medium).toBeGreaterThan(0)
    expect(names.wide).toBeGreaterThan(0)
  })
})
