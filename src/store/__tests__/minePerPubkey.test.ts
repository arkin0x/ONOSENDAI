/**
 * minePerPubkey.test.ts - YOURS is the signed-in identity's list. The bare
 * `onosendai:deployments` key was shared by every identity on a device, so an
 * in-app switch showed the next identity the last one's hidden things as its
 * own, with DELETE. Each identity now has its own key, the bare list moves to
 * the owners its records prove, and no row is ever dropped on the way.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

let relayBags: unknown[] = []
const sent: { kind: number }[] = []
/** When set, a bag waits here on its way to the relays. */
let holdBag: Promise<void> | null = null
vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async (_relays: string[], ev: { kind: number }) => {
    if (ev.kind === 33330 && holdBag) await holdBag
    sent.push(ev)
    return { ok: true }
  }),
  query: vi.fn(async () => relayBags),
  queryEach: vi.fn(async () => [{ url: 'wss://relay.test', outcome: 'answered', events: [] }]),
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

let home = ''

beforeEach(() => {
  home ||= useCyberspace.getState().identity.pubkey
  relayBags = []
  sent.length = 0
  holdBag = null
  localStorage.clear()
  useCyberspace.setState({ identity: { pubkey: home, npub: 'npub-home' }, live: true })
  useShards.setState({ mine: [], deleted: {}, discovered: {}, pending: null, selectedSecret: null, deployStatus: 'idle' })
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

  it('keeps a reload out of a deploy that finished after the switch: the row goes to whoever hid it', async () => {
    const shard: ShardModel = { ...newShard('held'), unit: 1, vertices: [{ p: [0, 0, 0] }, { p: [1, 0, 0] }, { p: [0, 1, 0] }], faces: [[0, 1, 2]] } as ShardModel
    useWorkshop.setState({ shards: [shard], currentId: shard.id })
    localStorage.setItem(keyOf(Y), JSON.stringify([row(Y, 'y1')]))
    let release = (): void => {}
    holdBag = new Promise((resolve) => { release = resolve })
    useShards.getState().startDeployShard(shard.id)
    const deploying = useShards.getState().deploy()
    await vi.waitFor(() => expect(useShards.getState().deployNote ?? useShards.getState().deployStatus).toBeTruthy())
    await new Promise((resolve) => setTimeout(resolve, 50))
    signIn(Y)
    release()
    await deploying
    expect(ids(useShards.getState().mine)).toEqual(['y1'])
    expect(ids(stored(keyOf(Y)))).toEqual(['y1'])
    expect(stored(keyOf(home))).toHaveLength(1)
  })

  it('keeps a delete that finished after the switch on the list it came from', async () => {
    const mine = [row(home, 'h1'), row(home, 'h2', { lookupId: 'elsewhere', published: false })]
    localStorage.setItem(keyOf(home), JSON.stringify(mine))
    localStorage.setItem(keyOf(Y), JSON.stringify([row(Y, 'y1')]))
    signIn(Y)
    signIn(home)
    let release = (): void => {}
    holdBag = new Promise((resolve) => { release = resolve })
    relayBags = []
    const deleting = useShards.getState().deleteInstance('h2')
    signIn(Y)
    release()
    await deleting
    expect(ids(useShards.getState().mine)).toEqual(['y1'])
    expect(ids(stored(keyOf(Y)))).toEqual(['y1'])
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
    const real = localStorage.setItem.bind(localStorage)
    const full = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })
    signIn(X)
    full.mockRestore()
    expect(localStorage.getItem(BARE)).toBe(list)
    expect(ids(useShards.getState().mine)).toEqual(['x1'])
    void real
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
    await Promise.resolve()
    expect(cyber.useCyberspace.getState().identity.pubkey).toBe(pubkey)
    expect(ids(shards.useShards.getState().mine)).toEqual(['p1'])
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
