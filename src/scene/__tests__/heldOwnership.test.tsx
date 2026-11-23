/**
 * heldOwnership.test.tsx: the world's own reading of who made a held item
 * (arkinox, 2026-11-06). Mounted as the scene mounts it, held state from ITEMS
 * and authorship from the item's own event:
 *
 *  - made by you (its event is yours) and held: the half model in the box at half;
 *  - made by someone else and held: the half model, no box;
 *  - judged by the item's event, never by the bag it came in or its credit line;
 *  - not held: the whole model, its outline and its name.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { window?: unknown }).window ??= globalThis
if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

vi.mock('../../lib/relay', () => ({ publishMany: vi.fn(async () => ({ ok: true })), query: vi.fn(async () => []), queryAny: vi.fn(async () => []), relaySet: () => ['wss://relay.test'] }))
vi.mock('@react-three/fiber', async (real) => ({
  ...(await real<object>()),
  useFrame: () => undefined,
  useThree: (pick: (s: unknown) => unknown) => pick({ gl: {} }),
}))
vi.mock('../TapTarget', async (real) => ({ ...(await real<object>()), TapTarget: () => null }))
vi.mock('../WorldLabel', async (real) => {
  const { createElement } = await import('react')
  return { ...(await real<object>()), WorldLabel: (props: object) => createElement('worldlabel', props) }
})
vi.mock('../ShardMesh', async () => {
  const { createElement } = await import('react')
  return { CUBE_EDGES: 'model-outline', ShardMesh: (props: object) => createElement('shardmesh', props) }
})
vi.mock('../../hooks/useItemModel', () => ({
  useItemModel: () => ({ shard: { unit: 0 }, extent: { centre: [0, 0, 0], half: [0.2, 0.2, 0.1], aroundY: 0.2, aroundX: 0.2, radius: 0.3 } }),
}))

import { createElement } from 'react'
import type { NostrEvent } from '../../lib/events'
import type { HeldItem } from '../../lib/inventory'
import type { KeyItem } from '../../lib/hidden'
import type { ViewAxes } from '../../lib/space'
import { HELD_OPACITY } from '../../lib/worldMarks'
import { mount, type Host, type Mounted } from '../../test/elementRoot'
import { useCyberspace } from '../../store/useCyberspace'
import { useInventory } from '../../store/useInventory'
import { useShards, type WorldItem } from '../../store/useShards'
import { WorldMessages } from '../WorldMessages'

const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: -1 } }
const HERE = { x: 1n << 40n, y: 1n << 40n, z: 1n << 40n }
const OTHER = 'b'.repeat(64)

const me = (): string => useCyberspace.getState().identity.pubkey

function keyItem(): KeyItem {
  return { name: 'Silver Key', about: '', itemPubkey: 'c'.repeat(64), secretHex: 'd'.repeat(64), model: { address: `33331:${'e'.repeat(64)}:key` }, animation: ['bob'] }
}

/** A key in the world: its event by `eventBy`, in a bag by `bagBy` (the world item's credit line). */
function worldKey(id: string, eventBy: string, bagBy: string): WorldItem {
  const event = { id, pubkey: eventBy, kind: 3340, created_at: 1, content: '', tags: [], sig: '' } as NostrEvent
  return { key: id, type: 'key', at: HERE, plane: 0, height: 0, mine: bagBy === me(), author: bagBy, keyItem: keyItem(), event, lineage: id }
}

/** Held in ITEMS, by its own id. */
function heldRow(w: WorldItem): HeldItem {
  return { rowKey: `${me()}/${w.key}`, owner: me(), id: w.key, type: 'key', name: 'Silver Key', event: w.event as NostrEvent, author: w.event!.pubkey, verified: true, source: 'found', place: null, from: null, at: 1, key: w.keyItem }
}

async function scene(items: WorldItem[], held: WorldItem[]): Promise<Mounted> {
  useShards.setState({ drawnItems: () => items, mine: [], discovered: {} })
  useInventory.setState({ owner: me(), items: Object.fromEntries(held.map((w) => [w.key, heldRow(w)])), storage: 'memory' })
  return mount(createElement(WorldMessages, { axes: AXES }))
}

const of = (m: Mounted, type: string): Host[] => m.all().filter((h) => h.type === type)
beforeEach(() => {
  useCyberspace.setState({ anchor: HERE, anchorPlane: 0, scaleExp: 0 })
})

describe('a held item in the world', () => {
  it('made by you: the half model inside the box at half', async () => {
    const own = worldKey('1'.repeat(64), me(), me())
    const m = await scene([own], [own])
    expect(of(m, 'shardmesh').map((h) => h.props.dim)).toEqual([HELD_OPACITY])
    expect(of(m, 'meshBasicMaterial').map((h) => h.props.opacity)).toEqual([HELD_OPACITY])
    expect(of(m, 'worldlabel')).toHaveLength(0)
    await m.unmount()
  })

  it('made by someone else: the half model, no box at all', async () => {
    const taken = worldKey('2'.repeat(64), OTHER, OTHER)
    const m = await scene([taken], [taken])
    expect(of(m, 'shardmesh').map((h) => h.props.dim)).toEqual([HELD_OPACITY])
    expect(of(m, 'meshBasicMaterial')).toHaveLength(0)
    await m.unmount()
  })

  it('judged by the item’s own event, not the bag it came in: someone else’s item in your bag has no box; yours in theirs does', async () => {
    const theirsInMine = worldKey('3'.repeat(64), OTHER, me())
    let m = await scene([theirsInMine], [theirsInMine])
    expect(of(m, 'meshBasicMaterial')).toHaveLength(0)
    await m.unmount()
    const mineInTheirs = worldKey('4'.repeat(64), me(), OTHER)
    m = await scene([mineInTheirs], [mineInTheirs])
    expect(of(m, 'meshBasicMaterial').map((h) => h.props.opacity)).toEqual([HELD_OPACITY])
    await m.unmount()
  })

  it('both at once: one box, round your own', async () => {
    const own = worldKey('5'.repeat(64), me(), me())
    const taken = worldKey('6'.repeat(64), OTHER, OTHER)
    const m = await scene([own, taken], [own, taken])
    expect(of(m, 'shardmesh').map((h) => h.props.dim)).toEqual([HELD_OPACITY, HELD_OPACITY])
    expect(of(m, 'meshBasicMaterial')).toHaveLength(1)
    await m.unmount()
  })

  it('not held, yours or anyone’s: the whole model, its outline and its name', async () => {
    const own = worldKey('7'.repeat(64), me(), me())
    const theirs = worldKey('8'.repeat(64), OTHER, OTHER)
    const m = await scene([own, theirs], [])
    expect(of(m, 'shardmesh').map((h) => h.props.dim ?? 1)).toEqual([1, 1])
    expect(of(m, 'meshBasicMaterial')).toHaveLength(0)
    expect(of(m, 'lineSegments').filter((h) => h.props.geometry === 'model-outline')).toHaveLength(2)
    expect(of(m, 'worldlabel')).toHaveLength(2)
    await m.unmount()
  })
})
