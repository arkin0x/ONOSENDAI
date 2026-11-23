/**
 * spectateRelayStop.test.ts - spectating someone whose chain the relay's
 * rules stop puts the camera where their avatar is drawn (owner,
 * 2026-11-13): the last action that counts, the place lib/neighborChains.ts
 * readChain stands them at among the others, not their newest move, an empty
 * spot. The owner's real chain (spawn through 2026-09-04) stops at its
 * version 1 sidestep (row 23), so it is watched where row 22 left it: on
 * arrival, as it grows, at RECALL to its head and on a row after the stop.
 * While the 5.13 list loads the head stands, and its arrival moves the scene
 * there. A chain nothing stops is watched at its head, as before.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  if (typeof localStorage !== 'undefined') return
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
})

import owner from '../../lib/__tests__/vectors/owner-chain-e8ed3798-through-2026-09-04.json'
import type { NostrEvent } from '../../lib/events'

const served = vi.hoisted(() => ({ events: [] as unknown[] }))
vi.mock('../../lib/chains', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/chains')>()),
  fetchChainEvents: async () => served.events,
}))

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { coordToXyz, hexToCoord } from 'cyberspace-core'
import { useCyberspace } from '../useCyberspace'
import { useBuilder } from '../useBuilder'
import { avatarInBuild } from '../../lib/buildCursor'
import { resetChainStops, setV1HopListForTests } from '../../lib/chainStop'
import { loadV1HopList } from '../../lib/v1HopList'
import { buildChain, hopTemplate, spawnTemplate } from '../../lib/events'
import { forgetNeighborChains, readChain, standingOf } from '../../lib/neighborChains'

const S = () => useCyberspace.getState()
const OWNER = 'e8ed3798c6ffebffa08501ac39e271662bfd160f688f94c45d692d8767dd345a'
const EVENT_22 = 'daf160627616b019dff4d1363e510b09bde200894b1aba8eb1bc9e5e9b2bce64'
const events = owner as NostrEvent[]
const rows = buildChain(events, OWNER)
const at22 = rows.find((a) => a.id === EVENT_22)!
const head = rows[rows.length - 1]
let list: ReadonlySet<string>

/** Spectate `pubkey` from your own head, and let the relays bring `chain`. */
function watch(pubkey: string, chain: NostrEvent[]): void {
  useCyberspace.setState({ exploreIndex: null, spectate: null, focus: null, transit: null, walking: false })
  S().beginSpectate(pubkey)
  S().setSpectateChain(pubkey, chain)
}

/** Where the scene's avatar is drawn while spectating (scene/Avatar.tsx anchorCentre): the anchor, in its plane. */
const camera = () => ({ position: S().anchor, plane: S().anchorPlane })

beforeEach(async () => {
  list ??= await loadV1HopList()
  resetChainStops()
  forgetNeighborChains()
  served.events = events
  S().endSpectate()
})

