/**
 * finishFlags.test.ts - the two checkered flags at the finish deck's far
 * corners stay inside its wall (owner, 2026-11-14: "the right flag in the end
 * zone needs to be flipped as it clips with the wall").
 *
 * A placed shard keeps its model's axes whichever way the layout faces, so a
 * flag whose cloth points the world's +x points out of the deck on one side
 * or the other depending on the layout's side. The stager turns the flag on
 * the outward side half a turn (stage.ts flagTurned). Measured here on the
 * shards the stager really seals, opened from the covering bag as discovery
 * opens them, against the real wall shards' inner faces, for all four
 * facings.
 */
import { describe, expect, it } from 'vitest'
import { generateSecretKey } from 'nostr-tools/pure'
import { TICKS_PER_UNIT, ticksOf, type ShardModel } from 'sno-core/shards'
import { regionKeyAt } from '../../lib/shardCrypto'
import { unbag } from '../../lib/hidden'
import type { Position } from '../../lib/space'
import { buildStage, pieceModel, type KeyAt } from '../stage'
import { COURSE, courseToWorld } from '../course'
import { regionBase, type Frame, type TutorialLayout } from '../layout'
import flagCheckered from '../pieces/flag-checkered.json'

const keyAt: KeyAt = async (at, h) => { const rk = regionKeyAt(at, h, 20); return { key: rk.key, lookupId: rk.lookupId } }

const SPAWN: Position = { x: 1_000_003n, y: 2_000_002n, z: 3_000_001n }

/** A layout facing `fwd` and `side` around SPAWN, in its height-12 cover. */
function layoutFacing(fwd: 1 | -1, side: 1 | -1): TutorialLayout {
  const own = regionBase(SPAWN, 3)
  return { plane: 0, spawn: SPAWN, frame: { fwd, side, boxBase: { x: own.x, y: own.y, z: own.z + BigInt(fwd) * 8n } }, cover: { height: 12, base: regionBase(SPAWN, 12) } }
}

interface Box { x: [number, number]; y: [number, number]; z: [number, number] }

/**
 * A shard at world point `at`, as a box in the course frame (gibsons): its
 * model x is the world's x, its z runs against the world's (store/walkWalls).
 */
function courseBox(frame: Frame, shard: ShardModel, at: Position): Box {
  const o = courseToWorld(frame, [0, 0, 0])
  const g = 2 ** shard.unit / TICKS_PER_UNIT
  const box: Box = { x: [Infinity, -Infinity], y: [Infinity, -Infinity], z: [Infinity, -Infinity] }
  for (const v of shard.vertices) {
    const [mx, my, mz] = ticksOf(v).map((n) => n * g)
    const p = [(Number(at.x - o.x) + mx) * frame.side, Number(at.y - o.y) + my, (Number(at.z - o.z) - mz) * frame.fwd]
    for (const [i, k] of (['x', 'y', 'z'] as const).entries()) {
      box[k][0] = Math.min(box[k][0], p[i])
      box[k][1] = Math.max(box[k][1], p[i])
    }
  }
  return box
}

const same = (a: Position, b: Position): boolean => a.x === b.x && a.y === b.y && a.z === b.z

const FLAGS = COURSE.filter((p) => p.piece === 'flag-checkered')

describe.each([[1, 1], [1, -1], [-1, 1], [-1, -1]] as const)('the finish flags, the course facing fwd %i side %i', (fwd, side) => {
  it('keeps both flags\' cloth inside the deck wall\'s inner faces, pointing in', async () => {
    const layout = layoutFacing(fwd, side)
    const { frame } = layout
    const stage = await buildStage(generateSecretKey(), 'a'.repeat(64), layout, keyAt)
    const rk = regionKeyAt(layout.cover.base, layout.cover.height, 20)
    const found = await unbag(stage.bags[0], rk.key, undefined, { at: regionBase(layout.cover.base, layout.cover.height), plane: layout.plane }, layout.cover.height)
    const shardAt = (p: readonly [number, number, number]): ShardModel[] => found
      .filter((h) => h.type === 'shard' && h.shard && same(h.at, courseToWorld(frame, p)))
      .map((h) => h.shard!)

    // The wall's inner faces, from the wall shards the stager sealed.
    const wallBox = (piece: string, x: number): Box => {
      const part = COURSE.find((p) => p.piece === piece && p.at[0] === x)!
      const [shard] = shardAt(part.at).filter((s) => s.name === 'Wall')
      return courseBox(frame, shard, courseToWorld(frame, part.at))
    }
    const left = wallBox('wall-side', -4).x[1]
    const right = wallBox('wall-side', 4).x[0]
    const far = wallBox('wall-far', 0).z[0]
    expect([left, right, far]).toEqual([-3.5, 3.5, 34.5])

    expect(FLAGS).toHaveLength(2)
    for (const flag of FLAGS) {
      const [shard] = shardAt(flag.at).filter((s) => s.name === 'Checkered flag')
      expect(shard, `a flag at course x ${flag.at[0]}`).toBeDefined()
      const box = courseBox(frame, shard, courseToWorld(frame, flag.at))
      const where = `flag at course x ${flag.at[0]}: x ${box.x.join(' to ')}, z ${box.z.join(' to ')}`
      expect(box.x[0], where).toBeGreaterThan(left)
      expect(box.x[1], where).toBeLessThan(right)
      expect(box.z[1], where).toBeLessThan(far)
      // The cloth points in, toward the deck's middle: it reaches most of a gibson that way past the pole.
      const inward = flag.at[0] > 0 ? flag.at[0] - box.x[0] : box.x[1] - flag.at[0]
      expect(inward, where).toBeGreaterThan(0.9)
    }
  })
})

describe('the flag as authored', () => {
  it('points its cloth along its model\'s +x, so untouched it would clip a side wall in every facing', () => {
    const model = pieceModel(flagCheckered, 'flag')
    const xs = model.vertices.map((v) => ticksOf(v)[0] / TICKS_PER_UNIT)
    expect(Math.max(...xs)).toBeGreaterThan(1)
    expect(Math.min(...xs)).toBeGreaterThan(-0.5)
  })
})
