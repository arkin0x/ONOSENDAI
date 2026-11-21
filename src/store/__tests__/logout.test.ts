/**
 * logout.test.ts - LOG OUT, TEST SIGNER and PAIR AGAIN (arkinox, 2026-11-21:
 * "there's no fucking log out. my bunker connection is stuck I think").
 *
 * Through the store, as the app runs it: a reload is a fresh import over one
 * localStorage, one sessionStorage and one IndexedDB (fake-indexeddb), as in
 * heldIdentities.test.ts. The remote signer is a real nostr-tools
 * BunkerSigner talking NIP-46 to a bunker in this file, over an in-memory
 * relay standing in for the signer pool: every request is a real kind 24133
 * event, NIP-44 sealed, and every answer the bunker's own. Switch it off and
 * it is the dead signer of his phone. Throwaway keys only; no socket opens.
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
const PW = 'correct horse battery'
const template = (n: number): EventTemplate => ({ kind: 1, created_at: 1_700_000_000 + n, tags: [], content: 'x' })

type Store = typeof import('../useCyberspace')
type Db = typeof import('../../lib/identitiesDb')
type Activity = typeof import('../../lib/signerActivity')
type Within = typeof import('../../lib/signWithin')
const tabs: unknown[] = []
/** A page load: the store and its modules imported afresh over the same storage. */
async function reload(): Promise<{ S: Store['useCyberspace']; store: Store; db: Db; activity: Activity; within: Within }> {
  vi.resetModules()
  const store = await import('../useCyberspace')
  const db = await import('../../lib/identitiesDb')
  const activity = await import('../../lib/signerActivity')
  const within = await import('../../lib/signWithin')
  await store.savedChainLoaded()
  await store.heldIdentitiesSeeded
  tabs.push(store)
  return { S: store.useCyberspace, store, db, activity, within }
}
afterAll(() => { tabs.length = 0 })

async function wipe(): Promise<void> {
  localStorage.clear()
  sessionStorage.clear()
  for (const name of [IDENTITIES_DB, 'logout-test-other']) {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(name)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  }
}

const pref = (): Record<string, unknown> | null => {
  const raw = localStorage.getItem(PREF)
  return raw ? JSON.parse(raw) as Record<string, unknown> : null
}

/** Every IndexedDB database on the device, every store and row, as text. */
async function everyIdb(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  for (const { name } of await indexedDB.databases()) {
    if (!name) continue
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    try {
      for (const store of [...db.objectStoreNames]) {
        out[`${name}/${store}`] = await new Promise<unknown[]>((resolve) => {
          const r = db.transaction(store, 'readonly').objectStore(store).getAll()
          r.onsuccess = () => resolve(r.result)
        })
      }
    } finally {
      db.close()
    }
  }
  return out
}

/**
 * Every store that held rows before still holds exactly them, with `ignore`
 * fields left out (a row's last use moves forward). A store the app opened
 * meanwhile (its storage probe) may be new; none may be gone or changed.
 */
function expectKept(before: Record<string, unknown>, after: Record<string, unknown>, ignore: string[]): void {
  const strip = (v: unknown): string => JSON.stringify(v, (k, x) => (ignore.includes(k) ? undefined : x))
  for (const [store, rows] of Object.entries(before)) expect(strip(after[store]), store).toBe(strip(rows))
}

/** Some other app data in IndexedDB, as any per-npub store keeps it. */
async function writeOther(pubkey: string): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('logout-test-other', 1)
    req.onupgradeneeded = () => { req.result.createObjectStore('rows', { keyPath: 'npub' }) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  await new Promise<void>((resolve) => {
    const tx = db.transaction('rows', 'readwrite')
    tx.objectStore('rows').put({ npub: nip19.npubEncode(pubkey), kept: 'everything' })
    tx.oncomplete = () => resolve()
  })
  db.close()
}

/** localStorage, minus what LOG OUT is meant to change: the one signer slot and the generated-key marks. */
function storageBut(): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!
    if (k === PREF || k === 'onosendai:mintedKey' || k === 'onosendai:keyByChoice') continue
    out[k] = localStorage.getItem(k)!
  }
  return out
}

