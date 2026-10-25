/**
 * partsShared.test.ts - resolvePartsShared is sno-core's resolveParts, rule
 * for rule, and reads each placed object once for the whole app
 * (2026-10-23: entering WALK read every room again for every shard placing
 * it, froze the tab and grew it by gigabytes).
 */
import { describe, expect, it } from 'vitest'
import { newShard, toPayload, type Ref, type ShardModel } from 'sno-core/shards'
import { resolveParts } from 'sno-core/parts'
import { resolvePartsShared } from '../parts'

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const refOf = (i: number): Ref => ['a', `33331:${'b'.repeat(64)}:obj-${i}`]

/** A pool of objects placing each other at random (loops and long chains included), and how each answers a fetch. */
function pool(seed: number): { root: ShardModel; fetch: (ref: Ref) => Promise<unknown> } {
  const r = rng(seed)
  const int = (lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1))
  const n = int(1, 9)
  const model = (name: string): ShardModel => {
    const refs = Array.from({ length: int(0, 3) }, () => refOf(int(0, n + 1)))
    const parts = refs.length ? Array.from({ length: int(0, 4) }, () => ({ ref: int(0, refs.length - 1), at: [int(-600, 600), int(-600, 600), int(-600, 600)] as [number, number, number], turn: [90 * int(0, 3), 0, 0] as [number, number, number], step: [0, 0, 1, -1, -5, 200][int(0, 5)] })) : []
    return { ...newShard(name), unit: int(0, 3), mode: 'solid', vertices: [{ p: [0, 0, 0], c: [1, 1, 1] }, { p: [1, 0, 0], c: [1, 1, 1] }, { p: [0, 1, 0], c: [1, 1, 1] }], faces: [[0, 1, 2]], ...(parts.length ? { refs, parts } : {}) }
  }
  // Each object answers as a payload, nothing, a refusal, or something that is not an object at all.
  const answers = new Map<string, unknown>()
  for (let i = 0; i <= n + 1; i++) {
    const kind = r()
    answers.set(refOf(i)[1], kind < 0.75 ? toPayload(model(`obj ${i}`)) : kind < 0.85 ? null : kind < 0.93 ? 'reject' : { v: 2, nonsense: true })
  }
  const fetch = (ref: Ref): Promise<unknown> => {
    const a = answers.get(ref[1])
    return a === 'reject' ? Promise.reject(new Error('relay')) : Promise.resolve(a ?? null)
  }
  return { root: model('root'), fetch }
}

describe('resolvePartsShared', () => {
  it('resolves exactly as sno-core does, in a thousand random pools of objects', async () => {
    let placements = 0
    for (let seed = 1; seed <= 1000; seed++) {
      const { root, fetch } = pool(seed)
      const self = seed % 3 === 0 ? refOf(0) : undefined
      const was = await resolveParts(root, fetch, self)
      const now = await resolvePartsShared(root, fetch, self)
      // updatedAt is the moment a payload was read (fromPayload stamps Date.now()), not part of what it placed.
      const plain = (x: unknown): unknown => JSON.parse(JSON.stringify(x, (k, v) => (k === 'updatedAt' ? undefined : v)))
      expect(plain(now), `seed ${seed}`).toEqual(plain(was))
      const count = (l: typeof was): number => l.reduce((t, p) => t + 1 + count(p.children), 0)
      placements += count(was)
    }
    expect(placements).toBeGreaterThan(2000)
  })

  it('reads a placed object once, however many shards place it and however often they ask', async () => {
    const room = toPayload({ ...newShard('Room'), mode: 'solid', vertices: [{ p: [0, 0, 0], c: [1, 1, 1] }], faces: [] })
    let fetched = 0
    const fetch = (): Promise<unknown> => { fetched++; return Promise.resolve(room) }
    const placer = (name: string): ShardModel => ({ ...newShard(name), refs: [refOf(1)], parts: [{ ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: 0 }, { ref: 0, at: [120, 0, 0], turn: [0, 0, 0], step: 0 }] })
    const a = await resolvePartsShared(placer('A'), fetch)
    const b = await resolvePartsShared(placer('B'), fetch)
    // One model for every placement in every shard: the same object, not a copy each.
    expect(a[0].model).not.toBeNull()
    expect(a[1].model).toBe(a[0].model)
    expect(b[0].model).toBe(a[0].model)
    expect(fetched).toBe(2)
  })
})
