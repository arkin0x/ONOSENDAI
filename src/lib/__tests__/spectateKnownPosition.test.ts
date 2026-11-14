/**
 * spectateKnownPosition.test.ts - SPECTATE on someone already seen goes to
 * where they were seen, not to their spawn (owner, 2026-11-14: "i saw this
 * avatar moving at block 101 yes when i hit spectate it puts me all the way
 * at his spawn and says fetching chain. clearly his chain was already
 * fetched if i saw him moving near me").
 *
 * Every SPECTATE button (the TARGETS panel, the AVATARS panel, a person's
 * card from an avatar tap, an item's author) goes through lib/spectator.ts
 * spectate(), so this drives that, with the relay held until the test lets
 * it answer: the camera (the anchor, where scene/Avatar draws the watched
 * avatar) starts where they were last known, FETCHING CHAIN shows meanwhile,
 * and the full chain then moves them to their authoritative stand, the
 * relay-stop rule (lib/chainStop.ts, #728) included.
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

import owner from './vectors/owner-chain-e8ed3798-through-2026-09-04.json'
import type { NostrEvent } from '../events'

/** The relay: every chain fetch waits on `answer` until the test settles it. */
const relay = vi.hoisted(() => ({
  events: [] as unknown[],
  fail: false,
  pending: [] as Array<() => void>,
  /** The live watch's handler, so a test can deliver an event while the fetch is out. */
  watch: null as null | ((ev: unknown) => void),
}))
vi.mock('../chains', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../chains')>()),
  fetchChainEvents: () => new Promise((resolve, reject) => {
    relay.pending.push(() => (relay.fail ? reject(new Error('unreachable')) : resolve(relay.events)))
  }),
  watchAuthor: (_pk: string, _since: number, on: (ev: unknown) => void) => { relay.watch = on; return () => {} },
}))

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { coordToXyz, hexToCoord } from 'cyberspace-core'
import { useCyberspace } from '../../store/useCyberspace'
import { usePresence, type Person } from '../../store/usePresence'
import { useRoster } from '../../store/useRoster'
import { useBuilder } from '../../store/useBuilder'
import { spectate, stopSpectating } from '../spectator'
import { resetChainStops, setV1HopListForTests } from '../chainStop'
import { loadV1HopList } from '../v1HopList'
import { buildChain, hopTemplate, spawnTemplate } from '../events'
import { avatarInBuild } from '../buildCursor'
import { forgetNeighborChains, readChain, standingOf } from '../neighborChains'

