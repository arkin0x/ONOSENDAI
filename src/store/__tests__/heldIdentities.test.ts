/**
 * heldIdentities.test.ts - a switch of identity never loses a key this device
 * held (owner ruling, 2026-11-19: "we want to preserve local indexdb data for
 * all users. key the user's data by npub so when they login it still
 * exists"). Every identity is kept in lib/identitiesDb.ts under its pubkey,
 * and the login's list switches back from there.
 *
 * Through the store, as the app runs it: a reload is a fresh import over one
 * localStorage, one sessionStorage and one IndexedDB (fake-indexeddb), as in
 * keyAtRest.test.ts. Every local signature goes through nostr-tools'
 * finalizeEvent, which is counted here, so a switch that signed anything
 * would show. Generated test keys only; nothing touches a network.
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
vi.mock('../../lib/chains', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/chains')>()
  return { ...actual, fetchChainEvents: vi.fn(async () => []), confirmChainEvents: vi.fn(async () => []) }
})
const signed = vi.hoisted(() => ({ count: 0 }))
vi.mock('nostr-tools/pure', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nostr-tools/pure')>()
  return { ...actual, finalizeEvent: (...args: Parameters<typeof actual.finalizeEvent>) => { signed.count++; return actual.finalizeEvent(...args) } }
})

import { generateSecretKey, getPublicKey, verifyEvent, type EventTemplate } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import * as nip49 from 'nostr-tools/nip49'
import { bytesToHex } from '@noble/hashes/utils.js'
import { WRONG_PASSWORD } from '../../lib/keyAtRest'
import { LOG_N } from '../../lib/keyExport'
import { IDENTITIES_DB, heldFromPref, mergeHeld } from '../../lib/identitiesDb'

const PREF = 'onosendai:signer'
const FIRST = 'onosendai:nsec'
const PW = 'correct horse battery'
const template = (n: number): EventTemplate => ({ kind: 1, created_at: 1_700_000_000 + n, tags: [], content: 'x' })

type Store = typeof import('../useCyberspace')
type Db = typeof import('../../lib/identitiesDb')
const tabs: Array<{ store: Store; db: Db }> = []
/** A page load: the store (and the identities store with it) imported afresh over the same storage. */
async function reload(): Promise<{ S: Store['useCyberspace']; store: Store; db: Db }> {
  vi.resetModules()
  const store = await import('../useCyberspace')
  const db = await import('../../lib/identitiesDb')
  await store.savedChainLoaded()
  await store.heldIdentitiesSeeded
  tabs.push({ store, db })
  return { S: store.useCyberspace, store, db }
}
afterAll(() => { tabs.length = 0 })

/** A device with nothing on it: both web storages and the identities database. */
async function wipe(): Promise<void> {
  localStorage.clear()
  sessionStorage.clear()
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(IDENTITIES_DB)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

const pref = (): Record<string, unknown> | null => {
  const raw = localStorage.getItem(PREF)
  return raw ? JSON.parse(raw) as Record<string, unknown> : null
}

/** The localStorage entries that hold identities and their keys, to compare before and after. */
const IDENTITY_KEYS = [PREF, FIRST, 'onosendai:mintedKey', 'onosendai:keyByChoice']
function snapshot(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of IDENTITY_KEYS) {
    const v = localStorage.getItem(k)
    if (v !== null) out[k] = v
  }
  return out
}

/** The whole identities database, as text. */
async function heldText(): Promise<string> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(IDENTITIES_DB)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  try {
    if (!db.objectStoreNames.contains('identities')) return ''
    const rows = await new Promise<unknown[]>((resolve) => {
      const r = db.transaction('identities', 'readonly').objectStore('identities').getAll()
      r.onsuccess = () => resolve(r.result)
    })
    return JSON.stringify(rows).toLowerCase()
  } finally {
    db.close()
  }
}

