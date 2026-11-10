/**
 * seedsOrientation.test.ts: how a bloom stands (DECK-0008 §5.7,
 * arkin0x/cyberspace#98; owner ruling 2026-11-10). The tags read as the
 * spec's vectors read them; they round-trip through the seed event; the
 * reader turns the bloom exactly as the spec turns its points (placed into
 * Cyberspace's axes, Z negated, then X, Y and Z), and stands it on Earth only
 * in dataspace; the arrows point where the drawn bloom's +Y and +Z go.
 */

import { describe, expect, it } from 'vitest'
import { ticksOf, toRender, posed } from 'sno-core/shards'
import { ORIGINAL_CAPS, ORIGINAL_DNAS } from '../seeds/originalDnas'
import { seedItemOf, standOf, UPRIGHT } from '../seeds/seedItem'
import { seedSnapOffered, standArrows, standBloom, standTags } from '../seeds/orientation'
import { turnShard } from '../turn'
import { previewRequest, seedTemplate } from '../seeds/plant'
import { GrowCache, handleGrow } from '../seeds/growJob'
import { bloomShard } from '../seeds/bloomShard'
import { bearingOf, frameOf, poseAt } from '../pose'
import { applyPose } from '../pose'
import { positionHex } from '../events'
import { mineSeedEvent, vectors } from './seedsFixture'

// The spec's own cases (decks/seeds-vectors.json `orientation.tags`, cyberspace#98): null is a seed the reader skips.
const SPEC_TAGS: Array<[string[][], { turn: number[]; up: boolean; spin: number } | null]> = [
  [[], { turn: [0, 0, 0], up: false, spin: 0 }],
  [[['turn', '1', '0', '0']], { turn: [1, 0, 0], up: false, spin: 0 }],
  [[['turn', '0', '3', '2'], ['up'], ['spin', '90']], { turn: [0, 3, 2], up: true, spin: 90 }],
  [[['up']], { turn: [0, 0, 0], up: true, spin: 0 }],
  [[['spin', '45']], { turn: [0, 0, 0], up: false, spin: 0 }],
  [[['up'], ['spin', '0']], { turn: [0, 0, 0], up: true, spin: 0 }],
  [[['up', 'true'], ['spin', '359']], { turn: [0, 0, 0], up: true, spin: 359 }],
  [[['turn', '0', '0', '0', '0']], null],
  [[['turn', '4', '0', '0']], null],
  [[['turn', '01', '0', '0']], null],
  [[['turn', '1', '0']], null],
  [[['spin', '360']], null],
  [[['spin', '-90']], null],
  [[['spin', '90.0']], null],
  [[['spin']], null],
  [[['turn', '2', '2', '2'], ['turn', 'x', 'y', 'z']], { turn: [2, 2, 2], up: false, spin: 0 }],
  [[['spin', '90', 'x']], null],
]

/** The spec's quarter turns, in Cyberspace's axes (§5.7 step 3). */
const QUARTER = [([x, y, z]: number[]) => [x, -z, y], ([x, y, z]: number[]) => [z, y, -x], ([x, y, z]: number[]) => [-y, x, z]]
const specTurn = (p: number[], turn: number[]): number[] => {
  let q = p
  for (let a = 0; a < 3; a++) for (let k = 0; k < turn[a]; k++) q = QUARTER[a](q)
  return q
}

describe('the tags (§5.7, §8.2)', () => {
  it('read as the spec reads them, malformed ones making the seed unreadable', () => {
    for (const [tags, want] of SPEC_TAGS) expect(standOf(tags), JSON.stringify(tags)).toEqual(want)
  })

  it('written for what the bar set: none upright, up only in dataspace, spin only with up', () => {
    expect(standTags(UPRIGHT, 0)).toEqual([])
    expect(standTags({ turn: [1, 0, 3], up: true, spin: 90 }, 0)).toEqual([['turn', '1', '0', '3'], ['up'], ['spin', '90']])
    expect(standTags({ turn: [0, 0, 0], up: true, spin: 0 }, 0)).toEqual([['up']])
    expect(standTags({ turn: [0, 2, 0], up: true, spin: 90 }, 1)).toEqual([['turn', '0', '2', '0']])
  })

  it('round-trip through a mined, signed seed', () => {
    const at = { x: 1_000_000n, y: 2_000_000n, z: 3_000_000n }
    const template = seedTemplate({ dnaId: 'ab'.repeat(32), relayHint: '', planted: 975300, scale: 0, at, plane: 0, title: '', createdAt: 1, stand: { turn: [0, 3, 1], up: true, spin: 270 } })
    const extra = template.tags.filter((t) => ['turn', 'up', 'spin'].includes(t[0]))
    expect(extra).toEqual([['turn', '0', '3', '1'], ['up'], ['spin', '270']])
    const seed = seedItemOf(mineSeedEvent({ dnaId: 'ab'.repeat(32), planted: 975300, at, plane: 0, createdAt: 1, extra }))!
    expect(seed.stand).toEqual({ turn: [0, 3, 1], up: true, spin: 270 })
    expect(seedItemOf(mineSeedEvent({ dnaId: 'ab'.repeat(32), planted: 975300, at, plane: 0, createdAt: 1, extra: [['spin', '400']] }))).toBeNull()
    expect(seedItemOf(mineSeedEvent({ dnaId: 'ab'.repeat(32), planted: 975300, at, plane: 0, createdAt: 1 }))!.stand).toEqual(UPRIGHT)
  }, 60_000) // three seeds mined at 16 bits: seconds on a loaded machine
})

