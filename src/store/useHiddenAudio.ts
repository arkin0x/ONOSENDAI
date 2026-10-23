/**
 * useHiddenAudio.ts: every sound a hidden audio item makes, and what is
 * playing (DECK-0007; arkinox's rulings of 2026-10-23).
 *
 * One place for all of it, so the card's PLAY, the world's sources and the
 * NOW PLAYING list read and drive the same voices. A voice is a decrypted
 * file (lib/audioFile openAudio) in an audio element, sent into the one
 * audio context (lib/audioContext) through three.js: a card's PLAY through a
 * plain THREE.Audio, the file as it is; a source in the world through a
 * THREE.PositionalAudio placed at the item in the scene, its distance
 * fading turned off (rolloff 0), because how loud it is comes from the
 * region's fade (lib/audioWorld), set on its gain. The listener is three's
 * AudioListener, moved to the camera every frame (scene/HiddenAudio).
 *
 * A voice the browser will not let play waits (phase `waiting`): the
 * context is still held back, or (Safari, iOS above all) the element may
 * only start inside a tap. TAP FOR SOUND says so, and the next tap or key
 * anywhere calls every waiting voice's play inside that gesture
 * (letSoundOut). A voice a call or the lock screen paused waits the same
 * way. A world voice that fails is not tried again at once: it waits out a
 * growing pause (worldFailed), so a dead or hostile URL is not fetched over
 * and over by everyone standing there.
 *
 * Where there is no Web Audio at all, a card still plays its file through
 * the element alone, and nothing sounds in the world.
 */

import { create } from 'zustand'
import { Audio as ThreeAudio, AudioContext as ThreeAudioContext, AudioListener, PositionalAudio, type Camera } from 'three'
import { openAudio } from '../lib/audioFile'
import { audioFileName, type AudioItem } from '../lib/audioItem'
import { audioContext, audioRunning, onAudioContext, resumeAudio, setAudioSession, wantSound } from '../lib/audioContext'
import { hidesThing } from '../lib/muteList'
import { useMutes } from './useMutes'
import { useCyberspace } from './useCyberspace'
import { duckMusic } from './useTvMusic'
import { DUCKED } from '../lib/audioWorld'

export type AudioPhase = 'loading' | 'waiting' | 'playing' | 'error'
export type VoiceMode = 'card' | 'world'

export interface AudioEntry {
  phase: AudioPhase
  title: string
  mode: VoiceMode
  /** The world item this is the sound of. */
  itemKey: string
  /** Why it failed, for the card. */
  error?: string
}

interface HiddenAudioState {
  /** By voice key (cardKey, worldKey). Absent: silent. */
  entries: Record<string, AudioEntry>
}

export const useHiddenAudio = create<HiddenAudioState>(() => ({ entries: {} }))

/** The voice of an item's card PLAY. */
export const cardKey = (itemKey: string): string => `card:${itemKey}`
/** The voice of an item sounding where it is hidden. */
export const worldKey = (itemKey: string): string => `world:${itemKey}`

interface Voice {
  /** The element a streamed voice plays from; absent for a file decoded whole (a short world file). */
  el?: HTMLAudioElement
  url?: string
  node: ThreeAudio<GainNode | PannerNode> | null
  /** Try to play now; inside a gesture where a browser asks for one. */
  play: () => void
  /** Hold it where it is, to pick up there. */
  pause: () => void
}

const voices = new Map<string, Voice>()

/** What the mute list is asked about a voice's item (useShards muteSubject). */
export interface MuteSubject { authors: readonly (string | null | undefined)[]; ids: readonly (string | null | undefined)[]; mine?: boolean }
/** Each voice's item, as the mute list would be asked about it. */
const subjects = new Map<string, MuteSubject>()

/**
 * Stop every voice whose item the mute list now hides: a mute or a block
 * made anywhere (an avatar card, the BLOCKED list, another device's list
 * arriving) silences what already plays, and NOW PLAYING drops it. World
 * voices would stop at the scene's next tick anyway, since muted items leave
 * the world (useShards worldItems); a card's PLAY has no tick, so this is
 * what stops it.
 */
