/**
 * inventorySyncTerrain.test.ts: the synced inventory (store/inventorySync.ts)
 * meeting TERRAIN's own (store/useTerrain.ts): the field's load reads the
 * record and counts what the device kept once; a read landing while the
 * field is still loading (#960) or mid-play never overwrites a change; and
 * Quarry Charges and the Compiler taken as prizes reach the other device.
 * One fake relay and a generated key per test; nothing reaches a network.
 */

import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

const h = vi.hoisted(() => ({
  /** When set, the field's read of what it kept waits for it (a load under way). */
  gate: null as null | Promise<unknown>,
}))

vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  publish: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))
vi.mock('../../lib/terrain/terrainDb', async (orig) => {
  const real = await orig<typeof import('../../lib/terrain/terrainDb')>()
  const { vi: v } = await import('vitest')
  return { ...real, readOwner: v.fn(async (db: IDBDatabase, owner: string) => { if (h.gate) await h.gate; return real.readOwner(db, owner) }) }
})

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { matchFilter } from 'nostr-tools/filter'
import { v2 as nip44 } from 'nostr-tools/nip44'
import type { NostrEvent } from '../../lib/events'
import { useCyberspace } from '../useCyberspace'
import { useWalk } from '../useWalk'
import { setTerrainSession, syncTerrain, terrainSession, useTerrain } from '../useTerrain'
import { useBlueprints } from '../useBlueprints'
import { takeToy } from '../../lib/blueprint/smashRun'
import { COMPILER_ID, QUARRY_ID, carriedInto, emptyInventory, openTerrainDb, writeInventory, type Inventory } from '../../lib/terrain/terrainDb'
import { CHARGE, COMPILER, totalsOf } from '../../lib/inventoryRecord'
import { inventoryRecordFor, localFor, resetInventorySync, setInventoryDeps, syncInventory, type InventoryDeps } from '../inventorySync'

const HEAD = { x: 0x1234567890abcdef12350n, y: 0xfedcba0987654321fed90n, z: 0x0f0f0f0f0f0f0f0f0f0f0n }
const T = () => useTerrain.getState()
const settle = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms))

function fakeRelay() {
  const events: NostrEvent[] = []
  return {
    events,
    fetch: async (filter: Parameters<InventoryDeps['fetch']>[0]) => ({ events: events.filter((e) => matchFilter(filter, e)), trouble: false }),
    publish: async (ev: NostrEvent) => {
      const i = events.findIndex((e) => e.pubkey === ev.pubkey && e.kind === ev.kind)
      if (i >= 0 && events[i].created_at >= ev.created_at) return { ok: true as const }
      if (i >= 0) events.splice(i, 1)
      events.push(ev)
      return { ok: true as const }
    },
  }
}

function memStorage() {
  const m = new Map<string, string>()
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, removeItem: (k: string) => { m.delete(k) } }
}

let sk = generateSecretKey()
let A = getPublicKey(sk)
let relay = fakeRelay()

/** Device `storage`'s sync, for identity A, LIVE. `fetch` replaces the relay read (to act while it is out). */
function device(storage = memStorage(), fetch?: InventoryDeps['fetch']) {
  resetInventorySync()
  const conv = nip44.utils.getConversationKey(sk, A)
  setInventoryDeps({
    self: () => A,
    live: () => true,
    tutorial: () => false,
    crypto: () => ({ nip44Encrypt: async (p) => nip44.encrypt(p, conv), nip44Decrypt: async (c) => nip44.decrypt(c, conv) }),
    fetch: fetch ?? relay.fetch,
    sign: async (t) => finalizeEvent(t, sk) as unknown as NostrEvent,
    publish: relay.publish,
    storage,
    prefs: memStorage(),
  })
  return storage
}

function onScreen(): void {
  useCyberspace.setState({ identity: { pubkey: A, npub: '' }, position: { ...HEAD }, cursor: { ...HEAD }, anchor: { ...HEAD }, plane: 0, walking: false, spectate: null, exploreIndex: null, transit: null, live: false })
}

/** A reload of the page: no field, TERRAIN closed. */
function reload(): void {
  setTerrainSession(null)
  useTerrain.setState({ active: false, loading: false, inventory: emptyInventory() })
  useCyberspace.setState({ walking: false })
}

/** What this device's TERRAIN database keeps for A, as a device that never synced would hold it. */
async function keep(inv: Inventory): Promise<void> {
  const db = await openTerrainDb()
  await writeInventory(db, A, inv)
  db.close()
}

/** Another device's write: its own storage and blocks, synced to the relay. */
async function elsewhere(inv: Inventory): Promise<void> {
  const s = memStorage()
  device(s)
  const { loadedInventory } = await import('../inventorySync')
  loadedInventory(A, inv)
  await syncInventory()
}

