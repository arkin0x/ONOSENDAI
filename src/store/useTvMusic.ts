/**
 * useTvMusic.ts: the music under Cyberspace TV, and what NOW PLAYING shows
 * (arkinox, 2026-10-18).
 *
 * The playlist (lib/tv/playlist) is shuffled, played from where each track is
 * hosted, and shuffled again at its end, never opening on the track that
 * just played. A track that will not load is skipped ("a broken link = just
 * skip the track"); if none will, the music waits and tries the list again.
 *
 * TV turned on from a button starts the music in that tap, which a browser
 * allows. TV opened straight from its address has had no tap yet, and the
 * browser holds the sound back: NOW PLAYING says TAP FOR SOUND, and the first
 * tap or key anywhere plays it.
 *
 * Tap NOW PLAYING to mute, drag it up or down for the volume (arkinox,
 * 2026-10-18: "keep them subtle. maybe tap the NOW PLAYING to mute? Drag the
 * player up and down to change volume?"). Both are kept on this device.
 *
 * What NOW PLAYING shows comes from the track itself: the name and artist
 * in its tag, the cover inside it, else the picture of the same name beside
 * it (lib/tv/id3), else the name of its file.
 */

import { create } from 'zustand'
import { PLAYLIST, type Track } from '../lib/tv/playlist'
import { readTags } from '../lib/tv/id3'

export interface NowPlaying {
  url: string
  title: string
  artist: string
  /** The cover, once loaded and safe to paint into the tube (CORS). */
  art: HTMLImageElement | null
}

interface MusicState {
  track: NowPlaying | null
  /** The browser is holding the sound back until a tap. */
  blocked: boolean
  /** How loud, 0 to 1, muted or not. */
  volume: number
  muted: boolean
}

const VOLUME_KEY = 'onosendai:tvVolume'
const MUTED_KEY = 'onosendai:tvMuted'
/** How loud, under the picture, until the volume is changed. */
const VOLUME = 0.8

function loadVolume(): number {
  try {
    const v = Number(localStorage.getItem(VOLUME_KEY))
    return localStorage.getItem(VOLUME_KEY) !== null && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : VOLUME
  } catch {
    return VOLUME
  }
}

function loadMuted(): boolean {
  try { return localStorage.getItem(MUTED_KEY) === '1' } catch { return false }
}

export const useTvMusic = create<MusicState>(() => ({ track: null, blocked: false, volume: loadVolume(), muted: loadMuted() }))

/** Set the volume, 0 to 1; turning it up unmutes. */
export function setMusicVolume(volume: number): void {
  const v = Math.min(1, Math.max(0, volume))
  const s = useTvMusic.getState()
  const muted = s.muted && v <= s.volume
  useTvMusic.setState({ volume: v, muted })
  apply()
  try {
    localStorage.setItem(VOLUME_KEY, v.toFixed(3))
    localStorage.setItem(MUTED_KEY, muted ? '1' : '0')
  } catch { /* kept for this visit only */ }
}

/** Mute, or unmute. */
export function toggleMusicMute(): void {
  const muted = !useTvMusic.getState().muted
  useTvMusic.setState({ muted })
  apply()
  try { localStorage.setItem(MUTED_KEY, muted ? '1' : '0') } catch { /* kept for this visit only */ }
}

function apply(): void {
  if (!audio) return
  const s = useTvMusic.getState()
  audio.volume = s.volume
  audio.muted = s.muted
}
/** How long to wait before trying the list again when no track would load, ms. */
const RETRY_MS = 60_000

let audio: HTMLAudioElement | null = null
let order: Track[] = []
let at = -1
/** Tracks that failed in a row: the whole list failing means wait, not spin. */
let failures = 0
/** Changes on every start, stop and track: what an answer from an older one is ignored by. */
let session = 0
let coverUrl: string | null = null
let retry: ReturnType<typeof setTimeout> | null = null
let unblock: (() => void) | null = null

/** A shuffle of `list`, not opening on `last` when it can help it. */
export function shuffled(list: Track[], last?: string, random: () => number = Math.random): Track[] {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  if (out.length > 1 && out[0].url === last) [out[0], out[1]] = [out[1], out[0]]
  return out
}

/** A track's name from its file, for before its tag is read or when it has none: `1-commersens-temperatur.mp3` is Commersens Temperatur. */
export function nameFromUrl(url: string): string {
  let file = url.split('/').pop() ?? url
  try { file = decodeURIComponent(file) } catch { /* as it is */ }
  return file
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/^\d+[\s._-]+/, '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\p{L}/gu, (c) => c.toUpperCase())
}

