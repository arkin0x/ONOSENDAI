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
    get length() { return mem.size },
    key: (i: number) => [...mem.keys()][i] ?? null,
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
import { entriesIn, reloadLocalView } from '../hiddenStorage'
import { useCyberspace } from '../useCyberspace'
import { useShards, type MyDeployment } from '../useShards'
import { useWorkshop } from '../useWorkshop'
import { useToast } from '../useToast'

const BARE = 'onosendai:deployments'
const UNCLAIMED = 'onosendai:deployments-unclaimed'
const keyOf = (pubkey: string): string => `${BARE}:${pubkey}`
/** A list as the store holds it. */
const bucket = (key: string): string => (key === UNCLAIMED ? 'unclaimed' : key.slice(BARE.length + 1))
const stored = (key: string): MyDeployment[] => (key === BARE ? JSON.parse(localStorage.getItem(BARE) ?? '[]') as MyDeployment[] : entriesIn(bucket(key)).map((e) => e.row as MyDeployment))
/** Put something in localStorage as an earlier session left it, and read it as a load would. */
const seed = (key: string, value: string): void => { localStorage.setItem(key, value); reloadLocalView() }
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
  reloadLocalView()
  useCyberspace.setState({ identity: { pubkey: home, npub: 'npub-home' }, live: true })
  useShards.setState({ mine: [], deleted: {}, deletedBags: {}, discovered: {}, pending: null, selectedSecret: null, deployHeight: 0, deployUnit: 0, deployStatus: 'idle', deployError: null })
})

