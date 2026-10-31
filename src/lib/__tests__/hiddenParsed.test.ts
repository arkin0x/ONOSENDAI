/**
 * A reference that names the same signed event is not decrypted and parsed
 * again at every scan (lib/hidden.ts). A city is mostly references: parsed again,
 * each was new arrays, so ShardMesh, which keys its geometry on them, cut and
 * uploaded it again. Real bags, real keys, real signatures; no relay.
 */
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey, type NostrEvent } from 'nostr-tools/pure'
import { newShard, toPayload, type ShardModel } from 'sno-core/shards'
import { regionKeyAt } from '../shardCrypto'
import { PARSED_KEPT_CHARS, bagTemplate, forgetParsedObjects, objectTemplate, referenceTo, type Reference } from '../hidden'
import { OPENED_KEPT_CHARS, forgetOpened, unbagRemembered } from '../foundCache'
import { onRescan } from '../rescanSignal'

const hider = generateSecretKey()
const at = { x: 90_000n, y: 4_000n, z: 71n }
const rk = regionKeyAt(at, 6, 20)
const origin = { at: { x: 89_984n, y: 3_968n, z: 64n }, plane: 0 as const }
const shard: ShardModel = { ...newShard('cistern'), mode: 'points', unit: 4, vertices: [{ p: [0, 0, 0], c: [1, 0, 0] }, { p: [1, 2, 3], c: [0, 1, 0] }] }

async function bag(entries: (NostrEvent | Reference)[], createdAt = 100): Promise<NostrEvent> {
  return finalizeEvent(await bagTemplate(entries, rk.key, rk.lookupId, 6, createdAt), hider)
}
const sealedSize = (o: NostrEvent): number => (o.tags.find((t) => t[0] === 'encrypted')?.[2].length ?? 0) + o.content.length
const object = async (s: ShardModel, createdAt = 50): Promise<NostrEvent> => finalizeEvent(await objectTemplate(s, rk.key, 'kit-1', createdAt), hider)

beforeEach(() => { forgetOpened() })
afterEach(() => { forgetOpened() })

