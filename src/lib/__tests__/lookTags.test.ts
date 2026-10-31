/**
 * lookTags.test.ts: the `look` tag (DECK-0004 §3.6, cyberspace PR #82, held)
 * as ONOSENDAI reads and writes it, and the door tag's height rule (§3.7.1).
 *
 * Read: the first well-formed closed and open look by shape alone, then the
 * payload checked, a failure meaning no look of that kind and never a fall
 * back; a look over 16,384 bytes is no look; the carried objects honour the
 * chest's signer only when it is signed. Drawn: a custom closed look with no
 * open one keeps its closed look on a chest and is not drawn on an opened
 * door. Written: the built-ins posed by SCALE, TURN and WALK, a MINE model
 * as a copy, a FEED object as a one-part wrapper. A malformed door is dropped.
 */
import { describe, expect, it } from 'vitest'
import { toPayload, type ShardModel } from 'sno-core/shards'
import { CHEST_LOOKS, DOOR_LOOKS, MAX_LOOK_BYTES, builtInLook, builtInLookTags, doorHeightOf, drawnLook, isTreasureShape, lookOf, lookRefusal, lookTags, lookTagsOf, posedLook } from '../looks'
import { chestInnerTemplate, chestItemOf, readItem, type ChestItem } from '../hidden'
import { constrainOf } from '../walkConstrain'
import { lookBounds } from '../../scene/LookMark'
import { feedWrapper } from '../../store/useShards'
import { unpublishedPieces } from '../../hud/LookPicker'
import type { FeedObject } from 'sno-core/feed'

const PK = 'a'.repeat(64)

/** A small valid model: one triangle. */
function tri(name = 'Panel', unit = 0): ShardModel {
  return {
    id: name, name, unit, extent: 8, mode: 'solid', up: false, spin: 0, updatedAt: 0,
    vertices: [{ p: [-1, 0, 0], c: [1, 0, 0] }, { p: [1, 0, 0], c: [0, 1, 0] }, { p: [0, 3, 0], c: [0, 0, 1] }],
    faces: [[0, 1, 2]],
  }
}
const payloadOf = (m: ShardModel): string => JSON.stringify(toPayload(m))
/** A payload DECK-0003 §1.9 refuses: a face naming a vertex that is not there. */
const BAD = JSON.stringify({ ...toPayload(tri()), faces: [[0, 1, 9]] })

describe('which look tags count (shape first, spec #82)', () => {
  it('takes the first closed (two elements) and the first open (third element "open")', () => {
    const t = lookTagsOf([['look', payloadOf(tri('A'))], ['look', payloadOf(tri('B'))], ['look', payloadOf(tri('C')), 'open'], ['look', payloadOf(tri('D')), 'open']])
    expect(t.closed?.name).toBe('A')
    expect(t.open?.name).toBe('C')
  })

  it('a counted payload that fails is no look of that kind: never a fall back to a later tag', () => {
    const t = lookTagsOf([['look', BAD], ['look', payloadOf(tri('Later'))], ['look', BAD, 'open'], ['look', payloadOf(tri('LaterOpen')), 'open']])
    expect(t.closed).toBeNull()
    expect(t.open).toBeNull()
  })

  it('a tag that is not well-formed by shape does not count, so the next well-formed one does', () => {
    const t = lookTagsOf([['look', 42], ['look', payloadOf(tri('Ajar')), 'ajar'], ['look'], ['look', payloadOf(tri('Real'))]] as unknown[])
    expect(t.closed?.name).toBe('Real')
    expect(t.open).toBeNull()
  })

  it('a look over 16,384 bytes is no look, and is refused when written', () => {
    const big = { ...tri('Big'), vertices: Array.from({ length: 1400 }, (_, i) => ({ p: [i % 8, (i >> 3) % 8, (i >> 6) % 8] as [number, number, number], c: [1, 1, 1] as [number, number, number] })) }
    const payload = payloadOf(big)
    expect(payload.length).toBeGreaterThan(MAX_LOOK_BYTES)
    expect(lookTagsOf([['look', payload]]).closed).toBeNull()
    expect(() => lookTags(big, null)).toThrow(/too large to wear/)
    expect(lookRefusal(MAX_LOOK_BYTES)).toBeNull()
    expect(lookRefusal(MAX_LOOK_BYTES + 1)).toMatch(/16,384/)
  })

  it('carried objects count only under the chest’s signer, and an unsigned chest honours no key', () => {
    const address = `33331:${PK}:piece`
    const carrying = { ...toPayload(tri('Carrier')), refs: [['a', address]], parts: [[0, 0, 0, 0, 0, 0, 0, 0]], objects: { [address]: toPayload(tri('Piece')) } }
    const tags = [['look', JSON.stringify(carrying)]]
    const signed = lookOf({ type: 'chest', event: { tags, pubkey: PK, sig: 'f'.repeat(128) } })!
    expect(Object.keys(signed.closed.objects ?? {})).toEqual([address])
    const unsigned = lookOf({ type: 'chest', event: { tags: [...tags], pubkey: PK } })!
    expect(unsigned.closed.objects).toBeUndefined()
  })
})

