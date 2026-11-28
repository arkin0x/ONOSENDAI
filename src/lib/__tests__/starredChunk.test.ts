/**
 * starredChunk.test.ts: a saved chunk's words and numbers (owner,
 * 2026-11-28): its name from its finds, the survey card's prompt for a rare
 * find, its card kept and drawn again, and where it is from you: chunks and
 * gibsons, the way facing the sun (left-handed: +Z ahead, +X on your right),
 * the height, and its place on the locator.
 */

import { describe, expect, it } from 'vitest'
import {
  autoLabel, cardOfSnapshot, chunkCentre, chunkKeyAt, chunkName, promptLine, snapshotOf, wayWords, whereIs, locatorPoint, topFinds,
} from '../terrain/starredChunk'
import { chunkKey, parseChunkKey } from '../terrain/coords'
import { surveyCard, assayBlocks } from '../terrain/assay'
import { CELLS, idx } from '../terrain/coords'
import type { ChunkSnapshot } from '../starredChunksRecord'

const BASE = { x: 0x1234567890abcdef12340n, y: 0xfedcba0987654321fed80n, z: 0x0f0f0f0f0f0f0f0f0f0e0n }
const key = (dx: number, dy: number, dz: number, plane = 0): string => chunkKey({ x: BASE.x + BigInt(dx * 32), y: BASE.y + BigInt(dy * 32), z: BASE.z + BigInt(dz * 32), plane })
const head = { x: BASE.x + 16n, y: BASE.y + 16n, z: BASE.z + 16n }

describe('where it is', () => {
  it('facing the sun, +Z is ahead and +X is on your right (left-handed); the arrow turns clockwise from the sun', () => {
    expect(whereIs(head, 0, key(0, 0, 3))).toMatchObject({ way: 'Ahead', deg: 0, chunks: 3n, gibsons: 96n })
    expect(whereIs(head, 0, key(2, 0, 0))).toMatchObject({ way: 'To the right', deg: 90, chunks: 2n })
    expect(whereIs(head, 0, key(-2, 0, 0))).toMatchObject({ way: 'To the left', deg: 270 })
    expect(whereIs(head, 0, key(0, 0, -1))).toMatchObject({ way: 'Behind', deg: 180 })
    expect(whereIs(head, 0, key(3, 0, 3))).toMatchObject({ way: 'Ahead and to the right', deg: 45 })
    expect(whereIs(head, 0, key(-3, 0, -3))).toMatchObject({ way: 'Behind and to the left', deg: 225 })
  })

  it('says the height above or below you, and the largest axis gap as the gibsons', () => {
    expect(whereIs(head, 0, key(0, 2, 1))).toMatchObject({ height: '64 gibsons above you', gibsons: 64n, chunks: 2n })
    expect(whereIs(head, 0, key(1, -1, 0))?.height).toBe('32 gibsons below you')
    expect(whereIs(head, 0, key(1, 0, 0))?.height).toBe('Level with you')
    expect(whereIs({ ...head, y: head.y + 1n }, 0, key(1, 0, 0))?.height).toBe('1 gibson below you')
  })

  it('inside the chunk you are there; in the other plane it says so', () => {
    expect(whereIs(head, 0, key(0, 0, 0))).toMatchObject({ inside: true, way: 'You are in it', chunks: 0n })
    const other = whereIs(head, 1, key(0, 0, 0))
    expect(other?.samePlane).toBe(false)
    expect(other?.inside).toBe(false)
    expect(whereIs(head, 0, 'nonsense')).toBeNull()
  })

  it('the way reads a long way off without losing its proportions', () => {
    const far = 1n << 80n
    expect(wayWords(far, far)).toEqual({ deg: 45, way: 'Ahead and to the right' })
    expect(wayWords(0n, 0n).way).toBe('Straight up or down')
  })

  it('the locator puts the sun at the top: ahead is up the map, right is right; a far chunk sits at the rim', () => {
    const ahead = locatorPoint(whereIs(head, 0, key(0, 0, 1))!)
    expect(ahead.y).toBeLessThan(0)
    expect(ahead.x).toBeCloseTo(0)
    expect(ahead.past).toBe(false)
    const right = locatorPoint(whereIs(head, 0, key(1, 0, 0))!)
    expect(right.x).toBeGreaterThan(0)
    const far = locatorPoint(whereIs(head, 0, key(100, 0, 0))!)
    expect(far.past).toBe(true)
    expect(far.x).toBeCloseTo(1)
    expect(far.span).toBe(16)
  })

  it('a chunk\'s centre and the key a gibson is in', () => {
    const c = parseChunkKey(key(1, 0, 0))!
    expect(chunkCentre(c)).toEqual({ x: c.x + 16n, y: c.y + 16n, z: c.z + 16n })
    expect(chunkKeyAt({ x: c.x + 31n, y: c.y, z: c.z + 5n }, 0)).toBe(key(1, 0, 0))
  })
})

