/**
 * goneKeyRepair.test.ts - "Log in again: KEY NOT SAVED ON THIS DEVICE" only when
 * the device really holds no way back to the identity (lib/signerPrefRepair.ts).
 *
 * The owner signs with Amber over NIP-46 and saw the lock (2026-11-22). The one
 * signer pref slot can name a local key with nothing beside it while the
 * identities store still holds that identity's bunker session (or its generated
 * key, or its sealed key). A load is what main.tsx runs: the repair, then the
 * store imported afresh over the same storage. Generated test keys only;
 * nothing touches a network.
 */

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import * as nip49 from 'nostr-tools/nip49'

const PREF = 'onosendai:signer'
const PW = 'correct horse battery'
const BUNKER = 'bunker://' + 'c3'.repeat(32) + '?relay=wss%3A%2F%2Frelay.example'
const pref = (): Record<string, unknown> | null => JSON.parse(localStorage.getItem(PREF) ?? 'null')

/** Rows written as an earlier page would have, before this load. */
async function held(rows: Array<Record<string, unknown> & { pubkey: string }>): Promise<void> {
  vi.resetModules()
  const { recordHeld } = await import('../../lib/identitiesDb')
  for (const row of rows) expect(await recordHeld(row as never, true)).toBe(true)
}

/** A load as main.tsx runs it: the repair, then the store, fresh. */
async function load(waitMs?: number) {
  vi.resetModules()
  const { repairSignerPref } = await import('../../lib/signerPrefRepair')
  const repaired = await repairSignerPref(waitMs)
  const store = await import('../useCyberspace')
  await store.savedChainLoaded()
  return { repaired, S: store.useCyberspace, store }
}

