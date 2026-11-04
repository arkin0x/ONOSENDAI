/**
 * stampReview.test.ts - the review of #506 (2026-11-04): a YOURS copy lives
 * in the table of the shard that places it, so everything that moves its
 * placement moves the copy with it.
 *
 * What would go wrong silently: CUT then PASTE, COPY then PASTE elsewhere,
 * or MENU COPY then PASTE, leaving a placement that names nothing (the copy
 * and its edits gone); a paste or an import dropping copies without a word;
 * the root stamped into a copy of itself, a loop no reader can draw; the
 * PUBLISH tag never learning an object published elsewhere.
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
const net = vi.hoisted(() => ({ asked: [] as unknown[], answer: [] as unknown[] }))
vi.mock('../../lib/relay', () => ({
  CYBERSPACE_RELAY: 'wss://cyberspace.nostr1.com',
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async (relays: string[], filter: unknown) => { net.asked.push({ relays, filter }); return net.answer }),
  relaySet: () => ['wss://relay.test'],
}))

import { newShard, toPayload, type ShardModel } from 'sno-core/shards'
import { useWorkshop } from '../../store/useWorkshop'
import { usePublished, learnMine } from '../../store/usePublished'
import { useToast } from '../../store/useToast'
import { carriesSealedParts, sealedKeys, setLocalAuthor, takeIntoKeeping } from '../../lib/carried'

const ME = 'a'.repeat(64)
const THEM = 'd'.repeat(64)
const tri = (name: string): ShardModel => ({
  ...newShard(name),
  mode: 'solid',
  vertices: [{ p: [0, 0, 0], c: [1, 1, 1] }, { p: [1, 0, 0], c: [1, 1, 1] }, { p: [0, 0, 1], c: [1, 1, 1] }],
  faces: [[0, 1, 2]],
})
const w = () => useWorkshop.getState()
/** Placements of `s` that name an address its table does not hold: a copy that went missing. */
const dangling = (s: ShardModel): string[] => (s.refs ?? []).filter((r) => r[0] === 'a').map((r) => r[1]).filter((a) => !Object.prototype.hasOwnProperty.call(s.objects ?? {}, a))

beforeEach(() => {
  setLocalAuthor(() => ME)
  useWorkshop.setState({ shards: [], currentId: null, selection: [], partSel: [], stampMode: 'shape', stampObject: null, stampFacing: 0, past: [], future: [], clip: null, notice: null })
  w().addShard(tri('Water'), 'Water', 'kit/water')
  w().create('room')
  w().rename(w().currentId!, 'Room')
  w().setStampObject({ ref: ['a', `33331:${ME}:kit/water`], name: 'Water', shard: tri('Water'), copy: { sourceId: 'kit/water', pubkey: ME } })
  w().placeObject([0, 0, 0])
  useToast.getState().dismiss()
})

describe('#506 1: a YOURS copy through the bench clipboard', () => {
  it('CUT then PASTE in the same shard keeps the copy', () => {
    const before = w().current()!
    expect(dangling(before)).toEqual([])
    useWorkshop.setState({ partSel: [0], selection: [] })
    w().cutSelection()
    expect(w().current()!.parts ?? []).toHaveLength(0)
    w().pasteClip('exact')
    const after = w().current()!
    expect(after.parts).toHaveLength(1)
    expect(dangling(after)).toEqual([])
    expect(after.objects).toEqual(before.objects)
  })

  it('COPY a placement, PASTE into another shard, keeps the copy', () => {
    const room = w().current()!
    useWorkshop.setState({ partSel: [0], selection: [] })
    w().copySelection()
    w().create('other')
    w().pasteClip('exact')
    const other = w().current()!
    expect(other.parts).toHaveLength(1)
    expect(dangling(other)).toEqual([])
    expect(other.objects).toEqual(room.objects)
  })

  it('MENU COPY of the whole shard, PASTE into another shard, keeps the copy', () => {
    w().copyShard(w().current()!)
    w().create('other')
    w().pasteClip('exact')
    const other = w().current()!
    expect(other.parts).toHaveLength(1)
    expect(dangling(other)).toEqual([])
  })

  it('a copy from a bag keeps its mark through the clipboard, and nothing else is marked', () => {
    const found: ShardModel = { ...tri('Sealed'), refs: [['a', `33331:${THEM}:s`]], parts: [{ ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: 0 }], objects: { [`33331:${THEM}:s`]: toPayload(tri('Secret')) }, author: THEM }
    const taken = { ...takeIntoKeeping(found, ME), id: 'taken' }
    useWorkshop.setState({ shards: [...w().shards, taken] })
    w().setStampObject({ ref: ['a', `33331:${ME}:taken`], name: 'Sealed', shard: taken, copy: { sourceId: 'taken', pubkey: ME } })
    w().placeObject([60, 0, 0])
    const room = w().current()!
    // D1: the sealed piece and the copy of the bag item are marked; the Water copy is not.
    const water = Object.keys(room.objects!).find((k) => JSON.stringify(room.objects![k]).includes('Water'))!
    expect(sealedKeys(room).has(water)).toBe(false)
    expect(sealedKeys(room).size).toBe(2)
    useWorkshop.setState({ partSel: [1], selection: [] })
    w().copySelection()
    w().create('other')
    w().pasteClip('exact')
    const other = w().current()!
    expect(dangling(other)).toEqual([])
    expect(carriesSealedParts(other)).toBe(true)
  })
})

