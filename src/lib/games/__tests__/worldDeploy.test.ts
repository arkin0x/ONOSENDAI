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
import { positionHex, type NostrEvent } from '../../events'

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

import { bagTemplate, HIDDEN_KIND, newBagSettings, OBJECT_KIND, type BagEntry } from '../../hidden'
import { BAG_SAFE_BYTES, signedBytes } from '../../bagSize'
import { addHeld, heldFromFind } from '../../inventory'
import { parseHint } from '../../hint'
import { gameLive } from '../flag'
import { DOOR_AT, KEY_AT, KEY_BAG, KEY_ITEM_AT, TUTORIAL_DEV_PUBKEY, TUTORIAL_ENTRY, TUTORIAL_RELAY, tutorialGameFor } from '../tutorialGame'
import { loadWorld } from '../world'
import { buildDungeon, KEY_NAME, piecesOf, rebuiltKeyBag, unsignedWorld } from '../worldDeploy'
import { doorKey, doorSecretWith, keyItemHeld, readKeyBag, readRoom } from '../keyDoor'
import { regionBase } from '../../doors'
import { regionKeyAt } from '../../shardCrypto'
import fixture from './tutorialDungeon.v1.fixture.json'
import { DEFAULT_HINT_PREFS, saveHintPrefs } from '../../../store/deployHintPrefs'

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const source = fixture.events[0] as NostrEvent
const V1_GAME = { ...tutorialGameFor(TUTORIAL_DEV_PUBKEY), world: { kind: 'fixture' as const, load: async () => fixture.events as NostrEvent[] } }
/** nak event --sec: the file's kind, created_at, tags and content, signed by its key. */
const nakSign = (e: { kind: number; created_at: number; tags: string[][]; content: string }, key: Uint8Array): NostrEvent =>
  JSON.parse(JSON.stringify(finalizeEvent({ kind: e.kind, created_at: e.created_at, tags: e.tags, content: e.content }, key))) as NostrEvent
/**
 * A bag's sector hint, as ONOSENDAI's hide flow writes it (lib/hint.ts SECTOR_HINT): one well-formed `hint` of heights
 * 30, 30, 30 whose box holds the bag's region at `at`, in ideaspace, and the X, Y, Z and S tags that box fixes.
 */
function expectSectorHint(tags: string[][], at: { x: bigint; y: bigint; z: bigint }, height: number): void {
  const box = parseHint(tags, height)!
  expect(box).not.toBeNull()
  expect(box.heights).toEqual([30, 30, 30])
  expect(box.plane).toBe(1)
  const sector = (v: bigint): string => (v >> 30n).toString()
  expect(box.base).toEqual({ x: (at.x >> 30n) << 30n, y: (at.y >> 30n) << 30n, z: (at.z >> 30n) << 30n })
  expect(tags.filter((t) => t[0] === 'hint')).toHaveLength(1)
  expect(tags.find((t) => t[0] === 'X')).toEqual(['X', sector(at.x)])
  expect(tags.find((t) => t[0] === 'Y')).toEqual(['Y', sector(at.y)])
  expect(tags.find((t) => t[0] === 'Z')).toEqual(['Z', sector(at.z)])
  expect(tags.find((t) => t[0] === 'S')).toEqual(['S', `${sector(at.x)}-${sector(at.y)}-${sector(at.z)}`])
  expect(tags.find((t) => t[0] === 'H')).toEqual(['H', String(height)])
}

