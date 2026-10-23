/**
 * useTvExplainer.ts: Cyberspace TV's explainers, rolled between the live
 * picture's moments (lib/tv/explainer has the what and the when; the lineup
 * is lib/tv/explainerLineup).
 *
 * TV's engine (store/useTv) ticks this. When one is due, its video is
 * fetched whole, its sha256 checked, and played from the copy in memory, so
 * the file on screen is the file in the lineup. Once it is ready, the music
 * steps out at the end of the song (store/useTvMusic holdMusicAtSongEnd),
 * and then the live picture shrinks into its corner (in), the video plays
 * (play), and the picture grows back as the next song comes in (out). The
 * tube draws all of it (scene/TvScreenEffect, scene/tvPainter).
 *
 * Fail-safe: nothing on screen changes until the video is ready. A video
 * that will not load or fails its hash is skipped. One that errors or stops
 * moving while it plays, or outlasts its guard (guardMs), gives the picture
 * straight back. Every wait has a deadline.
 */

import { create } from 'zustand'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '../lib/events'
import {
  EXPLAINER_AD_GAP_MS, EXPLAINER_EVERY_MS, EXPLAINER_FAIL_OUT_MS, EXPLAINER_FIRST_MS, EXPLAINER_FORCED_MS, EXPLAINER_IN_MS,
  EXPLAINER_LOAD_MS, EXPLAINER_MAX_BYTES, EXPLAINER_MUSIC_WAIT_MS, EXPLAINER_OUT_MS, EXPLAINER_RETRY_MS, EXPLAINER_STALL_MS,
  cueAt, fileHash, forcedExplainer, guardMs, nextExplainer, parseVtt, playableFiles,
  type Cue, type Explainer, type ExplainerPhase,
} from '../lib/tv/explainer'
import { EXPLAINERS } from '../lib/tv/explainerLineup'
import { holdMusicAtSongEnd, holdMusicNow, musicHeldForAd, releaseMusic, useTvMusic } from './useTvMusic'
import { isBroadcast } from '../lib/tv/broadcast'

/** The explainer on screen. */
export interface ExplainerShowing {
  id: string
  title: string
  phase: ExplainerPhase
  /** performance.now() the phase began. */
  at: number
  /** How long the way out takes: shorter when the video failed. */
  outMs: number
}

interface ExplainerState {
  showing: ExplainerShowing | null
}

export const useTvExplainer = create<ExplainerState>(() => ({ showing: null }))

/** What TV's engine tells each tick. */
export interface TvSide {
  /** The tape is playing (not tuning, no signal, or at its end). */
  playing: boolean
  /** The HOSAKA spot is on. */
  ad: boolean
  /** When the last spot ended, performance.now(). */
  adEndedAt: number
}

/** One being got ready. */
interface Pending {
  ex: Explainer
  began: number
  /** When the video was ready, or null. */
  readyAt: number | null
  /** The video would not load: given up on at the next tick. */
  failed: boolean
  /** The music was asked to step out, and whether it was faded out mid-song after waiting. */
  asked: boolean
  faded: boolean
  abort: AbortController | null
}

let lineup: Explainer[] = EXPLAINERS
/**
 * Files this browser will not play: the wrong hash, too large, or not
 * decodable here. Never fetched again this visit, so a phone that cannot
 * play one does not download it every few minutes. A file that only failed
 * to arrive (offline, a server down) is tried again.
 */
const unplayable = new Set<string>()
let due = Infinity
let last: string | null = null
let forced: string | null = null
let pending: Pending | null = null
let endedAt = -Infinity
/** The run of TV this belongs to: a load from an earlier one is dropped. */
let gen = 0
let video: HTMLVideoElement | null = null
let blobUrl: string | null = null
let cues: Cue[] = []
let guardAt = Infinity
let progress = { t: -1, at: 0 }
let failedOut = false
let unlock: (() => void) | null = null

