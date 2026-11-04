/**
 * soundMutes.test.ts: NOW PLAYING's mutes (arkinox, 2026-11-03). A track
 * muted by its lineage id is still muted after you leave its area and come
 * back, and after a reload (IndexedDB, per device); a muted track still
 * plays, silent, so it still raises NOW PLAYING and stays listed, and
 * unmuting it is heard from where it is, the same voice, no restart; MUTE
 * ALL silences every hidden track and gives back each one's own switch when
 * it is turned off; neither touches TV's music. The gains are read from a
 * stand-in audio context that records what each gain is asked to be.
 */

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
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
import { playingRows, waitingCount } from '../../hud/NowPlaying'
import { applyGains, startPlanned } from '../../scene/HiddenAudio'
import { triggerFired } from '../../lib/audioTrigger'
import { shouldDuck } from '../../lib/audioWorld'
import type { WorldItem } from '../useShards'
import { cardKey, cardSounding, playAudio, setWorldGain, startWorld, stopAllAudio, stopWorld, useHiddenAudio, worldKey, type AudioEntry } from '../useHiddenAudio'
import { loadSoundMutes, resetSoundMutesForTests, soundMuteConnectionForTests, soundMutesSaved, toggleMasterMute, toggleTrackMute, trackSilenced, useSoundMutes } from '../useSoundMutes'
import * as tv from '../useTvMusic'

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

/** A gain's param, recording the level it was last asked to reach, and every call, in order. */
interface Param { value: number; calls: string[]; setTargetAtTime: (v: number) => Param; setValueAtTime: (v: number) => Param }
/** Every gain made, in order: the newest after a voice starts is that voice's. */
const params: Param[] = []

function recordingGain(): unknown {
  const param: Param = {
    value: 1,
    calls: [],
    setTargetAtTime: (v: number) => { param.value = v; param.calls.push(`ease ${v}`); return param },
    setValueAtTime: (v: number) => { param.value = v; param.calls.push(`set ${v}`); return param },
  }
  params.push(param)
  const base = anything() as Record<string | symbol, unknown>
  return new Proxy(base, { get: (t, k) => (k === 'gain' ? param : t[k]) })
}

class FakeContext extends EventTarget {
  state = 'running'
  currentTime = 0
  destination = anything()
  listener = anything()
  createGain(): unknown { return recordingGain() }
  createPanner(): unknown { return anything() }
  createMediaElementSource(): unknown { return anything() }
  createBufferSource(): unknown { return anything() }
  decodeAudioData(_bytes: ArrayBuffer, ok: (b: unknown) => void): Promise<unknown> {
    ok(Object.assign(Object.create(anything() as object), { length: 8000, numberOfChannels: 1 }))
    return new Promise(() => {})
  }
  async resume(): Promise<void> {}
}

class FakeAudio extends EventTarget {
  loop = false
  preload = ''
  paused = true
  muted = false
  src = ''
  play(): Promise<void> { this.paused = false; return Promise.resolve() }
  pause(): void { this.paused = true }
  removeAttribute(): void { this.src = '' }
  load(): void {}
}

let drip: AudioItem
/** Long enough (over DECODE_WHOLE_BYTES) to stream from an element, not decode whole. */
let drone: AudioItem
const realFetch = globalThis.fetch
const flush = async (): Promise<void> => { for (let i = 0; i < 8; i++) await Promise.resolve() }
/** A reload: the store forgets everything and reads it back from this device's database. */
const reload = async (): Promise<void> => { await soundMutesSaved(); resetSoundMutesForTests(); await loadSoundMutes() }
/** The newest gain: the voice just started. */
const lastGain = (): Param => params[params.length - 1]

