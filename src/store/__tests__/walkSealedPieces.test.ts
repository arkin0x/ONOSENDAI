/**
 * walkSealedPieces.test.ts: WALK stops at a split build's sealed pieces
 * (lib/pieces.ts) as it stops at any placed object: the piece is opened with
 * the key of the bag its parent was read from and its faces hold the walker.
 * Without the key the piece is a placeholder, and nothing holds there.
 * Relays are a map in memory. No network.
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

const relay = vi.hoisted(() => ({ events: [] as Array<{ kind: number; pubkey: string; tags: string[][] }> }))
vi.mock('../../lib/relay', () => {
  const answer = async (f: { kinds?: number[]; authors?: string[]; '#d'?: string[] }): Promise<unknown[]> => relay.events.filter((e) => (!f.kinds || f.kinds.includes(e.kind)) && (!f.authors || f.authors.includes(e.pubkey)) && (!f['#d'] || f['#d'].includes(e.tags.find((t) => t[0] === 'd')?.[1] ?? '')))
  return {
    publishMany: vi.fn(async () => ({ ok: true })),
    query: vi.fn(answer),
    queryAny: vi.fn((_r: string[], f: Parameters<typeof answer>[0]) => answer(f)),
    queryEach: vi.fn(async (f: Parameters<typeof answer>[0]) => [{ url: 'wss://relay.test', outcome: 'answered', events: await answer(f) }]),
    relaySet: () => ['wss://relay.test'],
  }
})
vi.mock('../../lib/contacts', () => ({ GENERAL_RELAYS: [], followsOf: async () => [], fetchContacts: async () => [] }))

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { newShard, toPayload, type ShardModel } from 'sno-core/shards'
import { objectTemplateOf } from '../../lib/hidden'
import { bytesToHex } from '../../lib/events'
import { forgetRef } from '../../lib/parts'
import { forgetPieceKeys, notePieceKeys } from '../../lib/pieceKeys'
import { withConstrain } from '../../lib/walkConstrain'
import type { Position } from '../../lib/space'
import { clearWalls, stepLimit, type WallItem } from '../walkWalls'

const AT: Position = { x: 1n << 60n, y: 3n << 58n, z: 5n << 57n }
const sk = generateSecretKey()
const ME = getPublicKey(sk)
const KEY = new Uint8Array(32).fill(5)

/** A slab two ticks thick across +X, its near face 3 units out, 2 units each way. */
function slab(): ShardModel {
  const verts: ShardModel['vertices'] = []
  for (const x of [360, 362]) for (const [y, z] of [[-240, -240], [240, -240], [240, 240], [-240, 240]]) {
    const t = [x, y, z]
    const p = t.map((v) => Math.floor(v / 120)) as [number, number, number]
    const r = t.map((v, n) => v - p[n] * 120) as [number, number, number]
    verts.push(r.some((v) => v !== 0) ? { p, t: r, c: [1, 1, 1] } : { p, c: [1, 1, 1] })
  }
  const q = (a: number, b: number, c: number, e: number): number[][] => [[a, b, c], [a, c, e]]
  const faces = [...q(0, 1, 2, 3), ...q(4, 7, 6, 5), ...q(0, 4, 5, 1), ...q(1, 5, 6, 2), ...q(2, 6, 7, 3), ...q(3, 7, 4, 0)] as Array<[number, number, number]>
  return withConstrain({ ...newShard('Slab'), unit: 0, mode: 'solid', vertices: verts, faces }, 'all')
}

const item = (shard: ShardModel): WallItem => ({ key: `k-${shard.id}-${Math.random()}`, at: { ...AT }, height: 84, plane: 1, shard })
const settle = async (): Promise<void> => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)) }

beforeEach(() => {
  clearWalls()
  forgetPieceKeys()
  relay.events = []
})

describe('WALK and a split build', () => {
  it('a sealed piece opened with its bag key holds the walker; without the key nothing holds', async () => {
    const d = 'ab'.repeat(16)
    const address = `33331:${ME}:${d}`
    relay.events.push(finalizeEvent(await objectTemplateOf(JSON.stringify(toPayload(slab())), KEY, d, 1_800_000_000), sk))
    const parent = withConstrain({ ...newShard('Split wall'), mode: 'solid', vertices: [], faces: [], refs: [['a', address]], parts: [{ ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: 0 }] }, 'off')

    // No key: the piece does not open, and nothing stands in the way.
    const blind = item(parent)
    stepLimit(AT, 'x', 1, 1n, [blind])
    await settle()
    expect(stepLimit(AT, 'x', 1, 10n, [blind]).reach).toBe(10n)

    // The bag's key, noted as a scan notes it: the piece's face stops the walk one short.
    clearWalls()
    forgetRef(['a', address])
    notePieceKeys(parent, ME, bytesToHex(KEY))
    const seen = item(parent)
    stepLimit(AT, 'x', 1, 1n, [seen])
    await settle()
    expect(stepLimit(AT, 'x', 1, 10n, [seen]).reach).toBe(2n)
  })
})
