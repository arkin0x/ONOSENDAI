/**
 * shardEdit.test.ts - EDIT moves a shard you hid (arkinox, 2026-10-16): the
 * new version lands at the cursor, the old one leaves its bag, and the new
 * one keeps the old one's identity so its comments and reactions stay with
 * it (an inline item's `d`, a reference's own object `d`). Also CANCEL on a
 * deploy from the workshop goes back to the workshop.
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

const sent: { kind: number; tags: string[][]; id: string; content?: string; created_at?: number }[] = []
/** Kinds every relay refuses in the current test. */
const refused = new Set<number>()
/** No relay answers a query while set. */
let silent = false
/** Events every relay refuses in the current test, by a rule. */
let refuseIf: ((ev: { kind: number }) => boolean) | null = null
vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async (_relays: string[], ev: { kind: number; tags: string[][]; id: string }) => {
    if (refused.has(ev.kind) || refuseIf?.(ev)) return { ok: false }
    sent.push(ev)
    return { ok: true }
  }),
  query: vi.fn(async () => []),
  // What the relay holds at an address: the objects it took.
  queryEach: vi.fn(async (f: { kinds: number[]; '#d': string[] }) => silent ? [{ url: 'wss://relay.test', outcome: 'unreachable', reason: 'down', events: [] }] : [{ url: 'wss://relay.test', outcome: 'answered', events: sent.filter((e) => f.kinds.includes(e.kind) && e.tags.some((t) => t[0] === 'd' && f['#d'].includes(t[1]))) }]),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { newShard, type ShardModel } from 'sno-core/shards'
import { useCyberspace } from '../useCyberspace'
import { EDIT_STALE, EDIT_UNANSWERED, PUT_BACK_PENDING, editable, useShards, type MyDeployment } from '../useShards'
import { useWorkshop } from '../useWorkshop'
import { useBuilder } from '../useBuilder'
import { bagEntries, dOf, HIDDEN_KIND, OBJECT_KIND } from '../../lib/hidden'
import { hexToBytes, positionHex, type NostrEvent } from '../../lib/events'
import type { Position } from '../../lib/space'

function benchShard(vertexCount: number): ShardModel {
  const shard: ShardModel = {
    ...newShard(`bench ${vertexCount}`),
    unit: 0,
    vertices: Array.from({ length: vertexCount }, (_, i) => ({ p: [i % 16, Math.floor(i / 16) % 16, Math.floor(i / 256)] as [number, number, number], c: [1, 1, 1] as [number, number, number] })),
    faces: [[0, 1, 2]],
  }
  useWorkshop.setState({ shards: [shard], currentId: shard.id })
  return shard
}

/** A corner of a 2^3 region well inside the space. */
const BASE: Position = { x: 1n << 40n, y: 1n << 40n, z: 1n << 40n }
const at = (dx: bigint): Position => ({ x: BASE.x + dx, y: BASE.y, z: BASE.z })

function aim(p: Position): void {
  useCyberspace.setState({ cursor: { ...p } })
}

async function hide(vertexCount: number, p: Position): Promise<string> {
  const shard = benchShard(vertexCount)
  // Aimed after the start: BUILD mode turning on puts the cursor on the view.
  useShards.getState().startDeployShard(shard.id)
  aim(p)
  useShards.setState({ deployHeight: 3 })
  await useShards.getState().deploy()
  expect(useShards.getState().deployStatus).toBe('done')
  return useShards.getState().mine[useShards.getState().mine.length - 1].eventId
}

async function move(eventId: string, p: Position): Promise<void> {
  useShards.getState().startEditShard(eventId)
  expect(useShards.getState().pending).toMatchObject({ type: 'shard', edit: { eventId } })
  aim(p)
  await useShards.getState().deploy()
  expect(useShards.getState().deployError).toBeNull()
  expect(useShards.getState().deployStatus).toBe('done')
}

