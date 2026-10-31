/**
 * bagVerifyOnce.test.ts: a bag's entries are Schnorr-checked once a page,
 * not at every scan that finds the bag again (arkinox, 2026-10-30, block
 * 101's city: bags that place objects by reference are opened afresh every
 * scan, so an edited object shows, and every entry beside the reference was
 * verified again each time). Real bags, keys and signatures; no relay.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const counted = vi.hoisted(() => ({ n: 0 }))
vi.mock('nostr-tools/pure', async (importOriginal) => {
  const real = await importOriginal<typeof import('nostr-tools/pure')>()
  return { ...real, verifyEvent: (e: Parameters<typeof real.verifyEvent>[0]) => { counted.n++; return real.verifyEvent(e) } }
})

const { finalizeEvent, generateSecretKey } = await import('nostr-tools/pure')
const { newShard } = await import('sno-core/shards')
const { regionKeyAt } = await import('../shardCrypto')
const { bagTemplate, innerAuthentic, messageInnerTemplate, objectTemplate, referenceTo, shardInnerTemplate } = await import('../hidden')
const { forgetOpened, unbagRemembered } = await import('../foundCache')

const hider = generateSecretKey()
const at = { x: 190_000n, y: 14_000n, z: 171n }
const rk = regionKeyAt(at, 6, 20)
const shard = { ...newShard('crawl tube'), mode: 'points' as const, unit: 4, vertices: [{ p: [0, 0, 0] as [number, number, number], c: [1, 0, 0] as [number, number, number] }], faces: [] }
const origin = { at: { x: 189_952n, y: 13_952n, z: 128n }, plane: 0 as const }

beforeEach(() => { forgetOpened() })

describe('a bag found again is not verified again', () => {
  it('a bag with a reference, opened at every scan, checks each signature once', async () => {
    const object = finalizeEvent(await objectTemplate(shard, rk.key, 'kit-tube', 50), hider)
    const entries = [
      finalizeEvent(shardInnerTemplate(shard, at, 0, 5), hider),
      finalizeEvent(messageInnerTemplate('mind the cascade', at, 0, 6), hider),
      referenceTo(object, at, 0, ''),
    ]
    const outer = finalizeEvent(await bagTemplate(entries, rk.key, rk.lookupId, 6, 100), hider)
    const resolve = async () => JSON.parse(JSON.stringify(object))

    const first = await unbagRemembered(outer, rk.key, resolve, origin, 6)
    expect(first).toHaveLength(3)
    const afterFirst = counted.n
    expect(afterFirst).toBeGreaterThanOrEqual(3)

    const again = await unbagRemembered(JSON.parse(JSON.stringify(outer)), rk.key, resolve, origin, 6)
    expect(again).toHaveLength(3)
    // Opened afresh (it has a reference), but no signature is checked twice.
    expect(again[0]).not.toBe(first[0])
    expect(counted.n).toBe(afterFirst)
  })

  it('an entry already checked, changed in any field, is still refused', () => {
    const m = finalizeEvent(messageInnerTemplate('the stairway down', at, 0, 7), hider)
    expect(innerAuthentic(JSON.parse(JSON.stringify(m)), m.pubkey)).toBe(true)
    expect(innerAuthentic({ ...JSON.parse(JSON.stringify(m)), content: 'the stairway up' }, m.pubkey)).toBe(false)
    expect(innerAuthentic({ ...JSON.parse(JSON.stringify(m)), created_at: m.created_at + 1 }, m.pubkey)).toBe(false)
    expect(innerAuthentic({ ...JSON.parse(JSON.stringify(m)), sig: 'ab'.repeat(64) }, m.pubkey)).toBe(false)
  })
})
