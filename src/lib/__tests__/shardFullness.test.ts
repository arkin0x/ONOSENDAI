/**
 * shardFullness.test.ts: the SHARD sheet's fullness bar measures what the
 * hide measures (owner, 2026-11-23). The object a payload seals into, as
 * signed, is the real sealed object's size, byte for byte; the payload limit
 * is the largest that still fits one hidden object, and it is what a split
 * build aims each piece under (lib/pieces.ts largestRemotePiece) while the
 * event is the limit that binds.
 */

import { describe, expect, it } from 'vitest'
import { newShard, toPayload, type ShardModel } from 'sno-core/shards'
import { signedBytes, BAG_SAFE_BYTES } from '../bagSize'
import { objectTemplate } from '../hidden'
import { largestRemotePiece, pieceRefusal } from '../pieces'
import { withAuthoredConstrain } from '../walkConstrain'
import { fullnessOf, fullnessWords, hiddenObjectBytes, HIDE_WHOLE_BYTES, NEAR_FULL, placedApart, wholePayloadLimit } from '../shardFullness'

const KEY = new Uint8Array(32).fill(7)
const D = 'a'.repeat(32)

/** A shard of `n` coloured points on a line, every few a face. */
function shardOf(n: number): ShardModel {
  const s = newShard('fullness test')
  const vertices = Array.from({ length: n }, (_, i) => ({ p: [i % 40, Math.floor(i / 40) % 40, Math.floor(i / 1600)] as [number, number, number], c: [((i * 7) % 255) / 255, ((i * 13) % 255) / 255, ((i * 29) % 255) / 255] as [number, number, number] }))
  const faces = Array.from({ length: Math.floor(n / 3) }, (_, k) => [k * 3, k * 3 + 1, k * 3 + 2] as [number, number, number])
  return { ...s, vertices, faces, mode: 'solid' }
}

const payloadOf = (s: ShardModel): string => JSON.stringify(toPayload(withAuthoredConstrain(s)))
const bytes = (t: string): number => new TextEncoder().encode(t).length

describe('the hidden object a payload seals into', () => {
  it('is exactly the size of the real sealed object, as signed', async () => {
    for (const n of [3, 400, 4000]) {
      const s = shardOf(n)
      const real = signedBytes(await objectTemplate(s, KEY, D, 1_800_000_000))
      expect(hiddenObjectBytes(bytes(payloadOf(s)))).toBe(real)
    }
  })

  it('holds to the hide limit of one event, 240,000 bytes as signed', () => {
    expect(HIDE_WHOLE_BYTES).toBe(BAG_SAFE_BYTES)
    expect(HIDE_WHOLE_BYTES).toBe(240_000)
  })
})

describe('the payload one hide holds whole', () => {
  it('is the largest payload whose object still fits, about 179 KB', () => {
    const n = wholePayloadLimit()
    expect(hiddenObjectBytes(n)).toBeLessThanOrEqual(HIDE_WHOLE_BYTES)
    expect(hiddenObjectBytes(n + 1)).toBeGreaterThan(HIDE_WHOLE_BYTES)
    expect(n).toBeGreaterThan(179_000)
    expect(n).toBeLessThan(180_000)
  })

  it('is what a split build aims each piece under, and what the hide refuses past', () => {
    // A remote signer's relay carries more than one event may be (#865), so the event binds.
    expect(wholePayloadLimit()).toBe(largestRemotePiece())
    const at = 'x'.repeat(wholePayloadLimit())
    expect(pieceRefusal({ payload: at, d: D, name: 'at' }, true)).toBeNull()
    expect(pieceRefusal({ payload: `${at}x`, d: D, name: 'past' }, true)).not.toBeNull()
  })
})

describe('fullnessOf', () => {
  it('is calm until close to full, amber near it, red past it', () => {
    const limit = wholePayloadLimit()
    expect(fullnessOf(1000).level).toBe('calm')
    expect(fullnessOf(Math.floor(limit * 0.6)).level).toBe('calm')
    const near = fullnessOf(Math.ceil(limit * 0.95))
    expect(near.share).toBeGreaterThanOrEqual(NEAR_FULL)
    expect(near.level).toBe('near')
    expect(fullnessOf(limit).level).toBe('near')
    expect(fullnessOf(limit + 1).level).toBe('over')
  })

  it('never says 100% while it fits short of the limit, nor 0% with anything in it', () => {
    const limit = wholePayloadLimit()
    expect(fullnessOf(limit - 2).percent).toBeLessThanOrEqual(99)
    expect(fullnessOf(1).percent).toBe(1)
    expect(fullnessOf(limit + 5000).percent).toBeGreaterThan(100)
  })

  it('says the number in the bytes BYTES ON THE WIRE counts, with colons and no dashes', () => {
    const f = fullnessOf(41_816)
    const words = fullnessWords(f)
    expect(words).toContain('41,816 of ')
    expect(words).toContain(`of ${wholePayloadLimit().toLocaleString('en-US')} bytes`)
    expect(words).toMatch(/^\d+% of what one hide holds: /)
    expect(words).not.toMatch(/—|–/)
    expect(fullnessWords(fullnessOf(wholePayloadLimit() + 1))).toMatch(/^Too big to hide in one piece: /)
  })
})

describe('placedApart', () => {
  it('counts the placements that go out on their own, never a table entry carried inside', () => {
    const me = 'b'.repeat(64)
    const s: Pick<ShardModel, 'refs' | 'parts' | 'objects'> = {
      refs: [['a', `33331:${me}:piece`], ['a', `33331:${me}:carried`], ['a', `33331:${'c'.repeat(64)}:theirs`, 'wss://relay.example']],
      parts: [0, 1, 2, 0].map((ref) => ({ ref, at: [0, 0, 0], turn: [0, 0, 0], step: 0 })),
      objects: { [`33331:${me}:carried`]: {} },
    }
    expect(placedApart(s)).toBe(3)
    expect(placedApart({})).toBe(0)
  })
})
