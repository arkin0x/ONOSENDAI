/**
 * useTvExplainer.ts: Cyberspace TV's explainers, rolled between the live
 * picture's moments (lib/tv/explainer has the what and the when; the lineup
 * is lib/tv/explainerLineup).
 *
 * TV's engine (store/useTv) ticks this. When one is due, its video is
 * fetched whole, its sha256 checked, and played from the copy in memory, so
 * the file on screen is the file in the lineup. Once it is ready, the
 * picture goes straight on screen (in), the video plays (play), and the
 * picture comes back (out). The music is never waited for: it plays on
 * throughout, ducked (store/useTvMusic duckMusicForExplainer), and comes
 * back to its own level when the picture does (arkinox, 2026-10-24: "can
 * you play the music during my explainer, just dim the volume by 50%").
 * The tube draws all of it (scene/TvScreenEffect, scene/tvPainter).
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
  EXPLAINER_LOAD_MS, EXPLAINER_MAX_BYTES, EXPLAINER_OUT_MS, EXPLAINER_RETRY_MS, EXPLAINER_STALL_MS,
  cueAt, fileHash, forcedExplainer, guardMs, nextExplainer, parseVtt, playableFiles,
  type Cue, type Explainer, type ExplainerPhase,
} from '../lib/tv/explainer'
import { EXPLAINERS } from '../lib/tv/explainerLineup'
import { duckMusicForExplainer, useTvMusic } from './useTvMusic'
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
/** The viewer's volume and mute followed while one is on screen (show), let go with it. */
let follow: (() => void) | null = null
/** The browser held the sound back: muted until a tap, whatever the viewer's level. */
let policyMuted = false
/** The next pause the video tells of is the page's own (goOut, the warm-up, dropVideo). */
let ownPause = false
/** Which load the captions arriving belong to: a late file from an earlier one is dropped. */
let captionsFor: object | null = null

/** The video playing, for the tube to draw; null when none is on screen. */
export function explainerVideo(): HTMLVideoElement | null {
  return useTvExplainer.getState().showing ? video : null
}

/**
 * The caption on screen now, if the one on screen has captions. None once it
 * is on its way out, whatever ended it: its last frame holds while the
 * picture comes back, and a caption held over that frame outlived its
 * moment (arkinox, 2026-10-24: "stuck captions").
 */
export function explainerCaption(): string | null {
  const v = explainerVideo()
  if (!v || cues.length === 0 || useTvExplainer.getState().showing?.phase === 'out') return null
  return cueAt(cues, v.currentTime)
}

/** Whether the browser holds the sound of the one on screen back until a tap (TAP FOR SOUND on its tag). */
export function explainerSoundHeld(): boolean {
  return policyMuted && useTvExplainer.getState().showing !== null
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
  pending = { ex, began: now, readyAt: null, failed: false, abort: null }
  void load(pending, gen)
}

/** Waiting on the video, then straight on screen: never on the song (arkinox, 2026-10-24). */
function getReady(p: Pending, now: number): void {
  if (p.failed) { skip(now); return }
  if (p.readyAt === null && now - p.began > EXPLAINER_LOAD_MS) {
    // Too slow to come on this connection: on the site, not tried again this
    // visit, so a phone on a slow link does not fetch most of it every few
    // minutes for nothing. The stream tries again (review of #471, round 2).
    if (!isBroadcast()) for (const f of p.ex.files) unplayable.add(f.url)
    skip(now)
    return
  }
  if (p.readyAt === null) return
  pending = null
  show(p.ex, now)
}

/** It did not play: the next tried later. Nothing was asked of the music. */
function skip(now: number): void {
  pending?.abort?.abort()
  pending = null
  dropVideo()
  due = now + EXPLAINER_RETRY_MS
}

