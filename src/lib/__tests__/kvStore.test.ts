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
  hydrateKv, kvFlush, kvGet, kvKeys, kvMode, kvRemove, kvSaved, kvSet, kvSuperseded, KV_DB, moveOne, MOVED_MARK, movesToKv, resetKvForTests,
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
    for (const k of ['onosendai:shards', 'onosendai:deployments', `onosendai:chain:${ME}`, 'onosendai:seen', 'onosendai:secrets', `onosendai:mutes:${ME}`, 'onosendai:published', 'onosendai:deployments-deleted', 'onosendai:cloudRegionKeys', `onosendai:deployments:${ME}`]) {
      expect(movesToKv(k), k).toBe(true)
    }
    // The region key backstops stay: they are the copy for when IndexedDB fails.
    for (const k of ['onosendai:secrets:bought', 'onosendai:secrets:refused', 'onosendai:secrets:fallback', 'onosendai:nsec', `onosendai:chain-mark:${ME}`, 'onosendai:shards:moved', 'onosendai:live', 'onosendai:calibration', MOVED_MARK]) {
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
    // Kept, it is written where it is read, so its two copies never part.
    kvSet('onosendai:seen', '["a","b","c"]')
    expect(store.getItem('onosendai:seen')).toBe('["a","b","c"]')
    vi.restoreAllMocks()
    resetKvForTests()
    await hydrateKv()
    expect(kvGet('onosendai:seen')).toBe('["a","b","c"]')
    expect(store.getItem('onosendai:seen')).toBeNull()
  })

  it('a copy that reads back different is taken out again, and the next load moves the record whole', async () => {
    store.setItem('onosendai:published', '{"good":1}')
    // The first write lands cut short (a disk that lies).
    const real = IDBObjectStore.prototype.put
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      const v = value as { value?: string; seen?: string }
      if (this.name === 'entries' && typeof v?.value === 'string' && v.seen === undefined) return real.call(this, { ...v, value: v.value.slice(0, 5) }, key)
      return real.call(this, value, key)
    })
    await hydrateKv()
    expect(store.getItem('onosendai:published')).toBe('{"good":1}')
    expect(kvGet('onosendai:published')).toBe('{"good":1}')
    put.mockRestore()
    resetKvForTests()
    await hydrateKv()
    expect(kvGet('onosendai:published')).toBe('{"good":1}')
    expect(store.getItem('onosendai:published')).toBeNull()
  })

  it('two tabs on their first load: the one that moves second never writes its older text over the first one\u2019s', async () => {
    store.setItem('onosendai:published', '{"v":1}')
    await hydrateKv()
    kvSet('onosendai:published', '{"v":2}')
    await kvFlush()
    // The second tab still finds the old text in its localStorage snapshot (it read before the removal).
    const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open(KV_DB); r.onsuccess = () => resolve(r.result) })
    resetKvForTests()
    expect(await moveOne(db, 'onosendai:published', '{"v":1}')).toBe('removed')
    db.close()
    resetKvForTests()
    await hydrateKv()
    expect(kvGet('onosendai:published')).toBe('{"v":2}')
  })

  it('a final write that reads back different never becomes the record, and localStorage keeps its copy', async () => {
    store.setItem('onosendai:published', '{"good":1}')
    const real = IDBObjectStore.prototype.put
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      const v = value as { value?: string; seen?: string }
      if (this.name === 'entries' && typeof v?.seen === 'string') return real.call(this, { ...v, value: 'bad' }, key)
      return real.call(this, value, key)
    })
    await hydrateKv()
    expect(store.getItem('onosendai:published')).toBe('{"good":1}')
    put.mockRestore()
    resetKvForTests()
    await hydrateKv()
    expect(kvGet('onosendai:published')).toBe('{"good":1}')
    expect(store.getItem('onosendai:published')).toBeNull()
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

  it('works with localStorage full, freeing it as it goes, and writes nothing there but the mark', async () => {
    store = quotaStorage(650_000)
    ;(globalThis as { localStorage?: Storage }).localStorage = store
    store.setItem('onosendai:shards', 'a'.repeat(300_000))
    store.setItem('onosendai:deployments', 'b'.repeat(200_000))
    store.setItem(`onosendai:chain:${ME}`, 'c'.repeat(149_000))
    // Full: not even a small write fits.
    expect(() => store.setItem('onosendai:probe', 'y'.repeat(2_000))).toThrow()
    const set = vi.spyOn(store, 'setItem')
    await hydrateKv()
    // Only the one-character mark that says records moved, written once room was made.
    expect(set.mock.calls.every(([k]) => k === MOVED_MARK)).toBe(true)
    expect(store.used()).toBe(MOVED_MARK.length + 1)
    expect(kvGet('onosendai:shards')!.length).toBe(300_000)
    expect(kvGet('onosendai:deployments')!.length).toBe(200_000)
    expect(kvGet(`onosendai:chain:${ME}`)!.length).toBe(149_000)
  })

  it('a record an older build wrote after the move (from an empty read) does not replace the stored one; its text is kept aside', async () => {
    store.setItem(`onosendai:mutes:${ME}`, '["a","b","c"]')
    await hydrateKv()
    kvSet(`onosendai:mutes:${ME}`, '["a","b","c","d"]')
    await kvFlush()
    // A tab of the build before this one reads localStorage empty and writes what it has.
    store.setItem(`onosendai:mutes:${ME}`, '["older tab"]')
    resetKvForTests()
    await hydrateKv()
    expect(kvGet(`onosendai:mutes:${ME}`)).toBe('["a","b","c","d"]')
    expect(store.getItem(`onosendai:mutes:${ME}`)).toBeNull()
    expect((await kvSuperseded()).map((r) => [r.key, r.value])).toEqual([[`onosendai:mutes:${ME}`, '["older tab"]']])
  })
})

