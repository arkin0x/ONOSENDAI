/**
 * tvExplainer.test.ts: an explainer comes due, loads, plays at once (never
 * waiting on the song), ducking the music rather than pausing it, and gives
 * the picture back; and one that will not load, fails its hash, stalls,
 * errors or runs long never leaves the tube black (store/useTvExplainer).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const music = vi.hoisted(() => ({ duckedOn: 0, duckedOff: 0, volume: 0.8, muted: false, listeners: [] as Array<(s: { volume: number; muted: boolean }, p: { volume: number; muted: boolean }) => void> }))
vi.mock('../useTvMusic', () => ({
  duckMusicForExplainer: (on: boolean) => { if (on) music.duckedOn++; else music.duckedOff++ },
  useTvMusic: {
    getState: () => ({ volume: music.volume, muted: music.muted }),
    subscribe: (fn: (s: { volume: number; muted: boolean }, p: { volume: number; muted: boolean }) => void) => { music.listeners.push(fn); return () => { music.listeners = music.listeners.filter((l) => l !== fn) } },
  },
}))
/** The viewer changes the music's level, as NOW PLAYING or the tag's tap and drag do. */
function setLevel(volume: number, muted: boolean): void {
  const prev = { volume: music.volume, muted: music.muted }
  music.volume = volume
  music.muted = muted
  for (const l of [...music.listeners]) l({ volume, muted }, prev)
}

import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '../../lib/events'
import {
  EXPLAINER_AD_GAP_MS, EXPLAINER_EVERY_MS, EXPLAINER_FAIL_OUT_MS, EXPLAINER_FIRST_MS, EXPLAINER_FORCED_MS, EXPLAINER_IN_MS, EXPLAINER_LOAD_MS,
  EXPLAINER_OUT_MS, EXPLAINER_RETRY_MS, EXPLAINER_STALL_MS, guardMs, type Explainer,
} from '../../lib/tv/explainer'
import {
  explainerBusy, explainerDueForTest, explainerEndedAt, explainerTick, explainerVideo, setExplainerLineupForTest, startExplainers, stopExplainers,
  useTvExplainer, explainerCaption, explainerSoundHeld,
} from '../useTvExplainer'
import { setBroadcastForTest } from '../../lib/tv/broadcast'

/** A video element: plays when asked (unless told not to), its time moved by the test. */
class FakeVideo extends EventTarget {
  static made: FakeVideo[] = []
  static canPlay: (t: string) => string = () => 'probably'
  static ready = true
  static refuse: 'none' | 'sound' | 'all' = 'none'
  playsInline = false
  preload = ''
  muted = false
  volume = 1
  currentTime = 0
  paused = true
  ended = false
  error: unknown = null
  readyState = 0
  videoWidth = 1280
  videoHeight = 720
  private source = ''
  plays = 0
  constructor() { super(); FakeVideo.made.push(this) }
  canPlayType(t: string): string { return FakeVideo.canPlay(t) }
  get src(): string { return this.source }
  set src(v: string) {
    this.source = v
    if (FakeVideo.ready) queueMicrotask(() => { this.readyState = 4; this.dispatchEvent(new Event('canplay')) })
  }
  removeAttribute(): void { this.source = '' }
  load(): void {}
  /** A pause of a playing element is told a moment later, as a real one's is. */
  pause(): void {
    if (this.paused) return
    this.paused = true
    queueMicrotask(() => this.dispatchEvent(new Event('pause')))
  }
  play(): Promise<void> {
    this.plays++
    if (FakeVideo.refuse === 'all' || (FakeVideo.refuse === 'sound' && !this.muted)) return Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' }))
    this.paused = false
    return Promise.resolve()
  }
}

const bytes = new TextEncoder().encode('a test video')
const HASH = bytesToHex(sha256(bytes))
const one = (id: string, over: Partial<Explainer> = {}): Explainer => ({
  id, title: id.toUpperCase(), duration: 30,
  files: [{ url: `https://b.example/${HASH}.webm`, type: 'video/webm; codecs="vp9, opus"' }],
  ...over,
})
let fetched: string[] = []
let fetchBody: (url: string) => Response | Promise<Response> = () => new Response(bytes as BodyInit)

