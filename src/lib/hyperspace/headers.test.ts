/**
 * What would fail silently without these tests: a byte-order slip anywhere in
 * the record layout would make every block hash wrong yet still produce a
 * plausible-looking cloud of stops; a PoW or checkpoint check that never
 * actually fired would turn the "self-verifying" blobs into blind trust of a
 * static file host. So the format is pinned against REAL mainnet headers
 * (blocks 0-5, hardcoded from the wire), and every failure path is exercised
 * with a deliberate corruption.
 */
import { describe, expect, it } from 'vitest'
import { bytesToHex, hexToBytes } from '../events'
import { planeOfMerkleRoot } from './stops'
import { landfallCoordApprox } from './landfall'
import {
  HEADER_RECORD_SIZE,
  bigToBytes32,
  bytesToBigAt,
  decodeCompactTarget,
  genesisState,
  hashMeetsTarget,
  readRecord,
  reverse32,
  sha256d,
  verifyAndDerive,
  wireHeader,
  writeRecord,
  type HeaderRecord,
} from './headers'

// The first six mainnet block headers, exactly as they appear on the wire
// (fetched from mempool.space and frozen here; the genesis hex is the one
// every Bitcoin implementation embeds).
const HEADERS = [
  '0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a29ab5f49ffff001d1dac2b7c',
  '010000006fe28c0ab6f1b372c1a6a246ae63f74f931e8365e15a089c68d6190000000000982051fd1e4ba744bbbe680e1fee14677ba1a3c3540bf7b1cdb606e857233e0e61bc6649ffff001d01e36299',
  '010000004860eb18bf1b1620e37e9490fc8a427514416fd75159ab86688e9a8300000000d5fdcc541e25de1c7a5addedf24858b8bb665c9f36ef744ee42c316022c90f9bb0bc6649ffff001d08d2bd61',
  '01000000bddd99ccfda39da1b108ce1a5d70038d0a967bacb68b6b63065f626a0000000044f672226090d85db9a9f2fbfe5f0f9609b387af7be5b7fbb7a1767c831c9e995dbe6649ffff001d05e0ed6d',
  '010000004944469562ae1c2c74d9a535e00b6f3e40ffbad4f2fda3895501b582000000007a06ea98cd40ba2e3288262b28638cec5337c1456aaf5eedc8e9e5a20f062bdf8cc16649ffff001d2bfee0a9',
  '0100000085144a84488ea88d221c8bd6c059da090e88f8a2c99690ee55dbba4e00000000e11c48fecdd9e72510ca84f023370c9a38bf91ac5cae88019bee94d24528526344c36649ffff001d1d03e477',
]

// The corresponding display (byte-reversed sha256d) block ids.
const IDS = [
  '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
  '00000000839a8e6886ab5951d76f411475428afc90947ee320161bbf18eb6048',
  '000000006a625f06636b8bb6ac7b960a8d03705d1ace08b1a19da3fdcc99ddbd',
  '0000000082b5015589a3fdf2d4baff403e6f0be035a5d9742c1cae6295464449',
  '000000004ebadb55ee9096c9a2f8880e09da59c0d68b1c228da88e48844a1485',
  '000000009b7262315dbf071787ad3656097b892abffd1f95a1a022f896f533fc',
]

function recordFromWireHex(hex: string): HeaderRecord {
  const bytes = hexToBytes(hex)
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return {
    version: dv.getInt32(0, true),
    merkleInternal: bytes.subarray(36, 68),
    time: dv.getUint32(68, true),
    bits: dv.getUint32(72, true),
    nonce: dv.getUint32(76, true),
  }
}

function packBlob(records: HeaderRecord[]): Uint8Array {
  const out = new Uint8Array(records.length * HEADER_RECORD_SIZE)
  records.forEach((rec, i) => writeRecord(out, i, rec))
  return out
}

const realBlob = (): Uint8Array => packBlob(HEADERS.map(recordFromWireHex))
const noChecks = { finalHashHex: null, embedded: new Map<number, string>() }