/** A device whose signer is the bunker in this file, paired by Nostr Connect, reloaded into it. */
async function pairedDevice(nostrConnect = true): Promise<{ device: string; user: string; session: string; loaded: Awaited<ReturnType<typeof reload>> }> {
  await wipe()
  bus.alive = true
  bus.delayMs = 5
  bus.key = generateSecretKey()
  bus.subs = []
  bus.closed = []
  const first = await reload()
  const device = first.S.getState().identity.pubkey
  const user = getPublicKey(bus.key)
  const client = generateSecretKey()
  localStorage.setItem(PREF, JSON.stringify({
    kind: 'nip46',
    pubkey: user,
    bunkerUri: `bunker://${user}?relay=${encodeURIComponent(DEFAULT_SIGNER_RELAY)}`,
    clientNsec: nip19.nsecEncode(client),
    ...(nostrConnect ? { nostrConnectSession: true } : {}),
  }))
  const loaded = await reload()
  expect(loaded.S.getState().identity.pubkey).toBe(user)
  expect(loaded.S.getState().signerKind).toBe('nip46')
  expect(loaded.S.getState().signerSession).toBe(getPublicKey(client))
  return { device, user, session: getPublicKey(client), loaded }
}

describe('LOG OUT of a pasted key', () => {
  it('goes back to the device key, keeps every IndexedDB row and the sealed key, and logging in again restores the data', async () => {
    await wipe()
    let { S, db } = await reload()
    const device = S.getState().identity.pubkey
    expect(S.getState().generatedKey).toBe(true)
    // From the device's own key there is nowhere to log out to: nothing happens.
    await S.getState().logOut()
    expect(S.getState().identity.pubkey).toBe(device)

    const sk = generateSecretKey()
    const p = getPublicKey(sk)
    await S.getState().useLogin(nip19.nsecEncode(sk), PW, PW)
    expect(S.getState().identity.pubkey).toBe(p)
    expect(S.getState().generatedKey).toBe(false)
    S.getState().noteBalance(5_000_000, p)
    await writeOther(p)
    localStorage.setItem(`onosendai:test-per-npub:${p}`, 'mine')
    await db.heldSettled()
    const sealed = (await db.readHeld(p))?.ncryptsec
    expect(sealed?.startsWith('ncryptsec1')).toBe(true)
    const idbBefore = await everyIdb()
    const storageBefore = storageBut()

    await S.getState().logOut()
    await db.heldSettled()
    expect(S.getState().identity.pubkey).toBe(device)
    expect(S.getState().signerKind).toBe('local')
    expect(S.getState().generatedKey).toBe(true)
    expect(S.getState().cloud.balance).toBeNull()
    // The one slot now names the device key, plain, as a generated key is kept.
    expect(pref()?.pubkey).toBe(device)
    // The sealed key stays under its npub, and the login still offers it.
    expect((await db.readHeld(p))?.ncryptsec).toBe(sealed)
    expect((await db.listHeld()).find((e) => e.pubkey === p)?.way).toBe('password')
    // Every IndexedDB row and every other localStorage entry is as it was
    // (a row's last use moves forward, nothing else).
    expectKept(idbBefore, await everyIdb(), ['lastUsed'])
    expect(storageBut()).toEqual(storageBefore)

    // A reload stays logged out, on the device key, asking for nothing.
    ;({ S, db } = await reload())
    expect(S.getState().identity.pubkey).toBe(device)
    expect(S.getState().keyLock).toBeNull()

    // Logging in again picks up where it was: its balance, its rows.
    await S.getState().useHeld(p, PW)
    expect(S.getState().loginError).toBeNull()
    expect(S.getState().identity.pubkey).toBe(p)
    expect(S.getState().cloud.balance?.msats).toBe(5_000_000)
    expect(localStorage.getItem(`onosendai:test-per-npub:${p}`)).toBe('mine')
    expect(JSON.stringify(await everyIdb())).toContain('everything')
    expect((await S.getState().signEvent(template(1))).pubkey).toBe(p)
  }, 60_000)
})