const video = (): FakeVideo => FakeVideo.made[FakeVideo.made.length - 1]
const phase = (): string | null => useTvExplainer.getState().showing?.phase ?? null
const playing = { playing: true, ad: false, adEndedAt: -Infinity }

/** Tick as TV does, every 100 ms, for `ms`, letting promises settle; the video's clock moves while it plays. */
async function run(ms: number, tv = playing, moving = true): Promise<void> {
  for (let t = 0; t < ms; t += 100) {
    await vi.advanceTimersByTimeAsync(100)
    const v = FakeVideo.made.length ? video() : null
    if (v && !v.paused && moving) v.currentTime += 0.1
    explainerTick(performance.now(), tv)
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] })
  FakeVideo.made = []
  FakeVideo.canPlay = () => 'probably'
  FakeVideo.ready = true
  FakeVideo.refuse = 'none'
  Object.assign(music, { duckedOn: 0, duckedOff: 0, volume: 0.8, muted: false, listeners: [] })
  fetched = []
  fetchBody = () => new Response(bytes as BodyInit)
  vi.stubGlobal('document', { createElement: () => new FakeVideo() })
  // The hash in step with the fake clock: the browser's own answers on a
  // thread of its own, at no fixed moment of it (the fallback is the same sum).
  const real = globalThis.crypto
  vi.stubGlobal('crypto', { getRandomValues: <T extends ArrayBufferView>(a: T): T => real.getRandomValues(a as never) })
  vi.stubGlobal('fetch', async (url: string) => { fetched.push(url); return fetchBody(url) })
  setExplainerLineupForTest([one('1-a'), one('2-b')])
})