describe('NEW RANDOM KEY never loses the one before', () => {
  it('local A, then R1, then R2, then back to R1 and to A from the list, with no paste and nothing signed', async () => {
    await wipe()
    let { S, db } = await reload()
    const a = S.getState().identity.pubkey
    await S.getState().useNewKey()
    const r1 = S.getState().identity.pubkey
    await S.getState().useNewKey()
    const r2 = S.getState().identity.pubkey
    expect(new Set([a, r1, r2]).size).toBe(3)

    const listed = await db.listHeld()
    expect(new Set(listed.map((e) => e.pubkey))).toEqual(new Set([a, r1, r2]))
    expect(listed.every((e) => e.way === 'generated')).toBe(true)

    const before = signed.count
    await S.getState().useHeld(r1)
    expect(S.getState().loginError).toBeNull()
    expect(S.getState().identity.pubkey).toBe(r1)
    expect(S.getState().keyLock).toBeNull()
    expect(signed.count).toBe(before)
    // It is the full identity again: kept as generated, and it signs.
    expect(getPublicKey(nip19.decode(pref()?.nsec as string).data as Uint8Array)).toBe(r1)
    const ev = await S.getState().signEvent(template(1))
    expect(ev.pubkey).toBe(r1)
    // The count does see a signature: this one.
    expect(signed.count).toBe(before + 1)
    expect(verifyEvent(ev)).toBe(true)

    // A reload keeps it as the generated key it is, asked nothing.
    ;({ S, db } = await reload())
    expect(S.getState().identity.pubkey).toBe(r1)
    expect(S.getState().keyLock).toBeNull()

    const again = signed.count
    await S.getState().useHeld(a)
    expect(S.getState().identity.pubkey).toBe(a)
    expect(signed.count).toBe(again)
    await S.getState().useHeld(r2)
    expect(S.getState().identity.pubkey).toBe(r2)
    expect(signed.count).toBe(again)
  }, 60_000)

  it('an old random key pasted back counts as generated: no password, and a reload asks nothing', async () => {
    await wipe()
    let { S } = await reload()
    await S.getState().useNewKey()
    const r1 = S.getState().identity.pubkey
    const r1nsec = pref()?.nsec as string
    await S.getState().useNewKey()
    expect(S.getState().identity.pubkey).not.toBe(r1)
    // Pasted with no password: before this store it was taken for a brought key and asked for one.
    await S.getState().useLogin(r1nsec, '', '')
    expect(S.getState().loginError).toBeNull()
    expect(S.getState().identity.pubkey).toBe(r1)
    expect(pref()?.nsec).toBe(r1nsec)
    ;({ S } = await reload())
    expect(S.getState().identity.pubkey).toBe(r1)
    expect(S.getState().keyLock).toBeNull()
  }, 60_000)
})

describe('a pasted key comes back with its password alone', () => {
  it('pasted nsec P, sealed; switch away; a wrong password switches nothing; the right one brings P back', async () => {
    await wipe()
    const { S, db } = await reload()
    const sk = generateSecretKey()
    const p = getPublicKey(sk)
    await S.getState().useLogin(nip19.nsecEncode(sk), PW, PW)
    expect(S.getState().identity.pubkey).toBe(p)
    await S.getState().useNewKey()
    const r = S.getState().identity.pubkey
    expect(r).not.toBe(p)
    // The one pref slot moved on; the store still holds P, sealed.
    expect(pref()?.pubkey).toBe(r)
    expect((await db.listHeld()).find((e) => e.pubkey === p)?.way).toBe('password')

    const before = signed.count
    await S.getState().useHeld(p, 'wrong password')
    expect(S.getState().loginError).toBe(WRONG_PASSWORD)
    expect(S.getState().identity.pubkey).toBe(r)
    await S.getState().useHeld(p)
    expect(S.getState().loginError).not.toBeNull()
    expect(S.getState().identity.pubkey).toBe(r)

    await S.getState().useHeld(p, PW)
    expect(S.getState().loginError).toBeNull()
    expect(S.getState().identity.pubkey).toBe(p)
    expect(S.getState().keyLock).toBeNull()
    expect(signed.count).toBe(before)
    expect((await S.getState().signEvent(template(2))).pubkey).toBe(p)
    // Kept sealed in the pref again, and never plain anywhere.
    expect(bytesToHex(nip49.decrypt(pref()?.ncryptsec as string, PW))).toBe(bytesToHex(sk))
    expect(pref()?.nsec).toBeUndefined()
    const text = await heldText()
    expect(text.includes(nip19.nsecEncode(sk))).toBe(false)
    expect(text.includes(bytesToHex(sk))).toBe(false)
  }, 60_000)

  it('the lock screen: USE ANOTHER IDENTITY keeps the encrypted key, and its password brings it back', async () => {
    await wipe()
    const sk = generateSecretKey()
    const p = getPublicKey(sk)
    const ncryptsec = nip49.encrypt(sk, PW, LOG_N)
    localStorage.setItem(PREF, JSON.stringify({ kind: 'local', pubkey: p, ncryptsec }))
    let { S, db } = await reload()
    expect(S.getState().keyLock).toEqual({ mode: 'unlock', pubkey: p })
    expect(S.getState().lockedNcryptsec()).toBe(ncryptsec)
    // USE ANOTHER IDENTITY, then NEW RANDOM KEY in the login it opens.
    await S.getState().useNewKey()
    expect(S.getState().keyLock).toBeNull()
    expect(S.getState().identity.pubkey).not.toBe(p)
    expect(pref()?.pubkey).not.toBe(p)
    expect((await db.listHeld()).find((e) => e.pubkey === p)?.way).toBe('password')

    // Even after a reload, P is one password away.
    ;({ S, db } = await reload())
    await S.getState().useHeld(p, 'nope nope nope')
    expect(S.getState().loginError).toBe(WRONG_PASSWORD)
    expect(S.getState().identity.pubkey).not.toBe(p)
    await S.getState().useHeld(p, PW)
    expect(S.getState().identity.pubkey).toBe(p)
    expect(S.getState().keyLock).toBeNull()
    expect(pref()).toEqual({ kind: 'local', pubkey: p, ncryptsec })
    expect((await S.getState().signEvent(template(3))).pubkey).toBe(p)
  }, 60_000)
})

