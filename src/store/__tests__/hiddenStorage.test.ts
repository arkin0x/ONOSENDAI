/**
 * hiddenStorage.test.ts - the record of what you hid and door secrets in IndexedDB.
 * A "page" here is the modules fresh, as a reload leaves them, over one localStorage
 * and one database. The owner hit this on his phone: localStorage full, a live door
 * placed, its record and secret at risk on reload.
 */

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const mem = new Map<string, string>()
  const state = { full: false, failCommit: false, failProbe: false, failAdd: false, hangProbe: false, commitErrors: [] as unknown[], hangCommit: false, slowCommitMs: 0, commits: 0 }
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    get length() { return mem.size },
    key: (i: number) => [...mem.keys()][i] ?? null,
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (state.full) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e }
      mem.set(k, String(v))
    },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
  return { mem, state, events: [] as Array<{ id: string; kind: number; pubkey: string; created_at: number; tags: string[][] }>, sent: [] as number[] }
})

vi.mock('../../lib/relay', () => {
  const answer = async (f: { kinds?: number[]; authors?: string[]; '#d'?: string[] }): Promise<unknown[]> => h.events.filter((e) => (!f.kinds || f.kinds.includes(e.kind)) && (!f.authors || f.authors.includes(e.pubkey)) && (!f['#d'] || f['#d'].includes(e.tags.find((t) => t[0] === 'd')?.[1] ?? '')))
  return {
    publishMany: vi.fn(async (_r: string[], ev: (typeof h.events)[number]) => {
      h.sent.push(ev.kind)
      const d = ev.tags.find((t) => t[0] === 'd')?.[1]
      if (ev.kind >= 30000 && ev.kind < 40000) h.events = h.events.filter((e) => !(e.kind === ev.kind && e.pubkey === ev.pubkey && e.tags.find((t) => t[0] === 'd')?.[1] === d))
      h.events.push(ev)
      return { ok: true }
    }),
    query: vi.fn(answer),
    queryAny: vi.fn((_r: string[], f: Parameters<typeof answer>[0]) => answer(f)),
    queryEach: vi.fn(async (f: Parameters<typeof answer>[0]) => [{ url: 'wss://relay.test', outcome: 'answered', events: await answer(f) }]),
    relaySet: () => ['wss://relay.test'],
  }
})

vi.mock('../../lib/hiddenDb', async (orig) => {
  const real = await orig<typeof import('../../lib/hiddenDb')>()
  return {
    ...real,
    commit: (...a: Parameters<typeof real.commit>) => {
      h.state.commits++
      if (h.state.failCommit) return Promise.reject(new Error('quota'))
      if (h.state.commitErrors.length > 0) return Promise.reject(h.state.commitErrors.shift())
      if (h.state.hangCommit) return new Promise<void>(() => {})
      // Begun at once, in order, and answered late: as a busy browser does.
      if (h.state.slowCommitMs > 0) { const ms = h.state.slowCommitMs; return real.commit(...a).then(() => new Promise<void>((r) => setTimeout(r, ms))) }
      return real.commit(...a)
    },
    probe: (...a: Parameters<typeof real.probe>) => (h.state.hangProbe ? new Promise<void>(() => {}) : h.state.failProbe ? Promise.reject(new Error('private mode')) : real.probe(...a)),
    addMissing: (...a: Parameters<typeof real.addMissing>) => (h.state.failAdd ? Promise.reject(new Error('crash')) : real.addMissing(...a)),
  }
})

const X = 'a1'.repeat(32)
const Y = 'b2'.repeat(32)
const BARE = 'onosendai:deployments'
const SECRETS = 'onosendai:door-secrets'
const CURSOR = { x: (1n << 70n) + 0x1d3c5a7f0n, y: (1n << 60n) + 0x2b0n, z: (1n << 72n) + 0x7e0n }
const tick = (ms = 20): Promise<void> => new Promise((r) => setTimeout(r, ms))

function row(author: string, id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { eventId: id, inner: { id, pubkey: author, kind: 1, created_at: 1, tags: [], content: '' }, bagId: `bag-${id}`, type: 'message', text: 'hello', at: { x: '1', y: '2', z: '3' }, plane: 0, height: 4, lookupId: `l-${id}`, keyHex: '00'.repeat(32), relays: [], createdAt: 1, published: true, ...extra }
}

type Page = Awaited<ReturnType<typeof page>>
let last: { st: { resetHiddenForTests: () => void } } | null = null

