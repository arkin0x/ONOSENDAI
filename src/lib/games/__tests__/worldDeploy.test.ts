/**
 * worldDeploy.test.ts - the owner's world, as DEPLOY.md has him make it: the
 * generator writes UNSIGNED events for his pubkey, he signs each with nak
 * (here: a throwaway key, signing exactly the fields nak signs: it keeps
 * kind, created_at, tags and content, and fills pubkey, id and sig) and
 * publishes them in file order. Then the game, live under that key, reads
 * its world from the relays and finds the dungeon every other test plays:
 * the same shards at the same places, the entry point at TUTORIAL_ENTRY.
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
import { gameLive } from '../flag'
import { TUTORIAL_DEV_PUBKEY, TUTORIAL_ENTRY, TUTORIAL_FIXTURE_WORLD, TUTORIAL_RELAY, tutorialGameFor } from '../tutorialGame'
import { loadWorld } from '../world'
import { unsignedWorld } from '../worldDeploy'
import fixture from '../tutorialDungeon.fixture.json'

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const source = fixture.events[0] as NostrEvent
/** nak event --sec: the file's kind, created_at, tags and content, signed by its key. */
const nakSign = (e: { kind: number; created_at: number; tags: string[][]; content: string }, key: Uint8Array): NostrEvent =>
  JSON.parse(JSON.stringify(finalizeEvent({ kind: e.kind, created_at: e.created_at, tags: e.tags, content: e.content }, key))) as NostrEvent
const where = (w: { shards: { at: { x: bigint; y: bigint; z: bigint } }[] }) => w.shards.map((s) => `${s.at.x},${s.at.y},${s.at.z}`).sort()

beforeEach(() => { published.length = 0 })

describe('the owner\'s world, unsigned, signed one event at a time', () => {
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
    const dev = await loadWorld({ ...tutorialGameFor(TUTORIAL_DEV_PUBKEY), world: TUTORIAL_FIXTURE_WORLD })
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