beforeEach(async () => {
  // A fresh device: an empty IndexedDB.
  ;(globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory()
  await reload()
  const w = new EventTarget() as EventTarget & { AudioContext: typeof FakeContext }
  w.AudioContext = FakeContext
  vi.stubGlobal('window', w)
  vi.stubGlobal('Audio', FakeAudio)
  params.length = 0
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
  const up = await sealAndUpload(new Blob([toneWav(1) as BlobPart], { type: 'audio/wav' }), 'https://blossom.test', async (t) => finalizeEvent(t, generateSecretKey()))
  drip = { ...up, title: 'Drip', about: '', autoplay: true, loop: true, retrigger: 'once', walkOnly: false }
  const long = await sealAndUpload(new Blob([toneWav(70) as BlobPart], { type: 'audio/ogg' }), 'https://blossom.test', async (t) => finalizeEvent(t, generateSecretKey()))
  drone = { ...long, title: 'Drone', about: '', autoplay: true, loop: true, retrigger: 'once', walkOnly: false }
  useHiddenAudio.setState({ entries: {} })
  tv.useTvMusic.setState({ track: { title: 'Acid Bench', artist: 'Sethy Bowoy' } as never, muted: false, volume: 0.6 })
})

afterEach(() => {
  stopAllAudio()
  forgetAudioContext()
  globalThis.fetch = realFetch
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Start a world voice for item `key`, heard at `gain`, muted by track `track`; resolves with its gain. */
async function hear(key: string, track: string, gain = 0.8): Promise<Param> {
  setWorldGain(key, gain)
  await startWorld(key, drip, undefined, undefined, track)
  await flush()
  return lastGain()
}

describe('a track muted here', () => {
  it('is kept on this device by its lineage id: a reload reads it back, and unmuting forgets it', async () => {
    toggleTrackMute('lineage-a')
    await flush()
    await reload()
    expect(useSoundMutes.getState().tracks.has('lineage-a')).toBe(true)
    toggleTrackMute('lineage-a')
    await flush()
    await reload()
    expect(useSoundMutes.getState().tracks.has('lineage-a')).toBe(false)
  })

  it('is still muted when you leave its area and come back: a new voice for the same track starts silent', async () => {
    toggleTrackMute('lineage-a')
    let g = await hear('item-1', 'lineage-a')
    expect(g.value).toBe(0)
    // Leaving: the scene lets the voice go. A reload between, for good measure.
    stopWorld('item-1')
    expect(useHiddenAudio.getState().entries[worldKey('item-1')]).toBeUndefined()
    await flush()
    await reload()
    // Coming back: the item, moved by its hider, has a new key but keeps its lineage.
    g = await hear('item-1-moved', 'lineage-a')
    expect(g.value).toBe(0)
    // The region's fade goes on changing underneath, still unheard.
    setWorldGain('item-1-moved', 1)
    expect(g.value).toBe(0)
  })

  it('still plays, so NOW PLAYING still rises for it and lists it, muted', async () => {
    toggleTrackMute('lineage-a')
    await hear('item-1', 'lineage-a')
    const e = useHiddenAudio.getState().entries[worldKey('item-1')]
    expect(e).toMatchObject({ phase: 'playing', trackId: 'lineage-a' })
    const rows = playingRows(useHiddenAudio.getState().entries, null, false, useSoundMutes.getState())
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ title: 'Drip', meta: 'here · muted', muted: true, silenced: true, trackId: 'lineage-a' })
  })

  it('is heard again from where it is when unmuted: the same voice, its region fade, no restart', async () => {
    toggleTrackMute('lineage-a')
    const g = await hear('item-1', 'lineage-a', 0.7)
    const made = params.length
    expect(g.value).toBe(0)
    toggleTrackMute('lineage-a')
    expect(g.value).toBeCloseTo(0.7)
    expect(params.length).toBe(made)
    expect(useHiddenAudio.getState().entries[worldKey('item-1')]?.phase).toBe('playing')
  })

  it('silences its card PLAY too, by the same id', async () => {
    toggleTrackMute('lineage-a')
    await playAudio('item-1', drip, undefined, 'lineage-a')
    await flush()
    expect(useHiddenAudio.getState().entries[cardKey('item-1')]).toMatchObject({ phase: 'playing', trackId: 'lineage-a' })
    expect(lastGain().value).toBe(0)
    toggleTrackMute('lineage-a')
    expect(lastGain().value).toBe(1)
  })
})

describe('MUTE ALL', () => {
  it('silences every hidden track, and turning it off gives back each track\'s own switch', async () => {
    toggleTrackMute('lineage-a')
    const a = await hear('item-a', 'lineage-a', 0.5)
    const b = await hear('item-b', 'lineage-b', 0.9)
    expect([a.value, b.value]).toEqual([0, 0.9])
    toggleMasterMute()
    expect([a.value, b.value]).toEqual([0, 0])
    expect(useSoundMutes.getState().tracks.has('lineage-a')).toBe(true)
    expect(useSoundMutes.getState().tracks.has('lineage-b')).toBe(false)
    // A track muted on its own while MUTE ALL is on stays so after.
    toggleTrackMute('lineage-b')
    toggleTrackMute('lineage-b')
    toggleMasterMute()
    expect(a.value).toBe(0)
    expect(b.value).toBeCloseTo(0.9)
  })

  it('is kept across a reload, and leaves the tracks it covered listed as muted', async () => {
    toggleMasterMute()
    await flush()
    await reload()
    expect(useSoundMutes.getState().master).toBe(true)
    const g = await hear('item-b', 'lineage-b')
    expect(g.value).toBe(0)
    const rows = playingRows(useHiddenAudio.getState().entries, null, false, useSoundMutes.getState())
    expect(rows[0]).toMatchObject({ meta: 'here · all muted', muted: false, silenced: true })
  })
})

describe('Cyberspace TV', () => {
  it('is not touched by MUTE ALL (RULED 2026-11-03): its mute, its volume and its row stay as they were', async () => {
    const mute = vi.spyOn(tv, 'toggleMusicMute')
    toggleMasterMute()
    expect(mute).not.toHaveBeenCalled()
    expect(tv.useTvMusic.getState()).toMatchObject({ muted: false, volume: 0.6 })
    const rows = playingRows({}, { title: 'Acid Bench', artist: 'Sethy Bowoy' }, false, useSoundMutes.getState())
    expect(rows[0]).toMatchObject({ key: 'tv', meta: 'Cyberspace TV', muted: false, silenced: false })
  })

  it('is not stepped down by a card nobody can hear', async () => {
    const duck = vi.spyOn(tv, 'duckMusic')
    toggleTrackMute('lineage-a')
    await playAudio('item-1', drip, undefined, 'lineage-a')
    await flush()
    expect(useHiddenAudio.getState().entries[cardKey('item-1')]?.phase).toBe('playing')
    expect(cardSounding()).toBe(false)
    expect(duck.mock.calls.at(-1)?.[0]).toBe(1)
    toggleTrackMute('lineage-a')
    expect(cardSounding()).toBe(true)
    expect(duck.mock.calls.at(-1)?.[0]).toBeLessThan(1)
  })
})

describe('before the switches are read', () => {
  it('holds every track silent, so one muted last time is not heard while the read lands', async () => {
    resetSoundMutesForTests()
    expect(trackSilenced('anything')).toBe(true)
    await loadSoundMutes()
    expect(trackSilenced('anything')).toBe(false)
  })

  it('a switch flipped before the read is not undone by it', async () => {
    // Stored: nothing muted. Flipped while the read is still out: MUTE ALL on, a track on.
    resetSoundMutesForTests()
    toggleMasterMute()
    toggleTrackMute('lineage-a')
    await loadSoundMutes()
    expect(useSoundMutes.getState()).toMatchObject({ master: true, ready: true })
    expect(useSoundMutes.getState().tracks.has('lineage-a')).toBe(true)
  })
})

/** A world item as the scene holds one: its key, and the lineage a move keeps. */
const item = (key: string, lineage: string, audio: AudioItem): WorldItem => ({ key, type: 'audio', audio, lineage } as unknown as WorldItem)
let seq = 0
/** A lineage no other test has fired. */
const fresh = (): string => `lineage-${Date.now()}-${seq++}`
/** The scene does not wait for a voice to start: wait here until it sounds. */
const sounding = (key: string): Promise<void> => vi.waitFor(() => expect(useHiddenAudio.getState().entries[worldKey(key)]?.phase).toBe('playing'), { timeout: 3000, interval: 5 })

describe('a streamed world voice (a file too long to decode whole)', () => {
  it('starts silent when its track is muted, and is heard at its fade when unmuted', async () => {
    toggleTrackMute('lineage-d')
    setWorldGain('long-1', 0.6)
    await startWorld('long-1', drone, undefined, undefined, 'lineage-d')
    await flush()
    expect(useHiddenAudio.getState().entries[worldKey('long-1')]?.phase).toBe('playing')
    const g = lastGain()
    expect(g.value).toBe(0)
    expect(g.calls).toEqual(['set 0'])
    toggleTrackMute('lineage-d')
    expect(g.value).toBeCloseTo(0.6)
  })
})

describe('the scene', () => {
  it('starts each planned voice muted by its item\'s lineage, not its key', async () => {
    toggleTrackMute('lineage-moved')
    setWorldGain('new-key', 0.9)
    startPlanned([{ key: 'new-key', oneShot: false, lineage: 'lineage-moved' }], new Map([['new-key', item('new-key', 'lineage-moved', drip)]]))
    await sounding('new-key')
    expect(useHiddenAudio.getState().entries[worldKey('new-key')]?.trackId).toBe('lineage-moved')
    expect(lastGain().value).toBe(0)
  })

  it('steps TV\'s music down only for the voices that are heard', () => {
    const items = new Map([['a', item('a', 'lineage-a', drip)], ['b', item('b', 'lineage-b', drip)]])
    toggleTrackMute('lineage-a')
    expect(applyGains(new Map([['a', 0.9]]), items)).toEqual([])
    expect(shouldDuck(applyGains(new Map([['a', 0.9]]), items), false)).toBe(false)
    expect(applyGains(new Map([['a', 0.9], ['b', 0.4]]), items)).toEqual([0.4])
    toggleMasterMute()
    expect(applyGains(new Map([['b', 0.4]]), items)).toEqual([])
  })
})

describe('a FIRST ENTRY one-shot (once-trigger)', () => {
  const oneShot = (): AudioItem => ({ ...drip, loop: false, retrigger: 'once' })
  const startOnce = (key: string, lineage: string): void => {
    startPlanned([{ key, oneShot: true, lineage }], new Map([[key, item(key, lineage, oneShot())]]))
  }

  it('heard: spends its trigger as it sounds', async () => {
    const l = fresh()
    startOnce('o-1', l)
    await sounding('o-1')
    expect(useHiddenAudio.getState().entries[worldKey('o-1')]?.phase).toBe('playing')
    expect(triggerFired(l)).toBe(true)
  })

  it('muted: plays unheard and keeps its trigger; unmuted while it plays, it spends it then', async () => {
    const l = fresh()
    toggleTrackMute(l)
    startOnce('o-2', l)
    await sounding('o-2')
    expect(useHiddenAudio.getState().entries[worldKey('o-2')]?.phase).toBe('playing')
    expect(triggerFired(l)).toBe(false)
    toggleTrackMute(l)
    expect(triggerFired(l)).toBe(true)
  })

  it('under MUTE ALL, and stopped before it is heard: the trigger is left for the next entry', async () => {
    const l = fresh()
    toggleMasterMute()
    startOnce('o-3', l)
    await sounding('o-3')
    expect(triggerFired(l)).toBe(false)
    stopWorld('o-3')
    toggleMasterMute()
    expect(triggerFired(l)).toBe(false)
  })

  it('before the switches are read: held, and spent once they are read and it is heard', async () => {
    const l = fresh()
    resetSoundMutesForTests()
    startOnce('o-4', l)
    await sounding('o-4')
    expect(useHiddenAudio.getState().entries[worldKey('o-4')]?.phase).toBe('playing')
    expect(triggerFired(l)).toBe(false)
    await loadSoundMutes()
    expect(triggerFired(l)).toBe(true)
  })
})

describe('the connection', () => {
  it('one the browser says it closed is let go at once, and the next flip opens another and is kept', async () => {
    toggleTrackMute('lineage-a')
    await soundMutesSaved()
    const conn = await soundMuteConnectionForTests()!
    conn.close()
    conn.onclose?.call(conn, new Event('close'))
    expect(soundMuteConnectionForTests()).toBeNull()
    toggleTrackMute('lineage-b')
    await reload()
    expect([...useSoundMutes.getState().tracks].sort()).toEqual(['lineage-a', 'lineage-b'])
  })

  it('one that died with no word (Safari\'s lost connection): the write is tried once more on a fresh one', async () => {
    toggleTrackMute('lineage-a')
    await soundMutesSaved()
    const conn = await soundMuteConnectionForTests()!
    conn.close()
    toggleTrackMute('lineage-b')
    await reload()
    expect([...useSoundMutes.getState().tracks].sort()).toEqual(['lineage-a', 'lineage-b'])
  })

  it('an open that fails is tried again, and what it could not write is written with the next flip', async () => {
    const real = (globalThis as { indexedDB: unknown }).indexedDB
    ;(globalThis as { indexedDB: unknown }).indexedDB = { open: () => { throw new Error('not now') } }
    resetSoundMutesForTests()
    await loadSoundMutes()
    toggleTrackMute('lineage-a')
    await soundMutesSaved()
    ;(globalThis as { indexedDB: unknown }).indexedDB = real
    toggleTrackMute('lineage-b')
    await reload()
    expect([...useSoundMutes.getState().tracks].sort()).toEqual(['lineage-a', 'lineage-b'])
  })
})

describe('what NOW PLAYING says before the switches are read, and TAP FOR SOUND', () => {
  it('rows are silent until the switches are read', () => {
    const entries: Record<string, AudioEntry> = { [worldKey('w')]: { phase: 'playing', title: 'Drip', mode: 'world', itemKey: 'w', trackId: 'lineage-a' } }
    expect(playingRows(entries, null, false, { tracks: new Set(), master: false, ready: false })[0]).toMatchObject({ muted: false, silenced: true })
    expect(playingRows(entries, null, false, { tracks: new Set(), master: false, ready: true })[0]).toMatchObject({ muted: false, silenced: false })
  })

  it('TAP FOR SOUND counts only voices that would be heard', () => {
    const entries: Record<string, AudioEntry> = {
      [worldKey('w1')]: { phase: 'waiting', title: 'A', mode: 'world', itemKey: 'w1', trackId: 'lineage-a' },
      [worldKey('w2')]: { phase: 'waiting', title: 'B', mode: 'world', itemKey: 'w2', trackId: 'lineage-b' },
    }
    toggleTrackMute('lineage-a')
    expect(waitingCount(entries, (e) => trackSilenced(e.trackId))).toBe(1)
    toggleMasterMute()
    expect(waitingCount(entries, (e) => trackSilenced(e.trackId))).toBe(0)
  })

  it('a muted card starts at silence at once, never eased down from full', async () => {
    toggleTrackMute('lineage-a')
    await playAudio('c-1', drip, undefined, 'lineage-a')
    await flush()
    expect(lastGain().calls[0]).toBe('set 0')
  })
})
