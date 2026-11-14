/**
 * worldDeploy.test.ts - the owner's world, as the deploy notes have it made:
 * the generator writes UNSIGNED events for the game key, each is signed as
 * nak signs it (here: a throwaway key, signing exactly the fields nak signs:
 * it keeps kind, created_at, tags and content, and fills pubkey, id and sig)
 * and published in file order. Then the game, live under that key, reads its
 * world from the relays.
 *
 * Two worlds, in the order they go up: the LEGACY one published 2026-11-13
 * (unsignedWorld: game-only key and gate), then the one with a real key item
 * and door published over it (buildDungeon, DEPLOY-v2.md), which names the
 * first one's objects by reference. Played at every step of the switch.
 *
 * The relays are an in-memory store here: nothing is sent anywhere.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import type { Filter } from 'nostr-tools/filter'
import type { NostrEvent } from '../../events'

const published = vi.hoisted(() => [] as NostrEvent[])
vi.mock('../../relay', async (orig) => {
  const matches = (f: Filter, e: NostrEvent): boolean =>
    (!f.kinds || f.kinds.includes(e.kind)) && (!f.authors || f.authors.includes(e.pubkey)) && (!f.ids || f.ids.includes(e.id))
    && (!f['#d'] || f['#d'].includes(e.tags.find((t) => t[0] === 'd')?.[1] ?? ''))
  const held = (f: Filter): NostrEvent[] => published.filter((e) => matches(f, e))
  return {
    ...(await orig<typeof import('../../relay')>()),
    ...(await import('../../../test/offlineRelay')).offlineRelay,
    relaySet: () => ['wss://relay.onosendai.tech'],
    query: async (f: Filter) => held(f),
    queryAny: async (_relays: string[], f: Filter) => held(f),
  }
})

import { HIDDEN_KIND, OBJECT_KIND } from '../../hidden'
import { BAG_SAFE_BYTES, signedBytes } from '../../bagSize'
import { heldFromFind } from '../../inventory'
import { gameLive } from '../flag'
import { GATE_AT, KEY_AT, TUTORIAL_DEV_PUBKEY, TUTORIAL_ENTRY, TUTORIAL_RELAY, tutorialGameFor } from '../tutorialGame'
import { loadWorld } from '../world'
import { buildDungeon, piecesOf, unsignedWorld } from '../worldDeploy'
import { doorKey, doorSecretWith, readKeyBag, readRoom } from '../keyDoor'
import fixture from './tutorialDungeon.v1.fixture.json'

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const source = fixture.events[0] as NostrEvent
const V1_GAME = { ...tutorialGameFor(TUTORIAL_DEV_PUBKEY), world: { kind: 'fixture' as const, load: async () => fixture.events as NostrEvent[] } }
/** nak event --sec: the file's kind, created_at, tags and content, signed by its key. */
const nakSign = (e: { kind: number; created_at: number; tags: string[][]; content: string }, key: Uint8Array): NostrEvent =>
  JSON.parse(JSON.stringify(finalizeEvent({ kind: e.kind, created_at: e.created_at, tags: e.tags, content: e.content }, key))) as NostrEvent
const where = (w: { shards: { at: { x: bigint; y: bigint; z: bigint } }[] }) => w.shards.map((s) => `${s.at.x},${s.at.y},${s.at.z}`).sort()

beforeEach(() => { published.length = 0 })

