/**
 * tvMusic.test.ts: TV's music plays the playlist through, skips a track that
 * will not load (arkinox, 2026-10-18: "a broken link = just skip the track"),
 * waits rather than spins when none will, and plays on the first tap when
 * the browser held the sound back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { besideUrls, musicProgress, nameFromUrl, setMusicVolume, shuffled, startMusic, stopMusic, toggleMusicMute, useTvMusic } from '../useTvMusic'

class FakeAudio extends EventTarget {
  static made: FakeAudio[] = []
  static refuse = false
  crossOrigin = ''
  muted = false
  preload = ''
  volume = 1
  currentTime = 0
  duration = NaN
  private source = ''
  plays = 0
  constructor() { super(); FakeAudio.made.push(this) }
  get src(): string { return this.source }
  set src(v: string) { this.source = v }
  getAttribute(n: string): string | null { return n === 'src' && this.source ? this.source : null }
  removeAttribute(): void { this.source = '' }
  load(): void {}
  pause(): void {}
  play(): Promise<void> {
    this.plays++
    if (FakeAudio.refuse) return Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' }))
    return Promise.resolve()
  }
  fire(type: string): void { this.dispatchEvent(new Event(type)) }
}

const list = [{ url: 'https://h/a/1-one.mp3' }, { url: 'https://h/a/2-two.mp3' }, { url: 'https://h/a/3-three.mp3' }]
const audio = (): FakeAudio => FakeAudio.made[FakeAudio.made.length - 1]
const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve() }

beforeEach(() => {
  FakeAudio.made = []
  FakeAudio.refuse = false
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
    FakeAudio.refuse = false
    const before = audio().plays
    window.dispatchEvent(new Event('pointerdown'))
    expect(audio().plays).toBe(before + 1)
    audio().fire('playing')
    expect(useTvMusic.getState().blocked).toBe(false)
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
    expect(audio().muted).toBe(true)
    expect(store.get('onosendai:tvMuted')).toBe('1')
    // Down while muted stays muted; up unmutes.
    setMusicVolume(0.5)
    expect(useTvMusic.getState().muted).toBe(true)
    setMusicVolume(0.7)
    expect(useTvMusic.getState().muted).toBe(false)
    expect(audio().muted).toBe(false)
    toggleMusicMute()
    toggleMusicMute()
    expect(useTvMusic.getState().muted).toBe(false)
  })

  it('a new track starts at the volume and mute it was left at', () => {
    useTvMusic.setState({ volume: 0.25, muted: true })
    startMusic(list)
    expect(audio().volume).toBe(0.25)
    expect(audio().muted).toBe(true)
  })
})

describe('a track from its link', () => {
  it('names it from its file until its tag is read', () => {
    expect(nameFromUrl('https://media.basspistol.com/x/inflating-saturn/1-commersens-temperatur.mp3')).toBe('Commersens Temperatur')
    expect(nameFromUrl('https://h/Acid%20Alert%20EP/2_Sethy%20Bowoy-Acid%20Bench.mp3')).toBe('Sethy Bowoy Acid Bench')
  })

  it('finds the picture beside it by name', () => {
    expect(besideUrls('https://h/a/2-saturn-day.mp3')).toEqual(['https://h/a/2-saturn-day.jpeg', 'https://h/a/2-saturn-day.jpg'])
  })

  it('shuffles without opening on the last track', () => {
    const order = shuffled(list, list[2].url, () => 0.999)
    expect(order[0].url).not.toBe(list[2].url)
    expect([...order].map((t) => t.url).sort()).toEqual(list.map((t) => t.url).sort())
  })
})