/** The video playing, for the tube to draw; null when none is on screen. */
export function explainerVideo(): HTMLVideoElement | null {
  return useTvExplainer.getState().showing ? video : null
}

/** The caption on screen now, if the one on screen has captions. */
export function explainerCaption(): string | null {
  const v = explainerVideo()
  return v && cues.length ? cueAt(cues, v.currentTime) : null
}

/** Whether one is being got ready or is on screen: the HOSAKA spot waits meanwhile. */
export function explainerBusy(): boolean {
  return pending !== null || useTvExplainer.getState().showing !== null
}

/** When the last one went off screen, performance.now(): the spot keeps EXPLAINER_AD_GAP_MS from it. */
export function explainerEndedAt(): number {
  return endedAt
}

/** TV came on: the first is due a little in, or a forced one (/tv?explainer=<id>) at once. */
export function startExplainers(now: number, search: string = typeof window !== 'undefined' && window.location ? window.location.search : ''): void {
  stopExplainers()
  const want = forcedExplainer(search)
  forced = want !== null && lineup.some((e) => e.id === want) ? want : null
  last = null
  endedAt = -Infinity
  due = lineup.length === 0 ? Infinity : now + (forced ? EXPLAINER_FORCED_MS : EXPLAINER_FIRST_MS)
}

/** TV went off: whatever was under way goes, and nothing is due. The music is TV's to stop. */
export function stopExplainers(): void {
  gen++
  pending?.abort?.abort()
  pending = null
  due = Infinity
  guardAt = Infinity
  dropVideo()
  if (useTvExplainer.getState().showing) useTvExplainer.setState({ showing: null })
}

/** One tick of TV's engine. */
export function explainerTick(now: number, tv: TvSide): void {
  const showing = useTvExplainer.getState().showing
  if (showing) { onScreen(showing, now); return }
  if (pending) { getReady(pending, now); return }
  if (now < due || lineup.length === 0) return
  // Not over the spot or close after it, and not before the tape is playing:
  // but one asked for by name (/tv?explainer=<id>, a look at it) plays over
  // TUNING or NO SIGNAL too.
  if ((!tv.playing && forced === null) || tv.ad || now - tv.adEndedAt < EXPLAINER_AD_GAP_MS) return
  const ex = nextExplainer(lineup, last, forced)
  if (!ex) return
  forced = null
  last = ex.id
  pending = { ex, began: now, readyAt: null, failed: false, asked: false, faded: false, abort: null }
  void load(pending, gen)
}

/** Waiting on the video, then on the song to end, then on screen. */
function getReady(p: Pending, now: number): void {
  if (p.failed || (p.readyAt === null && now - p.began > EXPLAINER_LOAD_MS)) { skip(now); return }
  if (p.readyAt === null) return
  if (!p.asked) { p.asked = true; holdMusicAtSongEnd() }
  // A song that runs on too long fades out instead, and comes back where it was.
  if (!musicHeldForAd() && !p.faded && now - p.readyAt >= EXPLAINER_MUSIC_WAIT_MS) { p.faded = true; holdMusicNow() }
  if (!musicHeldForAd()) return
  pending = null
  show(p.ex, now)
}

/** It did not play: the music back, and the next tried later. */
function skip(now: number): void {
  pending?.abort?.abort()
  if (pending?.asked) releaseMusic()
  pending = null
  dropVideo()
  due = now + EXPLAINER_RETRY_MS
}

function show(ex: Explainer, now: number): void {
  const v = video
  if (!v) { skip(now); return }
  guardAt = now + guardMs(ex)
  progress = { t: -1, at: now }
  failedOut = false
  try { v.currentTime = 0 } catch { /* from where it is */ }
  setSound(v)
  useTvExplainer.setState({ showing: { id: ex.id, title: ex.title, phase: 'in', at: now, outMs: EXPLAINER_OUT_MS } })
  const mine = gen
  v.play().catch((e: unknown) => {
    if (mine !== gen || video !== v) return
    // The browser holds the sound back (no tap yet): the picture plays
    // without it, and the next tap brings it in.
    if ((e as { name?: string })?.name === 'NotAllowedError' && !v.muted) {
      v.muted = true
      v.play().then(() => soundOnTap(v), () => fail())
      return
    }
    fail()
  })
}

