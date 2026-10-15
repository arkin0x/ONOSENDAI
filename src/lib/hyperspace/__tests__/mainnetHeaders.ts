/**
 * The first six mainnet block headers, shared by the tests that need a real,
 * verifiable header blob (the format tests and the download tests).
 */
import { hexToBytes } from '../../events'
import { HEADER_RECORD_SIZE, writeRecord, type HeaderRecord } from '../headers'

// The first six mainnet block headers, exactly as they appear on the wire
// (fetched from mempool.space and frozen here; the genesis hex is the one
// every Bitcoin implementation embeds).
export const HEADERS = [
  '0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a29ab5f49ffff001d1dac2b7c',
  '010000006fe28c0ab6f1b372c1a6a246ae63f74f931e8365e15a089c68d6190000000000982051fd1e4ba744bbbe680e1fee14677ba1a3c3540bf7b1cdb606e857233e0e61bc6649ffff001d01e36299',
  '010000004860eb18bf1b1620e37e9490fc8a427514416fd75159ab86688e9a8300000000d5fdcc541e25de1c7a5addedf24858b8bb665c9f36ef744ee42c316022c90f9bb0bc6649ffff001d08d2bd61',
  '01000000bddd99ccfda39da1b108ce1a5d70038d0a967bacb68b6b63065f626a0000000044f672226090d85db9a9f2fbfe5f0f9609b387af7be5b7fbb7a1767c831c9e995dbe6649ffff001d05e0ed6d',
  '010000004944469562ae1c2c74d9a535e00b6f3e40ffbad4f2fda3895501b582000000007a06ea98cd40ba2e3288262b28638cec5337c1456aaf5eedc8e9e5a20f062bdf8cc16649ffff001d2bfee0a9',
  '0100000085144a84488ea88d221c8bd6c059da090e88f8a2c99690ee55dbba4e00000000e11c48fecdd9e72510ca84f023370c9a38bf91ac5cae88019bee94d24528526344c36649ffff001d1d03e477',
]

// The corresponding display (byte-reversed sha256d) block ids.
export const IDS = [
  '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
  '00000000839a8e6886ab5951d76f411475428afc90947ee320161bbf18eb6048',
  '000000006a625f06636b8bb6ac7b960a8d03705d1ace08b1a19da3fdcc99ddbd',
  '0000000082b5015589a3fdf2d4baff403e6f0be035a5d9742c1cae6295464449',
  '000000004ebadb55ee9096c9a2f8880e09da59c0d68b1c228da88e48844a1485',
  '000000009b7262315dbf071787ad3656097b892abffd1f95a1a022f896f533fc',
]

export function recordFromWireHex(hex: string): HeaderRecord {
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

export function packBlob(records: HeaderRecord[]): Uint8Array {
  const out = new Uint8Array(records.length * HEADER_RECORD_SIZE)
  records.forEach((rec, i) => writeRecord(out, i, rec))
  return out
}

/** Blocks 0 to 5 as one blob, exactly as the headers-v1 files lay them out. */
export const realBlob = (): Uint8Array => packBlob(HEADERS.map(recordFromWireHex))