/** A page load: the last page gone, the modules fresh, the read before the first draw done. */
async function page(opts: { hydrate?: boolean; keepLast?: boolean } = {}) {
  if (!opts.keepLast) last?.st.resetHiddenForTests()
  vi.resetModules()
  const st = await import('../hiddenStorage')
  const { useShards } = await import('../useShards')
  const { useCyberspace } = await import('../useCyberspace')
  const secrets = await import('../doorSecrets')
  const { useToast } = await import('../useToast')
  const { useWorkshop } = await import('../useWorkshop')
  const rooms = await import('../rooms')
  const chests = await import('../../lib/chests')
  const hidden = await import('../../lib/hidden')
  if (opts.hydrate !== false) await st.hydrateHidden()
  await tick()
  useCyberspace.setState({ live: true, cursor: CURSOR, position: CURSOR, anchor: CURSOR })
  const p = {
    st, useShards, useCyberspace, secrets, useToast, useWorkshop, rooms, chests, hidden,
    me: (): string => useCyberspace.getState().identity.pubkey,
    signIn: (pubkey: string): void => { useCyberspace.setState({ identity: { pubkey, npub: 'n' } }) },
    ids: (): string[] => useShards.getState().mine.map((d) => d.eventId),
    toast: (): string | undefined => useToast.getState().toast?.label,
  }
  last = p
  return p
}

async function sealDoor(p: Page): Promise<{ door: ReturnType<Page['useShards']['getState']>['mine'][number]; lock: ReturnType<Page['chests']['forgeKey']> }> {
  const S = p.useShards.getState
  const lock = p.chests.forgeKey('Silver Key')
  const before = new Set(p.ids())
  S().startPlaceDoor()
  S().setDeployHeight(4)
  S().placeChest()
  await S().sealPlacedChest({ name: 'North Door', lock: { pubkey: lock.itemPubkey, label: lock.name }, requires: 'the Silver Key', contents: [] })
  return { door: S().mine.find((d) => !before.has(d.eventId))!, lock }
}

async function dbRows(): Promise<Array<{ bucket: string; key: string; json: string }>> {
  const { openHiddenDb, readEverything } = await import('../../lib/hiddenDb')
  const d = await openHiddenDb()
  try { return (await readEverything(d)).rows } finally { d.close() }
}