describe('names and the prompt', () => {
  const snap: ChunkSnapshot = { g: 'volcanic', k: 14, m: 11, r: [[42, 2, 0, 0], [7, 40, 3, 1], [8, 0, 5, 0], [1, 9000, 0, 1]], d: '0'.repeat(64), v: 0 }
  it('names a chunk by its best finds left, rarest first; by its ground when it holds nothing rare; your note first', () => {
    expect(autoLabel(snap)).toBe('Glowcore ×2, Cinderrock ×40')
    expect(topFinds(snap, 3)).toEqual([[42, 2], [7, 40]])
    expect(autoLabel({ ...snap, r: [[1, 9000, 0, 1]] })).toBe('Volcanic ground')
    expect(autoLabel(undefined)).toBe('Saved chunk')
    expect(chunkName({ n: 'Glowcore cave', s: snap })).toBe('Glowcore cave')
    expect(chunkName({ s: snap })).toBe('Glowcore ×2, Cinderrock ×40')
  })

  it('the card asks to be starred for Glowcore, Cinderrock and the rare band, never for common rock or Prismite', () => {
    const rows = (ids: number[]) => ({ finds: ids.map((id) => ({ id, name: ['', 'Gridstone'][id] ?? ({ 42: 'Glowcore', 7: 'Cinderrock', 8: 'Prismite', 193: 'Voidpearl' } as Record<number, string>)[id], count: 1, mined: 0, visible: 0, buried: 1, prized: false })) })
    expect(promptLine(rows([42]))).toBe('Glowcore here. Star this chunk to find it again.')
    expect(promptLine(rows([193, 42, 7]))).toBe('Voidpearl and Glowcore here. Star this chunk to find it again.')
    expect(promptLine(rows([7]))).toBe('Cinderrock here. Star this chunk to find it again.')
    expect(promptLine(rows([8]))).toBeNull()
    expect(promptLine(rows([]))).toBeNull()
  })
})

describe('the saved card', () => {
  it('keeps every kind\'s counts, the ground, the hardness and the core, and draws the same card again', () => {
    const b = new Uint8Array(CELLS).fill(1)
    for (let o = 31 * 1024; o < CELLS; o++) b[o] = 0
    b[idx(10, 10, 10)] = 42
    b[idx(11, 10, 10)] = 42
    const mined = new Uint32Array(256)
    mined[1] = 12
    const card = surveyCard(assayBlocks(b), { family: 'volcanic', maxK: 14, meanK: 11.234, top: 7 }, { mined })
    const s = snapshotOf(card, Date.UTC(2026, 10, 28))
    expect(s.g).toBe('volcanic')
    expect(s.k).toBe(14)
    expect(s.m).toBe(11.23)
    expect(s.r[0]).toEqual([42, 2, 0, 0])
    expect(s.d).toHaveLength(64)
    const back = cardOfSnapshot(s)
    expect(back.finds.map((r) => [r.id, r.count, r.mined])).toEqual(card.finds.map((r) => [r.id, r.count, r.mined]))
    expect(back.common.map((r) => [r.id, r.count, r.mined, r.visible])).toEqual(card.common.map((r) => [r.id, r.count, r.mined, r.visible]))
    expect(back.ground?.name).toBe('Volcanic')
    expect(Array.from(back.strata)).toEqual(Array.from(card.strata))
    expect(back.total).toBe(card.total)
    expect(back.minedTotal).toBe(12)
  })
})
