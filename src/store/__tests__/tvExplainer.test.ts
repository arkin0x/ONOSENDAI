/**
 * tvExplainer.test.ts: an explainer comes due, loads, waits for the song to
 * end, shrinks the live picture in, plays, and gives the picture back; and
 * one that will not load, fails its hash, stalls, errors or runs long never
 * leaves the tube black (store/useTvExplainer).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const music = vi.hoisted(() => ({ held: false, atEnd: 0, now: 0, released: 0, volume: 0.8, muted: false }))
vi.mock('../useTvMusic', () => ({
  holdMusicAtSongEnd: () => { music.atEnd++ },
  holdMusicNow: () => { music.now++; music.held = true },
  releaseMusic: () => { music.released++; music.held = false },
  musicHeldForAd: () => music.held,
  useTvMusic: { getState: () => ({ volume: music.volume, muted: music.muted }) },
}))

import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '../../lib/events'
import {
  EXPLAINER_AD_GAP_MS, EXPLAINER_EVERY_MS, EXPLAINER_FAIL_OUT_MS, EXPLAINER_FIRST_MS, EXPLAINER_FORCED_MS, EXPLAINER_IN_MS, EXPLAINER_LOAD_MS,
  EXPLAINER_MUSIC_WAIT_MS, EXPLAINER_OUT_MS, EXPLAINER_RETRY_MS, EXPLAINER_STALL_MS, guardMs, type Explainer,
} from '../../lib/tv/explainer'
import {
  explainerBusy, explainerDueForTest, explainerEndedAt, explainerTick, explainerVideo, setExplainerLineupForTest, startExplainers, stopExplainers,
  useTvExplainer, explainerCaption,
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
  pause(): void { this.paused = true }
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
  Object.assign(music, { held: false, atEnd: 0, now: 0, released: 0, volume: 0.8, muted: false })
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
    expect(music.atEnd + music.now).toBe(0)
  })

  it('a forced id with the lineup empty is nothing', () => {
    setExplainerLineupForTest([])
    startExplainers(performance.now(), '?explainer=1-a')
    expect(explainerDueForTest()).toBe(Infinity)
  })

  it('comes due, loads, waits for the song to end, then shrinks in, plays, and gives the picture back', async () => {
    startExplainers(performance.now(), '')
    await run(EXPLAINER_FIRST_MS - 500)
    expect(fetched).toEqual([])
    await run(600)
    expect(fetched).toHaveLength(1)
    expect(explainerBusy()).toBe(true)
    // Ready: the music is asked to step out at the song's end, and nothing shows until it has.
    await run(300)
    expect(music.atEnd).toBe(1)
    await run(60_000)
    expect(phase()).toBeNull()
    expect(music.now).toBe(0)
    // The song ends.
    music.held = true
    await run(100)
    expect(phase()).toBe('in')
    expect(video().plays).toBe(1)
    expect(video().muted).toBe(false)
    expect(video().volume).toBeCloseTo(0.8)
    expect(explainerVideo()).toBe(video())
    await run(EXPLAINER_IN_MS)
    expect(phase()).toBe('play')
    await run(20_000)
    expect(phase()).toBe('play')
    expect(music.released).toBe(0)
    // It ends: the picture grows back as the next song comes in.
    video().ended = true
    await run(100)
    expect(phase()).toBe('out')
    expect(useTvExplainer.getState().showing?.outMs).toBe(EXPLAINER_OUT_MS)
    expect(music.released).toBe(1)
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
    music.held = true
    for (let i = 0; i < 3; i++) {
      await run((i === 0 ? EXPLAINER_FIRST_MS : EXPLAINER_EVERY_MS) + 1000)
      video().ended = true
      await run(EXPLAINER_OUT_MS + 200)
      music.held = true
    }
    off()
    expect(ids).toEqual(['1-a', '2-b', '1-a'])
  })

  it('a song that runs on past EXPLAINER_MUSIC_WAIT_MS fades out instead', async () => {
    startExplainers(performance.now(), '')
    await run(EXPLAINER_FIRST_MS + 500)
    expect(music.atEnd).toBe(1)
    await run(EXPLAINER_MUSIC_WAIT_MS - 1000)
    expect(music.now).toBe(0)
    expect(phase()).toBeNull()
    await run(1200)
    expect(music.now).toBe(1)
    expect(phase()).toBe('in')
  })

  it('/tv?explainer=<id> plays that one first, at once', async () => {
    startExplainers(performance.now(), '?explainer=2-b')
    music.held = true
    await run(EXPLAINER_FORCED_MS + 500)
    expect(useTvExplainer.getState().showing?.id).toBe('2-b')
  })

  it('one asked for by name plays before the tape does (a look at it), but never over the spot', async () => {
    startExplainers(performance.now(), '?explainer=1-a')
    music.held = true
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
    music.held = true
    const t0 = performance.now()
    await run(EXPLAINER_FIRST_MS + 2000)
    expect(fetched).toHaveLength(1)
    expect(phase()).toBeNull()
    expect(explainerBusy()).toBe(false)
    expect(music.atEnd + music.now + music.released).toBe(0)
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
    music.held = true
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
    music.held = true
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

  it('one that never gets ready is given up after EXPLAINER_LOAD_MS, the music never held for it', async () => {
    FakeVideo.ready = false
    startExplainers(performance.now(), '')
    music.held = false
    await run(EXPLAINER_FIRST_MS + EXPLAINER_LOAD_MS - 1000)
    expect(explainerBusy()).toBe(true)
    await run(2000)
    expect(explainerBusy()).toBe(false)
    expect(phase()).toBeNull()
    expect(music.atEnd + music.now).toBe(0)
  })

  it('a stall gives the picture straight back', async () => {
    startExplainers(performance.now(), '')
    music.held = true
    await run(EXPLAINER_FIRST_MS + EXPLAINER_IN_MS + 3000)
    expect(phase()).toBe('play')
    await run(EXPLAINER_STALL_MS - 500, playing, false)
    expect(phase()).toBe('play')
    await run(700, playing, false)
    expect(phase()).toBe('out')
    expect(useTvExplainer.getState().showing?.outMs).toBe(EXPLAINER_FAIL_OUT_MS)
    expect(music.released).toBe(1)
    await run(EXPLAINER_FAIL_OUT_MS + 100)
    expect(phase()).toBeNull()
  })

  it('an error gives the picture straight back', async () => {
    startExplainers(performance.now(), '')
    music.held = true
    await run(EXPLAINER_FIRST_MS + 2000)
    video().error = { code: 3 }
    await run(100)
    expect(phase()).toBe('out')
    expect(useTvExplainer.getState().showing?.outMs).toBe(EXPLAINER_FAIL_OUT_MS)
  })

  it('one that runs past its guard is ended, the video stopped', async () => {
    startExplainers(performance.now(), '')
    music.held = true
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
    music.held = true
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
    music.held = true
    await run(EXPLAINER_FIRST_MS + 1000)
    off()
    expect(seen.map(([p]) => p)).toEqual(['in', 'out'])
    expect(seen[1][1]).toBe(EXPLAINER_FAIL_OUT_MS)
    expect(phase()).toBeNull()
    expect(music.released).toBe(1)
  })

  it("follows the viewer's mute on the site, and is always full on the stream", async () => {
    music.muted = true
    startExplainers(performance.now(), '')
    music.held = true
    await run(EXPLAINER_FIRST_MS + 1000)
    expect(video().volume).toBe(0)
    stopExplainers()
    setBroadcastForTest(true)
    startExplainers(performance.now(), '')
    await run(EXPLAINER_FIRST_MS + 1000)
    expect(video().volume).toBe(1)
    expect(video().muted).toBe(false)
  })

  it('TV going off ends it at once', async () => {
    startExplainers(performance.now(), '')
    music.held = true
    await run(EXPLAINER_FIRST_MS + 1000)
    expect(phase()).not.toBeNull()
    stopExplainers()
    expect(phase()).toBeNull()
    expect(explainerBusy()).toBe(false)
    expect(explainerVideo()).toBeNull()
    expect(explainerDueForTest()).toBe(Infinity)
  })

  it('paints the caption at the moment', async () => {
    setExplainerLineupForTest([one('1-a', { captions: 'https://b.example/c.vtt' })])
    fetchBody = (url) => new Response(url.endsWith('.vtt') ? 'WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n\n00:01.000 --> 00:05.000\nThere' : bytes as BodyInit)
    startExplainers(performance.now(), '')
    music.held = true
    await run(EXPLAINER_FIRST_MS + 500)
    expect(phase()).toBe('in')
    video().currentTime = 0.5
    expect(explainerCaption()).toBe('Hello')
    video().currentTime = 2
    expect(explainerCaption()).toBe('There')
  })
})
