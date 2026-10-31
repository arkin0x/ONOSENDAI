/**
 * chestContentsSealed.test.ts: what is inside a chest stays inside it, on
 * the relays and on Cyberspace TV (arkinox, 2026-10-20: "I was watching
 * cyberspace tv and I saw my shards encrypted in my chest appear visibly
 * ... I think chest contents should not be shown on TV").
 *
 * The leak was the hider's own client: a scan of their own bag opened the
 * chest with the key item they hold (addDiscovered, the gate of B1), and the
 * contents it revealed were claimed as the hider's deployments (claimOwn)
 * like any find of their own. Every rewrite of the region's bag is built
 * from those deployments, so the next hide, delete, move or broadcast there
 * published the chest's contents as plain entries of the bag, readable by
 * anyone with the region key: every viewer of TV, key or no key.
 *
 * Here: the contents of an opened chest are never claimed; no rewrite ever
 * carries an entry that is sealed inside a chest in the same bag, which also
 * heals a bag or a record written before the fix; and TV, holding the key or
 * not, shows such a bag as the chest alone. Relays are mocked; no network.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

/** Every event sent, and the bags a relay answers with (by `d`). */
const published: NostrEvent[] = []
const relayBags: NostrEvent[] = []
vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async (_r: string[], ev: NostrEvent) => { published.push(ev); return { ok: true } }),
  query: vi.fn(async (f: { kinds?: number[]; '#d'?: string[] }) => relayBags.filter((b) => f.kinds?.includes(b.kind) && (!f['#d'] || f['#d'].includes(b.tags.find((t) => t[0] === 'd')?.[1] ?? '')))),
  queryAny: vi.fn(async () => []),
  queryEach: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { newShard, type ShardModel } from 'sno-core/shards'
import { forgeKey, openWithSecret, readContents } from '../../lib/chests'
import { HIDDEN_KIND, bagTemplate, type Hidden } from '../../lib/hidden'
import { hexToBytes, type NostrEvent } from '../../lib/events'
import { unbagRecording } from '../../lib/foundCache'
import { TvScanner, type ScanKey } from '../../lib/tv/scan'
import { useCyberspace } from '../useCyberspace'
import { useInventory } from '../useInventory'
import { useShards } from '../useShards'
import { useWorkshop } from '../useWorkshop'
import { rememberOpened, resetOpenedChests } from '../useOpenedChests'

const S = () => useShards.getState()

/** OPEN was tapped on this chest earlier, on this device, by this identity. */
function openedEarlier(chestId: string, lock: string): void {
  rememberOpened(useCyberspace.getState().identity.pubkey, chestId, lock, [])
}

/** A model on the bench, deployable. */
function benchShard(name: string): ShardModel {
  const shard: ShardModel = {
    ...newShard(name),
    unit: 0,
    vertices: [{ p: [0, 0, 0], c: [1, 0, 0] }, { p: [1, 0, 0], c: [0, 1, 0] }, { p: [0, 1, 0], c: [0, 0, 1] }],
    faces: [[0, 1, 2]],
  }
  useWorkshop.setState({ shards: [...useWorkshop.getState().shards, shard], currentId: shard.id })
  return shard
}

/** The newest bag sent for a region. */
function lastBag(lookupId: string): NostrEvent {
  return published.filter((e) => e.kind === HIDDEN_KIND && e.tags.some((t) => t[0] === 'd' && t[1] === lookupId)).at(-1)!
}

/** What a bag opens to with its region key, as any finder (or TV) reads it. */
async function entriesOf(bag: NostrEvent, keyHex: string): Promise<Hidden[]> {
  return (await unbagRecording(bag, hexToBytes(keyHex))).items
}

/**
 * The hider's setup: a key item they hold (hidden elsewhere, height 5), and
 * a chest sealed to it at height 3 holding a shard and a message, then their
 * own scan of the chest's region, which opens it with the held key.
 */