describe('a remote signer', () => {
  it('TEST SIGNER: a bunker that answers says so, and a dead one is said not to within 15 s', async () => {
    const { user, session, loaded: { S, store, activity } } = await pairedDevice()
    const ok = await S.getState().testSigner()
    expect(ok).toEqual({ ok: true, words: store.SIGNER_ANSWERED })
    const seen = activity.activityOf(session)
    expect(seen.answeredAt).not.toBeNull()
    expect(activity.signerHealth(seen)).toBe('answering')
    // It signs through the bunker as the account it holds.
    expect((await S.getState().signEvent(template(2))).pubkey).toBe(user)

    bus.alive = false
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const asked = bus.requests
      const silent = S.getState().testSigner()
      await vi.advanceTimersByTimeAsync(15_500)
      expect(await silent).toEqual({ ok: false, words: store.SIGNER_SILENT })
      expect(store.SIGNER_SILENT).toBe('Your signer did not answer in 15 s.')
      // It really asked: a request went out and none came back.
      expect(bus.requests).toBeGreaterThan(asked)
      expect(activity.signerHealth(activity.activityOf(session))).toBe('silent')
    } finally {
      vi.useRealTimers()
    }
  }, 60_000)

  it('a move that runs out of time says LOG OUT and pair again, and raises the chip with both', async () => {
    const { session, loaded: { S, activity, within } } = await pairedDevice()
    bus.alive = false
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let failure: unknown = null
    try {
      const signing = S.getState().signEvent(template(3)).catch((err: unknown) => { failure = err })
      // One wait, then one more over fresh sockets (the store's retry).
      await vi.advanceTimersByTimeAsync(31_000)
      await signing
    } finally {
      vi.useRealTimers()
    }
    expect(failure).not.toBeNull()
    expect(within.signingFailed(failure, S.getState().signerKind)).toBe('Your signer is not answering. LOG OUT and pair again.')
    expect(activity.activityOf(session).stuckAt).not.toBeNull()

    const ui = await import('../../hud/SignerControls')
    const chip = await mount(createElement(ui.SignerStuckChip))
    try {
      expect(chip.says('YOUR SIGNER IS NOT ANSWERING')).toBe(true)
      expect(chip.says('LOG OUT and pair again.')).toBe(true)
      expect(chip.buttons('PAIR AGAIN')).toHaveLength(1)
      await chip.press('LOG OUT')
      expect(ui.useSignerUi.getState().logoutOpen).toBe(true)
      // The signer answering again puts it away.
      bus.alive = true
      await S.getState().testSigner()
      expect(activity.activityOf(session).stuckAt).toBeNull()
      await new Promise((r) => setTimeout(r, 5))
      expect(chip.says('YOUR SIGNER IS NOT ANSWERING')).toBe(false)
    } finally {
      await chip.unmount()
    }
  }, 60_000)

  it('LOG OUT closes and forgets the session and its sockets, keeps the identity for PAIR AGAIN, and pairing again restores it', async () => {
    const { device, user, session, loaded: { S, store, db, activity } } = await pairedDevice()
    expect(await S.getState().testSigner()).toEqual({ ok: true, words: store.SIGNER_ANSWERED })
    S.getState().noteBalance(7_000_000, user)
    await db.heldSettled()
    expect((await db.readHeld(user))?.bunker?.clientNsec).toBeTruthy()
    const idbBefore = await everyIdb()

    bus.closed = []
    await S.getState().logOut()
    await db.heldSettled()
    // The device's own key, signing on this device.
    expect(S.getState().identity.pubkey).toBe(device)
    expect(S.getState().signerKind).toBe('local')
    expect(S.getState().signerSession).toBeNull()
    expect((await S.getState().signEvent(template(4))).pubkey).toBe(device)
    // The saved session is gone: the slot names the device key, the row
    // keeps the identity without its URI or client key, offered as PAIR AGAIN.
    expect(pref()?.pubkey).toBe(device)
    expect(JSON.stringify(pref())).not.toContain('bunker')
    const row = await db.readHeld(user)
    expect(row?.kind).toBe('nip46')
    expect(row?.bunker).toBeUndefined()
    expect((await db.listHeld()).find((e) => e.pubkey === user)?.way).toBe('pair')
    // Its sockets dropped, its subscription closed, its activity forgotten.
    expect(bus.closed.some((relays) => relays.includes(DEFAULT_SIGNER_RELAY))).toBe(true)
    expect(bus.subs).toHaveLength(0)
    expect(activity.activityOf(session).answeredAt).toBeNull()
    // Nothing else in IndexedDB changed: only that row's session went.
    expectKept(idbBefore, await everyIdb(), ['lastUsed', 'bunker'])
    // Nothing more is asked of the old pairing.
    const asked = bus.requests
    await new Promise((r) => setTimeout(r, 50))
    expect(bus.requests).toBe(asked)

    // PAIR AGAIN with a signer on another account pairs nothing.
    const other = generateSecretKey()
    const { localSigner } = await import('../../lib/signers')
    const fakeQr = (key: Uint8Array) => ({ uri: 'nostrconnect://test', relay: DEFAULT_SIGNER_RELAY, connect: async () => ({ ...localSigner(key), kind: 'nip46' as const }) })
    await S.getState().useNostrConnect(fakeQr(other), undefined, undefined, user)
    expect(S.getState().loginError).toBe(store.PAIR_OTHER_ACCOUNT)
    expect(S.getState().identity.pubkey).toBe(device)
    // The right one: back as that identity, its data where it was.
    await S.getState().useNostrConnect(fakeQr(bus.key!), undefined, undefined, user)
    expect(S.getState().loginError).toBeNull()
    expect(S.getState().identity.pubkey).toBe(user)
    expect(S.getState().cloud.balance?.msats).toBe(7_000_000)
  }, 60_000)

  it('LOG OUT while the handshake is out: its late answer is closed, not switched to, and asks nothing more', async () => {
    const { device, user, loaded: { S, db } } = await pairedDevice(false)
    expect(S.getState().identity.pubkey).toBe(user)
    bus.delayMs = 400
    const asked = bus.requests
    const reconnecting = S.getState().initSigner()
    await new Promise((r) => setTimeout(r, 30))
    // The handshake's connect is out, unanswered.
    expect(bus.requests).toBeGreaterThan(asked)
    expect(await S.getState().logOut()).toBeNull()
    await db.heldSettled()
    expect(S.getState().identity.pubkey).toBe(device)
    // The answers land: the handshake finishes into a signer that is closed at once.
    await reconnecting
    await new Promise((r) => setTimeout(r, 1200))
    expect(S.getState().identity.pubkey).toBe(device)
    expect(S.getState().signerKind).toBe('local')
    expect(S.getState().loginError).toBeNull()
    expect(bus.subs).toHaveLength(0)
    expect(JSON.stringify(pref())).not.toContain('bunker')
    expect((await db.readHeld(user))?.bunker).toBeUndefined()
    const after = bus.requests
    await new Promise((r) => setTimeout(r, 500))
    expect(bus.requests).toBe(after)
  }, 60_000)

  it('PAIR AGAIN on the stuck pairing closes the old one once the new one is in', async () => {
    const { user, session, loaded: { S, store, activity } } = await pairedDevice()
    expect(await S.getState().testSigner()).toEqual({ ok: true, words: store.SIGNER_ANSWERED })
    expect(bus.subs.length).toBeGreaterThan(0)
    const { localSigner } = await import('../../lib/signers')
    const fresh = generateSecretKey()
    await S.getState().useNostrConnect({ uri: 'nostrconnect://test', relay: DEFAULT_SIGNER_RELAY, connect: async () => ({ ...localSigner(bus.key!), kind: 'nip46' as const, session: getPublicKey(fresh) }) }, undefined, undefined, user)
    expect(S.getState().identity.pubkey).toBe(user)
    expect(S.getState().signerSession).toBe(getPublicKey(fresh))
    expect(bus.subs).toHaveLength(0)
    expect(activity.activityOf(session).answeredAt).toBeNull()
  }, 60_000)
})