beforeEach(() => {
  localStorage.clear()
  ;(globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory()
})

describe('a pref with no key beside it, while the device holds a way back', () => {
  it('a bunker identity comes back as the bunker: no lock, the session as it was', async () => {
    const pk = getPublicKey(generateSecretKey())
    const client = nip19.nsecEncode(generateSecretKey())
    // The row's kind went 'local' (a load locked as 'gone' wrote it), the session is still there.
    await held([{ pubkey: pk, kind: 'local', bunker: { bunkerUri: BUNKER, clientNsec: client }, lastUsed: 1 }])
    localStorage.setItem(PREF, JSON.stringify({ kind: 'local', pubkey: pk }))
    const { repaired, S } = await load()
    expect(repaired).toBe('bunker')
    expect(pref()).toEqual({ kind: 'nip46', pubkey: pk, bunkerUri: BUNKER, clientNsec: client })
    expect(S.getState().keyLock).toBeNull()
    expect(S.getState().signerKind).toBe('nip46')
    expect(S.getState().identity.pubkey).toBe(pk)
  }, 60_000)

  it('a nostrconnect session keeps its mark', async () => {
    const pk = getPublicKey(generateSecretKey())
    const client = nip19.nsecEncode(generateSecretKey())
    await held([{ pubkey: pk, kind: 'local', bunker: { bunkerUri: BUNKER, clientNsec: client, nostrConnectSession: true } }])
    localStorage.setItem(PREF, JSON.stringify({ kind: 'local', pubkey: pk }))
    const { repaired, S } = await load()
    expect(repaired).toBe('bunker')
    expect(pref()?.nostrConnectSession).toBe(true)
    expect(S.getState().keyLock).toBeNull()
  }, 60_000)

  it('a key this app generated comes back as the generated key: nothing to ask', async () => {
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    await held([{ pubkey: pk, kind: 'local', nsec: nip19.nsecEncode(sk) }])
    localStorage.setItem(PREF, JSON.stringify({ kind: 'local', pubkey: pk }))
    const { repaired, S } = await load()
    expect(repaired).toBe('generated')
    expect(S.getState().keyLock).toBeNull()
    expect(S.getState().generatedKey).toBe(true)
    expect(S.getState().identity.pubkey).toBe(pk)
  }, 60_000)

  it('a key kept sealed here asks for its password, never says it is not saved', async () => {
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    await held([{ pubkey: pk, kind: 'local', ncryptsec: nip49.encrypt(sk, PW, 16) }])
    localStorage.setItem(PREF, JSON.stringify({ kind: 'local', pubkey: pk }))
    const { repaired, S } = await load()
    expect(repaired).toBe('sealed')
    expect(S.getState().keyLock).toEqual({ mode: 'unlock', pubkey: pk })
    expect(await S.getState().unlockKey(PW)).toBe(true)
    expect(S.getState().keyLock).toBeNull()
  }, 60_000)

  it('a session logged out of is not brought back', async () => {
    const pk = getPublicKey(generateSecretKey())
    await held([{ pubkey: pk, kind: 'local', bunker: { bunkerUri: BUNKER } }])
    const { forgetHeldSession } = await import('../../lib/identitiesDb')
    expect(await forgetHeldSession(pk)).toBe(true)
    localStorage.setItem(PREF, JSON.stringify({ kind: 'local', pubkey: pk }))
    const { repaired, S } = await load()
    expect(repaired).toBe('kept')
    expect(S.getState().keyLock).toEqual({ mode: 'gone', pubkey: pk })
  }, 60_000)
})

describe('the lock stays where it is right', () => {
  it('a brought key whose password was declined, and nothing else held: still asked to log in again', async () => {
    const pk = getPublicKey(generateSecretKey())
    await held([{ pubkey: pk, kind: 'local', lastUsed: 1 }])
    localStorage.setItem(PREF, JSON.stringify({ kind: 'local', pubkey: pk }))
    const { repaired, S } = await load()
    expect(repaired).toBe('kept')
    expect(pref()).toEqual({ kind: 'local', pubkey: pk })
    expect(S.getState().keyLock).toEqual({ mode: 'gone', pubkey: pk })
  }, 60_000)

  it('another identity\'s way back is never used', async () => {
    const pk = getPublicKey(generateSecretKey())
    const other = getPublicKey(generateSecretKey())
    await held([{ pubkey: other, kind: 'nip46', bunker: { bunkerUri: BUNKER }, lastUsed: Date.now() }])
    localStorage.setItem(PREF, JSON.stringify({ kind: 'local', pubkey: pk }))
    const { repaired, S } = await load()
    expect(repaired).toBe('kept')
    expect(S.getState().keyLock).toEqual({ mode: 'gone', pubkey: pk })
  }, 60_000)

  it('an identities store that never answers holds the load at most the wait, and changes nothing', async () => {
    const pk = getPublicKey(generateSecretKey())
    localStorage.setItem(PREF, JSON.stringify({ kind: 'local', pubkey: pk }))
    ;(globalThis as { indexedDB: unknown }).indexedDB = { open: () => ({}) }
    vi.resetModules()
    const { repairSignerPref } = await import('../../lib/signerPrefRepair')
    const started = Date.now()
    expect(await repairSignerPref(80)).toBe('kept')
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(pref()).toEqual({ kind: 'local', pubkey: pk })
  })

  it('a bunker, an extension, a sealed or a generated pref is left alone without asking the store', async () => {
    ;(globalThis as { indexedDB: unknown }).indexedDB = { open: () => { throw new Error('asked the store') } }
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    const prefs = [
      { kind: 'nip46', pubkey: pk, bunkerUri: BUNKER },
      { kind: 'nip07', pubkey: pk },
      { kind: 'local', pubkey: pk, ncryptsec: nip49.encrypt(sk, PW, 16) },
    ]
    for (const p of prefs) {
      localStorage.setItem(PREF, JSON.stringify(p))
      vi.resetModules()
      const { repairSignerPref } = await import('../../lib/signerPrefRepair')
      expect(await repairSignerPref(50)).toBe('kept')
      expect(pref()).toEqual(p)
    }
    // The device's first key, plain: marked as generated already.
    localStorage.setItem('onosendai:nsec', nip19.nsecEncode(sk))
    localStorage.setItem(PREF, JSON.stringify({ kind: 'local', pubkey: pk, nsec: nip19.nsecEncode(sk) }))
    vi.resetModules()
    const { repairSignerPref } = await import('../../lib/signerPrefRepair')
    expect(await repairSignerPref(50)).toBe('kept')
  })
})

describe('a plain key the marks do not know as generated', () => {
  it('held as generated: marked, so no password is asked and NOT NOW never ends in the lock', async () => {
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    const nsec = nip19.nsecEncode(sk)
    await held([{ pubkey: pk, kind: 'local', nsec }])
    localStorage.setItem(PREF, JSON.stringify({ kind: 'local', pubkey: pk, nsec }))
    const { repaired, S, store } = await load()
    expect(repaired).toBe('marked')
    expect(localStorage.getItem(store.MINTED_KEY)).toBe(pk)
    expect(localStorage.getItem(store.CHOSEN_KEY)).toBe(pk)
    expect(S.getState().keyLock).toBeNull()
    expect(S.getState().generatedKey).toBe(true)
  }, 60_000)

  it('a brought key, not held as generated: still asked for a password', async () => {
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    await held([{ pubkey: pk, kind: 'local' }])
    localStorage.setItem(PREF, JSON.stringify({ kind: 'local', pubkey: pk, nsec: nip19.nsecEncode(sk) }))
    const { repaired, S } = await load()
    expect(repaired).toBe('kept')
    expect(S.getState().keyLock).toEqual({ mode: 'set', pubkey: pk })
  }, 60_000)
})

describe('the login list', () => {
  it('offers a bunker session as the way back whatever the row\'s last kind, and LOG OUT takes it whatever the kind', async () => {
    const { heldWay } = await import('../../lib/identitiesDb')
    const pk = getPublicKey(generateSecretKey())
    expect(heldWay({ pubkey: pk, kind: 'local', bunker: { bunkerUri: BUNKER }, firstHeld: 0, lastUsed: 0 })).toBe('bunker')
    expect(heldWay({ pubkey: pk, kind: 'local', firstHeld: 0, lastUsed: 0 })).toBeNull()
    expect(heldWay({ pubkey: pk, kind: 'nip46', firstHeld: 0, lastUsed: 0 })).toBe('pair')
    await held([{ pubkey: pk, kind: 'local', bunker: { bunkerUri: BUNKER } }])
    const db = await import('../../lib/identitiesDb')
    expect(await db.forgetHeldSession(pk)).toBe(true)
    expect((await db.readHeld(pk))?.bunker).toBeUndefined()
  })

  it('the marks the repair writes are the store\'s own', async () => {
    vi.resetModules()
    const repair = await import('../../lib/signerPrefRepair')
    const store = await import('../useCyberspace')
    expect(repair.MINTED_KEY).toBe(store.MINTED_KEY)
    expect(repair.CHOSEN_KEY).toBe(store.CHOSEN_KEY)
  }, 60_000)
})