describe('record layout', () => {
  it('pack/unpack round-trips every real header', () => {
    for (const hex of HEADERS) {
      const rec = recordFromWireHex(hex)
      const buf = new Uint8Array(HEADER_RECORD_SIZE)
      writeRecord(buf, 0, rec)
      const back = readRecord(buf, 0)
      expect(back.version).toBe(rec.version)
      expect(bytesToHex(back.merkleInternal)).toBe(bytesToHex(rec.merkleInternal))
      expect(back.time).toBe(rec.time)
      expect(back.bits).toBe(rec.bits)
      expect(back.nonce).toBe(rec.nonce)
    }
  })

  it('reconstructs the exact genesis wire header from a record plus zeros', () => {
    const rec = recordFromWireHex(HEADERS[0])
    expect(bytesToHex(wireHeader(rec, new Uint8Array(32)))).toBe(HEADERS[0])
  })
})

describe('compact bits', () => {
  it('decodes the genesis target', () => {
    const target = decodeCompactTarget(0x1d00ffff)
    expect(target).not.toBeNull()
    expect(bytesToHex(target as Uint8Array)).toBe('00000000ffff' + '0'.repeat(52))
  })

  it('rejects negative and zero encodings', () => {
    expect(decodeCompactTarget(0x1d80ffff)).toBeNull()
    expect(decodeCompactTarget(0x1d000000)).toBeNull()
  })

  it('compares the display hash against the target bytewise', () => {
    const target = decodeCompactTarget(0x1d00ffff) as Uint8Array
    expect(hashMeetsTarget(hexToBytes(IDS[0]), target)).toBe(true)
    const above = target.slice()
    above[31] += 1 // exactly target + 1
    expect(hashMeetsTarget(above, target)).toBe(false)
    expect(hashMeetsTarget(target, target)).toBe(true)
  })
})

describe('verifyAndDerive over real mainnet headers', () => {
  it('reconstructs the known block ids with linkage, PoW and checkpoints', () => {
    const verdict = verifyAndDerive(realBlob(), 0, 6, genesisState(), {
      finalHashHex: IDS[5],
      embedded: new Map([[0, IDS[0]]]),
    })
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    const { columns, state } = verdict
    for (let i = 0; i < 6; i++) {
      expect(bytesToHex(columns.hashes.subarray(i * 32, i * 32 + 32))).toBe(IDS[i])
    }
    // The carried state seeds the next blob: it must be block 5's own hash.
    expect(bytesToHex(reverse32(state.prevHashInternal))).toBe(IDS[5])
    expect(state.prevBits).toBe(0x1d00ffff)
  })

  it('extracts the plane bit as the display merkle LSB', () => {
    const verdict = verifyAndDerive(realBlob(), 0, 6, genesisState(), noChecks)
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    for (let i = 0; i < 6; i++) {
      const merkleHex = bytesToHex(verdict.columns.merkles.subarray(i * 32, i * 32 + 32))
      expect(verdict.columns.kinds[i]).toBe(planeOfMerkleRoot(merkleHex))
      expect(verdict.columns.kinds[i]).toBe(parseInt(merkleHex[63], 16) & 1)
    }
  })

  it('derives coords per kind, and keys as coord >> 1 in sorted order', () => {
    const verdict = verifyAndDerive(realBlob(), 0, 6, genesisState(), noChecks)
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    const { columns } = verdict
    for (let i = 0; i < 6; i++) {
      const coord = bytesToBigAt(columns.coords, i * 32)
      expect(bytesToBigAt(columns.keys, i * 32)).toBe(coord >> 1n)
      if (columns.kinds[i] === 1) {
        // A port sits at its merkle root's coordinate.
        expect(bytesToHex(columns.coords.subarray(i * 32, i * 32 + 32)))
          .toBe(bytesToHex(columns.merkles.subarray(i * 32, i * 32 + 32)))
      } else {
        const hashHex = bytesToHex(columns.hashes.subarray(i * 32, i * 32 + 32))
        expect(coord).toBe(landfallCoordApprox(hashHex))
      }
    }
    // The order permutation really is ascending by key bytes.
    for (let k = 1; k < 6; k++) {
      const a = bytesToBigAt(columns.keys, columns.order[k - 1] * 32)
      const b = bytesToBigAt(columns.keys, columns.order[k] * 32)
      expect(a <= b).toBe(true)
    }
  })

  it('fails on a tampered byte, anywhere it lands', () => {
    // Merkle byte: block 3's own hash changes, so its PoW check collapses.
    const tamperedMerkle = realBlob()
    tamperedMerkle[3 * HEADER_RECORD_SIZE + 10] ^= 0xff
    expect(verifyAndDerive(tamperedMerkle, 0, 6, genesisState(), noChecks).ok).toBe(false)
    // Nonce byte: same record, different field.
    const tamperedNonce = realBlob()
    tamperedNonce[2 * HEADER_RECORD_SIZE + 45] ^= 0x01
    expect(verifyAndDerive(tamperedNonce, 0, 6, genesisState(), noChecks).ok).toBe(false)
  })

  it('fails on checkpoint disagreement, manifest or embedded', () => {
    const wrongFinal = verifyAndDerive(realBlob(), 0, 6, genesisState(), {
      finalHashHex: IDS[4],
      embedded: new Map(),
    })
    expect(wrongFinal.ok).toBe(false)
    if (!wrongFinal.ok) expect(wrongFinal.reason).toMatch(/checkpoint/)
    const wrongEmbedded = verifyAndDerive(realBlob(), 0, 6, genesisState(), {
      finalHashHex: IDS[5],
      embedded: new Map([[0, IDS[1]]]),
    })
    expect(wrongEmbedded.ok).toBe(false)
    if (!wrongEmbedded.ok) expect(wrongEmbedded.reason).toMatch(/embedded/)
  })

  it('fails on a size mismatch instead of reading garbage', () => {
    expect(verifyAndDerive(realBlob().subarray(0, 47), 0, 1, genesisState(), noChecks).ok).toBe(false)
  })
})