describe('switching identity', () => {
  it("never shows the next identity the last one's rows, and brings them back", () => {
    seed(keyOf(X), JSON.stringify([row(X, 'x1')]))
    seed(keyOf(Y), JSON.stringify([row(Y, 'y1')]))
    signIn(X)
    expect(ids(useShards.getState().mine)).toEqual(['x1'])
    signIn(Y)
    expect(ids(useShards.getState().mine)).toEqual(['y1'])
    expect(useShards.getState().worldItems().filter((w) => w.mine).map((w) => w.key)).toEqual(['y1'])
    signIn(X)
    expect(ids(useShards.getState().mine)).toEqual(['x1'])
  })

  it('saves under the identity signed in, leaving the other list alone', () => {
    seed(keyOf(X), JSON.stringify([row(X, 'x1')]))
    signIn(Y)
    expect(useShards.getState().mine).toEqual([])
    useShards.setState({ deleted: { gone: true } })
    useShards.getState().addDiscovered([])
    expect(ids(stored(keyOf(X)))).toEqual(['x1'])
  })

  it("closes a card open on the last identity's row, and only that", () => {
    seed(keyOf(X), JSON.stringify([row(X, 'x1')]))
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
    seed(keyOf(Y), JSON.stringify([row(Y, 'y1')]))
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
    seed(keyOf(home), JSON.stringify([row(home, 'h1', { lookupId: 'elsewhere' }), row(home, 'h2')]))
    seed(keyOf(Y), JSON.stringify([row(Y, 'y1')]))
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

describe('a page load', () => {
  it('reads the list of the identity it starts as, whichever store loads first', async () => {
    vi.resetModules()
    const first = await import('../useCyberspace')
    const pubkey = first.useCyberspace.getState().identity.pubkey
    seed(BARE, JSON.stringify([row(pubkey, 'p1'), row(X, 'x1')]))
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
    seed(BARE, JSON.stringify([refRow(X, 'r1')]))
    signIn(X)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(useShards.getState().mine).toEqual([])
    expect(ids(stored(UNCLAIMED))).toEqual(['r1'])
  })

  it('go to the identity whose own bag names them, even for another author\'s object', async () => {
    const d = refRow(X, 'r1')
    relayBags = [await bagBy(sk, d.ref as Reference)]
    seed(BARE, JSON.stringify([d, refRow(X, 'r2')]))
    signIn(OWNER)
    await vi.waitFor(() => expect(ids(useShards.getState().mine)).toEqual(['r1']))
    expect(ids(stored(keyOf(OWNER)))).toEqual(['r1'])
    expect(ids(stored(UNCLAIMED))).toEqual(['r2'])
  })

  it("stay unclaimed when the answer is someone else's bag", async () => {
    const d = refRow(X, 'r1')
    relayBags = [await bagBy(generateSecretKey(), d.ref as Reference)]
    seed(BARE, JSON.stringify([d]))
    signIn(OWNER)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(useShards.getState().mine).toEqual([])
    expect(ids(stored(UNCLAIMED))).toEqual(['r1'])
  })

  it('stay unclaimed when no relay answers, and are asked about again', async () => {
    const d = refRow(X, 'r1')
    seed(BARE, JSON.stringify([d]))
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
    seed('onosendai:deployments-deleted', JSON.stringify(['r1']))
    seed(UNCLAIMED, JSON.stringify([d]))
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

const onAnyKey = (id: string): boolean => [BARE, UNCLAIMED, keyOf(X)].some((k) => stored(k).some((d) => d?.eventId === id))

describe('a public bag when no relay answered', () => {
  const lostBag = (): void => {
    seed(BARE, JSON.stringify([row(home, 'm1'), refRow(home, 'A')]))
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
    seed(UNCLAIMED, JSON.stringify([{ ...refRow(home, 'A'), lookupId }]))
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
    seed(BARE, JSON.stringify([row(home, 'm1'), { ...refRow(home, 'A'), published: false }]))
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
    seed(UNCLAIMED, JSON.stringify([{ ...refRow(home, 'A'), lookupId: 'another' }, refRow(home, 'B')]))
    seed('onosendai:deployments-deleted', JSON.stringify(['B']))
    seed(keyOf(home), JSON.stringify([row(home, 'm1')]))
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
    seed(BARE, JSON.stringify([sealed, live, notItsId]))
    signIn(X)
    expect(ids(useShards.getState().mine)).toEqual(['sealed'])
    expect(ids(stored(UNCLAIMED))).toEqual(['live', 'moved'])
  })

  it('a row with nothing to show waits rather than being erased by the next save', async () => {
    seed(BARE, JSON.stringify([row(home, 'no-content', { text: undefined }), row(home, 'h1', { lookupId: 'elsewhere' })]))
    signIn(Y); signIn(home)
    await deployAShard()
    expect(everywhere('no-content')).toContain(UNCLAIMED)
    expect(everywhere('no-content')).not.toContain(keyOf(home))
  })

  it.each([
    ['empty', {}], ['unit only', { unit: 0 }], ['null vertices', { unit: 0, vertices: null }], ['no faces', { unit: 0, vertices: [] }],
    ['a string', 'junk'], ['a number', 7], ['a null vertex', { unit: 0, vertices: [null], faces: [] }],
    ['a fractional unit', { unit: 0.5, vertices: [], faces: [] }], ['a unit past the limit', { unit: 1_000_000_000, vertices: [], faces: [] }],
  ])('a shard that cannot be drawn (%s) is never listed, stays on disk, and survives a save', (_name, bad) => {
    seed(keyOf(X), JSON.stringify([row(X, 'x1'), row(X, 'bad', { type: 'shard', text: undefined, shard: bad as never })]))
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
    seed(keyOf(home), JSON.stringify([bad]))
    signIn(Y); signIn(home)
    await deployAShard()
    expect(stored(keyOf(home)).filter((d) => d.eventId === 'bad')).toHaveLength(1)
    expect(stored(keyOf(home))).toHaveLength(2)
    expect(ids(useShards.getState().mine)).not.toContain('bad')
  })

  it('a claim leaves an unreadable row unclaimed rather than losing it', async () => {
    const d = { ...refRow(X, 'r1'), shard: { unit: 0 } as never }
    relayBags = [await bagBy(SK, d.ref as Reference)]
    seed(UNCLAIMED, JSON.stringify([d]))
    signIn(OWNER)
    await tick()
    expect(everywhere('r1')).toEqual([UNCLAIMED])
    expect(useShards.getState().mine).toEqual([])
  })
})

describe('what relays and other identities see', () => {
  it('a claim asks for this identity\'s bags, never naming another identity\'s lookup ids', async () => {
    const { query } = await import('../../lib/relay')
    vi.mocked(query).mockClear()
    seed(UNCLAIMED, JSON.stringify([{ ...refRow(X, 'r1'), lookupId: 'x-lookup-id' }]))
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
    seed(UNCLAIMED, JSON.stringify([d]))
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
    seed(keyOf(Y), JSON.stringify([row(Y, 'y1', { lookupId: rk.lookupId })]))
    seed(keyOf(home), JSON.stringify([row(home, 'h1', { lookupId: 'elsewhere' }), row(home, 'h2', { lookupId: 'elsewhere' })]))
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
    seed(keyOf(home), JSON.stringify([row(home, 'h1', { lookupId: 'elsewhere' })]))
    signIn(Y); signIn(home)
    await (await switchDuringDelete()).deleting
    expect(useToast.getState().toast).toMatchObject({ label: 'NOT DELETED', meta: expect.stringContaining('switched identity') })
    expect(sent).toEqual([])
    expect(ids(stored(keyOf(home)))).toEqual(['h1'])
  })

  it('a move begun before a switch gets the refusal itself', async () => {
    seed(keyOf(home), JSON.stringify([row(home, 'h1', { lookupId: 'elsewhere' }), row(home, 'h2', { lookupId: 'elsewhere' })]))
    signIn(Y); signIn(home)
    await expect((await switchDuringDelete({ keepObject: false })).deleting).rejects.toThrow('switched identity')
    expect(sent).toEqual([])
  })
})