describe('the LEGACY world (published 2026-11-13), unsigned, signed one event at a time', () => {
  it('is every shard as a 33331 object and one bag last, all unsigned, for his pubkey, nothing protected', async () => {
    const files = await unsignedWorld(tutorialGameFor(pk), source, TUTORIAL_DEV_PUBKEY, 1_800_000_000)
    expect(files.map((f) => f.event.kind)).toEqual([...Array(15).fill(OBJECT_KIND), HIDDEN_KIND])
    expect(files.map((f) => f.name)).toEqual([...files.map((f) => f.name)].sort())
    expect(files[files.length - 1].name).toBe('99-bag-33330.json')
    for (const { event } of files) {
      expect(event.pubkey).toBe(pk)
      expect('id' in event || 'sig' in event).toBe(false)
      // A referenced object and a bag are published on their own: never `-` (spec §7.6 Protected items).
      expect(event.tags.some((t) => t[0] === '-')).toBe(false)
    }
    // Small: the shards are out of the bag.
    expect(signedBytes(files[files.length - 1].event)).toBeLessThan(BAG_SAFE_BYTES / 10)
  })

  it('signed and published in file order, the live game reads the same dungeon, entered at TUTORIAL_ENTRY', async () => {
    const live = tutorialGameFor(pk)
    expect(gameLive(live)).toBe(true)
    expect(live.relayHint).toBe(TUTORIAL_RELAY)
    for (const f of await unsignedWorld(live, source, TUTORIAL_DEV_PUBKEY, 1_800_000_000)) published.push(nakSign(f.event, sk))
    const world = await loadWorld(live)
    const dev = await loadWorld(V1_GAME)
    expect(world.entry).toEqual(TUTORIAL_ENTRY)
    expect(world.shards).toHaveLength(dev.shards.length)
    expect(where(world)).toEqual(where(dev))
    expect(world.shards.map((s) => s.shard.name).sort()).toEqual(dev.shards.map((s) => s.shard.name).sort())
  })

  it('signed by any other key, nothing is the game\'s: the world is empty, entered at the region\'s centre', async () => {
    const live = tutorialGameFor(pk)
    const wrong = generateSecretKey()
    for (const f of await unsignedWorld(live, source, TUTORIAL_DEV_PUBKEY, 1_800_000_000)) published.push(nakSign(f.event, wrong))
    expect((await loadWorld(live)).shards).toHaveLength(0)
  })

  it('a piece that did not come back is a world error, never a world with a hole in it (review of #697)', async () => {
    // A key of its own: references.ts keeps each answer for a minute, and the earlier tests fetched this key's rotunda.
    const own = generateSecretKey()
    const live = tutorialGameFor(getPublicKey(own))
    const files = await unsignedWorld(live, source, TUTORIAL_DEV_PUBKEY, 1_800_000_000)
    // The rotunda's object never reached the relay.
    for (const f of files) if (!f.name.includes('rotunda')) published.push(nakSign(f.event, own))
    await expect(loadWorld(live)).rejects.toThrow(/1 piece of this game's world could not be read/)
  })

  it('refuses the DEV key and a malformed key', async () => {
    await expect(unsignedWorld(tutorialGameFor(TUTORIAL_DEV_PUBKEY), source, TUTORIAL_DEV_PUBKEY, 1)).rejects.toThrow(/DEV/)
    await expect(unsignedWorld(tutorialGameFor('AB'.repeat(32)), source, TUTORIAL_DEV_PUBKEY, 1)).rejects.toThrow(/hex/)
  })
})

describe('the world with a real key item and door, published over the LEGACY one (DEPLOY-v2.md)', () => {
  const ME = '12'.repeat(32)
  /** The LEGACY world first, as it was published, then the new one's files, in order, up to `upTo` of them. */
  async function publishBoth(key: Uint8Array, upTo = Infinity): Promise<Awaited<ReturnType<typeof buildDungeon>>> {
    const live = tutorialGameFor(getPublicKey(key))
    for (const f of await unsignedWorld(live, source, TUTORIAL_DEV_PUBKEY, 1_800_000_000)) published.push(nakSign(f.event, key))
    const built = await buildDungeon(live, key, await piecesOf(source, TUTORIAL_DEV_PUBKEY, live), 1_800_000_100, 'references')
    for (const f of built.files.slice(0, upTo)) published.push(nakSign(f.event, key))
    return built
  }

  it('is four events: the key\'s public model, the key bag, the room, and the world bag last, all unsigned, nothing protected', async () => {
    const built = await buildDungeon(tutorialGameFor(pk), sk, await piecesOf(source, TUTORIAL_DEV_PUBKEY, tutorialGameFor(pk)), 1_800_000_100, 'references')
    expect(built.files.map((f) => f.name)).toEqual(['01-key-model-33331.json', '02-key-bag-33330.json', '03-room-bag-33330.json', '99-world-bag-33330.json'])
    expect(built.files.map((f) => f.event.kind)).toEqual([OBJECT_KIND, HIDDEN_KIND, HIDDEN_KIND, HIDDEN_KIND])
    for (const { event } of built.files) {
      expect(event.pubkey).toBe(pk)
      expect('id' in event || 'sig' in event).toBe(false)
      expect(event.tags.some((t) => t[0] === '-')).toBe(false)
    }
    // The model is public; the key bag says its height; the room bag says nothing of where, how high or what (DECK-0004 §3.7.2).
    expect(built.files[0].event.tags.some((t) => t[0] === 'encrypted')).toBe(false)
    expect(built.files[1].event.tags.find((t) => t[0] === 'H')?.[1]).toBe('3')
    expect(built.files[2].event.tags.map((t) => t[0]).sort()).toEqual(['d', 'encrypted', 'version'])
    expect(built.files[2].event.content).toBe('')
    // Inside: the key item and the door are signed by the game key, and the door is sealed to the key item.
    expect(built.keyItem.pubkey).toBe(pk)
    expect(built.door.pubkey).toBe(pk)
    expect(built.door.tags.find((t) => t[0] === 'lock')?.[1]).toBe(built.keyItem.tags.find((t) => t[0] === 'item')?.[1])
    expect(built.door.tags.find((t) => t[0] === 'door')).toEqual(['door', '6'])
    expect(built.door.tags.filter((t) => t[0] === 'look').map((t) => t.length)).toEqual([2, 3])
    expect(signedBytes(built.files[3].event)).toBeLessThan(BAG_SAFE_BYTES / 4)
  })

  it('the LEGACY world plays until the new world bag lands, then the new one: the door, its key bag, its room', async () => {
    const own = generateSecretKey()
    const live = tutorialGameFor(getPublicKey(own))
    // Everything but the world bag is up: the newest world bag is still the LEGACY one, and it still plays.
    await publishBoth(own, 3)
    const before = await loadWorld(live)
    expect(before.door).toBeNull()
    expect(before.shards).toHaveLength(15)
    // The world bag lands: the new world.
    const built = await buildDungeon(live, own, await piecesOf(source, TUTORIAL_DEV_PUBKEY, live), 1_800_000_200, 'references')
    for (const f of built.files) published.push(nakSign(f.event, own))
    const after = await loadWorld(live)
    expect(after.door?.chest?.door).toBe(6)
    expect(after.door?.at).toEqual(GATE_AT)
    expect(after.entry).toEqual(TUTORIAL_ENTRY)
    expect(after.shards).toHaveLength(11)
    // The eleven pieces are the LEGACY world's own objects, at their places.
    const was = new Set(before.shards.map((s) => `${s.shard.name}@${s.at.x},${s.at.y},${s.at.z}`))
    for (const s of after.shards) expect(was.has(`${s.shard.name}@${s.at.x},${s.at.y},${s.at.z}`)).toBe(true)
    // The key bag, from the relays; the door opens with its key; the room holds the finish tile.
    const keys = await readKeyBag(live)
    expect(keys.map((k) => k.at)).toEqual([KEY_AT])
    expect(keys[0].key?.model).toEqual({ address: `33331:${live.pubkey}:tutorial-dungeon-key`, relay: TUTORIAL_RELAY })
    const row = heldFromFind(ME, keys[0], 0)!
    const secret = doorSecretWith(after.door!, doorKey(after.door!, { [row.id]: row }, ME)!)!
    const room = await readRoom(live, after.door!, secret)
    expect(room.found).toBe(true)
    expect(room.shards.map((s) => s.shard.name)).toEqual(['Maze Kit: aerocarnival checkered tile 4'])
  })

  it('refuses the DEV key and a secret that is not the game key\'s', async () => {
    const pieces = await piecesOf(source, TUTORIAL_DEV_PUBKEY, tutorialGameFor(pk))
    await expect(buildDungeon(tutorialGameFor(pk), generateSecretKey(), pieces, 1, 'references')).rejects.toThrow(/not the game key/)
  })
})
