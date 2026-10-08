/**
 * chainRulings.test.ts - your own chain, and the people around you, under
 * arkinox's rulings of 2026-10-07 (Q1, Q3, Q7).
 *
 * What would go wrong silently: an avatar drawn where a broken action claims
 * to take it; a move signed onto a chain no verifier counts; a respawn that
 * throws away the place the old chain froze at without leaving a way back;
 * an invalid newest spawn quietly replaced by an older chain; a zero-length
 * ride signed through a path that skipped the panel; and a neighbor with a
 * broken chain drawn where their newest action says.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

/** What the relays hold for any chain fetched in these tests. */
let relayHolds: NostrEvent[] = []
vi.mock('../../lib/chains', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/chains')>()),
  fetchChainEvents: async () => relayHolds,
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
import { positionHex, sectorTags, spawnTemplate, type NostrEvent } from '../../lib/events'
import { RECENT_VIEWS_KEY, type RecentView } from '../../lib/viewAt'
import { BROKEN_CHAIN_MESSAGE, useCyberspace, whyNoMove } from '../useCyberspace'
import { confirmRespawn } from '../../hud/BrokenChain'
import { derezzNow } from '../../hud/DerezzPanel'
import { checkChain, usePresence } from '../usePresence'
import { placeSpawn } from '../fixtures/placeSpawn'
import { actionEvent, hopEvent } from '../../lib/__tests__/chainFixtures'
import type { Position } from '../../lib/space'

const S = () => useCyberspace.getState()

async function land(dx: bigint): Promise<void> {
  const s = S()
  useCyberspace.setState({ pendingTarget: { ...s.position, x: s.position.x + dx } })
  await s.applyProofMessage({
    type: 'done', id: 0, mode: 'hop', elapsedMs: 1, proofHash: 'ab'.repeat(32),
    terrainK: 8, lca: { x: 1, y: 0, z: 0 }, totalOps: 1,
  })
}

const recent = (): RecentView[] => JSON.parse(localStorage.getItem(RECENT_VIEWS_KEY) ?? '[]') as RecentView[]

let fresh: Pick<ReturnType<typeof S>, 'events' | 'prevEventId' | 'genesisId' | 'published' | 'position' | 'plane' | 'headPlane' | 'positionHistory' | 'chain'>

beforeEach(async () => {
  if (!fresh) {
    await placeSpawn()
    await land(1n)
    fresh = {
      events: [...S().events], prevEventId: S().prevEventId, genesisId: S().genesisId,
      published: { ...S().published }, position: S().position, plane: S().plane, headPlane: S().headPlane,
      positionHistory: [...S().positionHistory], chain: S().chain,
    }
  }
  relayHolds = []
  localStorage.removeItem(RECENT_VIEWS_KEY)
  useCyberspace.setState({
    ...fresh, events: [...fresh.events], published: { ...fresh.published }, positionHistory: [...fresh.positionHistory],
    cursor: fresh.position, pendingTarget: null, forkNotice: null, chainConflict: null, plan: null,
    exploreIndex: null, spectate: null, focus: null, transit: null,
    proof: { ...S().proof, status: 'idle', message: null },
  })
})

/** Another device's hop from the head that starts somewhere the chain was not, and one that follows on from it. */
function breakIt(): { stray: NostrEvent; onward: NostrEvent; lastValid: { id: string; coordHex: string; position: Position } } {
  const s = S()
  const lastValid = { id: s.prevEventId, coordHex: s.coordHex(), position: s.position }
  const elsewhere = { ...s.position, y: s.position.y + 50n }
  const claimed = { ...s.position, y: s.position.y + 51n }
  const stray = actionEvent({
    pubkey: s.identity.pubkey, createdAt: s.events[s.events.length - 1].created_at + 1, genesisId: s.genesisId,
    previousId: s.prevEventId, name: 'hop', c: positionHex(elsewhere, s.plane), C: claimed, plane: s.plane, tags: [['proof', '0'.repeat(64)]],
  })
  const onward = actionEvent({
    pubkey: s.identity.pubkey, createdAt: stray.created_at + 1, genesisId: s.genesisId,
    previousId: stray.id, name: 'hop', c: positionHex(claimed, s.plane), C: { ...claimed, y: claimed.y + 1n }, plane: s.plane, tags: [['proof', '0'.repeat(64)]],
  })
  return { stray, onward, lastValid }
}

describe('Q3: your broken chain stands at its last valid position, and nothing moves it', () => {
  it('your identity is shown at the last valid C, not where the broken actions claim', () => {
    const { stray, onward, lastValid } = breakIt()
    S().adoptChain([stray, onward])
    expect(S().prevEventId).toBe(onward.id)
    expect(S().position).toEqual(lastValid.position)
    expect(S().coordHex()).toBe(lastValid.coordHex)
    expect(S().positionHistory.slice(-3)).toEqual([lastValid.position, lastValid.position, lastValid.position])
  })

  it('every move is refused with the broken-chain message, and nothing is signed', async () => {
    const { stray } = breakIt()
    S().adoptChain([stray])
    const count = S().events.length
    expect(whyNoMove(S().actions())).toBe(BROKEN_CHAIN_MESSAGE)
    useCyberspace.setState({ cursor: { ...S().position, x: S().position.x + 2n } })
    await S().commit()
    expect(S().proof.status).toBe('infeasible')
    expect(S().proof.message).toBe(BROKEN_CHAIN_MESSAGE)
    await S().boardHyperspace()
    await expect(S().completeRide({
      previousId: S().prevEventId, toCoordHex: S().coordHex(), fromHeight: 1, toHeight: 2,
      rootHex: '0'.repeat(64), mp: 'ab', mnHex: '0'.repeat(16),
    })).rejects.toThrow(BROKEN_CHAIN_MESSAGE)
    expect(S().events).toHaveLength(count)
    expect(BROKEN_CHAIN_MESSAGE).toMatch(/RESPAWN/)
  })

  it('the End of Chain entry is added to Recent before the respawn runs, at the last valid position', async () => {
    const { stray, lastValid } = breakIt()
    S().adoptChain([stray])
    const realRespawn = S().respawn
    let seenAtRespawn: RecentView[] | null = null
    useCyberspace.setState({ respawn: async () => { seenAtRespawn = recent() } })
    try {
      await S().respawnFromBrokenChain()
    } finally {
      useCyberspace.setState({ respawn: realRespawn })
    }
    expect(seenAtRespawn).not.toBeNull()
    expect(seenAtRespawn![0]).toEqual({ input: lastValid.coordHex, label: `End of Chain ${lastValid.id.slice(0, 8)}`, plane: S().plane, pinned: true })
  })

  it('then respawns for real: a new chain at the spawn point, and the entry stays', async () => {
    const { stray, lastValid } = breakIt()
    S().adoptChain([stray])
    const respawns = S().respawns
    await S().respawnFromBrokenChain()
    expect(S().events).toHaveLength(1)
    expect(whyNoMove(S().actions())).toBeNull()
    expect(S().respawns).toBe(respawns + 1)
    expect(recent()[0].label).toBe(`End of Chain ${lastValid.id.slice(0, 8)}`)
    // The test chain is put back for whatever runs next.
    fresh = undefined as unknown as typeof fresh
  })
})

describe('review of #227: a failed respawn says so, and DEREZZ on a broken chain leaves End of Chain too', () => {
  it('a respawn that fails is reported, not closed silently, and End of Chain stays in Recent', async () => {
    const { stray, lastValid } = breakIt()
    S().adoptChain([stray])
    const realRespawn = S().respawn
    useCyberspace.setState({ respawn: async () => { throw new Error('the signer declined') } })
    let failure: string | null = null
    try {
      failure = await confirmRespawn(S().identity.pubkey, lastValid.id)
    } finally {
      useCyberspace.setState({ respawn: realRespawn })
    }
    expect(failure).toBe(`Respawn failed: the signer declined. Nothing was signed, and your chain is as it was. End of Chain ${lastValid.id.slice(0, 8)} stays in RECENT in the Position panel. You can try again.`)
    expect(recent()[0]).toMatchObject({ label: `End of Chain ${lastValid.id.slice(0, 8)}`, pinned: true })
    expect(whyNoMove(S().actions())).toBe(BROKEN_CHAIN_MESSAGE)
  })

  it('DEREZZ NOW on a broken chain goes through the broken-chain respawn, so End of Chain is added first', async () => {
    const { stray, lastValid } = breakIt()
    S().adoptChain([stray])
    const realRespawn = S().respawn
    let seen: RecentView[] | null = null
    useCyberspace.setState({ respawn: async () => { seen = recent() } })
    try {
      expect(await derezzNow()).toBeNull()
    } finally {
      useCyberspace.setState({ respawn: realRespawn })
    }
    expect(seen![0]).toMatchObject({ input: lastValid.coordHex, label: `End of Chain ${lastValid.id.slice(0, 8)}` })
  })
})

describe('Q7: a newer invalid spawn of yours is your chain, dead, at your spawn coordinate', () => {
  it('no fallback to the older chain; moves refused; End of Chain names the spawn', async () => {
    const s = S()
    const pk = s.identity.pubkey
    const home = coordToXyz(hexToCoord(pk))
    const away = { x: home.x + 1000n, y: home.y, z: home.z }
    const bad = await s.signEvent({
      kind: 3333, created_at: s.events[s.events.length - 1].created_at + 5, content: '',
      tags: [['A', 'spawn'], ['C', positionHex(away, home.plane)], ...sectorTags(away)],
    })
    S().adoptChain([bad])
    expect(S().events.map((e) => e.id)).toEqual([bad.id])
    expect(S().position).toEqual({ x: home.x, y: home.y, z: home.z })
    expect(S().coordHex()).toBe(pk)
    expect(whyNoMove(S().actions())).toBe(BROKEN_CHAIN_MESSAGE)
    const realRespawn = S().respawn
    useCyberspace.setState({ respawn: async () => {} })
    try { await S().respawnFromBrokenChain() } finally { useCyberspace.setState({ respawn: realRespawn }) }
    expect(recent()[0]).toMatchObject({ input: pk, label: `End of Chain ${bad.id.slice(0, 8)}` })
    // A real respawn, so the next test builds on a valid chain again.
    await S().respawn()
    fresh = undefined as unknown as typeof fresh
  })
})

describe('Q1: the store never signs a zero-length ride', () => {
  it('a ride from a boarding to the station itself is refused, with the way to get there', async () => {
    await S().boardHyperspace()
    expect(S().transit).not.toBeNull()
    const count = S().events.length
    await expect(S().completeRide({
      previousId: S().prevEventId, toCoordHex: S().coordHex(), fromHeight: 7, toHeight: 7,
      rootHex: '0'.repeat(64), mp: 'ab', mnHex: '0'.repeat(16),
    })).rejects.toThrow(/ride to any other block first, then ride back to block 7/)
    expect(S().events).toHaveLength(count)
  })
})

describe('Q3 for others: presence places a neighbor with a broken chain where it froze', () => {
  it('their last valid position, not their newest action, and a newer action does not move them', async () => {
    usePresence.setState({ people: {}, sector: null, loading: false })
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    const home = coordToXyz(hexToCoord(pk))
    const plane = home.plane
    // Somewhere in your neighborhood, on their own chain.
    const near = (dx: bigint): Position => ({ ...S().position, x: S().position.x + dx })
    const spawn = finalizeEvent(spawnTemplate(pk, 1_000), sk) as NostrEvent
    const sign = (e: NostrEvent): NostrEvent => finalizeEvent({ kind: e.kind, created_at: e.created_at, content: '', tags: e.tags }, sk) as NostrEvent
    // A legacy teleport would be needed to get near you validly, so the
    // valid stretch is a hop from home, then a stray hop that lands near you.
    const hop1 = sign(hopEvent({ pubkey: pk, createdAt: 1_010, genesisId: spawn.id, previousId: spawn.id, c: pk, to: { ...home, x: home.x + 1n }, plane }))
    const stray = sign(hopEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: hop1.id, c: positionHex(near(3n), plane), to: near(4n), plane }))
    relayHolds = [spawn, hop1, stray]
    usePresence.getState().ingest(stray)
    expect(usePresence.getState().people[pk].position).toEqual(near(4n))
    // The chain froze at hop1, at home, far from you: they are not here at all.
    await checkChain(pk)
    expect(usePresence.getState().people[pk]).toBeUndefined()
  })

  it('a broken chain that froze here keeps them here, frozen, through newer actions', async () => {
    usePresence.setState({ people: {}, sector: null, loading: false })
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    const home = coordToXyz(hexToCoord(pk))
    const spawn = finalizeEvent(spawnTemplate(pk, 1_000), sk) as NostrEvent
    // Their spawn row itself is valid; the hop after it starts elsewhere, so
    // they stand at their spawn. Put "you" next to their spawn for the test.
    const sign = (e: NostrEvent): NostrEvent => finalizeEvent({ kind: e.kind, created_at: e.created_at, content: '', tags: e.tags }, sk) as NostrEvent
    const stray = sign(hopEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: spawn.id, c: positionHex({ ...home, y: home.y + 9n }, home.plane), to: { ...home, y: home.y + 10n }, plane: home.plane }))
    const later = sign(hopEvent({ pubkey: pk, createdAt: 1_030, genesisId: spawn.id, previousId: stray.id, c: positionHex({ ...home, y: home.y + 10n }, home.plane), to: { ...home, y: home.y + 11n }, plane: home.plane }))
    const mine = S().position
    useCyberspace.setState({ position: { x: home.x, y: home.y, z: home.z } })
    try {
      relayHolds = [spawn, stray]
      usePresence.getState().ingest(stray)
      await checkChain(pk)
      const person = usePresence.getState().people[pk]
      expect(person.frozen).toBe(true)
      expect(person.position).toEqual({ x: home.x, y: home.y, z: home.z })
      usePresence.getState().ingest(later)
      expect(usePresence.getState().people[pk].position).toEqual({ x: home.x, y: home.y, z: home.z })
      expect(usePresence.getState().people[pk].lastActive).toBe(1_030)
    } finally {
      useCyberspace.setState({ position: mine })
    }
  })
})