const lastBag = () => [...sent].reverse().find((e) => e.kind === HIDDEN_KIND) as unknown as NostrEvent
const tag = (ev: { tags: string[][] }, name: string) => ev.tags.find((t) => t[0] === name)?.[1]

const realSign = useCyberspace.getState().signEvent

beforeEach(() => {
  sent.length = 0
  refused.clear()
  silent = false
  refuseIf = null
  useCyberspace.setState({ signEvent: realSign })
  useShards.setState({ mine: [], deleted: {}, discovered: {}, pending: null, deployHeight: 0, deployUnit: 0, deployStatus: 'idle', deployError: null, workshopBack: null })
  useCyberspace.setState({ live: true, scaleExp: 0, buildStep: null })
  useBuilder.setState({ active: false, via: null, leftAvatar: false })
  useWorkshop.setState({ open: false })
})

describe('EDIT inside its own region', () => {
  it('replaces the old entry in one bag rewrite, and the new version names the old one', async () => {
    const first = await hide(3, at(1n))
    const old = useShards.getState().mine[0]
    expect(tag(old.inner, 'C')).toBe(positionHex(at(1n), old.plane))
    sent.length = 0
    await move(first, at(5n))
    const mine = useShards.getState().mine
    expect(mine).toHaveLength(1)
    const moved = mine[0]
    expect(moved.eventId).not.toBe(first)
    expect(moved.lookupId).toBe(old.lookupId)
    expect(tag(moved.inner, 'd')).toBe(first)
    expect(tag(moved.inner, 'C')).toBe(positionHex(at(5n), moved.plane))
    // One bag, holding only the new version; nothing deleted on the relay.
    expect(sent.map((e) => e.kind)).toEqual([HIDDEN_KIND])
    const entries = await bagEntries(lastBag(), hexToBytes(moved.keyHex))
    expect(entries.map((e) => (e as NostrEvent).id)).toEqual([moved.eventId])
    expect(useShards.getState().deleted[first]).toBe(true)
  })

  it('keeps the first version as the lineage across a second move', async () => {
    const first = await hide(3, at(1n))
    await move(first, at(5n))
    const second = useShards.getState().mine[0].eventId
    await move(second, at(6n))
    expect(tag(useShards.getState().mine[0].inner, 'd')).toBe(first)
  })

  it('a canceled EDIT leaves everything as it was', async () => {
    const first = await hide(3, at(1n))
    sent.length = 0
    useShards.getState().startEditShard(first)
    aim(at(6n))
    useShards.getState().cancelDeploy(true)
    expect(useShards.getState().mine.map((d) => d.eventId)).toEqual([first])
    expect(sent).toEqual([])
    expect(useWorkshop.getState().open).toBe(false)
  })
})

describe('EDIT into another region', () => {
  it('hides it in the new bag and takes the old bag down', async () => {
    const first = await hide(3, at(1n))
    const old = useShards.getState().mine[0]
    sent.length = 0
    await move(first, at(9n))
    const mine = useShards.getState().mine
    expect(mine).toHaveLength(1)
    expect(mine[0].lookupId).not.toBe(old.lookupId)
    expect(tag(mine[0].inner, 'd')).toBe(first)
    // The new bag first, then the old one deleted (it held nothing else).
    expect(sent.map((e) => e.kind)).toEqual([HIDDEN_KIND, 5])
    expect(sent[1].tags).toContainEqual(['a', `${HIDDEN_KIND}:${useCyberspace.getState().identity.pubkey}:${old.lookupId}`])
  })

  it('a shard hidden by reference keeps its object d and is never retracted', async () => {
    const first = await hide(3000, at(1n))
    const old = useShards.getState().mine[0]
    expect(old.ref).toBeDefined()
    sent.length = 0
    await move(first, at(9n))
    const moved = useShards.getState().mine[0]
    expect(moved.inner.kind).toBe(OBJECT_KIND)
    expect(dOf(moved.inner)).toBe(dOf(old.inner))
    expect(moved.ref?.[1]).toBe(old.ref?.[1])
    expect(sent.some((e) => e.kind === 5 && e.tags.some((t) => t[0] === 'k' && t[1] === String(OBJECT_KIND)))).toBe(false)
  })
})