/** The game key's signer, as the generator holds it. */
const asGame = (key: Uint8Array) => (t: { kind: number; created_at: number; tags: string[][]; content: string }): NostrEvent => finalizeEvent(t, key) as NostrEvent
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
    const built = await buildDungeon(live, asGame(key), await piecesOf(source, TUTORIAL_DEV_PUBKEY, live), 1_800_000_100, 'references')
    for (const f of built.files.slice(0, upTo)) published.push(nakSign(f.event, key))
    return built
  }

  it('is four events: the key\'s public model, the key bag, the room, and the world bag last, all unsigned, nothing protected', async () => {
    const built = await buildDungeon(tutorialGameFor(pk), asGame(sk), await piecesOf(source, TUTORIAL_DEV_PUBKEY, tutorialGameFor(pk)), 1_800_000_100, 'references')
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
    expect(built.door.tags.find((t) => t[0] === 'door')).toEqual(['door', '5'])
    expect(built.door.tags.filter((t) => t[0] === 'look').map((t) => t.length)).toEqual([2, 3])
    expect(signedBytes(built.files[3].event)).toBeLessThan(BAG_SAFE_BYTES / 4)
  })

  it('the world bag and the key bag carry the sector hint of their region (spec §7.7); the room bag carries none (DECK-0004 §3.7.2)', async () => {
    const game = tutorialGameFor(pk)
    const built = await buildDungeon(game, asGame(sk), await piecesOf(source, TUTORIAL_DEV_PUBKEY, game), 1_800_000_100, 'references')
    expectSectorHint(built.files[3].event.tags, game.region.base, game.region.height)
    expectSectorHint(built.files[1].event.tags, KEY_ITEM_AT, 3)
    expect(built.files[2].event.tags.some((t) => ['hint', 'X', 'Y', 'Z', 'S', 'H'].includes(t[0]))).toBe(false)
  })

  it('the player\'s saved deploy bar switches, all off on this device, change nothing the game writes (arkinox, 2026-11-15)', async () => {
    const game = tutorialGameFor(pk)
    const build = async () => (await buildDungeon(game, asGame(sk), await piecesOf(source, TUTORIAL_DEV_PUBKEY, game), 1_800_000_100, 'references')).files.map((f) => f.event.tags.filter((t) => t[0] !== 'encrypted' && t[0] !== 'd'))
    const before = await build()
    saveHintPrefs({ height: false, sector: false, contents: false })
    try {
      const after = await build()
      expect(after).toEqual(before)
      expectSectorHint(after[1].map((t) => [...t]), KEY_ITEM_AT, 3)
    } finally {
      saveHintPrefs(DEFAULT_HINT_PREFS)
    }
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
    const built = await buildDungeon(live, asGame(own), await piecesOf(source, TUTORIAL_DEV_PUBKEY, live), 1_800_000_200, 'references')
    for (const f of built.files) published.push(nakSign(f.event, own))
    const after = await loadWorld(live)
    expect(after.door?.chest?.door).toBe(5)
    expect(after.door?.at).toEqual(DOOR_AT)
    expect(after.entry).toEqual(TUTORIAL_ENTRY)
    expect(after.shards).toHaveLength(11)
    // The eleven pieces are the LEGACY world's own objects, at their places.
    const was = new Set(before.shards.map((s) => `${s.shard.name}@${s.at.x},${s.at.y},${s.at.z}`))
    for (const s of after.shards) expect(was.has(`${s.shard.name}@${s.at.x},${s.at.y},${s.at.z}`)).toBe(true)
    // The key bag, from the relays; the door opens with its key; the room holds the finish tile.
    const keys = await readKeyBag(live)
    expect(keys.map((k) => k.at)).toEqual([KEY_ITEM_AT])
    expect(keys[0].key?.model).toEqual({ address: `33331:${live.pubkey}:tutorial-dungeon-key`, relay: TUTORIAL_RELAY })
    const row = heldFromFind(ME, keys[0], 0)!
    const secret = doorSecretWith(after.door!, doorKey(after.door!, { [row.id]: row }, ME)!)!
    const room = await readRoom(live, after.door!, secret)
    expect(room.found).toBe(true)
    expect(room.shards.map((s) => s.shard.name)).toEqual(['Maze Kit: aerocarnival checkered tile 4'])
  })

  it('refuses the DEV key and a secret that is not the game key\'s', async () => {
    const pieces = await piecesOf(source, TUTORIAL_DEV_PUBKEY, tutorialGameFor(pk))
    await expect(buildDungeon(tutorialGameFor(pk), asGame(generateSecretKey()), pieces, 1, 'references')).rejects.toThrow(/not the game key/)
  })
})

