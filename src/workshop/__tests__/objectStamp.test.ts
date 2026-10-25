/**
 * objectStamp.test.ts - STAMP > OBJECT in ONOSENDAI (arkinox, 2026-09-26,
 * option A: your published objects plus anyone's by address).
 */

import { beforeEach, describe, expect, it } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { nip19 } from 'nostr-tools'
import { fromPayload } from 'sno-core/shards'
import { liveRef, objectsOf, parseObjectAddress } from '../ObjectPicker'
import { useWorkshop } from '../../store/useWorkshop'
import type { NostrEvent } from '../../lib/events'

const PK = 'e8ed3798c6ffebffa08501ac39e271662bfd160f688f94c45d692d8767dd345a'
const COLUMN = { v: 2, name: 'Column', unit: 0, mode: 'solid', vertices: [[0, 0, 0], [1, 0, 0], [0, 4, 0]], colors: [5, 5, 5], faces: [[0, 1, 2]] }
const ev = (over: Partial<NostrEvent>): NostrEvent => ({ id: 'x', pubkey: PK, created_at: 1, kind: 33331, tags: [['d', 'col']], content: JSON.stringify(COLUMN), sig: '', ...over })

describe('parseObjectAddress', () => {
  it('reads a bare address and an naddr with its relay hint', () => {
    expect(parseObjectAddress(`33331:${PK}:fce13d24`)).toEqual({ address: `33331:${PK}:fce13d24` })
    const naddr = nip19.naddrEncode({ kind: 33331, pubkey: PK, identifier: 'fce13d24', relays: ['wss://relay.example'] })
    expect(parseObjectAddress(`nostr:${naddr}`)).toEqual({ address: `33331:${PK}:fce13d24`, relay: 'wss://relay.example' })
  })
  it('refuses other kinds and junk', () => {
    expect(parseObjectAddress(nip19.naddrEncode({ kind: 30023, pubkey: PK, identifier: 'x' }))).toBeNull()
    expect(parseObjectAddress('hello')).toBeNull()
  })
})

describe('objectsOf', () => {
  it('keeps the newest version per d, drops hidden objects, the avatar and anything unreadable', () => {
    const list = objectsOf([
      ev({ created_at: 1 }),
      ev({ created_at: 5, content: JSON.stringify({ ...COLUMN, name: 'Column v2' }) }),
      ev({ tags: [['d', 'sealed'], ['encrypted', 'aes-256-gcm', 'ct', 'cyberspace:region']], content: 'This object is hidden at a place' }),
      ev({ tags: [['d', 'avatar']] }),
      ev({ tags: [['d', 'broken']], content: '{"v":9}' }),
    ])
    expect(list.map((o) => o.shard.name)).toEqual(['Column v2'])
    expect(list[0].address).toBe(`33331:${PK}:col`)
  })
})

describe('placeObject', () => {
  beforeEach(() => {
    useWorkshop.setState({ shards: [], currentId: null, selection: [], partSel: [], stampMode: 'shape', stampObject: null, stampFacing: 0 })
    useWorkshop.getState().create('wall')
  })
  const w = () => useWorkshop.getState()
  const column = () => ({ ref: ['a', `33331:${PK}:col`] as ['a', string], name: 'Column', shard: fromPayload(COLUMN, 'c')! })

  it('asks for an object first, then places it by reference where tapped, facing the stamp', () => {
    w().setStampMode('object')
    w().placeObject([120, 0, 0])
    expect(w().notice).toMatch(/Choose an object/)
    w().setStampObject(column())
    w().turnStamp()
    w().placeObject([120, 0, 0])
    const s = w().current()!
    expect(s.refs).toEqual([['a', `33331:${PK}:col`]])
    expect(s.parts).toEqual([{ ref: 0, at: [120, 0, 0], turn: [0, 90, 0], step: 0 }])
    w().placeObject([240, 0, 0])
    expect(w().current()!.refs).toHaveLength(1)
    expect(w().current()!.parts).toHaveLength(2)
  })

  it('never makes an object place itself', () => {
    const id = w().currentId!
    w().setStampObject({ ...column(), ref: ['a', `33331:${PK}:${id}`] })
    w().placeObject([0, 0, 0], `33331:${PK}:${id}`)
    expect(w().notice).toMatch(/cannot place itself/)
    expect(w().current()!.parts).toBeUndefined()
  })

  it('choosing a shape puts STAMP back on shapes', () => {
    w().setStampObject(column())
    expect(w().stampMode).toBe('object')
    w().setStampKind('block')
    expect(w().stampMode).toBe('shape')
  })
})

describe('YOURS: a copy goes inside (DECK-0003 §1.10; arkinox 2026-10-25, the source decides)', () => {
  const w = () => useWorkshop.getState()
  let wall = ''
  beforeEach(() => {
    useWorkshop.setState({ shards: [], currentId: null, selection: [], partSel: [], stampMode: 'shape', stampObject: null, stampFacing: 0 })
    w().addShard(fromPayload(COLUMN, 'c')!, 'Column', 'kit/column')
    w().create('wall')
    wall = w().currentId!
  })
  const yours = () => ({ ref: ['a', `33331:${PK}:kit/column`] as ['a', string], name: 'Column', shard: w().shards.find((s) => s.id === 'kit/column')!, copy: { sourceId: 'kit/column', pubkey: PK } })

  it('places a copy under a d that says nothing about it, carried in the shard, OPAQUE where never chosen, and a second stamp reuses it', () => {
    w().setStampObject(yours())
    w().placeObject([0, 0, 0])
    w().placeObject([240, 0, 0])
    const s = w().current()!
    expect(s.refs).toHaveLength(1)
    const [kind, address, relay] = s.refs![0]
    expect([kind, relay]).toEqual(['a', undefined])
    // Sixteen random hex: nothing of "kit/column" for an older reader to ask relays for.
    expect(address).toMatch(new RegExp(`^33331:${PK}:[0-9a-f]{16}$`))
    expect(s.parts).toHaveLength(2)
    expect(s.objects?.[address]).toMatchObject({ name: 'Column', constrain: 'opaque' })
  })

  it('makes a new copy once the piece in the workshop has changed: copies are never shared with a different version', () => {
    w().setStampObject(yours())
    w().placeObject([0, 0, 0])
    void w().replaceShard('kit/column', { ...w().shards.find((s) => s.id === 'kit/column')!, opacity: 50 })
    w().select(wall)
    w().placeObject([240, 0, 0])
    const s = w().current()!
    expect(s.refs).toHaveLength(2)
    expect(Object.values(s.objects ?? {}).map((e) => (e as { opacity?: number }).opacity ?? 100).sort()).toEqual([100, 50])
  })

  it('never stamps a shard into itself', () => {
    w().setStampObject({ ...yours(), copy: { sourceId: wall, pubkey: PK } })
    w().placeObject([0, 0, 0])
    expect(w().notice).toMatch(/cannot place itself/)
    expect(w().current()!.objects).toBeUndefined()
  })

  it('a pick from the FEED or by address is a live link, always with a relay hint', () => {
    expect(liveRef(`33331:${PK}:col`, 'wss://seen.example')).toEqual(['a', `33331:${PK}:col`, 'wss://seen.example'])
    expect(liveRef(`33331:${PK}:col`)[2]).toMatch(/^wss:\/\//)
  })
})
