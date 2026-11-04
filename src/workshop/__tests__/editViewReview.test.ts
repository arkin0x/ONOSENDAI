/**
 * editViewReview.test.ts - the review of #507 (2026-11-04): the edit view of
 * a placed part opens only where it should, never edits through a live link,
 * and Esc leaves one level at a time.
 *
 * What would go wrong silently: a part reopened in another shard after a
 * switch; a copy your table holds edited from inside someone's live link; the
 * root stamped into a copy of itself, a loop no reader can draw; Esc closing
 * the workshop from three levels down.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}
vi.mock('../../lib/relay', () => ({
  CYBERSPACE_RELAY: 'wss://cyberspace.nostr1.com',
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { newShard, toPayload, type Ref, type ShardModel } from 'sno-core/shards'
import { useWorkshop, LIVE_LINK_NOTICE } from '../../store/useWorkshop'
import { sealedKeys, setLocalAuthor, takeIntoKeeping } from '../../lib/carried'
import { escapeStep } from '../escapeOrder'

const ME = 'a'.repeat(64)
const THEM = 'b'.repeat(64)
const tri = (name: string): ShardModel => ({
  ...newShard(name),
  mode: 'solid',
  vertices: [{ p: [0, 0, 0], c: [1, 1, 1] }, { p: [1, 0, 0], c: [1, 1, 1] }, { p: [0, 0, 1], c: [1, 1, 1] }],
  faces: [[0, 1, 2]],
})
const place = (s: ShardModel, ...refs: Ref[]): ShardModel => ({ ...s, refs, parts: refs.map((_, i) => ({ ref: i, at: [0, 0, 0] as [number, number, number], turn: [0, 0, 0] as [number, number, number], step: 0 })) })
const w = () => useWorkshop.getState()

beforeEach(() => {
  setLocalAuthor(() => ME)
  useWorkshop.setState({ shards: [], currentId: null, selection: [], partSel: [], stampMode: 'shape', stampObject: null, stampFacing: 0, inside: null, past: [], future: [], notice: null })
  w().addShard(tri('Water'), 'Water', 'kit/water')
  w().create('room')
  w().rename(w().currentId!, 'Room')
  w().setStampObject({ ref: ['a', `33331:${ME}:kit/water`], name: 'Water', shard: tri('Water'), copy: { sourceId: 'kit/water', pubkey: ME } })
  w().placeObject([0, 0, 0])
})

describe('#507 1: another shard closes the parts open in this one', () => {
  it('select() away and back opens the shard at its top', async () => {
    const roomId = w().currentId!
    await w().enterPart(0)
    expect(w().insidePath()).toHaveLength(1)
    w().create('other')
    w().select(roomId)
    expect(w().insidePath()).toHaveLength(0)
  })

  it('selecting the shard already open keeps you where you are', async () => {
    await w().enterPart(0)
    w().select(w().currentId!)
    expect(w().insidePath()).toHaveLength(1)
  })
})

describe('#507 2: nothing inside a live link is editable', () => {
  it('a part there that your own table also holds opens read-only, and an edit is refused', async () => {
    const roomId = w().currentId!
    const water = w().rootShard()!.refs![0][1]
    const LINK = `33331:${THEM}:statue`
    // Their statue places the address your table holds a copy at.
    const fetched = toPayload(place(tri('Statue'), ['a', water]))
    useWorkshop.setState({ shards: w().shards.map((s) => (s.id === roomId ? { ...s, refs: [...s.refs!, ['a', LINK, 'wss://relay.test']], parts: [...s.parts!, { ref: 1, at: [60, 0, 0], turn: [0, 0, 0], step: 0 }] } : s)) })
    await w().enterPart(1, (async (ref: readonly string[]) => (ref[1] === LINK ? fetched : null)) as never)
    expect(w().insidePath()[0].live?.name).toBe('Statue')
    await w().enterPart(0)
    expect(w().insidePath()).toHaveLength(2)
    expect(w().insidePath()[1].live).toBeDefined()
    const before = w().rootShard()
    w().setOpacity(20)
    expect(w().notice).toBe(LIVE_LINK_NOTICE)
    expect(w().rootShard()).toBe(before)
  })
})

describe('#506 3, inside a part: the root cannot be stamped into a copy inside itself', () => {
  it('is refused in the same words, and nothing changes', async () => {
    const roomId = w().currentId!
    const room = w().rootShard()!
    await w().enterPart(0)
    w().setStampObject({ ref: ['a', `33331:${ME}:${roomId}`], name: 'Room', shard: room, copy: { sourceId: roomId, pubkey: ME } })
    w().placeObject([120, 0, 0])
    expect(w().notice).toBe('An object cannot place itself.')
    expect(w().rootShard()).toBe(room)
  })
})

describe('D1, inside a part: a piece from a bag stamped there marks only what came sealed', () => {
  it('the root\'s own copy is never marked with it', async () => {
    const water = w().rootShard()!.refs![0][1]
    const found: ShardModel = { ...place(tri('Sealed'), ['a', `33331:${THEM}:s`]), objects: { [`33331:${THEM}:s`]: toPayload(tri('Secret')) }, author: THEM }
    const bagPiece = { ...takeIntoKeeping(found, ME), id: 'bag-piece' }
    useWorkshop.setState({ shards: [...w().shards, bagPiece] })
    await w().enterPart(0)
    w().setStampObject({ ref: ['a', `33331:${ME}:bag-piece`], name: 'Sealed', shard: bagPiece, copy: { sourceId: 'bag-piece', pubkey: ME } })
    w().placeObject([120, 0, 0])
    w().exitTo(0)
    const sealed = sealedKeys(w().rootShard()!)
    expect(sealed.size).toBe(2)
    expect(sealed.has(water)).toBe(false)
  })
})

describe('#507 3: Esc', () => {
  it('goes in arkinox\'s order: the panel, the view pad, what is in hand, one level out, the workshop', () => {
    expect(escapeStep(true, true, true, 2)).toBe('panel')
    expect(escapeStep(false, true, true, 2)).toBe('view')
    expect(escapeStep(false, false, true, 2)).toBe('hand')
    expect(escapeStep(false, false, false, 2)).toBe('exit')
    expect(escapeStep(false, false, false, 0)).toBe('close')
  })

  it('one level out is one level, by the bench\'s own Esc', async () => {
    const src = readFileSync(join(__dirname, '../Workshop.tsx'), 'utf8')
    expect(src).toMatch(/const step = escapeStep\(panel !== null, viewOpen, /)
    expect(src).toMatch(/else if \(step === 'exit'\) ws\.exitTo\(depth - 1\)/)
    // And exitTo(depth - 1) leaves exactly one level: two deep, then one.
    const water = w().rootShard()!.refs![0][1]
    const roomId = w().currentId!
    useWorkshop.setState({ shards: w().shards.map((s) => (s.id === roomId ? { ...s, objects: { ...s.objects!, [water]: toPayload(place(tri('Water'), ['a', `33331:${ME}:inner`])), [`33331:${ME}:inner`]: toPayload(tri('Inner')) } } : s)) })
    await w().enterPart(0)
    await w().enterPart(0)
    expect(w().insidePath()).toHaveLength(2)
    w().exitTo(w().insidePath().length - 1)
    expect(w().insidePath()).toHaveLength(1)
  })
})
