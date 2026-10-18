/**
 * id3.ts: a track's name, artist and cover, read from the ID3v2 tag at the
 * start of an mp3, so a playlist entry needs nothing but its link
 * (lib/tv/playlist). The cover is the track's own picture: a track's art is
 * the picture inside it when there is one (arkinox, 2026-10-18: "if the track
 * has internal art, probably use that").
 *
 * Read with a plain GET whose body is cut off once the tag has arrived: a
 * Range header would ask the host a CORS question first, which a host that
 * allows any origin to read its files may still not answer.
 */

export interface TrackTags {
  title?: string
  artist?: string
  picture?: { mime: string; data: Uint8Array }
}

/** The most of a file read for its tag: a cover larger than this is not worth the wait. */
const MAX_TAG = 4 * 1024 * 1024

const syncsafe = (b: Uint8Array, i: number): number => ((b[i] & 0x7f) << 21) | ((b[i + 1] & 0x7f) << 14) | ((b[i + 2] & 0x7f) << 7) | (b[i + 3] & 0x7f)
const be32 = (b: Uint8Array, i: number): number => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0

/** How many bytes the tag at the head of a file takes, header included; null when it has none. */
export function id3Length(head: Uint8Array): number | null {
  if (head.length < 10 || head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return null
  return 10 + syncsafe(head, 6) + (head[5] & 0x10 ? 10 : 0)
}

/** Undo unsynchronisation: every 0xFF 0x00 was written for a 0xFF. */
function resync(b: Uint8Array): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < b.length; i++) {
    out.push(b[i])
    if (b[i] === 0xff && b[i + 1] === 0x00) i++
  }
  return Uint8Array.from(out)
}

const ENCODINGS = ['latin1', 'utf-16', 'utf-16be', 'utf-8'] as const

/** Where a string in `enc` that starts at `from` ends: its terminator, or the end. */
function terminator(b: Uint8Array, from: number, enc: number): { end: number; next: number } {
  const wide = enc === 1 || enc === 2
  for (let i = from; i < b.length; i += wide ? 2 : 1) {
    if (b[i] === 0 && (!wide || b[i + 1] === 0)) return { end: i, next: i + (wide ? 2 : 1) }
  }
  return { end: b.length, next: b.length }
}

function decode(b: Uint8Array, enc: number): string {
  try {
    return new TextDecoder(ENCODINGS[enc] ?? 'latin1').decode(b).replace(/\0+$/, '').trim()
  } catch {
    return ''
  }
}

/** The name, artist and cover in an ID3v2 tag (2.2, 2.3 or 2.4): whatever of them it has. */
export function parseId3(bytes: Uint8Array): TrackTags {
  const length = id3Length(bytes)
  if (length === null) return {}
  const version = bytes[3]
  const flags = bytes[5]
  let body = bytes.subarray(10, Math.min(bytes.length, length))
  if (version < 4 && flags & 0x80) body = resync(body)
  let i = 0
  if (flags & 0x40 && version >= 3) i = version === 3 ? 4 + be32(body, 0) : syncsafe(body, 0)
  const short = version === 2
  const idLen = short ? 3 : 4
  const headLen = short ? 6 : 10
  const out: TrackTags = {}
  let cover: TrackTags['picture'] & { front: boolean } | undefined
  while (i + headLen <= body.length && body[i] !== 0) {
    const id = String.fromCharCode(...body.subarray(i, i + idLen))
    const size = short ? (body[i + 3] << 16) | (body[i + 4] << 8) | body[i + 5] : version === 4 ? syncsafe(body, i + 4) : be32(body, i + 4)
    const frameFlags = short ? 0 : body[i + 9]
    let frame = body.subarray(i + headLen, i + headLen + size)
    i += headLen + size
    if (size <= 0) break
    if (version === 4 && frameFlags & 0x02) frame = resync(frame)
    // A compressed or encrypted frame is not read.
    if (!short && frameFlags & (version === 4 ? 0x0c : 0xc0)) continue
    // 2.4 may put a data length before the frame.
    if (version === 4 && frameFlags & 0x01) frame = frame.subarray(4)
    if (id === 'TIT2' || id === 'TT2') out.title = decode(frame.subarray(1), frame[0])
    else if (id === 'TPE1' || id === 'TP1') out.artist = decode(frame.subarray(1), frame[0])
    else if (id === 'APIC' || id === 'PIC') {
      const enc = frame[0]
      let at = 1
      let mime: string
      if (short) {
        const fmt = String.fromCharCode(...frame.subarray(1, 4)).toLowerCase()
        mime = fmt === 'png' ? 'image/png' : 'image/jpeg'
        at = 4
      } else {
        const m = terminator(frame, 1, 0)
        mime = decode(frame.subarray(1, m.end), 0).toLowerCase() || 'image/jpeg'
        if (!mime.includes('/')) mime = `image/${mime === 'jpg' ? 'jpeg' : mime}`
        at = m.next
      }
      const front = frame[at] === 3
      const d = terminator(frame, at + 1, enc)
      const data = frame.subarray(d.next)
      // The front cover over any other picture; else the first.
      if (data.length > 0 && (!cover || (front && !cover.front))) cover = { mime, data, front }
    }
  }
  if (cover) out.picture = { mime: cover.mime, data: cover.data }
  return out
}

/** Read a file's tag: its head, as far as the tag goes, and no further. */
export async function readTags(url: string, fetcher: typeof fetch = fetch): Promise<TrackTags> {
  const res = await fetcher(url)
  if (!res.ok || !res.body) return {}
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let have = 0
  let want = 10
  try {
    while (have < want) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      have += value.length
      if (want === 10 && have >= 10) {
        const head = join(chunks, have)
        const length = id3Length(head)
        if (length === null || length > MAX_TAG) return {}
        want = length
      }
    }
  } finally {
    void reader.cancel().catch(() => {})
  }
  return parseId3(join(chunks, have))
}

function join(chunks: Uint8Array[], length: number): Uint8Array {
  const out = new Uint8Array(length)
  let at = 0
  for (const c of chunks) { out.set(c, at); at += c.length }
  return out
}
