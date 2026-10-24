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
import { isBroadcast } from '../lib/tv/broadcast'
import { EXPLAINER_DUCK } from '../lib/tv/explainer'

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

/** At or under this the volume is silence, and silence is muted: a card that says NOW PLAYING plays. */
const SILENT = 0.01
/** What unmuting a volume turned all the way down comes back at. */
const UNMUTE_TO = 0.5

const startVolume = loadVolume()
export const useTvMusic = create<MusicState>(() => ({ track: null, blocked: false, volume: startVolume, muted: loadMuted() || startVolume <= SILENT }))

/**
 * Whether NOW PLAYING should say TAP FOR SOUND: the browser holds the sound
 * back, and someone could tap. Never on the stream (lib/tv/broadcast), where
 * nobody can, and the encoder's browser allows the sound anyway.
 */
export function askForTap(): boolean {
  return useTvMusic.getState().blocked && !isBroadcast()
}

/** Set the volume, 0 to 1; turning it up unmutes, and all the way down mutes. */
export function setMusicVolume(volume: number): void {
  // The stream is always at full volume (lib/tv/broadcast).
  if (isBroadcast()) return
  const v = Math.min(1, Math.max(0, volume))
  const s = useTvMusic.getState()
  const muted = v <= SILENT || (s.muted && v <= s.volume)
  if (muted !== s.muted) mutedAt = Date.now()
  useTvMusic.setState({ volume: v, muted })
  apply()
  try {
    localStorage.setItem(VOLUME_KEY, v.toFixed(3))
    localStorage.setItem(MUTED_KEY, muted ? '1' : '0')
  } catch { /* kept for this visit only */ }
}

/** Mute, or unmute. */
export function toggleMusicMute(): void {
  if (isBroadcast()) return
  const s = useTvMusic.getState()
  const muted = !s.muted
  // Unmuting silence would still be silence.
  const volume = !muted && s.volume <= SILENT ? UNMUTE_TO : s.volume
  mutedAt = Date.now()
  useTvMusic.setState({ muted, volume })
  apply()
  try {
    localStorage.setItem(MUTED_KEY, muted ? '1' : '0')
    localStorage.setItem(VOLUME_KEY, volume.toFixed(3))
  } catch { /* kept for this visit only */ }
}

/**
 * A tap on NOW PLAYING. While the track sounds, a mute or an unmute. While
 * nothing sounds (paused by the browser, the system or the viewer, or a play
 * never answered), the tap is for the sound: it plays the track, unmuted,
 * since a tap is one the browser lets sound start in (arkinox, 2026-10-20:
 * "Tapping to mute and unmute does not trigger playback."). While the
 * music is held (holdMusicForAd) it is a mute, as ever.
 */
export function tapMusic(): void {
  const a = audio
  if (a && !held && a.getAttribute('src') && !a.ended && (a.paused || !sounding)) {
    if (useTvMusic.getState().muted) toggleMusicMute()
    armStall(currentList)
    play(a, session, currentList)
    return
  }
  toggleMusicMute()
}

/**
 * Play the track if it should be playing and is not, when TV comes back
 * from the background. A play asked for in a background tab can be held by
 * the browser and never answered, and the list then moves on to tracks that
 * never start either (arkinox, 2026-10-20: "After the hosaka ad is done,
 * even if I bring it in the foreground, the music will load the next
 * track, but it won't start playing."). Not while the music is held, and
 * not a track the viewer paused.
 */
export function resumeMusic(): void {
  const a = audio
  if (!a || held) return
  // The list waiting after every track failed: failed in the background,
  // perhaps, where a browser may not fetch them at all. Again now.
  if (retry !== null && !a.getAttribute('src')) {
    clearTimeout(retry)
    retry = null
    failures = 0
    advance(currentList)
    return
  }
  // A play still waiting on the browser is not paused, and is not sounding either.
  if (!wanted || (!a.paused && sounding) || a.ended || !a.getAttribute('src')) return
  armStall(currentList)
  play(a, session, currentList)
}

/**
 * Muting keeps the track playing (arkinox, 2026-10-19: "muting the track
 * shouldnt pause it in tv"). Where the page may set the volume, muted is
 * volume 0, so the browser never sees muted media it might pause; only where
 * it may not (iOS: the volume is the phone's) is the element muted.
 */
function apply(): void {
  if (!audio) return
  const s = useTvMusic.getState()
  // The stream: unmuted, full volume, whatever this browser kept from a
  // viewer; only a break's fade (gain) and an explainer's duck change it
  // (lib/tv/broadcast; an explainer's own audio plays on the stream too, so
  // it still needs the music stepped down under it).
  if (isBroadcast()) {
    audio.muted = false
    audio.volume = gain * explainerDuck
    return
  }
  if (volumeWorks) {
    audio.muted = false
    audio.volume = s.muted ? 0 : s.volume * gain * duck * explainerDuck
  } else {
    audio.volume = s.volume
    audio.muted = s.muted
  }
}