/** The viewer's sound: their volume and mute on the site; full on the stream. */
function setSound(v: HTMLVideoElement): void {
  if (isBroadcast()) { v.muted = false; v.volume = 1; return }
  const { volume, muted } = useTvMusic.getState()
  v.volume = muted ? 0 : volume
  // Where the page cannot set the volume (iOS), muted is the element's own.
  v.muted = muted && v.volume !== 0
}

/** Sound held back by the browser comes in on the next tap or key, as the music's does. */
function soundOnTap(v: HTMLVideoElement): void {
  if (typeof window === 'undefined' || unlock) return
  const go = (): void => {
    if (video !== v || !useTvExplainer.getState().showing) { unlock?.(); return }
    v.muted = false
    setSound(v)
    void v.play().then(() => unlock?.(), () => { v.muted = true; void v.play().catch(() => {}) })
  }
  const kinds = ['pointerup', 'touchend', 'click', 'keydown'] as const
  for (const k of kinds) window.addEventListener(k, go, { capture: true })
  unlock = () => {
    for (const k of kinds) window.removeEventListener(k, go, { capture: true })
    unlock = null
  }
}

/** The video stopped working on screen: the picture straight back. */
function fail(): void {
  failedOut = true
  const s = useTvExplainer.getState().showing
  if (s && s.phase !== 'out') goOut(performance.now(), EXPLAINER_FAIL_OUT_MS)
}

function goOut(now: number, ms: number): void {
  const s = useTvExplainer.getState().showing
  if (!s) return
  // Its last frame holds, silent, as the picture grows back over it (a
  // guard's end cuts it there), and the next song comes in.
  if (video && !video.paused) { try { video.pause() } catch { /* gone already */ } }
  releaseMusic()
  useTvExplainer.setState({ showing: { ...s, phase: 'out', at: now, outMs: ms } })
}

function onScreen(s: ExplainerShowing, now: number): void {
  const v = video
  if (s.phase === 'out') {
    if (now - s.at < s.outMs) return
    endedAt = now
    due = now + EXPLAINER_EVERY_MS
    guardAt = Infinity
    dropVideo()
    useTvExplainer.setState({ showing: null })
    return
  }
  if (!v || failedOut || v.error) { goOut(now, EXPLAINER_FAIL_OUT_MS); return }
  if (v.ended) { goOut(now, EXPLAINER_OUT_MS); return }
  if (now >= guardAt) { goOut(now, EXPLAINER_OUT_MS); return }
  // Moving on, or stalled: a video that holds one frame this long gives the picture back.
  if (v.currentTime !== progress.t) progress = { t: v.currentTime, at: now }
  else if (now - progress.at >= EXPLAINER_STALL_MS) { goOut(now, EXPLAINER_FAIL_OUT_MS); return }
  if (s.phase === 'in' && now - s.at >= EXPLAINER_IN_MS) useTvExplainer.setState({ showing: { ...s, phase: 'play', at: now } })
}

/** The video's element and its copy in memory, let go. */
function dropVideo(): void {
  unlock?.()
  cues = []
  if (video) {
    try { video.pause() } catch { /* gone already */ }
    video.removeAttribute('src')
    try { video.load() } catch { /* nothing to stop */ }
  }
  video = null
  if (blobUrl) { try { URL.revokeObjectURL(blobUrl) } catch { /* gone already */ } }
  blobUrl = null
}

