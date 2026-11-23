/**
 * keyAtRest.test.ts - a key someone brought is kept on this device only
 * encrypted (lib/keyAtRest.ts, owner 2026-11-18: "we should definitely add in
 * ncryptsec at rest and if the user pastes an nsec it forces them to pick a
 * password").
 *
 * Through the store, as the app runs it: a reload is a fresh import over one
 * localStorage, one sessionStorage and one IndexedDB (fake-indexeddb). After
 * each login every one of them is read whole and searched for the key, as an
 * nsec and as hex. Generated test keys only; nothing touches a network.
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

import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent, type EventTemplate } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import * as nip49 from 'nostr-tools/nip49'
import { bech32 } from '@scure/base'
import { bytesToHex } from '@noble/hashes/utils.js'
import { LOCK_ABANDONED, WRONG_PASSWORD } from '../../lib/keyAtRest'
import { LOG_N } from '../../lib/keyExport'
import { prefOf, type Signer } from '../../lib/signers'

const PREF = 'onosendai:signer'
const PW = 'correct horse battery'
const template = (n: number): EventTemplate => ({ kind: 1, created_at: 1_700_000_000 + n, tags: [], content: 'x' })

type Store = typeof import('../useCyberspace')
const tabs: Store[] = []
/** A page load: the store imported afresh over the same storage. */
async function reload(): Promise<Store> {
  vi.resetModules()
  const store = await import('../useCyberspace')
  await store.savedChainLoaded()
  tabs.push(store)
  return store
}
afterAll(() => { tabs.length = 0 })

function wipe(): void {
  localStorage.clear()
  sessionStorage.clear()
}

const pref = (): Record<string, unknown> | null => {
  const raw = localStorage.getItem(PREF)
  return raw ? JSON.parse(raw) as Record<string, unknown> : null
}

/** Everything this origin keeps, as text: both web storages and every IndexedDB record and key. */
async function everythingStored(): Promise<string> {
  const parts: string[] = []
  for (const s of [localStorage, sessionStorage]) {
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i) as string
      parts.push(k, s.getItem(k) ?? '')
    }
  }
  const asText = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => {
    if (typeof x === 'bigint') return x.toString()
    if (x instanceof Uint8Array) return bytesToHex(x)
    if (x instanceof ArrayBuffer) return bytesToHex(new Uint8Array(x))
    return x
  })
  for (const info of await indexedDB.databases()) {
    if (!info.name) continue
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(info.name as string)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    for (const name of Array.from(db.objectStoreNames)) {
      const os = db.transaction(name, 'readonly').objectStore(name)
      const all = await new Promise<unknown[]>((resolve) => { const r = os.getAll(); r.onsuccess = () => resolve(r.result) })
      const keys = await new Promise<unknown[]>((resolve) => {
        const r = db.transaction(name, 'readonly').objectStore(name).getAllKeys()
        r.onsuccess = () => resolve(r.result)
      })
      parts.push(info.name, name, asText(all), asText(keys))
    }
    db.close()
  }
  return parts.join('\n')
}

/** Whether `sk` is anywhere in storage, as an nsec or as hex. */
async function keyStored(sk: Uint8Array): Promise<boolean> {
  const text = (await everythingStored()).toLowerCase()
  return text.includes(nip19.nsecEncode(sk)) || text.includes(bytesToHex(sk))
}

/** Still waiting after a while: a signature a locked key holds back. */
async function pending(p: Promise<unknown>): Promise<boolean> {
  const late = Symbol('late')
  return (await Promise.race([p.then(() => 'done', () => 'done'), new Promise((r) => setTimeout(() => r(late), 150))])) === late
}

/** The work factor inside an ncryptsec (NIP-49: the byte after the version). */
function logNOf(ncryptsec: string): number {
  return bech32.fromWords(bech32.decode(ncryptsec as `${string}1${string}`, 5000).words)[1]
}

describe('the storage search', () => {
  it('finds a key kept in IndexedDB, as hex or as bytes', async () => {
    const sk = generateSecretKey()
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDB.open('keyAtRest-control', 1)
      req.onupgradeneeded = () => req.result.createObjectStore('things')
      req.onsuccess = () => resolve(req.result)
    })
    expect(await keyStored(sk)).toBe(false)
    await new Promise<void>((resolve) => {
      const tx = db.transaction('things', 'readwrite')
      tx.objectStore('things').put({ raw: sk }, 'a')
      tx.oncomplete = () => resolve()
    })
    expect(await keyStored(sk)).toBe(true)
    db.close()
    await new Promise<void>((resolve) => { const r = indexedDB.deleteDatabase('keyAtRest-control'); r.onsuccess = () => resolve() })
    expect(await keyStored(sk)).toBe(false)
  })
})