export function stopMutedVoices(): string[] {
  const muted = useMutes.getState().muted
  const me = useCyberspace.getState().identity.pubkey
  const stopped: string[] = []
  for (const [key, who] of [...subjects]) {
    if (!hidesThing(muted, who, me)) continue
    stopVoice(key)
    stopped.push(key)
  }
  return stopped
}

const offMutes = useMutes.subscribe((s, prev) => { if (s.muted !== prev.muted) stopMutedVoices() })

/** Voices waiting to be let out: their play, to be called inside a tap. */
const waitingPlays = new Set<string>()
let gestureOff: (() => void) | null = null

/** What a tap on a field is for: typing, not sound. */
function onField(e: Event): boolean {
  const t = e.target as { closest?: (s: string) => unknown } | null
  return typeof t?.closest === 'function' && t.closest('input, select, textarea') !== null
}

/** Listen for the next tap or key while anything waits; stop once nothing does. */
function armGesture(): void {
  if (waitingPlays.size === 0) { gestureOff?.(); return }
  if (gestureOff || typeof window === 'undefined') return
  const go = (e: Event): void => { if (!onField(e)) letSoundOut() }
  const kinds = ['pointerup', 'touchend', 'click', 'keydown'] as const
  for (const k of kinds) window.addEventListener(k, go, { capture: true })
  gestureOff = () => {
    for (const k of kinds) window.removeEventListener(k, go, { capture: true })
    gestureOff = null
  }
}

/** A voice waits for a tap: TAP FOR SOUND counts it, and the next tap plays it. */
function waitForTap(key: string): void {
  const e = useHiddenAudio.getState().entries[key]
  if (e && e.phase !== 'waiting') setEntry(key, { ...e, phase: 'waiting' })
  waitingPlays.add(key)
  wantSound()
  armGesture()
}

/**
 * Let sound out, from inside a tap (TAP FOR SOUND, or any tap while
 * something waits): resume the context, and call every waiting voice's play
 * in the same gesture, as Safari asks.
 */
export function letSoundOut(): void {
  resumeAudio()
  for (const key of [...waitingPlays]) voices.get(key)?.play()
}

/**
 * Voices follow the context: one that sounded when the browser (or the
 * phone, for a call or the lock screen) suspended sound waits again; when
 * sound is back, every waiting voice is tried, and one still refused waits
 * on for a tap.
 */
export function syncVoicePhases(): void {
  if (!audioRunning()) {
    for (const key of voices.keys()) {
      const e = useHiddenAudio.getState().entries[key]
      // Paused where it is, so a one-shot does not run on unheard and is not over when sound is back.
      if (e?.phase === 'playing') { voices.get(key)?.pause(); waitForTap(key) }
    }
    return
  }
  for (const key of [...waitingPlays]) voices.get(key)?.play()
}

/** Safari's session follows what plays: `playback` while any hidden audio sounds, `auto` otherwise. */
const offSession = useHiddenAudio.subscribe((s) => {
  setAudioSession(Object.values(s.entries).some((e) => e.phase === 'playing') ? 'playback' : 'auto')
})

const offContext = onAudioContext(syncVoicePhases)
// A reload in development leaves no second subscription behind.
if (import.meta.hot) import.meta.hot.dispose(() => { offMutes(); offContext(); offSession(); gestureOff?.() })
/** Changes on every start and stop of a key: what an answer for an older one is ignored by. */
const sessions = new Map<string, number>()

function setEntry(key: string, entry: AudioEntry | null): void {
  const entries = { ...useHiddenAudio.getState().entries }
  if (entry) entries[key] = entry
  else delete entries[key]
  useHiddenAudio.setState({ entries })
}

let listener: AudioListener | null = null

/** three's listener, on the shared context, made once; null where there is no Web Audio. */
export function audioListener(): AudioListener | null {
  if (listener) return listener
  const ctx = audioContext()
  if (!ctx) return null
  try {
    ThreeAudioContext.setContext(ctx)
    listener = new AudioListener()
  } catch {
    listener = null
  }
  return listener
}

/** Put the ears where the camera is, facing where it faces: every frame (scene/HiddenAudio). */
export function moveListener(camera: Camera): void {
  const l = listener
  if (!l) return
  l.position.copy(camera.position)
  l.quaternion.copy(camera.quaternion)
  l.updateMatrixWorld(true)
}

