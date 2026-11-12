/**
 * world.test.ts - a game's world is the game key's newest bag sealed to the
 * region (DECK-0002 §5.1): nobody else's bag, no forged one, no bag of
 * another place. Real keys, bags and signatures; the bags come from a fixture
 * source, so no relay is asked.
 */

import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { newShard } from 'sno-core/shards'
import { bagTemplate, rumorOf, shardInnerTemplate } from '../../hidden'
import { positionHex, type NostrEvent } from '../../events'
import { ENTRY_TAG, loadWorld, regionCentre, worldKey } from '../world'
import { TUTORIAL_GAME } from '../tutorialGame'
import type { GameDef } from '../types'

const gameSk = generateSecretKey()
const stranger = generateSecretKey()
const at = { ...TUTORIAL_GAME.region.base, x: TUTORIAL_GAME.region.base.x + 3n }
const shard = (name: string) => ({ ...newShard(name), mode: 'points' as const, unit: 0, vertices: [{ p: [0, 0, 0] as [number, number, number], c: [1, 0, 0] as [number, number, number] }], faces: [] })

/** A shard item at `where`, with the entry tag when `entry`. */
function item(sk: Uint8Array, name: string, createdAt: number, where = at, entry = false): NostrEvent {
  const t = shardInnerTemplate(shard(name), where, 1, createdAt)
  return finalizeEvent(entry ? { ...t, tags: [...t.tags, [ENTRY_TAG]] } : t, sk)
}

async function bag(sk: Uint8Array, name: string, createdAt: number, lookupId?: string, inners?: NostrEvent[]): Promise<NostrEvent> {
  const { key, lookupId: d } = worldKey(TUTORIAL_GAME)
  return finalizeEvent(await bagTemplate(inners ?? [item(sk, name, createdAt)], key, lookupId ?? d, 6, createdAt), sk)
}

const gameOf = (events: NostrEvent[]): GameDef => ({ ...TUTORIAL_GAME, pubkey: getPublicKey(gameSk), world: { kind: 'fixture', load: async () => events } })

