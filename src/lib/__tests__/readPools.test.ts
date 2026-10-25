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
import { SCENE_STRANGER_READS, SCENE_STRANGER_SHARD_READS, SCENE_TRUSTED_READS, giveReads, meter, onReadsBack, readsLeft, resetReads, type ReadPool } from '../readPools'
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
  it('a share takes nothing until it reads, then from its ceiling and the pool together', () => {
    const m = meter('stranger')
    expect(readsLeft('stranger')).toBe(SCENE_STRANGER_READS)
    expect(m.models.left).toBe(SCENE_STRANGER_SHARD_READS)
    // As sno-core sees it: a writable number (its usable), taken one at a time.
    const d = Object.getOwnPropertyDescriptor(m.models, 'left')
    expect(d?.writable).toBe(true)
    expect(typeof d?.value).toBe('number')
    m.models.left--
    m.models.left--
    expect(m.used()).toBe(2)
    expect(readsLeft('stranger')).toBe(SCENE_STRANGER_READS - 2)
    expect(m.models.left).toBe(SCENE_STRANGER_SHARD_READS - 2)
    expect(m.poolRanLow()).toBe(false)
  })

  it('a share whose pool runs dry says so; one at its own ceiling does not', () => {
    const big = meter('stranger')
    for (let i = 0; i < SCENE_STRANGER_SHARD_READS; i++) big.models.left--
    expect(big.models.left).toBe(0)
    expect(big.poolRanLow()).toBe(false)
    const others = [1, 2, 3, 4].map(() => meter('stranger'))
    for (const o of others) while (o.models.left >= 1) o.models.left--
    expect(readsLeft('stranger')).toBe(0)
    const late = meter('stranger')
    expect(late.models.left).toBe(0)
    expect(late.poolRanLow()).toBe(true)
  })

  it('what is given back is heard once, while the pool has some', async () => {
    const heard: ReadPool[] = []
    const stop = onReadsBack((p) => heard.push(p))
    giveReads('stranger', 50)
    giveReads('stranger', 50)
    await Promise.resolve()
    expect(heard).toEqual(['stranger'])
    stop()
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

  it('twelve of your composites resolving at once all draw: reads are taken as they are read, not a share each up front (review of #515)', async () => {
    const twelve = Array.from({ length: 12 }, (_, i) => draw(wide(ME, `Composite${i}`, 50), 'trusted'))
    await settle()
    for (const h of twelve) {
      expect(count(h.current())).toBe(50)
      expect(count(h.current(), 'objects')).toBe(0)
    }
    expect(readsLeft('trusted')).toBe(SCENE_TRUSTED_READS - 12 * 50)
    for (const h of twelve) await h.unmount()
    await settle()
    expect(readsLeft('trusted')).toBe(SCENE_TRUSTED_READS)
  })

  it('reads given back while a starved shard is still resolving wake it when it lands (review of #515: a lost wakeup)', async () => {
    const { primeRef } = await import('../parts')
    // Strangers' shards A to D read 200 each and E 150; F needs 200 pieces from a slow relay, and gets the last 50.
    const others = (['A', 'B', 'C', 'D'] as const).map((n) => draw(wide(THEM, n, 200), 'stranger'))
    const e = draw(wide(THEM, 'E', 150), 'stranger')
    await settle()
    expect(readsLeft('stranger')).toBe(50)
    let answer: () => void = () => {}
    const slow = new Promise<void>((r) => { answer = r })
    const refs: Ref[] = Array.from({ length: 200 }, (_, i) => ['a', at(THEM, `F-${i}`)])
    for (const r of refs) primeRef(r, slow.then(() => toPayload({ ...newShard('f'), mode: 'solid' })))
    const f = draw({ ...newShard('F'), mode: 'solid', vertices: [], faces: [], author: THEM, refs, parts: refs.map((_, i) => ({ ref: i, at: [0, 0, 0], turn: [0, 0, 0], step: 0 })) }, 'stranger')
    await settle()
    expect(readsLeft('stranger')).toBe(0)
    // E is drawn no more while F still waits on its relay: its 150 come back then.
    await e.unmount()
    await settle()
    answer()
    await settle(20)
    expect(count(f.current())).toBe(SCENE_STRANGER_SHARD_READS)
    expect(count(f.current(), 'objects')).toBe(0)
    for (const h of [...others, f]) await h.unmount()
    await settle()
    expect(readsLeft('stranger')).toBe(SCENE_STRANGER_READS)
  })

  it('a write below zero charges no more than the share may still read', () => {
    const m = meter('stranger')
    m.models.left = -1_000
    expect(m.used()).toBe(SCENE_STRANGER_SHARD_READS)
    expect(readsLeft('stranger')).toBe(SCENE_STRANGER_READS - SCENE_STRANGER_SHARD_READS)
  })

  it('a shard cut short two levels down on a dry pool is not woken by the reads it gives back itself (review of #515, round 3)', async () => {
    const { primeRef } = await import('../parts')
    // Strangers' shards leave 50 reads; F places X, fetched, whose own table holds the 300 pieces it places.
    const others = [...(['A', 'B', 'C', 'D'] as const).map((n) => draw(wide(THEM, n, 200), 'stranger')), draw(wide(THEM, 'E', 140), 'stranger')]
    const small = draw(wide(THEM, 'S', 10), 'stranger')
    await settle()
    expect(readsLeft('stranger')).toBe(50)
    const xRef: Ref = ['a', at(THEM, 'X')]
    primeRef(xRef, toPayload(wide(THEM, 'X', 300)))
    const f = draw({ ...newShard('F'), mode: 'solid', vertices: [], faces: [], author: THEM, refs: [xRef], parts: [{ ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: 0 }] }, 'stranger')
    await settle()
    // X and 49 of its pieces: cut two levels down, the pool dry.
    const x = () => f.current().get(`a:${xRef[1]}`)!
    expect(x().children.filter((c) => c.model).length).toBe(49)
    expect(readsLeft('stranger')).toBe(0)
    // S leaves: its 10 wake F, which gives back its 50 as it resolves again and takes them, and 10 more.
    await small.unmount()
    await settle(30)
    expect(x().children.filter((c) => c.model).length).toBe(59)
    expect(readsLeft('stranger')).toBe(0)
    // And it rests there: no more resolves, however long the view stays still.
    const renders = f.renders()
    await settle(50)
    expect(f.renders()).toBe(renders)
    for (const h of [...others, f]) await h.unmount()
    await settle()
    expect(readsLeft('stranger')).toBe(SCENE_STRANGER_READS)
  })
})