describe('a pasted nsec', () => {
  it('needs a password typed twice, and is kept only as an ncryptsec made with it', async () => {
    wipe()
    const { useCyberspace: S } = await reload()
    const before = S.getState().identity.pubkey
    const sk = generateSecretKey()
    const nsec = nip19.nsecEncode(sk)

    await S.getState().useLogin(nsec, 'short', 'short')
    expect(S.getState().loginError).toBe('At least 8 characters.')
    expect(S.getState().identity.pubkey).toBe(before)
    await S.getState().useLogin(nsec, PW, `${PW}!`)
    expect(S.getState().loginError).toBe('The two passwords are different.')
    await S.getState().useLogin(nsec, '', '')
    expect(S.getState().identity.pubkey).toBe(before)
    expect(await keyStored(sk)).toBe(false)

    await S.getState().useLogin(nsec, PW, PW)
    expect(S.getState().loginError).toBeNull()
    expect(S.getState().identity.pubkey).toBe(getPublicKey(sk))
    expect(S.getState().keyLock).toBeNull()
    const saved = pref()
    expect(saved?.nsec).toBeUndefined()
    expect(typeof saved?.ncryptsec).toBe('string')
    expect(bytesToHex(nip49.decrypt(saved?.ncryptsec as string, PW))).toBe(bytesToHex(sk))
    expect(logNOf(saved?.ncryptsec as string)).toBe(LOG_N)
    expect(await keyStored(sk)).toBe(false)
    // It signs, from memory.
    const signed = await S.getState().signEvent(template(1))
    expect(signed.pubkey).toBe(getPublicKey(sk))
    expect(verifyEvent(signed)).toBe(true)
    // The key export still works for it.
    expect(bytesToHex(nip49.decrypt(S.getState().exportKey('backup pass', 'backup pass'), 'backup pass'))).toBe(bytesToHex(sk))
  }, 60_000)

  it('with no password at all (useNsec), works for this visit and nothing of it is stored', async () => {
    wipe()
    const { useCyberspace: S } = await reload()
    const sk = generateSecretKey()
    await S.getState().useNsec(nip19.nsecEncode(sk))
    expect(S.getState().identity.pubkey).toBe(getPublicKey(sk))
    expect(pref()).toEqual({ kind: 'local', pubkey: getPublicKey(sk) })
    expect(await keyStored(sk)).toBe(false)
  }, 60_000)
})

describe('a pasted ncryptsec', () => {
  it('is kept as given, never the key it opens to', async () => {
    wipe()
    const { useCyberspace: S } = await reload()
    const sk = generateSecretKey()
    const ncryptsec = nip49.encrypt(sk, PW, LOG_N)
    await S.getState().useLogin(`  ${ncryptsec}\n`, PW)
    expect(S.getState().identity.pubkey).toBe(getPublicKey(sk))
    expect(pref()).toEqual({ kind: 'local', pubkey: getPublicKey(sk), ncryptsec })
    expect(await keyStored(sk)).toBe(false)
  }, 60_000)
})

