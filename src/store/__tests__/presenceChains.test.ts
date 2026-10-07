/**
 * presenceChains.test.ts - where a neighbor with a broken chain stands, kept
 * right as they keep acting (review of #227, items 1 to 3, and the targets
 * and recent-avatars nit).
 *
 * What would go wrong silently: a neighbor who respawned staying frozen
 * forever because their new actions never get their chain read again; a
 * slow read of their old chain re-freezing them after they respawned; a
 * neighbor known to be broken shown unfrozen after you cross a sector; and
 * presence downloading a whole chain for every action an active neighbor
 * makes.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Each pubkey's events on the relays. */
const onRelays = new Map<string, NostrEvent[]>()
/** Every chain fetch: its arguments. */
const fetches: Array<{ pubkey: string; knownSpawnId?: string; have: number; since?: number }> = []
/** Held back while set: a fetch waits for it. */
let gate: Promise<void> | null = null
vi.mock('../../lib/chains', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/chains')>()),
  fetchChainEvents: async (pubkey: string, knownSpawnId?: string, have: NostrEvent[] = [], since?: number) => {
    fetches.push({ pubkey, knownSpawnId, have: have.length, since })
    const snapshot = [...(onRelays.get(pubkey) ?? [])]
    if (gate) await gate
    return snapshot
  },
}))
/** What the sweep's "newest action" question answers. */
let newestOnRelay: NostrEvent | null = null
vi.mock('../../lib/relay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/relay')>()),
  query: async () => (newestOnRelay ? [newestOnRelay] : []),
}))

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { coordToXyz, hexToCoord } from 'cyberspace-core'
import { parseAction, positionHex, spawnTemplate, type NostrEvent } from '../../lib/events'
import { forgetNeighborChains, heldChain, standingOf } from '../../lib/neighborChains'
import { useCyberspace } from '../useCyberspace'
import { checkChain, drainChainChecks, pendingChainChecks, stopPresence, sweep, usePresence } from '../usePresence'
import { hopEvent } from '../../lib/__tests__/chainFixtures'
import type { Position } from '../../lib/space'

/** A neighbor: spawn, a valid hop, then a hop that starts elsewhere (broken), and one more after it. */
function neighbor() {
  const sk = generateSecretKey()
  const pk = getPublicKey(sk)
  const home = coordToXyz(hexToCoord(pk))
  const at = (dy: bigint): Position => ({ x: home.x, y: home.y + dy, z: home.z })
  const hex = (p: Position): string => positionHex(p, home.plane)
  const sign = (e: NostrEvent): NostrEvent => finalizeEvent({ kind: e.kind, created_at: e.created_at, content: '', tags: e.tags }, sk) as NostrEvent
  const spawn = finalizeEvent(spawnTemplate(pk, 1_000), sk) as NostrEvent
  const hop1 = sign(hopEvent({ pubkey: pk, createdAt: 1_010, genesisId: spawn.id, previousId: spawn.id, c: pk, to: at(1n), plane: home.plane }))
  const stray = sign(hopEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: hop1.id, c: hex(at(7n)), to: at(8n), plane: home.plane }))
  const later = sign(hopEvent({ pubkey: pk, createdAt: 1_030, genesisId: spawn.id, previousId: stray.id, c: hex(at(8n)), to: at(9n), plane: home.plane }))
  // A respawn, and a valid hop on the new chain.
  const spawn2 = finalizeEvent(spawnTemplate(pk, 2_000), sk) as NostrEvent
  const hopB = sign(hopEvent({ pubkey: pk, createdAt: 2_010, genesisId: spawn2.id, previousId: spawn2.id, c: pk, to: at(3n), plane: home.plane }))
  return { pk, home: { x: home.x, y: home.y, z: home.z }, at, spawn, hop1, stray, later, spawn2, hopB }
}

const person = (pk: string) => usePresence.getState().people[pk]

beforeEach(() => {
  stopPresence()
  forgetNeighborChains()
  onRelays.clear()
  fetches.length = 0
  gate = null
  newestOnRelay = null
})

/** A neighbor known to be frozen at hop1, with "you" standing at their home. */
async function frozenNeighbor(): Promise<ReturnType<typeof neighbor>> {
  const n = neighbor()
  useCyberspace.setState({ position: n.home })
  onRelays.set(n.pk, [n.spawn, n.hop1, n.stray])
  usePresence.getState().ingest(n.stray)
  await drainChainChecks()
  expect(person(n.pk)).toMatchObject({ frozen: true, position: n.at(1n) })
  return n
}