describe('the reader', () => {
  const grown = (() => {
    const req = previewRequest({ text: ORIGINAL_DNAS[2].text, caps: ORIGINAL_CAPS, coord: vectors.growth.cases[0].coord, scale: 0, tip: 975_400, day: 20, hashOf: () => undefined })
    const a = handleGrow({ type: 'grow', id: 1, ...req }, new GrowCache()).answer
    if (a.type !== 'bloom') throw new Error(a.type)
    return a.buffers
  })()
  const plain = bloomShard(grown, 'oak', 0, 'b')

  it('turns the bloom as the spec turns its points: into Cyberspace\'s axes, then X, Y and Z', () => {
    for (const turn of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [2, 0, 0], [1, 2, 3], [3, 3, 3], [0, 3, 2]] as Array<[number, number, number]>) {
      const p = grown.positions
      const spec: number[][] = []
      // §5.7 step 2, the payload's Z negated; step 3, the quarter turns.
      for (let i = 0; i < p.length; i += 3) spec.push(specTurn([p[i], p[i + 1], 0 - p[i + 2]], turn).map((n) => n || 0))
      const ours = standBloom(plain, { turn, up: false, spin: 0 }, 1)
      expect(ours.vertices.map((v) => ticksOf(v)), turn.join('')).toEqual(spec)
      expect(ours.faces).toEqual(plain.faces)
    }
  })

  it('an upright seed draws its bloom untouched; the same stand is turned once', () => {
    expect(standBloom(plain, UPRIGHT, 0)).toBe(plain)
    expect(standBloom(plain, { turn: [1, 0, 0], up: false, spin: 0 }, 0)).toBe(standBloom(plain, { turn: [1, 0, 0], up: false, spin: 0 }, 0))
  })

  it('stands on Earth only in dataspace; ideaspace ignores up and spin', () => {
    expect(standBloom(plain, { turn: [0, 0, 0], up: true, spin: 90 }, 0)).toMatchObject({ up: true, spin: 90 })
    expect(standBloom(plain, { turn: [0, 0, 0], up: true, spin: 90 }, 1)).toBe(plain)
    expect(seedSnapOffered(0)).toBe(true)
    expect(seedSnapOffered(1)).toBe(false)
  })

  it('the tag\'s turns are TURN\'s as the bar sets them: a seed turns exactly as a shard does', () => {
    const shard = { ...plain, id: 's' }
    expect(standBloom(shard, { turn: [1, 2, 3], up: false, spin: 0 }, 1).vertices).toEqual(turnShard(shard, [1, 2, 3]).vertices)
  })
})

describe('the arrows', () => {
  const at = { x: 8_000_000_000_000_000_000_000_000n, y: 4_000_000_000_000_000_000_000_000n, z: 6_000_000_000_000_000_000_000_000n }

  it('point where the drawn bloom\'s +Y and +Z go, after TURN and the stand', () => {
    const pose = poseAt(at, 37)
    for (const turns of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 2, 3]] as Array<[number, number, number]>) {
      const { up, front } = standArrows(turns, pose)
      // A unit point on the bloom's own +Y and +Z, turned as the shard is, posed and drawn as ShardMesh draws it.
      const drawn = (d: [number, number, number]): number[] => {
        const shard = { id: 'x', name: 'x', unit: 0, extent: 8, mode: 'solid' as const, vertices: [{ p: d, c: [1, 1, 1] as [number, number, number] }], faces: [], up: false, spin: 0, updatedAt: 0 }
        const t = standBloom(shard, { turn: turns, up: false, spin: 0 }, 1).vertices[0]
        return toRender(posed(ticksOf(t), pose))
      }
      expect(up.map((n) => Math.round(n * 1e9))).toEqual(drawn([0, 1, 0]).map((n) => Math.round(n * 1e9)))
      expect(front.map((n) => Math.round(n * 1e9))).toEqual(drawn([0, 0, 1]).map((n) => Math.round(n * 1e9)))
    }
  })

  it('front faces the bearing FINE ROTATION sets, and up is the ground\'s up', () => {
    for (const spin of [0, 90, 200]) {
      const { up, front } = standArrows([0, 0, 0], poseAt(at, spin))
      const frame = frameOf(at)
      // Back out of render axes (Z negated) into Cyberspace's.
      expect(bearingOf(frame, [front[0], front[1], -front[2]])).toBe(spin)
      const u = [up[0], up[1], -up[2]]
      expect(u[0] * frame.up[0] + u[1] * frame.up[1] + u[2] * frame.up[2]).toBeCloseTo(1, 9)
    }
    void applyPose
    void positionHex
  })
})