/** What the volume is also multiplied by while hidden audio is heard: 1, or DUCKED (duckMusic). */
let duck = 1
let duckTarget = 1
let ducking: ReturnType<typeof setInterval> | null = null
const DUCK_MS = 500

/**
 * Step the music down while hidden audio is heard, and back up after
 * (arkinox, 2026-10-23: TV ducking), faded over half a second. Where the
 * page may not set the volume (iOS) the music plays on as it is: there is
 * no step between full and muted there. Never on the stream.
 */
export function duckMusic(level: number): void {
  const target = Math.min(1, Math.max(0, level))
  if (target === duckTarget) return
  duckTarget = target
  if (ducking !== null) clearInterval(ducking)
  const from = duck
  const began = Date.now()
  ducking = setInterval(() => {
    const k = Math.min(1, (Date.now() - began) / DUCK_MS)
    duck = from + (target - from) * k
    apply()
    if (k < 1) return
    if (ducking !== null) clearInterval(ducking)
    ducking = null
  }, FADE_STEP_MS)
}

/** How far the music is stepped down now, 0 to 1: for tests. */
export function musicDuck(): number {
  return duck
}

/**
 * What the volume is also multiplied by while an explainer plays: 1, or
 * EXPLAINER_DUCK (duckMusicForExplainer). Its own multiplier, never the
 * same one hidden audio steps (duck, above): the live world (hidden audio)
 * plays on under TV, so both could want the music down at once, and one
 * must not clobber the other's level (store/useTvExplainer).
 */
let explainerDuck = 1
let explainerDuckTarget = 1
let explainerDucking: ReturnType<typeof setInterval> | null = null

/**
 * Step the music down to EXPLAINER_DUCK while an explainer plays, and back
 * up to its own level when it goes, faded over half a second, the same
 * pattern as duckMusic (arkinox, 2026-10-24: "play the music during my
 * explainer, just dim the volume by 50%"). On the stream too, where an
 * explainer's own audio plays alongside the music.
 */
export function duckMusicForExplainer(on: boolean): void {
  const target = on ? EXPLAINER_DUCK : 1
  if (target === explainerDuckTarget) return
  explainerDuckTarget = target
  if (explainerDucking !== null) clearInterval(explainerDucking)
  const from = explainerDuck
  const began = Date.now()
  explainerDucking = setInterval(() => {
    const k = Math.min(1, (Date.now() - began) / DUCK_MS)
    explainerDuck = from + (target - from) * k
    apply()
    if (k < 1) return
    if (explainerDucking !== null) clearInterval(explainerDucking)
    explainerDucking = null
  }, FADE_STEP_MS)
}

/** How far the music is ducked for an explainer now, 0 to 1: for tests. */
export function explainerMusicDuck(): number {
  return explainerDuck
}

/**
 * The track steps out and comes back after, where it was: out faded where
 * the page may set the volume, elsewhere (iOS) a plain pause and play.
 * The HOSAKA commercial no longer calls it: the music plays on under the
 * spot (2026-10-20: "setto of basspistol says we don't have to mute the
 * music while my hosaka ad plays"). Kept for a spot's own music, if one is
 * ever made ("maybe later I'll have my own music to add to the hosaka ad"),
 * which would start and stop here, on the same two calls.
 */
export function holdMusicForAd(on: boolean): void {
  if (on === held) return
  held = on
  const a = audio
  if (on) {
    // Back after only what was playing, or about to: a track the viewer
    // paused, or one the browser holds back for a tap, stays as it was
    // (review of #395).
    // A track whose play failed is still wanted, and comes back after too.
    resumeAfter = a !== null && (!a.paused || (wanted && !useTvMusic.getState().blocked))
    armAfter = false
    if (!a) return
    clearStall()
    if (!volumeWorks) { pauseForAd(a); return }
    fadeTo(0, AD_FADE_OUT_MS, () => { if (held && audio === a) pauseForAd(a) })
    return
  }
  // Whatever happens next, the fade out is over and the level is the
  // viewer's again: a break over the list's wait for a retry left the next
  // track at nothing (review of #395).
  if (fading !== null) clearInterval(fading)
  fading = null
  if (!a || !a.getAttribute('src') || !resumeAfter) { gain = 1; apply(); return }
  // From where the fade out got to: a break cut short before the track
  // paused does not drop to nothing first.
  if (volumeWorks && a.paused) gain = 0
  apply()
  // A track taken up in the break, or one that had not loaded when it
  // began, has its 20 s to send something from now (review of #395).
  if (armAfter || a.readyState < 2) armStall(currentList)
  play(a, session, currentList)
  if (volumeWorks) fadeTo(1, AD_FADE_IN_MS)
}

