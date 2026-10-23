/**
 * zipRead.ts - the entries of a .zip, and one entry's bytes, without trusting
 * anything the zip says about itself.
 *
 * A zip is untrusted. Its directory states each entry's sizes, and a zip
 * bomb lies about them: fflate's unzipSync sizes its output by the stated
 * size, so the stated size is never what bounds the work here. Each entry is
 * inflated through fflate's streaming Inflate, a little input at a time,
 * and stopped the moment its output passes the cap it was given; an output
 * that differs from the stated size by a single byte is damage, not data.
 *
 * Only what bulk import needs: the central directory (one pass, bounds
 * checked), stored and deflated entries, no encryption, no zip64 (no shard
 * file comes near 4 GB), no spanning. Names are read as UTF-8. Nothing here
 * touches a file system: a name is only ever a label (lib/shardZip.ts makes
 * it a safe one).
 */

import { Inflate } from 'fflate'

/** One entry in the central directory, as the zip states it. */
export interface ZipEntry {
  /** Its place in the central directory: unique, where a name need not be. */
  index: number
  /** The name as written, '/' or '\' separated. */
  name: string
  /** Ends in a slash: a folder, with no bytes of its own. */
  dir: boolean
  /** 0 stored, 8 deflate; anything else is refused by readEntry. */
  method: number
  /** Bit 0 of the flags. */
  encrypted: boolean
  /** Stated sizes, in bytes. */
  compressedSize: number
  size: number
  /** Where the local header starts. */
  offset: number
  /** CRC-32 of the inflated bytes, as stated. */
  crc: number
}

export class ZipError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZipError'
  }
}

const EOCD = 0x06054b50
const ZIP64_LOCATOR = 0x07064b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50
const MAX_COMMENT = 0xffff

const u16 = (b: Uint8Array, i: number): number => b[i] | (b[i + 1] << 8)
const u32 = (b: Uint8Array, i: number): number => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0

const names = new TextDecoder('utf-8')

/**
 * Every entry the central directory lists, or a ZipError saying why the zip
 * cannot be read. `maxEntries` is checked before a single entry is read, so a
 * directory of a million names costs nothing.
 */
export function listZip(bytes: Uint8Array, maxEntries: number): ZipEntry[] {
  if (bytes.length < 22) throw new ZipError('That is not a zip.')
  // The end record is the last thing in the file, before a comment of up to 64 KB.
  let e = -1
  const floor = Math.max(0, bytes.length - 22 - MAX_COMMENT)
  for (let i = bytes.length - 22; i >= floor; i--) {
    if (u32(bytes, i) === EOCD && i + 22 + u16(bytes, i + 20) === bytes.length) { e = i; break }
  }
  if (e < 0) throw new ZipError('That is not a zip, or it is cut short.')
  if (e >= 20 && u32(bytes, e - 20) === ZIP64_LOCATOR) throw new ZipError('That zip is in the zip64 format, which import does not read. Zip it again with a plain zip tool.')
  if (u16(bytes, e + 4) !== 0 || u16(bytes, e + 6) !== 0) throw new ZipError('That zip is split across several files.')
  const count = u16(bytes, e + 10)
  const cdSize = u32(bytes, e + 12)
  const cdOffset = u32(bytes, e + 16)
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new ZipError('That zip is in the zip64 format, which import does not read. Zip it again with a plain zip tool.')
  if (count > maxEntries) throw new ZipError(`That zip holds ${count} files. Import reads up to ${maxEntries}.`)
  if (cdOffset + cdSize > e) throw new ZipError('That zip is damaged.')
  const out: ZipEntry[] = []
  let p = cdOffset
  for (let n = 0; n < count; n++) {
    if (p + 46 > e || u32(bytes, p) !== CENTRAL) throw new ZipError('That zip is damaged.')
    const flags = u16(bytes, p + 8)
    const crc = u32(bytes, p + 16)
    const method = u16(bytes, p + 10)
    const compressedSize = u32(bytes, p + 20)
    const size = u32(bytes, p + 24)
    const nameLen = u16(bytes, p + 28)
    const extraLen = u16(bytes, p + 30)
    const commentLen = u16(bytes, p + 32)
    const offset = u32(bytes, p + 42)
    const end = p + 46 + nameLen + extraLen + commentLen
    if (end > e) throw new ZipError('That zip is damaged.')
    const name = names.decode(bytes.subarray(p + 46, p + 46 + nameLen))
    const zip64 = compressedSize === 0xffffffff || size === 0xffffffff || offset === 0xffffffff
    if (zip64) throw new ZipError('That zip is in the zip64 format, which import does not read. Zip it again with a plain zip tool.')
    out.push({ index: n, name, dir: /[\\/]$/.test(name), method, encrypted: (flags & 1) === 1, compressedSize, size, offset, crc })
    p = end
  }
  return out
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

/** CRC-32 as zip writes it. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Deflate's ceiling: one input byte inflates to at most about this many. */
const MAX_RATIO = 1032
/** Input fed to the inflater per push, at least and at most. */
const MIN_CHUNK = 512
const MAX_CHUNK = 64 * 1024

/**
 * One entry's bytes, never more than `cap` of them: a ZipError when the
 * entry is larger than the cap, stated or actual, damaged, encrypted, or
 * compressed some way other than deflate.
 */
export function readEntry(bytes: Uint8Array, entry: ZipEntry, cap: number): Uint8Array {
  if (entry.encrypted) throw new ZipError('It is encrypted.')
  if (entry.size > cap) throw new ZipError('It is too large.')
  const p = entry.offset
  if (p + 30 > bytes.length || u32(bytes, p) !== LOCAL) throw new ZipError('It is damaged.')
  // The local header's own name and extra lengths, which may differ from the directory's.
  const start = p + 30 + u16(bytes, p + 26) + u16(bytes, p + 28)
  const stop = start + entry.compressedSize
  if (stop > bytes.length) throw new ZipError('It is damaged.')
  const data = bytes.subarray(start, stop)
  if (entry.method === 0) {
    if (data.length !== entry.size || crc32(data) !== entry.crc) throw new ZipError('It is damaged.')
    return data.slice()
  }
  if (entry.method !== 8) throw new ZipError('It is compressed in a way import does not read.')
  // The stated size is the most it may be; anything past it is a lie, and stops here.
  const limit = Math.min(cap, entry.size)
  const parts: Uint8Array[] = []
  let total = 0
  const inflater = new Inflate((chunk) => {
    total += chunk.length
    if (total > limit) throw new ZipError('It is damaged.')
    parts.push(chunk)
  })
  try {
    // Each push no larger than what is left of the allowance could inflate
    // to, so one push overshoots it by at most the allowance, or by what
    // MIN_CHUNK inflates to (about half a megabyte) near the end.
    let i = 0
    do {
      const n = Math.max(MIN_CHUNK, Math.min(MAX_CHUNK, Math.floor((limit - total) / MAX_RATIO)))
      const next = Math.min(data.length, i + n)
      inflater.push(data.subarray(i, next), next >= data.length)
      i = next
    } while (i < data.length)
  } catch {
    // An entry stated over the cap was refused above, so output past the
    // stated size is a lie about the size (a zip bomb), or a broken stream.
    throw new ZipError('It is damaged.')
  }
  if (total !== entry.size) throw new ZipError('It is damaged.')
  const out = new Uint8Array(total)
  let at = 0
  for (const part of parts) { out.set(part, at); at += part.length }
  if (crc32(out) !== entry.crc) throw new ZipError('It is damaged.')
  return out
}