function release(key: string): void {
  waitingPlays.delete(key)
  armGesture()
  const v = voices.get(key)
  if (!v) return
  voices.delete(key)
  v.el?.pause()
  // A file decoded whole plays from a buffer source, stopped here.
  try { if (!v.el && v.node?.isPlaying) v.node.stop() } catch { /* already stopped */ }
  // three's disconnect parts the source only; its gain (and a panner) stay
  // wired to the listener, so they are parted too, or every voice leaves
  // live nodes in the graph.
  try { v.node?.disconnect() } catch { /* already apart */ }
  try { (v.node?.getOutput() as AudioNode | undefined)?.disconnect() } catch { /* already apart */ }
  try { v.node?.gain.disconnect() } catch { /* already apart */ }
  if (v.el) {
    v.el.removeAttribute('src')
    v.el.load()
  }
  if (v.url) URL.revokeObjectURL(v.url)
}

/** Whether a voice is sounding, or about to. */
export function isPlaying(key: string): boolean {
  const e = useHiddenAudio.getState().entries[key]
  return e?.phase === 'playing' || e?.phase === 'loading' || e?.phase === 'waiting'
}

/** Stop a voice, and forget it. */
export function stopVoice(key: string): void {
  sessions.set(key, (sessions.get(key) ?? 0) + 1)
  subjects.delete(key)
  if (key.startsWith('world:')) pendingGain.delete(key)
  release(key)
  setEntry(key, null)
}

/** Stop an item's card PLAY. */
export function stopAudio(itemKey: string): void {
  stopVoice(cardKey(itemKey))
}

function failWith(err: unknown): string {
  const name = (err as { name?: string })?.name
  if (name === 'NotAllowedError') return 'The browser held the sound back. Tap PLAY again.'
  if (name === 'NotSupportedError') return 'This browser cannot play this kind of file. DOWNLOAD it instead.'
  return err instanceof Error && err.message ? err.message : 'The file could not be played.'
}

/**
 * An element for a file, wired to end and fail as one voice. A world
 * voice's element that fails, at any moment (a file this browser cannot
 * decode fails as it loads, even while the voice waits for a tap), is a
 * failure of the item and waits out its pause (worldFailure).
 */
function element(key: string, mine: number, url: string, loop: boolean, title: string, mode: VoiceMode, itemKey: string, onEnded: () => void): HTMLAudioElement {
  const el = new Audio()
  el.loop = loop
  el.preload = 'auto'
  el.src = url
  el.addEventListener('ended', () => { if (sessions.get(key) === mine) onEnded() })
  el.addEventListener('error', () => {
    if (sessions.get(key) !== mine) return
    if (mode === 'world') { worldFailure(itemKey, new Error('This browser cannot play this kind of file.')); return }
    release(key)
    setEntry(key, { phase: 'error', title, mode, itemKey, error: 'This browser cannot play this kind of file. DOWNLOAD it instead.' })
  })
  return el
}

/**
 * A voice's play: start the element (inside a tap when called from one),
 * then it sounds; refused for want of a tap, it waits for one; anything
 * else is a failure. `onStarted` runs the first time it really sounds.
 */
function playerOf(key: string, mine: number, el: HTMLAudioElement, entry: Omit<AudioEntry, 'phase'>, routed: boolean, onStarted: (() => void) | undefined, onFailed: (err: unknown) => void): () => void {
  let started = false
  return () => {
    if (sessions.get(key) !== mine) return
    let p: Promise<void>
    try { p = el.play() } catch (err) { onFailed(err); return }
    void Promise.resolve(p).then(() => {
      if (sessions.get(key) !== mine) return
      waitingPlays.delete(key)
      armGesture()
      // An element playing into a context the browser still holds back is not
      // heard: it is paused where it is, and picks up there when sound is back.
      if (routed && !audioRunning()) { el.pause(); waitForTap(key); return }
      setEntry(key, { ...entry, phase: 'playing' })
      // It sounds: whatever failed before is forgiven.
      if (entry.mode === 'world') failures.delete(entry.itemKey)
      if (!started) { started = true; onStarted?.() }
    }, (err: unknown) => {
      if (sessions.get(key) !== mine) return
      if ((err as { name?: string })?.name === 'NotAllowedError') { waitForTap(key); return }
      onFailed(err)
    })
  }
}

