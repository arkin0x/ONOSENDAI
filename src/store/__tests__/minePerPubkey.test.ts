/**
 * minePerPubkey.test.ts - YOURS is the signed-in identity's list. The bare
 * `onosendai:deployments` key was shared by every identity on a device, so an
 * in-app switch showed the next identity the last one's hidden things as its
 * own, with DELETE. Each identity now has its own key, the bare list moves to
 * the owners its records prove, and no row is ever dropped on the way.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

/** sessionStorage, which node lacks: the journal's fallback when localStorage has no room. */
const sessionStore = new Map<string, string>()
let sessionRefuses = false
;(globalThis as { sessionStorage?: unknown }).sessionStorage = {
  getItem: (k: string) => sessionStore.get(k) ?? null,
  setItem: (k: string, v: string) => { if (sessionRefuses) throw new Error('QuotaExceededError'); sessionStore.set(k, v) },
  removeItem: (k: string) => { sessionStore.delete(k) },
}

let relayBags: unknown[] = []
/** How a bag read goes: a relay answers with relayBags, or none can be reached. */
let relayAnswers: 'answered' | 'unreachable' = 'answered'
const sent: { kind: number }[] = []
/** When set, a bag or a retraction waits here on its way to the relays, after its signature. */
let held: { reached: () => void; until: Promise<void> } | null = null
vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async (_relays: string[], ev: { kind: number }) => {
    if ((ev.kind === 33330 || ev.kind === 5) && held) { held.reached(); await held.until }
    sent.push(ev)
    return { ok: true }
  }),
  query: vi.fn(async () => relayBags),
  queryEach: vi.fn(async () => (relayAnswers === 'answered'
    ? [{ url: 'wss://relay.test', outcome: 'answered', events: relayBags }]
    : [{ url: 'wss://relay.test', outcome: 'unreachable', reason: 'test', events: [] }])),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { newShard, type ShardModel } from 'sno-core/shards'
import { bytesToHex } from '../../lib/events'
import { bagTemplate, type Reference } from '../../lib/hidden'
import { regionKeyAt } from '../../lib/shardCrypto'
import { useCyberspace } from '../useCyberspace'
import { useShards, type MyDeployment } from '../useShards'
import { useWorkshop } from '../useWorkshop'
import { rollbackMineToBare } from '../mineRollback'
import { useToast } from '../useToast'

const BARE = 'onosendai:deployments'
const UNCLAIMED = 'onosendai:deployments-unclaimed'
const keyOf = (pubkey: string): string => `${BARE}:${pubkey}`
const stored = (key: string): MyDeployment[] => JSON.parse(localStorage.getItem(key) ?? '[]') as MyDeployment[]
const ids = (rows: MyDeployment[]): string[] => rows.map((d) => d.eventId)
const signIn = (pubkey: string): void => { useCyberspace.setState({ identity: { pubkey, npub: `npub-${pubkey.slice(0, 4)}` } }) }

const X = 'a1'.repeat(32)
const Y = 'b2'.repeat(32)
const Z = 'c3'.repeat(32)
const at = { x: 90_000n, y: 4_000n, z: 71n }
const HEIGHT = 5
const rk = regionKeyAt(at, HEIGHT, 20)

/** A row as this device's own deploy saved it: a message, whose inner event names who placed it. */
function row(author: string, id: string, extra: Partial<MyDeployment> = {}): MyDeployment {
  return {
    eventId: id, inner: { id, pubkey: author, kind: 1, created_at: 1, tags: [], content: '' }, bagId: `bag-${id}`, type: 'message', text: 'hello',
    at: { x: '1', y: '2', z: '3' }, plane: 0, height: HEIGHT, lookupId: rk.lookupId, keyHex: bytesToHex(rk.key), relays: [], createdAt: 1, published: true, ...extra,
  } as MyDeployment
}

/** A row hidden by reference: its inner event is the object's author's, who need not be whoever placed it. */
function refRow(author: string, id: string): MyDeployment {
  const ref: Reference = ['a', `33331:${author}:thing-${id}`, 'wss://relay.test', 'c'.repeat(64)]
  return row(author, id, { ref, type: 'shard', text: undefined, shard: newShard(`shard ${id}`) })
}

function bagBy(sk: Uint8Array, ...entries: Reference[]): Promise<unknown> {
  return bagTemplate(entries, rk.key, rk.lookupId, HEIGHT, 2_000_000_000).then((tpl) => finalizeEvent(tpl, sk))
}

/** Hold what is sent to the relays. `reached` is when something got there; `release` lets it go. */
function holdRelays(): { reached: Promise<void>; release: () => void } {
  let release = (): void => {}
  let arrive = (): void => {}
  const until = new Promise<void>((resolve) => { release = resolve })
  const reached = new Promise<void>((resolve) => { arrive = resolve })
  held = { reached: arrive, until }
  return { reached, release }
}

let home = ''

beforeAll(async () => {
  // useShards starts following the identity as soon as useCyberspace has loaded.
  await new Promise((resolve) => setTimeout(resolve, 20))
})

