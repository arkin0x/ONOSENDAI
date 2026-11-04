/**
 * deletedAcrossRelays.test.ts: what DELETE took out stays out wherever the
 * bag is read again (arkinox, 2026-11-03: "Sealed Crawlspace", deleted and
 * hidden again, and both showed).
 *
 * DELETE of one thing in a region that holds others rewrites the bag without
 * it; of the last thing, it retracts the bag (NIP-09 by address). Relays do
 * not all take the newer word: on 2026-11-03 three relays held three versions
 * of one of his bags. A scan merged their answers by event id and opened
 * every version, so it drew the union, and the deleted chest came back from
 * the older copy, for anyone but the device that deleted it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

type Ev = { kind: number; tags: string[][]; id: string; content: string; created_at: number; pubkey: string }
const sent: Ev[] = []
/** What the relays hold, as one merged answer (lib/relay query). */
let relayHolds: Ev[] = []
vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async (_relays: string[], ev: Ev) => {
    sent.push(ev)
    return { ok: true }
  }),
  query: vi.fn(async (filter: { kinds: number[] }) => relayHolds.filter((e) => filter.kinds.includes(e.kind))),
  queryEach: vi.fn(async (filter: { kinds: number[] }) => [{ url: 'wss://relay.test', outcome: 'answered', events: relayHolds.filter((e) => filter.kinds.includes(e.kind)) }]),
  queryAny: vi.fn(async () => []),
  // The read that tells a refusal from nothing (rescan): this relay always answers.
  queryChecked: vi.fn(async (filter: { kinds: number[] }) => ({ events: relayHolds.filter((e) => filter.kinds.includes(e.kind)), trouble: null })),
  relaySet: () => ['wss://relay.test'],
}))

import { useCyberspace } from '../useCyberspace'
import { ownBagIn, regionOf, useShards } from '../useShards'
import { HIDDEN_KIND } from '../../lib/hidden'
import { deployPoint } from '../../lib/space'

const HEIGHT = 6
const bags = (): Ev[] => sent.filter((e) => e.kind === HIDDEN_KIND)
const drawn = (): string[] => useShards.getState().drawnItems().map((w) => w.text ?? '').sort()

async function hide(text: string): Promise<void> {
  const s = useShards.getState()
  s.startDeployMessage(text)
  s.setDeployHeight(HEIGHT)
  const cs = useCyberspace.getState()
  const region = regionOf(deployPoint(cs.cursor, cs.scaleExp, HEIGHT), cs.plane, HEIGHT)
  s.seedDeployBag(ownBagIn(useShards.getState().mine, region))
  await s.deploy()
  expect(useShards.getState().deployStatus).toBe('done')
}

/** Read the region as a device that knows nothing of it: another player, or another device of the hider's. */
function asFreshDevice(other: boolean): void {
  useShards.setState({ mine: [], deleted: {}, deletedBags: {}, discovered: {} })
  if (other) useCyberspace.setState({ identity: { ...useCyberspace.getState().identity, pubkey: getPublicKey(generateSecretKey()) } })
}

let me: { pubkey: string; npub: string }
beforeEach(() => {
  sent.length = 0
  relayHolds = []
  localStorage.clear()
  if (!me) me = useCyberspace.getState().identity
  useCyberspace.setState({ live: true, identity: me })
  useShards.setState({ mine: [], deleted: {}, deletedBags: {}, discovered: {}, pending: null, deployHeight: 0, deployStatus: 'idle', deployError: null })
})

/** Two things hidden in one region, then DELETE of the first: the bag before, the bag after, and the region. */
async function deleteOneOfTwo(): Promise<{ before: Ev; after: Ev; lookupId: string; keyHex: string }> {
  await hide('stays')
  await hide('deleted')
  const before = bags().at(-1)!
  const gone = useShards.getState().mine.find((d) => d.text === 'deleted')!
  relayHolds = [before]
  await useShards.getState().deleteInstance(gone.eventId)
  const after = bags().at(-1)!
  expect(after.id).not.toBe(before.id)
  return { before, after, lookupId: gone.lookupId, keyHex: gone.keyHex }
}

