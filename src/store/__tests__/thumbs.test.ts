/**
 * thumbs.test.ts: the shard pictures every list shows (2026-10-23). The key
 * is the shape, so an edit asks again and a rename does not; a row in view
 * wants its picture, from memory, then the device, then the queue; a row
 * scrolled past gives it back; a stalled stage retries once, then stops.
 */

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { newShard, type ShardModel } from 'sno-core/shards'
import { LOOK, hash53, isComposite, thumbKeyOf } from '../../lib/thumbKey'
import { COMPOSITE_TTL_MS, fresh, prune, readThumb, resetThumbDbForTests, thumbDbForTests, writeThumb } from '../../lib/thumbDb'
import { MAX_STALLS, resetThumbWants, useThumbs, wantsOf } from '../useThumbs'

const cube = (name = 'cube'): ShardModel => ({
  ...newShard(name),
  mode: 'solid',
  vertices: [{ p: [0, 0, 0], c: [1, 0, 0] }, { p: [1, 0, 0], c: [0, 1, 0] }, { p: [0, 1, 0], c: [0, 0, 1] }] as ShardModel['vertices'],
  faces: [[0, 1, 2]],
})

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  resetThumbDbForTests()
  resetThumbWants()
  useThumbs.setState({ urls: {}, queue: [], order: [], failed: {}, disabled: false })
})

