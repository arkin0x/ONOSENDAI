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
  /** The cover, once loaded, small and safe to paint into the tube (CORS). */
  art: CanvasImageSource | null
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
let retry: ReturnType<typeof setTimeout> | null = null
let stall: ReturnType<typeof setTimeout> | null = null
let unblock: (() => void) | null = null
/** The read of the playing track's tag, cut off when the track changes. */
let reading: AbortController | null = null

/** How long a track may take to send anything before it counts as broken, ms. */
const STALL_MS = 20_000
/** How long a track's tag may take to read, ms: NOW PLAYING keeps the file's name meanwhile. */
const TAG_MS = 15_000
/** The cover's size, px: painted at about 56 CSS px, so this is sharp up to a little over 2x. */
const COVER_PX = 128

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

/**
 * A track's name from its file, for before its tag is read or when it has
 * none: `1-commersens-temperatur.mp3` is Commersens Temperatur, and
 * `2_Sethy Bowoy-Acid Bench.mp3`, named artist then title, is Acid Bench.
 */
export function nameFromUrl(url: string): string {
  let file = url.split('/').pop() ?? url
  try { file = decodeURIComponent(file) } catch { /* as it is */ }
  file = file.replace(/\.[a-z0-9]+$/i, '').replace(/^\d+[\s._-]+/, '')
  // Spaces in the name: a dash is the artist's end, not a space.
  if (file.includes(' ') && file.includes('-')) file = file.slice(file.indexOf('-') + 1)
  return file
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\p{L}/gu, (c) => c.toUpperCase())
}

/** The pictures that may be beside a track, by its name: `x.mp3` has `x.jpeg`, `x.jpg` or `x.png`. */
export function besideUrls(url: string): string[] {
  return ['.jpeg', '.jpg', '.png'].map((ext) => url.replace(/\.[a-z0-9]+$/i, ext))
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
  // No crossOrigin: nothing reads the samples, and asking for CORS would
  // skip a track from a host that plays fine but does not send it.
  const a = new Audio()
  a.preload = 'auto'
  a.volume = useTvMusic.getState().volume
  a.muted = useTvMusic.getState().muted
  a.addEventListener('ended', () => { if (audio === a) advance(list) })
  a.addEventListener('error', () => { if (audio === a && a.getAttribute('src')) fail(list) })
  // Something arrived: the link is not broken.
  const arrived = (): void => { if (audio === a) clearStall() }
  a.addEventListener('loadeddata', arrived)
  a.addEventListener('canplay', arrived)
  a.addEventListener('playing', () => {
    if (audio !== a) return
    clearStall()
    failures = 0
    unblock?.()
    if (useTvMusic.getState().blocked) useTvMusic.setState({ blocked: false })
  })
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
  clearStall()
  unblock?.()
  reading?.abort()
  reading = null
  if (audio) {
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  }
  audio = null
  useTvMusic.setState({ track: null, blocked: false })
}

function clearStall(): void {
  if (stall !== null) clearTimeout(stall)
  stall = null
}

/** The track will not play: the next one, or, when none on the list will, a wait. */
function fail(list: Track[]): void {
  clearStall()
  failures++
  if (failures >= list.length) {
    // Nothing on the list will play: try it all again later.
    reading?.abort()
    useTvMusic.setState({ track: null })
    audio?.removeAttribute('src')
    const mine = ++session
    retry = setTimeout(() => { if (mine === session) { failures = 0; advance(list) } }, RETRY_MS)
    return
  }
  advance(list)
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
  reading?.abort()
  clearStall()
  useTvMusic.setState({ track: { url: track.url, title: track.title ?? nameFromUrl(track.url), artist: track.artist ?? '', art: null } })
  a.src = track.url
  // A link that answers and then sends nothing would hold the list on it.
  stall = setTimeout(() => { if (mine === session && audio === a) fail(list) }, STALL_MS)
  play(a, mine)
  void describe(track, mine)
}

/** What a tap on a control is for: the control, not the sound. */
function onControl(e: Event): boolean {
  const t = e.target as { closest?: (s: string) => unknown } | null
  return typeof t?.closest === 'function' && t.closest('button, a, input, select, textarea, [role="button"]') !== null
}

function play(a: HTMLAudioElement, mine: number): void {
  a.play().catch((e: unknown) => {
    if (mine !== session || (e as { name?: string })?.name !== 'NotAllowedError') return
    useTvMusic.setState({ blocked: true })
    if (unblock) return
    // The browser lets sound start in the end of a tap (a finger's touch
    // down does not count), a click, or a key. Kept until the music plays:
    // a try the browser refuses waits for the next.
    const go = (e: Event): void => {
      if (onControl(e) || (e.type === 'keydown' && (e as { key?: string }).key === 'Escape')) return
      if (audio) void audio.play().catch(() => {})
    }
    const kinds = ['pointerup', 'touchend', 'click', 'keydown'] as const
    for (const k of kinds) window.addEventListener(k, go, { capture: true })
    unblock = () => {
      for (const k of kinds) window.removeEventListener(k, go, { capture: true })
      unblock = null
    }
  })
}

/** Fill in NOW PLAYING from the track's tag and its cover, unless the track has changed since. */
async function describe(track: Track, mine: number): Promise<void> {
  const ctrl = typeof AbortController === 'undefined' ? null : new AbortController()
  reading = ctrl
  const timer = ctrl ? setTimeout(() => ctrl.abort(), TAG_MS) : null
  const tags = await readTags(track.url, fetch, ctrl?.signal).catch(() => ({}) as Awaited<ReturnType<typeof readTags>>)
  if (timer !== null) clearTimeout(timer)
  if (reading === ctrl) reading = null
  if (mine !== session) return
  const now = useTvMusic.getState().track
  if (!now) return
  useTvMusic.setState({ track: { ...now, title: track.title ?? (tags.title || now.title), artist: track.artist ?? (tags.artist || now.artist) } })
  const inside = !track.art && tags.picture && typeof URL.createObjectURL === 'function'
    ? URL.createObjectURL(new Blob([tags.picture.data as BlobPart], { type: tags.picture.mime }))
    : null
  try {
    const sources = [...(track.art ? [track.art] : []), ...(inside ? [inside] : []), ...besideUrls(track.url)]
    for (const s of sources) {
      const img = await loadImage(s)
      if (mine !== session) return
      if (img) {
        const cur = useTvMusic.getState().track
        if (cur) useTvMusic.setState({ track: { ...cur, art: shrink(img) } })
        return
      }
    }
  } finally {
    // The cover is copied small (shrink), so its file is not needed after.
    if (inside) URL.revokeObjectURL(inside)
  }
}

/** A cover cut square and made small once, so the tube does not scale a 1400 px picture down every frame. */
function shrink(img: HTMLImageElement): CanvasImageSource {
  if (typeof document === 'undefined') return img
  const c = document.createElement('canvas')
  c.width = COVER_PX
  c.height = COVER_PX
  const ctx = c.getContext('2d')
  if (!ctx) return img
  const side = Math.min(img.naturalWidth, img.naturalHeight)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, COVER_PX, COVER_PX)
  return c
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
