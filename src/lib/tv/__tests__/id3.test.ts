/**
 * id3.test.ts: a track's name, artist and cover come out of its tag, in the
 * versions and encodings files are written in, and reading one stops at the
 * end of the tag rather than downloading the track.
 */
import { describe, expect, it, vi } from 'vitest'
import { id3Length, parseId3, readTags } from '../id3'

const latin1 = (t: string): number[] => Array.from(t, (c) => c.charCodeAt(0))
const utf16 = (t: string): number[] => [0xff, 0xfe, ...Array.from(t).flatMap((c) => [c.charCodeAt(0), 0])]
const syncsafe = (n: number): number[] => [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]
const be = (n: number): number[] => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]

function frame(version: 3 | 4, id: string, body: number[]): number[] {
  return [...latin1(id), ...(version === 4 ? syncsafe(body.length) : be(body.length)), 0, 0, ...body]
}
function tag(version: 3 | 4, frames: number[][], padding = 16): Uint8Array {
  const body = [...frames.flat(), ...new Array(padding).fill(0)]
  return Uint8Array.from([...latin1('ID3'), version, 0, 0, ...syncsafe(body.length), ...body])
}
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]

describe('reading an ID3 tag', () => {
  it('reads 2.3: a UTF-16 name, a Latin-1 artist and the front cover over another picture', () => {
    const t = tag(3, [
      frame(3, 'TIT2', [1, ...utf16('Commersens Temperatur')]),
      frame(3, 'TPE1', [0, ...latin1('Sethy Bowoy')]),
      frame(3, 'APIC', [0, ...latin1('image/png'), 0, 4, ...latin1('back'), 0, 9, 9]),
      frame(3, 'APIC', [1, ...latin1('image/jpeg'), 0, 3, ...utf16('cover'), 0, 0, ...JPEG]),
    ])
    const out = parseId3(t)
    expect(out.title).toBe('Commersens Temperatur')
    expect(out.artist).toBe('Sethy Bowoy')
    expect(out.picture?.mime).toBe('image/jpeg')
    expect(Array.from(out.picture!.data)).toEqual(JPEG)
  })

  it('reads 2.4, whose frame sizes are syncsafe, in UTF-8', () => {
    const long = 'Ü'.repeat(100)
    const t = tag(4, [frame(4, 'TIT2', [3, ...new TextEncoder().encode(long)]), frame(4, 'TPE1', [3, ...new TextEncoder().encode('Ørsted')])])
    expect(parseId3(t)).toEqual({ title: long, artist: 'Ørsted' })
  })

  it('takes the first picture when none is the front cover, and knows a file with no tag', () => {
    const t = tag(3, [frame(3, 'APIC', [0, ...latin1('image/jpeg'), 0, 0, 0, ...JPEG])])
    expect(Array.from(parseId3(t).picture!.data)).toEqual(JPEG)
    expect(id3Length(Uint8Array.from([0xff, 0xfb, 0x90, 0, 0, 0, 0, 0, 0, 0]))).toBeNull()
    expect(parseId3(Uint8Array.from([0xff, 0xfb, 0x90]))).toEqual({})
  })

  it('stops reading at the end of the tag', async () => {
    const t = tag(3, [frame(3, 'TIT2', [0, ...latin1('Saturn Day')])])
    const audio = new Uint8Array(1_000_000)
    let pulled = 0
    const cancel = vi.fn()
    const chunks = [t.subarray(0, 7), t.subarray(7), audio, audio, audio]
    const body = new ReadableStream<Uint8Array>({
      pull: (c) => { const next = chunks[pulled++]; if (next) c.enqueue(next); else c.close() },
      cancel,
    }, { highWaterMark: 0 })
    const out = await readTags('https://host/x.mp3', (async () => new Response(body)) as typeof fetch)
    expect(out.title).toBe('Saturn Day')
    expect(pulled).toBeLessThanOrEqual(3)
    expect(cancel).toHaveBeenCalled()
  })

  it('gives nothing for a link that does not answer', async () => {
    expect(await readTags('https://host/gone.mp3', (async () => new Response('', { status: 404 })) as typeof fetch)).toEqual({})
  })
})