describe('a reload', () => {
  it('asks for the password once: the wrong one is refused, the right one unlocks, and nothing signs until then', async () => {
    wipe()
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    const ncryptsec = nip49.encrypt(sk, PW, LOG_N)
    // This device's own generated key is there too: it must not stand in.
    const generated = generateSecretKey()
    localStorage.setItem('onosendai:nsec', nip19.nsecEncode(generated))
    localStorage.setItem(PREF, JSON.stringify({ kind: 'local', pubkey: pk, ncryptsec }))
    const { useCyberspace: S } = await reload()

    expect(S.getState().keyLock).toEqual({ mode: 'unlock', pubkey: pk })
    expect(S.getState().identity.pubkey).toBe(pk)
    expect(S.getState().signerKind).toBe('local')
    const waiting = S.getState().signEvent(template(2))
    expect(await pending(waiting)).toBe(true)

    expect(await S.getState().unlockKey('wrong password')).toBe(false)
    expect(S.getState().keyLockError).toBe(WRONG_PASSWORD)
    // One plain message: no timing, no reason beyond the password.
    expect(WRONG_PASSWORD).not.toMatch(/\d|ms|second|time|ncryptsec|invalid/i)
    expect(S.getState().keyLock?.mode).toBe('unlock')
    expect(await pending(waiting)).toBe(true)

    expect(await S.getState().unlockKey(PW)).toBe(true)
    expect(S.getState().keyLock).toBeNull()
    expect(S.getState().keyLockError).toBeNull()
    const signed = await waiting
    expect(signed.pubkey).toBe(pk)
    expect(verifyEvent(signed)).toBe(true)
    expect(S.getState().identity.pubkey).toBe(pk)
    // Still only the ncryptsec on disk, and the export works for the unlocked key.
    expect(pref()).toEqual({ kind: 'local', pubkey: pk, ncryptsec })
    expect(await keyStored(sk)).toBe(false)
    expect(bytesToHex(nip49.decrypt(S.getState().exportKey('backup pass', 'backup pass'), 'backup pass'))).toBe(bytesToHex(sk))
    expect(S.getState().revealKey()).toBe(nip19.nsecEncode(sk))
    expect(await keyStored(sk)).toBe(false)
  }, 60_000)

  it('refuses a stored copy that opens to another key, with the same message', async () => {
    wipe()
    const pk = getPublicKey(generateSecretKey())
    const stranger = nip49.encrypt(generateSecretKey(), PW, LOG_N)
    localStorage.setItem(PREF, JSON.stringify({ kind: 'local', pubkey: pk, ncryptsec: stranger }))
    const { useCyberspace: S } = await reload()
    expect(await S.getState().unlockKey(PW)).toBe(false)
    expect(S.getState().keyLockError).toBe(WRONG_PASSWORD)
    expect(S.getState().keyLock?.mode).toBe('unlock')
  }, 60_000)

  it('another identity can be chosen instead: what waited ends, and the lock goes', async () => {
    wipe()
    const sk = generateSecretKey()
    localStorage.setItem(PREF, JSON.stringify({ kind: 'local', pubkey: getPublicKey(sk), ncryptsec: nip49.encrypt(sk, PW, LOG_N) }))
    const { useCyberspace: S } = await reload()
    const waiting = S.getState().signEvent(template(3))
    await S.getState().useNewKey()
    await expect(waiting).rejects.toThrow(LOCK_ABANDONED)
    expect(S.getState().keyLock).toBeNull()
    expect(S.getState().identity.pubkey).not.toBe(getPublicKey(sk))
  }, 60_000)
})

describe('a brought key saved plain before this', () => {
  it('is asked for a password; set, the plain key leaves storage and the ncryptsec takes its place', async () => {
    wipe()
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    localStorage.setItem('onosendai:nsec', nip19.nsecEncode(generateSecretKey()))
    localStorage.setItem(PREF, JSON.stringify({ kind: 'local', pubkey: pk, nsec: nip19.nsecEncode(sk) }))
    let { useCyberspace: S } = await reload()
    expect(S.getState().keyLock).toEqual({ mode: 'set', pubkey: pk })
    expect(S.getState().identity.pubkey).toBe(pk)
    // It works meanwhile, from memory. The plain copy is still there until
    // answered (which also shows the search finds a key that is stored).
    expect((await S.getState().signEvent(template(4))).pubkey).toBe(pk)
    expect(await keyStored(sk)).toBe(true)

    expect(await S.getState().setKeyPassword(PW, 'something else')).toBe(false)
    expect(S.getState().keyLockError).toBe('The two passwords are different.')
    expect(await S.getState().setKeyPassword(PW, PW)).toBe(true)
    expect(S.getState().keyLock).toBeNull()
    const saved = pref()
    expect(saved?.nsec).toBeUndefined()
    expect(bytesToHex(nip49.decrypt(saved?.ncryptsec as string, PW))).toBe(bytesToHex(sk))
    expect(await keyStored(sk)).toBe(false)

    ;({ useCyberspace: S } = await reload())
    expect(S.getState().keyLock).toEqual({ mode: 'unlock', pubkey: pk })
  }, 60_000)

  it('declined, leaves storage at once and works for this visit; the next asks to log in again', async () => {
    wipe()
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    localStorage.setItem(PREF, JSON.stringify({ kind: 'local', pubkey: pk, nsec: nip19.nsecEncode(sk) }))
    let { useCyberspace: S } = await reload()
    S.getState().skipKeyPassword()
    expect(S.getState().keyLock).toBeNull()
    expect(pref()).toEqual({ kind: 'local', pubkey: pk })
    expect(await keyStored(sk)).toBe(false)
    expect((await S.getState().signEvent(template(5))).pubkey).toBe(pk)

    ;({ useCyberspace: S } = await reload())
    expect(S.getState().keyLock).toEqual({ mode: 'gone', pubkey: pk })
    expect(S.getState().identity.pubkey).toBe(pk)
    const waiting = S.getState().signEvent(template(6))
    expect(await pending(waiting)).toBe(true)
    // Logging in again as the same key, with a password now, signs what waited.
    await S.getState().useLogin(nip19.nsecEncode(sk), PW, PW)
    expect((await waiting).pubkey).toBe(pk)
    expect(S.getState().keyLock).toBeNull()
    expect(typeof pref()?.ncryptsec).toBe('string')
    expect(await keyStored(sk)).toBe(false)
  }, 60_000)
})

