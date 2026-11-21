/**
 * kvStore.test.ts: the records that lived in localStorage move into IndexedDB
 * and are never lost on the way (arkinox, 2026-11-19 and 2026-11-21: "we
 * really need to ship that localstorage migration so it gets migrated into
 * indexeddb").
 *
 * Each record is written to the database, read back and compared, and only
 * then removed from localStorage. An interrupted move resumes; a full
 * localStorage frees space as it goes; a record an older build wrote after
 * the move wins and the copy it replaces is kept; reads prefer the database
 * and fall back to localStorage. No network.
 */
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fingerprint, hydrateKv, kvFlush, kvGet, kvKeys, kvMode, kvRemove, kvSet, kvSuperseded, KV_DB, moveOne, movesToKv, resetKvForTests,
} from '../kvStore'

/** A localStorage with a quota, in characters, as a phone's is: a write past it throws. */
function quotaStorage(quota: number): Storage & { used: () => number } {
  const m = new Map<string, string>()
  const used = (): number => [...m].reduce((n, [k, v]) => n + k.length + v.length, 0)
  return {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => {
      const next = used() - (m.has(k) ? k.length + m.get(k)!.length : 0) + k.length + String(v).length
      if (next > quota) { const e = new Error('The quota has been exceeded.'); e.name = 'QuotaExceededError'; throw e }
      m.set(k, String(v))
    },
    used,
  }
}

const ME = 'a'.repeat(64)
const BIG = 'x'.repeat(200_000)

let store: ReturnType<typeof quotaStorage>
beforeEach(() => {
  resetKvForTests()
  ;(globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory()
  store = quotaStorage(1_000_000)
  ;(globalThis as { localStorage?: Storage }).localStorage = store
})
afterEach(() => { resetKvForTests(); vi.restoreAllMocks() })

describe('which records move', () => {
  it('the owner’s big three and the rest of his top list, by name or per identity; small switches stay', () => {
    for (const k of ['onosendai:shards', 'onosendai:deployments', `onosendai:chain:${ME}`, 'onosendai:seen', 'onosendai:secrets', 'onosendai:secrets:bought', `onosendai:mutes:${ME}`, 'onosendai:published', 'onosendai:deployments-deleted', 'onosendai:cloudRegionKeys', `onosendai:deployments:${ME}`]) {
      expect(movesToKv(k), k).toBe(true)
    }
    for (const k of ['onosendai:nsec', `onosendai:chain-mark:${ME}`, 'onosendai:shards:moved', 'onosendai:live', 'onosendai:calibration']) {
      expect(movesToKv(k), k).toBe(false)
    }
  })
})

describe('the move', () => {
  it('copies, verifies and only then removes each record; reads then come from the database', async () => {
    store.setItem('onosendai:shards', BIG)
    store.setItem(`onosendai:chain:${ME}`, '{"version":2,"events":[]}')
    store.setItem('onosendai:nsec', 'nsec1stays')
    expect(await hydrateKv()).toBe('idb')
    expect(store.getItem('onosendai:shards')).toBeNull()
    expect(store.getItem(`onosendai:chain:${ME}`)).toBeNull()
    // A device switch stays where it was.
    expect(store.getItem('onosendai:nsec')).toBe('nsec1stays')
    expect(kvGet('onosendai:shards')).toBe(BIG)
    expect(kvGet(`onosendai:chain:${ME}`)).toBe('{"version":2,"events":[]}')
    // In the database, for the next load.
    resetKvForTests()
    expect(await hydrateKv()).toBe('idb')
    expect(kvGet('onosendai:shards')).toBe(BIG)
  })

  it('a copy that does not read back the same is not removed, and is read from localStorage', async () => {
    store.setItem('onosendai:seen', '["a","b"]')
    // The database refuses every write.
    const real = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (this.name === 'entries') throw Object.assign(new Error('disk full'), { name: 'QuotaExceededError' })
      return real.call(this, value, key)
    })
    await hydrateKv()
    expect(store.getItem('onosendai:seen')).toBe('["a","b"]')
    expect(kvGet('onosendai:seen')).toBe('["a","b"]')
  })

  it('resumes when interrupted after the copy and before the removal: the next load only removes it', async () => {
    store.setItem('onosendai:published', '{"x":1}')
    // The removal never happens this load (the tab closed at that moment).
    const remove = vi.spyOn(store, 'removeItem').mockImplementation(() => { throw new Error('closed') })
    await hydrateKv()
    expect(store.getItem('onosendai:published')).toBe('{"x":1}')
    remove.mockRestore()
    resetKvForTests()
    await hydrateKv()
    expect(store.getItem('onosendai:published')).toBeNull()
    expect(kvGet('onosendai:published')).toBe('{"x":1}')
    expect(await kvSuperseded()).toEqual([])
  })

  it('resumes when interrupted before the copy committed: it is copied again, nothing lost', async () => {
    store.setItem('onosendai:cloudRegionKeys', '[1,2,3]')
    // The first load dies before its transaction commits: nothing reaches the database.
    const real = IDBDatabase.prototype.transaction
    const tx = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, ...a: Parameters<IDBDatabase['transaction']>) {
      if (a[1] === 'readwrite') throw new Error('tab closed')
      return real.apply(this, a)
    })
    await hydrateKv()
    expect(store.getItem('onosendai:cloudRegionKeys')).toBe('[1,2,3]')
    tx.mockRestore()
    resetKvForTests()
    await hydrateKv()
    expect(store.getItem('onosendai:cloudRegionKeys')).toBeNull()
    expect(kvGet('onosendai:cloudRegionKeys')).toBe('[1,2,3]')
  })

  it('works with localStorage full, freeing it as it goes, and never writes localStorage', async () => {
    store = quotaStorage(650_000)
    ;(globalThis as { localStorage?: Storage }).localStorage = store
    store.setItem('onosendai:shards', 'a'.repeat(300_000))
    store.setItem('onosendai:deployments', 'b'.repeat(200_000))
    store.setItem(`onosendai:chain:${ME}`, 'c'.repeat(149_000))
    // Full: not even a small write fits.
    expect(() => store.setItem('onosendai:probe', 'y'.repeat(2_000))).toThrow()
    const set = vi.spyOn(store, 'setItem')
    await hydrateKv()
    expect(set).not.toHaveBeenCalled()
    expect(store.used()).toBe(0)
    expect(kvGet('onosendai:shards')!.length).toBe(300_000)
    expect(kvGet('onosendai:deployments')!.length).toBe(200_000)
    expect(kvGet(`onosendai:chain:${ME}`)!.length).toBe(149_000)
  })

  it('a record an older build wrote after the move is the newer one, and the copy it replaces is kept', async () => {
    store.setItem(`onosendai:mutes:${ME}`, '["old"]')
    await hydrateKv()
    kvSet(`onosendai:mutes:${ME}`, '["mine"]')
    await kvFlush()
    // A tab of the build before this one writes localStorage again.
    store.setItem(`onosendai:mutes:${ME}`, '["older tab"]')
    resetKvForTests()
    await hydrateKv()
    expect(kvGet(`onosendai:mutes:${ME}`)).toBe('["older tab"]')
    expect(store.getItem(`onosendai:mutes:${ME}`)).toBeNull()
    expect((await kvSuperseded()).map((r) => [r.key, r.value])).toEqual([[`onosendai:mutes:${ME}`, '["mine"]']])
  })
})