describe('loading a game world', () => {
  it('reads the game key\'s newest bag for the region, and nothing of anyone else\'s', async () => {
    const old = await bag(gameSk, 'old', 100)
    const newest = await bag(gameSk, 'newest', 200)
    const theirs = await bag(stranger, 'theirs', 300)
    const world = await loadWorld(gameOf([old, theirs, newest]))
    expect(world.shards.map((w) => w.shard.name)).toEqual(['newest'])
    expect(world.shards[0].at).toEqual(at)
  })

  it('drops a forged bag and a bag of another place', async () => {
    const good = await bag(gameSk, 'good', 100)
    // From JSON, as a relay delivers it: a spread would carry nostr-tools' cached verdict along.
    const forged = { ...JSON.parse(JSON.stringify(await bag(gameSk, 'forged', 400))), sig: 'ab'.repeat(64) }
    const elsewhere = await bag(gameSk, 'elsewhere', 500, 'cd'.repeat(32))
    const world = await loadWorld(gameOf([forged, elsewhere, good]))
    expect(world.shards.map((w) => w.shard.name)).toEqual(['good'])
  })

  it('an empty source is an empty world, entered at the region\'s centre', async () => {
    expect(await loadWorld(gameOf([]))).toEqual({ shards: [], entry: regionCentre(TUTORIAL_GAME) })
    const b = TUTORIAL_GAME.region.base
    expect(regionCentre(TUTORIAL_GAME)).toEqual({ x: b.x + 32n, y: b.y + 32n, z: b.z + 32n })
  })

  it('the entry point is the C of the first item with the entry tag; none marked, the region\'s centre (DECK-0002 §2.2)', async () => {
    const p1 = { ...at, z: at.z + 5n }
    const p2 = { ...at, z: at.z + 9n }
    const marked = await bag(gameSk, 'x', 100, undefined, [item(gameSk, 'plain', 100), item(gameSk, 'first', 101, p1, true), item(gameSk, 'second', 102, p2, true)])
    expect((await loadWorld(gameOf([marked]))).entry).toEqual(p1)
    const unmarked = await bag(gameSk, 'plain', 100)
    expect((await loadWorld(gameOf([unmarked]))).entry).toEqual(regionCentre(TUTORIAL_GAME))
  })

  it('the bundled placeholder marks its entry point at TUTORIAL_ENTRY', async () => {
    const { TUTORIAL_ENTRY } = await import('../tutorialGame')
    expect((await loadWorld(TUTORIAL_GAME)).entry).toEqual(TUTORIAL_ENTRY)
  })

  it('counts a marker of a kind no client draws, first in the list (review of #667)', async () => {
    const p1 = { ...at, z: at.z + 5n }
    const p2 = { ...at, z: at.z + 9n }
    const invisible = finalizeEvent({ kind: 30999, created_at: 100, tags: [['C', positionHex(p1, 1)], [ENTRY_TAG]], content: '' }, gameSk)
    const b = await bag(gameSk, 'x', 100, undefined, [invisible, item(gameSk, 'shard', 101, p2, true)])
    const world = await loadWorld(gameOf([b]))
    expect(world.entry).toEqual(p1)
    expect(world.shards.map((w) => w.shard.name)).toEqual(['shard'])
  })

  it('skips a marker outside the region, in the other plane, or not the game key\'s, for the next one (review of #667)', async () => {
    const outside = { ...at, x: TUTORIAL_GAME.region.base.x + 1000n }
    const p2 = { ...at, z: at.z + 9n }
    const otherPlane = (() => { const t = shardInnerTemplate(shard('ideaspace twin'), at, 0, 100); return finalizeEvent({ ...t, tags: [...t.tags, [ENTRY_TAG]] }, gameSk) })()
    const forged = finalizeEvent({ kind: 30999, created_at: 100, tags: [['C', positionHex(at, 1)], [ENTRY_TAG]], content: '' }, stranger)
    const b = await bag(gameSk, 'x', 100, undefined, [item(gameSk, 'far', 100, outside, true), otherPlane, forged, item(gameSk, 'good', 101, p2, true)])
    const world = await loadWorld(gameOf([b]))
    expect(world.entry).toEqual(p2)
    // The far shard is not drawn either: the world is inside its region.
    expect(world.shards.map((w) => w.shard.name)).toEqual(['good'])
  })

  it('counts a rumor of any kind the bag vouches for, not one of another key or with a forged id (DECK-0002 §2.2, spec §7.6 Rumors)', async () => {
    const p1 = { ...at, z: at.z + 3n }
    const p2 = { ...at, z: at.z + 5n }
    const p3 = { ...at, z: at.z + 9n }
    const gamePk = getPublicKey(gameSk)
    const marker = (where: typeof at, who: string) => rumorOf({ kind: 3330, created_at: 100, tags: [['C', positionHex(where, 1)], ['-'], [ENTRY_TAG]], content: '{}' }, who)
    const theirs = marker(p1, getPublicKey(stranger))
    const forged = { ...marker(p2, gamePk), id: 'ab'.repeat(32) }
    const vouched = marker(p3, gamePk)
    const b = await bag(gameSk, 'x', 100, undefined, [theirs as NostrEvent, forged as NostrEvent, vouched as NostrEvent, item(gameSk, 'shard', 101)])
    const world = await loadWorld(gameOf([b]))
    expect(world.entry).toEqual(p3)
    // A rumor of a shard is never drawn here (spec §7.6: a reader MAY drop one); only the signed shard is.
    expect(world.shards.map((w) => w.shard.name)).toEqual(['shard'])
  })

  it('the region\'s centre at height 0 is its base', () => {
    const base = TUTORIAL_GAME.region.base
    expect(regionCentre({ region: { base, height: 0, plane: 1 } })).toEqual(base)
  })
})