describe('migration from what localStorage kept', () => {
  it('copies the first key and the pref in, leaving every localStorage entry as it was', async () => {
    await wipe()
    const first = generateSecretKey()
    const sk = generateSecretKey()
    const p = getPublicKey(sk)
    localStorage.setItem(FIRST, nip19.nsecEncode(first))
    localStorage.setItem(PREF, JSON.stringify({ kind: 'local', pubkey: p, ncryptsec: nip49.encrypt(sk, PW, LOG_N) }))
    const before = snapshot()
    const { store, db } = await reload()
    expect(await store.heldIdentitiesSeeded).toBe(true)
    expect(snapshot()).toEqual(before)
    const listed = await db.listHeld()
    expect(listed.find((e) => e.pubkey === getPublicKey(first))?.way).toBe('generated')
    expect(listed.find((e) => e.pubkey === p)?.way).toBe('password')
    // The pref's identity was the one in use.
    expect(listed[0].pubkey).toBe(p)
  }, 60_000)

  it('copies the last NEW RANDOM KEY from the pref, as generated', async () => {
    await wipe()
    const r = generateSecretKey()
    localStorage.setItem(FIRST, nip19.nsecEncode(generateSecretKey()))
    localStorage.setItem('onosendai:mintedKey', getPublicKey(r))
    localStorage.setItem(PREF, JSON.stringify({ kind: 'local', pubkey: getPublicKey(r), nsec: nip19.nsecEncode(r) }))
    const { db } = await reload()
    expect((await db.listHeld()).find((e) => e.pubkey === getPublicKey(r))?.way).toBe('generated')
  }, 60_000)

  it('never copies the plain key of a brought key saved before keys were sealed', async () => {
    await wipe()
    const sk = generateSecretKey()
    localStorage.setItem(PREF, JSON.stringify({ kind: 'local', pubkey: getPublicKey(sk), nsec: nip19.nsecEncode(sk) }))
    const { S, db } = await reload()
    expect(S.getState().keyLock?.mode).toBe('set')
    const text = await heldText()
    expect(text.includes(nip19.nsecEncode(sk))).toBe(false)
    expect(text.includes(bytesToHex(sk))).toBe(false)
    expect((await db.listHeld()).some((e) => e.pubkey === getPublicKey(sk))).toBe(false)
    // Given a password, it is kept sealed, and listed.
    expect(await S.getState().setKeyPassword(PW, PW)).toBe(true)
    expect((await db.listHeld()).find((e) => e.pubkey === getPublicKey(sk))?.way).toBe('password')
    expect((await heldText()).includes(nip19.nsecEncode(sk))).toBe(false)
  }, 60_000)

  it('a store that cannot open: localStorage is untouched, and the next load copies it in', async () => {
    await wipe()
    const first = generateSecretKey()
    localStorage.setItem(FIRST, nip19.nsecEncode(first))
    const before = snapshot()
    const open = indexedDB.open.bind(indexedDB)
    const refuse = vi.spyOn(indexedDB, 'open').mockImplementation((name: string, version?: number) => {
      if (name === IDENTITIES_DB) throw new Error('page closed')
      return open(name, version)
    })
    let loaded: Awaited<ReturnType<typeof reload>>
    try {
      loaded = await reload()
      expect(await loaded.store.heldIdentitiesSeeded).toBe(false)
      expect(snapshot()).toEqual(before)
    } finally {
      refuse.mockRestore()
    }
    loaded = await reload()
    expect(await loaded.store.heldIdentitiesSeeded).toBe(true)
    expect((await loaded.db.listHeld()).find((e) => e.pubkey === getPublicKey(first))?.way).toBe('generated')
    expect(snapshot()).toEqual(before)
  }, 60_000)

  it('a write that fails partway: nothing is half kept, localStorage is untouched, and the next load finishes it', async () => {
    await wipe()
    const sk = generateSecretKey()
    const p = getPublicKey(sk)
    localStorage.setItem(FIRST, nip19.nsecEncode(generateSecretKey()))
    localStorage.setItem(PREF, JSON.stringify({ kind: 'local', pubkey: p, ncryptsec: nip49.encrypt(sk, PW, LOG_N) }))
    const before = snapshot()
    const put = IDBObjectStore.prototype.put
    const broken = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'identities') throw new DOMException('disk full', 'QuotaExceededError')
      return put.apply(this, args)
    })
    let loaded: Awaited<ReturnType<typeof reload>>
    try {
      loaded = await reload()
      expect(await loaded.store.heldIdentitiesSeeded).toBe(false)
      expect(snapshot()).toEqual(before)
    } finally {
      broken.mockRestore()
    }
    loaded = await reload()
    expect(await loaded.store.heldIdentitiesSeeded).toBe(true)
    expect((await loaded.db.listHeld()).find((e) => e.pubkey === p)?.way).toBe('password')
    expect(snapshot()).toEqual(before)
  }, 60_000)

  it('a full localStorage: nothing is lost, and the store still records every switch', async () => {
    await wipe()
    const { S, db } = await reload()
    const a = S.getState().identity.pubkey
    const before = snapshot()
    const full = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })
    try {
      await S.getState().useNewKey()
      const r1 = S.getState().identity.pubkey
      await S.getState().useNewKey()
      expect(S.getState().identity.pubkey).not.toBe(r1)
      // Nothing written, nothing removed.
      expect(snapshot()).toEqual(before)
      const listed = await db.listHeld()
      expect(listed.some((e) => e.pubkey === r1 && e.way === 'generated')).toBe(true)
      await S.getState().useHeld(r1)
      expect(S.getState().identity.pubkey).toBe(r1)
      await S.getState().useHeld(a)
      expect(S.getState().identity.pubkey).toBe(a)
    } finally {
      full.mockRestore()
    }
  }, 60_000)
})