beforeEach(async () => {
  if (T().active) await T().exit()
  // A field still being made (closing TERRAIN makes one) settles under the last identity, never under this test's.
  await syncTerrain()
  reload()
  h.gate = null
  sk = generateSecretKey()
  A = getPublicKey(sk)
  relay = fakeRelay()
  useWalk.setState({ gravity: false })
  onScreen()
  // The field the move to this identity makes is let go once it is made: each test's own load is the one it reads.
  await syncTerrain()
  reload()
  onScreen()
})

afterEach(() => {
  h.gate = null
  resetInventorySync()
  setInventoryDeps(null)
})

describe('the field\'s load reads the record', () => {
  it('what this device kept counted once, beside what another device holds; reloading never counts it again', async () => {
    await elsewhere(carriedInto(emptyInventory(), 5, 2))
    await keep(carriedInto(emptyInventory(), 3, 4))
    const here = device()
    await syncInventory(false)
    await T().enter()
    await settle()
    expect(terrainSession!.kept).toBe('ready')
    expect(T().inventory.counts).toEqual({ 3: 4, 5: 2 })
    await T().exit()
    reload()
    onScreen()
    device(here)
    await T().enter()
    await settle()
    expect(T().inventory.counts).toEqual({ 3: 4, 5: 2 })
    expect(totalsOf(inventoryRecordFor(A))).toEqual({ 3: 4, 5: 2 })
  })

  it('a read landing while the field is still loading never overwrites what it kept: both are there once it is read', async () => {
    await elsewhere(carriedInto(emptyInventory(), 5, 2))
    await keep(carriedInto(emptyInventory(), 3, 4))
    device()
    let release: (v: unknown) => void = () => {}
    h.gate = new Promise((r) => { release = r })
    // A field the identity switch may have made already is let go: this load is the one held at the gate.
    reload()
    onScreen()
    const entering = T().enter()
    await settle()
    expect(terrainSession!.kept).toBe('loading')
    // The other device's blocks arrive now: the bag is the field before's, so they wait for the read.
    await syncInventory(false)
    expect(T().inventory.counts[5]).toBeUndefined()
    release(null)
    await entering
    await settle()
    expect(T().inventory.counts).toEqual({ 3: 4, 5: 2 })
  })

  it('blocks carried while a read is out are in the bag after it, beside the other device\'s', async () => {
    const here = device()
    await T().enter()
    await settle()
    // The other device writes after this one's field is up, so its blocks come in on the read below.
    await elsewhere(carriedInto(emptyInventory(), 5, 2))
    let during = true
    device(here, async (f) => { if (during) { during = false; T().carry(3, 2) } return relay.fetch(f) })
    T().carry(3, 1)
    await syncInventory(false)
    expect(during).toBe(false)
    expect(T().inventory.counts).toEqual({ 3: 3, 5: 2 })
    // And kept on the device as shown.
    await settle()
    const db = await openTerrainDb()
    const { readOwner } = await import('../../lib/terrain/terrainDb')
    const kept = await readOwner(db, A)
    db.close()
    expect(kept.inventory.counts).toEqual({ 3: 3, 5: 2 })
  })
})

describe('Quarry Charges and the Compiler, taken as prizes', () => {
  const toy = (tool: 'compiler' | 'quarry-charge') => ({
    rowKey: `${A}/t/${tool}`, owner: A, prize: tool === 'compiler' ? { type: 'tool' as const, tool } : { type: 'tool' as const, tool, count: 7 },
    name: 'x', maker: 'game', lookup: 'l', at: { x: '0', y: '0', z: '0', plane: 0 }, made: 0,
  })

  it('are recorded as the Compiler owned and 7 charges gained, and reach another device in their slots', async () => {
    device()
    await T().enter()
    await settle()
    useBlueprints.setState({ toys: [toy('compiler'), toy('quarry-charge')] })
    expect(takeToy(`${A}/t/compiler`)).toBe(true)
    expect(takeToy(`${A}/t/quarry-charge`)).toBe(true)
    const rec = inventoryRecordFor(A)
    expect(rec.tools[COMPILER]).toBeGreaterThan(0)
    expect(totalsOf(rec)[CHARGE]).toBe(7)
    // Important: asks for the quick write (the minute's floor, not the ten).
    expect(localFor(A, undefined, false).own).toBe(2)
    await syncInventory()
    await T().exit()
    await settle()
    // Another device: the same identity, its own storage and an empty TERRAIN database.
    reload()
    onScreen()
    await keep(emptyInventory())
    device(memStorage())
    await syncInventory(false)
    await T().enter()
    await settle()
    expect(T().inventory.compiler).toBe('made')
    expect(T().inventory.charges).toBe(7)
    expect(T().inventory.hotbar.slice(0, 2)).toEqual([COMPILER_ID, QUARRY_ID])
  })
})
