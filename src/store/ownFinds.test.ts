/**
 * ownFinds.test.ts - a find this identity wrote joins the Stash's DEPLOYED
 * list, whichever device placed it.
 *
 * `mine` is per device and was written only at deploy time, so a bag hidden
 * from the phone and opened by a scan on the desktop reached `discovered` and
 * no further. The bag here is built and signed as a deploy builds it, opened
 * with the real region key as a scan opens it, and filed through
 * addDiscovered, the one door every scan goes through.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// The store keeps deployments in localStorage; the test runs where there is none.
if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

vi.mock('../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { bytesToHex, type NostrEvent } from '../lib/events'
import { bagTemplate, messageInnerTemplate, unbag, type Hidden } from '../lib/hidden'
import { regionKeyAt } from '../lib/shardCrypto'
import { useCyberspace } from './useCyberspace'
import { useShards, type MyDeployment } from './useShards'

const at = { x: 90_000n, y: 4_000n, z: 71n }
const HEIGHT = 5
const rk = regionKeyAt(at, HEIGHT, 20)
const MADE_AT = 1_800_000_000

/** A bag as the phone published it: one message, sealed to the region, signed by this identity. */
async function ownBag(text: string): Promise<{ outer: NostrEvent; inner: NostrEvent }> {
  const cs = useCyberspace.getState()
  const inner = await cs.signEvent(messageInnerTemplate(text, at, 0, MADE_AT))
  const outer = await cs.signEvent(await bagTemplate([inner], rk.key, rk.lookupId, HEIGHT, MADE_AT + 1))
  return { outer, inner }
}

/** The same bag from a stranger. */
async function strangerBag(text: string): Promise<NostrEvent> {
  const sk = generateSecretKey()
  const inner = finalizeEvent(messageInnerTemplate(text, at, 0, MADE_AT), sk)
  return finalizeEvent(await bagTemplate([inner], rk.key, rk.lookupId, HEIGHT, MADE_AT + 1), sk)
}

describe('a find this identity wrote', () => {
  beforeEach(() => {
    localStorage.clear()
    useShards.setState({ mine: [], discovered: {}, deleted: {} })
  })

  it('joins DEPLOYED as a published deployment, and is saved for the next load', async () => {
    const { outer, inner } = await ownBag('left from the phone')
    const found = await unbag(outer, rk.key)
    expect(found).toHaveLength(1)
    useShards.getState().addDiscovered(found)

    const { mine, discovered } = useShards.getState()
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({
      eventId: inner.id,
      lookupId: rk.lookupId,
      height: HEIGHT,
      type: 'message',
      text: 'left from the phone',
      bagId: outer.id,
      keyHex: bytesToHex(rk.key),
      at: { x: '90000', y: '4000', z: '71' },
      plane: 0,
      createdAt: MADE_AT,
      relays: ['wss://relay.test'],
      published: true,
    })
    expect(mine[0].inner).toEqual(inner)
    // Still a discovery too, as a find of your own always was on the device that placed it.
    expect(discovered[inner.id]).toBeDefined()
    // And on disk, where loadMine reads it from on the next page load.
    const saved = JSON.parse(localStorage.getItem('onosendai:deployments') ?? '[]') as MyDeployment[]
    expect(saved.map((d) => d.eventId)).toEqual([inner.id])
    // JSON keeps the event, not the Symbol(verified) nostr-tools stamps on it.
    expect(saved[0].inner).toMatchObject({ id: inner.id, sig: inner.sig })
  })

  it("leaves a stranger's find in Loot only", async () => {
    const found = await unbag(await strangerBag('not yours'), rk.key)
    expect(found).toHaveLength(1)
    useShards.getState().addDiscovered(found)
    expect(useShards.getState().mine).toHaveLength(0)
    expect(Object.keys(useShards.getState().discovered)).toEqual([found[0].eventId])
  })

  it('is not listed twice when DEPLOYED already has it, and the row it has is kept', async () => {
    const { outer, inner } = await ownBag('placed from here')
    // What this device's own deploy recorded, before any relay took it.
    const local: MyDeployment = {
      eventId: inner.id, inner, bagId: 'ff'.repeat(32), type: 'message', text: 'placed from here',
      at: { x: '90000', y: '4000', z: '71' }, plane: 0, height: HEIGHT, lookupId: rk.lookupId,
      keyHex: bytesToHex(rk.key), relays: [], createdAt: MADE_AT, published: false,
    }
    useShards.setState({ mine: [local] })
    const found = await unbag(outer, rk.key)
    useShards.getState().addDiscovered(found)
    useShards.getState().addDiscovered(found) // the next scan of the same region
    expect(useShards.getState().mine).toHaveLength(1)
    expect(useShards.getState().mine[0]).toBe(local)
  })

  it('does not resurrect what was deleted here', async () => {
    const { outer, inner } = await ownBag('gone')
    useShards.setState({ deleted: { [inner.id]: true } })
    useShards.getState().addDiscovered(await unbag(outer, rk.key))
    expect(useShards.getState().mine).toHaveLength(0)
    expect(useShards.getState().discovered[inner.id]).toBeUndefined()
    expect(localStorage.getItem('onosendai:deployments')).toBeNull()
  })

  it('needs the find to have come out of a bag', () => {
    // The ceremony's preview items are Hiddens made from no envelope: no inner event, no key.
    const me = useCyberspace.getState().identity.pubkey
    const preview: Hidden = { eventId: 'preview', bagId: 'b', lookupId: rk.lookupId, author: me, at, plane: 0, height: HEIGHT, createdAt: 1, type: 'message', text: 'preview' }
    useShards.getState().addDiscovered([preview])
    expect(useShards.getState().mine).toHaveLength(0)
    expect(useShards.getState().discovered.preview).toBeDefined()
  })
})
