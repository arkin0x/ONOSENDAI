/**
 * audioWorldVoice.test.ts: a world voice through three, on a stand-in audio
 * context (review of #466, round 2). A file this browser cannot decode,
 * failing while its voice waits for a tap, is a failure of the item: it
 * waits out its pause and the scene does not start it again at once; a
 * voice that sounds is forgiven its earlier failures. Nothing leaves the
 * machine.
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

vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { forgetOpenedAudio, sealAndUpload } from '../../lib/audioFile'
import type { AudioItem } from '../../lib/audioItem'
import { sha256Hex } from '../../lib/blossom'
import { forgetAudioContext } from '../../lib/audioContext'
import { toneWav } from '../../lib/__tests__/audioFixture'
import { DECODE_WHOLE_MAX_PCM, DECODE_WHOLE_SECONDS, decodedFits, startWorld, stopAllAudio, useHiddenAudio, worldFailed, worldFailure, worldKey } from '../useHiddenAudio'

/** Any Web Audio node or param: every property is another, every call returns another, numbers are 0. */
function anything(): unknown {
  const fn = function () { /* a node */ }
  const p: unknown = new Proxy(fn, {
    get: (_t, k) => (k === 'then' ? undefined : k === Symbol.toPrimitive ? () => 0 : k === 'state' ? 'running' : k === 'currentTime' ? 0 : p),
    set: () => true,
    apply: () => p,
  })
  return p
}

class FakeContext extends EventTarget {
  state = 'running'
  currentTime = 0
  destination = anything()
  listener = anything()
  createGain(): unknown { return anything() }
  createPanner(): unknown { return anything() }
  createMediaElementSource(): unknown { return anything() }
  createBufferSource(): unknown { return anything() }
  static decodable = true
  /** What a decode gives: a stand-in buffer, or one of a given size. */
  static decoded: { length: number; numberOfChannels: number } | null = null
  decodeAudioData(_bytes: ArrayBuffer, ok: (b: unknown) => void, fail: () => void): Promise<unknown> {
    if (FakeContext.decodable) ok(FakeContext.decoded ?? Object.assign(Object.create(anything() as object), { length: 8000, numberOfChannels: 1 }))
    else fail()
    return new Promise(() => {})
  }
  async resume(): Promise<void> {}
}

const made: FakeAudio[] = []
/** An element stand-in: refused outside a tap, and it can fail to decode. */
class FakeAudio extends EventTarget {
  static allowed = false
  /** The length metadata reports, in seconds; null: none comes. */
  static metaSeconds: number | null = 1
  loop = false
  preload = ''
  paused = true
  duration = NaN
  private source = ''
  get src(): string { return this.source }
  set src(v: string) {
    this.source = v
    if (v && this.preload === 'metadata' && FakeAudio.metaSeconds !== null) {
      this.duration = FakeAudio.metaSeconds
      queueMicrotask(() => this.dispatchEvent(new Event('loadedmetadata')))
    }
  }
  constructor() { super(); made.push(this) }
  play(): Promise<void> {
    if (!FakeAudio.allowed) return Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' }))
    this.paused = false
    return Promise.resolve()
  }
  pause(): void { this.paused = true }
  removeAttribute(): void { this.src = '' }
  load(): void {}
}

let audio: AudioItem
let shortAudio: AudioItem
const realFetch = globalThis.fetch
const flush = async (): Promise<void> => { for (let i = 0; i < 6; i++) await Promise.resolve() }

