/** Throwaway: the author's explanations, at 935f48a4. Never committed. */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
const mem2 = new Map<string, string>()
;(globalThis as { sessionStorage?: unknown }).sessionStorage = { getItem: (k: string) => mem2.get(k) ?? null, setItem: (k: string, v: string) => { mem2.set(k, String(v)) }, removeItem: (k: string) => { mem2.delete(k) }, clear: () => { mem2.clear() } }
if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)) }, removeItem: (k: string) => { mem.delete(k) }, clear: () => { mem.clear() } }
}
const sent: { kind: number }[] = []
let outcome = 'answered'
vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async (_r: string[], ev: { kind: number }) => { sent.push(ev); return { ok: true } }),
  query: vi.fn(async () => []),
  queryEach: vi.fn(async () => [{ url: 'wss://relay.test', outcome, events: [] }]),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))
import { newShard, type ShardModel } from 'sno-core/shards'
import { bytesToHex } from '../../lib/events'
import type { Reference } from '../../lib/hidden'
import { regionKeyAt } from '../../lib/shardCrypto'
import { useCyberspace } from '../useCyberspace'
import { useShards, type MyDeployment } from '../useShards'
import { useToast } from '../useToast'
import { useWorkshop } from '../useWorkshop'
import { drawableShards } from '../../scene/WorldShards'
const BARE = 'onosendai:deployments', UNCLAIMED = 'onosendai:deployments-unclaimed', MOVING = 'onosendai:deployments-moving'
const keyOf = (p: string): string => `${BARE}:${p}`
const stored = (k: string): MyDeployment[] => { try { return JSON.parse(localStorage.getItem(k) ?? '[]') as MyDeployment[] } catch { return [] } }
const signIn = (pubkey: string): void => { useCyberspace.setState({ identity: { pubkey, npub: 'n' } }) }
const X = 'a1'.repeat(32), Y = 'b2'.repeat(32)
const rk = regionKeyAt({ x: 90_000n, y: 4_000n, z: 71n }, 5, 20)
const row = (a: string, id: string, extra: Partial<MyDeployment> = {}): MyDeployment => ({ eventId: id, inner: { id, pubkey: a, kind: 1, created_at: 1, tags: [], content: '' }, bagId: `b-${id}`, type: 'message', text: 'hello', at: { x: '1', y: '2', z: '3' }, plane: 0, height: 5, lookupId: rk.lookupId, keyHex: bytesToHex(rk.key), relays: [], createdAt: 1, published: true, ...extra } as MyDeployment)
const link = (a: string, id: string, extra: Partial<MyDeployment> = {}): MyDeployment => row(a, id, { ref: ['a', `33331:${a}:t-${id}`, 'wss://relay.test', 'c'.repeat(64)] as Reference, type: 'shard', text: undefined, shard: newShard(`s ${id}`), ...extra })
const heldShard = (): ShardModel => ({ ...newShard('new'), unit: 1, vertices: Array.from({ length: 3 }, (_, i) => ({ p: [i % 16, 0, 0] as [number, number, number], c: [1, 1, 1] as [number, number, number] })), faces: [[0, 1, 2]] })
const deployOne = async (): Promise<void> => { const s = heldShard(); useWorkshop.setState({ shards: [s], currentId: s.id }); useShards.getState().startDeployShard(s.id); await useShards.getState().deploy() }
const anyKey = (id: string): string[] => [BARE, UNCLAIMED, keyOf(X), keyOf(Y)].filter((k) => stored(k).some((d) => d?.eventId === id))
let home = ''
beforeAll(async () => { await new Promise((r) => setTimeout(r, 20)) })
beforeEach(() => {
  home ||= useCyberspace.getState().identity.pubkey
  sent.length = 0; localStorage.clear(); mem2.clear(); outcome = 'answered'
  useCyberspace.setState({ identity: { pubkey: home, npub: 'h' }, live: true })
  useShards.setState({ mine: [], deleted: {}, deletedBags: {}, discovered: {}, pending: null, selectedSecret: null, deployHeight: 0, deployUnit: 0, deployStatus: 'idle', deployError: null })
  useToast.setState?.({ toast: null } as never)
})
describe('the author on my failing tests', () => {
  it('T4 answered empty proceeds; unreachable refuses with no kind 5 and the toast', async () => {
    localStorage.setItem(BARE, JSON.stringify([row(home, 'm1'), link(home, 'A')]))
    signIn(Y); signIn(home); await new Promise((r) => setTimeout(r, 20))
    outcome = 'unreachable'
    await useShards.getState().deleteInstance('m1')
    expect(sent.filter((e) => e.kind === 5)).toHaveLength(0)
    expect(useToast.getState().toast?.label).toBe('NOT DELETED')
    expect(useShards.getState().mine.map((d) => d.eventId)).toEqual(['m1'])
    outcome = 'answered'
    await useShards.getState().deleteInstance('m1')
    expect(sent.filter((e) => e.kind === 5)).toHaveLength(1)
  })
  it('T11 three deploys beside a never-published link give three rows', async () => {
    await deployOne()
    const lookupId = useShards.getState().mine[0].lookupId
    useShards.setState({ mine: [], pending: null, deployStatus: 'idle', deployError: null }); localStorage.clear()
    localStorage.setItem(UNCLAIMED, JSON.stringify([link(home, 'never', { lookupId, published: false })]))
    for (let i = 0; i < 3; i++) { await deployOne(); expect(useShards.getState().deployStatus).toBe('done'); useShards.setState({ pending: null, deployStatus: 'idle', deployError: null }) }
    expect(useShards.getState().mine).toHaveLength(3)
    expect(stored(UNCLAIMED).map((d) => d.eventId)).toEqual(['never'])
  })
  it('T11b unreachable relays with a published link still refuse, in plain words', async () => {
    await deployOne()
    const lookupId = useShards.getState().mine[0].lookupId
    useShards.setState({ mine: [], pending: null, deployStatus: 'idle', deployError: null }); localStorage.clear()
    localStorage.setItem(UNCLAIMED, JSON.stringify([link(Y, 'theirs', { lookupId })]))
    outcome = 'unreachable'
    await deployOne()
    expect(useShards.getState().deployError).toContain('No relay answered')
  })
  it('T13 take-back fails: the row is in the journal, and the next load restores it', () => {
    const big = row(X, 'big', { text: 'a'.repeat(1000) })
    localStorage.setItem(BARE, JSON.stringify([big]))
    const real = localStorage.setItem.bind(localStorage)
    const s = vi.spyOn(localStorage, 'setItem').mockImplementation((k: string, v: string) => {
      if (k === keyOf(X) || (k === BARE && String(v).includes('"big"'))) throw new DOMException('quota', 'QuotaExceededError')
      real(k, v)
    })
    signIn(X)
    s.mockRestore()
    expect(anyKey('big')).toEqual([])
    expect(localStorage.getItem(MOVING)).toContain('"big"')
    signIn(Y); signIn(X)
    expect(useShards.getState().mine.map((d) => d.eventId)).toEqual(['big'])
    expect(anyKey('big')).toEqual([keyOf(X)])
    expect(localStorage.getItem(MOVING)).toBeNull()
  })
  it('T14 every state holds the row on a key or in the journal', () => {
    const big = row(X, 'big', { text: 'a'.repeat(60_000) })
    localStorage.setItem(BARE, JSON.stringify([big]))
    const real = localStorage.setItem.bind(localStorage), realRm = localStorage.removeItem.bind(localStorage)
    const size = (): number => [BARE, keyOf(X), MOVING].reduce((n, k) => n + (localStorage.getItem(k) ?? '').length, 0)
    const holds = (): boolean => anyKey('big').length > 0 || (localStorage.getItem(MOVING) ?? mem2.get(MOVING) ?? '').includes('"big"')
    const states: boolean[] = []
    const s = vi.spyOn(localStorage, 'setItem').mockImplementation((k: string, v: string) => {
      if (size() - (localStorage.getItem(k) ?? '').length + String(v).length > 100_000) throw new DOMException('quota', 'QuotaExceededError')
      real(k, v); states.push(holds())
    })
    const r = vi.spyOn(localStorage, 'removeItem').mockImplementation((k: string) => { realRm(k); states.push(holds()) })
    signIn(X)
    s.mockRestore(); r.mockRestore()
    console.info('T14 states', JSON.stringify(states), 'journal left', mem2.has(MOVING), localStorage.getItem(MOVING) !== null)
    expect(states.every(Boolean)).toBe(true)
    expect(anyKey('big')).toEqual([keyOf(X)])
  })
})
describe('the journal holds one row', () => {
  it('J1 a journalled row whose restore fails is not overwritten by the next big row', () => {
    const a = row(X, 'A', { text: 'a'.repeat(30_000) }), b = row(X, 'B', { text: 'b'.repeat(40_000) })
    mem2.set(MOVING, JSON.stringify(a))
    localStorage.setItem(BARE, JSON.stringify([b]))
    localStorage.setItem('other', 'x'.repeat(50_000))
    const real = localStorage.setItem.bind(localStorage)
    const size = (): number => [BARE, keyOf(X), MOVING, 'other', UNCLAIMED].reduce((n, k) => n + (localStorage.getItem(k) ?? '').length, 0)
    const s = vi.spyOn(localStorage, 'setItem').mockImplementation((k: string, v: string) => {
      if (size() - (localStorage.getItem(k) ?? '').length + String(v).length > 100_000) throw new DOMException('quota', 'QuotaExceededError')
      real(k, v)
    })
    signIn(X)
    s.mockRestore()
    const where = [...anyKey('A'), ...(mem2.get(MOVING)?.includes('"A"') ? ['session journal'] : []), ...((localStorage.getItem(MOVING) ?? '').includes('"A"') ? ['local journal'] : [])]
    console.info('J1 row A is at', JSON.stringify(where), 'B at', JSON.stringify(anyKey('B')))
    expect(where.length).toBeGreaterThan(0)
  })
  it('J2 a row in each journal: restoring one does not clear the other', () => {
    const a = row(X, 'A'), b = row(X, 'B')
    localStorage.setItem(MOVING, JSON.stringify(a)); mem2.set(MOVING, JSON.stringify(b))
    signIn(X)
    console.info('J2 mine', JSON.stringify(useShards.getState().mine.map((d) => d.eventId)), 'session left', mem2.has(MOVING))
    expect(anyKey('B').length + (mem2.has(MOVING) ? 1 : 0)).toBeGreaterThan(0)
  })
})
describe('what the boundary does not cover', () => {
  it('B6 a stored fractional unit: above ShardMesh', () => {
    localStorage.setItem(keyOf(X), JSON.stringify([row(X, 'u', { type: 'shard', text: undefined, shard: { ...heldShard(), unit: 0.5 } as never })]))
    signIn(X)
    const items = useShards.getState().drawnItems()
    let out = 'not listed'
    const w = items.find((i) => i.key === 'u')
    if (w) { try { const d = drawableShards([w] as never, { x: 1n, y: 2n, z: 3n } as never, 0, 0, { right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, 1] } as never); out = `ok ${d.length}, unit ${(w.shard as ShardModel).unit}` } catch (e) { out = `THROWS ${String(e).slice(0, 80)}` } }
    console.info('B6', out)
    expect(out.startsWith('THROWS')).toBe(false)
  })
})