describe('which look a chest or a door wears', () => {
  it('a custom closed look wins over the built-in, for a chest and a door', () => {
    const chest = lookOf({ type: 'chest', event: { tags: [['look', payloadOf(tri('Crate'))]] } })!
    expect(chest).toMatchObject({ name: 'custom', kind: 'chest' })
    expect(chest.closed.name).toBe('Crate')
    const door = lookOf({ type: 'chest', event: { tags: [['door', '4'], ['look', payloadOf(tri('Gate'))]] } })!
    expect(door).toMatchObject({ name: 'custom', kind: 'door' })
  })

  it('opened with no open look: a chest keeps its closed look, a door is not drawn at all (§3.6)', () => {
    const chest = lookOf({ type: 'chest', event: { tags: [['look', payloadOf(tri('Crate'))]] } })!
    expect(drawnLook(chest, true)?.name).toBe('Crate')
    const door = lookOf({ type: 'chest', event: { tags: [['door', '4'], ['look', payloadOf(tri('Gate'))]] } })!
    expect(drawnLook(door, false)?.name).toBe('Gate')
    expect(drawnLook(door, true)).toBeNull()
  })

  it('an open look with no closed one is drawn over the built-in closed one', () => {
    const look = lookOf({ type: 'chest', event: { tags: [['look', payloadOf(tri('Lid up')), 'open']] } })!
    expect(look.closed).toBe(builtInLook('treasure').closed)
    expect(look.open?.name).toBe('Lid up')
    expect(look.lid).toBeUndefined()
  })

  it('a look that fails reads as the built-in, and the chest is kept', () => {
    expect(lookOf({ type: 'chest', event: { tags: [['look', BAD]] } })).toBe(builtInLook('treasure'))
  })
})

describe('the built-in looks', () => {
  it('a door offers CRAWL, DOOR and HALL, a chest TREASURE', () => {
    expect(DOOR_LOOKS).toEqual(['crawl', 'door', 'hall'])
    expect(CHEST_LOOKS).toEqual(['treasure'])
    for (const n of DOOR_LOOKS) expect(builtInLook(n).kind).toBe('door')
    expect(builtInLook('treasure').kind).toBe('chest')
  })

  it('CRAWL is 2 x 2 and HALL 4 x 6 gibsons, half a gibson thick, solid closed and walkable open', () => {
    const size = (m: ShardModel): number[] => { const b = lookBounds(m); return [0, 1, 2].map((k) => Math.round((b.max[k] - b.min[k]) * 2) / 2) }
    expect(size(builtInLook('crawl').closed)).toEqual([2, 2, 0.5])
    expect(size(builtInLook('hall').closed)).toEqual([4, 6, 0.5])
    for (const n of ['crawl', 'hall'] as const) {
      expect(constrainOf(builtInLook(n).closed)).toBe('all')
      expect(constrainOf(builtInLook(n).open!)).toBe('off')
    }
  })

  it('goes out as ordinary look tags, posed by SCALE, TURN and WALK, the open look posed alike', () => {
    const tags = builtInLookTags('door', { unit: 2, turn: [0, 1, 0], constrain: 'opaque' })
    expect(tags).toHaveLength(2)
    expect(tags[1][2]).toBe('open')
    const back = lookTagsOf(tags)
    expect(back.closed?.unit).toBe(2)
    expect(back.open?.unit).toBe(2)
    expect(constrainOf(back.closed!)).toBe('opaque')
    // A quarter turn about Y swaps the slab's width and thickness.
    const b = lookBounds(back.closed!)
    expect(Math.round((b.max[2] - b.min[2]) * 2) / 2).toBe(2)
  })

  it('TREASURE read back keeps its lid at any SCALE, and loses it when turned', () => {
    const plain = lookOf({ type: 'chest', event: { tags: builtInLookTags('treasure', { unit: 3, turn: [0, 0, 0], constrain: 'all' }) } })!
    expect(plain.name).toBe('custom')
    expect(plain.lid).toBeDefined()
    expect(isTreasureShape(plain.closed)).toBe(true)
    const turned = lookOf({ type: 'chest', event: { tags: builtInLookTags('treasure', { unit: 0, turn: [0, 1, 0], constrain: 'all' }) } })!
    expect(turned.lid).toBeUndefined()
  })
})