describe('the 2016-block bits window', () => {
  // A permissive target (top byte 0x7f) so records can be "mined" in a couple
  // of tries; the window RULE is what is under test, not difficulty.
  const EASY = 0x207fff00
  const EASY2 = 0x207ffe00

  function mine(prev: Uint8Array, bits: number, seed: number): HeaderRecord {
    const merkle = new Uint8Array(32)
    merkle[0] = seed & 0xff
    merkle[31] = (seed >>> 8) & 0xff
    const target = decodeCompactTarget(bits) as Uint8Array
    for (let nonce = 0; ; nonce++) {
      const rec: HeaderRecord = { version: 0x20000000, merkleInternal: merkle, time: 1700000000 + seed, bits, nonce }
      if (hashMeetsTarget(reverse32(sha256d(wireHeader(rec, prev))), target)) return rec
    }
  }

  function minedChain(startHeight: number, count: number, bitsAt: (h: number) => number): Uint8Array {
    let prev: Uint8Array = new Uint8Array(32)
    const records: HeaderRecord[] = []
    for (let i = 0; i < count; i++) {
      const rec = mine(prev, bitsAt(startHeight + i), i)
      records.push(rec)
      prev = sha256d(wireHeader(rec, prev))
    }
    return packBlob(records)
  }

  it('allows a bits change exactly at a retarget boundary', () => {
    const blob = minedChain(2014, 4, (h) => (h >= 2016 ? EASY2 : EASY))
    const state = { prevHashInternal: new Uint8Array(32), prevBits: null }
    expect(verifyAndDerive(blob, 2014, 4, state, noChecks).ok).toBe(true)
  })

  it('rejects a bits change mid-window', () => {
    const blob = minedChain(2014, 4, (h) => (h >= 2015 ? EASY2 : EASY))
    const state = { prevHashInternal: new Uint8Array(32), prevBits: null }
    const verdict = verifyAndDerive(blob, 2014, 4, state, noChecks)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toMatch(/mid-window/)
  })
})

describe('byte helpers', () => {
  it('bigToBytes32 and bytesToBigAt round-trip extreme values', () => {
    for (const v of [0n, 1n, (1n << 255n) | 1n, (1n << 256n) - 1n]) {
      expect(bytesToBigAt(bigToBytes32(v), 0)).toBe(v)
    }
  })
})
