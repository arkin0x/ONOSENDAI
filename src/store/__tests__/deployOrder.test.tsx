/**
 * deployOrder.test.tsx: a deploy counts as an edit in the lists of your
 * shards (arkinox, 2026-10-23: "When I deployed a shard, I wanted it to move
 * to the top of the list, just like editing moves it to the top of the list.
 * Within its folder, of course."). A deploy that goes through moves what it
 * placed to the top of its folder in every list; a canceled or failed one,
 * or an aim into a chest that is not hidden yet, moves nothing; an edit
 * after it still moves the edited one above it. Relays are mocked; nothing
 * is published.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
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

vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { newShard, toPayload, type ShardModel } from 'sno-core/shards'
import { objectFromEvent, type FeedObject } from 'sno-core/feed'
import { forgeKey } from '../../lib/chests'
import { OBJECT_KIND } from '../../lib/hidden'
import { EMPTY_TREE, buildTree, newestFirst } from '../../lib/shardFolders'
import { modelEditedAt, modelRef } from '../../hud/ShardFolders'
import { PlaceObjectPicker } from '../../hud/PlaceObjectPicker'
import { useStash } from '../../hud/stash'
import { useCyberspace } from '../useCyberspace'
import { useShardFolders } from '../useShardFolders'
import { useShards } from '../useShards'
import { useWorkshop } from '../useWorkshop'

const S = () => useShards.getState()
const F = () => useShardFolders.getState()
const me = () => useCyberspace.getState().identity.pubkey

function model(id: string, updatedAt: number): ShardModel {
  return {
    ...newShard(id),
    id,
    name: id,
    updatedAt,
    vertices: [{ p: [0, 0, 0], c: [1, 0, 0] }, { p: [1, 0, 0], c: [0, 1, 0] }, { p: [0, 1, 0], c: [0, 0, 1] }],
    faces: [[0, 1, 2]],
  }
}

/** The order the lists draw: unfiled at the top, and each folder's own. */
function drawn(): { top: string[]; kit: string[] } {
  const list = newestFirst(useWorkshop.getState().shards, modelRef, modelEditedAt, F().tree.used)
  const built = buildTree(F().tree, list, modelRef)
  return { top: built.items.map((s) => s.id), kit: built.folders[0]?.items.map((s) => s.id) ?? [] }
}

/** PLACE OBJECT's MINE as it renders: the rows' names in drawing order. */
function placeRows(): string[] {
  useStash.setState({ pickTab: 'mine' })
  // A server render reads each store's initial state (as hud/__tests__/shardFoldersList does).
  Object.assign(useWorkshop.getInitialState(), useWorkshop.getState())
  Object.assign(useShardFolders.getInitialState(), useShardFolders.getState())
  const html = renderToStaticMarkup(<ul><PlaceObjectPicker /></ul>)
  return [...html.matchAll(/class="objpick__name">([^<]*)</g)].map((m) => m[1])
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5))

/** An object as the feed reads it, signed by `sk` or by this identity. */
async function object(d: string, sk?: Uint8Array): Promise<FeedObject> {
  const template = { kind: OBJECT_KIND, created_at: 1_700_000_000, tags: [['d', d]], content: JSON.stringify(toPayload(model(d, 0))) }
  const ev = sk ? finalizeEvent(template, sk) : await useCyberspace.getState().signEvent(template)
  return objectFromEvent(ev as Parameters<typeof objectFromEvent>[0])!
}

beforeEach(async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => { /* IndexedDB is absent here; folders stay in memory */ })
  useShards.setState({ mine: [], discovered: {}, deleted: {}, pending: null, deployHeight: 0, deployStatus: 'idle', deployError: null })
  useCyberspace.setState({ live: false })
  // Newest edited first: A, then B and C in the folder, then D.
  useWorkshop.setState({ shards: [model('D', 500), model('C', 1000), model('B', 2000), model('A', 3000)], currentId: 'A' })
  await F().load(me())
  useShardFolders.setState({ tree: EMPTY_TREE })
  const kit = F().createFolder('kit', null)!
  F().assignToFolder(['B', 'C'], kit)
})

