/**
 * tvMusic.test.ts: TV's music plays the playlist through, skips a track that
 * will not load (arkinox, 2026-10-18: "a broken link = just skip the track"),
 * waits rather than spins when none will, and plays on the first tap when
 * the browser held the sound back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { besideUrls, holdMusicForAd, musicHeldForAd, musicProgress, nameFromUrl, resumeMusic, setMusicVolume, shuffled, startMusic, stopMusic, tapMusic, toggleMusicMute, useTvMusic } from '../useTvMusic'

class FakeAudio extends EventTarget {
  static made: FakeAudio[] = []
  static refuse = false
  /** A play that fails some other way than for want of a tap, leaving the element paused. */
  static fails: string | null = null
  /** Plays wait for data that never comes, and a new source cuts them off, as a real element's do. */
  static hang = false
  private pending: Array<(e: Error) => void> = []
  crossOrigin = ''
  /** iOS: the page cannot set the volume. */
  static fixedVolume = false
  muted = false
  preload = ''
  ended = false
  private level = 1
  get volume(): number { return this.level }
  set volume(v: number) { if (!FakeAudio.fixedVolume) this.level = v }
  currentTime = 0
  duration = NaN
  private source = ''
  plays = 0
  constructor() { super(); FakeAudio.made.push(this) }
  get src(): string { return this.source }
  set src(v: string) {
    this.source = v
    // A new source stops the element, as a real one's load does, without a pause event.
    this.paused = true
    const cut = this.pending
    this.pending = []
    queueMicrotask(() => { for (const reject of cut) reject(Object.assign(new Error('cut off'), { name: 'AbortError' })) })
  }
  getAttribute(n: string): string | null { return n === 'src' && this.source ? this.source : null }
  removeAttribute(): void { this.source = '' }
  load(): void {}
  paused = true
  pauses = 0
  /** Loaded enough to play (HAVE_CURRENT_DATA and up) unless a test says not. */
  readyState = 4
  /** A pause of a playing element is told, a moment later, as a real one's is. */
  pause(): void {
    this.pauses++
    if (this.paused) return
    this.paused = true
    // A play still waiting is cut off, as a real one's is.
    const cut = this.pending
    this.pending = []
    queueMicrotask(() => { for (const reject of cut) reject(Object.assign(new Error('paused'), { name: 'AbortError' })) })
    queueMicrotask(() => this.fire('pause'))
  }
  play(): Promise<void> {
    this.plays++
    // A play the browser refuses leaves the element paused, as a real one does.
    if (FakeAudio.refuse) return Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' }))
    if (FakeAudio.fails) return Promise.reject(Object.assign(new Error('no'), { name: FakeAudio.fails }))
    const was = this.paused
    this.paused = false
    if (FakeAudio.hang) return new Promise((_, reject) => { this.pending.push(reject) })
    // Only a start from paused says 'playing': a play while playing says nothing.
    if (was) queueMicrotask(() => { if (!this.paused) this.fire('playing') })
    return Promise.resolve()
  }
  fire(type: string): void { this.dispatchEvent(new Event(type)) }
}

const list = [{ url: 'https://h/a/1-one.mp3' }, { url: 'https://h/a/2-two.mp3' }, { url: 'https://h/a/3-three.mp3' }]
const audio = (): FakeAudio => FakeAudio.made[FakeAudio.made.length - 1]
/** Whether nothing can be heard: volume 0, or muted where the volume cannot be set. */
const silent = (): boolean => audio().muted || audio().volume === 0
const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve() }

beforeEach(() => {
  FakeAudio.made = []
  FakeAudio.refuse = false
  FakeAudio.fails = null
  FakeAudio.hang = false
  FakeAudio.fixedVolume = false
  vi.useFakeTimers()
  vi.stubGlobal('Audio', FakeAudio)
  vi.stubGlobal('fetch', async () => new Response('', { status: 404 }))
  vi.stubGlobal('window', new EventTarget())
})

