/**
 * deployObjectCap.test.ts: the hide refuses, in plain words and before any
 * signing, a shard whose own sealed object would pass 240,000 bytes as signed
 * (lib/shardFullness.ts hideWholeRefusal: the SHARD sheet's bar measures the
 * same), and the deploy bar says so first. Relays are a list in memory. No network.
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

type Ev = { id: string; kind: number; pubkey: string; created_at: number; content: string; tags: string[][]; sig: string }
const relay: Ev[] = []
const matches = (e: Ev, f: { kinds?: number[]; authors?: string[]; ids?: string[]; '#d'?: string[] }): boolean =>
  (!f.kinds || f.kinds.includes(e.kind)) && (!f.authors || f.authors.includes(e.pubkey)) && (!f.ids || f.ids.includes(e.id)) && (!f['#d'] || f['#d'].includes(e.tags.find((t) => t[0] === 'd')?.[1] ?? ''))
/** The newest version at each address, as a relay keeps an addressable event. */
const current = (f: object): Ev[] => {
  const hits = relay.filter((e) => matches(e, f as never))
  const newest = new Map<string, Ev>()
  for (const e of hits) {
    const d = e.tags.find((t) => t[0] === 'd')?.[1]
    const k = e.kind >= 30000 && e.kind < 40000 ? `${e.kind}:${e.pubkey}:${d}` : e.id
    const was = newest.get(k)
    if (!was || e.created_at >= was.created_at) newest.set(k, e)
  }
  return [...newest.values()]
}

vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async (_urls: string[], e: Ev) => { relay.push(e); return { ok: true } }),
  query: vi.fn(async (f: object) => current(f)),
  queryAny: vi.fn(async (_urls: string[], f: object) => current(f)),
  queryEach: vi.fn(async (f: object) => [{ url: 'wss://relay.test', outcome: 'answered', events: current(f) }]),
  relaySet: () => ['wss://relay.test'],
}))

import { renderToStaticMarkup } from 'react-dom/server'
import { newShard, toPayload, type ShardModel } from 'sno-core/shards'
import { HIDDEN_KIND, OBJECT_KIND } from '../../lib/hidden'
import { forgetReferences } from '../../lib/references'
import { forgetPieceKeys } from '../../lib/pieceKeys'
import { saveLedger } from '../../lib/published'
import { publishMany } from '../../lib/relay'
import { wholePayloadLimit } from '../../lib/shardFullness'
import { withAuthoredConstrain } from '../../lib/walkConstrain'
import type { Position } from '../../lib/space'
import { BagMeterRow, OBJECT_TOO_BIG_LINE } from '../../hud/DeployBar'
import { useBuilder } from '../useBuilder'
import { useCyberspace } from '../useCyberspace'
import { deployBagMeter, plannedShard, useShards } from '../useShards'
import { useWorkshop } from '../useWorkshop'

const S = () => useShards.getState()
const C = () => useCyberspace.getState()
const BASE: Position = { x: 1n << 40n, y: 1n << 40n, z: 1n << 40n }

/** A shard of at least `bytes` bytes of payload, and not much more. */
const built = new Map<number, ShardModel>()
function shardOf(bytes: number): ShardModel {
  const held = built.get(bytes)
  if (held) return held
  const base: ShardModel = { ...newShard('Big hall'), id: `big-${bytes}`, unit: 0, mode: 'solid', vertices: [], faces: [[0, 1, 2]] }
  const withN = (count: number): ShardModel => ({ ...base, vertices: Array.from({ length: count }, (_, i) => ({ p: [i % 64, (i >> 6) % 64, (i >> 12) % 64] as [number, number, number], c: [1, 0.5, 0] as [number, number, number] })) })
  const size = (count: number): number => new TextEncoder().encode(JSON.stringify(toPayload(withAuthoredConstrain(withN(count))))).length
  let lo = 3
  let hi = 3
  while (size(hi) < bytes) hi *= 2
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (size(mid) < bytes) lo = mid + 1
    else hi = mid
  }
  const made = withN(lo)
  built.set(bytes, made)
  return made
}
const payloadBytes = (s: ShardModel): number => new TextEncoder().encode(JSON.stringify(toPayload(withAuthoredConstrain(s)))).length