async function hiderWithOpenedChest(): Promise<{ chestLookup: string; chestKey: string; shardName: string }> {
  const lock = forgeKey('Wind Key')
  S().startDeployKey(lock)
  useShards.setState({ deployHeight: 5 })
  await S().deploy()
  expect(S().deployStatus).toBe('done')
  const shard = benchShard('Secret Crucifix')
  S().startDeployChest({ name: 'Wind Chest', lock: { pubkey: lock.itemPubkey, label: 'Wind Key' }, requires: 'the Wind Key', contents: [{ kind: 'shard', shardId: shard.id }, { kind: 'message', text: 'behind the door' }] })
  useShards.setState({ deployHeight: 3 })
  await S().deploy()
  expect(S().deployStatus).toBe('done')
  const chest = S().mine.find((d) => d.type === 'chest')!
  // Nothing opens by itself (arkinox, 2026-10-26): the hider opened this
  // chest by hand earlier on this device, so their scan opens it again in
  // place with the held key (store/useOpenedChests).
  openedEarlier(chest.eventId, chest.chest!.lockPubkey)
  S().addDiscovered(await entriesOf(lastBag(chest.lookupId), chest.keyHex))
  const revealed = Object.values(S().discovered).filter((h) => h.chestId === chest.eventId)
  expect(revealed.map((h) => h.type).sort()).toEqual(['message', 'shard'])
  return { chestLookup: chest.lookupId, chestKey: chest.keyHex, shardName: shard.name }
}

beforeEach(() => {
  localStorage.removeItem('onosendai:chests-opened')
  resetOpenedChests()
  published.length = 0
  relayBags.length = 0
  useShards.setState({ mine: [], discovered: {}, deleted: {}, pending: null, deployHeight: 0, deployStatus: 'idle', deployError: null })
  useInventory.setState({ owner: useCyberspace.getState().identity.pubkey, items: {}, storage: 'memory' })
  useCyberspace.setState({ live: true })
  vi.spyOn(console, 'warn').mockImplementation(() => { /* IndexedDB is absent here */ })
})

describe('the hider opening their own chest', () => {
  it('a shard put in unaimed is signed at the chest with "opaque" when it never chose WALK (DECK-0003 §1.12)', async () => {
    await hiderWithOpenedChest()
    const h = Object.values(S().discovered).find((x) => x.type === 'shard')!
    expect(h.inner).toBeDefined()
    expect(JSON.parse(h.inner!.content)).toHaveProperty('constrain', 'opaque')
  })

  it('does not make its contents deployments of the bag', async () => {
    const { chestLookup } = await hiderWithOpenedChest()
    expect(S().mine.filter((d) => d.lookupId === chestLookup).map((d) => d.type)).toEqual(['chest'])
  })

  it('and the next rewrite of the bag carries the chest alone, never what is inside it', async () => {
    const { chestLookup, chestKey } = await hiderWithOpenedChest()
    S().startDeployMessage('a note beside the chest')
    useShards.setState({ deployHeight: 3 })
    await S().deploy()
    expect(S().deployStatus).toBe('done')
    const items = await entriesOf(lastBag(chestLookup), chestKey)
    expect(items.map((h) => h.type).sort()).toEqual(['chest', 'message'])
    expect(items.find((h) => h.type === 'message')?.text).toBe('a note beside the chest')
  })
})

describe('a bag or a record written before the fix', () => {
  /** The leak as it was: the chest's contents claimed as deployments of its region. */
  async function polluted(): Promise<{ chestLookup: string; chestKey: string }> {
    const r = await hiderWithOpenedChest()
    const chest = S().mine.find((d) => d.type === 'chest')!
    const claimed = Object.values(S().discovered).filter((h) => h.chestId === chest.eventId).map((h) => ({
      ...chest, eventId: h.eventId, inner: h.inner!, type: h.type, shard: h.shard, text: h.text, chest: undefined,
    }))
    useShards.setState({ mine: [...S().mine, ...claimed] })
    return r
  }

  it('heals at the next hide there: the claimed contents are left out', async () => {
    const { chestLookup, chestKey } = await polluted()
    S().startDeployMessage('later')
    useShards.setState({ deployHeight: 3 })
    await S().deploy()
    expect((await entriesOf(lastBag(chestLookup), chestKey)).map((h) => h.type).sort()).toEqual(['chest', 'message'])
  })

  it('heals at BROADCAST, which sends every deployment of the region', async () => {
    const { chestLookup, chestKey } = await polluted()
    expect(await S().broadcast(chestLookup)).toBe(true)
    expect((await entriesOf(lastBag(chestLookup), chestKey)).map((h) => h.type)).toEqual(['chest'])
  })

  it('heals a relay copy that already carries them, though this device never claimed them', async () => {
    const { chestLookup, chestKey } = await hiderWithOpenedChest()
    const chest = S().mine.find((d) => d.type === 'chest')!
    // The leaked version on the relay, as the old client wrote it: the chest and its contents side by side.
    const inside = Object.values(S().discovered).filter((h) => h.chestId === chest.eventId).map((h) => h.inner!)
    relayBags.push(await useCyberspace.getState().signEvent(await bagTemplate([chest.inner, ...inside], hexToBytes(chestKey), chestLookup, 3, Math.floor(Date.now() / 1000) + 60)))
    S().startDeployMessage('later')
    useShards.setState({ deployHeight: 3 })
    await S().deploy()
    expect(S().deployStatus).toBe('done')
    expect((await entriesOf(lastBag(chestLookup), chestKey)).map((h) => h.type).sort()).toEqual(['chest', 'message'])
  })

  it('leaves alone a chest this device cannot open, and everything else in the bag', async () => {
    // Nothing held opens it: its contents were never revealed, so nothing can be told apart.
    const shard = benchShard('Public relic')
    S().startDeployShard(shard.id)
    useShards.setState({ deployHeight: 3 })
    await S().deploy()
    const stranger = forgeKey('Someone else')
    S().startDeployChest({ name: 'Gift', lock: { pubkey: stranger.itemPubkey, label: 'theirs' }, requires: '', contents: [{ kind: 'message', text: 'for you' }] })
    useShards.setState({ deployHeight: 3 })
    await S().deploy()
    const chest = S().mine.find((d) => d.type === 'chest')!
    expect((await entriesOf(lastBag(chest.lookupId), chest.keyHex)).map((h) => h.type).sort()).toEqual(['chest', 'shard'])
  })
})