describe('the generated key is unchanged', () => {
  it('a new visitor gets a plain local key, asked nothing', async () => {
    wipe()
    const { useCyberspace: S } = await reload()
    expect(S.getState().keyLock).toBeNull()
    expect(S.getState().signerKind).toBe('local')
    const stored = localStorage.getItem('onosendai:nsec') as string
    expect(stored).toMatch(/^nsec1/)
    expect(getPublicKey(nip19.decode(stored).data as Uint8Array)).toBe(S.getState().identity.pubkey)
    expect((await S.getState().signEvent(template(7))).pubkey).toBe(S.getState().identity.pubkey)
  }, 60_000)

  it('NEW RANDOM KEY is saved as before and comes back on reload, asked nothing', async () => {
    wipe()
    let { useCyberspace: S } = await reload()
    await S.getState().useNewKey()
    const pk = S.getState().identity.pubkey
    const saved = pref()
    expect(saved?.kind).toBe('local')
    expect(saved?.pubkey).toBe(pk)
    expect(getPublicKey(nip19.decode(saved?.nsec as string).data as Uint8Array)).toBe(pk)
    ;({ useCyberspace: S } = await reload())
    expect(S.getState().keyLock).toBeNull()
    expect(S.getState().identity.pubkey).toBe(pk)
    expect(pref()?.nsec).toBe(saved?.nsec)
  }, 60_000)

  it('the first key of this device, saved in the pref too, is not taken for a brought one', async () => {
    wipe()
    const first = generateSecretKey()
    localStorage.setItem('onosendai:nsec', nip19.nsecEncode(first))
    localStorage.setItem(PREF, JSON.stringify({ kind: 'local', pubkey: getPublicKey(first), nsec: nip19.nsecEncode(first) }))
    const { useCyberspace: S } = await reload()
    expect(S.getState().keyLock).toBeNull()
    expect(S.getState().identity.pubkey).toBe(getPublicKey(first))
  }, 60_000)
})

describe('bunker and extension logins are unchanged', () => {
  it('prefOf keeps a bunker its client key and an extension its pubkey alone', () => {
    const client = generateSecretKey()
    const pk = getPublicKey(generateSecretKey())
    const bunker = { kind: 'nip46', pubkey: pk, bunkerUri: 'bunker://x?relay=wss://r', clientSecretKey: client, signEvent: async () => { throw new Error('unused') } } as Signer
    expect(prefOf(bunker)).toEqual({ kind: 'nip46', pubkey: pk, bunkerUri: 'bunker://x?relay=wss://r', clientNsec: nip19.nsecEncode(client) })
    const extension = { kind: 'nip07', pubkey: pk, signEvent: async () => { throw new Error('unused') } } as Signer
    expect(prefOf(extension)).toEqual({ kind: 'nip07', pubkey: pk })
  })

  it('a saved bunker or extension loads as itself, asked nothing, its pref as it was', async () => {
    for (const saved of [
      { kind: 'nip07', pubkey: getPublicKey(generateSecretKey()) },
      { kind: 'nip46', pubkey: getPublicKey(generateSecretKey()), bunkerUri: 'bunker://00?relay=wss://127.0.0.1:9', clientNsec: nip19.nsecEncode(generateSecretKey()) },
    ]) {
      wipe()
      localStorage.setItem(PREF, JSON.stringify(saved))
      const { useCyberspace: S } = await reload()
      expect(S.getState().keyLock).toBeNull()
      expect(S.getState().signerKind).toBe(saved.kind)
      expect(S.getState().identity.pubkey).toBe(saved.pubkey)
      expect(pref()).toEqual(saved)
    }
  }, 60_000)
})