afterEach(() => {
  stopMusic()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('TV music back from the background (arkinox, 2026-10-20)', () => {
  // Where TV is seen or not: the store's own visibility handler calls resumeMusic on the way back.
  const page = { visibilityState: 'visible' }
  beforeEach(() => { page.visibilityState = 'visible'; vi.stubGlobal('document', page) })
  // A tap here mutes as well: the tests after these start unmuted.
  afterEach(() => { useTvMusic.setState({ muted: false }) })
  const away = (): void => { page.visibilityState = 'hidden' }
  const back = (): void => { page.visibilityState = 'visible'; resumeMusic() }

  it('a play after the break that failed while away is asked for again on the way back', async () => {
    startMusic(list)
    await flush()
    away()
    holdMusicForAd(true)
    vi.advanceTimersByTime(700)
    FakeAudio.fails = 'AbortError'
    holdMusicForAd(false)
    await flush()
    expect(audio().paused).toBe(true)
    FakeAudio.fails = null
    const plays = audio().plays
    back()
    expect(audio().plays).toBe(plays + 1)
    expect(audio().paused).toBe(false)
  })

  it('a tap on NOW PLAYING plays a track that should be playing and is not', async () => {
    startMusic(list)
    await flush()
    FakeAudio.fails = 'AbortError'
    holdMusicForAd(true)
    vi.advanceTimersByTime(700)
    holdMusicForAd(false)
    await flush()
    FakeAudio.fails = null
    const plays = audio().plays
    tapMusic()
    expect(audio().plays).toBe(plays + 1)
    // Heard: the tap that starts the sound does not mute it.
    expect(useTvMusic.getState().muted).toBe(false)
    await flush()
    // Sounding now: the next tap is only a mute.
    tapMusic()
    expect(audio().plays).toBe(plays + 1)
    expect(useTvMusic.getState().muted).toBe(true)
  })

  it('a tap that starts a stopped track while muted unmutes it, so it is heard', async () => {
    startMusic(list)
    await flush()
    toggleMusicMute()
    vi.advanceTimersByTime(5000)
    FakeAudio.fails = 'AbortError'
    holdMusicForAd(true)
    vi.advanceTimersByTime(700)
    holdMusicForAd(false)
    await flush()
    FakeAudio.fails = null
    expect(audio().paused).toBe(true)
    tapMusic()
    expect(audio().paused).toBe(false)
    expect(useTvMusic.getState().muted).toBe(false)
    // Once the break's fade in is over.
    vi.advanceTimersByTime(1100)
    expect(silent()).toBe(false)
  })

  it('a break cut short while the track still sounds leaves it sounding: coming back does not skip it', async () => {
    startMusic(list)
    await flush()
    const first = audio().src
    // Over before the fade out paused it: the track plays on, and its play says no 'playing'.
    holdMusicForAd(true)
    vi.advanceTimersByTime(300)
    holdMusicForAd(false)
    await flush()
    expect(audio().paused).toBe(false)
    away()
    back()
    vi.advanceTimersByTime(25_000)
    expect(audio().src).toBe(first)
    // And a tap on it is a mute, not a play.
    const plays = audio().plays
    tapMusic()
    expect(audio().plays).toBe(plays)
    expect(useTvMusic.getState().muted).toBe(true)
  })

  it('a play the browser holds and never answers is asked for again by a tap', async () => {
    startMusic(list)
    await flush()
    holdMusicForAd(true)
    vi.advanceTimersByTime(700)
    FakeAudio.hang = true
    holdMusicForAd(false)
    await flush()
    expect(audio().paused).toBe(false)
    const plays = audio().plays
    tapMusic()
    expect(audio().plays).toBe(plays + 1)
  })

  it('a pause while away stands too: the lock screen\'s controls are the viewer\'s', async () => {
    startMusic(list)
    await flush()
    away()
    audio().pause()
    await flush()
    const plays = audio().plays
    back()
    holdMusicForAd(true)
    vi.advanceTimersByTime(700)
    holdMusicForAd(false)
    expect(audio().plays).toBe(plays)
  })

  it('a track whose play failed before the break comes back after it', async () => {
    startMusic(list)
    await flush()
    // One break's way back fails, and nothing has taken it up again yet.
    holdMusicForAd(true)
    vi.advanceTimersByTime(700)
    FakeAudio.fails = 'AbortError'
    holdMusicForAd(false)
    await flush()
    FakeAudio.fails = null
    expect(audio().paused).toBe(true)
    holdMusicForAd(true)
    vi.advanceTimersByTime(700)
    const plays = audio().plays
    holdMusicForAd(false)
    expect(audio().plays).toBe(plays + 1)
  })

  it('the break\'s own pause, told after the break is over, is not taken for the viewer\'s', async () => {
    startMusic(list)
    await flush()
    holdMusicForAd(true)
    // The fade's end and the break's end in one go, as a background tab's late timers run.
    vi.advanceTimersByTime(700)
    FakeAudio.fails = 'AbortError'
    holdMusicForAd(false)
    await flush()
    FakeAudio.fails = null
    const plays = audio().plays
    // Still wanted: coming back plays it.
    away()
    back()
    expect(audio().plays).toBe(plays + 1)
  })

  it('a tap in a break is a mute, never a play: nothing plays under the ad', async () => {
    startMusic(list)
    await flush()
    holdMusicForAd(true)
    vi.advanceTimersByTime(700)
    expect(audio().paused).toBe(true)
    const plays = audio().plays
    tapMusic()
    expect(audio().plays).toBe(plays)
    expect(audio().paused).toBe(true)
    expect(useTvMusic.getState().muted).toBe(true)
  })

  it('a pause the page did not make stands against coming back and a break, and a tap on NOW PLAYING plays it again', async () => {
    startMusic(list)
    await flush()
    audio().pause()
    await flush()
    const plays = audio().plays
    away()
    back()
    holdMusicForAd(true)
    vi.advanceTimersByTime(700)
    holdMusicForAd(false)
    expect(audio().plays).toBe(plays)
    tapMusic()
    expect(audio().plays).toBe(plays + 1)
    expect(audio().paused).toBe(false)
  })

  it('a break over a paused track does not mark a pause, so the viewer\'s next one still counts', async () => {
    startMusic(list)
    await flush()
    audio().pause()
    await flush()
    holdMusicForAd(true)
    vi.advanceTimersByTime(700)
    holdMusicForAd(false)
    tapMusic()
    await flush()
    audio().pause()
    await flush()
    const plays = audio().plays
    away()
    back()
    expect(audio().plays).toBe(plays)
  })

  it('a break\'s pause still to be told when TV goes off does not carry into the next start', async () => {
    startMusic(list)
    await flush()
    holdMusicForAd(true)
    vi.advanceTimersByTime(700)
    stopMusic()
    startMusic(list)
    await flush()
    audio().pause()
    await flush()
    const plays = audio().plays
    away()
    back()
    expect(audio().plays).toBe(plays)
  })

  it('does not skip tracks as broken while away, and gives the track its 20 s again from the way back', async () => {
    FakeAudio.hang = true
    startMusic(list)
    const first = audio().src
    away()
    // Every stall's length, so a skip is seen before the list can come round to the same track again.
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(21_000)
      expect(audio().src).toBe(first)
    }
    back()
    vi.advanceTimersByTime(19_000)
    expect(audio().src).toBe(first)
    vi.advanceTimersByTime(2_000)
    expect(audio().src).not.toBe(first)
  })

  it('the list waiting after every track failed tries again at once on the way back', () => {
    startMusic(list)
    for (let i = 0; i < list.length; i++) audio().fire('error')
    expect(audio().getAttribute('src')).toBe(null)
    expect(useTvMusic.getState().track).toBe(null)
    away()
    back()
    expect(audio().getAttribute('src')).not.toBe(null)
    expect(useTvMusic.getState().track).not.toBe(null)
    // A fresh go at the list: one more failure moves on to the next track, not back to waiting.
    audio().fire('error')
    expect(audio().getAttribute('src')).not.toBe(null)
  })
})

describe('TV music in a commercial break', () => {
  it('fades out over the cut into it and pauses, then comes back where it was, faded in', () => {
    startMusic(list)
    setMusicVolume(0.8)
    const a = audio()
    const src = a.src
    a.currentTime = 42
    holdMusicForAd(true)
    expect(musicHeldForAd()).toBe(true)
    vi.advanceTimersByTime(300)
    expect(a.volume).toBeGreaterThan(0)
    expect(a.volume).toBeLessThan(0.8)
    expect(a.paused).toBe(false)
    vi.advanceTimersByTime(400)
    expect(a.volume).toBe(0)
    expect(a.paused).toBe(true)
    const plays = a.plays
    holdMusicForAd(false)
    expect(a.plays).toBe(plays + 1)
    expect(a.src).toBe(src)
    expect(a.currentTime).toBe(42)
    expect(a.volume).toBeLessThan(0.1)
    vi.advanceTimersByTime(1100)
    expect(a.volume).toBeCloseTo(0.8, 5)
  })

  it('a track that ends in the break waits for it to end', () => {
    startMusic(list)
    holdMusicForAd(true)
    vi.advanceTimersByTime(700)
    const first = audio().src
    const plays = audio().plays
    audio().fire('ended')
    expect(audio().src).not.toBe(first)
    expect(audio().plays).toBe(plays)
    holdMusicForAd(false)
    expect(audio().plays).toBe(plays + 1)
  })

  it('on iOS, where the volume is the phone\'s, pauses at once and plays after', () => {
    FakeAudio.fixedVolume = true
    startMusic(list)
    holdMusicForAd(true)
    expect(audio().paused).toBe(true)
    const plays = audio().plays
    holdMusicForAd(false)
    expect(audio().plays).toBe(plays + 1)
  })

  it('leaves the music muted after it if it was muted before', () => {
    startMusic(list)
    toggleMusicMute()
    holdMusicForAd(true)
    vi.advanceTimersByTime(700)
    holdMusicForAd(false)
    vi.advanceTimersByTime(1100)
    expect(silent()).toBe(true)
  })

  it('its own pause is not taken back as a browser\'s pause on a mute', async () => {
    startMusic(list)
    toggleMusicMute()
    holdMusicForAd(true)
    vi.advanceTimersByTime(700)
    const plays = audio().plays
    audio().fire('pause')
    await flush()
    expect(audio().plays).toBe(plays)
  })

  it('is let go when the set goes off mid-fade: the next start plays at its level, and stays there', () => {
    startMusic(list)
    setMusicVolume(0.8)
    holdMusicForAd(true)
    vi.advanceTimersByTime(300)
    stopMusic()
    expect(musicHeldForAd()).toBe(false)
    startMusic(list)
    // The old fade must not go on turning the new track down.
    vi.advanceTimersByTime(1000)
    expect(audio().plays).toBeGreaterThan(0)
    expect(audio().volume).toBeCloseTo(0.8, 5)
    expect(audio().paused).toBe(false)
  })

  it('a tap in the break does not start a held-back track under the ad; one after it does', async () => {
    for (const ios of [false, true]) {
      stopMusic()
      FakeAudio.fixedVolume = ios
      FakeAudio.refuse = true
      startMusic(list)
      await flush()
      expect(useTvMusic.getState().blocked).toBe(true)
      holdMusicForAd(true)
      FakeAudio.refuse = false
      const plays = audio().plays
      window.dispatchEvent(new Event('click'))
      await flush()
      expect(audio().plays).toBe(plays)
      expect(audio().paused).toBe(true)
      // It was not playing when the break began: the end of the break does not start it either.
      holdMusicForAd(false)
      expect(audio().plays).toBe(plays)
      window.dispatchEvent(new Event('click'))
      await flush()
      expect(audio().plays).toBe(plays + 1)
    }
  })

  it('a break over the wait for a retry leaves the next track at the viewer\'s level', () => {
    startMusic(list)
    setMusicVolume(0.8)
    // Every track fails: the list waits a minute.
    for (let i = 0; i < list.length; i++) audio().fire('error')
    expect(audio().getAttribute('src')).toBeNull()
    holdMusicForAd(true)
    vi.advanceTimersByTime(700)
    holdMusicForAd(false)
    vi.advanceTimersByTime(60_000)
    expect(audio().getAttribute('src')).not.toBeNull()
    expect(audio().volume).toBeCloseTo(0.8, 5)
  })

  it('a track that had not loaded when the break began has its stall wait after it', () => {
    startMusic(list)
    const first = audio().src
    audio().readyState = 0
    holdMusicForAd(true)
    vi.advanceTimersByTime(700)
    holdMusicForAd(false)
    vi.advanceTimersByTime(21_000)
    expect(audio().src).not.toBe(first)
  })

  it('a track taken up in the break has its stall wait after it', () => {
    startMusic(list)
    holdMusicForAd(true)
    vi.advanceTimersByTime(700)
    audio().fire('ended')
    const taken = audio().src
    vi.advanceTimersByTime(30_000)
    expect(audio().src).toBe(taken)
    holdMusicForAd(false)
    vi.advanceTimersByTime(21_000)
    expect(audio().src).not.toBe(taken)
  })

  it('a track the viewer paused stays paused after the break', async () => {
    startMusic(list)
    await flush()
    audio().pause()
    await flush()
    const plays = audio().plays
    holdMusicForAd(true)
    vi.advanceTimersByTime(700)
    holdMusicForAd(false)
    vi.advanceTimersByTime(1100)
    expect(audio().plays).toBe(plays)
  })

  it('a break cut short before the track paused fades back from where it got to', () => {
    startMusic(list)
    setMusicVolume(0.8)
    holdMusicForAd(true)
    vi.advanceTimersByTime(300)
    const mid = audio().volume
    expect(mid).toBeGreaterThan(0)
    holdMusicForAd(false)
    expect(audio().volume).toBeCloseTo(mid, 5)
    vi.advanceTimersByTime(1100)
    expect(audio().volume).toBeCloseTo(0.8, 5)
  })
})

describe('TV music', () => {
  it('plays the list through, every track once, then again', () => {
    startMusic(list)
    const heard = [audio().src]
    for (let i = 0; i < 2; i++) { audio().fire('ended'); heard.push(audio().src) }
    expect([...heard].sort()).toEqual(list.map((t) => t.url).sort())
    audio().fire('ended')
    // A new shuffle, not opening on the track that just played.
    expect(audio().src).not.toBe(heard[2])
    expect(useTvMusic.getState().track?.url).toBe(audio().src)
  })

  it('skips a track that will not load', () => {
    startMusic(list)
    const first = audio().src
    audio().fire('error')
    expect(audio().src).not.toBe(first)
    expect(useTvMusic.getState().track?.url).toBe(audio().src)
  })

  it('waits when no track will load, and tries the list again', () => {
    startMusic(list)
    for (let i = 0; i < 3; i++) audio().fire('error')
    expect(useTvMusic.getState().track).toBeNull()
    vi.advanceTimersByTime(59_000)
    expect(useTvMusic.getState().track).toBeNull()
    vi.advanceTimersByTime(2_000)
    expect(useTvMusic.getState().track).not.toBeNull()
    expect(audio().src).not.toBe('')
  })

  it('says TAP FOR SOUND when the browser holds it back, and plays on the first tap', async () => {
    FakeAudio.refuse = true
    startMusic(list)
    await flush()
    expect(useTvMusic.getState().blocked).toBe(true)
    const before = audio().plays
    // A finger's touch down is not a gesture the browser lets sound start in.
    window.dispatchEvent(new Event('pointerdown'))
    expect(audio().plays).toBe(before)
    // The end of a tap is; a try the browser still refuses waits for the next.
    window.dispatchEvent(new Event('pointerup'))
    expect(audio().plays).toBe(before + 1)
    await flush()
    FakeAudio.refuse = false
    window.dispatchEvent(new Event('touchend'))
    expect(audio().plays).toBe(before + 2)
    audio().fire('playing')
    expect(useTvMusic.getState().blocked).toBe(false)
    // Once playing, a tap is just a tap.
    window.dispatchEvent(new Event('click'))
    expect(audio().plays).toBe(before + 2)
  })

  it('never skips a track for sending nothing while the sound is held back', async () => {
    FakeAudio.refuse = true
    startMusic(list)
    await flush()
    const first = audio().src
    vi.advanceTimersByTime(5 * 60_000)
    expect(audio().src).toBe(first)
    expect(useTvMusic.getState().track).not.toBeNull()
    // Once a tap lets it play, it has its 20 s to send something.
    FakeAudio.refuse = false
    window.dispatchEvent(new Event('pointerup'))
    vi.advanceTimersByTime(21_000)
    expect(audio().src).not.toBe(first)
  })

  it('after a tap lets it play, silent links one after another are each skipped', async () => {
    FakeAudio.refuse = true
    startMusic(list)
    await flush()
    FakeAudio.refuse = false
    FakeAudio.hang = true
    window.dispatchEvent(new Event('pointerup'))
    const heard = [audio().src]
    for (let i = 0; i < 2; i++) {
      vi.advanceTimersByTime(21_000)
      // The play the skip cut off is refused now, and must not stand the next track's stall down.
      await flush()
      heard.push(audio().src)
    }
    expect(new Set(heard).size).toBe(3)
  })

  it('a tap on a control, or Escape, is not the tap for sound', async () => {
    FakeAudio.refuse = true
    startMusic(list)
    await flush()
    const before = audio().plays
    const button = { closest: (s: string) => (s.includes('button') ? {} : null) }
    const onButton = new Event('click')
    Object.defineProperty(onButton, 'target', { value: button })
    window.dispatchEvent(onButton)
    expect(audio().plays).toBe(before)
    class Key extends Event { constructor(public key: string) { super('keydown') } }
    window.dispatchEvent(new Key('Escape'))
    expect(audio().plays).toBe(before)
    window.dispatchEvent(new Key('m'))
    expect(audio().plays).toBe(before + 1)
  })

  it('skips a link that answers and then sends nothing', () => {
    startMusic(list)
    const first = audio().src
    vi.advanceTimersByTime(19_000)
    expect(audio().src).toBe(first)
    vi.advanceTimersByTime(2_000)
    expect(audio().src).not.toBe(first)
    // A track that sent something is not skipped for being long.
    const second = audio().src
    audio().fire('canplay')
    vi.advanceTimersByTime(60_000)
    expect(audio().src).toBe(second)
  })

  it('stops reading a track\'s tag when the track changes', () => {
    const signals: AbortSignal[] = []
    vi.stubGlobal('fetch', (_u: string, init?: { signal?: AbortSignal }) => { if (init?.signal) signals.push(init.signal); return new Promise(() => {}) })
    startMusic(list)
    audio().fire('ended')
    expect(signals).toHaveLength(2)
    expect(signals[0].aborted).toBe(true)
    expect(signals[1].aborted).toBe(false)
    stopMusic()
    expect(signals[1].aborted).toBe(true)
  })

  it('stops, and forgets the track', () => {
    startMusic(list)
    const a = audio()
    stopMusic()
    expect(useTvMusic.getState().track).toBeNull()
    expect(a.src).toBe('')
    // An error from the stopped element plays nothing.
    a.fire('error')
    expect(FakeAudio.made).toHaveLength(1)
    expect(useTvMusic.getState().track).toBeNull()
  })

  it('knows how far in it is', () => {
    startMusic(list)
    expect(musicProgress()).toBe(0)
    audio().duration = 200
    audio().currentTime = 50
    expect(musicProgress()).toBe(0.25)
  })
})

describe('the volume and mute', () => {
  const store = new Map<string, string>()
  beforeEach(() => {
    store.clear()
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) } })
    useTvMusic.setState({ volume: 0.8, muted: false })
  })

  it('sets the playing track, within 0 to 1, and keeps it on this device', () => {
    startMusic(list)
    setMusicVolume(0.3)
    expect(audio().volume).toBe(0.3)
    setMusicVolume(4)
    expect(useTvMusic.getState().volume).toBe(1)
    setMusicVolume(-1)
    expect(useTvMusic.getState().volume).toBe(0)
    expect(store.get('onosendai:tvVolume')).toBe('0.000')
  })

  it('mutes and unmutes with a tap, and turning it up unmutes', () => {
    startMusic(list)
    toggleMusicMute()
    expect(silent()).toBe(true)
    expect(store.get('onosendai:tvMuted')).toBe('1')
    // Down while muted stays muted; up unmutes.
    setMusicVolume(0.5)
    expect(useTvMusic.getState().muted).toBe(true)
    setMusicVolume(0.7)
    expect(useTvMusic.getState().muted).toBe(false)
    expect(silent()).toBe(false)
    expect(audio().volume).toBe(0.7)
    toggleMusicMute()
    toggleMusicMute()
    expect(useTvMusic.getState().muted).toBe(false)
  })

  it('all the way down is muted, and unmuting it comes back to be heard', () => {
    startMusic(list)
    setMusicVolume(0)
    expect(useTvMusic.getState().muted).toBe(true)
    expect(silent()).toBe(true)
    toggleMusicMute()
    expect(useTvMusic.getState()).toMatchObject({ muted: false, volume: 0.5 })
    expect(audio().volume).toBe(0.5)
    expect(store.get('onosendai:tvVolume')).toBe('0.500')
  })

  it('a new track starts at the volume and mute it was left at', () => {
    useTvMusic.setState({ volume: 0.25, muted: true })
    startMusic(list)
    expect(silent()).toBe(true)
    toggleMusicMute()
    expect(audio().volume).toBe(0.25)
  })

  it('mutes by volume where it can, so the browser never sees muted media to pause', () => {
    startMusic(list)
    toggleMusicMute()
    expect(audio()).toMatchObject({ muted: false, volume: 0 })
    toggleMusicMute()
    expect(audio()).toMatchObject({ muted: false, volume: 0.8 })
  })

  it('mutes the element where the volume cannot be set (iOS)', () => {
    FakeAudio.fixedVolume = true
    startMusic(list)
    toggleMusicMute()
    expect(audio().muted).toBe(true)
    toggleMusicMute()
    expect(audio().muted).toBe(false)
  })

  it('plays on through a pause the browser makes as it is muted, and leaves any later pause alone', async () => {
    startMusic(list)
    await flush()
    const before = audio().plays
    toggleMusicMute()
    audio().fire('pause')
    await flush()
    expect(audio().plays).toBe(before + 1)
    // The phone's own controls, a while later: that pause stands.
    vi.advanceTimersByTime(5000)
    audio().fire('pause')
    await flush()
    expect(audio().plays).toBe(before + 1)
  })

  it('a stop just after a mute stays stopped', async () => {
    startMusic(list)
    await flush()
    const a = audio()
    const before = a.plays
    toggleMusicMute()
    stopMusic()
    a.fire('pause')
    await flush()
    expect(a.plays).toBe(before)
  })
})

describe('a track from its link', () => {
  it('names it from its file until its tag is read', () => {
    expect(nameFromUrl('https://media.basspistol.com/x/inflating-saturn/1-commersens-temperatur.mp3')).toBe('Commersens Temperatur')
    // Named artist then title: the title.
    expect(nameFromUrl('https://h/Acid%20Alert%20EP/2_Sethy%20Bowoy-Acid%20Bench.mp3')).toBe('Acid Bench')
  })

  it('finds the picture beside it by name', () => {
    expect(besideUrls('https://h/a/2-saturn-day.mp3')).toEqual(['https://h/a/2-saturn-day.jpeg', 'https://h/a/2-saturn-day.jpg', 'https://h/a/2-saturn-day.png'])
  })

  it('shuffles without opening on the last track', () => {
    const order = shuffled(list, list[2].url, () => 0.999)
    expect(order[0].url).not.toBe(list[2].url)
    expect([...order].map((t) => t.url).sort()).toEqual(list.map((t) => t.url).sort())
  })
})