describe('the rewrites that take a chest out of a bag written the old way (review of #407)', () => {
  /** The leaked bag on the relay: the chest and its contents side by side, newer than anything here. */
  async function leakedOnRelay(): Promise<{ chestLookup: string; chestKey: string; shardId: string }> {
    const r = await hiderWithOpenedChest()
    const chest = S().mine.find((d) => d.type === 'chest')!
    const inside = Object.values(S().discovered).filter((h) => h.chestId === chest.eventId)
    relayBags.push(await useCyberspace.getState().signEvent(await bagTemplate([chest.inner, ...inside.map((h) => h.inner!)], hexToBytes(r.chestKey), r.chestLookup, 3, Math.floor(Date.now() / 1000) + 60)))
    return { ...r, shardId: inside.find((h) => h.type === 'shard')!.eventId }
  }

  it('DELETE of the chest publishes none of what was inside it, loose', async () => {
    const { chestLookup, chestKey } = await leakedOnRelay()
    S().startDeployMessage('stays')
    useShards.setState({ deployHeight: 3 })
    await S().deploy()
    relayBags.push(lastBag(chestLookup))
    const chest = S().mine.find((d) => d.type === 'chest')!
    await S().deleteInstance(chest.eventId)
    const items = await entriesOf(lastBag(chestLookup), chestKey)
    expect(items.map((h) => h.type)).toEqual(['message'])
    expect(items[0].text).toBe('stays')
  })

  it('taking a content out leaves the chest alone in the bag, and none of its contents beside it', async () => {
    const { chestLookup, chestKey, shardId } = await leakedOnRelay()
    expect(await S().removeFromChest(shardId)).toBeNull()
    const items = await entriesOf(lastBag(chestLookup), chestKey)
    expect(items.map((h) => h.type)).toEqual(['chest'])
  })

  it('a scan of the leaked copy after a reload claims nothing out of the chest, and drops what an old record claimed', async () => {
    const { chestLookup, chestKey } = await leakedOnRelay()
    const chest = S().mine.find((d) => d.type === 'chest')!
    // The record as the old client left it, and a fresh session: nothing found yet.
    const inside = Object.values(S().discovered).filter((h) => h.chestId === chest.eventId)
    useShards.setState({ mine: [...S().mine, ...inside.map((h) => ({ ...chest, eventId: h.eventId, inner: h.inner!, type: h.type, shard: h.shard, text: h.text, chest: undefined }))], discovered: {} })
    S().addDiscovered(await entriesOf(relayBags.at(-1)!, chestKey))
    expect(S().mine.filter((d) => d.lookupId === chestLookup).map((d) => d.type)).toEqual(['chest'])
    // Listed as the chest's, so DELETE takes it out of the chest rather than rewriting the bag's entries.
    for (const h of inside) expect(S().discovered[h.eventId]?.chestId).toBe(chest.eventId)
  })

  it('watching TV over the leaked bag claims nothing out of the chest back into the record', async () => {
    const { chestLookup, chestKey } = await leakedOnRelay()
    S().addDiscovered(await entriesOf(relayBags.at(-1)!, chestKey), { watched: true })
    expect(S().mine.filter((d) => d.lookupId === chestLookup).map((d) => d.type)).toEqual(['chest'])
  })

  it('after a reload, TV\'s kept copy first and a played scan of the mended bag later: nothing claimed, and listed as the chest\'s', async () => {
    const { chestLookup, chestKey } = await leakedOnRelay()
    const chest = S().mine.find((d) => d.type === 'chest')!
    const leaked = relayBags.at(-1)!
    // A fresh session: TV's kept bag comes back first, as watched (useFound).
    useShards.setState({ discovered: {} })
    S().addDiscovered(await entriesOf(leaked, chestKey), { watched: true })
    expect(S().mine.filter((d) => d.lookupId === chestLookup).map((d) => d.type)).toEqual(['chest'])
    // A hide mends the bag; a played scan of the new version lists the contents as the chest's.
    S().startDeployMessage('later')
    useShards.setState({ deployHeight: 3 })
    await S().deploy()
    const mended = lastBag(chestLookup)
    expect(mended.id).not.toBe(leaked.id)
    S().addDiscovered(await entriesOf(mended, chestKey))
    const inside = Object.values(S().discovered).filter((h) => h.chestId === chest.eventId)
    expect(inside.map((h) => h.type).sort()).toEqual(['message', 'shard'])
    expect(S().mine.filter((d) => d.lookupId === chestLookup).map((d) => d.type).sort()).toEqual(['chest', 'message'])
    expect(S().mine.find((d) => d.type === 'message')?.text).toBe('later')
  })

  it('taking a content out of a clean chest still works as it did', async () => {
    const { chestLookup, chestKey } = await hiderWithOpenedChest()
    const message = Object.values(S().discovered).find((h) => h.chestId && h.type === 'message')!
    expect(await S().removeFromChest(message.eventId)).toBeNull()
    const items = await entriesOf(lastBag(chestLookup), chestKey)
    expect(items.map((h) => h.type)).toEqual(['chest'])
    const lock = Object.values(useInventory.getState().items).find((it) => it.key?.name === 'Wind Key')!.key!
    const left = readContents(openWithSecret(items[0].chest!, lock.secretHex))
    expect(left.map((c) => c.body.type)).toEqual(['shard'])
  })
})

