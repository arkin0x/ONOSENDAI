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
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { authGatedNet, CANON, type AuthGatedNet } from '../../lib/__tests__/authGatedNet'
import { spawnTemplate } from '../../lib/events'

const BAGS = 105
const SIGN_IN_FAILED = 'Could not sign in to relay.onosendai.tech.'
const NOTHING = 'Nothing hidden on the relay yet.'

interface Visit {
  net: AuthGatedNet
  /** Run the clock. */
  wait: (ms: number) => Promise<void>
  /** The list's state now. */
  loot: () => { items: unknown[]; status: string; trouble: string | null }
  /** HIDDEN BAGS as it renders now. */
  panel: () => string
  /** The tab put away for `ms` (another app: the signer's, a wallet), then back, as App.tsx sees it. */
  away: (ms: number) => Promise<void>
  /** The window given the focus back, with the tab never hidden (an extension's popup closing). */
  focus: () => void
  /** The canonical socket's count of operations and its open subscriptions, as nostr-tools keeps them. */
  canonOps: () => { ops: number; subs: number } | null
}

/** A page's document and window for watchTabReturn, in a test without a DOM. */
function fakeTab(): { doc: EventTarget & { visibilityState: string }; win: EventTarget; show: (visible: boolean) => void } {
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const win = new EventTarget()
  return {
    doc,
    win,
    show: (visible) => {
      doc.visibilityState = visible ? 'visible' : 'hidden'
      doc.dispatchEvent(new Event('visibilitychange'))
      if (visible) win.dispatchEvent(new Event('focus'))
    },
  }
}

/**
 * A page load with this bunker remembered and its chain saved, HIDDEN BAGS open.
 * `chain: false`: the bunker identity has no moves yet on this device.
 * `connectivity`: App.tsx's watchConnectivity is wired to the tab too.
 */
async function visit(setup: (net: AuthGatedNet) => void, opts: { chain?: boolean; connectivity?: boolean } = {}): Promise<Visit> {
  const net = authGatedNet()
  net.addBags(BAGS)
  setup(net)
  storage.clear()
  storage.setItem('onosendai:signer', JSON.stringify(net.pref))
  if (opts.chain !== false) {
    const spawn = finalizeEvent(spawnTemplate(net.userPk, 1_000), net.userSk)
    storage.setItem(`onosendai:chain:${net.userPk}`, JSON.stringify({ version: 2, events: [spawn], published: [spawn.id], stats: {} }))
  }
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
  const { CYBERSPACE_RELAY, getPool, watchConnectivity, watchTabReturn } = await import('../../lib/relay')
  const { HiddenPanel } = await import('../../hud/DiscoveredPanel')
  void useCyberspace.getState().initSigner()
  ensureLoot([CYBERSPACE_RELAY])
  // As App.tsx wires it.
  const tab = fakeTab()
  stopTab?.()
  const stopReturn = watchTabReturn(() => { useCyberspace.getState().wakeSigner() }, tab)
  const stopConnectivity = opts.connectivity ? watchConnectivity(tab) : () => {}
  stopTab = () => { stopReturn(); stopConnectivity() }
  const wait = (ms: number): Promise<void> => vi.advanceTimersByTimeAsync(ms).then(() => {})
  return {
    net,
    wait,
    loot: () => useLootStore.getState(),
    panel: () => renderToStaticMarkup(createElement(HiddenPanel)),
    away: async (ms) => { tab.show(false); await wait(ms); tab.show(true) },
    focus: () => { tab.win.dispatchEvent(new Event('focus')) },
    canonOps: () => {
      const r = (getPool() as unknown as { relays: Map<string, { ongoingOperations: number; openSubs: Map<string, unknown> }> }).relays.get(CANON)
      return r ? { ops: r.ongoingOperations, subs: r.openSubs.size } : null
    },
  }
}

let stopTab: (() => void) | undefined

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); vi.doUnmock('../useLoot') })

