/**
 * demoPublish.test.ts - what the /demo tour lets leave the device (review of
 * #337, 2026-10-15), asserted at the publish gate: the real publisher runs,
 * and only the relay send itself is replaced, so a call to it is exactly an
 * EVENT that would have gone out.
 *
 * - A key the tour generated goes back to LOCAL on FINISH unless GO LIVE was
 *   pressed, so the next ordinary hop sends nothing. A new visitor starts
 *   LIVE by default, and FINISH used to put that back: their next hop then
 *   published the spawn and every tour hop.
 * - GO LIVE sends the waiting chain at once (publishNow), oldest first, and
 *   a held chain still stops it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const m = new Map<string, string>()
  ;(globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
  }
})

const sent = vi.hoisted(() => [] as Array<{ id: string; a: string | undefined }>)
vi.mock('../../lib/relay', async (orig) => {
  const real = await orig<typeof import('../../lib/relay')>()
  return {
    ...real,
    publish: vi.fn(async (e: { id: string; tags: string[][] }) => {
      sent.push({ id: e.id, a: e.tags.find((t) => t[0] === 'A')?.[1] })
      return { ok: true, accepted: [] }
    }),
    publishMany: vi.fn(async () => ({ ok: true, accepted: [] })),
  }
})
// The publisher's look at the relays before a backlog: answered, nothing there.
vi.mock('../../lib/chains', async (orig) => ({ ...(await orig<typeof import('../../lib/chains')>()), confirmChainEvents: vi.fn(async () => []) }))

import type { NostrEvent } from 'nostr-tools'
import { useCyberspace } from '../useCyberspace'
import { PREV_LIVE_KEY, TOUR_KEY_KEY, isTourKey, useDemo } from '../useDemo'
import { startPublisher } from '../../lib/publisher'

const pubkey = (): string => useCyberspace.getState().identity.pubkey
let n = 0
/** A hop on the head, as the publisher sees one: a new head this device signed. */
function hop(): void {
  const s = useCyberspace.getState()
  const id = (++n).toString(16).padStart(64, '0')
  const ev: NostrEvent = { id, pubkey: pubkey(), created_at: 1_800_000_000 + n, kind: 3333, tags: [['A', 'hop'], ['e', s.prevEventId, '', 'previous']], content: '', sig: '' }
  useCyberspace.setState({ events: [...s.events, ev], prevEventId: id, published: { ...s.published, [id]: 'queued' } })
}
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 30))

beforeEach(async () => {
  if (useDemo.getState().active) useDemo.getState().exit()
  useCyberspace.getState().setLive(false)
  useCyberspace.setState({ events: [], prevEventId: '', genesisId: '', published: {}, held: false, chainConflict: null, selfCheck: { pubkey: pubkey(), status: 'none' } })
  localStorage.removeItem(PREV_LIVE_KEY)
  localStorage.removeItem(TOUR_KEY_KEY)
  startPublisher()
  sent.length = 0
})
afterEach(() => { if (useDemo.getState().active) useDemo.getState().exit() })

/** A first /demo visit: LIVE by default, the tour's key, SPAWN, two tour hops. */
async function tourWithChain(): Promise<void> {
  useCyberspace.getState().setLive(true)
  useDemo.getState().start()
  expect(isTourKey()).toBe(true)
  expect(useCyberspace.getState().live).toBe(false)
  expect(await useCyberspace.getState().signSpawn()).toBe(true)
  hop(); hop()
  await settle()
}

describe('FINISH on a key the tour generated', () => {
  it('leaves the switch LOCAL without GO LIVE, so the next ordinary hop sends no EVENT', async () => {
    await tourWithChain()
    useDemo.getState().exit() // FINISH
    expect(useCyberspace.getState().live).toBe(false)
    hop() // an ordinary hop after the tour
    await settle()
    expect(sent).toEqual([])
  })

  it('stays LIVE after GO LIVE then FINISH, and GO LIVE sent the waiting chain at once, oldest first', async () => {
    await tourWithChain()
    const ids = useCyberspace.getState().events.map((e) => e.id)
    // GO LIVE, as the Finish panel does it.
    useDemo.getState().wentLive()
    useCyberspace.getState().setLive(true)
    useCyberspace.getState().publishNow()
    await vi.waitFor(() => expect(sent.map((s) => s.id)).toEqual(ids))
    expect(sent[0].a).toBe('spawn')
    useDemo.getState().exit() // FINISH
    expect(useCyberspace.getState().live).toBe(true)
  })
})

describe('GO LIVE publishes through the gate, never past it', () => {
  it('the switch alone sends nothing: the request is what releases the chain', async () => {
    await tourWithChain()
    useCyberspace.getState().setLive(true)
    await settle()
    expect(sent).toEqual([])
  })

  it('a held chain stays on the device: GO LIVE does not force it out', async () => {
    await tourWithChain()
    useCyberspace.setState({ held: true })
    useDemo.getState().wentLive()
    useCyberspace.getState().setLive(true)
    useCyberspace.getState().publishNow()
    await settle()
    expect(sent).toEqual([])
  })

  it('does nothing while LOCAL', async () => {
    await tourWithChain()
    const before = useCyberspace.getState().publishRequest
    useCyberspace.getState().publishNow()
    expect(useCyberspace.getState().publishRequest).toBe(before)
    await settle()
    expect(sent).toEqual([])
  })
})