describe('what EDIT offers', () => {
  it('only a shard is editable', async () => {
    const id = await hide(3, at(1n))
    const d = useShards.getState().mine.find((m) => m.eventId === id)!
    const me = useCyberspace.getState().identity.pubkey
    expect(editable(d, me)).toBe(true)
    expect(editable({ ...d, type: 'message' }, me)).toBe(false)
    expect(editable(d, 'someone else')).toBe(false)
  })

  it('refuses when the shard it moves is gone', async () => {
    const id = await hide(3, at(1n))
    useShards.getState().startEditShard(id)
    useShards.setState({ mine: [] })
    await useShards.getState().deploy()
    expect(useShards.getState().deployStatus).toBe('error')
  })
})

describe('CANCEL on a deploy from the workshop', () => {
  it('goes back to the workshop and ends the BUILD mode the deploy started', () => {
    const shard = benchShard(3)
    useShards.getState().startDeployShard(shard.id, 'workshop')
    expect(useBuilder.getState().active).toBe(true)
    useShards.getState().cancelDeploy(true)
    expect(useBuilder.getState().active).toBe(false)
    expect(useWorkshop.getState().open).toBe(true)
    expect(useWorkshop.getState().currentId).toBe(shard.id)
    expect(useShards.getState().workshopBack).toBeNull()
  })

  it('does not reopen it when BUILD mode ends under the deploy', () => {
    const shard = benchShard(3)
    useShards.getState().startDeployShard(shard.id, 'workshop')
    useShards.getState().cancelDeploy()
    expect(useWorkshop.getState().open).toBe(false)
  })

  it('a deploy started elsewhere does not open the workshop', () => {
    const shard = benchShard(3)
    useShards.getState().startDeployShard(shard.id)
    useShards.getState().cancelDeploy(true)
    expect(useWorkshop.getState().open).toBe(false)
  })
})