beforeEach(() => {
  home ||= useCyberspace.getState().identity.pubkey
  sessionStore.clear()
  sessionRefuses = false
  relayBags = []
  relayAnswers = 'answered'
  sent.length = 0
  held = null
  localStorage.clear()
  useCyberspace.setState({ identity: { pubkey: home, npub: 'npub-home' }, live: true })
  useShards.setState({ mine: [], deleted: {}, deletedBags: {}, discovered: {}, pending: null, selectedSecret: null, deployHeight: 0, deployUnit: 0, deployStatus: 'idle', deployError: null })
})

describe('switching identity', () => {
  it("never shows the next identity the last one's rows, and brings them back", () => {
    localStorage.setItem(keyOf(X), JSON.stringify([row(X, 'x1')]))
    localStorage.setItem(keyOf(Y), JSON.stringify([row(Y, 'y1')]))
    signIn(X)
    expect(ids(useShards.getState().mine)).toEqual(['x1'])
    signIn(Y)
    expect(ids(useShards.getState().mine)).toEqual(['y1'])
    expect(useShards.getState().worldItems().filter((w) => w.mine).map((w) => w.key)).toEqual(['y1'])
    signIn(X)
    expect(ids(useShards.getState().mine)).toEqual(['x1'])
  })

  it('saves under the identity signed in, leaving the other list alone', () => {
    localStorage.setItem(keyOf(X), JSON.stringify([row(X, 'x1')]))
    signIn(Y)
    expect(useShards.getState().mine).toEqual([])
    useShards.setState({ deleted: { gone: true } })
    useShards.getState().addDiscovered([])
    expect(ids(stored(keyOf(X)))).toEqual(['x1'])
  })

  it("closes a card open on the last identity's row, and only that", () => {
    localStorage.setItem(keyOf(X), JSON.stringify([row(X, 'x1')]))
    signIn(X)
    useShards.setState({ selectedSecret: 'x1' })
    signIn(Y)
    expect(useShards.getState().selectedSecret).toBeNull()
    useShards.setState({ selectedSecret: 'a find' })
    signIn(X)
    expect(useShards.getState().selectedSecret).toBe('a find')
  })

  it('puts a deploy that finishes after the switch on the list of whoever hid it', async () => {
    const shard: ShardModel = { ...newShard('held'), unit: 1, vertices: Array.from({ length: 3 }, (_, i) => ({ p: [i % 16, Math.floor(i / 16) % 16, Math.floor(i / 256)] as [number, number, number], c: [1, 1, 1] as [number, number, number] })), faces: [[0, 1, 2]] }
    useWorkshop.setState({ shards: [shard], currentId: shard.id })
    localStorage.setItem(keyOf(Y), JSON.stringify([row(Y, 'y1')]))
    const relays = holdRelays()
    useShards.getState().startDeployShard(shard.id)
    const deploying = useShards.getState().deploy()
    await relays.reached
    signIn(Y)
    relays.release()
    await deploying
    expect(ids(useShards.getState().mine)).toEqual(['y1'])
    expect(ids(stored(keyOf(Y)))).toEqual(['y1'])
    expect(stored(keyOf(home))).toHaveLength(1)
  })

  it('takes a delete that finishes after the switch off the list it came from', async () => {
    localStorage.setItem(keyOf(home), JSON.stringify([row(home, 'h1', { lookupId: 'elsewhere' }), row(home, 'h2')]))
    localStorage.setItem(keyOf(Y), JSON.stringify([row(Y, 'y1')]))
    signIn(Y)
    signIn(home)
    const relays = holdRelays()
    const deleting = useShards.getState().deleteInstance('h2')
    await relays.reached
    signIn(Y)
    relays.release()
    await deleting
    expect(ids(useShards.getState().mine)).toEqual(['y1'])
    expect(ids(stored(keyOf(Y)))).toEqual(['y1'])
    expect(ids(stored(keyOf(home)))).toEqual(['h1'])
  })
})