describe('a deploy that goes through', () => {
  it('moves the shard to the top of its folder, and leaves the rest as they were', async () => {
    expect(drawn()).toEqual({ top: ['A', 'D'], kit: ['B', 'C'] })
    S().startDeployShard('C')
    await S().deploy()
    expect(S().deployStatus).toBe('done')
    expect(drawn()).toEqual({ top: ['A', 'D'], kit: ['C', 'B'] })
    // The shard's own event and edit time are not touched.
    expect(useWorkshop.getState().shards.find((s) => s.id === 'C')!.updatedAt).toBe(1000)
  })

  it('moves an unfiled shard to the top of the list', async () => {
    S().startDeployShard('D', 'workshop')
    await S().deploy()
    expect(drawn()).toEqual({ top: ['D', 'A'], kit: ['B', 'C'] })
  })

  it('shows in a list as drawn (PLACE OBJECT MINE)', async () => {
    expect(placeRows()).toEqual(['B', 'C', 'A', 'D'])
    S().startDeployShard('C')
    await S().deploy()
    expect(placeRows()).toEqual(['C', 'B', 'A', 'D'])
  })

  it('moves every shard a chest hid', async () => {
    const lock = forgeKey('Wind Key')
    S().startDeployChest({ name: 'Box', lock: { pubkey: lock.itemPubkey, label: 'Wind Key' }, requires: '', contents: [{ kind: 'shard', shardId: 'C' }, { kind: 'shard', shardId: 'D' }] })
    await S().deploy()
    expect(S().deployError).toBeNull()
    expect(drawn()).toEqual({ top: ['D', 'A'], kit: ['C', 'B'] })
  })

  it('moves your own object placed from the feed, and never someone else\'s', async () => {
    S().startDeployObject(await object('C'))
    await S().deploy()
    expect(S().deployStatus).toBe('done')
    expect(drawn().kit).toEqual(['C', 'B'])
    S().startDeployObject(await object('D', generateSecretKey()))
    await S().deploy()
    expect(S().deployStatus).toBe('done')
    expect(drawn().top).toEqual(['A', 'D'])
  })
})

describe('a deploy that does not go through', () => {
  it('canceled, moves nothing', () => {
    S().startDeployShard('C')
    S().cancelDeploy()
    expect(F().tree.used ?? {}).toEqual({})
    expect(drawn()).toEqual({ top: ['A', 'D'], kit: ['B', 'C'] })
  })

  it('failed, moves nothing', async () => {
    const realSign = useCyberspace.getState().signEvent
    useCyberspace.setState({ signEvent: async () => { throw new Error('signer said no') } })
    try {
      S().startDeployShard('C')
      await S().deploy()
    } finally {
      useCyberspace.setState({ signEvent: realSign })
    }
    expect(S().deployStatus).toBe('error')
    expect(F().tree.used ?? {}).toEqual({})
    expect(drawn()).toEqual({ top: ['A', 'D'], kit: ['B', 'C'] })
  })

  it('aimed into a chest not hidden yet, moves nothing', async () => {
    S().startDeployIntoChest({ name: 'Box', lock: null, requires: '', contents: [{ kind: 'shard', shardId: 'C' }] }, 0)
    await S().deploy()
    expect(S().deployStatus).toBe('done')
    expect(S().pending).toBeNull()
    expect(F().tree.used ?? {}).toEqual({})
  })
})

describe('an edit after a deploy', () => {
  it('still moves the edited shard above the deployed one', async () => {
    S().startDeployShard('C')
    await S().deploy()
    expect(drawn().kit).toEqual(['C', 'B'])
    await tick()
    useWorkshop.getState().rename('B', 'B')
    expect(drawn().kit).toEqual(['B', 'C'])
  })
})

/** Every .tsx under src, tests left out. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return f === '__tests__' ? [] : sources(p)
    return p.endsWith('.tsx') ? [p] : []
  })
}

describe('every list of your shards', () => {
  it('is sorted through the one helper, so the lists cannot drift apart', () => {
    const lists = sources(join(__dirname, '..', '..')).filter((p) => /<ShardFolders\b/.test(readFileSync(p, 'utf8')) && !p.endsWith('ShardFolders.tsx'))
    expect(lists.map((p) => p.split(/[\\/]/).pop()).sort()).toEqual(['ChestCompose.tsx', 'ObjectPicker.tsx', 'PlaceObjectPicker.tsx', 'Workshop.tsx'])
    for (const p of lists) {
      const text = readFileSync(p, 'utf8')
      // The items it hands the folders are the helper's.
      const items = text.match(/<ShardFolders items=\{(\w+)\}/)?.[1]
      expect([p, new RegExp(`const ${items}\\b[^=]*= useNewestFirst\\(`).test(text)]).toEqual([p, true])
      expect([p, /updatedAt \?\? 0\) -/.test(text)]).toEqual([p, false])
    }
  })
})