describe('reading and writing', () => {
  it('writes go to the database and never to localStorage; a removal removes from both', async () => {
    await hydrateKv()
    const set = vi.spyOn(store, 'setItem')
    kvSet('onosendai:seen', '["z"]')
    expect(kvGet('onosendai:seen')).toBe('["z"]')
    expect(await kvFlush()).toBe(true)
    expect(set).not.toHaveBeenCalled()
    resetKvForTests()
    await hydrateKv()
    expect(kvGet('onosendai:seen')).toBe('["z"]')
    kvRemove('onosendai:seen')
    await kvFlush()
    resetKvForTests()
    await hydrateKv()
    expect(kvGet('onosendai:seen')).toBeNull()
  })

  it('lists records by prefix in either store', async () => {
    store.setItem(`onosendai:deployments:${ME}`, '[]')
    await hydrateKv()
    kvSet('onosendai:deployments:unclaimed-like', '[]')
    expect(kvKeys('onosendai:deployments:').sort()).toEqual([`onosendai:deployments:${ME}`, 'onosendai:deployments:unclaimed-like'].sort())
  })

  it('before the database is read (unit tests, a page without IndexedDB) it is localStorage, exactly', () => {
    expect(kvMode()).toBe('pending')
    kvSet('onosendai:seen', '["p"]')
    expect(store.getItem('onosendai:seen')).toBe('["p"]')
    expect(kvGet('onosendai:seen')).toBe('["p"]')
  })

  it('moveOne is idempotent on a verified record', async () => {
    store.setItem('onosendai:secrets:bought', '{"k":1}')
    await hydrateKv()
    const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open(KV_DB); r.onsuccess = () => resolve(r.result) })
    store.setItem('onosendai:secrets:bought', '{"k":1}')
    expect(await moveOne(db, 'onosendai:secrets:bought', '{"k":1}')).toBe('removed')
    expect(fingerprint('{"k":1}')).toBe(fingerprint('{"k":1}'))
    db.close()
  })
})

describe('nothing writes a moved record to localStorage again', () => {
  // Every file of the app (tests aside): a moved record is written through lib/kvStore.ts only.
  const SRC = join(__dirname, '..', '..')
  const files: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) { if (name !== '__tests__') walk(p) } else if (/\.(ts|tsx)$/.test(name)) files.push(p)
    }
  }
  walk(SRC)

  it('no localStorage.setItem names a moved key, and the modules that keep them read through kvStore', () => {
    const offenders: string[] = []
    const moved = /localStorage\.setItem\(\s*(['`]onosendai:(shards|deployments|chain|seen|published|cloudRegionKeys|secrets|mutes)[^'`]*['`]|LOCAL_KEY|BARE_KEY|DELETED_KEY|UNCLAIMED_KEY|SEEN_KEY|REGION_KEYS_KEY|STORAGE\b|chainKeyFor|CHAIN_KEY|localKey\(|goneKey\(|BOUGHT_KEY|REFUSED_KEY|FALLBACK_KEY|LEGACY_KEY|keyFor\()/
    for (const f of files) {
      // mineRollback.ts is for a revert only, imported by nothing: it writes the old list back for the old code on purpose.
      if (f.endsWith('mineRollback.ts')) continue
      const text = readFileSync(f, 'utf8')
      for (const line of text.split('\n')) if (moved.test(line)) offenders.push(`${f.slice(SRC.length + 1)}: ${line.trim()}`)
    }
    // Constants of the same name for other, small records: STORAGE in useRelays.ts and the palettes, SEEN_KEY in useNotifications.ts (a time, per identity).
    expect(offenders.filter((o) => !/useRelays\.ts|useWorkshop\.ts|useNotifications\.ts/.test(o))).toEqual([])
  })
})
