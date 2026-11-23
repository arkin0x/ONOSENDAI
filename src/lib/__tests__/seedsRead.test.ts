/**
 * seedsRead.test.ts: seeds (DECK-0008 §8.2) read out of bags as items, inline,
 * from a sealed entry (kind 33335) and from a chest, exactly as shards are;
 * every check before the DNA, the NIP-13 precheck included, so a seed that
 * paid nothing never makes the client fetch; the one-bag plane rule; and a
 * DNA carried in the same bag handed to the resolver, not shown as an item.
 * The vectors' seeds come from sno-core's vendored copy. No network.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent } from 'nostr-tools/pure'
import { regionKeyAt } from '../shardCrypto'
import { bagTemplate, readItem, unbag, type BagEntry, type Reference, type ResolveReference } from '../hidden'
import { forgetSealedItems, sealedReference, sealedTemplate } from '../sealed'
import { readContents, sealEntries, openWithSecret } from '../chests'
import { workOk } from 'sno-core/seeds'
import { seedItemOf, seedsInPlane, setBagDnaSink, SEED_KIND } from '../seeds/seedItem'
import { DnaResolver } from '../seeds/dnaStore'
import { bytesToHex, positionHex, type NostrEvent } from '../events'
import { crystalDna, mineSeedEvent, planter, planterSk, vectors } from './seedsFixture'

const at = { x: 90_000n, y: 4_000n, z: 71n }
const rk = regionKeyAt(at, 6, 20)
const wire = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const dna = crystalDna()
const seed = mineSeedEvent({ dnaId: dna.id, planted: 975300, at, plane: 0, createdAt: 1794300000 })

async function bagOf(entries: BagEntry[]): Promise<NostrEvent> {
  return wire(finalizeEvent(await bagTemplate(entries, rk.key, rk.lookupId, 6, 1794300100), planterSk)) as NostrEvent
}

beforeEach(() => { forgetSealedItems(); setBagDnaSink(null) })

describe('reading a seed (§8.2)', () => {
  it('the vectors\' seeds: the precheck before the DNA, then the work at the DNA\'s price', () => {
    for (const c of vectors.seeds.cases) {
      const read = seedItemOf(c.event)
      // Only the one whose id has fewer leading zero bits than it commits to fails before the DNA.
      expect(read !== null).toBe(c.leading_zero_bits >= c.committed_target)
      if (read) {
        expect(read.dnaId).toBe(c.dna)
        expect(read.target).toBe(c.committed_target)
        expect(read.planter).toBe(c.event.pubkey)
      }
      // Once the DNA is known: its price decides (the one at 16 bits for a 21-bit DNA is skipped here).
      expect(read !== null && workOk({ id: read.id, tags: read.tags }, c.price)).toBe(c.grows)
    }
  })

  it('skips a seed with no nonce, a target below 16, a malformed planted, a bad dna id, or no C', () => {
    const good = vectors.seeds.cases[0].event
    const without = (name: string) => ({ ...good, tags: good.tags.filter((t: string[]) => t[0] !== name) })
    const swap = (name: string, value: string) => ({ ...good, tags: good.tags.map((t: string[]) => (t[0] === name ? [name, value, ...t.slice(2)] : t)) })
    expect(seedItemOf(good)).not.toBeNull()
    expect(seedItemOf(without('nonce'))).toBeNull()
    expect(seedItemOf(without('C'))).toBeNull()
    expect(seedItemOf(swap('planted', '0970524'))).toBeNull()
    expect(seedItemOf(swap('dna', 'xyz'))).toBeNull()
    expect(seedItemOf({ ...good, tags: good.tags.map((t: string[]) => (t[0] === 'nonce' ? ['nonce', t[1], '15'] : t)) })).toBeNull()
    expect(seedItemOf({ ...good, kind: 3330 })).toBeNull()
  })

  it('readItem reads a signed seed as a seed, with its tags', () => {
    const body = readItem(seed, planter)
    expect(body?.type).toBe('seed')
    expect(body?.seed?.dnaId).toBe(dna.id)
    expect(body?.seed?.planted).toBe(975300)
    expect(body?.seed?.coord).toBe(positionHex(at, 0))
    expect(body?.seed?.scale).toBe(0)
  })
})

describe('in a bag', () => {
  it('inline: one seed item, placed at its C, by its planter', async () => {
    const items = await unbag(await bagOf([wire(seed)]), rk.key, undefined, undefined, 6)
    expect(items.map((h) => h.type)).toEqual(['seed'])
    expect(items[0].eventId).toBe(seed.id)
    expect(items[0].at).toEqual(at)
    expect(items[0].seed?.id).toBe(seed.id)
  })

  it('a seed whose work is short of the base price is skipped before anything is fetched', async () => {
    const fetch = vi.fn(async () => [])
    const resolver = new DnaResolver({ fetch, load: async () => undefined, save: async () => {} })
    const cheap = mineSeedEvent({ dnaId: dna.id, planted: 975300, at, plane: 0, createdAt: 1794300000, bits: 8, target: 8 })
    const items = await unbag(await bagOf([wire(cheap)]), rk.key, undefined, undefined, 6)
    expect(items).toEqual([])
    // Nothing reached the resolver, so nothing was asked of a relay.
    expect(fetch).not.toHaveBeenCalled()
    expect(resolver.verdict(dna.id)).toBeUndefined()
  })

  it('a DNA in the same bag goes to the resolver, and is not an item of its own', async () => {
    const resolver = new DnaResolver({ fetch: async () => { throw new Error('no relays in a test') }, load: async () => undefined, save: async () => {} })
    setBagDnaSink((ev) => resolver.note(ev as NostrEvent))
    // Hidden in the planter's own bag, so signed by the bag's signer, and protected.
    const own = crystalDna(planterSk, [['-']])
    const items = await unbag(await bagOf([wire(own), wire(seed)]), rk.key, undefined, undefined, 6)
    expect(items.map((h) => h.type)).toEqual(['seed'])
    expect(resolver.verdict(own.id)?.state).toBe('ok')
    // Resolved from the bag: no relay asked.
    expect((await resolver.resolve(own.id)).state).toBe('ok')
  })

  it('from a sealed entry, read exactly as inline', async () => {
    const d = 'ab'.repeat(16)
    const sealed = wire(finalizeEvent(await sealedTemplate(wire(seed), rk.key, d, 1794300050), planterSk)) as NostrEvent
    const ref = sealedReference(planter, d, '', positionHex(at, 0)) as Reference
    const resolve: ResolveReference = async () => sealed
    const items = await unbag(await bagOf([ref]), rk.key, resolve, undefined, 6)
    expect(items.map((h) => h.type)).toEqual(['seed'])
    expect(items[0].eventId).toBe(seed.id)
    expect(items[0].sealedEvent?.id).toBe(sealed.id)
  })

  it('inside a chest, read as any of its contents', async () => {
    const sealedChest = sealEntries([wire(seed)], planter)
    const opened = openWithSecret(sealedChest, bytesToHex(planterSk))
    const contents = readContents(opened, planter)
    expect(contents.map((c) => c.body.type)).toEqual(['seed'])
    expect(contents[0].body.seed?.dnaId).toBe(dna.id)
  })
})

describe('the plane rule (spec §7.6 Planes)', () => {
  it('a view shows the seeds of its own plane only', () => {
    const items = [
      { key: 'a', type: 'seed', plane: 0 as const },
      { key: 'b', type: 'seed', plane: 1 as const },
      { key: 'c', type: 'shard', plane: 0 as const },
    ]
    expect(seedsInPlane(items, 0).map((w) => w.key)).toEqual(['a'])
    expect(seedsInPlane(items, 1).map((w) => w.key)).toEqual(['b'])
  })

  it('one bag holds a seed in each plane, each at its own C', async () => {
    const twin = mineSeedEvent({ dnaId: dna.id, planted: 975300, at, plane: 1, createdAt: 1794300001 })
    const items = await unbag(await bagOf([wire(seed), wire(twin)]), rk.key, undefined, undefined, 6)
    expect(items.map((h) => [h.type, h.plane])).toEqual([['seed', 0], ['seed', 1]])
    expect(seedsInPlane(items, 1).map((h) => h.eventId)).toEqual([twin.id])
    expect(SEED_KIND).toBe(3351)
  })
})