async function hide(shard: ShardModel): Promise<void> {
  useWorkshop.setState({ shards: [shard], currentId: shard.id })
  S().startDeployShard(shard.id)
  useCyberspace.setState({ cursor: { ...BASE } })
  useShards.setState({ deployHeight: 3 })
  await S().deploy()
}

const realSign = useCyberspace.getState().signEvent
const sent = () => vi.mocked(publishMany).mock.calls.map((c) => c[1] as unknown as Ev)

beforeEach(() => {
  saveLedger({})
  relay.length = 0
  vi.mocked(publishMany).mockClear()
  forgetPieceKeys()
  forgetReferences()
  useCyberspace.setState({ signEvent: realSign, live: true, scaleExp: 0, buildStep: null, signerKind: 'local' })
  useShards.setState({ mine: [], deleted: {}, discovered: {}, pending: null, deployHeight: 0, deployUnit: 0, deployTurn: [0, 0, 0], deployStatus: 'idle', deployError: null, workshopBack: null })
  useBuilder.setState({ active: false, via: null, leftAvatar: false })
  useWorkshop.setState({ open: false, shards: [] })
  vi.spyOn(console, 'warn').mockImplementation(() => { /* IndexedDB is absent here */ })
})

describe('a shard too big to hide whole', () => {
  it('is refused in plain words before anything is signed or sent', { timeout: 60_000 }, async () => {
    const big = shardOf(wholePayloadLimit() + 2000)
    expect(payloadBytes(big)).toBeGreaterThan(wholePayloadLimit())
    const signs = vi.fn(realSign)
    useCyberspace.setState({ signEvent: signs })
    await hide(big)
    expect(S().deployStatus).toBe('error')
    expect(S().deployError).toMatch(/^Too big to hide whole: [\d,]+ of 179,477 bytes\. Move part of it into its own shard and place that\. Nothing was sent\.$/)
    expect(signs).not.toHaveBeenCalled()
    expect(sent()).toHaveLength(0)
    expect(S().mine).toHaveLength(0)
  })

  it('goes, by reference, when it is just under the limit', { timeout: 60_000 }, async () => {
    const fits = shardOf(wholePayloadLimit() - 3000)
    expect(payloadBytes(fits)).toBeLessThanOrEqual(wholePayloadLimit())
    await hide(fits)
    expect(S().deployError).toBeNull()
    expect(S().deployStatus).toBe('done')
    const object = sent().find((e) => e.kind === OBJECT_KIND)!
    expect(new TextEncoder().encode(JSON.stringify(object)).length).toBeLessThanOrEqual(240_000)
    expect(sent().some((e) => e.kind === HIDDEN_KIND)).toBe(true)
  })
})

describe('the deploy bar says so first', () => {
  const meterFor = (s: ShardModel) => deployBagMeter([], plannedShard(s, C().identity.pubkey), { height: 3, settings: { heightTag: true, hint: null, riddle: '', contents: false, money: false }, owner: C().identity.pubkey, room: false, place: { at: BASE, plane: 0 } })

  it('the meter carries the refusal for a shard too big to hide whole, and none for one that fits', { timeout: 60_000 }, () => {
    expect(meterFor(shardOf(wholePayloadLimit() + 2000)).objectRefusal).toMatch(/^Too big to hide whole: /)
    expect(meterFor(shardOf(wholePayloadLimit() - 3000)).objectRefusal).toBeNull()
    expect(meterFor(shardOf(2000)).objectRefusal).toBeNull()
  })

  it('the BAG row reads TOO LARGE with what to do', () => {
    const html = renderToStaticMarkup(<BagMeterRow meter={{ bytes: 1000, byReference: true, fitted: false, refusal: null, objectRefusal: 'Too big to hide whole: 1 of 2 bytes.' }} />)
    expect(html).toContain('TOO LARGE')
    expect(html).toContain(OBJECT_TOO_BIG_LINE)
    expect(OBJECT_TOO_BIG_LINE).not.toMatch(/\u2014/)
  })
})
