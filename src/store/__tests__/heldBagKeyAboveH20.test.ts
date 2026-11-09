/**
 * heldBagKeyAboveH20.test.ts: a bag of your own above height 20 (hidden
 * through HOSAKA, whose cap is 30) is read with the key this device holds for
 * it, never with one derived from its place, which cyberspace-core refuses
 * above 20 (2026-11-09).
 *
 * - TEST DISCOVERY finds it, where it used to throw and read as missing.
 * - A comment on it opens in NOTIFICATIONS, and the rest of the page still
 *   arrives: one such comment used to fail the whole batch, swallowed as
 *   offline, so the bell stopped updating.
 *
 * The bag here is sealed under a stand-in key: no region key above 20 is
 * computed in tests (nor anywhere on a client). regionKeyAt throws if asked.
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

const relay = vi.hoisted(() => ({ bags: [] as unknown[], inbox: [] as unknown[] }))
vi.mock('../../lib/relay', async (orig) => ({
  ...(await orig() as object),
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => relay.bags),
  queryAny: vi.fn(async () => []),
  queryChecked: vi.fn(async () => ({ events: relay.bags, trouble: null })),
  queryAnyChecked: vi.fn(async () => ({ events: relay.inbox, trouble: null })),
  onCanonicalSignIn: () => () => {},
  relaySet: () => ['wss://relay.test'],
}))
vi.mock('../../lib/inbox', async (orig) => ({ ...(await orig() as object), relaysFor: async () => ['wss://relay.test'] }))
vi.mock('../../lib/shardCrypto', async (orig) => ({
  ...(await orig() as object),
  regionKeyAt: vi.fn(() => { throw new Error('no region key is derived here') }),
}))

import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { useCyberspace } from '../useCyberspace'
import { useShards, type MyDeployment } from '../useShards'
import { useNotifications } from '../useNotifications'
import { bagTemplate, messageInnerTemplate } from '../../lib/hidden'
import { bytesToHex, type NostrEvent } from '../../lib/events'
import { itemParent, sealedComment, type CommentSubject } from '../../lib/comments'
import { regionKeyAt } from '../../lib/shardCrypto'

const HEIGHT = 25
const ME_SK = new Uint8Array(32).fill(2)
const ME = getPublicKey(ME_SK)
const THEM_SK = new Uint8Array(32).fill(4)
const BAG_KEY = new Uint8Array(32).fill(9)
const LOOKUP = 'ab'.repeat(32)
const AT = { x: (1n << 40n) + 12345n, y: 77n << 20n, z: 3n << 30n }
const T = 1_800_000_000

/** A bag of your own at height 25, LIVE, as a deploy through HOSAKA leaves it. */
async function deploy(): Promise<{ dep: MyDeployment; bag: NostrEvent }> {
  const inner = finalizeEvent(messageInnerTemplate('up high', AT, 0, T), ME_SK)
  const bag = finalizeEvent(await bagTemplate([inner], BAG_KEY, LOOKUP, HEIGHT, T), ME_SK)
  const dep: MyDeployment = {
    eventId: inner.id, inner, bagId: bag.id, type: 'message', text: 'up high',
    at: { x: AT.x.toString(), y: AT.y.toString(), z: AT.z.toString() }, plane: 0, height: HEIGHT,
    lookupId: LOOKUP, keyHex: bytesToHex(BAG_KEY), relays: ['wss://relay.test'], createdAt: T, published: true,
  }
  return { dep, bag }
}

beforeEach(() => {
  localStorage.clear()
  relay.bags = []
  relay.inbox = []
  vi.mocked(regionKeyAt).mockClear()
  useCyberspace.setState({ identity: { ...useCyberspace.getState().identity, pubkey: ME }, live: false })
  useShards.setState({ mine: [], discovered: {}, deleted: {} })
  useNotifications.setState({ me: null, items: [], opened: {} })
})

describe('TEST DISCOVERY on a bag above height 20', () => {
  it('finds it with the held key, and derives nothing', async () => {
    const { dep, bag } = await deploy()
    useShards.setState({ mine: [dep] })
    relay.bags = [bag]
    expect(await useShards.getState().testDiscovery(dep.eventId)).toBe('found')
    relay.bags = []
    expect(await useShards.getState().testDiscovery(dep.eventId)).toBe('missing')
    expect(regionKeyAt).not.toHaveBeenCalled()
  })
})

describe('NOTIFICATIONS with a comment on a bag above height 20', () => {
  it('opens the comment with the held key, and the rest of the page still arrives', async () => {
    const { dep } = await deploy()
    useShards.setState({ mine: [dep] })
    const subject: CommentSubject = { author: ME, lookupId: LOOKUP, itemId: dep.eventId, type: 'message', at: AT, height: HEIGHT }
    const sealed = finalizeEvent(await sealedComment(subject, itemParent(subject), 'found your high one', T + 5, BAG_KEY), THEM_SK)
    // Another comment, on a bag this device does not hold: left sealed, never a failure.
    const other: CommentSubject = { ...subject, lookupId: 'cd'.repeat(32), itemId: 'ef'.repeat(32) }
    const stranger = finalizeEvent(await sealedComment(other, itemParent(other), 'elsewhere', T + 6, new Uint8Array(32).fill(6)), THEM_SK)
    relay.inbox = [sealed, stranger]

    await useNotifications.getState().start(ME)
    const { items, opened } = useNotifications.getState()
    expect(items.map((n) => n.id).sort()).toEqual([sealed.id, stranger.id].sort())
    expect(opened[sealed.id]).toBe('found your high one')
    expect(opened[stranger.id]).toBeUndefined()

    // A poll later still updates the bell.
    const later = finalizeEvent(await sealedComment(subject, itemParent(subject), 'and again', T + 9, BAG_KEY), THEM_SK)
    relay.inbox = [later]
    await useNotifications.getState().poll()
    expect(useNotifications.getState().opened[later.id]).toBe('and again')
    expect(regionKeyAt).not.toHaveBeenCalled()
  })
})
