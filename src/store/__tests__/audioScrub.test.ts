/**
 * audioScrub.test.ts: the voice line's scrubber moves the card's real PLAY
 * (store/useHiddenAudio seekCard, cardTime): while it plays it moves the
 * element; before PLAY it says where the next PLAY starts, which PLAY takes
 * once; a stop forgets it. And the waveform store (store/useWaveforms): a
 * file is decoded for its shape only within the house budget, never fetched
 * for a list, and a larger file's shape is drawn as it is heard. Nothing
 * leaves the machine: the file comes from a server in memory, the element is
 * a stand-in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}
vi.mock('../../lib/relay', () => ({ publishMany: vi.fn(async () => ({ ok: true })), query: vi.fn(async () => []), queryAny: vi.fn(async () => []), relaySet: () => ['wss://relay.test'] }))

import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { forgetOpenedAudio, sealAndUpload } from '../../lib/audioFile'
import type { AudioItem } from '../../lib/audioItem'
import { sha256Hex } from '../../lib/blossom'
import { toneWav } from '../../lib/__tests__/audioFixture'
import { WAVE_BARS } from '../../lib/waveform'
import { cardKey, cardTime, playAudio, seekCard, stopAllAudio, stopAudio, useHiddenAudio } from '../useHiddenAudio'
import { DECODE_WHOLE_BYTES, DECODE_WHOLE_WAV_BYTES } from '../useHiddenAudio'
import { forgetWaves, HEARD_ENOUGH, heardShape, noteLevel, useWaveforms, waveDecodable, wantWave } from '../useWaveforms'

/** An audio element stand-in that keeps where it was set to play from. */
class FakeAudio extends EventTarget {
  static made: FakeAudio[] = []
  loop = false
  preload = ''
  src = ''
  paused = true
  currentTime = 0
  duration = 120
  constructor() { super(); FakeAudio.made.push(this) }
  async play(): Promise<void> { this.paused = false }
  pause(): void { this.paused = true }
  removeAttribute(): void { this.src = '' }
  load(): void {}
}

let audio: AudioItem
let gets = 0
const realFetch = globalThis.fetch

beforeEach(async () => {
  FakeAudio.made = []
  gets = 0
  vi.stubGlobal('Audio', FakeAudio)
  const blobs = new Map<string, Uint8Array>()
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method === 'HEAD') return new Response(null, { status: 200 })
    if (method === 'PUT') {
      const body = new Uint8Array(init!.body as Uint8Array)
      const hash = sha256Hex(body)
      blobs.set(hash, body)
      return new Response(JSON.stringify({ url: `https://blossom.test/${hash}`, sha256: hash, size: body.byteLength }), { status: 200 })
    }
    gets++
    const b = blobs.get(String(input).split('/').pop()!)
    return b ? new Response(b as BodyInit, { status: 200 }) : new Response(null, { status: 404 })
  }) as typeof fetch
  forgetOpenedAudio()
  forgetWaves()
  const sk = generateSecretKey()
  const up = await sealAndUpload(new Blob([toneWav() as BlobPart], { type: 'audio/wav' }), 'https://blossom.test', async (t) => finalizeEvent(t, sk))
  audio = { ...up, title: 'Night lattice', about: '', autoplay: false, loop: false, retrigger: 'once', walkOnly: false }
  useHiddenAudio.setState({ entries: {} })
  gets = 0
})

afterEach(() => {
  stopAllAudio()
  globalThis.fetch = realFetch
  vi.unstubAllGlobals()
})

describe('the scrubber and the card’s PLAY', () => {
  it('before PLAY, a seek says where PLAY starts; PLAY takes it once', async () => {
    expect(cardTime('k')).toBeNull()
    expect(seekCard('k', 42)).toBe(false)
    await playAudio('k', audio)
    expect(useHiddenAudio.getState().entries[cardKey('k')]?.phase).toBe('playing')
    expect(FakeAudio.made.at(-1)!.currentTime).toBe(42)
    expect(cardTime('k')).toEqual({ at: 42, duration: 120 })
    // Played again from the card: from the top, the seek was used.
    await playAudio('k', audio)
    expect(FakeAudio.made.at(-1)!.currentTime).toBe(0)
  })

  it('while it plays, a seek moves the element at once', async () => {
    await playAudio('k', audio)
    expect(seekCard('k', 30)).toBe(true)
    expect(FakeAudio.made.at(-1)!.currentTime).toBe(30)
    expect(cardTime('k')!.at).toBe(30)
  })

  it('a PLAY that fails forgets the seek made before it', async () => {
    seekCard('k', 50)
    await playAudio('k', { ...audio, url: 'https://blossom.test/' + 'ee'.repeat(32), hash: 'ee'.repeat(32) })
    expect(useHiddenAudio.getState().entries[cardKey('k')]?.phase).toBe('error')
    await playAudio('k', audio)
    expect(FakeAudio.made.at(-1)!.currentTime).toBe(0)
  })

  it('a stop forgets a seek made before PLAY', async () => {
    seekCard('k', 50)
    stopAudio('k')
    await playAudio('k', audio)
    expect(FakeAudio.made.at(-1)!.currentTime).toBe(0)
  })
})

describe('the waveform store', () => {
  it('opens a file for its shape before PLAY only when the item says it is small enough to decode whole, and never twice', () => {
    expect(waveDecodable(0, 'audio/wav')).toBe(false)
    expect(waveDecodable(DECODE_WHOLE_WAV_BYTES, 'audio/wav')).toBe(true)
    expect(waveDecodable(DECODE_WHOLE_WAV_BYTES + 1, 'audio/wav')).toBe(false)
    // A compressed file is decoded whole only up to DECODE_WHOLE_BYTES, so nothing larger is fetched for it.
    expect(waveDecodable(DECODE_WHOLE_BYTES, 'audio/mpeg')).toBe(true)
    expect(waveDecodable(DECODE_WHOLE_BYTES + 1, 'audio/mpeg')).toBe(false)
    // Too large by its item: nothing is fetched.
    wantWave({ ...audio, size: 9 * 1024 * 1024 })
    expect(gets).toBe(0)
  })

  it('draws a larger file’s shape as it is heard, the file’s own once nearly every bar is heard', () => {
    const hash = 'ab'.repeat(32)
    const need = Math.ceil(WAVE_BARS * HEARD_ENOUGH)
    for (let b = 0; b < need - 1; b++) noteLevel(hash, (b + 0.5) / WAVE_BARS, b % 2 ? 0.2 : 0.8, 60)
    expect(useWaveforms.getState().waves[hash]).toBeUndefined()
    noteLevel(hash, (need - 0.5) / WAVE_BARS, 0.4, 60)
    const wave = useWaveforms.getState().waves[hash]
    expect(wave.peaks).toHaveLength(WAVE_BARS)
    expect(wave.duration).toBe(60)
    expect(Math.max(...wave.peaks)).toBe(1)
    // Nonsense is ignored.
    noteLevel('cd'.repeat(32), 2, 0.5, 60)
    noteLevel('cd'.repeat(32), 0.5, Number.NaN, 60)
    expect(useWaveforms.getState().waves['cd'.repeat(32)]).toBeUndefined()
  })

  it('fills the bars not heard from their neighbours', () => {
    expect(heardShape([0.5, -1, 1, -1])).toEqual([0.5, 0.5, 1, 1])
  })
})