const S = () => useCyberspace.getState()
/** Where the scene's avatar is drawn and the camera looks while spectating: the anchor, in its plane. */
const camera = () => ({ position: S().anchor, plane: S().anchorPlane })
/** Let every chain fetch in flight answer, and the spectator take the answer. */
async function relayAnswers(): Promise<void> {
  const go = relay.pending.splice(0)
  go.forEach((f) => f())
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const theirSpawn = coordToXyz(hexToCoord(pk))
const spawnEv = finalizeEvent(spawnTemplate(pk, 100), sk)
function hop(prev: NostrEvent, at: number, dx: bigint): NostrEvent {
  const prevC = prev.tags.find((t) => t[0] === 'C')![1]
  const from = coordToXyz(hexToCoord(prevC))
  return finalizeEvent(hopTemplate({
    createdAt: at, genesisId: spawnEv.id, previousId: prev.id, prevCoordHex: prevC,
    to: { x: from.x + dx, y: from.y, z: from.z }, plane: from.plane, proofHash: '1'.repeat(64), mn: '0'.repeat(16), mp: '00',
  }), sk)
}
const h1 = hop(spawnEv, 110, 5000n)
const h2 = hop(h1, 120, 3480n)
const chain = buildChain([spawnEv, h1, h2], pk)
const head = chain[chain.length - 1]
const spawnAt = { position: { x: theirSpawn.x, y: theirSpawn.y, z: theirSpawn.z }, plane: theirSpawn.plane }

/** Someone presence drew near you, as usePresence keeps them. */
function seen(pubkey: string, at: { position: Person['position']; plane: Person['plane'] }, actionId: string, lastActive: number, frozen = false): void {
  usePresence.setState({
    people: { [pubkey]: { pubkey, position: at.position, plane: at.plane, lastActive, type: 'hop', checkedAt: lastActive, actionId, ...(frozen ? { frozen } : {}) } },
  })
}

let list: ReadonlySet<string>

beforeEach(async () => {
  list ??= await loadV1HopList()
  setV1HopListForTests(list)
  stopSpectating()
  relay.pending.splice(0)
  relay.fail = false
  relay.events = [spawnEv, h1, h2]
  resetChainStops()
  forgetNeighborChains()
  usePresence.setState({ people: {} })
  useRoster.setState({ list: [], events: {} })
  useCyberspace.setState({ exploreIndex: null, spectate: null, focus: null, transit: null, walking: false, targets: {} })
})

describe('SPECTATE on someone presence drew near you', () => {
  it('starts the camera and their avatar where they were seen, not at their spawn, while the chain is fetched', async () => {
    seen(pk, head, head.id, head.createdAt)
    void spectate(pk)
    expect(S().spectate?.status).toBe('loading')
    expect(camera()).toEqual({ position: head.position, plane: head.plane })
    expect(camera()).not.toEqual(spawnAt)
    // LAST ACTIVE is known too.
    expect(S().spectate?.lastActive).toBe(head.createdAt)

    await relayAnswers()
    expect(S().spectate?.status).toBe('live')
    expect(S().focusChain()).toHaveLength(3)
    expect(camera()).toEqual({ position: head.position, plane: head.plane })
  })

  it('keeps FETCHING CHAIN up when a live event lands before the fetch answers', async () => {
    seen(pk, chain[1], chain[1].id, chain[1].createdAt)
    void spectate(pk)
    relay.watch?.(h2)
    expect(S().spectate?.status).toBe('loading')
    await relayAnswers()
    expect(S().spectate?.status).toBe('live')
  })

  it('moves to the full chain\'s head when it has moved on since', async () => {
    seen(pk, chain[1], chain[1].id, chain[1].createdAt)
    void spectate(pk)
    expect(camera()).toEqual({ position: chain[1].position, plane: chain[1].plane })
    await relayAnswers()
    expect(camera()).toEqual({ position: head.position, plane: head.plane })
  })

  it('stays where they were seen when the relay cannot be reached, never falling back to the spawn', async () => {
    seen(pk, head, head.id, head.createdAt)
    relay.fail = true
    void spectate(pk)
    await relayAnswers()
    expect(S().spectate?.status).toBe('error')
    expect(camera()).toEqual({ position: head.position, plane: head.plane })
  })

  it('in BUILD the build cursor is aimed where they were seen, and the chain\'s first arrival takes it to their stand', async () => {
    useBuilder.getState().enter('build')
    seen(pk, chain[1], chain[1].id, chain[1].createdAt)
    void spectate(pk)
    expect(S().cursor).toEqual(chain[1].position)
    // Their avatar is drawn there too, before the chain arrives.
    expect(avatarInBuild(S(), null)?.position).toEqual(chain[1].position)
    await relayAnswers()
    expect(S().cursor).toEqual(head.position)
    useBuilder.getState().exit()
  })
})

describe('a chain the relay\'s rules stop (#728)', () => {
  const OWNER = 'e8ed3798c6ffebffa08501ac39e271662bfd160f688f94c45d692d8767dd345a'
  const EVENT_22 = 'daf160627616b019dff4d1363e510b09bde200894b1aba8eb1bc9e5e9b2bce64'
  const events = owner as NostrEvent[]
  const rows = buildChain(events, OWNER)
  const at22 = rows.find((a) => a.id === EVENT_22)!
  const newest = rows[rows.length - 1]

  it('starts where presence drew them, the last action that counts, shows the trail it already read, and does not move when the fetch agrees', async () => {
    relay.events = events
    // What presence does for someone near you: read their chain, place them by it.
    const read = readChain(OWNER, newest.id)
    await relayAnswers()
    await read
    const drawn = standingOf(newest)
    expect(drawn.position).toEqual(at22.position)
    seen(OWNER, drawn, newest.id, newest.createdAt)

    void spectate(OWNER)
    expect(S().spectate?.status).toBe('loading')
    expect(camera()).toEqual({ position: at22.position, plane: at22.plane })
    // The chain presence already read is on screen at once.
    expect(S().focusChain()).toHaveLength(rows.length)

    const before = S().anchor
    await relayAnswers()
    expect(S().spectate?.status).toBe('live')
    // The very same anchor: nothing on screen moves.
    expect(S().anchor).toBe(before)
    expect(camera()).toEqual({ position: at22.position, plane: at22.plane })
  })
})

describe('other places someone is already known from', () => {
  it('a target already placed', () => {
    useCyberspace.setState({ targets: { [pk]: { pubkey: pk, npub: 'npub', name: null, position: head.position, plane: head.plane, lastActive: head.createdAt, status: 'live' } } })
    void spectate(pk)
    expect(camera()).toEqual({ position: head.position, plane: head.plane })
  })

  it('the AVATARS list (their newest action)', () => {
    useRoster.setState({ list: [head] })
    void spectate(pk)
    expect(camera()).toEqual({ position: head.position, plane: head.plane })
  })

  it('the newest of them wins', () => {
    useRoster.setState({ list: [chain[1]] })
    seen(pk, head, head.id, head.createdAt)
    void spectate(pk)
    expect(camera()).toEqual({ position: head.position, plane: head.plane })
  })

  it('a newer move on the AVATARS list than the chain presence read: there, without first showing the older chain', async () => {
    relay.events = [spawnEv, h1]
    const read = readChain(pk, chain[1].id)
    await relayAnswers()
    await read
    seen(pk, chain[1], chain[1].id, chain[1].createdAt)
    useRoster.setState({ list: [head] })
    relay.events = [spawnEv, h1, h2]
    void spectate(pk)
    expect(camera()).toEqual({ position: head.position, plane: head.plane })
    expect(S().focusChain()).toHaveLength(0)
    await relayAnswers()
    expect(camera()).toEqual({ position: head.position, plane: head.plane })
  })

  it('someone presence knows to be stopped stays where they stopped, whatever newer move the list holds', () => {
    seen(pk, chain[1], chain[1].id, chain[1].createdAt, true)
    useRoster.setState({ list: [head] })
    void spectate(pk)
    expect(camera()).toEqual({ position: chain[1].position, plane: chain[1].plane })
  })

  it('nobody knows where they are: the spawn, as before', async () => {
    void spectate(pk)
    expect(S().spectate?.status).toBe('loading')
    expect(camera()).toEqual(spawnAt)
    await relayAnswers()
    expect(camera()).toEqual({ position: head.position, plane: head.plane })
  })
})
