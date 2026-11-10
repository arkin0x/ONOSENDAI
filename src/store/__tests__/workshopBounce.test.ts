/**
 * workshopBounce.test.ts - BOUNCE set in the workshop (arkinox, 2026-11-10:
 * "can i make bounce surfaces in the workshop now then?") and every way the
 * shard leaves the bench: setBounce writes and removes the fields, undoably,
 * and never stores an invalid one; DUPLICATE, COPY then PASTE as a new shard,
 * PUBLISH, a FEED copy, a MINE copy (a bag or chest taken into keeping), a
 * deploy and an EDIT of the placed shard all keep `bounce` and `springboard`.
 * Nothing here reaches a relay (src/test/offlineRelay.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const m = new Map<string, string>()
  ;(globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
  }
})

vi.mock('../../lib/workers', () => ({
  postProof: vi.fn(),
  cancelProof: vi.fn(),
  setProofHandler: vi.fn(),
}))
vi.mock('../../lib/calibration', async (orig) => {
  const mod = await orig<typeof import('../../lib/calibration')>()
  return { ...mod, recommendedHopHeight: () => 20 }
})
vi.mock('../../lib/relay', async (orig) => {
  const mod = await orig<typeof import('../../lib/relay')>()
  const { offlineRelay } = await import('../../test/offlineRelay')
  return { ...mod, ...offlineRelay, publishMany: vi.fn(async () => ({ ok: true })), query: vi.fn(async () => []), queryAny: vi.fn(async () => []) }
})

import { newShard, type ShardModel } from 'sno-core/shards'
import { objectFromEvent } from 'sno-core/feed'
import { useCyberspace } from '../useCyberspace'
import { useShards } from '../useShards'
import { useWorkshop } from '../useWorkshop'
import { publicObjectTemplate } from '../../lib/published'
import { takeIntoKeeping } from '../../lib/carried'
import { bounceOf, springboardOf, type Bounce } from '../../lib/walkBounce'

const ws = () => useWorkshop.getState()
const bench = () => ws().current()!
const fields = (s: ShardModel) => ({ bounce: bounceOf(s), springboard: springboardOf(s) })
const wireOf = (content: string) => { const p = JSON.parse(content) as { bounce?: unknown; springboard?: unknown }; return { bounce: p.bounce, springboard: p.springboard } }

const worldItemsOriginal = useShards.getState().worldItems

beforeEach(() => {
  const s: ShardModel = { ...newShard('Pad'), mode: 'solid', vertices: [{ p: [0, 0, 0], c: [1, 1, 1] }, { p: [1, 0, 0], c: [1, 1, 1] }, { p: [0, 0, 1], c: [1, 1, 1] }], faces: [[0, 1, 2]] }
  useWorkshop.setState({ shards: [s], currentId: s.id, past: [], future: [], selection: [], partSel: [] })
  useShards.setState({ mine: [], deleted: {}, discovered: {}, pending: null, deployHeight: 0, deployUnit: 0, deployStatus: 'idle', deployError: null, worldItems: worldItemsOriginal })
  useCyberspace.setState({ live: false })
})

describe('setBounce', () => {
  it('writes a height, a springboard and REFLECT, and OFF removes both, each an undo step', () => {
    ws().setBounce(12)
    expect(bench().extra).toEqual({ bounce: 12 })
    ws().setBounce(12, true)
    expect(bench().extra).toEqual({ bounce: 12, springboard: true })
    ws().setBounce('reflect', true)
    expect(bench().extra).toEqual({ bounce: 'reflect' })
    ws().setBounce(0)
    expect(bench()).not.toHaveProperty('extra')
    expect(ws().past).toHaveLength(4)
    ws().undo()
    expect(fields(bench())).toEqual({ bounce: 'reflect', springboard: false })
    ws().undo()
    expect(fields(bench())).toEqual({ bounce: 12, springboard: true })
  })

  it('the same setting again is no edit, so no empty undo step', () => {
    ws().setBounce(6, true)
    const past = ws().past.length
    const before = bench()
    ws().setBounce(6, true)
    expect(ws().past.length).toBe(past)
    expect(bench()).toBe(before)
    ws().setBounce(0)
    ws().setBounce(0)
    expect(ws().past.length).toBe(past + 1)
  })

  it('keeps the shard\'s CONSTRAIN', () => {
    ws().setConstrain('all')
    ws().setBounce(18, true)
    ws().setBounce(0)
    expect(bench().extra).toEqual({ constrain: 'all' })
  })

  it('stores nothing invalid, whatever it is handed', () => {
    for (const raw of [25, 0.5, -3, '12', 'Reflect', NaN] as unknown as Bounce[]) {
      ws().setBounce(raw, true)
      expect(bench()).not.toHaveProperty('extra')
    }
  })
})

describe('the fields leave the bench with the shard', () => {
  beforeEach(() => {
    ws().setConstrain('all')
    ws().setBounce(12, true)
  })

  it('DUPLICATE keeps them', () => {
    const id = ws().duplicate(bench().id)
    const copy = ws().shards.find((s) => s.id === id)!
    expect(copy.id).not.toBe(ws().shards[0].id)
    expect(fields(copy)).toEqual({ bounce: 12, springboard: true })
  })

  it('COPY then PASTE as a new shard keeps them (the clipboard is the payload)', () => {
    const text = ws().exportCurrent()!
    expect(wireOf(text)).toEqual({ bounce: 12, springboard: true })
    const id = ws().importText(text)!
    expect(fields(ws().shards.find((s) => s.id === id)!)).toEqual({ bounce: 12, springboard: true })
  })

  it('PUBLISH carries them, and a FEED copy of the published object keeps them', () => {
    const ev = publicObjectTemplate(bench(), 1_800_000_000)
    expect(wireOf(ev.content)).toEqual({ bounce: 12, springboard: true })
    const obj = objectFromEvent({ ...ev, id: 'e'.repeat(64), pubkey: 'f'.repeat(64) })!
    expect(fields(obj.shard)).toEqual({ bounce: 12, springboard: true })
    const id = ws().importShard(obj.shard)
    expect(fields(ws().shards.find((s) => s.id === id)!)).toEqual({ bounce: 12, springboard: true })
  })

  it('REFLECT publishes as "reflect", with no springboard', () => {
    ws().setBounce('reflect')
    expect(wireOf(publicObjectTemplate(bench(), 1_800_000_000).content)).toEqual({ bounce: 'reflect', springboard: undefined })
  })

  it('a deploy hides them, a MINE copy keeps them, and EDIT of the placed shard keeps them', async () => {
    useShards.getState().startDeployShard(bench().id)
    await useShards.getState().deploy()
    expect(useShards.getState().deployStatus).toBe('done')
    const placed = useShards.getState().mine[0]
    expect(wireOf(placed.inner.content)).toEqual({ bounce: 12, springboard: true })
    expect(fields(placed.shard!)).toEqual({ bounce: 12, springboard: true })
    // Taken back into the workshop from where it was hidden.
    const id = ws().importShard(takeIntoKeeping(placed.shard!, useCyberspace.getState().identity.pubkey))
    expect(fields(ws().shards.find((s) => s.id === id)!)).toEqual({ bounce: 12, springboard: true })
    // EDIT: moved and its WALK changed, and the bounce goes with it.
    useShards.getState().startEditShard(placed.eventId)
    useShards.getState().setDeployConstrain('off')
    await useShards.getState().deploy()
    expect(useShards.getState().deployStatus).toBe('done')
    const moved = useShards.getState().mine.find((d) => d.eventId !== placed.eventId) ?? useShards.getState().mine[0]
    expect(JSON.parse(moved.inner.content)).toHaveProperty('constrain', 'off')
    expect(wireOf(moved.inner.content)).toEqual({ bounce: 12, springboard: true })
    expect(fields(moved.shard!)).toEqual({ bounce: 12, springboard: true })
  })
})
