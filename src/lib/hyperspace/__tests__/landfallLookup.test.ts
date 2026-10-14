/**
 * landfallLookup.test.ts - a /C/ link names a stop by a block's merkle root,
 * its hash, or the stop's own coordinate (arkinox, 2026-10-14). A port's
 * coordinate is its root; a landfall's is derived from the hash, and the
 * index keeps only its approximation, so the exact one is checked.
 */
import { describe, expect, it } from 'vitest'
import { appendStops, createStopIndex, rowByLandfallCoord, rowByRootOrHash } from '../compactIndex'
import { landfallCoord, landfallCoordApprox } from '../landfall'
import { hexToBytes } from '../../events'
import type { Stop } from '../stops'

const PORT_ROOT = '6edfc6badd201e338a5003ac86485f273838406c7825caae704e71824c985e93'
const LF_ROOT = '0cfb54e522b07bd1a381adc774ec1851590ef4c3add83958135106534569f970'
const LF_HASH = '000000000000000000010538edbfd2d5b809a33dd83f284aeea41c6d0d96968a'

const hex32 = (n: bigint): string => n.toString(16).padStart(64, '0')

function index() {
  const port: Stop = { height: 971270, kind: 'port', merkleRoot: PORT_ROOT, blockHash: null, coordExact: BigInt('0x' + PORT_ROOT), coordApprox: BigInt('0x' + PORT_ROOT) }
  const landfall: Stop = { height: 900000, kind: 'landfall', merkleRoot: LF_ROOT, blockHash: LF_HASH, coordExact: null, coordApprox: landfallCoordApprox(LF_HASH) }
  const idx = createStopIndex()
  appendStops(idx, [port, landfall])
  return idx
}

describe('finding a stop from a /C/ argument', () => {
  it('a port by its merkle root, a landfall by its root or its hash', () => {
    const idx = index()
    expect(rowByRootOrHash(idx, hexToBytes(PORT_ROOT))).toBe(0)
    expect(rowByRootOrHash(idx, hexToBytes(LF_ROOT))).toBe(1)
    expect(rowByRootOrHash(idx, hexToBytes(LF_HASH))).toBe(1)
  })

  it("a landfall by its own exact stop coordinate (its anchor's C tag)", () => {
    const idx = index()
    const exact = landfallCoord(LF_HASH)
    expect(rowByRootOrHash(idx, hexToBytes(hex32(exact)))).toBe(-1)
    expect(rowByLandfallCoord(idx, hexToBytes(hex32(exact)))).toBe(1)
  })

  it('not by a near miss, not by its approximation, and never a port', () => {
    const idx = index()
    const exact = landfallCoord(LF_HASH)
    const approx = landfallCoordApprox(LF_HASH)
    expect(approx).not.toBe(exact)
    expect(rowByLandfallCoord(idx, hexToBytes(hex32(approx)))).toBe(-1)
    expect(rowByLandfallCoord(idx, hexToBytes(hex32(exact ^ (1n << 8n))))).toBe(-1)
    expect(rowByLandfallCoord(idx, hexToBytes(PORT_ROOT))).toBe(-1)
  })

  it('unknown hex is no stop at all', () => {
    const idx = index()
    const nothing = hexToBytes('a'.repeat(63) + '0')
    expect(rowByRootOrHash(idx, nothing)).toBe(-1)
    expect(rowByLandfallCoord(idx, nothing)).toBe(-1)
  })
})