describe('Cyberspace TV', () => {
  /** A scanner at one key, opening bags as TV does (unbagRecording), and every bag the relay holds for it. */
  function scannerFor(lookupId: string, keyHex: string, bags: () => NostrEvent[], open?: (bag: NostrEvent, key: ScanKey) => Promise<{ items: Hidden[]; refs: Record<string, NostrEvent> }>): TvScanner {
    return new TvScanner({
      heights: [3],
      derive: async () => [{ lookupId, keyHex, height: 3 }],
      query: async () => bags(),
      open: open ?? ((bag, key) => unbagRecording(bag, hexToBytes(key.keyHex), undefined, { at: key.base, plane: 0 }, key.height)),
      batch: 10,
    })
  }

  it('shows the hider\'s rewritten bag as the chest alone, to anyone', async () => {
    const { chestLookup, chestKey } = await hiderWithOpenedChest()
    S().startDeployMessage('later')
    useShards.setState({ deployHeight: 3 })
    await S().deploy()
    const sc = scannerFor(chestLookup, chestKey, () => [lastBag(chestLookup)])
    await sc.prepare([{ position: { x: 0n, y: 0n, z: 0n }, plane: 0 }])
    const shown = sc.at({ x: 0n, y: 0n, z: 0n }, Number.MAX_SAFE_INTEGER).flatMap((o) => o.items)
    expect(shown.map((h) => h.type)).toEqual(['chest'])
  })

  it('never shows something that came out of a chest, whatever opened it', async () => {
    const { chestLookup, chestKey } = await hiderWithOpenedChest()
    const revealed = Object.values(S().discovered).filter((h) => h.chestId)
    // An opener that hands TV a chest's revealed contents beside the bag's entries.
    const sc = scannerFor(chestLookup, chestKey, () => [lastBag(chestLookup)], async (bag, key) => {
      const { items, refs } = await unbagRecording(bag, hexToBytes(key.keyHex))
      return { items: [...items, ...revealed], refs }
    })
    await sc.prepare([{ position: { x: 0n, y: 0n, z: 0n }, plane: 0 }])
    const opened = sc.at({ x: 0n, y: 0n, z: 0n }, Number.MAX_SAFE_INTEGER)
    expect(opened.flatMap((o) => o.items).map((h) => h.type)).toEqual(['chest'])
    // Not the whole bag as TV opened it, so it is never kept as a find to open again whole.
    expect(opened.every((o) => !o.whole)).toBe(true)
  })
})