describe('a reference found again', () => {
  it('hands back the same model, with the same arrays, so nothing is cut or uploaded again', async () => {
    const o = await object(shard)
    const outer = await bag([referenceTo(o, at, 0, '')])
    const first = await unbagRemembered(outer, rk.key, async () => o, origin, 6)
    // As a relay hands it over again: a fresh copy of the same event.
    const again = await unbagRemembered(outer, rk.key, async () => JSON.parse(JSON.stringify(o)) as NostrEvent, origin, 6)
    expect(again[0].shard).toBeDefined()
    expect(again[0].shard).toBe(first[0].shard)
    expect(again[0].shard!.vertices).toBe(first[0].shard!.vertices)
  })

  it('still asks for the reference every time, so an edit is seen', async () => {
    const o = await object(shard)
    const outer = await bag([referenceTo(o, at, 0, '')])
    let asked = 0
    const resolve = async (): Promise<NostrEvent> => { asked++; return o }
    await unbagRemembered(outer, rk.key, resolve, origin, 6)
    await unbagRemembered(outer, rk.key, resolve, origin, 6)
    expect(asked).toBe(2)
  })

  it('an edit is a new event, so a new model', async () => {
    const o = await object(shard)
    const outer = await bag([referenceTo(o, at, 0, '')])
    const first = await unbagRemembered(outer, rk.key, async () => o, origin, 6)
    const edited = await object({ ...shard, name: 'cistern, edited' }, 51)
    const again = await unbagRemembered(outer, rk.key, async () => edited, origin, 6)
    expect(again[0].shard?.name).toBe('cistern, edited')
    expect(first[0].shard?.name).toBe('cistern')
  })

  it('a tampered copy with the same id fails its signature and is never answered from here', async () => {
    const o = await object(shard)
    const outer = await bag([referenceTo(o, at, 0, '')])
    await unbagRemembered(outer, rk.key, async () => o, origin, 6)
    // Through JSON, as a relay hands it over: a spread would carry nostr-tools' mark that it has been verified.
    const forged = { ...JSON.parse(JSON.stringify(o)), sig: '0'.repeat(128) } as NostrEvent
    expect(await unbagRemembered(outer, rk.key, async () => forged, origin, 6)).toEqual([])
  })

  it('is not kept across a change of identity: it is plaintext', async () => {
    const o = await object(shard)
    const outer = await bag([referenceTo(o, at, 0, '')])
    const first = await unbagRemembered(outer, rk.key, async () => o, origin, 6)
    forgetOpened()
    const again = await unbagRemembered(outer, rk.key, async () => o, origin, 6)
    expect(again[0].shard).not.toBe(first[0].shard)
  })

  it('holds no more than its budget, the least recently found out first', async () => {
    const a = await object(shard, 50)
    const b = await object({ ...shard, name: 'other' }, 51)
    const outerA = await bag([referenceTo(a, at, 0, '')], 100)
    const outerB = await bag([referenceTo(b, at, 0, '')], 101)
    // Room for one of them, by its sealed size: a preview is the same length for all.
    forgetParsedObjects(sealedSize(a) + 1)
    const firstA = await unbagRemembered(outerA, rk.key, async () => a, origin, 6)
    await unbagRemembered(outerB, rk.key, async () => b, origin, 6)
    const againA = await unbagRemembered(outerA, rk.key, async () => a, origin, 6)
    expect(againA[0].shard).not.toBe(firstA[0].shard)
    expect(forgetParsedObjects()).toBe(1)
  })

  it('counts a sealed object by its sealed text, not its short public preview (review of #567)', async () => {
    const big = (i: number): ShardModel => ({ ...newShard(`o${i}`), mode: 'points', unit: 4, vertices: Array.from({ length: 300 }, (_, k) => ({ p: [k, i, 0] as [number, number, number], c: [1, 0, 0] as [number, number, number] })) })
    const first = await object(big(0), 50)
    expect(first.content.length).toBeLessThan(200)
    expect(sealedSize(first)).toBeGreaterThan(2000)
    // Far more previews than this holds, and room for only about two objects.
    forgetParsedObjects(sealedSize(first) * 2 + 500)
    for (let i = 0; i < 12; i++) {
      const o = await object(big(i), 50 + i)
      await unbagRemembered(await bag([referenceTo(o, at, 0, '')], 100 + i), rk.key, async () => o, origin, 6)
    }
    expect(forgetParsedObjects()).toBeLessThanOrEqual(3)
  })

  it('stays at the bound opened bags have', () => {
    expect(PARSED_KEPT_CHARS).toBe(OPENED_KEPT_CHARS)
  })

  it('an object with a table says a scan found it again, so a part still missing asks again (review of #567)', async () => {
    const piece = `33331:${getPublicKey(hider)}:kit-2`
    const withTable: ShardModel = { ...shard, objects: { [piece]: toPayload({ ...shard, name: 'carried' }) } } as unknown as ShardModel
    const o = await object(withTable)
    const outer = await bag([referenceTo(o, at, 0, '')])
    const heard = vi.fn()
    const stop = onRescan(heard)
    try {
      const first = await unbagRemembered(outer, rk.key, async () => o, origin, 6)
      expect(first[0].shard?.objects).toBeDefined()
      await Promise.resolve()
      heard.mockClear()
      await unbagRemembered(outer, rk.key, async () => o, origin, 6)
      await new Promise((r) => { setTimeout(r, 0) })
      expect(heard).toHaveBeenCalledTimes(1)
    } finally { stop() }
  })

  it('an object with no table says nothing: it never asked again by a scan', async () => {
    const o = await object(shard)
    const outer = await bag([referenceTo(o, at, 0, '')])
    const heard = vi.fn()
    const stop = onRescan(heard)
    try {
      await unbagRemembered(outer, rk.key, async () => o, origin, 6)
      await unbagRemembered(outer, rk.key, async () => o, origin, 6)
      await new Promise((r) => { setTimeout(r, 0) })
      expect(heard).not.toHaveBeenCalled()
    } finally { stop() }
  })

  it('a draw with a table listens, and only asks again with a part missing', () => {
    const text = fs.readFileSync(path.resolve(__dirname, '../parts.ts'), 'utf8')
    expect(text).toMatch(/if \(!carried\) return\n\s*return onRescan\(\(\) => \{ if \(missing\.current && !pending\.current\) setAgain/)
  })

  it('an object larger than the budget is not kept at all', async () => {
    const a = await object(shard)
    const outer = await bag([referenceTo(a, at, 0, '')])
    forgetParsedObjects(10)
    const first = await unbagRemembered(outer, rk.key, async () => a, origin, 6)
    expect(first).toHaveLength(1)
    expect(forgetParsedObjects()).toBe(0)
  })
})
