/**
 * bigSignerRequest.test.ts - a remote signer request past 65,535 bytes is a
 * question, not a refusal (arkinox, 2026-11-22: "We're assuming it can't
 * sign any more than that limit, but what if we're wrong?").
 *
 * Through the store, as the app runs it, with the in-memory bunker of
 * logout.test.ts: a real nostr-tools BunkerSigner, every request a real
 * kind 24133 event, NIP-44 sealed (the extended length prefix past 65,535
 * bytes), and every answer the bunker's own. Throwaway keys only; no socket
 * opens.
 */

import 'fake-indexeddb/auto'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const shim = (): Storage => {
    const m = new Map<string, string>()
    return {
      get length() { return m.size },
      clear: () => m.clear(),
      getItem: (k: string) => m.get(k) ?? null,
      key: (i: number) => [...m.keys()][i] ?? null,
      removeItem: (k: string) => { m.delete(k) },
      setItem: (k: string, v: string) => { m.set(k, String(v)) },
    }
  }
  ;(globalThis as { localStorage?: Storage }).localStorage = shim()
  ;(globalThis as { sessionStorage?: Storage }).sessionStorage = shim()
})

/** The in-memory signer relay and the bunker on it. */
const bus = vi.hoisted(() => ({
  /** The bunker answers while this is on. */
  alive: true,
  /** How long the bunker takes to answer (ms). */
  delayMs: 5,
  /** The bunker's key, which is also the account it holds (as Amber's is). */
  key: null as Uint8Array | null,
  subs: [] as Array<{ filter: { authors?: string[]; '#p'?: string[] }; params: { onevent?: (e: unknown) => void; oneose?: () => void; onclose?: () => void } }>,
  /** Every request event sent to the bunker. */
  requests: 0,
  /** Every close of the pool's sockets, by relay list. */
  closed: [] as string[][],
}))

vi.mock('../../lib/relay', async (orig) => {
  const real = await orig<typeof import('../../lib/relay')>()
  const { offlineRelay } = await import('../../test/offlineRelay')
  const { finalizeEvent, getPublicKey } = await import('nostr-tools/pure')
  const { v2: nip44 } = await import('nostr-tools/nip44')
  const respond = (event: { pubkey: string; content: string }): void => {
    const key = bus.key!
    const ck = nip44.utils.getConversationKey(key, event.pubkey)
    const req = JSON.parse(nip44.decrypt(event.content, ck)) as { id: string; method: string; params: string[] }
    const result = req.method === 'connect' ? 'ack'
      : req.method === 'get_public_key' ? getPublicKey(key)
      : req.method === 'ping' ? 'pong'
      : req.method === 'sign_event' ? JSON.stringify(finalizeEvent(JSON.parse(req.params[0]), key))
      : ''
    const answer = finalizeEvent({ kind: 24133, created_at: Math.floor(Date.now() / 1000), tags: [['p', event.pubkey]], content: nip44.encrypt(JSON.stringify({ id: req.id, result }), ck) }, key)
    for (const sub of [...bus.subs]) {
      if (sub.filter.authors?.includes(answer.pubkey) && sub.filter['#p']?.includes(event.pubkey)) sub.params.onevent?.(answer)
    }
  }
  const pool = {
    subscribe: (_relays: string[], filter: (typeof bus.subs)[number]['filter'], params: (typeof bus.subs)[number]['params']) => {
      const sub = { filter, params }
      bus.subs.push(sub)
      setTimeout(() => params.oneose?.(), 0)
      return { close: () => { bus.subs = bus.subs.filter((s) => s !== sub); params.onclose?.() } }
    },
    publish: (relays: string[], event: { kind: number; pubkey: string; content: string }) => {
      if (event.kind === 24133) {
        bus.requests++
        if (bus.alive) setTimeout(() => respond(event), bus.delayMs)
      }
      return relays.map(() => Promise.resolve('ok'))
    },
    close: (relays: string[]) => { bus.closed.push([...relays]) },
  }
  return { ...real, ...offlineRelay, getSignerPool: () => pool }
})
vi.mock('../../lib/chains', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/chains')>()
  return { ...actual, fetchChainEvents: vi.fn(async () => []), confirmChainEvents: vi.fn(async () => []) }
})

import { generateSecretKey, getPublicKey, type EventTemplate } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { createElement } from 'react'
import { IDENTITIES_DB } from '../../lib/identitiesDb'
import { DEFAULT_SIGNER_RELAY } from '../../lib/loginCredentials'
import { mount } from '../../test/elementRoot'

