/**
 * A reference that names the same signed event is not decrypted and parsed
 * again at every scan (lib/hidden.ts). A city is mostly references: parsed again,
 * each was new arrays, so ShardMesh, which keys its geometry on them, cut and
 * uploaded it again. Real bags, real keys, real signatures; no relay.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, type NostrEvent } from 'nostr-tools/pure'
import { newShard, type ShardModel } from 'sno-core/shards'
import { regionKeyAt } from '../shardCrypto'
import { bagTemplate, forgetParsedObjects, objectTemplate, referenceTo, type Reference } from '../hidden'
import { forgetOpened, unbagRemembered } from '../foundCache'

const hider = generateSecretKey()
const at = { x: 90_000n, y: 4_000n, z: 71n }
const rk = regionKeyAt(at, 6, 20)
const origin = { at: { x: 89_984n, y: 3_968n, z: 64n }, plane: 0 as const }
const shard: ShardModel = { ...newShard('cistern'), mode: 'points', unit: 4, vertices: [{ p: [0, 0, 0], c: [1, 0, 0] }, { p: [1, 2, 3], c: [0, 1, 0] }] }

async function bag(entries: (NostrEvent | Reference)[], createdAt = 100): Promise<NostrEvent> {
  return finalizeEvent(await bagTemplate(entries, rk.key, rk.lookupId, 6, createdAt), hider)
}
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
    // Room for one of them.
    forgetParsedObjects(a.content.length + 1)
    const firstA = await unbagRemembered(outerA, rk.key, async () => a, origin, 6)
    await unbagRemembered(outerB, rk.key, async () => b, origin, 6)
    const againA = await unbagRemembered(outerA, rk.key, async () => a, origin, 6)
    expect(againA[0].shard).not.toBe(firstA[0].shard)
    expect(forgetParsedObjects()).toBe(1)
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