/** The pictures that may be beside a track, by its name: `x.mp3` has `x.jpeg`, or `x.jpg`. */
export function besideUrls(url: string): string[] {
  return ['.jpeg', '.jpg'].map((ext) => url.replace(/\.[a-z0-9]+$/i, ext))
}

/** How far into the track, 0 to 1. */
export function musicProgress(): number {
  if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return 0
  return Math.min(1, Math.max(0, audio.currentTime / audio.duration))
}

/** Start the music, from a tap when it can be: TV's start calls it. */
export function startMusic(list: Track[] = PLAYLIST): void {
  if (typeof Audio === 'undefined' || audio || list.length === 0) return
  session++
  const a = new Audio()
  a.crossOrigin = 'anonymous'
  a.preload = 'auto'
  a.volume = useTvMusic.getState().volume
  a.muted = useTvMusic.getState().muted
  a.addEventListener('ended', () => advance(list))
  a.addEventListener('error', () => {
    if (audio !== a || !a.getAttribute('src')) return
    failures++
    if (failures >= list.length) {
      // Nothing on the list will play: try it all again later.
      useTvMusic.setState({ track: null })
      const mine = session
      retry = setTimeout(() => { if (mine === session) { failures = 0; advance(list) } }, RETRY_MS)
      return
    }
    advance(list)
  })
  a.addEventListener('playing', () => { failures = 0; if (useTvMusic.getState().blocked) useTvMusic.setState({ blocked: false }) })
  audio = a
  order = []
  at = -1
  failures = 0
  advance(list)
}

/** Stop the music and forget the track: TV's stop calls it. */
export function stopMusic(): void {
  session++
  if (retry !== null) clearTimeout(retry)
  retry = null
  unblock?.()
  if (audio) {
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  }
  audio = null
  releaseCover()
  useTvMusic.setState({ track: null, blocked: false })
}

function releaseCover(): void {
  if (coverUrl) URL.revokeObjectURL(coverUrl)
  coverUrl = null
}

function advance(list: Track[]): void {
  const a = audio
  if (!a) return
  at++
  if (at >= order.length) {
    order = shuffled(list, order[order.length - 1]?.url)
    at = 0
  }
  const track = order[at]
  const mine = ++session
  releaseCover()
  useTvMusic.setState({ track: { url: track.url, title: track.title ?? nameFromUrl(track.url), artist: track.artist ?? '', art: null } })
  a.src = track.url
  play(a, mine)
  void describe(track, mine)
}

function play(a: HTMLAudioElement, mine: number): void {
  a.play().catch((e: unknown) => {
    if (mine !== session || (e as { name?: string })?.name !== 'NotAllowedError') return
    useTvMusic.setState({ blocked: true })
    if (unblock) return
    // The first tap or key anywhere is the one the browser waits for.
    const go = (): void => {
      unblock?.()
      if (audio) void audio.play().catch(() => {})
    }
    window.addEventListener('pointerdown', go, true)
    window.addEventListener('keydown', go, true)
    unblock = () => {
      window.removeEventListener('pointerdown', go, true)
      window.removeEventListener('keydown', go, true)
      unblock = null
    }
  })
}

/** Fill in NOW PLAYING from the track's tag and its cover, unless the track has changed since. */
async function describe(track: Track, mine: number): Promise<void> {
  const tags = await readTags(track.url).catch(() => ({}) as Awaited<ReturnType<typeof readTags>>)
  if (mine !== session) return
  const now = useTvMusic.getState().track
  if (!now) return
  useTvMusic.setState({ track: { ...now, title: track.title ?? (tags.title || now.title), artist: track.artist ?? (tags.artist || now.artist) } })
  let src = track.art ?? null
  if (!src && tags.picture) {
    coverUrl = URL.createObjectURL(new Blob([tags.picture.data as BlobPart], { type: tags.picture.mime }))
    src = coverUrl
  }
  const sources = [...(src ? [src] : []), ...besideUrls(track.url)]
  for (const s of sources) {
    const img = await loadImage(s)
    if (mine !== session) return
    if (img) {
      const cur = useTvMusic.getState().track
      if (cur) useTvMusic.setState({ track: { ...cur, art: img } })
      return
    }
  }
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  if (typeof Image === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    const img = new Image()
    // Painted into the tube, which is a WebGL texture: a picture from another
    // host must come with CORS or it would taint the canvas.
    if (!src.startsWith('blob:')) img.crossOrigin = 'anonymous'
    img.referrerPolicy = 'no-referrer'
    img.onload = () => resolve(img.naturalWidth > 0 ? img : null)
    img.onerror = () => resolve(null)
    img.src = src
  })
}