/**
 * Play an item from its card, from a tap: the file as it is, not placed in
 * space. Its file is fetched and decrypted the first time; a play already
 * going is started over. It plays on when the card closes; NOW PLAYING
 * stops it.
 */
export async function playAudio(itemKey: string, audio: AudioItem, who?: MuteSubject): Promise<void> {
  if (typeof Audio === 'undefined') return
  const key = cardKey(itemKey)
  const mine = (sessions.get(key) ?? 0) + 1
  sessions.set(key, mine)
  release(key)
  if (who) subjects.set(key, who)
  // In the tap itself, before any await: the browser lets sound out now.
  const l = audioListener()
  resumeAudio()
  setEntry(key, { phase: 'loading', title: audio.title, mode: 'card', itemKey })
  try {
    const blob = await openAudio(audio)
    if (sessions.get(key) !== mine) return
    const url = URL.createObjectURL(blob)
    const el = element(key, mine, url, audio.loop, audio.title, 'card', itemKey, () => stopVoice(key))
    let node: ThreeAudio<GainNode> | null = null
    if (l) {
      try {
        node = new ThreeAudio(l)
        node.setMediaElementSource(el)
      } catch { node = null }
    }
    const entry = { title: audio.title, mode: 'card' as const, itemKey }
    const play = playerOf(key, mine, el, entry, node !== null, undefined, (err) => {
      release(key)
      setEntry(key, { ...entry, phase: 'error', error: failWith(err) })
    })
    voices.set(key, { el, url, node, play, pause: () => el.pause() })
    play()
  } catch (err) {
    if (sessions.get(key) !== mine) return
    release(key)
    setEntry(key, { phase: 'error', title: audio.title, mode: 'card', itemKey, error: failWith(err) })
  }
}

/**
 * Start an item sounding where it is hidden: a positional voice, silent
 * until its gain is set (setWorldGain). It waits for the browser to let
 * sound out if it must. `onStarted` runs once it really sounds: a one-shot's
 * once-trigger is marked fired then, not when it would have been heard.
 */
export async function startWorld(itemKey: string, audio: AudioItem, onStarted?: () => void, who?: MuteSubject): Promise<void> {
  if (typeof Audio === 'undefined') return
  const l = audioListener()
  if (!l) return
  const key = worldKey(itemKey)
  const mine = (sessions.get(key) ?? 0) + 1
  sessions.set(key, mine)
  release(key)
  if (who) subjects.set(key, who)
  setEntry(key, { phase: 'loading', title: audio.title, mode: 'world', itemKey })
  try {
    const blob = await openAudio(audio)
    if (sessions.get(key) !== mine) return
    // A short loop is decoded whole and played from a buffer: no gap at its
    // seam, and a buffer needs no tap of its own once sound is out. Short in
    // TIME, not bytes: a tiny file can be a long one (review of #468), so its
    // length is read first, and a decode that comes out large anyway streams.
    const buffer = audio.loop && blob.size <= DECODE_WHOLE_BYTES ? await shortLoopBuffer(blob) : null
    if (sessions.get(key) !== mine) return
    if (buffer) {
      const node = new PositionalAudio(l)
      node.setRolloffFactor(0)
      node.setBuffer(buffer)
      node.setLoop(audio.loop)
      node.setVolume(pendingGain.get(key) ?? 0)
      // A one-shot that reaches its end is let go, as an element's 'ended' does.
      const ended = node.onEnded.bind(node)
      node.onEnded = () => { ended(); if (sessions.get(key) === mine) stopVoice(key) }
      const entry = { title: audio.title, mode: 'world' as const, itemKey }
      let started = false
      const play = (): void => {
        if (sessions.get(key) !== mine) return
        if (!audioRunning()) { waitForTap(key); return }
        if (!node.isPlaying) node.play()
        waitingPlays.delete(key)
        armGesture()
        setEntry(key, { ...entry, phase: 'playing' })
        failures.delete(itemKey)
        if (!started) { started = true; onStarted?.() }
      }
      voices.set(key, { node, play, pause: () => { if (node.isPlaying) node.pause() } })
      if (audioRunning()) play()
      else waitForTap(key)
      return
    }
    const url = URL.createObjectURL(blob)
    let el: HTMLAudioElement
    let node: PositionalAudio
    try {
      el = element(key, mine, url, audio.loop, audio.title, 'world', itemKey, () => stopVoice(key))
      node = new PositionalAudio(l)
      // How loud is the region's fade, on the gain; the panner only places it.
      node.setRolloffFactor(0)
      node.setMediaElementSource(el)
      node.setVolume(pendingGain.get(key) ?? 0)
    } catch (err) {
      URL.revokeObjectURL(url)
      throw err
    }
    const entry = { title: audio.title, mode: 'world' as const, itemKey }
    const play = playerOf(key, mine, el, entry, true, onStarted, (err) => worldFailure(itemKey, err))
    voices.set(key, { el, url, node, play, pause: () => el.pause() })
    if (audioRunning()) play()
    else waitForTap(key)
  } catch (err) {
    if (sessions.get(key) !== mine) return
    worldFailure(itemKey, err)
  }
}