/** A link's bytes, whole, refused past EXPLAINER_MAX_BYTES. */
async function fetchBytes(url: string, signal: AbortSignal): Promise<Uint8Array> {
  const res = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const length = Number(res.headers.get('content-length'))
  if (Number.isFinite(length) && length > EXPLAINER_MAX_BYTES) throw new Error('too large')
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.byteLength > EXPLAINER_MAX_BYTES) throw new Error('too large')
  return bytes
}

/** sha256 of `bytes`, hex: the browser's own where it has one, off the main thread. */
async function hashOf(bytes: Uint8Array): Promise<string> {
  const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined
  if (subtle) {
    try { return bytesToHex(new Uint8Array(await subtle.digest('SHA-256', bytes as BufferSource))) } catch { /* below */ }
  }
  return bytesToHex(sha256(bytes))
}

/** The element ready to play from its start: enough of it decoded to draw and go on. */
function whenReady(v: HTMLVideoElement, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (v.readyState >= 3) { resolve(); return }
    const done = (ok: boolean): void => {
      v.removeEventListener('canplay', yes)
      v.removeEventListener('error', no)
      signal.removeEventListener('abort', no)
      if (ok) resolve(); else reject(new Error('not playable'))
    }
    const yes = (): void => done(true)
    const no = (): void => done(false)
    // A browser that buffers nothing until asked to play (iOS) is asked,
    // silently, and stopped: the frames come, and it plays from the start later.
    const warm = (): void => { if (v.readyState < 3) v.play().then(() => { if (!useTvExplainer.getState().showing) v.pause() }, () => {}) }
    v.addEventListener('loadedmetadata', warm, { once: true })
    v.addEventListener('canplay', yes)
    v.addEventListener('error', no)
    signal.addEventListener('abort', no)
  })
}

/** Get one ready: the first of its files this browser plays that loads and has the right hash. */
async function load(p: Pending, mine: number): Promise<void> {
  if (typeof document === 'undefined') { p.failed = true; return }
  const ctrl = typeof AbortController === 'undefined' ? null : new AbortController()
  p.abort = ctrl
  const signal = ctrl?.signal ?? new AbortController().signal
  const v = document.createElement('video')
  v.playsInline = true
  v.preload = 'auto'
  v.muted = true
  const files = playableFiles(p.ex.files, (t) => v.canPlayType(t)).filter((f) => !unplayable.has(f.url))
  if (p.ex.captions) void loadCaptions(p.ex.captions, signal, mine)
  for (const f of files) {
    let arrived = false
    try {
      const bytes = await fetchBytes(f.url, signal)
      arrived = true
      const want = fileHash(f)
      if (want !== null && (await hashOf(bytes)) !== want) throw new Error('hash mismatch')
      if (mine !== gen || pending !== p) return
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: f.type.split(';')[0].trim() }))
      blobUrl = url
      video = v
      v.src = url
      await whenReady(v, signal)
      if (mine !== gen || pending !== p) return
      p.readyAt = performance.now()
      return
    } catch (e) {
      if (mine !== gen || pending !== p) return
      if ((arrived || (e as Error)?.message === 'too large') && !signal.aborted) unplayable.add(f.url)
      if (blobUrl) { try { URL.revokeObjectURL(blobUrl) } catch { /* gone */ } blobUrl = null }
      video = null
    }
  }
  if (mine === gen && pending === p) p.failed = true
}

async function loadCaptions(url: string, signal: AbortSignal, mine: number): Promise<void> {
  try {
    const res = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
    if (!res.ok) return
    const text = await res.text()
    if (mine === gen) cues = parseVtt(text)
  } catch { /* no captions, then */ }
}

/** Swap the lineup, for tests; null puts the real one back. */
export function setExplainerLineupForTest(list: Explainer[] | null): void {
  lineup = list ?? EXPLAINERS
  unplayable.clear()
}

/** When the next is due, performance.now(): for tests. */
export function explainerDueForTest(): number {
  return due
}