describe('moving the bare list to its owners', () => {
  it('hands each row to the identity its record proves, and empties the bare key', () => {
    localStorage.setItem(BARE, JSON.stringify([row(X, 'x1'), row(Y, 'y1'), row(X, 'x2')]))
    signIn(X)
    expect(ids(useShards.getState().mine)).toEqual(['x1', 'x2'])
    expect(ids(stored(keyOf(X)))).toEqual(['x1', 'x2'])
    expect(ids(stored(keyOf(Y)))).toEqual(['y1'])
    expect(localStorage.getItem(BARE)).toBeNull()
  })

  it('moves rows of an identity that is not here today too', () => {
    localStorage.setItem(BARE, JSON.stringify([row(Z, 'z1')]))
    signIn(X)
    expect(useShards.getState().mine).toEqual([])
    expect(ids(stored(keyOf(Z)))).toEqual(['z1'])
  })

  it('never loses a row: anything unproven or malformed is kept, unshown', () => {
    const odd = [{ eventId: 'no inner' }, { inner: { pubkey: X } }, row('not-hex', 'odd1'), refRow(X, 'ref1')]
    const list = [row(X, 'x1'), ...odd]
    localStorage.setItem(BARE, JSON.stringify(list))
    signIn(X)
    expect(ids(useShards.getState().mine)).toEqual(['x1'])
    expect(stored(UNCLAIMED)).toEqual(odd.map((d) => JSON.parse(JSON.stringify(d))))
    expect(stored(keyOf(X)).length + stored(UNCLAIMED).length).toBe(list.length)
  })

  it('leaves a bare value that is not a list where it is', () => {
    localStorage.setItem(BARE, '{not json')
    signIn(X)
    expect(localStorage.getItem(BARE)).toBe('{not json')
    expect(useShards.getState().mine).toEqual([])
  })

  it("keeps a row the owner already has as the owner's copy", () => {
    localStorage.setItem(keyOf(X), JSON.stringify([row(X, 'x1', { text: 'newer' })]))
    localStorage.setItem(BARE, JSON.stringify([row(X, 'x1', { text: 'stale tab' }), row(X, 'x2')]))
    signIn(X)
    expect(useShards.getState().mine.map((d) => d.text)).toEqual(['newer', 'hello'])
  })

  it('does not bring back what was deleted, when a stale tab writes the bare list again', () => {
    localStorage.setItem('onosendai:deployments-deleted', JSON.stringify(['x1']))
    localStorage.setItem(BARE, JSON.stringify([row(X, 'x1')]))
    signIn(X)
    expect(useShards.getState().mine).toEqual([])
    expect(ids(stored(UNCLAIMED))).toEqual(['x1'])
  })

  it('loses nothing when storage is full: the bare list stays, its owner still sees their rows, and the next load finishes', () => {
    const list = JSON.stringify([row(X, 'x1'), row(Y, 'y1')])
    localStorage.setItem(BARE, list)
    const full = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError') })
    signIn(X)
    full.mockRestore()
    expect(localStorage.getItem(BARE)).toBe(list)
    expect(ids(useShards.getState().mine)).toEqual(['x1'])
    signIn(Y)
    expect(ids(useShards.getState().mine)).toEqual(['y1'])
    expect(localStorage.getItem(BARE)).toBeNull()
    expect(ids(stored(keyOf(X)))).toEqual(['x1'])
  })

  it('keeps hidden audio across a reload', () => {
    const audio = { title: 't', about: '', url: 'https://x/y', mime: 'audio/mpeg', hash: 'ab'.repeat(32) }
    localStorage.setItem(keyOf(X), JSON.stringify([row(X, 'a1', { type: 'audio', text: undefined, audio } as Partial<MyDeployment>)]))
    signIn(X)
    expect(ids(useShards.getState().mine)).toEqual(['a1'])
  })
})

describe('a page load', () => {
  it('reads the list of the identity it starts as, whichever store loads first', async () => {
    vi.resetModules()
    const first = await import('../useCyberspace')
    const pubkey = first.useCyberspace.getState().identity.pubkey
    localStorage.setItem(BARE, JSON.stringify([row(pubkey, 'p1'), row(X, 'x1')]))
    vi.resetModules()
    // useCyberspace first: it reaches useShards through lib/destinationKeys, so useShards loads inside it.
    const cyber = await import('../useCyberspace')
    const shards = await import('../useShards')
    expect(cyber.useCyberspace.getState().identity.pubkey).toBe(pubkey)
    await vi.waitFor(() => expect(ids(shards.useShards.getState().mine)).toEqual(['p1']))
    vi.resetModules()
  })
})