describe("spectating the owner's chain, stopped at 2026-09-04", () => {
  it('the camera goes where their avatar is drawn among the others, not to their newest move', async () => {
    setV1HopListForTests(list)
    // The place the others' avatars are drawn at (scene/PresenceAvatars via standingOf).
    await readChain(OWNER, head.id)
    const drawn = standingOf(head)
    expect(drawn.position).toEqual(at22.position)
    expect(head.position).not.toEqual(at22.position)

    watch(OWNER, events)
    expect(camera()).toEqual({ position: drawn.position, plane: drawn.plane })
  })

  it('RECALL to their head and a row after the stop stand there; a row before it stands where it went', () => {
    setV1HopListForTests(list)
    watch(OWNER, events)
    S().explore(5)
    expect(S().anchor).toEqual(rows[5].position)
    S().explore(24)
    expect(S().anchor).toEqual(at22.position)
    S().explore(null)
    expect(S().anchor).toEqual(at22.position)
  })

  it('a view ended while the spectation stands (BUILD keeps both) comes back to where they stand', () => {
    setV1HopListForTests(list)
    watch(OWNER, events)
    useCyberspace.setState({ focus: { position: { x: 1n, y: 2n, z: 3n }, plane: 0, label: 'ELSEWHERE', drive: true } })
    S().clearFocus()
    expect(S().spectate?.pubkey).toBe(OWNER)
    expect(S().anchor).toEqual(at22.position)
  })

  it('the trail stops there too: every row from the stop on stands where it stops (focusStand, PathTrail)', () => {
    setV1HopListForTests(list)
    watch(OWNER, events)
    expect(S().focusStand(5)?.position).toEqual(rows[5].position)
    expect(S().focusStand(22)?.position).toEqual(at22.position)
    for (const i of [23, 24, rows.length - 1]) expect(S().focusStand(i)).toMatchObject({ position: at22.position, plane: at22.plane })
    expect(S().focusStand(rows.length)).toBeNull()
  })

  it('in BUILD (spectating keeps it), the build cursor and their avatar go where they stand; the CHAIN chip aims there past the stop', () => {
    setV1HopListForTests(list)
    useCyberspace.setState({ exploreIndex: null, spectate: null, focus: null, transit: null, walking: false })
    useBuilder.getState().enter('build')
    expect(S().focus?.drive).toBe(true)
    S().beginSpectate(OWNER, true)
    S().setSpectateChain(OWNER, events)
    expect(S().cursor).toEqual(at22.position)
    expect(avatarInBuild(S(), null)).toMatchObject({ position: at22.position, plane: at22.plane })
    expect(avatarInBuild(S(), 24)?.position).toEqual(at22.position)
    expect(avatarInBuild(S(), 5)?.position).toEqual(rows[5].position)
    useBuilder.getState().scrubTo(5)
    expect(S().cursor).toEqual(rows[5].position)
    useBuilder.getState().scrubTo(24)
    expect(S().cursor).toEqual(at22.position)
    useBuilder.getState().exit()
  })

  it('while the 5.13 list loads their head stands; its arrival moves the camera to where the chain stops', () => {
    watch(OWNER, events)
    expect(S().anchor).toEqual(head.position)
    setV1HopListForTests(list)
    expect(S().anchor).toEqual(at22.position)
    expect(S().anchorPlane).toBe(at22.plane)
  })

  it('the list arriving while you look at a row before the stop leaves the camera there', () => {
    watch(OWNER, events)
    S().explore(5)
    setV1HopListForTests(list)
    expect(S().anchor).toEqual(rows[5].position)
  })
})

describe('a chain nothing stops', () => {
  const sk = generateSecretKey()
  const pk = getPublicKey(sk)
  const spawn = finalizeEvent(spawnTemplate(pk, 100), sk)
  function hop(prev: NostrEvent, at: number): NostrEvent {
    const prevC = prev.tags.find((t) => t[0] === 'C')![1]
    const from = coordToXyz(hexToCoord(prevC))
    return finalizeEvent(hopTemplate({
      createdAt: at, genesisId: spawn.id, previousId: prev.id, prevCoordHex: prevC,
      to: { x: from.x + 1n, y: from.y, z: from.z }, plane: from.plane, proofHash: '1'.repeat(64), mn: '0'.repeat(16), mp: '00',
    }), sk)
  }
  const h1 = hop(spawn, 110)
  const h2 = hop(h1, 120)

  it('is watched at its head, where its avatar is drawn too', async () => {
    setV1HopListForTests(list)
    served.events = [spawn, h1, h2]
    const chain = buildChain([spawn, h1, h2], pk)
    const newest = chain[chain.length - 1]
    await readChain(pk, newest.id)
    expect(standingOf(newest).position).toEqual(newest.position)
    watch(pk, [spawn, h1, h2])
    expect(camera()).toEqual({ position: newest.position, plane: newest.plane })
  })

  it('the owner\'s chain up to row 22 is watched at its head', () => {
    setV1HopListForTests(list)
    const kept = new Set(rows.slice(0, 23).map((a) => a.id))
    watch(OWNER, events.filter((e) => kept.has(e.id)))
    expect(S().anchor).toEqual(at22.position)
    expect(S().focusChain()).toHaveLength(23)
  })
})
