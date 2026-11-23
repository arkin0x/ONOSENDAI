/**
 * The head blob grown past 971,999, checked across the old/new seam.
 *
 * Until 2026-11-10 the headers-v1 head blob ended at 971,999 and kind 321
 * anchors carry a `header` tag only from 975,256, so blocks 972,000 to
 * 975,255 had no header times anywhere. nth headers-v1 now grows the head to
 * 975,226. vectors/headers-971968-975226.bin is a byte-exact slice of that
 * head blob (headers-019.bin from record 21,968 to its end): the last 32
 * records of the old head, then every record the growth added.
 *
 * What would fail silently without this: a grown head whose first new record
 * does not link to the old head's last block would pass every per-record
 * check (PoW, bits window) and only be caught by the final checkpoint, if at
 * all; and a pin inside the new range (974,999) that does not match the
 * bytes would discard the whole head blob in every client, quietly handing
 * its 25,000 heights back to the relay. Both are checked here with the real verifier and the real pins.
 *
 * Set HEADERS_V1_DIR to a checkout of the nth headers-v1 branch to also load
 * the published head blob itself and verify it whole against its manifest.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bytesToHex, hexToBytes } from '../../events'
import { EMBEDDED_CHECKPOINTS } from '../checkpoints'
import {
  HEADER_RECORD_SIZE,
  checkpointState,
  readRecord,
  reverse32,
  sha256d,
  verifyAndDerive,
  wireHeader,
} from '../headers'
import { parseManifest } from '../headerSync'

const FIRST = 971_968
const OLD_END = 971_999
const NEW_END = 975_226
const NEW_PIN = 974_999
/** The manifest's checkpoint for the grown head's last block, 975,226
 * (blockstream.info and blockchain.info agree). */
const MANIFEST_NEW_END = '00000000000000000000086127e8a8d353964b72502503e189c3d450dfad023b'
/** Display hash of 971,967, the block before the slice. It is not pinned; the
 * 971,999 pin inside the walk is what proves it (linkage runs through it). */
const SEED_971967 = '00000000000000000000e4dcc0bd6e2b5a96f8e6de6ae5c68840de8c4cda9fe9'
/** Display hash of 972,000, the first new block (blockstream.info and blockchain.info). */
const HASH_972000 = '00000000000000000001f09a6919251b4c3dd5261ee68c8a17ec718667d35f20'
/** Display hash of 973,728, the one retarget height in the new range. */
const HASH_973728 = '0000000000000000000104150b08ff89bbb2d11bab42c245c82b8165ab2e2c11'

const pinned = new Map(EMBEDDED_CHECKPOINTS.map((c) => [c.height, c.blockHash]))
const PIN_OLD_END = pinned.get(OLD_END)!
const PIN_NEW = pinned.get(NEW_PIN)!

const slice = new Uint8Array(readFileSync(join(__dirname, 'vectors', 'headers-971968-975226.bin')))
const recordsFrom = (height: number): Uint8Array => slice.subarray((height - FIRST) * HEADER_RECORD_SIZE)
const hashAt = (cols: { startHeight: number; hashes: Uint8Array }, height: number): string => {
  const row = (height - cols.startHeight) * 32
  return bytesToHex(cols.hashes.subarray(row, row + 32))
}

