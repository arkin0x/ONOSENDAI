/**
 * zipRead.test.ts - the zip reader bulk import trusts nothing from.
 *
 * What these prove: stored and deflated entries read back exactly, including
 * an entry written with a data descriptor (sizes after the data, as macOS
 * and streaming zip tools write them); a directory longer than the cap is
 * refused before any entry is read; an entry stated larger than the cap is
 * refused unread; an entry whose stated size is a lie (a zip bomb) stops at
 * the stated size and is called damaged, with memory bounded; encrypted,
 * zip64, split, cut-short and not-a-zip inputs are each refused in words.
 */
import { describe, expect, it } from 'vitest'
import { Zip, ZipDeflate, strToU8, zipSync } from 'fflate'
import { listZip, readEntry } from '../zipRead'

const MB = 1024 * 1024

function streamed(files: Record<string, Uint8Array>): Uint8Array {
  const parts: Uint8Array[] = []
  const zip = new Zip((err, chunk) => { if (err) throw err; parts.push(chunk) })
  for (const [name, data] of Object.entries(files)) {
    const f = new ZipDeflate(name, { level: 6 })
    zip.add(f)
    f.push(data, true)
  }
  zip.end()
  const out = new Uint8Array(parts.reduce((t, p) => t + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

/** The central directory entry for `name`: where its sizes are written. */
function centralAt(bytes: Uint8Array, name: string): number {
  const want = strToU8(name)
  for (let i = 0; i < bytes.length - 46; i++) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 1 && bytes[i + 3] === 2) {
      const n = bytes[i + 28] | (bytes[i + 29] << 8)
      if (n === want.length && want.every((b, k) => bytes[i + 46 + k] === b)) return i
    }
  }
  throw new Error('no such entry')
}
const put32 = (b: Uint8Array, i: number, v: number): void => { b[i] = v & 255; b[i + 1] = (v >>> 8) & 255; b[i + 2] = (v >>> 16) & 255; b[i + 3] = (v >>> 24) & 255 }

describe('listZip and readEntry', () => {
  it('reads stored and deflated entries back exactly, folders listed as folders', () => {
    const text = strToU8('{"v":2,"name":"hall"}'.repeat(50))
    const bytes = zipSync({ 'kit/': new Uint8Array(0), 'kit/a.json': [text, { level: 0 }], 'kit/b.json': [text, { level: 9 }] })
    const entries = listZip(bytes, 10)
    expect(entries.map((e) => [e.name, e.dir])).toEqual([['kit/', true], ['kit/a.json', false], ['kit/b.json', false]])
    expect(entries.slice(1).map((e) => e.method)).toEqual([0, 8])
    for (const e of entries.filter((x) => !x.dir)) expect(readEntry(bytes, e, MB)).toEqual(text)
  })

  it('reads an entry written with a data descriptor, sizes after the data', () => {
    const data = strToU8('ply\nformat ascii 1.0\n'.repeat(200))
    const bytes = streamed({ 'maze-kit/forest/cube.ply': data })
    const [entry] = listZip(bytes, 10)
    expect(entry.size).toBe(data.length)
    expect(readEntry(bytes, entry, MB)).toEqual(data)
  })

  it('refuses a directory with more entries than the cap before reading any', () => {
    const files: Record<string, Uint8Array> = {}
    for (let i = 0; i < 12; i++) files[`f${i}.json`] = strToU8('{}')
    expect(() => listZip(zipSync(files), 10)).toThrow(/holds 12 files/)
  })

  it('refuses an entry stated larger than the cap without inflating it', () => {
    const bytes = zipSync({ 'big.ply': new Uint8Array(2 * MB) })
    const [entry] = listZip(bytes, 10)
    expect(() => readEntry(bytes, entry, MB)).toThrow(/too large/)
  })

  it('stops a zip bomb that lies about its size at the size it stated, and calls it damaged', () => {
    // 20 MB of zeros compresses to about 20 KB; the directory then says 1 KB.
    const bytes = zipSync({ 'bomb.json': new Uint8Array(20 * MB) })
    const at = centralAt(bytes, 'bomb.json')
    put32(bytes, at + 24, 1024)
    const [entry] = listZip(bytes, 10)
    expect(entry.size).toBe(1024)
    const before = process.memoryUsage().arrayBuffers
    expect(() => readEntry(bytes, entry, 50 * MB)).toThrow(/damaged/)
    // Nothing near 20 MB was kept: the inflater stopped within one chunk of the stated size.
    expect(process.memoryUsage().arrayBuffers - before).toBeLessThan(5 * MB)
  })

  it('calls an entry damaged when it inflates to less than it states', () => {
    const bytes = zipSync({ 'a.json': strToU8('{"v":2}') })
    put32(bytes, centralAt(bytes, 'a.json') + 24, 100)
    const [entry] = listZip(bytes, 10)
    expect(() => readEntry(bytes, entry, MB)).toThrow(/damaged/)
  })

  it('calls an entry damaged when its CRC does not match, stored or deflated', () => {
    for (const level of [0, 6] as const) {
      const bytes = zipSync({ 'a.json': [strToU8('{"v":2,"name":"hall"}'), { level }] })
      const at = centralAt(bytes, 'a.json')
      bytes[at + 16] ^= 0xff
      expect(() => readEntry(bytes, listZip(bytes, 10)[0], MB)).toThrow(/damaged/)
    }
  })

  it('refuses encrypted entries, and other compression methods', () => {
    const bytes = zipSync({ 'a.json': strToU8('{}') })
    const at = centralAt(bytes, 'a.json')
    bytes[at + 8] |= 1
    expect(() => readEntry(bytes, listZip(bytes, 10)[0], MB)).toThrow(/encrypted/)
    bytes[at + 8] &= ~1
    bytes[at + 10] = 12
    expect(() => readEntry(bytes, listZip(bytes, 10)[0], MB)).toThrow(/compressed in a way/)
  })

  it('refuses a file that is not a zip, one cut short, and a zip64', () => {
    expect(() => listZip(strToU8('hello'), 10)).toThrow(/not a zip/)
    expect(() => listZip(new Uint8Array(4096), 10)).toThrow(/not a zip/)
    const whole = zipSync({ 'a.json': strToU8('{}') })
    expect(() => listZip(whole.subarray(0, whole.length - 5), 10)).toThrow(/not a zip/)
    const z64 = new Uint8Array(whole.length + 20)
    z64.set(whole.subarray(0, whole.length - 22))
    put32(z64, whole.length - 22, 0x07064b50)
    z64.set(whole.subarray(whole.length - 22), whole.length - 2)
    expect(() => listZip(z64, 10)).toThrow(/zip64/)
  })

  it('refuses an entry whose local header or data run past the end', () => {
    const bytes = zipSync({ 'a.json': strToU8('{"v":2,"name":"x"}') })
    const [entry] = listZip(bytes, 10)
    expect(() => readEntry(bytes, { ...entry, offset: bytes.length - 10 }, MB)).toThrow(/damaged/)
    expect(() => readEntry(bytes, { ...entry, compressedSize: bytes.length }, MB)).toThrow(/damaged/)
  })
})