describe('review follow-ups', () => {
  it('a pref holding both forms loses the plain one on load', async () => {
    wipe()
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    const ncryptsec = nip49.encrypt(sk, PW, LOG_N)
    localStorage.setItem(PREF, JSON.stringify({ kind: 'local', pubkey: pk, ncryptsec, nsec: nip19.nsecEncode(sk) }))
    const { useCyberspace: S } = await reload()
    expect(S.getState().keyLock?.mode).toBe('unlock')
    expect(pref()).toEqual({ kind: 'local', pubkey: pk, ncryptsec })
    expect(await keyStored(sk)).toBe(false)
    // The encrypted copy can be had while locked, to keep before switching away; never the key.
    expect(S.getState().lockedNcryptsec()).toBe(ncryptsec)
  }, 60_000)

  it('an ncryptsec made with a weaker work factor is sealed again at LOG_N, same password', async () => {
    wipe()
    const { useCyberspace: S } = await reload()
    const sk = generateSecretKey()
    const weak = nip49.encrypt(sk, PW, 10)
    await S.getState().useLogin(weak, PW)
    const kept = pref()?.ncryptsec as string
    expect(kept).not.toBe(weak)
    expect(logNOf(kept)).toBe(LOG_N)
    expect(bytesToHex(nip49.decrypt(kept, PW))).toBe(bytesToHex(sk))
    expect(await keyStored(sk)).toBe(false)
  }, 60_000)

  it('logging in again by ncryptsec as the locked key signs what waited', async () => {
    wipe()
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    localStorage.setItem(PREF, JSON.stringify({ kind: 'local', pubkey: pk }))
    const { useCyberspace: S } = await reload()
    expect(S.getState().keyLock?.mode).toBe('gone')
    const waiting = S.getState().signEvent(template(8))
    await S.getState().useLogin(nip49.encrypt(sk, PW, LOG_N), PW)
    expect((await waiting).pubkey).toBe(pk)
    expect(S.getState().keyLock).toBeNull()
  }, 60_000)

  it('saving a password leaves alone a pref another tab replaced meanwhile', async () => {
    wipe()
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    localStorage.setItem(PREF, JSON.stringify({ kind: 'local', pubkey: pk, nsec: nip19.nsecEncode(sk) }))
    const { useCyberspace: S } = await reload()
    const other = { kind: 'nip07', pubkey: getPublicKey(generateSecretKey()) }
    localStorage.setItem(PREF, JSON.stringify(other))
    expect(await S.getState().setKeyPassword(PW, PW)).toBe(true)
    expect(S.getState().keyLock).toBeNull()
    expect(pref()).toEqual(other)
    expect((await S.getState().signEvent(template(9))).pubkey).toBe(pk)
  }, 60_000)

  it("this device's own generated key, pasted back, stays as it was and is asked nothing", async () => {
    wipe()
    let { useCyberspace: S } = await reload()
    const first = localStorage.getItem('onosendai:nsec') as string
    await S.getState().useNewKey()
    await S.getState().useLogin(first, '', '')
    expect(S.getState().loginError).toBeNull()
    expect(pref()?.nsec).toBe(first)
    ;({ useCyberspace: S } = await reload())
    expect(S.getState().keyLock).toBeNull()
  }, 60_000)

  it('a login still on its way when the key unlocks does not switch away from it', async () => {
    wipe()
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    localStorage.setItem(PREF, JSON.stringify({ kind: 'local', pubkey: pk, ncryptsec: nip49.encrypt(sk, PW, LOG_N) }))
    const g = globalThis as { window?: { nostr?: unknown } }
    const hadWindow = 'window' in g
    let answer: (pk: string) => void = () => {}
    const extSk = generateSecretKey()
    g.window = { nostr: { getPublicKey: () => new Promise<string>((r) => { answer = r }), signEvent: async (t: EventTemplate) => finalizeEvent(t, extSk) } }
    try {
      const { useCyberspace: S } = await reload()
      const extension = S.getState().useExtension()
      expect(await S.getState().unlockKey(PW)).toBe(true)
      answer(getPublicKey(extSk))
      await extension
      expect(S.getState().identity.pubkey).toBe(pk)
      expect(S.getState().signerKind).toBe('local')
    } finally {
      if (!hadWindow) delete g.window
    }
  }, 60_000)
})

describe('a local signer made by hand', () => {
  it('is never written plain by prefOf unless the app generated it', () => {
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    const base = { kind: 'local', pubkey: pk, secretKey: sk, signEvent: async (t: EventTemplate) => finalizeEvent(t, sk) } as unknown as Signer
    expect(prefOf(base)).toEqual({ kind: 'local', pubkey: pk })
    expect(prefOf({ ...base, ncryptsec: 'ncryptsec1x' })).toEqual({ kind: 'local', pubkey: pk, ncryptsec: 'ncryptsec1x' })
    expect(prefOf({ ...base, minted: true })).toEqual({ kind: 'local', pubkey: pk, nsec: nip19.nsecEncode(sk) })
  })
})