describe('the grown head blob across the 971,999 / 972,000 seam', () => {
  it('pins 971,999 as before and 974,999 inside the new range', () => {
    expect(PIN_OLD_END).toBe('00000000000000000000d5c8611c63c98822c10b9ff61cec2d728429a2fd2d82')
    expect(PIN_NEW).toBe('0000000000000000000034698d1530f1294ec6c2937e0e366df8f17a5b614376')
    expect(slice.length).toBe((NEW_END - FIRST + 1) * HEADER_RECORD_SIZE)
  })

  it('verifies old and new records as one chain, through the 971,999 and 974,999 pins to the manifest end', () => {
    const count = NEW_END - FIRST + 1
    const verdict = verifyAndDerive(slice, FIRST, count, checkpointState(SEED_971967), {
      finalHashHex: MANIFEST_NEW_END,
      embedded: pinned,
    })
    expect(verdict.ok, verdict.ok ? '' : verdict.reason).toBe(true)
    if (!verdict.ok) return
    expect(hashAt(verdict.columns, OLD_END)).toBe(PIN_OLD_END)
    expect(hashAt(verdict.columns, OLD_END + 1)).toBe(HASH_972000)
    expect(hashAt(verdict.columns, 973_728)).toBe(HASH_973728)
    expect(hashAt(verdict.columns, NEW_PIN)).toBe(PIN_NEW)
    expect(hashAt(verdict.columns, NEW_END)).toBe(MANIFEST_NEW_END)
  })

  it('the first new record rebuilds, on the 971,999 pin as its prev_hash, to 972,000', () => {
    const rec = readRecord(recordsFrom(OLD_END + 1), 0)
    const header = wireHeader(rec, reverse32(hexToBytes(PIN_OLD_END)))
    expect(bytesToHex(reverse32(sha256d(header)))).toBe(HASH_972000)
  })

  it('the new range alone, seeded where the old head ended, passes the 974,999 pin and reaches the manifest end', () => {
    const fresh = recordsFrom(OLD_END + 1)
    const verdict = verifyAndDerive(fresh, OLD_END + 1, NEW_END - OLD_END, checkpointState(PIN_OLD_END), {
      finalHashHex: MANIFEST_NEW_END,
      embedded: pinned,
    })
    expect(verdict.ok, verdict.ok ? '' : verdict.reason).toBe(true)
  })

  it('the new range does not link to any other block: seeded one block early, it fails', () => {
    const fresh = recordsFrom(OLD_END + 1)
    const prior = verifyAndDerive(slice.subarray(0, (OLD_END - FIRST) * HEADER_RECORD_SIZE), FIRST, OLD_END - FIRST,
      checkpointState(SEED_971967), { finalHashHex: null, embedded: pinned })
    expect(prior.ok).toBe(true)
    if (!prior.ok) return
    const hash971998 = hashAt(prior.columns, OLD_END - 1)
    const verdict = verifyAndDerive(fresh, OLD_END + 1, NEW_END - OLD_END, checkpointState(hash971998), {
      finalHashHex: MANIFEST_NEW_END,
      embedded: pinned,
    })
    expect(verdict.ok).toBe(false)
  })

  it('a flipped byte in the first new record fails the walk', () => {
    const tampered = slice.slice()
    tampered[(OLD_END + 1 - FIRST) * HEADER_RECORD_SIZE + 10] ^= 0x01
    const verdict = verifyAndDerive(tampered, FIRST, NEW_END - FIRST + 1, checkpointState(SEED_971967), {
      finalHashHex: MANIFEST_NEW_END,
      embedded: pinned,
    })
    expect(verdict.ok).toBe(false)
  })
})

const dir = process.env.HEADERS_V1_DIR
describe.skipIf(!dir || !existsSync(join(dir, 'manifest.json')))('the published head blob (HEADERS_V1_DIR)', () => {
  it('verifies whole against its manifest and the pins, and holds the vector slice byte for byte', () => {
    const manifest = parseManifest(JSON.parse(readFileSync(join(dir!, 'manifest.json'), 'utf8')))
    expect(manifest).not.toBeNull()
    const head = manifest!.blobs[manifest!.blobs.length - 1]
    const end = head.startHeight + head.count - 1
    expect(end).toBeGreaterThanOrEqual(NEW_END)
    const bytes = new Uint8Array(readFileSync(join(dir!, head.file)))
    const cps = new Map(manifest!.checkpoints.map((c) => [c.height, c.blockHash]))
    const seed = cps.get(head.startHeight - 1)!
    expect(seed).toBe(pinned.get(head.startHeight - 1))
    const verdict = verifyAndDerive(bytes, head.startHeight, head.count, checkpointState(seed), {
      finalHashHex: cps.get(end)!,
      embedded: pinned,
    })
    expect(verdict.ok, verdict.ok ? '' : verdict.reason).toBe(true)
    const from = (FIRST - head.startHeight) * HEADER_RECORD_SIZE
    expect(bytesToHex(bytes.subarray(from, from + slice.length))).toBe(bytesToHex(slice))
  })
})
