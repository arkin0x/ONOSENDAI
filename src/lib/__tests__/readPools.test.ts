/**
 * readPools.test.ts - the distinct objects the scene's shards may read, by
 * trust (lib/readPools.ts, useResolved): a stranger's shard holds no more
 * than its share while drawn and gives it all back when it is not, a shard cut
 * short for want of reads is resolved again when they come back, and a
 * stranger's object in your shard reads from the strangers' pool.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const contacts = vi.hoisted(() => ({ read: async (_pubkey: string): Promise<string[]> => [] }))
vi.mock('../contacts', () => ({ GENERAL_RELAYS: [], followsOf: (pk: string) => contacts.read(pk), fetchContacts: async () => [] }))

import { newShard, toPayload, type Ref, type ShardModel } from 'sno-core/shards'
import { useResolved, type Resolved } from '../parts'
import { SCENE_STRANGER_READS, SCENE_STRANGER_SHARD_READS, SCENE_TRUSTED_READS, giveReads, onReadsBack, readsLeft, resetReads, takeReads, type ReadPool } from '../readPools'
import { setLocalAuthor } from '../carried'
import { mountHook, settle } from '../../test/hookRoot'

const ME = 'a'.repeat(64), THEM = 'b'.repeat(64)
const at = (pk: string, d: string): string => `33331:${pk}:${d}`

/** A shard by `pk` placing `n` different objects of its own, carried. */
function wide(pk: string, name: string, n: number): ShardModel {
  const objects: Record<string, unknown> = {}
  const refs: Ref[] = []
  for (let i = 0; i < n; i++) { const a = at(pk, `${name}-${i}`); objects[a] = toPayload({ ...newShard(`p${i}`), mode: 'solid' }); refs.push(['a', a]) }
  return { ...newShard(name), mode: 'solid', vertices: [], faces: [], author: pk, refs, objects, parts: refs.map((_, i) => ({ ref: i, at: [0, 0, 0], turn: [0, 0, 0], step: 0 })) }
}

const count = (m: Map<string, Resolved>, missing?: string): number => [...m.values()].filter((r) => (missing ? r.missing === missing : !!r.model)).length
const draw = (shard: ShardModel, pool: ReadPool) => mountHook((p: { shard: ShardModel; pool: ReadPool }) => useResolved(p.shard, p.pool), { shard, pool })

beforeEach(() => { resetReads(); setLocalAuthor(() => ME) })
afterEach(() => setLocalAuthor(null))

describe('the read pools', () => {
  it('a share is at most its ceiling, and what is given back is heard once, while the pool has some', async () => {
    expect(takeReads('stranger').left).toBe(SCENE_STRANGER_SHARD_READS)
    const heard: ReadPool[] = []
    const stop = onReadsBack((p) => heard.push(p))
    giveReads('stranger', 50)
    giveReads('stranger', 50)
    await Promise.resolve()
    expect(heard).toEqual(['stranger'])
    stop()
    expect(readsLeft('stranger')).toBe(SCENE_STRANGER_READS - SCENE_STRANGER_SHARD_READS + 100)
  })
})

describe('a shard drawn in the scene reads from its pool (useResolved)', () => {
  it("a stranger's shard holds its share while drawn, cut for the rest ('objects'), and gives it all back", async () => {
    const h = draw(wide(THEM, 'Many', 300), 'stranger')
    await settle()
    expect(count(h.current())).toBe(SCENE_STRANGER_SHARD_READS)
    expect(count(h.current(), 'objects')).toBe(300 - SCENE_STRANGER_SHARD_READS)
    expect(readsLeft('stranger')).toBe(SCENE_STRANGER_READS - SCENE_STRANGER_SHARD_READS)
    await h.unmount()
    await settle()
    expect(readsLeft('stranger')).toBe(SCENE_STRANGER_READS)
  })

  it('a shard the pool could not pay for is resolved again when reads come back, and gets them', async () => {
    const five = [0, 1, 2, 3, 4].map((i) => draw(wide(THEM, `Many${i}`, 300), 'stranger'))
    await settle()
    expect(readsLeft('stranger')).toBe(0)
    const sixth = draw(wide(THEM, 'Late', 50), 'stranger')
    await settle()
    expect(count(sixth.current())).toBe(0)
    expect(count(sixth.current(), 'objects')).toBe(50)
    await five[0].unmount()
    await settle()
    expect(count(sixth.current())).toBe(50)
    expect(readsLeft('stranger')).toBe(SCENE_STRANGER_SHARD_READS - 50)
    for (const h of [...five.slice(1), sixth]) await h.unmount()
    await settle()
    expect(readsLeft('stranger')).toBe(SCENE_STRANGER_READS)
  })

  it("a stranger's object in your shard reads from the strangers' pool, never yours", async () => {
    // Your shard placing a stranger's object, fetched with its own table of 300 pieces under their key.
    const theirs = wide(THEM, 'Theirs', 300)
    const { primeRef } = await import('../parts')
    const ref: Ref = ['a', at(THEM, 'theirs')]
    primeRef(ref, toPayload(theirs))
    const yours: ShardModel = { ...newShard('Yours'), mode: 'solid', vertices: [], faces: [], author: ME, refs: [ref], parts: [{ ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: 0 }] }
    const h = draw(yours, 'trusted')
    await settle()
    const r = h.current().get(`a:${ref[1]}`)
    expect(r?.model).toBeTruthy()
    // The stranger's object, and what it reads, from the strangers' share.
    expect(r!.children.filter((c) => c.model).length).toBe(SCENE_STRANGER_SHARD_READS - 1)
    expect(readsLeft('trusted')).toBe(SCENE_TRUSTED_READS)
    expect(readsLeft('stranger')).toBe(SCENE_STRANGER_READS - SCENE_STRANGER_SHARD_READS)
    await h.unmount()
    await settle()
    expect(readsLeft('stranger')).toBe(SCENE_STRANGER_READS)
  })
})
