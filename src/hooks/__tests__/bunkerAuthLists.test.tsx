/**
 * bunkerAuthLists.test.tsx - HIDDEN BAGS with a bunker signer, end to end:
 * the real store, its real NIP-46 signer and its time limits (#581), the
 * real relay.ts over the real nostr-tools pool, the real useLoot, and the
 * panel as it renders, against a fake canonical relay that demands NIP-42
 * AUTH (lib/__tests__/authGatedNet.ts). Fake clock, fake sockets, no network.
 *
 * The owner's report (2026-11-04, his phone, a bunker): HIDDEN BAGS said
 * "0 HIDDEN, Nothing hidden on the relay yet" with 105 bags on the relay.
 * What went wrong underneath, each pinned here:
 * - a read the relay refused for want of AUTH, or never answered, came back
 *   as an empty list, which the panel took for "nothing" and kept all visit;
 * - a signature the signer refused or ran out of time on left nostr-tools'
 *   AUTH promise unsettled for good, so the list said LOADING forever;
 * - a signature that came after the store's 15 s limit was thrown away, so a
 *   bunker slower than that could never sign in at all;
 * - a challenge later than 400 ms after the socket opened was never answered;
 * - nostr-tools' keep-alive ping uncounted its own subscription, so sockets
 *   were closed as idle with subscriptions on them: every minute a new socket,
 *   a new AUTH and one more request to the bunker, and a bunker's slow answer
 *   lost with the subscription it was to arrive on.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('../../lib/relay')

const { storage } = vi.hoisted(() => {
  const m = new Map<string, string>()
  const storage: Storage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
  }
  ;(globalThis as { localStorage?: Storage }).localStorage = storage
  return { storage }
})

vi.mock('../../lib/workers', async (o) => ({ ...(await o<typeof import('../../lib/workers')>()), postProof: vi.fn(), cancelProof: vi.fn() }))
vi.mock('../../lib/chains', async (o) => ({ ...(await o<typeof import('../../lib/chains')>()), fetchChainEvents: vi.fn(async () => []), confirmChainEvents: vi.fn(async () => []) }))

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { finalizeEvent } from 'nostr-tools/pure'
import { authGatedNet, type AuthGatedNet } from '../../lib/__tests__/authGatedNet'
import { spawnTemplate } from '../../lib/events'

const BAGS = 105
const SIGN_IN_FAILED = 'Could not sign in to cyberspace.nostr1.com.'
const NOTHING = 'Nothing hidden on the relay yet.'

interface Visit {
  net: AuthGatedNet
  /** Run the clock. */
  wait: (ms: number) => Promise<void>
  /** The list's state now. */
  loot: () => { items: unknown[]; status: string; trouble: string | null }
  /** HIDDEN BAGS as it renders now. */
  panel: () => string
  /** The tab coming back from another app, as App.tsx handles it. */
  back: () => void
}

/** A page load with this bunker remembered and its chain saved, HIDDEN BAGS open. */
async function visit(setup: (net: AuthGatedNet) => void): Promise<Visit> {
  const net = authGatedNet()
  net.addBags(BAGS)
  setup(net)
  storage.clear()
  storage.setItem('onosendai:signer', JSON.stringify(net.pref))
  const spawn = finalizeEvent(spawnTemplate(net.userPk, 1_000), net.userSk)
  storage.setItem(`onosendai:chain:${net.userPk}`, JSON.stringify({ version: 2, events: [spawn], published: [spawn.id], stats: {} }))
  vi.resetModules()
  // A server render reads a zustand store's first state, not its live one:
  // the panel is handed the live list, the store and the read under it real.
  // Per visit, since resetModules leaves mocks registered.
  vi.doMock('../useLoot', async (o) => {
    const real = await o<typeof import('../useLoot')>()
    return { ...real, useLoot: () => { const { items, status, trouble } = real.useLootStore.getState(); return { items, status, trouble } } }
  })
  net.install()
  const { useCyberspace } = await import('../../store/useCyberspace')
  const { ensureLoot, useLootStore } = await import('../useLoot')
  const { CYBERSPACE_RELAY, retryFailedAuth } = await import('../../lib/relay')
  const { HiddenPanel } = await import('../../hud/DiscoveredPanel')
  void useCyberspace.getState().initSigner()
  ensureLoot([CYBERSPACE_RELAY])
  return {
    net,
    wait: (ms) => vi.advanceTimersByTimeAsync(ms).then(() => {}),
    loot: () => useLootStore.getState(),
    panel: () => renderToStaticMarkup(createElement(HiddenPanel)),
    back: () => { useCyberspace.getState().wakeSigner(); setTimeout(retryFailedAuth, 0) },
  }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); vi.doUnmock('../useLoot') })