describe('item 1: a frozen neighbor is read again, and unfrozen when they respawn', () => {
  it('a new action of a frozen neighbor queues a new chain read, and they stay frozen until it says otherwise', async () => {
    const n = await frozenNeighbor()
    onRelays.set(n.pk, [n.spawn, n.hop1, n.stray, n.later])
    usePresence.getState().ingest(n.later)
    expect(pendingChainChecks()).toEqual([[n.pk, n.later.id]])
    expect(person(n.pk)).toMatchObject({ frozen: true, position: n.at(1n), actionId: n.later.id })
  })

  it("the sweep's frozen branch queues a new read as well", async () => {
    const n = await frozenNeighbor()
    usePresence.setState((s) => ({ people: { ...s.people, [n.pk]: { ...s.people[n.pk], checkedAt: 0 } } }))
    newestOnRelay = n.later
    await sweep()
    expect(pendingChainChecks()).toEqual([[n.pk, n.later.id]])
    expect(person(n.pk).frozen).toBe(true)
  })

  it('a read that finds the chain valid clears frozen and places them at its head', async () => {
    const n = await frozenNeighbor()
    // They respawned and hopped; the spawn itself never reached this feed.
    onRelays.set(n.pk, [n.spawn, n.hop1, n.stray, n.spawn2, n.hopB])
    usePresence.getState().ingest(n.hopB)
    expect(person(n.pk).frozen).toBe(true)
    await drainChainChecks()
    expect(person(n.pk)).toMatchObject({ frozen: false, position: n.at(3n) })
  })

  it('a slow read of the old, broken chain does not re-freeze someone who respawned meanwhile', async () => {
    const n = neighbor()
    useCyberspace.setState({ position: n.home })
    onRelays.set(n.pk, [n.spawn, n.hop1, n.stray])
    usePresence.getState().ingest(n.stray)
    let open!: () => void
    gate = new Promise((r) => { open = r })
    const reading = checkChain(n.pk)
    usePresence.getState().ingest(n.spawn2)
    open()
    await reading
    expect(person(n.pk)).toMatchObject({ frozen: false, position: n.home, actionId: n.spawn2.id })
  })
})

describe('item 2: a neighbor known to be broken is frozen at once when met again', () => {
  it('after a sector change empties the people, re-ingesting them places them frozen without asking again', async () => {
    const n = await frozenNeighbor()
    const asked = fetches.length
    usePresence.setState({ people: {} })
    usePresence.getState().ingest(n.stray)
    expect(person(n.pk)).toMatchObject({ frozen: true, position: n.at(1n) })
    expect(pendingChainChecks()).toEqual([])
    expect(fetches.length).toBe(asked)
  })
})

describe("item 3: a neighbor's chain is kept and only what is newer is asked for", () => {
  it('the second read names the spawn, hands over what is held and asks from the newest second held', async () => {
    const n = await frozenNeighbor()
    expect(fetches[0]).toEqual({ pubkey: n.pk, knownSpawnId: undefined, have: 0, since: undefined })
    onRelays.set(n.pk, [n.spawn, n.hop1, n.stray, n.later])
    usePresence.getState().ingest(n.later)
    await drainChainChecks()
    expect(fetches[1]).toEqual({ pubkey: n.pk, knownSpawnId: n.spawn.id, have: 3, since: n.stray.created_at })
  })

  it('a new newest spawn reads the new chain and lets the old one go', async () => {
    const n = await frozenNeighbor()
    onRelays.set(n.pk, [n.spawn, n.hop1, n.stray, n.spawn2, n.hopB])
    usePresence.getState().ingest(n.hopB)
    await drainChainChecks()
    const held = heldChain(n.pk).map((e) => e.id)
    expect(held).toContain(n.hopB.id)
    expect(held).not.toContain(n.hop1.id)
    expect(held).not.toContain(n.stray.id)
  })
})

describe('targets and recent avatars place a broken neighbor where the chain froze', () => {
  it('a target with a broken chain is at its last valid position', () => {
    const n = neighbor()
    useCyberspace.getState().addTarget(n.pk)
    useCyberspace.getState().setTargetChain(n.pk, [n.spawn, n.hop1, n.stray, n.later])
    expect(useCyberspace.getState().targets[n.pk].position).toEqual(n.at(1n))
    useCyberspace.getState().removeTarget(n.pk)
  })

  it("the recent avatars list uses presence's cached read: frozen when known, as the action says otherwise", async () => {
    const n = neighbor()
    expect(standingOf(parseAction(n.stray)!).position).toEqual(n.at(8n))
    await frozenNeighborFrom(n)
    expect(standingOf(parseAction(n.stray)!).position).toEqual(n.at(1n))
  })
})

/** frozenNeighbor, for a neighbor already made. */
async function frozenNeighborFrom(n: ReturnType<typeof neighbor>): Promise<void> {
  useCyberspace.setState({ position: n.home })
  onRelays.set(n.pk, [n.spawn, n.hop1, n.stray])
  usePresence.getState().ingest(n.stray)
  await drainChainChecks()
}