describe('the key of a picture', () => {
  it('is the shape: a rename, a new id or a later edit time keep it', () => {
    const a = cube('first')
    const b = { ...a, id: 'other', name: 'renamed', updatedAt: a.updatedAt + 1000 }
    expect(thumbKeyOf(b)).toBe(thumbKeyOf(a))
  })

  it('changes with any edit the picture would show', () => {
    const a = cube()
    const moved = { ...a, vertices: a.vertices.map((v, i) => (i === 0 ? { ...v, p: [0, 0, 1] } : v)) as ShardModel['vertices'] }
    const recoloured = { ...a, vertices: a.vertices.map((v, i) => (i === 0 ? { ...v, c: [1, 1, 1] } : v)) as ShardModel['vertices'] }
    const lines = { ...a, mode: 'lines' as const }
    const faces = { ...a, faces: [[0, 2, 1]] as ShardModel['faces'] }
    const facecolors = { ...a, facecolors: [[1, 0, 1]] as ShardModel['facecolors'] }
    const keys = [a, moved, recoloured, lines, faces, facecolors].map(thumbKeyOf)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('carries the look, and is hashed once per shard object', () => {
    expect(LOOK).toBeGreaterThan(0)
    const a = cube()
    const spy = vi.spyOn(JSON, 'stringify')
    thumbKeyOf(a)
    thumbKeyOf(a)
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('counts an object that places others as composite, and its unit then matters', () => {
    const a = cube()
    expect(isComposite(a)).toBe(false)
    expect(thumbKeyOf({ ...a, unit: 3 })).toBe(thumbKeyOf({ ...a, unit: 0 }))
    const c: ShardModel = { ...a, refs: [['a', `33331:${'ab'.repeat(32)}:x`]], parts: [{ ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: 0 }] }
    expect(isComposite(c)).toBe(true)
    expect(thumbKeyOf({ ...c, unit: 3 })).not.toBe(thumbKeyOf({ ...c, unit: 0 }))
  })

  it('hashes to 14 hex digits, differently by seed', () => {
    expect(hash53('x')).toMatch(/^[0-9a-f]{14}$/)
    expect(hash53('x', 1)).not.toBe(hash53('x'))
  })
})

describe('the pictures kept on the device', () => {
  it('reads back what was written, and nothing else', async () => {
    await writeThumb('k', 'data:image/png;base64,AA', false)
    expect(await readThumb('k')).toBe('data:image/png;base64,AA')
    expect(await readThumb('missing')).toBeNull()
  })

  it('shows a composite picture until COMPOSITE_TTL_MS, a plain one for as long as its key', async () => {
    expect(fresh({ key: 'k', url: 'u', at: 0, composite: false }, 10 * COMPOSITE_TTL_MS)).toBe(true)
    expect(fresh({ key: 'k', url: 'u', at: 0, composite: true }, COMPOSITE_TTL_MS - 1)).toBe(true)
    expect(fresh({ key: 'k', url: 'u', at: 0, composite: true }, COMPOSITE_TTL_MS)).toBe(false)
    await writeThumb('c', 'data:c', true, 1000)
    expect(await readThumb('c', 1000 + COMPOSITE_TTL_MS)).toBeNull()
  })

  it('lets the oldest go past the cap', async () => {
    for (let i = 0; i < 5; i++) await writeThumb(`k${i}`, `data:${i}`, false, 1000 + i)
    const db = await thumbDbForTests()
    await prune(db!, 3)
    expect(await readThumb('k0')).toBeNull()
    expect(await readThumb('k1')).toBeNull()
    expect(await readThumb('k4')).toBe('data:4')
  })

  it('is a miss, never an error, without IndexedDB', async () => {
    // @ts-expect-error a browser without it
    delete globalThis.indexedDB
    resetThumbDbForTests()
    await writeThumb('k', 'data:k', false)
    expect(await readThumb('k')).toBeNull()
  })
})

describe('the queue', () => {
  it('queues a wanted picture not kept anywhere, once however many rows want it', async () => {
    const s = cube()
    useThumbs.getState().want('a', s)
    useThumbs.getState().want('a', s)
    await vi.waitFor(() => expect(useThumbs.getState().queue.map((j) => j.key)).toEqual(['a']))
    expect(wantsOf('a')).toBe(2)
    expect(useThumbs.getState().queue[0].keep).toBe(true)
  })

  it('shows a picture kept on the device without drawing it', async () => {
    await writeThumb('a', 'data:kept', false)
    useThumbs.getState().want('a', cube())
    await vi.waitFor(() => expect(useThumbs.getState().urls.a).toBe('data:kept'))
    expect(useThumbs.getState().queue).toEqual([])
  })

  it('takes a scrolled-past row out of the queue, unless another row still wants it or it is being drawn', async () => {
    const s = cube()
    for (const k of ['a', 'b', 'c']) useThumbs.getState().want(k, s)
    useThumbs.getState().want('c', s)
    await vi.waitFor(() => expect(useThumbs.getState().queue).toHaveLength(3))
    useThumbs.getState().unwant('b')
    expect(useThumbs.getState().queue.map((j) => j.key)).toEqual(['a', 'c'])
    useThumbs.getState().unwant('c')
    expect(useThumbs.getState().queue.map((j) => j.key)).toEqual(['a', 'c'])
    // The first is on the stage: it finishes.
    useThumbs.getState().unwant('a')
    expect(useThumbs.getState().queue.map((j) => j.key)).toEqual(['a', 'c'])
  })

  it('does not queue a row that left while its kept picture was being looked for', async () => {
    useThumbs.getState().want('gone', cube())
    useThumbs.getState().unwant('gone')
    await new Promise((r) => setTimeout(r, 30))
    expect(useThumbs.getState().queue).toEqual([])
  })

  it('keeps a drawn wanted picture on the device; a requested one only in memory', async () => {
    const s = cube()
    useThumbs.getState().want('w', s)
    await vi.waitFor(() => expect(useThumbs.getState().queue).toHaveLength(1))
    useThumbs.getState().done('w', 'data:w')
    useThumbs.getState().request('r', s)
    useThumbs.getState().done('r', 'data:r')
    await vi.waitFor(async () => expect(await readThumb('w')).toBe('data:w'))
    expect(await readThumb('r')).toBeNull()
    expect(useThumbs.getState().urls.r).toBe('data:r')
  })

  it('shows the icon for a picture that failed, and does not ask again', async () => {
    const s = cube()
    useThumbs.getState().want('f', s)
    await vi.waitFor(() => expect(useThumbs.getState().queue).toHaveLength(1))
    useThumbs.getState().fail('f')
    expect(useThumbs.getState().failed.f).toBe(true)
    useThumbs.getState().want('f', s)
    await new Promise((r) => setTimeout(r, 30))
    expect(useThumbs.getState().queue).toEqual([])
  })

  it('sends a stalled job to the back once, then fails it', () => {
    const s = cube()
    useThumbs.getState().request('a', s)
    useThumbs.getState().request('b', s)
    useThumbs.getState().stall('a')
    expect(useThumbs.getState().queue.map((j) => j.key)).toEqual(['b', 'a'])
    useThumbs.getState().done('b', 'data:b')
    useThumbs.getState().stall('a')
    expect(useThumbs.getState().queue).toEqual([])
    expect(useThumbs.getState().failed.a).toBe(true)
  })

  it('stops drawing after MAX_STALLS stalls with nothing drawn between', () => {
    const s = cube()
    for (let i = 0; i < MAX_STALLS; i++) useThumbs.getState().request(`k${i}`, s)
    for (let i = 0; i < MAX_STALLS; i++) useThumbs.getState().stall(`k${i}`)
    expect(useThumbs.getState().disabled).toBe(true)
    expect(useThumbs.getState().queue).toEqual([])
    useThumbs.getState().request('later', s)
    expect(useThumbs.getState().queue).toEqual([])
  })

  it('fails only the shard the stage threw on, and stops after MAX_STALLS crashes with nothing drawn between', () => {
    const s = cube()
    useThumbs.getState().request('bad', s)
    useThumbs.getState().request('good', s)
    useThumbs.getState().crash('bad')
    expect(useThumbs.getState().failed.bad).toBe(true)
    expect(useThumbs.getState().disabled).toBe(false)
    expect(useThumbs.getState().queue.map((j) => j.key)).toEqual(['good'])
    useThumbs.getState().done('good', 'data:good')
    for (let i = 0; i < MAX_STALLS - 1; i++) { useThumbs.getState().request(`c${i}`, s); useThumbs.getState().crash(`c${i}`) }
    expect(useThumbs.getState().disabled).toBe(false)
    useThumbs.getState().request('last', s)
    useThumbs.getState().crash('last')
    expect(useThumbs.getState().disabled).toBe(true)
  })
})