describe('HIDDEN BAGS on a canonical relay with open reads (relay.onosendai.tech, 2026-11-05)', () => {
  it('fills from the canonical relay with the bunker never answering its challenge, and never says it could not sign in', async () => {
    const v = await visit((net) => { net.openReads = true; net.bunker.authDelay = Infinity })
    // The read waits for its AUTH first (relay.ts authRelay) until that gives
    // up at 30 s; then the relay, which never needed it, answers. On a relay
    // that gates reads the same bunker leaves the list saying it could not
    // sign in (below). Not waiting at all on a relay with open reads is a
    // follow-up, not this switch.
    for (let t = 0; t < 30; t++) {
      await v.wait(1_000)
      expect(v.loot().trouble).toBeNull()
      expect(v.panel()).not.toContain(SIGN_IN_FAILED)
    }
    await v.wait(5_000)
    expect(v.loot().items).toHaveLength(BAGS)
    expect(v.loot().trouble).toBeNull()
    expect(v.panel()).not.toContain(SIGN_IN_FAILED)
    expect(v.panel()).toContain(`${BAGS} HIDDEN`)
  }, 60_000)

  it('fills with the bunker refusing its challenge', async () => {
    const v = await visit((net) => { net.openReads = true; net.bunker.refuseAuth = 5 })
    await v.wait(10_000)
    expect(v.loot().items).toHaveLength(BAGS)
    expect(v.loot().trouble).toBeNull()
  }, 60_000)
})