beforeEach(async () => {
  const w = new EventTarget() as EventTarget & { AudioContext: typeof FakeContext }
  w.AudioContext = FakeContext
  vi.stubGlobal('window', w)
  vi.stubGlobal('Audio', FakeAudio)
  FakeAudio.allowed = false
  FakeAudio.metaSeconds = 1
  FakeContext.decodable = true
  FakeContext.decoded = null
  made.length = 0
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
    const b = blobs.get(String(input).split('/').pop()!)
    return b ? new Response(b as BodyInit, { status: 200 }) : new Response(null, { status: 404 })
  }) as typeof fetch
  forgetOpenedAudio()
  // Long enough (over DECODE_WHOLE_BYTES) to stream from an element.
  const up = await sealAndUpload(new Blob([toneWav(70) as BlobPart], { type: 'audio/ogg' }), 'https://blossom.test', async (t) => finalizeEvent(t, generateSecretKey()))
  audio = { ...up, title: 'Drone', about: '', autoplay: true, loop: true, retrigger: 'once', walkOnly: false }
  const short = await sealAndUpload(new Blob([toneWav(1) as BlobPart], { type: 'audio/wav' }), 'https://blossom.test', async (t) => finalizeEvent(t, generateSecretKey()))
  shortAudio = { ...short, title: 'Drip', about: '', autoplay: true, loop: true, retrigger: 'once', walkOnly: false }
})

afterEach(() => {
  stopAllAudio()
  forgetAudioContext()
  globalThis.fetch = realFetch
  vi.unstubAllGlobals()
})

/** Elements made to stream a file (the length probe's are not). */
const streaming = (): FakeAudio[] => made.filter((e) => e.preload === 'auto')

describe('a short loop, decoded whole', () => {
  it('plays from a buffer, with no streaming element and no tap of its own once sound is out', async () => {
    await startWorld('b1', shortAudio)
    await flush()
    expect(useHiddenAudio.getState().entries[worldKey('b1')]?.phase).toBe('playing')
    expect(streaming()).toHaveLength(0)
  })

  it('is decoded whole only when it is a loop, short in time by its own metadata, and small once decoded; anything else streams', async () => {
    FakeAudio.allowed = true
    // A one-shot gains nothing from it.
    await startWorld('o1', { ...shortAudio, loop: false })
    await flush()
    expect(streaming()).toHaveLength(1)
    // A tiny file can be a long one: past DECODE_WHOLE_SECONDS it streams.
    FakeAudio.metaSeconds = DECODE_WHOLE_SECONDS + 1
    await startWorld('o2', shortAudio)
    await flush()
    expect(streaming()).toHaveLength(2)
    // Its length unknown, it streams.
    FakeAudio.metaSeconds = null
    await startWorld('o3', shortAudio)
    await new Promise((r) => setTimeout(r, 3100))
    await flush()
    expect(streaming()).toHaveLength(3)
    // Short by its metadata but large once decoded, or more than two channels: it streams.
    FakeAudio.metaSeconds = 1
    FakeContext.decoded = { length: DECODE_WHOLE_MAX_PCM, numberOfChannels: 1 }
    await startWorld('o4', shortAudio)
    await flush()
    expect(streaming()).toHaveLength(4)
    FakeContext.decoded = { length: 1000, numberOfChannels: 6 }
    await startWorld('o5', shortAudio)
    await flush()
    expect(streaming()).toHaveLength(5)
    expect(decodedFits({ length: 1000, numberOfChannels: 2 })).toBe(true)
  }, 10_000)

  it('that this browser cannot decode is a failure of the item, and waits out its pause', async () => {
    FakeContext.decodable = false
    await startWorld('b2', shortAudio)
    await flush()
    expect(useHiddenAudio.getState().entries[worldKey('b2')]).toBeUndefined()
    expect(worldFailed('b2')).toBe(true)
  })
})

describe('a long world file, streamed', () => {
  it('that fails to decode while it waits for a tap is a failure of the item, and waits out its pause', async () => {
    await startWorld('w1', audio)
    await flush()
    expect(useHiddenAudio.getState().entries[worldKey('w1')]?.phase).toBe('waiting')
    made.at(-1)!.dispatchEvent(new Event('error'))
    expect(useHiddenAudio.getState().entries[worldKey('w1')]).toBeUndefined()
    expect(worldFailed('w1')).toBe(true)
  })

  it('that sounds is forgiven what failed before', async () => {
    worldFailure('w2', new Error('once'))
    expect(worldFailed('w2')).toBe(true)
    FakeAudio.allowed = true
    await startWorld('w2', audio)
    await flush()
    expect(useHiddenAudio.getState().entries[worldKey('w2')]?.phase).toBe('playing')
    expect(worldFailed('w2')).toBe(false)
  })
})