/**
 * Step the music out at the end of the song playing: the next song waits,
 * loaded, until releaseMusic. A song is never cut off for it. With nothing
 * sounding (no track yet, a track the viewer or the browser paused, the
 * list waiting after every track failed), it steps out now. musicHeldForAd
 * says when it has.
 *
 * Nothing calls this today: an explainer (lib/tv/explainer) used to, before
 * 2026-10-24, waiting for the song to end rather than ducking under it
 * (store/useTvExplainer duckMusicForExplainer). Kept, with holdMusicNow and
 * releaseMusic below, for a break that wants the old wait-and-pause rather
 * than a duck.
 */
export function holdMusicAtSongEnd(): void {
  if (held) return
  const a = audio
  if (!a || !a.getAttribute('src') || a.paused || a.ended || !wanted) { holdAtEnd = false; holdMusicForAd(true); return }
  holdAtEnd = true
}

/** Step the music out now, the song faded and paused where it is, to come back there (holdMusicAtSongEnd waited long enough). */
export function holdMusicNow(): void {
  holdAtEnd = false
  holdMusicForAd(true)
}

/**
 * Bring the music back after holdMusicAtSongEnd or holdMusicNow, or stop
 * waiting for the song's end. With `resume` false, it stays paused, as a
 * song the viewer paused does, until a tap on NOW PLAYING.
 */
export function releaseMusic(resume: boolean = true): void {
  holdAtEnd = false
  if (!resume && held) { resumeAfter = false; wanted = false }
  holdMusicForAd(false)
}

/** Whether the music steps out at the end of this song (holdMusicAtSongEnd). */
let holdAtEnd = false

/**
 * The break's own pause. Told by the element a moment later, by when the
 * break may be over (a background tab's timers run late and together), so
 * it is marked: the viewer's pause is any other.
 */
function pauseForAd(a: HTMLAudioElement): void {
  if (!a.paused) ownPause = true
  a.pause()
}

/** Whether the music has stepped out for a commercial. */
let held = false
/** Whether the next pause the element tells of is the break's own. */
let ownPause = false
/** Whether to play again after the break: it was playing when the break began, or a track was taken up in it. */
let resumeAfter = false
/** Whether the track was taken up in the break, so its stall wait starts after it. */
let armAfter = false
/** Whether the music has stepped out for a commercial: for tests. */
export function musicHeldForAd(): boolean {
  return held
}
/** What the volume is multiplied by: 1, but for a fade in or out of a break. */
let gain = 1
let fading: ReturnType<typeof setInterval> | null = null
/** How long the track takes to go, ms: inside the cut into the break (AD_IN_MS). */
const AD_FADE_OUT_MS = 600
/** How long it takes to come back after, ms. */
const AD_FADE_IN_MS = 1000
const FADE_STEP_MS = 30

function fadeTo(target: number, ms: number, done?: () => void): void {
  if (fading !== null) clearInterval(fading)
  const from = gain
  const began = Date.now()
  fading = setInterval(() => {
    const k = Math.min(1, (Date.now() - began) / ms)
    gain = from + (target - from) * k
    apply()
    if (k < 1) return
    if (fading !== null) clearInterval(fading)
    fading = null
    done?.()
  }, FADE_STEP_MS)
}

/** Whether this browser lets the page set the volume: not iOS, where it stays at 1. */
let volumeWorks = true
/** When the music was last muted or unmuted (Date.now()): a pause just after is the browser's, and is undone. */
let mutedAt = -Infinity
/** Whether the music is meant to be playing: from the page's play until the viewer's own pause or TV's stop. */
let wanted = false
/** Whether the track is sounding: from its 'playing' until a pause or the next play. */
let sounding = false
/** How soon after a mute or unmute a pause the page did not ask for is taken back, ms. */
const RESUME_MS = 1500
/** How long to wait before trying the list again when no track would load, ms. */
const RETRY_MS = 60_000