beforeEach(() => {
  last?.st.resetHiddenForTests()
  last = null
  ;(globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory()
  h.mem.clear()
  h.events = []
  h.sent = []
  Object.assign(h.state, { full: false, failCommit: false, failProbe: false, failAdd: false, hangProbe: false, commitErrors: [], hangCommit: false, slowCommitMs: 0, commits: 0 })
  vi.unstubAllGlobals()
})

describe('the case he hit: localStorage full, a live door placed', () => {
  // The file's first test pays the first import of the store's module graph
  // (a cold transform, over 4 s alone, that later page loads do not pay), so
  // under a parallel suite it passed 5 s on the import alone, and the next
  // test failed on a row it left behind. A warm-up in beforeAll is not used: a
  // store loaded there keeps working into the first test's fresh database.
  it('keeps the row and the secret through a reload, with no toast', { timeout: 20_000 }, async () => {
    const p = await page()
    expect(p.st.storageMode()).toBe('indexeddb')
    h.state.full = true
    const { door } = await sealDoor(p)
    expect(p.useShards.getState().deployError).toBeNull()
    expect(p.toast()).not.toBe('NOT SAVED ON THIS DEVICE')
    const secret = p.secrets.doorSecret(p.me(), door.eventId)
    expect(secret).toMatch(/^[0-9a-f]{64}$/)
    await tick()
    const next = await page()
    expect(next.st.storageMode()).toBe('indexeddb')
    expect(next.ids()).toContain(door.eventId)
    expect(next.secrets.doorSecret(next.me(), door.eventId)).toBe(secret)
  })
})

describe('a row that cannot be saved', () => {
  it('says so, stays in hand, and is written with the next save', async () => {
    const p = await page()
    p.signIn(X)
    h.state.failCommit = true
    expect(await p.st.saveRows(X, [row(X, 'x1') as never], JSON.stringify, () => false)).toBe(false)
    expect((await dbRows()).length).toBe(0)
    h.state.failCommit = false
    expect(await p.st.saveRows(X, [row(X, 'x1') as never, row(X, 'x2') as never], JSON.stringify, () => false)).toBe(true)
    expect((await dbRows()).map((r) => r.key).sort()).toEqual(['x1', 'x2'])
  })

  it('a deploy whose row cannot be saved shows the toast', async () => {
    const p = await page()
    const { door } = await sealDoor(p)
    expect(door).toBeDefined()
    h.state.failCommit = true
    await p.useShards.getState().deleteInstance(door.eventId).catch(() => {})
    await vi.waitFor(() => expect(p.toast()).toBe('NOT SAVED ON THIS DEVICE'))
  })
})

describe('a door\'s secret comes first', () => {
  it('a secret that cannot be written publishes nothing, and says so', async () => {
    const p = await page()
    h.state.failCommit = true
    const before = h.sent.length
    const S = p.useShards.getState
    const lock = p.chests.forgeKey('Silver Key')
    S().startPlaceDoor()
    S().setDeployHeight(4)
    S().placeChest()
    await S().sealPlacedChest({ name: 'North Door', lock: { pubkey: lock.itemPubkey, label: lock.name }, requires: 'the Silver Key', contents: [] })
    expect(h.sent.length).toBe(before)
    expect(S().deployStatus).toBe('error')
    expect(S().deployError).toContain('could not save the door')
    expect(p.ids()).toEqual([])
  })

  it('the secret is on disk by the time the door reaches a relay', async () => {
    const p = await page()
    const relay = await import('../../lib/relay')
    let heldAtPublish: Array<{ doorId: string }> = []
    const real = vi.mocked(relay.publishMany).getMockImplementation()!
    vi.mocked(relay.publishMany).mockImplementation(async (...a) => {
      const { openHiddenDb, readEverything } = await import('../../lib/hiddenDb')
      const d = await openHiddenDb()
      heldAtPublish = (await readEverything(d)).secrets
      d.close()
      return real(...a)
    })
    const { door } = await sealDoor(p)
    vi.mocked(relay.publishMany).mockImplementation(real)
    expect(heldAtPublish.map((s) => s.doorId)).toContain(door.eventId)
  })

  it('with no database, a secret that cannot be written publishes nothing too', async () => {
    h.state.failProbe = true
    const p = await page()
    h.state.full = true
    const { door } = await sealDoor(p)
    expect(door).toBeUndefined()
    expect(h.sent).toEqual([])
    expect(p.useShards.getState().deployError).toContain('could not save the door')
  })
})

describe('the move', () => {
  const seed = (rows: unknown[], secrets: unknown = {}): void => { h.mem.set(BARE, JSON.stringify(rows)); h.mem.set(SECRETS, JSON.stringify(secrets)) }

  it('copies each row to its owner and each secret, read back, and leaves localStorage byte for byte', async () => {
    seed([row(X, 'x1'), row(Y, 'y1'), row(X, 'x2')], { [X]: { d1: 'a'.repeat(64) } })
    const bare = h.mem.get(BARE); const sec = h.mem.get(SECRETS)
    const p = await page()
    expect(p.st.storageMode()).toBe('indexeddb')
    p.signIn(X)
    expect(p.ids()).toEqual(['x1', 'x2'])
    expect(p.secrets.doorSecret(X, 'd1')).toBe('a'.repeat(64))
    expect((await dbRows()).filter((r) => r.bucket === Y).map((r) => r.key)).toEqual(['y1'])
    await tick()
    expect(h.mem.get(BARE)).toBe(bare)
    expect(h.mem.get(SECRETS)).toBe(sec)
  })

  it('never writes the old values again, on a save, a delete or a new secret', async () => {
    seed([row(X, 'x1', { published: false })], { [X]: { d1: 'a'.repeat(64) } })
    const bare = h.mem.get(BARE); const sec = h.mem.get(SECRETS)
    const p = await page()
    p.signIn(X)
    await p.useShards.getState().deleteInstance('x1')
    await p.secrets.commitDoorSecret(X, 'd2', 'b'.repeat(64))
    expect(h.mem.get(BARE)).toBe(bare)
    expect(h.mem.get(SECRETS)).toBe(sec)
    const next = await page()
    next.signIn(X)
    expect(next.ids()).toEqual([])
    expect(next.secrets.doorSecret(X, 'd2')).toBe('b'.repeat(64))
  })

  it('a crash mid-move leaves the old list in use and nothing half-done, and the next load finishes it, once', async () => {
    seed([row(X, 'x1'), row(X, 'x2')])
    h.state.failAdd = true
    const p = await page()
    expect(p.st.storageMode()).toBe('local')
    p.signIn(X)
    expect(p.ids()).toEqual(['x1', 'x2'])
    expect(await dbRows()).toEqual([])
    h.state.failAdd = false
    const next = await page()
    expect(next.st.storageMode()).toBe('indexeddb')
    next.signIn(X)
    expect(next.ids()).toEqual(['x1', 'x2'])
    const again = await page()
    again.signIn(X)
    expect(again.ids()).toEqual(['x1', 'x2'])
    expect((await dbRows()).length).toBe(2)
  })

  it('two tabs moving at once add each row once', async () => {
    seed([row(X, 'x1'), row(X, 'x2')])
    const a = await page({ hydrate: false })
    const b = await page({ hydrate: false, keepLast: true })
    await Promise.all([a.st.hydrateHidden(), b.st.hydrateHidden()])
    expect((await dbRows()).length).toBe(2)
    a.st.resetHiddenForTests()
  })

  it('keeps corrupt rows, lists none of them, and a save keeps them', async () => {
    const bad = row(X, 'bad', { type: 'shard', text: undefined, shard: { unit: 0.5, vertices: [], faces: [] } })
    seed([row(X, 'x1'), bad, { junk: true }, row(X, 'nothing', { text: undefined })])
    const p = await page()
    p.signIn(X)
    expect(p.ids()).toEqual(['x1'])
    await p.secrets.commitDoorSecret(X, 'd', 'c'.repeat(64))
    p.useShards.getState().addDiscovered([])
    await tick()
    const rows = await dbRows()
    expect(rows.filter((r) => r.bucket === X).map((r) => r.key).sort()).toEqual(['bad', 'x1'])
    expect(rows.filter((r) => r.bucket === p.st.UNCLAIMED).length).toBe(2)
  })
})

describe('a stale tab of an older build', () => {
  it('adds the rows it wrote since, by id, without overwriting, and what was deleted here stays deleted', async () => {
    h.mem.set(BARE, JSON.stringify([row(X, 'x1', { text: 'first' }), row(X, 'gone', { published: false })]))
    const p = await page()
    p.signIn(X)
    await p.useShards.getState().deleteInstance('gone')
    await tick()
    // The old build writes its whole list: an edit, the deleted row again, and a new one.
    h.mem.set(BARE, JSON.stringify([row(X, 'x1', { text: 'stale edit' }), row(X, 'gone', { published: false }), row(X, 'new')]))
    const next = await page()
    next.signIn(X)
    expect(next.ids()).toEqual(['x1', 'new'])
    expect(next.useShards.getState().mine[0].text).toBe('first')
  })
})

describe('two tabs', () => {
  it('a row saved in one reaches the other, and a save there keeps it', async () => {
    h.mem.set(BARE, JSON.stringify([row(X, 'x1')]))
    const a = await page()
    const b = await page({ keepLast: true })
    a.signIn(X); b.signIn(X)
    a.useShards.getState().addDiscovered([])
    const { useShards: A } = a
    const fresh = row(X, 'from-a') as never
    A.setState({ mine: [...A.getState().mine, fresh] })
    await a.st.saveRows(X, A.getState().mine, JSON.stringify, () => false)
    await vi.waitFor(() => expect(b.ids()).toContain('from-a'))
    await b.st.saveRows(X, [...b.useShards.getState().mine, row(X, 'from-b') as never], JSON.stringify, () => false)
    await vi.waitFor(() => expect(a.ids()).toContain('from-b'))
    expect((await dbRows()).filter((r) => r.bucket === X).map((r) => r.key).sort()).toEqual(['from-a', 'from-b', 'x1'])
    a.st.resetHiddenForTests()
  })
})

describe('what a stored row costs in memory', () => {
  // arkinox's spot, seeded (2026-11-18): every row's JSON was kept beside the row, 25 MB for 120 hides.
  it('a row is held with a short signature of its JSON, never the JSON', async () => {
    const big = row(X, 'big', { text: 'x'.repeat(200_000) })
    h.mem.set(BARE, JSON.stringify([big]))
    const p = await page()
    p.signIn(X)
    const [e] = p.st.entriesIn(X)
    expect(e.row?.eventId).toBe('big')
    expect(Object.keys(e).sort()).toEqual(['key', 'row', 'seq', 'sig'])
    expect(e.sig.length).toBeLessThan(40)
    expect(e.sig).toBe(p.st.sigOf(JSON.stringify(big)))
  })

  it('a save writes the rows that changed and none that did not, by signature', async () => {
    h.mem.set(BARE, JSON.stringify([row(X, 'a1'), row(X, 'a2')]))
    const p = await page()
    p.signIn(X)
    const rows = (): Array<Record<string, unknown>> => p.st.entriesIn(X).map((e) => e.row as never)
    const written: string[] = []
    const stored = (d: object): string => { written.push((d as { eventId: string }).eventId); return JSON.stringify(d) }
    // Rows read back from the database, saved as they are: nothing serialized twice, nothing written.
    const loaded = rows()
    for (const [i, e] of p.st.entriesIn(X).entries()) p.st.noteStored(loaded[i] as never, e.sig)
    expect(await p.st.saveRows(X, loaded as never, stored, () => false)).toBe(true)
    expect(written).toEqual([])
    // One character changed: that row, and only that row, goes to the database.
    const changed = [loaded[0], { ...loaded[1], text: 'hellO' }]
    await p.st.saveRows(X, changed as never, stored, () => false)
    expect(written).toEqual(['a2'])
    expect((await dbRows()).find((r) => r.key === 'a2')?.json).toContain('hellO')
  })

  it('tells apart JSON that differs in one character, or only in length', () => {
    return import('../hiddenStorage').then(({ sigOf }) => {
      const a = JSON.stringify(row(X, 'a', { text: 'abc' }))
      expect(sigOf(a)).toBe(sigOf(String(a)))
      expect(sigOf(a)).not.toBe(sigOf(a.replace('abc', 'abd')))
      expect(sigOf('ab')).not.toBe(sigOf('ba'))
      expect(sigOf('a')).not.toBe(sigOf('a ' ))
    })
  })
})

describe('a switch mid-write', () => {
  it('a door sealed by P that finishes after a switch lands on P\'s list, never Q\'s', async () => {
    const p = await page()
    const relay = await import('../../lib/relay')
    const P = p.me()
    const real = vi.mocked(relay.publishMany).getMockImplementation()!
    let release = (): void => {}
    const gate = new Promise<void>((r) => { release = r })
    let reached = (): void => {}
    const at = new Promise<void>((r) => { reached = r })
    vi.mocked(relay.publishMany).mockImplementation(async (...a) => { reached(); await gate; return real(...a) })
    const sealing = sealDoor(p)
    await at
    p.signIn(Y)
    release()
    await sealing
    vi.mocked(relay.publishMany).mockImplementation(real)
    await tick()
    expect(p.ids()).toEqual([])
    const rows = await dbRows()
    expect(rows.filter((r) => r.bucket === Y)).toEqual([])
    expect(rows.filter((r) => r.bucket === P).length).toBe(1)
  })
})

describe('work begun before a switch', () => {
  it('is not signed by the next identity: a hide reaching its bag after the switch sends nothing', async () => {
    const p = await page()
    const relay = await import('../../lib/relay')
    const real = vi.mocked(relay.queryEach).getMockImplementation()!
    let release = (): void => {}
    const gate = new Promise<void>((r) => { release = r })
    vi.mocked(relay.queryEach).mockImplementation(async (...a) => { await gate; return real(...a) })
    const sealing = sealDoor(p).catch(() => undefined)
    await tick()
    const before = h.sent.length
    p.signIn(Y)
    release()
    await sealing
    vi.mocked(relay.queryEach).mockImplementation(real)
    expect(h.sent.length).toBe(before)
    expect(p.ids()).toEqual([])
    expect((await dbRows()).filter((r) => r.bucket === Y)).toEqual([])
  })
})

describe('a database that hangs', () => {
  it('leaves the session on localStorage after 15 s, and saves are answered', async () => {
    h.state.hangProbe = true
    const p = await page({ hydrate: false })
    const mode = await p.st.hydrateHidden()
    expect(mode).toBe('local')
    expect(await p.st.saveRows(X, [row(X, 'x1') as never], JSON.stringify, () => false)).toBe(true)
  }, 20_000)
})

describe('with no database', () => {
  it('a failed probe keeps the old path, each identity\'s list its own, with what differs under its own key', async () => {
    h.mem.set(BARE, JSON.stringify([row(X, 'x1'), row(Y, 'y1')]))
    const frozen = h.mem.get(BARE)
    h.state.failProbe = true
    const p = await page()
    expect(p.st.storageMode()).toBe('local')
    p.signIn(X)
    expect(p.ids()).toEqual(['x1'])
    await p.useShards.getState().deleteInstance('x1').catch(() => {})
    await tick()
    expect(h.mem.get(BARE)).toBe(frozen)
    const next = await page()
    next.signIn(X)
    expect(next.ids()).toEqual([])
    next.signIn(Y)
    expect(next.ids()).toEqual(['y1'])
  })

  it('what a session without the database saved joins the database at the next load', async () => {
    h.state.failProbe = true
    const p = await page()
    await sealDoor(p)
    await tick()
    const me = p.me()
    const id = p.ids()[0]
    const secret = p.secrets.doorSecret(me, id)
    h.state.failProbe = false
    const next = await page()
    expect(next.st.storageMode()).toBe('indexeddb')
    expect(next.ids()).toEqual([id])
    expect(next.secrets.doorSecret(me, id)).toBe(secret)
  })
})

describe('rolling back', () => {
  it('the old code finds this identity\'s rows and secrets again, and only its own', async () => {
    h.mem.set(BARE, JSON.stringify([row(X, 'x1')]))
    const p = await page()
    p.signIn(X)
    const fresh = row(X, 'after-move') as never
    await p.st.saveRows(X, [...p.useShards.getState().mine, fresh], JSON.stringify, () => false)
    await p.st.saveRows(Y, [row(Y, 'theirs') as never], JSON.stringify, () => false)
    await p.secrets.commitDoorSecret(X, 'd', 'c'.repeat(64))
    const { rollbackMineToBare } = await import('../mineRollback')
    expect(await rollbackMineToBare(X)).toBe(true)
    expect(await rollbackMineToBare(X)).toBe(true)
    expect((JSON.parse(h.mem.get(BARE)!) as Array<{ eventId: string }>).map((d) => d.eventId)).toEqual(['x1', 'after-move'])
    expect(JSON.parse(h.mem.get(SECRETS)!)[X].d).toBe('c'.repeat(64))
    // And forward again: nothing lost, nothing twice.
    const next = await page()
    next.signIn(X)
    expect(next.ids()).toEqual(['x1', 'after-move'])
  })

  it('says so when localStorage has no room', async () => {
    const p = await page()
    p.signIn(X)
    await p.st.saveRows(X, [row(X, 'x1') as never], JSON.stringify, () => false)
    h.state.full = true
    const { rollbackMineToBare } = await import('../mineRollback')
    expect(await rollbackMineToBare(X)).toBe(false)
  })
})

describe('recovery: a LIVE door whose row was lost', () => {
  it('comes back on a rescan, and opening it with its key relearns the secret', async () => {
    const p = await page()
    const { door, lock } = await sealDoor(p)
    const me = p.me()
    const secret = p.secrets.doorSecret(me, door.eventId)!
    const outer = h.events.find((e) => e.kind === p.hidden.HIDDEN_KIND && e.id === door.bagId)
    expect(outer).toBeDefined()
    // Everything this device knew about it, gone.
    p.st.resetHiddenForTests()
    await new Promise<void>((r) => { const q = indexedDB.deleteDatabase(p.st.HIDDEN_DB); q.onsuccess = () => r(); q.onerror = () => r(); q.onblocked = () => r() })
    const next = await page()
    expect(next.ids()).toEqual([])
    expect(next.secrets.doorSecret(me, door.eventId)).toBeNull()
    // The rescan: the bag, opened with the region key anyone standing there derives.
    const hiddenLib = next.hidden
    const found = await hiddenLib.unbag(outer as never, Uint8Array.from(Buffer.from(door.keyHex, 'hex')))
    next.useShards.getState().addDiscovered(found)
    expect(next.ids()).toEqual([door.eventId])
    const row2 = next.useShards.getState().mine[0]
    expect(row2.chest?.door).toBe(4)
    expect(next.secrets.doorSecret(me, door.eventId)).toBeNull()
    // Opening it with the key it is locked to.
    const { doorSecretWithKey } = await import('../../lib/doors')
    const learned = doorSecretWithKey(row2.chest!, lock.secretHex)
    expect(learned).toBe(secret)
    next.rooms.openDoorNow(found.find((f) => f.eventId === door.eventId)!, learned!)
    await vi.waitFor(() => expect(next.secrets.doorSecret(me, door.eventId)).toBe(secret))
    await tick()
    const after = await page()
    expect(after.secrets.doorSecret(me, door.eventId)).toBe(secret)
    expect(after.ids()).toEqual([door.eventId])
  })
})

/**
 * The owner saw NOT SAVED ON THIS DEVICE, "no room left", on a phone using 327 MB
 * of a 2 GB quota (2026-11-22). Every way a save can fail, and what it says.
 */
describe('why a save did not land: the toast says the real cause', () => {
  const err = (name: string): DOMException => new DOMException(`the browser said ${name}`, name)
  const meta = (p: Page): string | undefined => p.useToast.getState().toast?.meta
  async function failedDelete(p: Page, arrange: () => void): Promise<void> {
    const { door } = await sealDoor(p)
    arrange()
    await p.useShards.getState().deleteInstance(door.eventId).catch(() => {})
  }

  it('says no room only for a real QuotaExceededError', async () => {
    const p = await page()
    const { NOT_SAVED_WHY } = await import('../useShards')
    await failedDelete(p, () => { h.state.commitErrors = [err('QuotaExceededError'), err('QuotaExceededError')] })
    await vi.waitFor(() => expect(meta(p)).toBe(NOT_SAVED_WHY.full))
  })

  it('never says no room for any other refusal, and tries it once more at once', async () => {
    const p = await page()
    const { NOT_SAVED_WHY } = await import('../useShards')
    await failedDelete(p, () => { h.state.commits = 0; h.state.commitErrors = [err('UnknownError'), err('UnknownError')] })
    await vi.waitFor(() => expect(meta(p)).toBe(NOT_SAVED_WHY.refused))
    expect(meta(p)).not.toMatch(/no room/)
    expect(h.state.commits).toBeGreaterThanOrEqual(2)
  })

  it('a connection the browser closed is opened again and the write lands, with nothing said', async () => {
    const p = await page()
    p.signIn(X)
    h.state.commitErrors = [err('InvalidStateError')]
    expect(await p.st.saveRows(X, [row(X, 'x1') as never], JSON.stringify, () => false)).toBe(true)
    expect((await dbRows()).map((r) => r.key)).toEqual(['x1'])
    await failedDelete(p, () => { h.state.commitErrors = [err('AbortError')] })
    await tick(50)
    expect(p.toast()).not.toBe('NOT SAVED ON THIS DEVICE')
  })

  it('a write that is only slow, and lands, says nothing', async () => {
    const p = await page()
    p.st.setSaveTimingForTests({ commitMs: 30, lateMs: 2_000, retryMs: [] })
    // Through a delete: no toast.
    await failedDelete(p, () => { h.state.slowCommitMs = 150 })
    await tick(400)
    expect(p.toast()).not.toBe('NOT SAVED ON THIS DEVICE')
    p.signIn(X)
    h.state.slowCommitMs = 150
    const r = await p.st.saveRowsResult(X, [row(X, 'x1') as never], JSON.stringify, () => false)
    expect(r).toMatchObject({ ok: false, trouble: 'slow' })
    expect(await r.late).toBeNull()
    expect((await dbRows()).map((x) => x.key)).toEqual(['x1'])
    // Landed late: nothing is left in hand to write again.
    h.state.commits = 0
    expect(await p.st.saveRows(X, [row(X, 'x1') as never], JSON.stringify, () => false)).toBe(true)
    expect(h.state.commits).toBe(0)
  })

  it('a newer save of the same row while a slow write runs is kept, and written after the slow one lands', async () => {
    const p = await page()
    p.signIn(X)
    p.st.setSaveTimingForTests({ commitMs: 30, lateMs: 2_000, retryMs: [] })
    h.state.slowCommitMs = 200
    const first = await p.st.saveRowsResult(X, [row(X, 'x1', { text: 'first' }) as never], JSON.stringify, () => false)
    expect(first.trouble).toBe('slow')
    h.state.slowCommitMs = 0
    // The newer one waits behind the slow transaction, and is a change of its own.
    const second = p.st.saveRows(X, [row(X, 'x1', { text: 'second' }) as never], JSON.stringify, () => false)
    expect(await first.late).toBeNull()
    expect(await second).toBe(true)
    const rows = await dbRows()
    expect(rows.map((r) => (JSON.parse(r.json) as { text: string }).text)).toEqual(['second'])
  })

  it('a slow write that then fails says nothing when a retry already wrote all of it', async () => {
    const p = await page()
    p.signIn(X)
    p.st.setSaveTimingForTests({ commitMs: 30, lateMs: 400, retryMs: [] })
    h.state.hangCommit = true
    const r = await p.st.saveRowsResult(X, [row(X, 'x1') as never], JSON.stringify, () => false)
    expect(r.trouble).toBe('slow')
    h.state.hangCommit = false
    // The next save writes what was in hand, the slow one's change with it.
    expect(await p.st.saveRows(X, [row(X, 'x1') as never], JSON.stringify, () => false)).toBe(true)
    expect(await r.late).toBeNull()
    expect((await dbRows()).map((x) => x.key)).toEqual(['x1'])
  })

  it('a slow write that fails while its retry is still in flight waits for the retry: told when the retry fails too', async () => {
    const p = await page()
    p.signIn(X)
    p.st.setSaveTimingForTests({ commitMs: 30, lateMs: 60, retryMs: [] })
    h.state.hangCommit = true
    const r = await p.st.saveRowsResult(X, [row(X, 'x1') as never], JSON.stringify, () => false)
    expect(r.trouble).toBe('slow')
    // A retry in flight that will fail for lack of space.
    h.state.hangCommit = false
    h.state.commitErrors = [err('QuotaExceededError')]
    const retry = p.st.saveRows(X, [row(X, 'x1') as never], JSON.stringify, () => false)
    expect(await r.late).not.toBeNull()
    expect(await retry).toBe(false)
  })

  it('a door secret that cannot be written says why, and asks for space only when the device is full', async () => {
    const p = await page()
    const ds = await import('../doorSecrets')
    h.state.commitErrors = [err('UnknownError'), err('UnknownError')]
    await expect(ds.commitDoorSecret(X, 'door-a', 'c'.repeat(64))).rejects.toThrow(ds.SECRET_NOT_SENT.refused)
    h.state.commitErrors = [err('QuotaExceededError')]
    await expect(ds.commitDoorSecret(X, 'door-b', 'c'.repeat(64))).rejects.toThrow(ds.SECRET_NOT_SENT.full)
    h.state.commitErrors = [err('UnknownError'), err('UnknownError')]
    ds.keepDoorSecret(X, 'door-c', 'd'.repeat(64))
    await vi.waitFor(() => expect(meta(p)).toBe(ds.SECRET_NOT_KEPT.refused))
    for (const [why, words] of [...Object.entries(ds.SECRET_NOT_KEPT), ...Object.entries(ds.SECRET_NOT_SENT)]) {
      expect(words).not.toMatch(/\u2014/)
      expect(/free some space/i.test(words)).toBe(why === 'full')
    }
  })

  it('a write that never lands says the storage did not answer, not that it is full', async () => {
    const p = await page()
    const { NOT_SAVED_WHY } = await import('../useShards')
    await failedDelete(p, () => { p.st.setSaveTimingForTests({ commitMs: 30, lateMs: 60, retryMs: [] }); h.state.hangCommit = true })
    await vi.waitFor(() => expect(meta(p)).toBe(NOT_SAVED_WHY.slow))
  })

  it('a database that did not open in time is slow, not full', async () => {
    const p = await page()
    expect(await p.st.troubleOf(new Error('IndexedDB did not open in time'), 'indexeddb')).toBe('slow')
    expect(await p.st.troubleOf(new Error('IndexedDB did not answer in time'), 'indexeddb')).toBe('slow')
  })

  it('a failed write is tried again by itself, without another save', async () => {
    const p = await page()
    p.signIn(X)
    p.st.setSaveTimingForTests({ retryMs: [40] })
    h.state.commitErrors = [err('UnknownError'), err('UnknownError')]
    expect(await p.st.saveRows(X, [row(X, 'x1') as never], JSON.stringify, () => false)).toBe(false)
    await vi.waitFor(async () => expect((await dbRows()).map((r) => r.key)).toEqual(['x1']))
  })

  describe('on localStorage, because the database did not open at load', () => {
    async function localFull(estimate?: { usage: number; quota: number }): Promise<string | undefined> {
      vi.stubGlobal('navigator', estimate ? { storage: { estimate: async () => estimate } } : {})
      h.state.failProbe = true
      const p = await page()
      expect(p.st.storageMode()).toBe('local')
      p.signIn(X)
      h.state.full = true
      const r = await p.st.saveRowsResult(X, [row(X, 'x1') as never], JSON.stringify, () => false)
      expect(r.ok).toBe(false)
      return r.trouble
    }
    it('localStorage full while the device has room: a reload fixes it, not "no room"', async () => {
      expect(await localFull({ usage: 327e6, quota: 2e9 })).toBe('fallback')
    })
    it('localStorage full and the device nearly full too: no room', async () => {
      expect(await localFull({ usage: 1_999e6, quota: 2e9 })).toBe('full')
    })
    it('localStorage full and no estimate to ask: no room, as before', async () => {
      expect(await localFull()).toBe('full')
    })
  })

  it('every reason is plain words: no em dashes, and only a full device says no room', async () => {
    await page()
    const { NOT_SAVED_WHY } = await import('../useShards')
    for (const [why, words] of Object.entries(NOT_SAVED_WHY)) {
      expect(words).not.toMatch(/—/)
      expect(/no room/.test(words)).toBe(why === 'full')
    }
  })
})

describe('a hidden tab does not read what another tab wrote until it is shown', () => {
  it('holds no read open while hidden (a frozen tab would hold the other tab\'s write), and reads it once shown', async () => {
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as 'visible' | 'hidden' })
    vi.stubGlobal('document', doc)
    const a = await page()
    const b = await page({ keepLast: true })
    a.signIn(X); b.signIn(X)
    doc.visibilityState = 'hidden'
    await a.st.saveRows(X, [row(X, 'from-a') as never], JSON.stringify, () => false)
    await tick(100)
    expect(b.st.entriesIn(X).map((e) => e.row?.eventId)).not.toContain('from-a')
    doc.visibilityState = 'visible'
    doc.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(b.st.entriesIn(X).map((e) => e.row?.eventId)).toContain('from-a'))
    a.st.resetHiddenForTests()
  })
})
