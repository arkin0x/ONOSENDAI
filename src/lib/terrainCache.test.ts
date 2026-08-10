/**
 * The terrain cache keys on the block, not the cell, because K is constant
 * across a 2^min(cellBits) cube. That is load-bearing: if it stopped holding,
 * the cache would serve one block member's K for every cell inside it and the
 * terrain would be quietly wrong rather than visibly broken.
 *
 * The invariant follows from the alignment structure in spec 5.2 rather than
 * from the specific value 3, so these assert it against the real terrainK for
 * whatever DEFAULT_CELL_BITS currently is.
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_CELL_BITS, PLANE_DATASPACE, PLANE_IDEASPACE, terrainK } from 'cyberspace-core'
import { BLOCK_BITS, BLOCK_SIZE } from './terrainCache'

const AXIS_MAX = (1n << 85n) - 1n

/** Deterministic 85-bit spread, so a failure is reproducible. */
function sample(i: number): bigint {
  const a = BigInt(i + 1) * 0x9e3779b97f4a7c15n
  return ((a * a) >> 7n) & AXIS_MAX
}

describe('terrain block invariant', () => {
  it('derives the block size from the finest cell-bits entry', () => {
    expect(BLOCK_BITS).toBe(BigInt(Math.min(...DEFAULT_CELL_BITS)))
    expect(BLOCK_SIZE).toBe(1n << BLOCK_BITS)
  })

  it('holds K constant across every offset within a block', () => {
    const size = Number(BLOCK_SIZE)

    for (const plane of [PLANE_DATASPACE, PLANE_IDEASPACE] as const) {
      for (let t = 0; t < 12; t++) {
        const bx = (sample(t * 3) >> BLOCK_BITS) << BLOCK_BITS
        const by = (sample(t * 3 + 1) >> BLOCK_BITS) << BLOCK_BITS
        const bz = (sample(t * 3 + 2) >> BLOCK_BITS) << BLOCK_BITS
        const expected = terrainK(bx, by, bz, plane)

        for (let dx = 0; dx < size; dx++) {
          for (let dy = 0; dy < size; dy++) {
            for (let dz = 0; dz < size; dz++) {
              expect(terrainK(bx + BigInt(dx), by + BigInt(dy), bz + BigInt(dz), plane))
                .toBe(expected)
            }
          }
        }
      }
    }
  })

  it('holds at the universe boundaries', () => {
    const top = ((AXIS_MAX >> BLOCK_BITS) << BLOCK_BITS)
    for (const [bx, by, bz] of [[0n, 0n, 0n], [top, top, top], [0n, top, 0n]]) {
      const expected = terrainK(bx, by, bz, PLANE_DATASPACE)
      for (let d = 1n; d < BLOCK_SIZE; d++) {
        expect(terrainK(bx + d, by, bz, PLANE_DATASPACE)).toBe(expected)
        expect(terrainK(bx, by + d, bz, PLANE_DATASPACE)).toBe(expected)
      }
    }
  })

  it('still distinguishes neighbouring blocks and planes', () => {
    // Guards against a vacuous pass: if K were constant everywhere the
    // invariant above would hold for the wrong reason.
    let differing = 0
    for (let t = 0; t < 40; t++) {
      const b = (sample(t) >> BLOCK_BITS) << BLOCK_BITS
      if (terrainK(b, b, b, PLANE_DATASPACE) !== terrainK(b + BLOCK_SIZE, b, b, PLANE_DATASPACE)) {
        differing++
      }
    }
    expect(differing).toBeGreaterThan(10)

    let planeDiffering = 0
    for (let t = 0; t < 40; t++) {
      const b = (sample(t) >> BLOCK_BITS) << BLOCK_BITS
      if (terrainK(b, b, b, PLANE_DATASPACE) !== terrainK(b, b, b, PLANE_IDEASPACE)) {
        planeDiffering++
      }
    }
    expect(planeDiffering).toBeGreaterThan(10)
  })
})