/**
 * When a loop is decoded whole (lib/audioWorld's loudest few sound at once,
 * each decoded loop held while it plays): its file at most this size
 * (decrypted), at most DECODE_WHOLE_SECONDS long by its own metadata, and
 * at most DECODE_WHOLE_MAX_PCM bytes and two channels once decoded. Anything
 * else streams. So the most a decoded loop can hold is the PCM budget, never
 * what a long, low-bitrate file would decode to.
 */
export const DECODE_WHOLE_BYTES = 1024 * 1024
export const DECODE_WHOLE_SECONDS = 60
export const DECODE_WHOLE_MAX_PCM = 32 * 1024 * 1024

/** How long a file is, by its metadata, read from an element (cheap: nothing is decoded); null when it cannot tell in a few seconds. */
export function probeDuration(blob: Blob, waitMs = 3000): Promise<number | null> {
  if (typeof Audio === 'undefined') return Promise.resolve(null)
  const url = URL.createObjectURL(blob)
  const el = new Audio()
  return new Promise<number | null>((resolve) => {
    let done = false
    const finish = (d: number | null): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      el.removeAttribute('src')
      URL.revokeObjectURL(url)
      resolve(d)
    }
    const timer = setTimeout(() => finish(null), waitMs)
    el.addEventListener('loadedmetadata', () => finish(Number.isFinite(el.duration) ? el.duration : null))
    el.addEventListener('error', () => finish(null))
    el.preload = 'metadata'
    el.src = url
  })
}

/** Whether a decoded buffer is within budget: two channels at most, DECODE_WHOLE_MAX_PCM bytes at most. */
export function decodedFits(b: Pick<AudioBuffer, 'length' | 'numberOfChannels'>): boolean {
  return b.numberOfChannels <= 2 && b.length * b.numberOfChannels * 4 <= DECODE_WHOLE_MAX_PCM
}

/**
 * A short loop's decoded buffer, or null to stream it: too long by its
 * metadata (or its length unknown), or too large once decoded. Throws when
 * the browser cannot decode it at all.
 */
async function shortLoopBuffer(blob: Blob): Promise<AudioBuffer | null> {
  const seconds = await probeDuration(blob)
  if (seconds === null || seconds > DECODE_WHOLE_SECONDS) return null
  const buffer = await decodeWhole(blob)
  return decodedFits(buffer) ? buffer : null
}

/** Decode a file into a buffer on the shared context; the callback form, which every Safari has. Throws when it cannot. */
function decodeWhole(blob: Blob): Promise<AudioBuffer> {
  const ctx = audioContext()
  if (!ctx) return Promise.reject(new Error('No audio here.'))
  return blob.arrayBuffer().then((bytes) => new Promise<AudioBuffer>((resolve, reject) => {
    const p = ctx.decodeAudioData(bytes, resolve, () => reject(new Error('This browser cannot play this kind of file.')))
    // Where it also answers with a promise, its refusal is the callback's.
    if (p && typeof (p as Promise<AudioBuffer>).catch === 'function') (p as Promise<AudioBuffer>).catch(() => { /* told by the callback */ })
  }))
}