const PREF = 'onosendai:signer'

/** A shard (kind 33331) about `n` bytes long: past 65,535 its sign_event request is big. */
const shard = (n: number, d = 'big-shard'): EventTemplate => ({ kind: 33331, created_at: 1_700_000_000, tags: [['d', d]], content: 'a'.repeat(n) })

type Store = typeof import('../useCyberspace')
type Activity = typeof import('../../lib/signerActivity')
type Within = typeof import('../../lib/signWithin')
type Size = typeof import('../../lib/signerRequestSize')
const tabs: unknown[] = []
/** A page load: the store and its modules imported afresh over the same storage. */
async function reload(): Promise<{ S: Store['useCyberspace']; activity: Activity; within: Within; size: Size }> {
  vi.resetModules()
  const store = await import('../useCyberspace')
  const activity = await import('../../lib/signerActivity')
  const within = await import('../../lib/signWithin')
  const size = await import('../../lib/signerRequestSize')
  await store.savedChainLoaded()
  await store.heldIdentitiesSeeded
  tabs.push(store)
  return { S: store.useCyberspace, activity, within, size }
}
afterAll(() => { tabs.length = 0 })

async function wipe(): Promise<void> {
  localStorage.clear()
  sessionStorage.clear()
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(IDENTITIES_DB)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

/** A device whose signer is the bunker in this file, paired by Nostr Connect, reloaded into it. */
async function pairedDevice(): Promise<{ user: string; session: string; loaded: Awaited<ReturnType<typeof reload>> }> {
  await wipe()
  bus.alive = true
  bus.delayMs = 5
  bus.key = generateSecretKey()
  bus.subs = []
  bus.closed = []
  await reload()
  const user = getPublicKey(bus.key)
  const client = generateSecretKey()
  localStorage.setItem(PREF, JSON.stringify({
    kind: 'nip46',
    pubkey: user,
    bunkerUri: `bunker://${user}?relay=${encodeURIComponent(DEFAULT_SIGNER_RELAY)}`,
    clientNsec: nip19.nsecEncode(client),
    nostrConnectSession: true,
  }))
  const loaded = await reload()
  expect(loaded.S.getState().signerKind).toBe('nip46')
  return { user, session: getPublicKey(client), loaded }
}

/** Let what was scheduled run: a question open, a request out. */
const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('a big request to a remote signer, through the store', () => {
  it('shows the question; TRY ANYWAY sends it and the signer signs it', async () => {
    const { user, session, loaded: { S, activity, size } } = await pairedDevice()
    const asked = bus.requests
    const signing = S.getState().signEvent(shard(72_000))
    await settle()
    const q = size.useBigRequestQuestion.getState().question
    expect(q).not.toBeNull()
    expect(q!.words).toMatch(/^This is bigger than some signer apps can read \(about 65 KB, this needs 7\d KB\)\. TRY ANYWAY, or make the shard smaller\.$/)
    // Nothing went while the question was open.
    expect(bus.requests).toBe(asked)

    // TRY ANYWAY (the modal itself: hud/__tests__/bigRequestQuestion.test.tsx).
    q!.answer(true)
    const signed = await signing
    expect(signed.pubkey).toBe(user)
    expect(signed.content).toHaveLength(72_000)
    expect(bus.requests).toBe(asked + 1)
    expect(activity.activityOf(session).readsBig).toBe(true)
  }, 30_000)

  it('the session remembers the signer answered one, and stops asking', async () => {
    const { user, session, loaded: { S, activity, size } } = await pairedDevice()
    const first = S.getState().signEvent(shard(72_000, 'one'))
    await settle()
    size.useBigRequestQuestion.getState().question!.answer(true)
    await first
    expect(activity.activityOf(session).readsBig).toBe(true)
    // Another big one, even bigger: no question, it simply goes.
    const second = S.getState().signEvent(shard(150_000, 'two'))
    await settle()
    expect(size.useBigRequestQuestion.getState().question).toBeNull()
    expect((await second).pubkey).toBe(user)
  }, 30_000)

  it("DON'T SEND sends nothing and says what to do", async () => {
    const { session, loaded: { S, activity, size, within } } = await pairedDevice()
    const asked = bus.requests
    const failing = S.getState().signEvent(shard(72_000)).then(() => null, (e: unknown) => e)
    await settle()
    size.useBigRequestQuestion.getState().question!.answer(false)
    const err = await failing
    expect(bus.requests).toBe(asked)
    expect(within.signingFailed(err, 'nip46')).toMatch(/^Not sent: this is bigger than some signer apps can read \(about 65 KB, this needs 7\d KB\)\. Make the shard smaller, or sign in with a key on this device\.$/)
    expect(activity.activityOf(session).readsBig).toBe(false)
    // Not a stalled signer: no chip.
    expect(activity.activityOf(session).stuckAt).toBeNull()
  }, 30_000)

  it('a timeout after TRY ANYWAY says plainly the signer may not handle messages this big, and offers a key on this device', async () => {
    const { session, loaded: { S, activity, size, within } } = await pairedDevice()
    bus.alive = false
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let failure: unknown = null
    let asks = 0
    const unwatch = size.useBigRequestQuestion.subscribe((s, before) => { if (s.question && !before.question) asks++ })
    try {
      const signing = S.getState().signEvent(shard(72_000)).catch((err: unknown) => { failure = err })
      await vi.advanceTimersByTimeAsync(50)
      // The clock waits while the person reads: far past a signature's patience, nothing has failed.
      await vi.advanceTimersByTimeAsync(40_000)
      expect(failure).toBeNull()
      const asked = bus.requests
      size.useBigRequestQuestion.getState().question!.answer(true)
      // One wait, then one more over fresh sockets (the store's retry), not asked about again.
      await vi.advanceTimersByTimeAsync(31_000)
      await signing
      expect(bus.requests).toBe(asked + 2)
    } finally {
      unwatch()
      vi.useRealTimers()
    }
    expect(asks).toBe(1)
    expect(failure).not.toBeNull()
    expect(within.signingFailed(failure, 'nip46')).toBe('Your signer did not answer. It may not handle messages this big. Make the shard smaller, or sign in with a key on this device.')
    const seen = activity.activityOf(session)
    expect(seen.bigSilentAt).not.toBeNull()
    expect(seen.readsBig).toBe(false)
    // Not the pair-again chip: the signer may be fine with smaller messages.
    expect(seen.stuckAt).toBeNull()

    const ui = await import('../../hud/SignerControls')
    const chip = await mount(createElement(ui.SignerStuckChip))
    try {
      expect(chip.says('YOUR SIGNER DID NOT ANSWER')).toBe(true)
      expect(chip.says('It may not handle messages this big. Make it smaller, or use a key on this device.')).toBe(true)
      expect(chip.says('LOG OUT and pair again.')).toBe(false)
      await chip.press('USE A KEY HERE')
      expect(ui.useSignerUi.getState().loginOpen).toBe(true)
    } finally {
      ui.useSignerUi.getState().close()
      await chip.unmount()
    }
  }, 60_000)

  it('an ordinary silence still says LOG OUT and pair again', async () => {
    const { session, loaded: { S, activity, within } } = await pairedDevice()
    bus.alive = false
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let failure: unknown = null
    try {
      const signing = S.getState().signEvent(shard(100)).catch((err: unknown) => { failure = err })
      await vi.advanceTimersByTimeAsync(31_000)
      await signing
    } finally {
      vi.useRealTimers()
    }
    expect(within.signingFailed(failure, 'nip46')).toBe('Your signer is not answering. LOG OUT and pair again.')
    expect(activity.activityOf(session).stuckAt).not.toBeNull()
    expect(activity.activityOf(session).bigSilentAt).toBeNull()
  }, 60_000)

  it('past the signer relay cap it is refused at once, never asked about', async () => {
    const { loaded: { S, size } } = await pairedDevice()
    const asked = bus.requests
    const err = await S.getState().signEvent(shard(400_000)).then(() => null, (e: unknown) => e)
    expect(size.useBigRequestQuestion.getState().question).toBeNull()
    expect(bus.requests).toBe(asked)
    expect((err as { reason?: unknown }).reason).toBe('relay')
  }, 30_000)
})

describe('a key on this device', () => {
  it('signs a big shard at once and is never asked about it', async () => {
    await wipe()
    const { S, size } = await reload()
    expect(S.getState().signerKind).toBe('local')
    let asks = 0
    const unwatch = size.useBigRequestQuestion.subscribe((s) => { if (s.question) asks++ })
    try {
      const signed = await S.getState().signEvent(shard(200_000))
      expect(signed.content).toHaveLength(200_000)
    } finally {
      unwatch()
    }
    expect(asks).toBe(0)
  }, 30_000)
})