describe('MINE and FEED', () => {
  it('a MINE model goes out as a copy, closed only, at the bar’s pose', () => {
    const tags = lookTags(posedLook(tri('Statue'), { unit: 4, turn: [0, 0, 0], constrain: 'all' }), null)
    expect(tags).toHaveLength(1)
    const back = lookTagsOf(tags).closed!
    expect(back.name).toBe('Statue')
    expect(back.unit).toBe(4)
  })

  it('a FEED object is a one-part wrapper by its address, scaled by the part’s step', () => {
    const object = { address: `33331:${PK}:statue`, seen: ['wss://r.test'], shard: tri('Statue', 1) } as unknown as FeedObject
    const w = feedWrapper(object, 3)
    expect(w.vertices).toEqual([])
    expect(w.refs).toEqual([['a', object.address, 'wss://r.test']])
    expect(w.parts).toEqual([{ ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: 2 }])
    const back = lookTagsOf(lookTags(posedLook(w, { unit: 3, turn: [0, 1, 0], constrain: 'all' }), null)).closed!
    expect(back.refs?.[0][1]).toBe(object.address)
    expect(back.parts?.[0].turn).toEqual([0, 90, 0])
  })

  it('a model of yours placing pieces you never published waits for inline parts (spec #81)', () => {
    const own = { refs: [['a', `33331:${PK}:mine`]] as ShardModel['refs'] }
    expect(unpublishedPieces(own, PK, () => false)).toMatch(/not published/)
    expect(unpublishedPieces(own, PK, () => true)).toBeNull()
    expect(unpublishedPieces({ refs: [['a', `33331:${'b'.repeat(64)}:theirs`]] }, PK, () => false)).toBeNull()
  })
})

describe('the chest event carries its look', () => {
  const chest: ChestItem = { name: 'Box', lockPubkey: 'c'.repeat(64), senderPubkey: 'd'.repeat(64), requires: '', payload: 'sealed' }

  it('chestInnerTemplate writes the look tags before the protected marker, and chestItemOf reads them back', () => {
    const look = builtInLookTags('treasure', { unit: 0, turn: [0, 0, 0], constrain: 'all' })
    const t = chestInnerTemplate({ ...chest, look }, { x: 0n, y: 0n, z: 0n }, 0, 1)
    expect(t.tags.map((x) => x[0])).toEqual(['C', 'title', 'lock', 'requires', 'look', 'look', '-'])
    expect(chestItemOf({ kind: 3341, content: 'sealed', tags: t.tags })?.look).toEqual(look)
  })

  it('a chest without looks carries none', () => {
    const t = chestInnerTemplate(chest, { x: 0n, y: 0n, z: 0n }, 0, 1)
    expect(t.tags.some((x) => x[0] === 'look')).toBe(false)
    expect(chestItemOf({ kind: 3341, content: 'sealed', tags: t.tags })?.look).toBeUndefined()
  })
})

describe('the door tag (§3.7.1)', () => {
  it('reads one well-formed height of at least 1; a missing or malformed one is malformed', () => {
    expect(doorHeightOf([['title', 'x']])).toBeNull()
    expect(doorHeightOf([['door', '4']])).toBe(4)
    expect(doorHeightOf([['door']])).toBe('malformed')
    expect(doorHeightOf([['door', '0']])).toBe('malformed')
    expect(doorHeightOf([['door', '-1']])).toBe('malformed')
    expect(doorHeightOf([['door', '4'], ['door', '5']])).toBe('malformed')
  })

  it('a reader drops a malformed door: not a chest, not a door', () => {
    const tags = [['title', 'Gate'], ['lock', 'c'.repeat(64), 'd'.repeat(64)], ['door', 'four']]
    expect(chestItemOf({ kind: 3341, content: 'sealed', tags })).toBeNull()
    expect(readItem({ kind: 3341, content: 'sealed', tags, id: '1'.repeat(64) }, null)).toBeNull()
  })
})