/** Failed world items: how many times in a row, and until when they are not tried again (ms, performance clock). */
const failures = new Map<string, { count: number; until: number }>()
/** The first pause after a failure, ms; each further failure in a row waits four times as long, up to RETRY_MAX_MS. */
const RETRY_MS = 15_000
const RETRY_MAX_MS = 10 * 60_000

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

/** A world voice failed: let it go, and do not try the item again for a while. */
export function worldFailure(itemKey: string, err: unknown): void {
  void err
  const key = worldKey(itemKey)
  const was = failures.get(itemKey)
  const count = (was?.count ?? 0) + 1
  failures.set(itemKey, { count, until: nowMs() + Math.min(RETRY_MAX_MS, RETRY_MS * 4 ** (count - 1)) })
  stopVoice(key)
}

/** Whether a world item failed and is waiting out its pause: the scene does not plan it until then. */
export function worldFailed(itemKey: string, now = nowMs()): boolean {
  const f = failures.get(itemKey)
  return !!f && now < f.until
}

/** The gain a voice still loading should start at. */
const pendingGain = new Map<string, number>()

/** How loud a world voice is, 0 to 1, eased so a step across a wall is not a click. */
export function setWorldGain(itemKey: string, gain: number): void {
  const key = worldKey(itemKey)
  pendingGain.set(key, gain)
  const v = voices.get(key)
  const ctx = audioContext()
  if (!v?.node || !ctx) return
  v.node.gain.gain.setTargetAtTime(Math.max(0, Math.min(1, gain)), ctx.currentTime, 0.08)
}

/** How loud a world voice was last asked to be, or null when it has none (tests and the browser check). */
export function worldGainOf(itemKey: string): number | null {
  return pendingGain.get(worldKey(itemKey)) ?? null
}

/** Where a world voice is in the scene. */
export function placeWorld(itemKey: string, at: readonly [number, number, number]): void {
  const v = voices.get(worldKey(itemKey))
  if (!v?.node) return
  v.node.position.set(at[0], at[1], at[2])
  v.node.updateMatrixWorld(true)
}

/** Stop an item sounding in the world. */
export function stopWorld(itemKey: string): void {
  stopVoice(worldKey(itemKey))
}

/** The items with a world voice: starting, waiting for a tap, or sounding. */
export function worldVoices(): Set<string> {
  const out = new Set<string>()
  for (const e of Object.values(useHiddenAudio.getState().entries)) if (e.mode === 'world' && e.phase !== 'error') out.add(e.itemKey)
  return out
}

/** The items whose world voice has not sounded yet: still loading, or waiting for a tap. */
export function worldPending(): Set<string> {
  const out = new Set<string>()
  for (const e of Object.values(useHiddenAudio.getState().entries)) if (e.mode === 'world' && (e.phase === 'loading' || e.phase === 'waiting')) out.add(e.itemKey)
  return out
}

/** Whether the world wants TV's music stepped down (scene/HiddenAudio). */
let worldDuck = false

/** The world's half of TV ducking; a card's PLAY is the other, and ducks even with the scene away (TV on). */
export function setWorldDuck(on: boolean): void {
  worldDuck = on
  duckFor()
}

function duckFor(): void {
  duckMusic(worldDuck || cardSounding() ? DUCKED : 1)
}

const offDuck = useHiddenAudio.subscribe(duckFor)
if (import.meta.hot) import.meta.hot.dispose(() => offDuck())

/** Whether any card's PLAY is sounding. */
export function cardSounding(): boolean {
  return Object.values(useHiddenAudio.getState().entries).some((e) => e.mode === 'card' && e.phase === 'playing')
}

/** Save the decrypted file. Resolves to an error sentence, or null when the save began. */
export async function downloadAudio(audio: AudioItem): Promise<string | null> {
  try {
    const blob = await openAudio(audio)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = audioFileName(audio)
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
    // The save has the bytes by the next task; a minute is generous.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    return null
  } catch (err) {
    return err instanceof Error && err.message ? err.message : 'The file could not be saved.'
  }
}

/** Stop everything (tests). */
export function stopAllAudio(): void {
  for (const key of [...voices.keys(), ...Object.keys(useHiddenAudio.getState().entries)]) stopVoice(key)
  pendingGain.clear()
  failures.clear()
}