describe('#506 2: text and files carry no copies, and say so', () => {
  it('a pasted shard that carried copies comes in without them, with a toast', () => {
    const text = JSON.stringify(toPayload({ ...tri('Pasted'), refs: [['a', `33331:${ME}:x`]], parts: [{ ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: 0 }], objects: { [`33331:${ME}:x`]: toPayload(tri('X')) } }))
    const id = w().importText(text)!
    expect(w().shards.find((s) => s.id === id)!.objects).toBeUndefined()
    expect(useToast.getState().toast).toMatchObject({ label: 'COPIES LEFT OUT', meta: '1 carried piece: text and files carry none.' })
  })

  it('an imported file the same; one with nothing carried says nothing', () => {
    w().addShard(tri('Plain'), 'Plain')
    expect(useToast.getState().toast).toBeNull()
    w().addShard({ ...tri('Two'), objects: { [`33331:${ME}:a`]: toPayload(tri('A')), [`33331:${ME}:b`]: toPayload(tri('B')) } }, 'Two')
    expect(useToast.getState().toast?.meta).toBe('2 carried pieces: text and files carry none.')
  })
})

describe('#506 3: no placement makes a loop', () => {
  it('stamping a shard that places this one, as a YOURS copy, is refused', () => {
    const roomId = w().currentId!
    const hall: ShardModel = { ...tri('Hall'), id: 'hall', refs: [['a', `33331:${ME}:${roomId}`]], parts: [{ ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: 0 }] }
    useWorkshop.setState({ shards: [...w().shards, hall] })
    const before = w().current()!
    w().setStampObject({ ref: ['a', `33331:${ME}:hall`], name: 'Hall', shard: hall, copy: { sourceId: 'hall', pubkey: ME } })
    w().placeObject([60, 0, 0])
    expect(w().notice).toBe('An object cannot place itself.')
    expect(w().current()!.parts).toEqual(before.parts)
  })

  it('pasting a placement of this shard into it is refused too', () => {
    const roomId = w().currentId!
    // In another shard, a placement of Room by its address; copied.
    w().create('hall')
    w().setStampObject({ ref: ['a', `33331:${ME}:${roomId}`], name: 'Room', shard: w().shards.find((s) => s.id === roomId)! })
    w().placeObject([0, 0, 0])
    useWorkshop.setState({ partSel: [0], selection: [] })
    w().copySelection()
    // Pasted into Room itself: Room would place Room.
    w().select(roomId)
    const before = w().current()!
    w().pasteClip('exact')
    expect(w().notice).toBe('An object cannot place itself.')
    expect(w().current()!.parts).toEqual(before.parts)
  })
})

describe('#506 4: the PUBLISH tag learns what the relays hold under your key', () => {
  it('learnMine reads your objects on every relay you write to and the general ones, and learns them', async () => {
    const learned = vi.spyOn(usePublished.getState(), 'learn')
    net.answer = [{ kind: 33331, pubkey: ME, id: 'e'.repeat(64), created_at: 1, tags: [['d', 'room']], content: '{}', sig: '' }]
    await learnMine(ME)
    expect(net.asked[net.asked.length - 1]).toMatchObject({ filter: { kinds: [33331], authors: [ME] } })
    expect((net.asked[net.asked.length - 1] as { relays: string[] }).relays).toContain('wss://relay.test')
    expect(learned).toHaveBeenCalledWith(net.answer)
  })

  it('the OBJECT picker asks for it when it opens', () => {
    const picker = readFileSync(join(__dirname, '../ObjectPicker.tsx'), 'utf8')
    expect(picker).toMatch(/useEffect\(\(\) => \{ if \(me\) void learnMine\(me\) \}, \[me\]\)/)
    // #504 4: the hint a live link falls back to is the configured canonical relay.
    expect(picker).toMatch(/relay \|\| relaySet\(\)\[0\] \|\| CYBERSPACE_RELAY/)
    expect(picker).not.toMatch(/'wss:\/\/cyberspace\.nostr1\.com'/)
  })
})
