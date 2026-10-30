/**
 * foundCacheOpened.test.ts: a bag a scan has opened is not opened again
 * when the next scan finds it unchanged (arkinox, 2026-10-30, block 101:
 * every crossing of a cube re-decrypted, re-verified and re-parsed every
 * bag around, 300 to 800 ms of main thread among the city's objects).
 * Real bags, real keys, real signatures; no relay.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, type NostrEvent } from 'nostr-tools/pure'
import { newShard, type ShardModel } from 'sno-core/shards'
import { regionKeyAt } from '../shardCrypto'
import { bagTemplate, messageInnerTemplate, objectTemplate, referenceTo, shardInnerTemplate, type Reference } from '../hidden'
import { OPENED_MIN_CHARS, forgetOpened, openedSize, setFoundSink, unbagRemembered } from '../foundCache'

const hider = generateSecretKey()
const at = { x: 90_000n, y: 4_000n, z: 71n }
const rk = regionKeyAt(at, 6, 20)
const shard: ShardModel = { ...newShard('cistern'), mode: 'points', unit: 4, vertices: [{ p: [0, 0, 0], c: [1, 0, 0] }, { p: [1, 2, 3], c: [0, 1, 1] }], faces: [] }

async function bag(entries: (NostrEvent | Reference)[], createdAt = 100, key = rk): Promise<NostrEvent> {
  return finalizeEvent(await bagTemplate(entries, key.key, key.lookupId, 6, createdAt), hider)
}

/** A bag as the city's are: shards and a message inside it, no references. */
async function cityBag(createdAt = 100): Promise<NostrEvent> {
  return bag([
    finalizeEvent(shardInnerTemplate(shard, at, 0, 5), hider),
    finalizeEvent(shardInnerTemplate({ ...shard, name: 'baths' }, { ...at, x: at.x + 3n }, 0, 6), hider),
    finalizeEvent(messageInnerTemplate('the stairway down', at, 0, 7), hider),
  ], createdAt)
}

const origin = { at: { x: 89_984n, y: 3_968n, z: 64n }, plane: 0 as const }

beforeEach(() => { forgetOpened() })
afterEach(() => { setFoundSink(null); forgetOpened() })

describe('a scan does not open again what it already opened', () => {
  it('the same bag found again hands back the very items of the first opening', async () => {
    const outer = await cityBag()
    const first = await unbagRemembered(outer, rk.key, undefined, origin, 6)
    expect(first.map((h) => h.shard?.name ?? h.text)).toEqual(['cistern', 'baths', 'the stairway down'])
    // As the relay hands it over again: a fresh copy of the same event.
    const again = await unbagRemembered(JSON.parse(JSON.stringify(outer)) as NostrEvent, rk.key, undefined, origin, 6)
    expect(again).toHaveLength(3)
    for (let i = 0; i < 3; i++) expect(again[i]).toBe(first[i])
  })

  it('the found store still hears of it every time', async () => {
    const outer = await cityBag()
    const heard: number[] = []
    setFoundSink((_o, _k, items) => { heard.push(items.length) })
    await unbagRemembered(outer, rk.key, undefined, origin, 6)
    await unbagRemembered(outer, rk.key, undefined, origin, 6)
    expect(heard).toEqual([3, 3])
  })

  it('another key, height or place, or a new version of the bag, is opened afresh', async () => {
    const outer = await cityBag()
    const first = await unbagRemembered(outer, rk.key, undefined, origin, 6)
    const elsewhere = await unbagRemembered(outer, rk.key, undefined, { ...origin, at: { ...origin.at, x: origin.at.x + 64n } }, 6)
    expect(elsewhere[0]).not.toBe(first[0])
    const taller = await unbagRemembered(outer, rk.key, undefined, origin, 7)
    expect(taller[0]).not.toBe(first[0])
    // A key that does not open it opens nothing, as before.
    expect(await unbagRemembered(outer, regionKeyAt({ ...at, x: at.x + 10_000n }, 6, 20).key, undefined, origin, 6)).toEqual([])
    const newer = await cityBag(101)
    const reopened = await unbagRemembered(newer, rk.key, undefined, origin, 6)
    expect(reopened[0]).not.toBe(first[0])
    expect(reopened[0].shard?.name).toBe('cistern')
  })

  it('a bag with a reference is opened afresh every time, so an edited object shows', async () => {
    const o = finalizeEvent(await objectTemplate(shard, rk.key, 'kit-1', 50), hider)
    const outer = await bag([referenceTo(o, at, 0, '')])
    let asked = 0
    const resolve = async (): Promise<NostrEvent> => { asked++; return o }
    const first = await unbagRemembered(outer, rk.key, resolve, origin, 6)
    const again = await unbagRemembered(outer, rk.key, resolve, origin, 6)
    expect(asked).toBe(2)
    expect(first).toHaveLength(1)
    expect(again[0]).not.toBe(first[0])
    expect(forgetOpened()).toBe(0)
  })

  it('holds no more than its budget, the least recently opened going first', async () => {
    const a = await cityBag(100)
    const b = await cityBag(101)
    const c = await cityBag(102)
    // Room for two bags of this size, not three.
    expect(openedSize(a)).toBeGreaterThan(OPENED_MIN_CHARS)
    expect(openedSize(b)).toBe(openedSize(a))
    forgetOpened(openedSize(a) * 2 + 10)
    const a1 = await unbagRemembered(a, rk.key, undefined, origin, 6)
    const b1 = await unbagRemembered(b, rk.key, undefined, origin, 6)
    // a is opened again from memory, which makes b the least recent.
    expect((await unbagRemembered(a, rk.key, undefined, origin, 6))[0]).toBe(a1[0])
    await unbagRemembered(c, rk.key, undefined, origin, 6)
    expect((await unbagRemembered(a, rk.key, undefined, origin, 6))[0]).toBe(a1[0])
    expect((await unbagRemembered(b, rk.key, undefined, origin, 6))[0]).not.toBe(b1[0])
  })

  it('counts even a bag that opens to nothing, so their number is bounded too', async () => {
    const outer = await cityBag()
    const wrong = regionKeyAt({ ...at, x: at.x + 10_000n }, 6, 20).key
    forgetOpened(OPENED_MIN_CHARS * 3)
    for (let i = 0; i < 10; i++) await unbagRemembered(outer, wrong, undefined, { ...origin, at: { ...origin.at, z: BigInt(i) * 64n } }, 6)
    expect(forgetOpened()).toBeLessThanOrEqual(3)
  })
})