describe('a relay still holding the bag from before DELETE', () => {
  it('another player sees only what the newest bag holds', async () => {
    const { before, after, lookupId, keyHex } = await deleteOneOfTwo()
    asFreshDevice(true)
    relayHolds = [before, after]
    await useShards.getState().rescan(lookupId, keyHex)
    expect(drawn()).toEqual(['stays'])
  })

  it('another device of the hider does not take it back into DEPLOYED', async () => {
    const { before, after, lookupId, keyHex } = await deleteOneOfTwo()
    asFreshDevice(false)
    relayHolds = [after, before]
    await useShards.getState().rescan(lookupId, keyHex)
    expect(useShards.getState().mine.map((d) => d.text)).toEqual(['stays'])
    expect(drawn()).toEqual(['stays'])
  })

  it('a scene already showing it drops it once the newer bag is read', async () => {
    const { before, after, lookupId, keyHex } = await deleteOneOfTwo()
    asFreshDevice(true)
    relayHolds = [before]
    await useShards.getState().rescan(lookupId, keyHex)
    expect(drawn()).toEqual(['deleted', 'stays'])
    relayHolds = [before, after]
    await useShards.getState().rescan(lookupId, keyHex)
    expect(drawn()).toEqual(['stays'])
  })
})

describe('a relay that kept a bag its hider retracted', () => {
  it('draws nothing of it, and a scene that showed it drops it', async () => {
    await hide('only one')
    const bag = bags().at(-1)!
    const row = useShards.getState().mine[0]
    relayHolds = [bag]
    await useShards.getState().deleteInstance(row.eventId)
    const retraction = sent.find((e) => e.kind === 5)!
    expect(retraction.tags).toContainEqual(['a', `${HIDDEN_KIND}:${bag.pubkey}:${row.lookupId}`])
    asFreshDevice(true)
    relayHolds = [bag]
    await useShards.getState().rescan(row.lookupId, row.keyHex)
    expect(drawn()).toEqual(['only one'])
    relayHolds = [bag, retraction]
    await useShards.getState().rescan(row.lookupId, row.keyHex)
    expect(drawn()).toEqual([])
  })
})

describe('a door of yours retracted from another device', () => {
  /** A published door row of this identity's, as a scan on this device claimed it. */
  function doorRow(lookupId: string, createdAt: number): Parameters<typeof useShards.setState>[0] {
    const pubkey = useCyberspace.getState().identity.pubkey
    const row = {
      eventId: 'f'.repeat(64), inner: { id: 'f'.repeat(64), pubkey, kind: 3341, created_at: createdAt, tags: [['door', '9']], content: '' },
      bagId: 'e'.repeat(64), type: 'chest', chest: { name: 'Sealed Crawlspace', door: 9 }, at: { x: '0', y: '0', z: '0' }, plane: 1, height: 9,
      lookupId, keyHex: 'b'.repeat(64), relays: ['wss://relay.test'], createdAt, published: true,
    }
    return { mine: [row as never] }
  }

  it('goes from DEPLOYED when its bag is retracted and nothing newer stands', async () => {
    const lookupId = 'c'.repeat(64)
    useShards.setState(doorRow(lookupId, 1_000))
    const me = useCyberspace.getState().identity.pubkey
    const retraction = await useCyberspace.getState().signEvent({ kind: 5, created_at: 2_000, content: '', tags: [['a', `${HIDDEN_KIND}:${me}:${lookupId}`]] })
    expect(useShards.getState().ownDoorAddresses([lookupId])).toEqual([`${HIDDEN_KIND}:${me}:${lookupId}`])
    useShards.getState().honorRetractions([lookupId], [], [retraction as never])
    expect(useShards.getState().mine).toEqual([])
  })

  it('stays when the door was hidden after the retraction, or no retraction was heard', async () => {
    const lookupId = 'c'.repeat(64)
    const me = useCyberspace.getState().identity.pubkey
    const retraction = await useCyberspace.getState().signEvent({ kind: 5, created_at: 2_000, content: '', tags: [['a', `${HIDDEN_KIND}:${me}:${lookupId}`]] })
    useShards.setState(doorRow(lookupId, 3_000))
    useShards.getState().honorRetractions([lookupId], [], [retraction as never])
    expect(useShards.getState().mine).toHaveLength(1)
    useShards.setState(doorRow(lookupId, 1_000))
    useShards.getState().honorRetractions([lookupId], [], [])
    expect(useShards.getState().mine).toHaveLength(1)
  })
})