function show(ex: Explainer, now: number): void {
  const v = video
  if (!v) { dropVideo(); due = now + EXPLAINER_RETRY_MS; return }
  guardAt = now + guardMs(ex)
  progress = { t: -1, at: now }
  failedOut = false
  try { v.currentTime = 0 } catch { /* from where it is */ }
  policyMuted = false
  ownPause = false
  setSound(v)
  // A mute or a volume the viewer sets meanwhile is the video's too (review of #471).
  follow?.()
  follow = useTvMusic.subscribe((st, prev) => { if (video === v && (st.volume !== prev.volume || st.muted !== prev.muted)) setSound(v) })
  // The music plays on, ducked rather than paused or waited for (arkinox, 2026-10-24).
  duckMusicForExplainer(true)
  useTvExplainer.setState({ showing: { id: ex.id, title: ex.title, phase: 'in', at: now, outMs: EXPLAINER_OUT_MS } })
  const mine = gen
  v.play().catch((e: unknown) => {
    if (mine !== gen || video !== v) return
    // The browser holds the sound back (no tap yet): the picture plays
    // without it, and the next tap brings it in.
    if ((e as { name?: string })?.name === 'NotAllowedError' && !v.muted) {
      policyMuted = true
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
  v.muted = policyMuted || (muted && v.volume !== 0)
}

/** Sound held back by the browser comes in on the next tap or key, as the music's does. */
function soundOnTap(v: HTMLVideoElement): void {
  if (typeof window === 'undefined' || unlock) return
  const go = (): void => {
    if (video !== v || !useTvExplainer.getState().showing) { unlock?.(); return }
    policyMuted = false
    setSound(v)
    void v.play().then(() => unlock?.(), () => { policyMuted = true; v.muted = true; void v.play().catch(() => {}) })
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
  // guard's end cuts it there).
  pauseOwn(video)
  follow?.()
  follow = null
  // The music was never paused for it, so there is nothing to resume: only
  // step the duck back up, whatever ended the explainer (arkinox, 2026-10-24).
  duckMusicForExplainer(false)
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

/** Pause the video as the page's own pause, not the viewer's. */
function pauseOwn(v: HTMLVideoElement | null): void {
  if (!v || v.paused) return
  ownPause = true
  try { v.pause() } catch { /* gone already */ }
}

/**
 * A pause the page did not make, while it plays: the viewer's (the lock
 * screen's or the phone's own controls reach the video, the element making
 * the sound). It ends the explainer; the music is its own, playing on
 * ducked since before this, so there is nothing of its play state to keep
 * (arkinox, 2026-10-24: before this it paused for the explainer, and so
 * stayed paused here too; review of #471). Not on the stream, where nobody
 * can pause: one there is the browser's, and the stall guard has it.
 */
function onPause(v: HTMLVideoElement): void {
  if (ownPause) { ownPause = false; return }
  // Told late, by when it plays again (the warm-up's pause, after show's
  // play): not a pause any more (review of #471, round 2).
  if (!v.paused) return
  const s = useTvExplainer.getState().showing
  if (video !== v || !s || s.phase === 'out' || v.ended || isBroadcast()) return
  goOut(performance.now(), EXPLAINER_FAIL_OUT_MS)
}

/** The video's element and its copy in memory, let go. */
function dropVideo(): void {
  unlock?.()
  follow?.()
  follow = null
  cues = []
  captionsFor = null
  if (video) {
    pauseOwn(video)
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
  // Counted as it comes, so a host that sends no length cannot fill memory (review of #471).
  const reader = res.body?.getReader()
  if (!reader) {
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.byteLength > EXPLAINER_MAX_BYTES) throw new Error('too large')
    return bytes
  }
  const parts: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > EXPLAINER_MAX_BYTES) { void reader.cancel().catch(() => {}); throw new Error('too large') }
    parts.push(value)
  }
  const bytes = new Uint8Array(total)
  let at = 0
  for (const part of parts) { bytes.set(part, at); at += part.byteLength }
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
    const warm = (): void => { if (v.readyState < 3) v.play().then(() => { if (!useTvExplainer.getState().showing) pauseOwn(v) }, () => {}) }
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
  v.addEventListener('pause', () => onPause(v))
  // Only a file with a hash plays: the one in the lineup, byte for byte, or none.
  const files = playableFiles(p.ex.files, (t) => v.canPlayType(t)).filter((f) => fileHash(f) !== null && !unplayable.has(f.url))
  cues = []
  const token = {}
  captionsFor = token
  if (p.ex.captions && files.length > 0) void loadCaptions(p.ex.captions, signal, token)
  for (const f of files) {
    let arrived = false
    try {
      const bytes = await fetchBytes(f.url, signal)
      arrived = true
      if ((await hashOf(bytes)) !== fileHash(f)) throw new Error('hash mismatch')
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

async function loadCaptions(url: string, signal: AbortSignal, token: object): Promise<void> {
  try {
    const res = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
    if (!res.ok) return
    const text = await res.text()
    if (captionsFor === token) cues = parseVtt(text)
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
