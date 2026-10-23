/**
 * audioVoices.test.ts: voices the browser will not let play, failures, and
 * ducking (review of #466). A play refused for want of a tap waits, TAP FOR
 * SOUND counts it, and the next tap plays it inside that gesture; a world
 * item that fails waits out a growing pause before it is tried again; a
 * card's PLAY steps TV's music down even with the scene away. The element
 * is a stand-in and the file comes from a server in memory.
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
import { waitingCount } from '../../hud/NowPlaying'
import { toneWav } from '../../lib/__tests__/audioFixture'
import { cardKey, letSoundOut, playAudio, stopAllAudio, useHiddenAudio, worldFailed, worldFailure } from '../useHiddenAudio'
import * as tv from '../useTvMusic'

/** An element stand-in whose play is refused until `allowed`, as Safari refuses one outside a tap. */
class FakeAudio extends EventTarget {
  static allowed = false
  static plays = 0
  loop = false
  preload = ''
  src = ''
  paused = true
  play(): Promise<void> {
    FakeAudio.plays++
    if (!FakeAudio.allowed) return Promise.reject(Object.assign(new Error('not allowed'), { name: 'NotAllowedError' }))
    this.paused = false
    return Promise.resolve()
  }
  pause(): void { this.paused = true }
  removeAttribute(): void { this.src = '' }
  load(): void {}
}

let audio: AudioItem
const realFetch = globalThis.fetch
const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve() }

beforeEach(async () => {
  vi.stubGlobal('Audio', FakeAudio)
  FakeAudio.allowed = false
  FakeAudio.plays = 0
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
  const up = await sealAndUpload(new Blob([toneWav() as BlobPart], { type: 'audio/wav' }), 'https://blossom.test', async (t) => finalizeEvent(t, generateSecretKey()))
  audio = { ...up, title: 'Bell', about: '', autoplay: true, loop: true, retrigger: 'once', walkOnly: false }
  useHiddenAudio.setState({ entries: {} })
})

afterEach(() => {
  stopAllAudio()
  globalThis.fetch = realFetch
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('a voice the browser will not let play', () => {
  it('waits, is counted by TAP FOR SOUND, and the next tap plays it in that gesture', async () => {
    await playAudio('k1', audio)
    await flush()
    expect(useHiddenAudio.getState().entries[cardKey('k1')]?.phase).toBe('waiting')
    expect(waitingCount(useHiddenAudio.getState().entries)).toBe(1)
    // The tap: its play is called in the same gesture, and now the browser allows it.
    FakeAudio.allowed = true
    const before = FakeAudio.plays
    letSoundOut()
    expect(FakeAudio.plays).toBe(before + 1)
    await flush()
    expect(useHiddenAudio.getState().entries[cardKey('k1')]?.phase).toBe('playing')
    expect(waitingCount(useHiddenAudio.getState().entries)).toBe(0)
  })

  it('a tap with nothing waiting plays nothing', () => {
    letSoundOut()
    expect(FakeAudio.plays).toBe(0)
  })
})

describe('a world item that fails', () => {
  it('waits out a pause that grows with each failure in a row, so a dead URL is not fetched every tick', () => {
    const t0 = performance.now()
    worldFailure('w1', new Error('404'))
    expect(worldFailed('w1', t0 + 1000)).toBe(true)
    expect(worldFailed('w1', t0 + 16_000)).toBe(false)
    worldFailure('w1', new Error('404'))
    const t1 = performance.now()
    expect(worldFailed('w1', t1 + 59_000)).toBe(true)
    expect(worldFailed('w1', t1 + 61_000)).toBe(false)
    expect(worldFailed('other')).toBe(false)
  })
})

describe('TV ducking', () => {
  it('a card\'s PLAY steps TV\'s music down from the store, scene or not, and back up when it stops', async () => {
    const duck = vi.spyOn(tv, 'duckMusic')
    FakeAudio.allowed = true
    await playAudio('k2', audio)
    await flush()
    expect(useHiddenAudio.getState().entries[cardKey('k2')]?.phase).toBe('playing')
    expect(duck.mock.calls.at(-1)?.[0]).toBeLessThan(1)
    stopAllAudio()
    expect(duck.mock.calls.at(-1)?.[0]).toBe(1)
  })
})