afterEach(() => {
  stopExplainers()
  setExplainerLineupForTest(null)
  setBroadcastForTest(null)
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Cyberspace TV explainers', () => {
  it('with the lineup empty, never comes due and changes nothing', async () => {
    setExplainerLineupForTest([])
    startExplainers(performance.now(), '')
    expect(explainerDueForTest()).toBe(Infinity)
    await run(EXPLAINER_FIRST_MS + 30_000)
    expect(fetched).toEqual([])
    expect(explainerBusy()).toBe(false)
    expect(music.duckedOn + music.duckedOff).toBe(0)
  })

  it('a forced id with the lineup empty is nothing', () => {
    setExplainerLineupForTest([])
    startExplainers(performance.now(), '?explainer=1-a')
    expect(explainerDueForTest()).toBe(Infinity)
  })

  it('comes due, loads, and plays at once, the music ducked rather than waited for', async () => {
    startExplainers(performance.now(), '')
    await run(EXPLAINER_FIRST_MS - 500)
    expect(fetched).toEqual([])
    await run(600)
    expect(fetched).toHaveLength(1)
    expect(explainerBusy()).toBe(true)
    // Ready: on screen at once, the music ducked rather than waited for.
    await run(300)
    expect(phase()).toBe('in')
    expect(music.duckedOn).toBe(1)
    expect(video().plays).toBe(1)
    expect(video().muted).toBe(false)
    expect(video().volume).toBeCloseTo(0.8)
    expect(explainerVideo()).toBe(video())
    await run(EXPLAINER_IN_MS)
    expect(phase()).toBe('play')
    await run(20_000)
    expect(phase()).toBe('play')
    expect(music.duckedOff).toBe(0)
    // It ends: the picture comes back, and the music is given back.
    video().ended = true
    await run(100)
    expect(phase()).toBe('out')
    expect(useTvExplainer.getState().showing?.outMs).toBe(EXPLAINER_OUT_MS)
    expect(music.duckedOff).toBe(1)
    await run(EXPLAINER_OUT_MS)
    expect(phase()).toBeNull()
    expect(explainerBusy()).toBe(false)
    expect(explainerVideo()).toBeNull()
    const ended = explainerEndedAt()
    expect(Number.isFinite(ended)).toBe(true)
    // The next, in turn, EXPLAINER_EVERY_MS on.
    expect(explainerDueForTest()).toBe(ended + EXPLAINER_EVERY_MS)
  })

  it('takes the lineup in turn, every EXPLAINER_EVERY_MS', async () => {
    startExplainers(performance.now(), '')
    const ids: string[] = []
    const off = useTvExplainer.subscribe((s, p) => { if (s.showing && !p.showing) ids.push(s.showing.id) })
    for (let i = 0; i < 3; i++) {
      await run((i === 0 ? EXPLAINER_FIRST_MS : EXPLAINER_EVERY_MS) + 1000)
      video().ended = true
      await run(EXPLAINER_OUT_MS + 200)
    }
    off()
    expect(ids).toEqual(['1-a', '2-b', '1-a'])
  })

  it('shows as soon as the video is ready, never waiting on the song (arkinox, 2026-10-24)', async () => {
    startExplainers(performance.now(), '')
    // Well inside what used to be the wait for the song to end: on screen already.
    await run(EXPLAINER_FIRST_MS + 500)
    expect(phase()).toBe('in')
    expect(music.duckedOn).toBe(1)
  })

  it('/tv?explainer=<id> plays that one first, at once', async () => {
    startExplainers(performance.now(), '?explainer=2-b')
    await run(EXPLAINER_FORCED_MS + 500)
    expect(useTvExplainer.getState().showing?.id).toBe('2-b')
  })

  it('one asked for by name plays before the tape does (a look at it), but never over the spot', async () => {
    startExplainers(performance.now(), '?explainer=1-a')
    await run(EXPLAINER_FORCED_MS + 500, { playing: false, ad: true, adEndedAt: -Infinity })
    expect(fetched).toEqual([])
    await run(500, { playing: false, ad: false, adEndedAt: -Infinity })
    expect(phase()).toBe('in')
    expect(useTvExplainer.getState().showing?.id).toBe('1-a')
  })

  it('never over the HOSAKA spot or within EXPLAINER_AD_GAP_MS after it, nor before the tape plays', async () => {
    startExplainers(performance.now(), '')
    await run(EXPLAINER_FIRST_MS + 1000, { playing: true, ad: true, adEndedAt: -Infinity })
    expect(fetched).toEqual([])
    const end = performance.now()
    await run(EXPLAINER_AD_GAP_MS - 1000, { playing: true, ad: false, adEndedAt: end })
    expect(fetched).toEqual([])
    await run(2000, { playing: false, ad: false, adEndedAt: end })
    expect(fetched).toEqual([])
    await run(200, { playing: true, ad: false, adEndedAt: end })
    expect(fetched).toHaveLength(1)
  })

  it('a file that fails its hash is skipped: nothing shows, the music is never touched', async () => {
    fetchBody = () => new Response(new TextEncoder().encode('something else') as BodyInit)
    startExplainers(performance.now(), '')
    const t0 = performance.now()
    await run(EXPLAINER_FIRST_MS + 2000)
    expect(fetched).toHaveLength(1)
    expect(phase()).toBeNull()
    expect(explainerBusy()).toBe(false)
    expect(music.duckedOn + music.duckedOff).toBe(0)
    expect(explainerDueForTest()).toBeGreaterThan(t0 + EXPLAINER_FIRST_MS + EXPLAINER_RETRY_MS - 1000)
  })

  it('a file with the wrong hash is never fetched again this visit; one that did not arrive is', async () => {
    fetchBody = () => new Response(new TextEncoder().encode('something else') as BodyInit)
    startExplainers(performance.now(), '')
    await run(EXPLAINER_FIRST_MS + 1000)
    expect(fetched).toHaveLength(1)
    fetchBody = () => new Response(bytes as BodyInit)
    await run(EXPLAINER_RETRY_MS + 1000)
    // The same file (both entries share it here): skipped without a fetch.
    expect(fetched).toHaveLength(1)
    expect(explainerBusy()).toBe(false)
    // A file that never arrived is fetched again later.
    setExplainerLineupForTest([one('1-a')])
    let down = true
    fetchBody = () => (down ? Promise.reject(new TypeError('offline')) : new Response(bytes as BodyInit))
    startExplainers(performance.now(), '')
    fetched = []
    await run(EXPLAINER_FIRST_MS + 1000)
    expect(fetched).toHaveLength(1)
    down = false
    await run(EXPLAINER_RETRY_MS + 1000)
    expect(fetched).toHaveLength(2)
    expect(phase()).not.toBeNull()
  })

  it('tries the next file when one will not load, and skips one with none this browser plays', async () => {
    setExplainerLineupForTest([one('1-a', { files: [
      { url: 'https://down.example/x.webm', type: 'video/webm', sha256: HASH },
      { url: `https://b.example/${HASH}.webm`, type: 'video/webm' },
    ] })])
    fetchBody = (url) => (url.startsWith('https://down') ? new Response('', { status: 404 }) : new Response(bytes as BodyInit))
    startExplainers(performance.now(), '')
    await run(EXPLAINER_FIRST_MS + 1000)
    expect(fetched).toEqual(['https://down.example/x.webm', `https://b.example/${HASH}.webm`])
    expect(phase()).toBe('in')
    stopExplainers()
    FakeVideo.canPlay = () => ''
    fetched = []
    startExplainers(performance.now(), '')
    await run(EXPLAINER_FIRST_MS + 1000)
    expect(fetched).toEqual([])
    expect(phase()).toBeNull()
    expect(explainerBusy()).toBe(false)
  })

  it('one that never gets ready is given up after EXPLAINER_LOAD_MS, the music never ducked for it', async () => {
    FakeVideo.ready = false
    startExplainers(performance.now(), '')
    await run(EXPLAINER_FIRST_MS + EXPLAINER_LOAD_MS - 1000)
    expect(explainerBusy()).toBe(true)
    await run(2000)
    expect(explainerBusy()).toBe(false)
    expect(phase()).toBeNull()
    expect(music.duckedOn + music.duckedOff).toBe(0)
  })

  it('a stall gives the picture straight back', async () => {
    startExplainers(performance.now(), '')
    await run(EXPLAINER_FIRST_MS + EXPLAINER_IN_MS + 3000)
    expect(phase()).toBe('play')
    await run(EXPLAINER_STALL_MS - 500, playing, false)
    expect(phase()).toBe('play')
    await run(700, playing, false)
    expect(phase()).toBe('out')
    expect(useTvExplainer.getState().showing?.outMs).toBe(EXPLAINER_FAIL_OUT_MS)
    expect(music.duckedOff).toBe(1)
    await run(EXPLAINER_FAIL_OUT_MS + 100)
    expect(phase()).toBeNull()
  })

  it('an error gives the picture straight back', async () => {
    startExplainers(performance.now(), '')
    await run(EXPLAINER_FIRST_MS + 2000)
    video().error = { code: 3 }
    await run(100)
    expect(phase()).toBe('out')
    expect(useTvExplainer.getState().showing?.outMs).toBe(EXPLAINER_FAIL_OUT_MS)
  })

  it('one that runs past its guard is ended, the video stopped', async () => {
    startExplainers(performance.now(), '')
    await run(EXPLAINER_FIRST_MS + 1000)
    expect(phase()).not.toBeNull()
    const v = video()
    await run(guardMs(one('1-a')) - 2000)
    expect(phase()).toBe('play')
    await run(2000)
    expect(phase()).toBe('out')
    expect(v.paused).toBe(true)
  })

  it('sound the browser holds back: plays muted, and with sound on the next tap', async () => {
    const win = new EventTarget()
    vi.stubGlobal('window', win)
    FakeVideo.refuse = 'sound'
    startExplainers(performance.now(), '')
    await run(EXPLAINER_FIRST_MS + 1000)
    expect(phase()).toBe('in')
    expect(video().muted).toBe(true)
    expect(video().paused).toBe(false)
    FakeVideo.refuse = 'none'
    win.dispatchEvent(new Event('click'))
    await run(100)
    expect(video().muted).toBe(false)
    expect(video().paused).toBe(false)
  })

  it('no play at all gives the picture straight back', async () => {
    FakeVideo.refuse = 'all'
    const seen: Array<[string, number]> = []
    const off = useTvExplainer.subscribe((st) => { if (st.showing) seen.push([st.showing.phase, st.showing.outMs]) })
    startExplainers(performance.now(), '')
    await run(EXPLAINER_FIRST_MS + 1000)
    off()
    expect(seen.map(([p]) => p)).toEqual(['in', 'out'])
    expect(seen[1][1]).toBe(EXPLAINER_FAIL_OUT_MS)
    expect(phase()).toBeNull()
    expect(music.duckedOff).toBe(1)
  })

  it("follows the viewer's mute on the site, and is always full on the stream", async () => {
    music.muted = true
    startExplainers(performance.now(), '')
    await run(EXPLAINER_FIRST_MS + 1000)
    expect(video().volume).toBe(0)
    stopExplainers()
    setBroadcastForTest(true)
    startExplainers(performance.now(), '')
    await run(EXPLAINER_FIRST_MS + 1000)
    expect(video().volume).toBe(1)
    expect(video().muted).toBe(false)
  })

  it("follows the viewer's mute and volume while it plays, and lets go after (review of #471)", async () => {
    startExplainers(performance.now(), '')
    await run(EXPLAINER_FIRST_MS + 1000)
    expect(video().volume).toBeCloseTo(0.8)
    setLevel(0.8, true)
    expect(video().volume).toBe(0)
    setLevel(0.3, false)
    expect(video().volume).toBeCloseTo(0.3)
    video().ended = true
    await run(EXPLAINER_OUT_MS + 200)
    expect(music.listeners).toHaveLength(0)
  })

  it('a viewer\'s pause (the lock screen) ends it; the music is unducked, not paused', async () => {
    startExplainers(performance.now(), '')
    await run(EXPLAINER_FIRST_MS + 2000)
    expect(phase()).toBe('play')
    video().pause()
    await run(100)
    expect(phase()).toBe('out')
    expect(music.duckedOff).toBe(1)
  })

  it('its own pauses, at its end or a guard, duck the music back as usual', async () => {
    startExplainers(performance.now(), '')
    await run(EXPLAINER_FIRST_MS + 1000)
    await run(guardMs(one('1-a')))
    expect(music.duckedOff).toBe(1)
  })

  it('on the stream a pause is not a viewer\'s: the stall guard has it', async () => {
    setBroadcastForTest(true)
    startExplainers(performance.now(), '')
    await run(EXPLAINER_FIRST_MS + 2000)
    video().pause()
    await run(1000, playing, false)
    expect(phase()).toBe('play')
    await run(EXPLAINER_STALL_MS, playing, false)
    expect(phase()).not.toBe('play')
    expect(music.duckedOff).toBe(1)
  })

  it('a pause told late, after it plays again, is not the viewer\'s (review of #471, round 2)', async () => {
    startExplainers(performance.now(), '')
    await run(EXPLAINER_FIRST_MS + 1000)
    expect(phase()).toBe('in')
    // The warm-up's pause, arriving while the video plays on.
    video().dispatchEvent(new Event('pause'))
    await run(200)
    expect(phase()).toBe('in')
    expect(music.duckedOff).toBe(0)
  })

  it('on the site, one too slow to load is not fetched again this visit; the stream tries again', async () => {
    FakeVideo.ready = false
    startExplainers(performance.now(), '')
    await run(EXPLAINER_FIRST_MS + EXPLAINER_LOAD_MS + 1000)
    expect(fetched).toHaveLength(1)
    await run(EXPLAINER_RETRY_MS + 1000)
    expect(fetched).toHaveLength(1)
    stopExplainers()
    setExplainerLineupForTest([one('1-a')])
    setBroadcastForTest(true)
    fetched = []
    startExplainers(performance.now(), '')
    await run(EXPLAINER_FIRST_MS + EXPLAINER_LOAD_MS + 1000)
    await run(EXPLAINER_RETRY_MS + 1000)
    expect(fetched).toHaveLength(2)
  })

  it('says when the browser holds its sound back', async () => {
    const win = new EventTarget()
    vi.stubGlobal('window', win)
    FakeVideo.refuse = 'sound'
    startExplainers(performance.now(), '')
    await run(EXPLAINER_FIRST_MS + 1000)
    expect(explainerSoundHeld()).toBe(true)
    FakeVideo.refuse = 'none'
    win.dispatchEvent(new Event('pointerup'))
    await run(100)
    expect(explainerSoundHeld()).toBe(false)
  })

  it('a file with no hash is never fetched or played', async () => {
    setExplainerLineupForTest([one('1-a', { files: [{ url: 'https://b.example/video.webm', type: 'video/webm' }], captions: 'https://b.example/c.vtt' })])
    startExplainers(performance.now(), '')
    await run(EXPLAINER_FIRST_MS + 1000)
    expect(fetched).toEqual([])
    expect(phase()).toBeNull()
    expect(explainerBusy()).toBe(false)
  })

  it('captions that arrive late are never painted over a later explainer', async () => {
    let lateCaptions: ((r: Response) => void) | null = null
    setExplainerLineupForTest([one('1-a', { captions: 'https://b.example/a.vtt' }), one('2-b')])
    fetchBody = (url) => url.endsWith('a.vtt') ? new Promise<Response>((r) => { lateCaptions = r }) : new Response(bytes as BodyInit)
    startExplainers(performance.now(), '')
    await run(EXPLAINER_FIRST_MS + 1000)
    video().ended = true
    await run(EXPLAINER_OUT_MS + 200)
    expect(phase()).toBeNull()
    // A's captions come after A is over.
    lateCaptions!(new Response('WEBVTT\n\n00:00.000 --> 01:00.000\nFrom A'))
    await run(EXPLAINER_EVERY_MS + 1000)
    expect(useTvExplainer.getState().showing?.id).toBe('2-b')
    video().currentTime = 5
    expect(explainerCaption()).toBeNull()
  })

  it('TV going off ends it at once', async () => {
    startExplainers(performance.now(), '')
    await run(EXPLAINER_FIRST_MS + 1000)
    expect(phase()).not.toBeNull()
    stopExplainers()
    expect(phase()).toBeNull()
    expect(explainerBusy()).toBe(false)
    expect(explainerVideo()).toBeNull()
    expect(explainerDueForTest()).toBe(Infinity)
  })

  it('captions go the moment it starts out, on every way out, and stay gone (arkinox, 2026-10-24: "stuck captions")', async () => {
    // One cue over the whole video, so only the way out can take it away.
    const whole = 'WEBVTT\n\n00:00.000 --> 10:00.000\nAlways'
    const ways: Array<[string, () => void, boolean]> = [
      ['end', () => { video().ended = true }, true],
      ['error', () => { video().error = { code: 3 } }, true],
      ['viewer pause', () => { video().pause() }, true],
      ['stall', () => {}, false],
      ['guard', () => {}, true],
    ]
    for (const [way, act, moving] of ways) {
      stopExplainers()
      setExplainerLineupForTest([one('1-a', { captions: 'https://b.example/c.vtt' })])
      fetchBody = (url) => new Response(url.endsWith('.vtt') ? whole : bytes as BodyInit)
      startExplainers(performance.now(), '')
      await run(EXPLAINER_FIRST_MS + EXPLAINER_IN_MS + 1000)
      expect(phase(), way).toBe('play')
      expect(explainerCaption(), way).toBe('Always')
      act()
      if (way === 'stall') await run(EXPLAINER_STALL_MS + 100, playing, false)
      else if (way === 'guard') { for (let i = 0; i < guardMs(one('1-a')) / 100 && phase() === 'play'; i++) await run(100) }
      else await run(200, playing, moving)
      expect(phase(), way).toBe('out')
      expect(explainerCaption(), way).toBeNull()
      await run(EXPLAINER_OUT_MS + 200)
      expect(phase(), way).toBeNull()
      expect(explainerCaption(), way).toBeNull()
    }
    // TV off mid-caption.
    stopExplainers()
    startExplainers(performance.now(), '')
    await run(EXPLAINER_FIRST_MS + EXPLAINER_IN_MS + 1000)
    expect(explainerCaption()).toBe('Always')
    stopExplainers()
    expect(explainerCaption()).toBeNull()
  })

  it('paints the caption at the moment', async () => {
    setExplainerLineupForTest([one('1-a', { captions: 'https://b.example/c.vtt' })])
    fetchBody = (url) => new Response(url.endsWith('.vtt') ? 'WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n\n00:01.000 --> 00:05.000\nThere' : bytes as BodyInit)
    startExplainers(performance.now(), '')
    await run(EXPLAINER_FIRST_MS + 500)
    expect(phase()).toBe('in')
    video().currentTime = 0.5
    expect(explainerCaption()).toBe('Hello')
    video().currentTime = 2
    expect(explainerCaption()).toBe('There')
  })
})
