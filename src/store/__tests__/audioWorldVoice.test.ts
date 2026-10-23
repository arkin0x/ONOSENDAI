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
import { startWorld, stopAllAudio, useHiddenAudio, worldFailed, worldFailure, worldKey } from '../useHiddenAudio'

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
  async resume(): Promise<void> {}
}

const made: FakeAudio[] = []
/** An element stand-in: refused outside a tap, and it can fail to decode. */
class FakeAudio extends EventTarget {
  static allowed = false
  loop = false
  preload = ''
  src = ''
  paused = true
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
const realFetch = globalThis.fetch
const flush = async (): Promise<void> => { for (let i = 0; i < 6; i++) await Promise.resolve() }

beforeEach(async () => {
  const w = new EventTarget() as EventTarget & { AudioContext: typeof FakeContext }
  w.AudioContext = FakeContext
  vi.stubGlobal('window', w)
  vi.stubGlobal('Audio', FakeAudio)
  FakeAudio.allowed = false
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
  const up = await sealAndUpload(new Blob([toneWav() as BlobPart], { type: 'audio/ogg' }), 'https://blossom.test', async (t) => finalizeEvent(t, generateSecretKey()))
  audio = { ...up, title: 'Drone', about: '', autoplay: true, loop: true, retrigger: 'once', walkOnly: false }
})

afterEach(() => {
  stopAllAudio()
  forgetAudioContext()
  globalThis.fetch = realFetch
  vi.unstubAllGlobals()
})

describe('a world voice', () => {
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
