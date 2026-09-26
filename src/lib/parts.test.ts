/**
 * parts.test.ts - an object of parts alone, as arkinox built it in snocrash
 * (Column Wall, 2026-09-26), reads, imports, deploys and resolves in ONOSENDAI.
 * Before sno-core v0.1.8 the client read it as an empty shard and drew nothing.
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

vi.mock('./relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { fromPayload, toPayload, type Ref } from 'sno-core/shards'
import { resolveParts } from 'sno-core/parts'
import { fetchRef, primeRef } from './parts'
import { shardRefusal } from './hidden'
import { useWorkshop } from '../store/useWorkshop'

const COLUMN_WALL = '{"v":2,"name":"Column Wall","unit":0,"extent":10,"mode":"solid","vertices":[],"ticks":[],"colors":[],"refs":[["a","33331:e8ed3798c6ffebffa08501ac39e271662bfd160f688f94c45d692d8767dd345a:fce13d24-c66f-40e3-b948-1d9946ebb8dd"]],"parts":[[0,0,0,0,0,0,0,0],[0,480,0,0,0,0,0,0],[0,-480,0,0,0,0,0,0],[0,-960,0,0,0,0,0,0]],"faces":[]}'
const COLUMN = { v: 2, name: 'Column', unit: 0, mode: 'solid', vertices: [[0, 0, 0], [1, 0, 0], [0, 4, 0]], colors: [5, 5, 5], faces: [[0, 1, 2]] }

describe('an object of parts alone', () => {
  beforeEach(() => {
    useWorkshop.setState({ shards: [], currentId: null })
  })

  it('reads with its reference and four placements, and round-trips', () => {
    const m = fromPayload(JSON.parse(COLUMN_WALL), 'wall')!
    expect(m).not.toBeNull()
    expect(m.vertices).toHaveLength(0)
    expect(m.refs).toHaveLength(1)
    expect(m.parts).toHaveLength(4)
    expect(m.parts!.map((p) => p.at[0])).toEqual([0, 480, -480, -960])
    const back = fromPayload(toPayload(m), 'wall')!
    expect(back.parts).toEqual(m.parts)
  })

  it('imports into the workshop and is not refused at deploy', () => {
    const id = useWorkshop.getState().importText(COLUMN_WALL)
    expect(id).not.toBeNull()
    const s = useWorkshop.getState().shards.find((x) => x.id === id)!
    expect(s.parts).toHaveLength(4)
    expect(shardRefusal(s)).toBeNull()
  })

  it('deploys: the store seals it into a bag with its placements intact', async () => {
    const { useShards } = await import('../store/useShards')
    const { useCyberspace } = await import('../store/useCyberspace')
    useCyberspace.setState({ live: false })
    useShards.setState({ mine: [], deleted: {}, discovered: {}, pending: null, deployHeight: 0, deployUnit: 0, deployStatus: 'idle', deployError: null })
    const id = useWorkshop.getState().importText(COLUMN_WALL)!
    useShards.getState().startDeployShard(id)
    await useShards.getState().deploy()
    expect(useShards.getState().deployError).toBeNull()
    expect(useShards.getState().deployStatus).toBe('done')
    const mine = useShards.getState().mine
    expect(mine).toHaveLength(1)
    const payload = JSON.parse(mine[0].inner.content)
    expect(payload.parts).toHaveLength(4)
    expect(payload.refs[0][1]).toMatch(/^33331:e8ed3798/)
  })

  it('CLEAR takes the placements too, and undo brings them back', () => {
    const id = useWorkshop.getState().importText(COLUMN_WALL)!
    useWorkshop.getState().select(id)
    useWorkshop.getState().clearShard()
    expect(useWorkshop.getState().current()!.parts).toBeUndefined()
    useWorkshop.getState().undo()
    expect(useWorkshop.getState().current()!.parts).toHaveLength(4)
  })

  it('resolves to four columns when the reference answers, and four placeholders when it does not', async () => {
    const m = fromPayload(JSON.parse(COLUMN_WALL), 'wall')!
    const ref = m.refs![0] as Ref
    const missing = await resolveParts(m, fetchRef)
    expect(missing.map((p) => p.missing)).toEqual(['unreachable', 'unreachable', 'unreachable', 'unreachable'])
    primeRef(ref, COLUMN)
    const found = await resolveParts(m, fetchRef)
    expect(found.every((p) => p.model?.name === 'Column')).toBe(true)
    expect(found).toHaveLength(4)
  })
})