describe('the review of #369', () => {
  /** A move that fails: the deploy reports why, and nothing of the old copy changed. */
  async function failedMove(eventId: string, p: Position): Promise<string | null> {
    useShards.getState().startEditShard(eventId)
    aim(p)
    await useShards.getState().deploy()
    expect(useShards.getState().deployStatus).toBe('error')
    return useShards.getState().deployError
  }

  it('a stale row of a moved reference shard never retracts its address, and cannot be edited', async () => {
    const first = await hide(3000, at(1n))
    const stale: MyDeployment = { ...useShards.getState().mine[0] }
    await move(first, at(9n))
    const moved = useShards.getState().mine[0]
    // The row another device kept from before the move.
    useShards.setState({ mine: [...useShards.getState().mine, stale], deleted: {} })
    // Marked, not cleared: the fake relay is what was sent.
    const mark = sent.length
    await useShards.getState().deleteInstance(stale.eventId)
    expect(sent.slice(mark).some((e) => e.kind === 5 && e.tags.some((t) => t[0] === 'a' && t[1] === moved.ref?.[1]))).toBe(false)
    // And from a device that has only the stale row, EDIT refuses.
    useShards.setState({ mine: [stale], deleted: {} })
    expect(await failedMove(stale.eventId, at(17n))).toBe(EDIT_STALE)
  })

  it('a reference move whose bag the signer refuses publishes nothing', async () => {
    const first = await hide(3000, at(1n))
    const before = useShards.getState().mine
    sent.length = 0
    useCyberspace.setState({ signEvent: async (t) => { if (t.kind === HIDDEN_KIND) throw new Error('declined'); return realSign(t) } })
    expect(await failedMove(first, at(9n))).toMatch(/declined/)
    expect(sent).toEqual([])
    expect(useShards.getState().mine).toEqual(before)
  })

  it('a move whose new bag no relay takes keeps the old copy, and puts a reference shard back', async () => {
    const first = await hide(3000, at(1n))
    const old = useShards.getState().mine[0]
    sent.length = 0
    refused.add(HIDDEN_KIND)
    expect(await failedMove(first, at(9n))).toMatch(/stays where it was/)
    expect(sent.some((e) => e.kind === 5)).toBe(false)
    // The resealed object went out, then the old one again, a second newer.
    const objects = sent.filter((e) => e.kind === OBJECT_KIND)
    expect(objects).toHaveLength(2)
    expect(objects[1].content).toBe(old.inner.content)
    expect(objects[1].created_at).toBeGreaterThan(objects[0].created_at!)
    // The one row, still where it was, now keyed by what the relays hold.
    const rows = useShards.getState().mine
    expect(rows).toHaveLength(1)
    expect(rows[0].eventId).toBe(objects[1].id)
    expect(rows[0].lookupId).toBe(old.lookupId)
  })

  it('an inline move whose new bag no relay takes keeps the old copy', async () => {
    const first = await hide(3, at(1n))
    sent.length = 0
    refused.add(HIDDEN_KIND)
    await failedMove(first, at(9n))
    expect(useShards.getState().mine.map((d) => d.eventId)).toEqual([first])
    expect(sent).toEqual([])
  })

  it('after a rolled-back move the shard is this device\'s again: a retry moves it', async () => {
    const first = await hide(3000, at(1n))
    refused.add(HIDDEN_KIND)
    await failedMove(first, at(9n))
    const row = useShards.getState().mine[0]
    expect(row.eventId).not.toBe(first)
    refused.clear()
    await move(row.eventId, at(9n))
    const moved = useShards.getState().mine
    expect(moved).toHaveLength(1)
    expect(moved[0].inner.created_at).toBeGreaterThan(row.inner.created_at)
  })

  it('says no relay answered, not that it moved, when the relays are silent', async () => {
    const first = await hide(3000, at(1n))
    silent = true
    expect(await failedMove(first, at(9n))).toBe(EDIT_UNANSWERED)
  })

  it('asks for no rollback signature while LOCAL', async () => {
    useCyberspace.setState({ live: false })
    const first = await hide(3000, at(1n))
    const kinds: number[] = []
    useCyberspace.setState({ signEvent: async (t) => { kinds.push(t.kind); return realSign(t) } })
    await move(first, at(9n))
    expect(kinds.filter((k) => k === OBJECT_KIND)).toHaveLength(1)
  })

  it('a move whose old version no relay takes back says so, and the next EDIT puts it back first', async () => {
    const first = await hide(3000, at(1n))
    const old = useShards.getState().mine[0]
    // The moved object is taken; the bag and every later object are refused.
    let objects = 0
    refuseIf = (ev) => ev.kind === HIDDEN_KIND || (ev.kind === OBJECT_KIND && ++objects > 1)
    expect(await failedMove(first, at(9n))).toBe(PUT_BACK_PENDING)
    const row = useShards.getState().mine[0]
    expect(row.eventId).toBe(first)
    expect(row.putBack?.content).toBe(old.inner.content)
    // Relays back: EDIT puts the old version back, then moves it.
    refuseIf = null
    await move(first, at(9n))
    const moved = useShards.getState().mine
    expect(moved).toHaveLength(1)
    expect(moved[0].putBack).toBeUndefined()
    expect(moved[0].lookupId).not.toBe(old.lookupId)
  }, 15_000)

  it('MOVE again from the same bar after a rolled-back move moves it', async () => {
    const first = await hide(3000, at(1n))
    refused.add(HIDDEN_KIND)
    await failedMove(first, at(9n))
    refused.clear()
    // No CANCEL: the same bar, the same pending EDIT.
    await useShards.getState().deploy()
    expect(useShards.getState().deployError).toBeNull()
    expect(useShards.getState().deployStatus).toBe('done')
    expect(useShards.getState().mine).toHaveLength(1)
  })
})
