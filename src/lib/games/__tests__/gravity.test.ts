/**
 * gravity.test.ts - gravity and jumps inside a game (lib/games/gravity.ts),
 * on a small world of boxes that hold a walker: WALK's jump of 5 and double
 * jump of 3, a ceiling ending a rise, the stair rule (a riser of 1 or 2 is
 * walked, 3 is not), a drop of 1 or 2 settled and a deeper one fallen, and
 * the region's edge as the one floor that is not a face.
 */

import { describe, expect, it } from 'vitest'
import { fromPayload, type ShardModel } from 'sno-core/shards'
import { JUMP_HANG_S } from '../../../store/walkGravity'
import { jump, move, standing, tick, type Body } from '../gravity'
import type { WorldShard } from '../play'
import type { GameDef } from '../types'
import type { Position } from '../../space'

const base = { x: 1n << 20n, y: 1n << 20n, z: 1n << 20n }
const game: Pick<GameDef, 'region'> = { region: { base, height: 6, plane: 1 } }
const P = (x: number, y: number, z: number): Position => ({ x: base.x + BigInt(x), y: base.y + BigInt(y), z: base.z + BigInt(z) })

/** A closed box from lo to hi (model units, whole gibsons), wound outward, that holds a walker. */
function box(lo: number[], hi: number[]): ShardModel {
  const vertices = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]])
  const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]
  const faces = quads.flatMap(([a, b, c, d]) => [[a, b, c], [a, c, d]])
  const s = fromPayload({ v: 2, name: 'box', unit: 0, mode: 'solid', vertices, colors: vertices.map(() => 1), faces, constrain: 'all' }, `box-${lo}-${hi}`)
  if (!s) throw new Error('box')
  return s
}
let n = 0
const put = (at: Position, lo: number[], hi: number[]): WorldShard => ({ key: `w${n++}`, shard: box(lo, hi), at, height: 6 })

/** A floor 16 across whose top face is at y 0 of its origin: a walker stands at origin y + 1. */
const floorAt = (y: number): WorldShard => put(P(32, y, 32), [-8, -1, -8], [8, 0, 8])
const stand = (x: number, y: number, z: number): Body => ({ at: P(x, y, z), arc: null, doubled: false })
const rel = (b: Body) => [Number(b.at.x - base.x), Number(b.at.y - base.y), Number(b.at.z - base.z)]

/** Ticks every 16 ms from `t0` until landed (or `max` ms), the highest height above `from` reached, and when it landed. */
function fly(b: Body, t0: number, world: WorldShard[], max = 4000, at?: (t: number, b: Body) => Body): { body: Body; top: number; landedAt: number } {
  let top = Number(b.at.y - base.y)
  for (let t = t0 + 16; t <= t0 + max; t += 16) {
    if (at) b = at(t, b)
    const r = tick(game, b, t, world)
    b = r.body
    top = Math.max(top, Number(b.at.y - base.y))
    if (r.landed) return { body: b, top, landedAt: t }
  }
  return { body: b, top, landedAt: -1 }
}

describe('gravity in a game', () => {
  const world = [floorAt(10)]

  it('stands on a floor; a jump rises 5 and lands where it left, in about 0.775 s', () => {
    const b = stand(32, 11, 32)
    expect(standing(game, b.at, world)).toBe(true)
    const j = jump(game, b, 0, world)
    const { body, top, landedAt } = fly(j, 0, world)
    expect(top).toBe(16)
    expect(rel(body)).toEqual([32, 11, 32])
    expect(landedAt / 1000).toBeCloseTo(JUMP_HANG_S, 1)
  })

  it('the double jump adds 3 near the top, once per time in the air, and a landing gives it back', () => {
    // WALK's measure (Maze Kit AeroCarnival envelope): a jump and a double jump reach a ledge 7 up, never 8,
    // since the 3 count from the arc's true height, a hair under the top's whole gibson.
    let b = jump(game, stand(32, 11, 32), 0, world)
    let doubledOnce = false
    const { top, body } = fly(b, 0, world, 4000, (t, cur) => {
      if (!doubledOnce && t >= 388) { doubledOnce = true; const d = jump(game, cur, t, world); expect(d.doubled).toBe(true); expect(jump(game, d, t + 1, world)).toBe(d); return d }
      return cur
    })
    expect(top).toBe(18)
    expect(body.doubled).toBe(false)
    b = jump(game, body, 5000, world)
    expect(b.arc).not.toBeNull()
  })

  it('a ceiling ends the rise, and the fall begins there at rest', () => {
    const lid = [floorAt(10), put(P(32, 14, 32), [-8, 0, -8], [8, 1, 8])]
    const { top, body } = fly(jump(game, stand(32, 11, 32), 0, lid), 0, lid)
    expect(top).toBe(13)
    expect(rel(body)).toEqual([32, 11, 32])
  })

  it('a level press climbs a riser of 1 or 2 and stops at 3', () => {
    for (const [h, climbs] of [[1, true], [2, true], [3, false]] as const) {
      const w = [floorAt(10), put(P(34, 10, 32), [0, 0, -2], [4, h, 2])]
      const b = move(game, stand(33, 11, 32), 'x', 1, 0, w)
      expect(rel(b), `riser ${h}`).toEqual(climbs ? [34, 11 + h, 32] : [33, 11, 32])
    }
  })

  it('past an edge, a drop of 1 or 2 is settled at once and a deeper one is fallen', () => {
    for (const [d, falls] of [[1, false], [2, false], [4, true]] as const) {
      const w = [floorAt(10), put(P(30, 10 + d, 32), [-4, -1, -2], [0, 0, 2])]
      // From the ledge's edge (an edge stands you), one press off it.
      const b = move(game, stand(30, 11 + d, 32), 'x', 1, 0, w)
      if (!falls) { expect(rel(b), `drop ${d}`).toEqual([31, 11, 32]); expect(b.arc).toBeNull(); continue }
      expect(b.arc).not.toBeNull()
      expect(rel(fly(b, 0, w).body)).toEqual([31, 11, 32])
    }
  })

  it('in the air a press moves you a gibson and the arc goes on; a wall stops the press, not the fall', () => {
    const w = [floorAt(10), put(P(35, 10, 32), [0, 0, -2], [1, 10, 2])]
    let b = jump(game, stand(33, 11, 32), 0, w)
    b = tick(game, b, 100, w).body
    b = move(game, b, 'x', 1, 100, w)
    expect(rel(b)[0]).toBe(34)
    const blockedAt = move(game, b, 'x', 1, 120, w)
    expect(blockedAt).toBe(b)
    expect(rel(fly(b, 120, w).body)).toEqual([34, 11, 32])
  })

  it('the edge of the region is a floor: nobody falls out of the game', () => {
    const b: Body = { at: P(5, 3, 5), arc: { from: base.y + 3n, y0: 0, v0: 0, t0: 0 }, doubled: false }
    const r = fly(b, 0, [])
    expect(rel(r.body)).toEqual([5, 0, 5])
  })
})