describe('an extension in the list', () => {
  it('switches back by asking the extension for its key, and signs nothing to switch', async () => {
    await wipe()
    const g = globalThis as { window?: { nostr?: unknown } }
    const hadWindow = 'window' in g
    const extSk = generateSecretKey()
    const signEvent = vi.fn(async () => { throw new Error('nothing should sign') })
    g.window = { nostr: { getPublicKey: async () => getPublicKey(extSk), signEvent } }
    try {
      const { S, db } = await reload()
      await S.getState().useExtension()
      const ext = getPublicKey(extSk)
      expect(S.getState().identity.pubkey).toBe(ext)
      await S.getState().useNewKey()
      expect((await db.listHeld()).find((e) => e.pubkey === ext)?.way).toBe('extension')
      await S.getState().useHeld(ext)
      expect(S.getState().identity.pubkey).toBe(ext)
      expect(S.getState().signerKind).toBe('nip07')
      expect(signEvent).not.toHaveBeenCalled()
    } finally {
      if (!hadWindow) delete g.window
    }
  }, 60_000)
})

describe('the merge', () => {
  it('never drops a key a row holds, and keeps a brought key only sealed', () => {
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    const sealed = { pubkey: pk, kind: 'local' as const, ncryptsec: 'ncryptsec1abc', firstHeld: 1, lastUsed: 5 }
    // The same identity later through an extension, or as a key not kept: the sealed copy stays.
    expect(mergeHeld(sealed, { pubkey: pk, kind: 'nip07', lastUsed: 9 }, 10)).toMatchObject({ kind: 'nip07', ncryptsec: 'ncryptsec1abc', firstHeld: 1, lastUsed: 9 })
    expect(mergeHeld(sealed, { pubkey: pk, kind: 'local' }, 10)).toMatchObject({ ncryptsec: 'ncryptsec1abc', lastUsed: 5 })
    // A plain key from a pref goes in only when the app generated it.
    expect(heldFromPref({ kind: 'local', pubkey: pk, nsec: nip19.nsecEncode(sk) }, false)).toEqual({ pubkey: pk, kind: 'local' })
    expect(heldFromPref({ kind: 'local', pubkey: pk, nsec: nip19.nsecEncode(sk) }, true)?.nsec).toBe(nip19.nsecEncode(sk))
    // And only when it is that pubkey's key.
    expect(heldFromPref({ kind: 'local', pubkey: pk, nsec: nip19.nsecEncode(generateSecretKey()) }, true)?.nsec).toBeUndefined()
  })
})