describe('HIDDEN BAGS when the bunker cannot sign the relay in', () => {
  it('says it could not sign in, never that nothing is hidden, and fills once the signer is back', async () => {
    // One DENY. Its sockets worked, so it is not asked again over fresh ones:
    // until 2026-11-04 the store's retry made every DENY two prompts.
    const v = await visit((net) => { net.bunker.refuseAuth = 1 })
    await v.wait(10_000)
    expect(v.loot().trouble).toBe('auth')
    expect(v.panel()).toContain(SIGN_IN_FAILED)
    expect(v.panel()).toContain('RETRY')
    expect(v.panel()).not.toContain(NOTHING)
    expect(v.panel()).toContain('? HIDDEN')
    // Not asked again on its own: no stack of prompts on a signer that said no.
    await v.wait(60_000)
    expect(v.net.bunker.authAsked).toBe(1)
    // Back from the signer's app, which now accepts: the bags come in without a reload.
    await v.away(20_000)
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

/**
 * Review of #600, round 2. Each of these failed on 440ac89b.
 */
describe('a signer that said no, or is slow, is not asked again and again', () => {
  it('a DENY in a popup that gives the focus back is not followed by another popup', async () => {
    // An extension's popup: the page loses the focus while it is up and gets
    // it back when DENY closes it. Asking again on that focus was 426 popups in 20 s.
    const v = await visit((net) => { net.bunker.refuseAuth = 1_000 })
    v.net.bunker.onAuthAsked = () => { setTimeout(() => v.focus(), 50) }
    await v.wait(20_000)
    expect(v.net.bunker.authAsked).toBe(1)
    expect(v.panel()).toContain(SIGN_IN_FAILED)
    // Clicking around the page is not the person acting on it either.
    for (let i = 0; i < 10; i++) { v.focus(); await v.wait(1_000) }
    expect(v.net.bunker.authAsked).toBe(1)
    // Leaving the tab and coming back is: asked once more, and it fills.
    v.net.bunker.refuseAuth = 0
    v.net.bunker.onAuthAsked = null
    await v.away(20_000)
    await v.wait(5_000)
    expect(v.loot().items).toHaveLength(BAGS)
    expect(v.net.bunker.authAsked).toBe(2)
  }, 60_000)

  it('a tab hidden for less than a real absence does not ask again', async () => {
    const v = await visit((net) => { net.bunker.refuseAuth = 1 })
    await v.wait(10_000)
    expect(v.net.bunker.authAsked).toBe(1)
    await v.away(5_000)
    await v.wait(5_000)
    expect(v.net.bunker.authAsked).toBe(1)
    expect(v.panel()).toContain(SIGN_IN_FAILED)
  }, 60_000)

  it('a sign-in with another signer asks again, and the list fills', async () => {
    const v = await visit((net) => { net.bunker.refuseAuth = 1 })
    await v.wait(10_000)
    expect(v.loot().trouble).toBe('auth')
    const { useCyberspace } = await import('../../store/useCyberspace')
    await useCyberspace.getState().useNewKey()
    await v.wait(5_000)
    expect(v.loot().items).toHaveLength(BAGS)
    expect(v.loot().trouble).toBeNull()
  }, 60_000)

  it('a bunker that signs at 200 s: one socket and two requests through 260 s, never fewer operations than subscriptions', async () => {
    const v = await visit((net) => { net.bunker.authDelay = 200_000 })
    for (let t = 10; t <= 260; t += 10) {
      await v.wait(10_000)
      const c = v.canonOps()
      // A ping the relay CLOSEd was counted down again by its own EOSE timer:
      // the count fell below what was open, and the socket closed as idle under them.
      if (c) expect(c.ops, `at ${t} s`).toBeGreaterThanOrEqual(c.subs)
    }
    expect(v.loot().items).toHaveLength(BAGS)
    expect(v.loot().trouble).toBeNull()
    // The feeds closed for want of AUTH reopened on the sign-in, so the socket was never left empty.
    expect(v.net.canon.sockets).toBe(1)
    expect(v.net.bunker.authAsked).toBe(2)
  }, 120_000)

  it('an AUTH still wanted late does not keep a move waiting on dead sockets to the bunker', async () => {
    const v = await visit((net) => { net.bunker.authDelay = Infinity })
    await v.wait(40_000)
    expect(v.loot().trouble).toBe('auth')
    // The phone is put away: every socket to the bunker's relay is half-open when it comes back.
    v.net.halfOpenBunker()
    await v.away(20_000)
    const { useCyberspace } = await import('../../store/useCyberspace')
    let signed = false
    void useCyberspace.getState().signEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'a move' }).then(() => { signed = true })
    // Not SIGN_PATIENCE_MS on the dead sockets first: the bunker answers over fresh ones at once.
    await v.wait(3_000)
    expect(signed).toBe(true)
  }, 60_000)

  it('an AUTH the relay failed (a slow OK) does not stop the liveness probe', async () => {
    // nostr-tools gives an AUTH's OK 4.4 s; this relay takes 6 s, and signs the socket in then.
    const v = await visit((net) => { net.authOkDelay = 6_000 })
    const { onAuthChange, probeLiveness } = await import('../../lib/relay')
    const said: boolean[] = []
    onAuthChange((url, ok) => { if (url === CANON) said.push(ok) })
    await v.wait(15_000)
    expect(said).toEqual([false])
    const outcome = probeLiveness()
    await v.wait(10_000)
    expect(await outcome).toBe('alive')
    // And the socket was kept: no new socket, no new AUTH.
    expect(v.net.canon.sockets).toBe(1)
  }, 60_000)

  it('a relay that turns the AUTH down is still probed, and its refusal keeps the socket: no new AUTH each probe', async () => {
    const v = await visit((net) => { net.rejectAuth = true })
    const { probeLiveness } = await import('../../lib/relay')
    await v.wait(15_000)
    expect(v.loot().trouble).toBe('auth')
    const asked = v.net.bunker.authAsked
    for (let i = 0; i < 3; i++) {
      const outcome = probeLiveness()
      await v.wait(10_000)
      expect(await outcome).toBe('alive')
    }
    expect(v.net.canon.sockets).toBe(1)
    expect(v.net.bunker.authAsked).toBe(asked)
  }, 60_000)

  it('an old socket\'s refused AUTH does not fail the AUTH a newer socket is waiting on', async () => {
    // The first socket's request is refused at 8 s (and, a DENY, not asked
    // again); by then that socket is gone, and a new one's request is
    // waiting on the bunker, which signs it at about 11 s.
    const v = await visit((net) => { net.bunker.authPlan = [{ delay: 8_000, refuse: true }, { delay: 10_000 }] })
    const { onAuthChange } = await import('../../lib/relay')
    const said: boolean[] = []
    onAuthChange((url, ok) => { if (url === CANON) said.push(ok) })
    await v.wait(1_000)
    v.net.dropCanon()
    // Failed with the old socket's refusal at 8 s, the new socket read "Could
    // not sign in" though the relay took its AUTH at 11 s, until a retry at 22 s.
    await v.wait(13_000)
    expect(v.net.bunker.authAsked).toBe(2)
    expect(said).toEqual([true])
    expect(v.loot().items).toHaveLength(BAGS)
    expect(v.loot().trouble).toBeNull()
  }, 60_000)
})

/** RETRY under "Could not sign in", as the button does it (RelayTrouble). */
async function tapRetry(): Promise<void> {
  const { retryRead } = await import('../../hud/RelayTrouble')
  const { refreshLoot } = await import('../useLoot')
  retryRead(refreshLoot)
}

/**
 * The real-bunker run (2026-11-04, /data/projects/onosendai-bunker-e2e): the
 * built app against `nak bunker` and local relays. Each of these failed on
 * 04aab849.
 */
describe('a real bunker: one prompt per thing asked, and RETRY that works', () => {
  it('a handshake that answers as the AUTH runs out of time sends that AUTH once: the store\'s retry joins it (1)', async () => {
    // get_public_key answered at 14.9 s: the AUTH that waited on the handshake
    // goes out then, and the store's retry at 15 s asked for it again, so the
    // bunker was asked twice at the same instant.
    const v = await visit((net) => { net.bunker.pubkeyDelay = 14_900; net.bunker.authDelay = 2_000 })
    await v.wait(30_000)
    expect(v.net.bunker.authAsked).toBe(1)
    expect(v.loot().items).toHaveLength(BAGS)
    expect(v.loot().trouble).toBeNull()
  }, 60_000)

  it('a signer that refuses the connection is asked once, not on each focus or short hide, and once per RETRY (2)', async () => {
    const v = await visit((net) => { net.bunker.connectPlan = Array.from({ length: 50 }, () => ({ delay: 0, refuse: true })) })
    await v.wait(10_000)
    expect(v.loot().trouble).toBe('auth')
    expect(v.net.bunker.connects).toBe(1)
    // A refusing signer (Amber, nsec.app) shows a new approval prompt for each connect.
    for (let i = 0; i < 6; i++) { v.focus(); await v.wait(1_500) }
    expect(v.net.bunker.connects).toBe(1)
    await v.away(5_000)
    await v.wait(5_000)
    expect(v.net.bunker.connects).toBe(1)
    await tapRetry()
    await v.wait(5_000)
    expect(v.net.bunker.connects).toBe(2)
    await v.wait(15_000)
    expect(v.net.bunker.connects).toBe(2)
    // The signer now allows this client: RETRY signs in, and the list fills.
    v.net.bunker.connectPlan = []
    await tapRetry()
    await v.wait(5_000)
    expect(v.net.bunker.connects).toBe(3)
    expect(v.loot().items).toHaveLength(BAGS)
    expect(v.loot().trouble).toBeNull()
  }, 60_000)

  it('a connect lost in transit is given up at its step limit, and the first RETRY works at once (3)', async () => {
    const v = await visit((net) => { net.bunker.connectPlan = [{ delay: Infinity }] })
    const { authPending } = await import('../../lib/relay')
    await v.wait(20_000)
    // Not held for a whole handshake's minute, which skipped every RETRY meanwhile.
    expect(authPending(CANON)).toBe(false)
    expect(v.loot().trouble).toBe('auth')
    expect(v.net.bunker.connects).toBe(1)
    await tapRetry()
    await v.wait(3_000)
    expect(v.net.bunker.connects).toBe(2)
    expect(v.loot().items).toHaveLength(BAGS)
  }, 60_000)

  it('RETRY gives up a handshake still inside its step limit and starts afresh (3)', async () => {
    const v = await visit((net) => { net.bunker.connectPlan = [{ delay: Infinity }, { delay: Infinity }] })
    await v.wait(20_000)
    // A real absence asks again: a second connect, lost too.
    await v.away(16_000)
    await v.wait(2_000)
    expect(v.net.bunker.connects).toBe(2)
    // 2 s into that one's 15 s: RETRY does not wait it out.
    await tapRetry()
    await v.wait(3_000)
    expect(v.net.bunker.connects).toBe(3)
    expect(v.loot().items).toHaveLength(BAGS)
    // The AUTH the return asked for waited on the handshake RETRY gave up:
    // it and RETRY's own are one request, not two prompts at once.
    expect(v.net.bunker.authAsked).toBe(1)
  }, 60_000)

  it('a saved bunker login with no moves yet loads as itself and signs the relay in as itself, never as a throwaway key (4)', async () => {
    const v = await visit(() => {}, { chain: false })
    const { useCyberspace } = await import('../../store/useCyberspace')
    expect(useCyberspace.getState().identity.pubkey).toBe(v.net.userPk)
    await v.wait(10_000)
    expect(v.loot().items).toHaveLength(BAGS)
    expect(v.net.canon.authBy.length).toBeGreaterThan(0)
    expect(v.net.canon.authBy.every((pk) => pk === v.net.userPk)).toBe(true)
  }, 60_000)

  it('a switch of identity signs the relay in again as the new one, and never as the old one after it (4)', async () => {
    const v = await visit(() => {})
    await v.wait(5_000)
    expect(v.net.canon.authBy).toEqual([v.net.userPk])
    const { useCyberspace } = await import('../../store/useCyberspace')
    const sk = generateSecretKey()
    await useCyberspace.getState().useNsec(nip19.nsecEncode(sk))
    const before = v.net.canon.authBy.length
    await v.wait(5_000)
    const after = v.net.canon.authBy.slice(before)
    expect(after).toContain(getPublicKey(sk))
    expect(after).not.toContain(v.net.userPk)
  }, 60_000)

  it('back after 16 s with the socket still signed in: it is asked first and kept, so no new AUTH and no prompt (5)', async () => {
    const v = await visit(() => {}, { connectivity: true })
    await v.wait(5_000)
    expect(v.net.canon.sockets).toBe(1)
    expect(v.net.bunker.authAsked).toBe(1)
    await v.away(16_000)
    await v.wait(10_000)
    expect(v.net.canon.sockets).toBe(1)
    expect(v.net.bunker.authAsked).toBe(1)
    expect(v.loot().items).toHaveLength(BAGS)
  }, 60_000)

  it('while the signer refuses, the feeds wait for a sign-in instead of asking every 30 s, and never reach the signer (6)', async () => {
    const v = await visit((net) => { net.bunker.refuseAuth = 1_000 })
    const { subscribe } = await import('../../lib/relay')
    for (let k = 0; k < 5; k++) subscribe({ kinds: [40_000 + k] }, () => {})
    await v.wait(10_000)
    expect(v.loot().trouble).toBe('auth')
    const asked = v.net.bunker.authAsked
    const refused = v.net.canon.refusedReqs
    // Past the five minutes a feed waits: the socket the pool closed as idle
    // meanwhile is dialled again, and its AUTH must not ask the signer.
    await v.wait(310_000)
    expect(v.net.canon.refusedReqs - refused).toBeLessThan(20)
    expect(v.net.bunker.authAsked).toBe(asked)
  }, 120_000)
})

/** Review of #603 (2026-11-04): each of these failed at a35ef64f, or with the line it names removed. */
describe('review of #603: a new socket, a switch of identity, a socket gone quiet', () => {
  it('the canonical socket replaced 200 ms after its AUTH went out: the new one signs in with its own challenge', async () => {
    const v = await visit((net) => { net.bunker.authDelay = 3_000 })
    const { resumeLive } = await import('../../lib/relay')
    let fired = false
    v.net.bunker.onAuthAsked = () => { if (!fired) { fired = true; setTimeout(() => resumeLive(), 200) } }
    await v.wait(30_000)
    expect(v.net.canon.sockets).toBe(2)
    expect(v.net.bunker.authAsked).toBe(2)
    expect(v.loot().trouble).toBeNull()
    expect(v.loot().items).toHaveLength(BAGS)
  }, 60_000)

  it('a switch of identity while the bunker signs the AUTH: the old signature is never sent, and the new identity signs in by itself', async () => {
    const v = await visit((net) => { net.bunker.authDelay = 8_000 })
    await v.wait(2_000)
    const { useCyberspace } = await import('../../store/useCyberspace')
    const sk = generateSecretKey()
    await useCyberspace.getState().useNsec(nip19.nsecEncode(sk))
    const from = v.net.canon.authBy.length
    await v.wait(20_000)
    const after = v.net.canon.authBy.slice(from)
    expect(after).not.toContain(v.net.userPk)
    expect(after).toContain(getPublicKey(sk))
    expect(v.loot().trouble).toBeNull()
    expect(v.panel()).not.toContain(SIGN_IN_FAILED)
  }, 60_000)

  it('a late answer for the identity before a switch is never sent to sign in with', async () => {
    // The bunker's AUTH runs out of time (15 s, then the store's retry to
    // 30 s) and is kept for its late answer: the retry's, due at 35 s. At 31 s the
    // identity is switched, and the relay turns the new identity down.
    const v = await visit((net) => { net.bunker.authPlan = [{ delay: 600_000 }, { delay: 20_000 }] })
    await v.wait(31_000)
    expect(v.loot().trouble).toBe('auth')
    v.net.rejectAuth = true
    const { useCyberspace } = await import('../../store/useCyberspace')
    await useCyberspace.getState().useNsec(nip19.nsecEncode(generateSecretKey()))
    const from = v.net.canon.authBy.length
    await v.wait(10_000)
    expect(v.net.bunker.authSigned).toBeGreaterThan(0)
    expect(v.net.canon.authBy.slice(from)).not.toContain(v.net.userPk)
  }, 60_000)

  it('a switch while the relay\'s OK for the old identity is on its way: not counted, and the new identity signs in', async () => {
    const v = await visit((net) => { net.authOkDelay = 2_000 })
    await v.wait(1_000)
    expect(v.net.canon.authBy).toEqual([v.net.userPk])
    const { useCyberspace } = await import('../../store/useCyberspace')
    const sk = generateSecretKey()
    await useCyberspace.getState().useNsec(nip19.nsecEncode(sk))
    await v.wait(10_000)
    expect(v.net.canon.authBy).toContain(getPublicKey(sk))
    expect(v.loot().trouble).toBeNull()
  }, 60_000)

  it('a bunker relay slow to put the answer subscription in place: each request waits for it, so an instant answer is heard', async () => {
    // As nak's relay did on a fresh socket: the connect was answered at once
    // and the answer reached nobody (the real-bunker run, never, after RETRY).
    const v = await visit((net) => { net.subscribeDelay = 50 })
    await v.wait(10_000)
    expect(v.loot().items).toHaveLength(BAGS)
    expect(v.net.bunker.connects).toBe(1)
    expect(v.net.bunker.authAsked).toBe(1)
  }, 60_000)

  it('RETRY drops the half-open sockets a lost handshake went over, so the fresh one is heard', async () => {
    const v = await visit((net) => { net.bunker.connectPlan = [{ delay: Infinity }] })
    await v.wait(20_000)
    expect(v.loot().trouble).toBe('auth')
    // The phone was put away: every socket to the bunker's relay is half-open now.
    v.net.halfOpenBunker()
    await tapRetry()
    await v.wait(3_000)
    expect(v.loot().items).toHaveLength(BAGS)
  }, 60_000)

  it('back after 16 s with the canonical socket half-open: the return asks it, hears nothing, and replaces it', async () => {
    const v = await visit(() => {}, { connectivity: true })
    await v.wait(5_000)
    const { getPool } = await import('../../lib/relay')
    const r = (getPool() as unknown as { relays: Map<string, { ws: { halfOpen: boolean } }> }).relays.get(CANON)
    r!.ws.halfOpen = true
    await v.away(16_000)
    await v.wait(8_000)
    expect(v.net.canon.sockets).toBe(2)
    expect(v.net.canon.authOk).toBe(2)
  }, 60_000)
})

describe('one DENY, one prompt (2026-11-04)', () => {
  it('a move the signer refuses is asked once, not again over fresh sockets', async () => {
    const v = await visit(() => {})
    await v.wait(5_000)
    const { useCyberspace } = await import('../../store/useCyberspace')
    v.net.bunker.refuseSigns = 1_000
    const asked = v.net.bunker.signAsked
    const move = useCyberspace.getState().signEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'a move' })
    const refused = expect(move).rejects.toThrow()
    await v.wait(5_000)
    await refused
    expect(v.net.bunker.signAsked - asked).toBe(1)
  }, 60_000)

  it('a signature that ran out of time is still asked once more over fresh sockets', async () => {
    const v = await visit(() => {})
    await v.wait(5_000)
    v.net.halfOpenBunker()
    const { useCyberspace } = await import('../../store/useCyberspace')
    const asked = v.net.bunker.signAsked
    const move = useCyberspace.getState().signEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'a move' })
    await v.wait(20_000)
    expect((await move).pubkey).toBe(v.net.userPk)
    expect(v.net.bunker.signAsked - asked).toBe(1)
  }, 60_000)
})
