/**
 * nbtRead.ts: the bytes of a block file as an NBT tree.
 *
 * All three formats the importer reads (.schem, .litematic, structure .nbt)
 * are NBT, the game's tagged binary format, and all three are usually
 * gzipped. The gzip is opened with the browser's own DecompressionStream,
 * read a chunk at a time and stopped once it passes MAX_INFLATED_BYTES, so a
 * small file that unpacks to gigabytes stops with a sentence instead of
 * taking the tab down. The tree is then checked by checkNbt before NBTify
 * (MIT, pinned) reads it: NBTify sizes an array by the length the file
 * declares before it looks for the bytes, and a hostile file could declare
 * a billion entries. checkNbt walks the same structure without allocating
 * anything and refuses any length the bytes left cannot hold.
 *
 * Nothing here touches the network.
 */

import { read } from 'nbtify'
import { BlockImportError } from './blockGrid'

/** The most an unpacked file may be: a build of MAX_CELLS cells at three bytes a varint fits, and a phone can hold it twice. */
export const MAX_INFLATED_BYTES = 64 * 1024 * 1024
/**
 * The most tags one file may hold. NBTify makes a JavaScript object for each
 * (about 65 bytes), so a list of a hundred million empty compounds, a few
 * hundred kilobytes gzipped, would take gigabytes. Real builds keep their
 * blocks in one array; a structure file lists each block as about six tags,
 * so this holds one of half a million listed blocks, far past the game's own
 * 48 by 48 by 48.
 */
export const MAX_NBT_TAGS = 3_000_000
/** How deep tags may nest. Real files nest a handful of levels. */
export const MAX_NBT_DEPTH = 64

/** Whether the bytes start as a gzip stream does. */
export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
}

/** A gzip stream unpacked, refused once it passes `cap` bytes. */
export async function gunzipCapped(bytes: Uint8Array, cap = MAX_INFLATED_BYTES): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new BlockImportError('This browser cannot unpack the file. Try a newer browser.')
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > cap) {
        await reader.cancel().catch(() => undefined)
        throw new BlockImportError(`That file unpacks to more than ${Math.round(cap / 1048576)} MB. Import reads builds up to that size.`)
      }
      chunks.push(value)
    }
  } catch (e) {
    if (e instanceof BlockImportError) throw e
    throw new BlockImportError('That file could not be unpacked. It may be damaged.')
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) { out.set(c, at); at += c.byteLength }
  return out
}

/** Bytes each payload tag takes at least, by tag type (big-endian Java NBT). */
const MIN_BYTES = [0, 1, 2, 4, 8, 4, 8, 4, 2, 5, 1, 4, 4]

/**
 * Throws when the bytes are not one well-formed big-endian NBT tree whose
 * declared lengths all fit in what is there. Allocates nothing.
 */
export function checkNbt(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let at = 0
  const bad = (): never => { throw new BlockImportError('That file is not a block build, or it is damaged.') }
  const need = (n: number): void => { if (n < 0 || at + n > bytes.length) bad() }
  const u8 = (): number => { need(1); return bytes[at++] }
  const u16 = (): number => { need(2); const v = view.getUint16(at); at += 2; return v }
  const i32 = (): number => { need(4); const v = view.getInt32(at); at += 4; return v }
  const skipString = (): void => { const n = u16(); need(n); at += n }
  let tags = 0
  const payload = (type: number, depth: number): void => {
    if (depth > MAX_NBT_DEPTH) bad()
    if (++tags > MAX_NBT_TAGS) throw new BlockImportError('That file holds more pieces of data than import reads. Save a smaller part of the build.')
    switch (type) {
      case 1: case 2: case 3: case 4: case 5: case 6: need(MIN_BYTES[type]); at += MIN_BYTES[type]; return
      case 7: { const n = i32(); need(n); at += n; return }
      case 8: skipString(); return
      case 9: {
        const inner = u8()
        const n = i32()
        if (n <= 0) return
        if (inner < 1 || inner > 12) bad()
        // Every entry takes at least this many bytes, so a count the rest cannot hold is refused before the walk.
        if (n * MIN_BYTES[inner] > bytes.length - at) bad()
        for (let k = 0; k < n; k++) payload(inner, depth + 1)
        return
      }
      case 10: {
        for (;;) {
          const t = u8()
          if (t === 0) return
          if (t > 12) bad()
          skipString()
          payload(t, depth + 1)
        }
      }
      case 11: { const n = i32(); need(n * 4); at += n * 4; return }
      case 12: { const n = i32(); need(n * 8); at += n * 8; return }
      default: bad()
    }
  }
  const root = u8()
  if (root !== 10 && root !== 9) bad()
  skipString()
  payload(root, 0)
}

/** A file's bytes as its NBT root: unpacked when gzipped, checked, then read. */
export async function readNbtRoot(bytes: Uint8Array): Promise<Record<string, unknown>> {
  const raw = isGzip(bytes) ? await gunzipCapped(bytes) : bytes
  checkNbt(raw)
  let data: unknown
  try {
    data = (await read(raw, { rootName: true, endian: 'big', compression: null, bedrockLevel: false, strict: false })).data
  } catch {
    throw new BlockImportError('That file is not a block build, or it is damaged.')
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new BlockImportError('That file is not a block build.')
  return data as Record<string, unknown>
}