describe('rows hidden by reference', () => {
  const sk = generateSecretKey()
  const OWNER = getPublicKey(sk)

  it("are not handed to the object's author on its word: someone else may have placed it", async () => {
    localStorage.setItem(BARE, JSON.stringify([refRow(X, 'r1')]))
    signIn(X)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(useShards.getState().mine).toEqual([])
    expect(ids(stored(UNCLAIMED))).toEqual(['r1'])
  })

  it('go to the identity whose own bag names them, even for another author\'s object', async () => {
    const d = refRow(X, 'r1')
    relayBags = [await bagBy(sk, d.ref as Reference)]
    localStorage.setItem(BARE, JSON.stringify([d, refRow(X, 'r2')]))
    signIn(OWNER)
    await vi.waitFor(() => expect(ids(useShards.getState().mine)).toEqual(['r1']))
    expect(ids(stored(keyOf(OWNER)))).toEqual(['r1'])
    expect(ids(stored(UNCLAIMED))).toEqual(['r2'])
  })

  it("stay unclaimed when the answer is someone else's bag", async () => {
    const d = refRow(X, 'r1')
    relayBags = [await bagBy(generateSecretKey(), d.ref as Reference)]
    localStorage.setItem(BARE, JSON.stringify([d]))
    signIn(OWNER)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(useShards.getState().mine).toEqual([])
    expect(ids(stored(UNCLAIMED))).toEqual(['r1'])
  })

  it('stay unclaimed when no relay answers, and are asked about again', async () => {
    const d = refRow(X, 'r1')
    localStorage.setItem(BARE, JSON.stringify([d]))
    const { query } = await import('../../lib/relay')
    vi.mocked(query).mockRejectedValueOnce(new Error('offline'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    signIn(OWNER)
    await vi.waitFor(() => expect(warn).toHaveBeenCalled())
    warn.mockRestore()
    expect(ids(stored(UNCLAIMED))).toEqual(['r1'])
    relayBags = [await bagBy(sk, d.ref as Reference)]
    signIn(X)
    signIn(OWNER)
    await vi.waitFor(() => expect(ids(useShards.getState().mine)).toEqual(['r1']))
  })

  it('are never claimed once deleted here', async () => {
    const d = refRow(X, 'r1')
    relayBags = [await bagBy(sk, d.ref as Reference)]
    localStorage.setItem('onosendai:deployments-deleted', JSON.stringify(['r1']))
    localStorage.setItem(UNCLAIMED, JSON.stringify([d]))
    signIn(OWNER)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(useShards.getState().mine).toEqual([])
    expect(ids(stored(UNCLAIMED))).toEqual(['r1'])
  })
})

const SK = generateSecretKey()
const OWNER = getPublicKey(SK)
const tick = (ms = 30): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const everywhere = (id: string): string[] => [BARE, UNCLAIMED, keyOf(OWNER), keyOf(X), keyOf(Y), keyOf(home)].filter((k) => stored(k).some((d) => d?.eventId === id))
/** Storage with a total size, counted over the keys these tests use. */
function capStorage(cap: number): { restore: () => void } {
  const real = localStorage.setItem.bind(localStorage)
  const total = (): number => [BARE, UNCLAIMED, keyOf(OWNER), keyOf(X), keyOf(Y), keyOf(home)].reduce((n, k) => n + (localStorage.getItem(k) ?? '').length, 0)
  const spy = vi.spyOn(localStorage, 'setItem').mockImplementation((k: string, v: string) => {
    if (total() - (localStorage.getItem(k) ?? '').length + String(v).length > cap) throw new Error('QuotaExceededError')
    real(k, v)
  })
  return { restore: () => spy.mockRestore() }
}
const aShard = (): ShardModel => ({ ...newShard('new'), unit: 1, vertices: Array.from({ length: 3 }, (_, i) => ({ p: [i % 16, Math.floor(i / 16) % 16, Math.floor(i / 256)] as [number, number, number], c: [1, 1, 1] as [number, number, number] })), faces: [[0, 1, 2]] })
async function deployAShard(): Promise<void> {
  const shard = aShard()
  useWorkshop.setState({ shards: [shard], currentId: shard.id })
  useShards.getState().startDeployShard(shard.id)
  await useShards.getState().deploy()
}

const notSaved = (): boolean => useToast.getState().toast?.label === 'NOT SAVED'
const onAnyKey = (id: string): boolean => [BARE, UNCLAIMED, keyOf(X)].some((k) => stored(k).some((d) => d?.eventId === id))

describe('a full disk', () => {
  beforeEach(() => { useToast.setState({ toast: null }) })

  it('a claim the owner key cannot take leaves the row unclaimed, and says so', async () => {
    const d = refRow(X, 'r1')
    relayBags = [await bagBy(SK, d.ref as Reference)]
    localStorage.setItem(UNCLAIMED, JSON.stringify([d]))
    const real = localStorage.setItem.bind(localStorage)
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation((k: string, v: string) => {
      if (k === keyOf(OWNER)) throw new Error('QuotaExceededError')
      real(k, v)
    })
    signIn(OWNER)
    await vi.waitFor(() => expect(ids(useShards.getState().mine)).toEqual(['r1']))
    await tick()
    spy.mockRestore()
    expect(everywhere('r1')).toEqual([UNCLAIMED])
    expect(notSaved()).toBe(true)
    signIn(Y)
    relayBags = []
    signIn(OWNER)
    await tick()
    expect(everywhere('r1')).toEqual([UNCLAIMED])
  })

  it('a bare list over half of free storage still moves, and rows hidden afterwards survive a reload', async () => {
    localStorage.setItem(BARE, JSON.stringify([row(home, 'x-big', { text: 'a'.repeat(60_000) })]))
    const cap = capStorage(100_000) // the old code fits: one key rewritten in place
    signIn(Y); signIn(home)
    expect(ids(useShards.getState().mine)).toEqual(['x-big'])
    expect(localStorage.getItem(BARE)).toBeNull()
    await deployAShard()
    const fresh = ids(useShards.getState().mine).filter((id) => id !== 'x-big')
    expect(fresh).toHaveLength(1)
    signIn(Y); signIn(home)
    cap.restore()
    expect(ids(useShards.getState().mine)).toContain(fresh[0])
    expect(notSaved()).toBe(false)
  })

  it('moves many rows a row at a time, losing none, when a second copy of the list will not fit', () => {
    const list = Array.from({ length: 12 }, (_, i) => row(i % 2 ? X : Y, `m${i}`, { text: 'a'.repeat(5_000) }))
    localStorage.setItem(BARE, JSON.stringify(list))
    const cap = capStorage(70_000)
    signIn(X)
    cap.restore()
    expect(localStorage.getItem(BARE)).toBeNull()
    expect(stored(keyOf(X)).length + stored(keyOf(Y)).length).toBe(12)
  })

  it('a row that fits nowhere stays on the bare list, in order, and still shows', () => {
    const list = [row(X, 'small'), row(X, 'huge', { text: 'a'.repeat(50_000) })]
    localStorage.setItem(BARE, JSON.stringify(list))
    const cap = capStorage(50_400)
    signIn(X)
    cap.restore()
    expect(ids(useShards.getState().mine).sort()).toEqual(['huge', 'small'])
    expect([...everywhere('huge'), ...everywhere('small')].length).toBeGreaterThanOrEqual(2)
  })

  it('with no journal possible, a row stuck on the bare list costs new rows nothing', async () => {
    sessionRefuses = true
    localStorage.setItem(BARE, JSON.stringify([row(home, 'x-big', { text: 'a'.repeat(60_000) })]))
    const cap = capStorage(100_000)
    signIn(Y); signIn(home)
    expect(localStorage.getItem(BARE)).not.toBeNull()
    await deployAShard()
    const fresh = ids(useShards.getState().mine).filter((id) => id !== 'x-big')
    expect(fresh).toHaveLength(1)
    expect(notSaved()).toBe(false)
    signIn(Y); signIn(home)
    cap.restore()
    expect(ids(useShards.getState().mine).sort()).toEqual([...fresh, 'x-big'].sort())
  })

  it('a save that fails says so where it shows, with the bar closed too', async () => {
    signIn(Y); signIn(home)
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError') })
    await deployAShard()
    spy.mockRestore()
    expect(notSaved()).toBe(true)
  })
})

describe('a row between two keys', () => {
  const MOVING = 'onosendai:deployments-moving'
  /** storage that takes `refuse`'s keys and sizes no longer. Also records the journal at every write. */
  function strict(refuse: (k: string, v: string) => boolean): { restore: () => void; states: boolean[] } {
    const real = localStorage.setItem.bind(localStorage)
    const realRm = localStorage.removeItem.bind(localStorage)
    const states: boolean[] = []
    const holds = (): boolean => onAnyKey('big') || (localStorage.getItem(MOVING) ?? '').includes('"big"') || (sessionStore.get(MOVING) ?? '').includes('"big"')
    const a = vi.spyOn(localStorage, 'setItem').mockImplementation((k: string, v: string) => {
      if (refuse(k, v)) throw new Error('QuotaExceededError')
      real(k, v); states.push(holds())
    })
    const b = vi.spyOn(localStorage, 'removeItem').mockImplementation((k: string) => { realRm(k); states.push(holds()) })
    return { restore: () => { a.mockRestore(); b.mockRestore() }, states }
  }
  const big = row(X, 'big', { text: 'a'.repeat(60_000) })
  const size = (): number => (localStorage.getItem(BARE) ?? '').length + (localStorage.getItem(keyOf(X)) ?? '').length + (localStorage.getItem(MOVING) ?? '').length

  it('is in the journal at every step, and nothing is left there once it lands', () => {
    localStorage.setItem(BARE, JSON.stringify([big]))
    const s = strict((k, v) => size() - (localStorage.getItem(k) ?? '').length + v.length > 100_000)
    signIn(X)
    s.restore()
    expect(s.states.length).toBeGreaterThan(0)
    expect(s.states.every(Boolean)).toBe(true)
    expect(ids(stored(keyOf(X)))).toEqual(['big'])
    expect(localStorage.getItem(BARE)).toBeNull()
    expect(localStorage.getItem(MOVING)).toBeNull()
    expect(sessionStore.has(MOVING)).toBe(false)
  })

  it('uses sessionStorage when localStorage has no room for the journal', () => {
    localStorage.setItem(BARE, JSON.stringify([big]))
    let journalled = false
    const realSet = (globalThis as unknown as { sessionStorage: { setItem: (k: string, v: string) => void } }).sessionStorage.setItem
    ;(globalThis as unknown as { sessionStorage: { setItem: (k: string, v: string) => void } }).sessionStorage.setItem = (k, v) => { journalled = true; realSet(k, v) }
    const s = strict((k, v) => k === MOVING || size() - (localStorage.getItem(k) ?? '').length + v.length > 100_000)
    signIn(X)
    s.restore()
    ;(globalThis as unknown as { sessionStorage: { setItem: (k: string, v: string) => void } }).sessionStorage.setItem = realSet
    expect(journalled).toBe(true)
    expect(s.states.every(Boolean)).toBe(true)
    expect(ids(stored(keyOf(X)))).toEqual(['big'])
    expect(sessionStore.has(MOVING)).toBe(false)
  })

  it('stays on the bare list when no journal can be written', () => {
    localStorage.setItem(BARE, JSON.stringify([big]))
    sessionRefuses = true
    const before = localStorage.getItem(BARE)
    const s = strict((k) => k === MOVING || k === keyOf(X))
    signIn(X)
    s.restore()
    expect(localStorage.getItem(BARE)).toBe(before)
    expect(ids(useShards.getState().mine)).toEqual(['big'])
  })

  it('a failed take-back leaves it in the journal, and the next load restores it', () => {
    localStorage.setItem(BARE, JSON.stringify([big]))
    const s = strict((k, v) => k === keyOf(X) || (k === BARE && v.includes('"big"')))
    signIn(X)
    s.restore()
    expect(localStorage.getItem(BARE)).toBeNull()
    expect(localStorage.getItem(MOVING)).toContain('"big"')
    signIn(Y); signIn(X)
    expect(ids(useShards.getState().mine)).toEqual(['big'])
    expect(localStorage.getItem(MOVING)).toBeNull()
    expect(localStorage.getItem(BARE)).toBeNull()
  })

  it('a leftover whose write had landed comes out once, with the bare list otherwise intact', () => {
    localStorage.setItem(keyOf(X), JSON.stringify([big]))
    localStorage.setItem(BARE, JSON.stringify([row(X, 'other')]))
    localStorage.setItem(MOVING, JSON.stringify(big))
    signIn(X)
    expect(ids(useShards.getState().mine).sort()).toEqual(['big', 'other'])
    expect(stored(keyOf(X)).filter((d) => d.eventId === 'big')).toHaveLength(1)
    expect(localStorage.getItem(MOVING)).toBeNull()
  })
})

describe('a public bag when no relay answered', () => {
  const lostBag = (): void => {
    localStorage.setItem(BARE, JSON.stringify([row(home, 'm1'), refRow(home, 'A')]))
    signIn(Y); signIn(home)
  }
  beforeEach(() => { useToast.setState({ toast: null }) })

  it('DELETE beside an unclaimed published row refuses and sends nothing', async () => {
    lostBag()
    await tick()
    expect(ids(useShards.getState().mine)).toEqual(['m1'])
    relayAnswers = 'unreachable'
    await useShards.getState().deleteInstance('m1')
    expect(sent).toEqual([])
    expect(ids(useShards.getState().mine)).toEqual(['m1'])
    expect(useToast.getState().toast).toMatchObject({ label: 'NOT DELETED', meta: expect.stringContaining('No relay answered') })
  })

  it('a move gets the refusal itself, so it can say the old copy stayed', async () => {
    lostBag()
    await tick()
    relayAnswers = 'unreachable'
    await expect(useShards.getState().deleteInstance('m1', { keepObject: false })).rejects.toThrow('No relay answered')
    expect(useToast.getState().toast).toBeNull()
    expect(sent).toEqual([])
  })

  it('a hide into it refuses and sends nothing', async () => {
    signIn(Y); signIn(home)
    const shard = aShard()
    useWorkshop.setState({ shards: [shard], currentId: shard.id })
    useShards.getState().startDeployShard(shard.id)
    // The bag this hide would write is at the spot and height the bar is set to.
    const here = useCyberspace.getState().position
    const { deployHeight } = useShards.getState()
    const { lookupId } = regionKeyAt(here, deployHeight, 20)
    localStorage.setItem(UNCLAIMED, JSON.stringify([{ ...refRow(home, 'A'), lookupId }]))
    relayAnswers = 'unreachable'
    await useShards.getState().deploy()
    expect(useShards.getState().deployStatus).toBe('error')
    expect(useShards.getState().deployError).toContain('No relay answered')
    expect(sent).toEqual([])
  })

  it('BROADCAST refuses and sends nothing', async () => {
    lostBag()
    await tick()
    relayAnswers = 'unreachable'
    expect(await useShards.getState().broadcast(rk.lookupId)).toBe(false)
    expect(useShards.getState().broadcastError).toContain('No relay answered')
    expect(sent).toEqual([])
  })

  it('a relay that answers with nothing is an answer: the write goes ahead', async () => {
    lostBag()
    await tick()
    await useShards.getState().deleteInstance('m1')
    expect(sent.map((e) => e.kind)).toEqual([5])
  })

  it('an unclaimed row never published refuses nothing, though no relay answered', async () => {
    localStorage.setItem(BARE, JSON.stringify([row(home, 'm1'), { ...refRow(home, 'A'), published: false }]))
    signIn(Y); signIn(home)
    await tick()
    relayAnswers = 'unreachable'
    await useShards.getState().deleteInstance('m1')
    expect(sent.map((e) => e.kind)).toEqual([5])
  })

  it('a read that throws counts as no answer', async () => {
    lostBag()
    await tick()
    const { queryEach } = await import('../../lib/relay')
    vi.mocked(queryEach).mockRejectedValueOnce(new Error('down'))
    await useShards.getState().deleteInstance('m1')
    expect(sent).toEqual([])
  })

  it('goes ahead when the bag is read, and the rewrite keeps what the bag names', async () => {
    lostBag()
    await tick()
    const a = stored(UNCLAIMED)[0]
    relayBags = [await bagBy(SK, a.ref as Reference)]
    await useShards.getState().deleteInstance('m1')
    expect(sent.map((e) => e.kind)).toEqual([33330])
  })

  it('a row deleted here, or at another region, blocks nothing', async () => {
    localStorage.setItem(UNCLAIMED, JSON.stringify([{ ...refRow(home, 'A'), lookupId: 'another' }, refRow(home, 'B')]))
    localStorage.setItem('onosendai:deployments-deleted', JSON.stringify(['B']))
    localStorage.setItem(keyOf(home), JSON.stringify([row(home, 'm1')]))
    signIn(Y); signIn(home)
    await tick()
    relayAnswers = 'unreachable'
    await useShards.getState().deleteInstance('m1')
    expect(sent.map((e) => e.kind)).toEqual([5])
  })
})

describe('what a row proves', () => {
  it('a sealed reference is its signer\'s: only a LIVE LINK waits', () => {
    const inner = { id: 'sealed', pubkey: X, kind: 33331, created_at: 1, tags: [['d', 'e'], ['encrypted', 'aes-256-gcm', 'ct', 'cyberspace:region']], content: '' }
    const sealed = { ...refRow(X, 'sealed'), inner }
    const live = { ...refRow(X, 'live'), inner: { ...inner, id: 'other', tags: [['d', 'e']] } }
    const notItsId = { ...refRow(X, 'moved'), inner: { ...inner, id: 'not-moved' } }
    localStorage.setItem(BARE, JSON.stringify([sealed, live, notItsId]))
    signIn(X)
    expect(ids(useShards.getState().mine)).toEqual(['sealed'])
    expect(ids(stored(UNCLAIMED))).toEqual(['live', 'moved'])
  })

  it('a row with nothing to show waits rather than being erased by the next save', async () => {
    localStorage.setItem(BARE, JSON.stringify([row(home, 'no-content', { text: undefined }), row(home, 'h1', { lookupId: 'elsewhere' })]))
    signIn(Y); signIn(home)
    await deployAShard()
    expect(everywhere('no-content')).toEqual([UNCLAIMED])
  })

  it.each([
    ['empty', {}], ['unit only', { unit: 0 }], ['null vertices', { unit: 0, vertices: null }], ['no faces', { unit: 0, vertices: [] }],
    ['a string', 'junk'], ['a number', 7], ['a null vertex', { unit: 0, vertices: [null], faces: [] }],
  ])('a shard that cannot be drawn (%s) is never listed, stays on disk, and survives a save', (_name, bad) => {
    localStorage.setItem(keyOf(X), JSON.stringify([row(X, 'x1'), row(X, 'bad', { type: 'shard', text: undefined, shard: bad as never })]))
    expect(() => signIn(X)).not.toThrow()
    expect(ids(useShards.getState().mine)).toEqual(['x1'])
    expect(useShards.getState().drawnItems().map((w) => w.key)).toEqual(['x1'])
    useShards.setState({ mine: [...useShards.getState().mine, row(X, 'x2')] })
    useShards.getState().addDiscovered([])
    const saved = useShards.getState().mine
    expect(ids(saved)).toEqual(['x1', 'x2'])
    useCyberspace.setState({ identity: { pubkey: home, npub: 'npub-home' } })
    expect(stored(keyOf(X)).some((d) => d.eventId === 'bad')).toBe(true)
  })

  it('a save keeps a row it cannot list, once', async () => {
    const bad = row(home, 'bad', { type: 'shard', text: undefined, shard: { unit: 0 } as never })
    localStorage.setItem(keyOf(home), JSON.stringify([bad]))
    signIn(Y); signIn(home)
    await deployAShard()
    await deployAShard()
    expect(stored(keyOf(home)).filter((d) => d.eventId === 'bad')).toHaveLength(1)
    expect(stored(keyOf(home))).toHaveLength(3)
    expect(ids(useShards.getState().mine)).not.toContain('bad')
  })

  it('a claim leaves an unreadable row unclaimed rather than losing it', async () => {
    const d = { ...refRow(X, 'r1'), shard: { unit: 0 } as never }
    relayBags = [await bagBy(SK, d.ref as Reference)]
    localStorage.setItem(UNCLAIMED, JSON.stringify([d]))
    signIn(OWNER)
    await tick()
    expect(everywhere('r1')).toEqual([UNCLAIMED])
    expect(useShards.getState().mine).toEqual([])
  })

  it('a crash before the bare key is removed finishes on the next load with no duplicates, rows without an id too', () => {
    localStorage.setItem(BARE, JSON.stringify([row(X, 'x1'), refRow(X, 'r1'), { junk: true }]))
    const rm = vi.spyOn(localStorage, 'removeItem').mockImplementationOnce(() => { throw new Error('crash') })
    signIn(X)
    rm.mockRestore()
    expect(localStorage.getItem(BARE)).not.toBeNull()
    signIn(Y); signIn(X)
    expect(localStorage.getItem(BARE)).toBeNull()
    expect(ids(stored(keyOf(X)))).toEqual(['x1'])
    expect(stored(UNCLAIMED)).toHaveLength(2)
  })
})

describe('what relays and other identities see', () => {
  it('a claim asks for this identity\'s bags, never naming another identity\'s lookup ids', async () => {
    const { query } = await import('../../lib/relay')
    vi.mocked(query).mockClear()
    localStorage.setItem(UNCLAIMED, JSON.stringify([{ ...refRow(X, 'r1'), lookupId: 'x-lookup-id' }]))
    signIn(Y)
    await tick()
    expect(vi.mocked(query).mock.calls.map((c) => c[0])).toEqual([{ kinds: [33330], authors: [Y] }])
  })

  it('a claim that lands after a switch goes to the prover', async () => {
    const d = refRow(X, 'r1')
    relayBags = [await bagBy(SK, d.ref as Reference)]
    const { query } = await import('../../lib/relay')
    let answer = (): void => {}
    vi.mocked(query).mockImplementationOnce(() => new Promise((resolve) => { answer = () => resolve(relayBags as never) }))
    localStorage.setItem(UNCLAIMED, JSON.stringify([d]))
    signIn(OWNER)
    signIn(Y)
    answer()
    await tick()
    expect(useShards.getState().mine).toEqual([])
    expect(stored(keyOf(Y))).toEqual([])
    expect(ids(stored(keyOf(OWNER)))).toEqual(['r1'])
  })

  /** Start a delete, switch to Y while its bag read is out, then let the read answer. */
  async function switchDuringDelete(opts?: { keepObject: boolean }): Promise<{ deleting: Promise<void> }> {
    const { queryEach } = await import('../../lib/relay')
    let answer = (): void => {}
    vi.mocked(queryEach).mockImplementationOnce(() => new Promise((resolve) => { answer = () => resolve([{ url: 'wss://relay.test', outcome: 'answered', events: [] }] as never) }))
    const deleting = useShards.getState().deleteInstance('h1', opts)
    await tick(0)
    signIn(Y)
    answer()
    return { deleting }
  }

  it('a bag rewrite begun before a switch is not sent, signed by, or written over the next identity', async () => {
    useToast.setState({ toast: null })
    localStorage.setItem(keyOf(Y), JSON.stringify([row(Y, 'y1', { lookupId: rk.lookupId })]))
    localStorage.setItem(keyOf(home), JSON.stringify([row(home, 'h1', { lookupId: 'elsewhere' }), row(home, 'h2', { lookupId: 'elsewhere' })]))
    signIn(Y); signIn(home)
    await (await switchDuringDelete()).deleting
    expect(useToast.getState().toast).toMatchObject({ label: 'NOT DELETED', meta: expect.stringContaining('switched identity') })
    expect(sent).toEqual([])
    expect(ids(useShards.getState().mine)).toEqual(['y1'])
    expect(ids(stored(keyOf(Y)))).toEqual(['y1'])
    expect(ids(stored(keyOf(home)))).toEqual(['h1', 'h2'])
  })

  it('a bag deletion begun before a switch is not signed by the next identity', async () => {
    useToast.setState({ toast: null })
    localStorage.setItem(keyOf(home), JSON.stringify([row(home, 'h1', { lookupId: 'elsewhere' })]))
    signIn(Y); signIn(home)
    await (await switchDuringDelete()).deleting
    expect(useToast.getState().toast).toMatchObject({ label: 'NOT DELETED', meta: expect.stringContaining('switched identity') })
    expect(sent).toEqual([])
    expect(ids(stored(keyOf(home)))).toEqual(['h1'])
  })

  it('a move begun before a switch gets the refusal itself', async () => {
    localStorage.setItem(keyOf(home), JSON.stringify([row(home, 'h1', { lookupId: 'elsewhere' }), row(home, 'h2', { lookupId: 'elsewhere' })]))
    signIn(Y); signIn(home)
    await expect((await switchDuringDelete({ keepObject: false })).deleting).rejects.toThrow('switched identity')
    expect(sent).toEqual([])
  })
})

describe('rolling back', () => {
  it('puts this identity\'s rows back on the bare key, once each, leaving its own key alone', () => {
    localStorage.setItem(keyOf(X), JSON.stringify([row(X, 'x1'), row(X, 'x2')]))
    localStorage.setItem(keyOf(Y), JSON.stringify([row(Y, 'y1')]))
    localStorage.setItem(BARE, JSON.stringify([row(X, 'x1', { text: 'already here' })]))
    expect(rollbackMineToBare(X)).toBe(true)
    expect(rollbackMineToBare(X)).toBe(true)
    expect(stored(BARE).map((d) => d.text)).toEqual(['already here', 'hello'])
    expect(ids(stored(BARE))).toEqual(['x1', 'x2'])
    expect(ids(stored(keyOf(X)))).toEqual(['x1', 'x2'])
    expect(ids(stored(keyOf(Y)))).toEqual(['y1'])
  })

  it('does not bring back what was deleted, and says when storage refused', () => {
    localStorage.setItem(keyOf(X), JSON.stringify([row(X, 'x1'), row(X, 'gone')]))
    localStorage.setItem('onosendai:deployments-deleted', JSON.stringify(['gone']))
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError') })
    expect(rollbackMineToBare(X)).toBe(false)
    spy.mockRestore()
    expect(rollbackMineToBare(X)).toBe(true)
    expect(ids(stored(BARE))).toEqual(['x1'])
  })

  it('states its limit: a row deleted while rolled back, not on the deleted list, comes back going forward', () => {
    localStorage.setItem(keyOf(X), JSON.stringify([row(X, 'x1')]))
    rollbackMineToBare(X)
    localStorage.setItem(BARE, '[]')
    signIn(X)
    expect(ids(useShards.getState().mine)).toEqual(['x1'])
  })

  it('states its limit: LIVE LINK rows in unclaimed are not restored', () => {
    localStorage.setItem(UNCLAIMED, JSON.stringify([refRow(X, 'link')]))
    expect(rollbackMineToBare(X)).toBe(true)
    expect(localStorage.getItem(BARE)).toBeNull()
    expect(ids(stored(UNCLAIMED))).toEqual(['link'])
  })

  it('rolling forward again from a rollback loses nothing', () => {
    localStorage.setItem(keyOf(X), JSON.stringify([row(X, 'x1')]))
    rollbackMineToBare(X)
    signIn(X)
    expect(ids(useShards.getState().mine)).toEqual(['x1'])
    expect(ids(stored(keyOf(X)))).toEqual(['x1'])
    expect(localStorage.getItem(BARE)).toBeNull()
  })
})