describe('a database that does not open', () => {
  /** An open that never answers. */
  function hangOpen(): void {
    vi.spyOn(indexedDB, 'open').mockImplementation(() => ({}) as IDBOpenDBRequest)
  }

  it('before anything moved: the page runs on localStorage as before, and the move waits for the next load', async () => {
    store.setItem('onosendai:published', '{"a":1}')
    hangOpen()
    expect(await hydrateKv(50)).toBe('local')
    expect(kvGet('onosendai:published')).toBe('{"a":1}')
    kvSet('onosendai:published', '{"a":1,"b":2}')
    expect(store.getItem('onosendai:published')).toBe('{"a":1,"b":2}')
    vi.restoreAllMocks()
    resetKvForTests()
    await hydrateKv()
    expect(kvGet('onosendai:published')).toBe('{"a":1,"b":2}')
    expect(store.getItem('onosendai:published')).toBeNull()
  })

  it('after records moved: nothing starts from an empty copy and saves it over them (blind); what it wrote is kept aside', async () => {
    store.setItem('onosendai:seen', '["a","b","c"]')
    await hydrateKv()
    expect(store.getItem(MOVED_MARK)).toBe('1')
    resetKvForTests()
    hangOpen()
    expect(await hydrateKv(50)).toBe('blind')
    // The session reads nothing for it, and writes where it reads.
    expect(kvGet('onosendai:seen')).toBeNull()
    kvSet('onosendai:seen', '["z"]')
    expect(store.getItem('onosendai:seen')).toBe('["z"]')
    vi.restoreAllMocks()
    resetKvForTests()
    await hydrateKv()
    // The stored copy stands; the blind session's text is set aside, not lost.
    expect(kvGet('onosendai:seen')).toBe('["a","b","c"]')
    expect(store.getItem('onosendai:seen')).toBeNull()
    expect((await kvSuperseded()).map((r) => r.value)).toEqual(['["z"]'])
  })

  it('a record first made after the move (never in localStorage) is not written over by a visit without the database', async () => {
    store.setItem('onosendai:seen', '[]')
    await hydrateKv()
    kvSet('onosendai:cloudRegionKeys', '["A","B"]')
    await kvFlush()
    resetKvForTests()
    hangOpen()
    expect(await hydrateKv(50)).toBe('blind')
    kvSet('onosendai:cloudRegionKeys', '["C"]')
    vi.restoreAllMocks()
    resetKvForTests()
    await hydrateKv()
    expect(kvGet('onosendai:cloudRegionKeys')).toBe('["A","B"]')
    expect((await kvSuperseded()).map((r) => [r.key, r.value])).toEqual([['onosendai:cloudRegionKeys', '["C"]']])
  })

  it('an open that answers after the page gave up is closed and changes nothing this session', async () => {
    store.setItem('onosendai:published', '{"a":1}')
    const real = indexedDB.open.bind(indexedDB)
    vi.spyOn(indexedDB, 'open').mockImplementation((...a: Parameters<IDBFactory['open']>) => {
      const req = real(...a)
      const fire = req.onsuccess
      void fire
      return req
    })
    // A wait too short for even a fast open.
    const m = await hydrateKv(0)
    expect(['local', 'idb']).toContain(m)
    await new Promise((r) => setTimeout(r, 50))
    expect(kvMode()).toBe(m)
    if (m === 'local') expect(store.getItem('onosendai:published')).toBe('{"a":1}')
  })
})

describe('a write that fails', () => {
  it('is kept in memory and tried again until it lands', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      await hydrateKv()
      const real = IDBDatabase.prototype.transaction
      let refuse = 2
      vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, ...a: Parameters<IDBDatabase['transaction']>) {
        if (a[1] === 'readwrite' && refuse-- > 0) throw Object.assign(new Error('connection lost'), { name: 'UnknownError' })
        return real.apply(this, a)
      })
      kvSet('onosendai:published', '{"kept":1}')
      expect(await kvFlush()).toBe(false)
      expect(kvSaved()).toBe(false)
      expect(kvGet('onosendai:published')).toBe('{"kept":1}')
      await vi.advanceTimersByTimeAsync(1_100)
      await vi.advanceTimersByTimeAsync(2_100)
      await kvFlush()
      expect(kvSaved()).toBe(true)
      vi.restoreAllMocks()
      resetKvForTests()
      await hydrateKv()
      expect(kvGet('onosendai:published')).toBe('{"kept":1}')
    } finally {
      vi.useRealTimers()
    }
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
    store.setItem('onosendai:secrets', '{"k":1}')
    await hydrateKv()
    const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open(KV_DB); r.onsuccess = () => resolve(r.result) })
    store.setItem('onosendai:secrets', '{"k":1}')
    expect(await moveOne(db, 'onosendai:secrets', '{"k":1}')).toBe('removed')
    expect(store.getItem('onosendai:secrets')).toBeNull()
    expect(await kvSuperseded()).toEqual([])
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

  it('no localStorage.setItem or getItem names a moved key: the modules that keep them go through kvStore', () => {
    const offenders: string[] = []
    const moved = /localStorage\.(setItem|getItem)\(\s*(['`]onosendai:(shards|deployments|chain[:'`]|seen|published|cloudRegionKeys|secrets['`]|mutes|tutorial:stage)[^'`]*['`]|LOCAL_KEY|BARE_KEY|DELETED_KEY|UNCLAIMED_KEY|SEEN_KEY|REGION_KEYS_KEY|STORAGE\b|chainKeyFor|CHAIN_KEY\b|localKey\(|goneKey\(|LEGACY_KEY|keyFor\(|STAGE_PREFIX)/
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
