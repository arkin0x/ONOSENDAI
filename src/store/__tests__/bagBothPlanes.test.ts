/**
 * bagBothPlanes.test.ts: one bag holds both planes (spec §7.6 Planes,
 * arkinox 2026-11-10). A region's key and lookup id carry no plane bit, so
 * the cube in dataspace and the cube with the same X, Y, Z and height in
 * ideaspace share one bag per author, and each entry's C says which plane it
 * is in. A rewrite from either plane MUST carry the other plane's entries
 * forward unchanged, even on a device that has never seen them.
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

type Ev = { kind: number; tags: string[][]; id: string; content: string; created_at: number; pubkey: string; sig: string }
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
  queryChecked: vi.fn(async (filter: { kinds: number[] }) => ({ events: relayHolds.filter((e) => filter.kinds.includes(e.kind)), trouble: null })),
  relaySet: () => ['wss://relay.test'],
}))

import type { Plane } from 'cyberspace-core'
import { useCyberspace } from '../useCyberspace'
import { ownBagIn, regionOf, useShards } from '../useShards'
import { HIDDEN_KIND, bagEntries } from '../../lib/hidden'
import { placeOf } from '../../lib/chests'
import { hexToBytes, type NostrEvent } from '../../lib/events'
import { deployPoint } from '../../lib/space'

const HEIGHT = 6
const bags = (): Ev[] => sent.filter((e) => e.kind === HIDDEN_KIND)

async function hideIn(plane: Plane, text: string): Promise<void> {
  useCyberspace.setState({ plane })
  const s = useShards.getState()
  s.startDeployMessage(text)
  s.setDeployHeight(HEIGHT)
  const cs = useCyberspace.getState()
  const region = regionOf(deployPoint(cs.cursor, cs.scaleExp, HEIGHT), cs.plane, HEIGHT)
  s.seedDeployBag(ownBagIn(useShards.getState().mine, region))
  await s.deploy()
  expect(useShards.getState().deployStatus).toBe('done')
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

describe('one bag holds both planes (spec §7.6 Planes)', () => {
  it('a rewrite from the other plane, on a device that never saw the first entry, carries it forward unchanged', async () => {
    await hideIn(0, 'said in dataspace')
    const first = bags().at(-1)!
    const row = useShards.getState().mine.find((d) => d.text === 'said in dataspace')!
    const key = hexToBytes(row.keyHex)
    const firstEntries = await bagEntries(first as NostrEvent, key)
    // Another device of the same hider: it knows only what the relays hold.
    useShards.setState({ mine: [], deleted: {}, deletedBags: {}, discovered: {} })
    relayHolds = [first]
    await hideIn(1, 'said in ideaspace')
    const second = bags().at(-1)!
    // The same region in the other plane is the same bag: the same d, rewritten whole.
    expect(second.id).not.toBe(first.id)
    expect(second.tags.find((t) => t[0] === 'd')?.[1]).toBe(first.tags.find((t) => t[0] === 'd')?.[1])
    const entries = await bagEntries(second as NostrEvent, key)
    expect(entries).toHaveLength(2)
    // The dataspace entry stands exactly as it was, byte for byte.
    expect(entries).toContainEqual(firstEntries[0])
    const planes = entries.map((e) => (Array.isArray(e) ? null : placeOf(e)?.plane)).sort()
    expect(planes).toEqual([0, 1])
  })
})