describe('LOG OUT never loses a key it would have to delete', () => {
  it('a key used for this visit only is refused, with the words why, and nothing switches', async () => {
    await wipe()
    const { S, store } = await reload()
    const sk = generateSecretKey()
    await S.getState().useNsec(nip19.nsecEncode(sk))
    expect(S.getState().identity.pubkey).toBe(getPublicKey(sk))
    expect(await S.getState().logOut()).toBe(store.LOGOUT_UNKEPT)
    expect(S.getState().identity.pubkey).toBe(getPublicKey(sk))
    expect((await S.getState().signEvent(template(5))).pubkey).toBe(getPublicKey(sk))
  }, 60_000)

  it('a locked key logs out with its sealed copy kept, and comes back with its password', async () => {
    await wipe()
    let { S, db } = await reload()
    const device = S.getState().identity.pubkey
    const sk = generateSecretKey()
    const p = getPublicKey(sk)
    await S.getState().useLogin(nip19.nsecEncode(sk), PW, PW)
    ;({ S, db } = await reload())
    expect(S.getState().keyLock?.mode).toBe('unlock')
    expect(await S.getState().logOut()).toBeNull()
    expect(S.getState().identity.pubkey).toBe(device)
    expect(S.getState().keyLock).toBeNull()
    expect((await db.readHeld(p))?.ncryptsec?.startsWith('ncryptsec1')).toBe(true)
    await S.getState().useHeld(p, PW)
    expect(S.getState().identity.pubkey).toBe(p)
  }, 60_000)
})