describe('HIDDEN BAGS when the bunker cannot sign the relay in', () => {
  it('says it could not sign in, never that nothing is hidden, and fills once the signer is back', async () => {
    // DENY twice: the first request and the store's one retry over fresh sockets.
    const v = await visit((net) => { net.bunker.refuseAuth = 2 })
    await v.wait(10_000)
    expect(v.loot().trouble).toBe('auth')
    expect(v.panel()).toContain(SIGN_IN_FAILED)
    expect(v.panel()).toContain('RETRY')
    expect(v.panel()).not.toContain(NOTHING)
    expect(v.panel()).toContain('? HIDDEN')
    // Not asked again on its own: no stack of prompts on a signer that said no.
    await v.wait(60_000)
    expect(v.net.bunker.authAsked).toBe(2)
    // Back from the signer's app, which now accepts: the bags come in without a reload.
    v.back()
    await v.wait(5_000)
    expect(v.loot()).toMatchObject({ status: 'ready', trouble: null })
    expect(v.loot().items).toHaveLength(BAGS)
    expect(v.panel()).not.toContain(SIGN_IN_FAILED)
    expect(v.panel()).toContain(`${BAGS} HIDDEN`)
  }, 60_000)

  it('a bunker that signs after 20 s fills the list, past the store\'s 15 s limit', async () => {
    const v = await visit((net) => { net.bunker.authDelay = 20_000 })
    await v.wait(10_000)
    expect(v.panel()).toContain('LOADING')
    await v.wait(20_000)
    expect(v.loot().items).toHaveLength(BAGS)
    expect(v.loot().trouble).toBeNull()
  }, 60_000)

  it('a bunker that signs after 70 s: says so meanwhile, then fills when its signature comes', async () => {
    const v = await visit((net) => { net.bunker.authDelay = 70_000 })
    await v.wait(60_000)
    expect(v.panel()).toContain(SIGN_IN_FAILED)
    expect(v.panel()).not.toContain(NOTHING)
    await v.wait(30_000)
    expect(v.loot().items).toHaveLength(BAGS)
    expect(v.panel()).not.toContain(SIGN_IN_FAILED)
    // Its two late answers were enough: nobody asked it a third time.
    expect(v.net.bunker.authAsked).toBe(2)
  }, 60_000)

  it('a bunker that never answers: says so, keeps saying so, and is asked no more than twice', async () => {
    const v = await visit((net) => { net.bunker.authDelay = Infinity })
    await v.wait(60_000)
    expect(v.loot().trouble).toBe('auth')
    expect(v.panel()).toContain(SIGN_IN_FAILED)
    await v.wait(240_000)
    expect(v.panel()).toContain(SIGN_IN_FAILED)
    expect(v.panel()).not.toContain(NOTHING)
    expect(v.net.bunker.authAsked).toBe(2)
  }, 60_000)

  it('a challenge that comes 600 ms after the socket opens is still answered', async () => {
    const v = await visit((net) => { net.bunker.authDelay = 3_000; net.challengeDelay = 600 })
    await v.wait(10_000)
    expect(v.loot().items).toHaveLength(BAGS)
    expect(v.panel()).not.toContain(NOTHING)
  }, 60_000)

  it('a canonical relay unreachable for the first read is said, then read again', async () => {
    const v = await visit((net) => { net.failConnects = 2 })
    await v.wait(10_000)
    expect(v.loot().items).toHaveLength(BAGS)
  }, 60_000)

  it('a signed-in socket stays open: one AUTH, one request to the bunker, for five minutes', async () => {
    const v = await visit(() => {})
    await v.wait(300_000)
    expect(v.loot().items).toHaveLength(BAGS)
    expect(v.net.canon.sockets).toBe(1)
    expect(v.net.bunker.authAsked).toBe(1)
  }, 60_000)
})

/**
 * The bug for everyone (2026-11-04, a fresh local key in production too):
 * a relay still sending when the read's 8 s ran out, or a socket closed
 * mid-answer, gave the list what had come so far as the whole answer, 29
 * bags or none, and it was never asked again.
 */
describe('HIDDEN BAGS when the answer is slow or cut short', () => {
  it('a relay sending 105 bags over 10 s is waited for, not cut off at 8 s', async () => {
    const v = await visit((net) => { net.streamMs = 100 })
    await v.wait(20_000)
    expect(v.loot().items).toHaveLength(BAGS)
    expect(v.loot().trouble).toBeNull()
  }, 60_000)

  it('a socket closed mid-answer is read again, and the list fills', async () => {
    const v = await visit((net) => { net.streamMs = 50 })
    await v.wait(2_000)
    v.net.dropCanon()
    await v.wait(1_000)
    // What came stays, and says the relay was not heard from in full.
    expect(v.loot().items.length).toBeLessThan(BAGS)
    expect(v.panel()).not.toContain(NOTHING)
    v.net.streamMs = 0
    await v.wait(20_000)
    expect(v.loot().items).toHaveLength(BAGS)
    expect(v.loot().trouble).toBeNull()
  }, 60_000)
})