describe('the key item rebuilt in its bag: renamed "Tutorial Dungeon Key" (DEPLOY-v2.1.md), then raised off the platform (DEPLOY-v2.2.md)', () => {
  const ME = '34'.repeat(32)
  const T = 1_800_000_100
  const SPOT = positionHex(KEY_AT, 1)
  /**
   * The world as published 2026-11-14: buildDungeon's, with its key item
   * titled `title` and at `at` (re-signed so and resealed in its bag, as that
   * day's generator wrote it), all signed and on the relay over the LEGACY
   * world, whose objects it names. "Dungeon Key" at the key's spot is the
   * first publish (v2); "Tutorial Dungeon Key" there is the rename (v2.1).
   */
  async function publishedAs(key: Uint8Array, title: string, at = KEY_AT): Promise<{ live: ReturnType<typeof tutorialGameFor>; built: Awaited<ReturnType<typeof buildDungeon>>; keyBag: NostrEvent; oldItem: NostrEvent }> {
    const live = tutorialGameFor(getPublicKey(key))
    for (const f of await unsignedWorld(live, source, TUTORIAL_DEV_PUBKEY, T - 100)) published.push(nakSign(f.event, key))
    const built = await buildDungeon(live, asGame(key), await piecesOf(source, TUTORIAL_DEV_PUBKEY, live), T, 'references')
    const place = positionHex(at, live.region.plane)
    const oldItem = asGame(key)({ ...built.keyItem, tags: built.keyItem.tags.map((t) => t[0] === 'title' ? ['title', title] : t[0] === 'C' ? ['C', place] : t) })
    const kb = regionKeyAt(regionBase(KEY_BAG.at, KEY_BAG.height), KEY_BAG.height, 8)
    const oldBag = await bagTemplate([oldItem as unknown as BagEntry], kb.key, kb.lookupId, KEY_BAG.height, T, HIDDEN_KIND, newBagSettings(KEY_BAG.height), { at, plane: live.region.plane })
    const signed = built.files.map((f) => nakSign(f.name.startsWith('02-') ? oldBag : f.event, key))
    published.push(...signed)
    return { live, built, keyBag: signed[1], oldItem }
  }
  /** An item's kind, date, content and tags, with the tags named in `but` left out. */
  const except = (e: NostrEvent, ...but: string[]) => JSON.stringify([e.kind, e.created_at, e.content, e.tags.filter((t) => !but.includes(t[0]))])

  it('stands the key item two above the key\'s spot: still in its bag\'s region, the LEGACY key where it was', () => {
    expect([KEY_ITEM_AT.x - KEY_AT.x, KEY_ITEM_AT.y - KEY_AT.y, KEY_ITEM_AT.z - KEY_AT.z]).toEqual([0n, 2n, 0n])
    expect(KEY_BAG.at).toEqual(KEY_ITEM_AT)
    expect(regionBase(KEY_ITEM_AT, KEY_BAG.height)).toEqual(regionBase(KEY_AT, KEY_BAG.height))
    expect(tutorialGameFor(pk).key?.at).toEqual(KEY_AT)
  })

  it('the rename (v2.1): the title changes, and the key rises to KEY_ITEM_AT; the same secret, item key, model and date', async () => {
    const own = generateSecretKey()
    const { built, live, keyBag, oldItem } = await publishedAs(own, 'Dungeon Key')
    const r = await rebuiltKeyBag(live, asGame(own), keyBag, T + 1)
    expect(r.was.id).toBe(oldItem.id)
    expect(r.keyItem.tags.find((t) => t[0] === 'title')).toEqual(['title', KEY_NAME])
    expect(KEY_NAME).toBe('Tutorial Dungeon Key')
    expect(r.keyItem.tags.find((t) => t[0] === 'C')).toEqual(['C', positionHex(KEY_ITEM_AT, 1)])
    expect(except(r.keyItem, 'title', 'C')).toBe(except(oldItem, 'title', 'C'))
    expect(built.door.tags.find((t) => t[0] === 'lock')?.[1]).toBe(r.keyItem.tags.find((t) => t[0] === 'item')?.[1])
  })

  it('the raise (v2.2): only the key item\'s place changes; the bag the same outside, newer', async () => {
    const own = generateSecretKey()
    const { live, built, keyBag, oldItem } = await publishedAs(own, KEY_NAME)
    expect(oldItem.tags.find((t) => t[0] === 'C')).toEqual(['C', SPOT])
    const r = await rebuiltKeyBag(live, asGame(own), keyBag, T + 1)
    expect(r.was.id).toBe(oldItem.id)
    expect(r.keyItem.tags.find((t) => t[0] === 'C')).toEqual(['C', positionHex(KEY_ITEM_AT, 1)])
    // Everything but the place, as published: the title, the secret, the item key, the model, the motions, the date.
    expect(except(r.keyItem, 'C')).toBe(except(oldItem, 'C'))
    expect(r.keyItem.tags.find((t) => t[0] === 'secret')).toEqual(oldItem.tags.find((t) => t[0] === 'secret'))
    // The door's lock is still this item's public key.
    expect(built.door.tags.find((t) => t[0] === 'lock')?.[1]).toBe(r.keyItem.tags.find((t) => t[0] === 'item')?.[1])
    // The bag: the same d, height, hint and sector, a second newer, so it replaces the published one at its address.
    const bag = r.file.event
    expect(bag.pubkey).toBe(live.pubkey)
    expect('id' in bag || 'sig' in bag).toBe(false)
    expect(bag.created_at).toBe(keyBag.created_at + 1)
    expect(bag.tags.filter((t) => t[0] !== 'encrypted')).toEqual(keyBag.tags.filter((t) => t[0] !== 'encrypted'))
    expect(r.file.name).toBe('02-key-bag-33330.json')
  })

  it('published, the game reads the raised key at KEY_ITEM_AT, the same door opens with it, and the room is the same', async () => {
    const own = generateSecretKey()
    const { live, built, keyBag } = await publishedAs(own, KEY_NAME)
    expect((await readKeyBag(live)).map((k) => k.at)).toEqual([KEY_AT])
    const r = await rebuiltKeyBag(live, asGame(own), keyBag, T + 1)
    published.push(nakSign(r.file.event, own))
    const keys = await readKeyBag(live)
    expect(keys.map((k) => k.key?.name)).toEqual(['Tutorial Dungeon Key'])
    expect(keys.map((k) => k.at)).toEqual([KEY_ITEM_AT])
    const world = await loadWorld(live)
    expect(world.door?.eventId).toBe(built.door.id)
    const row = heldFromFind(ME, keys[0], 0)!
    const secret = doorSecretWith(world.door!, doorKey(world.door!, { [row.id]: row }, ME)!)
    expect(secret).toBe(built.doorSecret)
    expect((await readRoom(live, world.door!, secret!)).shards.map((s) => s.shard.name)).toEqual(['Maze Kit: aerocarnival checkered tile 4'])
  })

  it('a player who took the key before holds it once: the rebuilt one reads as held, TAKE adds no second row, and the old one opens the door', async () => {
    for (const title of ['Dungeon Key', KEY_NAME]) {
      published.length = 0
      const own = generateSecretKey()
      const { live, built, keyBag } = await publishedAs(own, title)
      const [old] = await readKeyBag(live)
      const oldRow = heldFromFind(ME, old, 0)!
      const items = { [oldRow.id]: oldRow }
      published.push(nakSign((await rebuiltKeyBag(live, asGame(own), keyBag, T + 1)).file.event, own))
      const [rebuilt] = await readKeyBag(live)
      expect(rebuilt.eventId).not.toBe(old.eventId)
      expect(keyItemHeld(items, rebuilt)).toBe(true)
      const again = addHeld(items, [heldFromFind(ME, rebuilt, 1)!])
      expect(again.added).toHaveLength(0)
      expect(Object.values(again.items).map((it) => it.name)).toEqual([title])
      const world = await loadWorld(live)
      expect(doorSecretWith(world.door!, doorKey(world.door!, again.items, ME)!)).toBe(built.doorSecret)
    }
  })

  it('refuses a bag that is not the game key\'s key bag, and a date not after the published one', async () => {
    const own = generateSecretKey()
    const { live, built, keyBag } = await publishedAs(own, KEY_NAME)
    await expect(rebuiltKeyBag(live, asGame(own), keyBag, keyBag.created_at)).rejects.toThrow(/newer/)
    await expect(rebuiltKeyBag(live, asGame(own), nakSign(built.files[2].event, own), T + 1)).rejects.toThrow(/key bag/)
    await expect(rebuiltKeyBag(tutorialGameFor(pk), asGame(sk), keyBag, T + 1)).rejects.toThrow(/key bag/)
    await expect(rebuiltKeyBag(live, asGame(generateSecretKey()), keyBag, T + 1)).rejects.toThrow(/not the game key/)
    // A tampered bag (its signature no longer holds), read as the generator reads it, from JSON (nostr-tools marks a verified object, and a spread copy keeps the mark).
    await expect(rebuiltKeyBag(live, asGame(own), JSON.parse(JSON.stringify({ ...keyBag, created_at: keyBag.created_at - 1 })) as NostrEvent, T + 1)).rejects.toThrow(/key bag/)
  })

  it('refuses a key bag of two entries, a key item this builder would not write, and one already as it writes it', async () => {
    const own = generateSecretKey()
    const { live, oldItem } = await publishedAs(own, KEY_NAME)
    const kb = regionKeyAt(regionBase(KEY_BAG.at, KEY_BAG.height), KEY_BAG.height, 8)
    const settings = newBagSettings(KEY_BAG.height)
    const place = { at: KEY_BAG.at, plane: live.region.plane }
    const bagOf = async (items: NostrEvent[]) => nakSign(await bagTemplate(items as unknown as BagEntry[], kb.key, kb.lookupId, KEY_BAG.height, T, HIDDEN_KIND, settings, place), own)
    await expect(rebuiltKeyBag(live, asGame(own), await bagOf([oldItem, oldItem]), T + 1)).rejects.toThrow(/exactly one entry/)
    const extra = asGame(own)({ ...oldItem, tags: [...oldItem.tags, ['extra', 'x']] })
    await expect(rebuiltKeyBag(live, asGame(own), await bagOf([extra]), T + 1)).rejects.toThrow(/by hand/)
    const done = asGame(own)({ ...oldItem, tags: oldItem.tags.map((t) => t[0] === 'C' ? ['C', positionHex(KEY_ITEM_AT, 1)] : t) })
    await expect(rebuiltKeyBag(live, asGame(own), await bagOf([done]), T + 1)).rejects.toThrow(/already as this builder writes it/)
  })
})