let audio: HTMLAudioElement | null = null
/** The list playing, for a track taken up again after a break. */
let currentList: Track[] = PLAYLIST
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
  a.volume = 0.5
  volumeWorks = a.volume === 0.5
  a.addEventListener('ended', () => { if (audio === a) advance(list) })
  // A browser that pauses the track as it is muted or unmuted: play on. Any
  // other pause stands, and the music is no longer wanted: the phone's own
  // controls, a key, or the lock screen's, which is the viewer's even with
  // TV out of sight.
  a.addEventListener('pause', () => {
    if (audio !== a) return
    sounding = false
    const own = ownPause
    ownPause = false
    if (own || held || a.ended || !a.getAttribute('src')) return
    if (Date.now() - mutedAt < RESUME_MS) { void a.play().catch(() => {}); return }
    // Nobody pauses the stream (lib/tv/broadcast): a pause there is the
    // browser's or a device's, and the music plays on.
    if (isBroadcast()) { void a.play().catch(() => {}); return }
    wanted = false
  })
  a.addEventListener('error', () => { if (audio === a && a.getAttribute('src')) fail(list) })
  // Something arrived: the link is not broken.
  const arrived = (): void => { if (audio === a) clearStall() }
  a.addEventListener('loadeddata', arrived)
  a.addEventListener('canplay', arrived)
  a.addEventListener('playing', () => {
    if (audio !== a) return
    sounding = true
    clearStall()
    failures = 0
    unblock?.()
    if (useTvMusic.getState().blocked) useTvMusic.setState({ blocked: false })
  })
  audio = a
  currentList = list
  held = false
  gain = 1
  // What NOW PLAYING's card shows on the stream: full and unmuted.
  if (isBroadcast()) useTvMusic.setState({ volume: 1, muted: false })
  apply()
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
  if (fading !== null) clearInterval(fading)
  fading = null
  held = false
  holdAtEnd = false
  resumeAfter = false
  armAfter = false
  wanted = false
  sounding = false
  ownPause = false
  // A mute in the last session does not make the next one's pauses the browser's.
  mutedAt = -Infinity
  gain = 1
  // TV going off mid-explainer must not leave the next session's music ducked.
  if (explainerDucking !== null) clearInterval(explainerDucking)
  explainerDucking = null
  explainerDuck = 1
  explainerDuckTarget = 1
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
    if (audio) {
      audio.removeAttribute('src')
      // Stops a download still trickling in, which could otherwise start playing with no card up.
      audio.load()
    }
    const mine = ++session
    retry = setTimeout(() => { if (mine === session) { retry = null; failures = 0; advance(list) } }, RETRY_MS)
    return
  }
  advance(list)
}

function advance(list: Track[]): void {
  const a = audio
  if (!a) return
  // Between songs: where something steps the music out at a song's end
  // (holdMusicAtSongEnd; nothing does today). The next is taken up below and waits, ready.
  if (holdAtEnd && !held) {
    holdAtEnd = false
    held = true
    clearStall()
  }
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
  sounding = false
  // One that ends while the music is held waits, ready, for the hold to end.
  if (!held) {
    armStall(list)
    play(a, mine, list)
  } else {
    resumeAfter = true
    armAfter = true
  }
  void describe(track, mine)
}

/**
 * A link that answers and then sends nothing would hold the list on it.
 * Only while the sound may play: a browser holding it back until a tap may
 * not fetch the track either, and every track would look broken
 * (review of #382, round 2).
 */
function armStall(list: Track[]): void {
  clearStall()
  const mine = session
  const a = audio
  stall = setTimeout(() => {
    if (mine !== session || audio !== a) return
    // Not in the background, where a browser may hold the track back
    // unfetched and every link would look broken: its 20 s start again
    // when TV is seen (resumeMusic, or here if it is seen first).
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') { armStall(list); return }
    fail(list)
  }, STALL_MS)
}

/** What a tap on a control is for: the control, not the sound. */
function onControl(e: Event): boolean {
  const t = e.target as { closest?: (s: string) => unknown } | null
  return typeof t?.closest === 'function' && t.closest('button, a, input, select, textarea, [role="button"]') !== null
}

function play(a: HTMLAudioElement, mine: number, list: Track[]): void {
  wanted = true
  // Playing already, it says so no more (no 'playing' comes): it sounds on.
  if (a.paused) sounding = false
  a.play().catch((e: unknown) => {
    if (mine !== session || (e as { name?: string })?.name !== 'NotAllowedError') return
    clearStall()
    useTvMusic.setState({ blocked: true })
    if (unblock) return
    // The browser lets sound start in the end of a tap (a finger's touch
    // down does not count), a click, or a key. Kept until the music plays:
    // a try the browser refuses waits for the next.
    const go = (e: Event): void => {
      if (onControl(e) || (e.type === 'keydown' && (e as { key?: string }).key === 'Escape')) return
      // Not while the music is held: a tap then waits, and the one after
      // the hold starts the music (review of #395; on iOS that is a second
      // tap, the browser's allowance being spent on the first).
      if (!audio || held) return
      // Allowed now, perhaps: the track has its 20 s again to send something.
      const tried = session
      armStall(list)
      // Only this track's refusal stands its stall down: a play cut short by
      // the next track (AbortError) must not clear that track's (review of #382, round 3).
      void audio.play().catch((err: unknown) => {
        if (tried === session && (err as { name?: string })?.name === 'NotAllowedError') clearStall()
      })
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
