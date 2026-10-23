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
 * A world voice that would start while the browser still holds sound back
 * waits (phase `waiting`), and the TAP FOR SOUND chip says so; the first tap
 * or key anywhere lets them all out. A card's PLAY is itself a tap.
 *
 * Where there is no Web Audio at all, a card still plays its file through
 * the element alone, and nothing sounds in the world.
 */

import { create } from 'zustand'
import { Audio as ThreeAudio, AudioContext as ThreeAudioContext, AudioListener, PositionalAudio, type Camera } from 'three'
import { openAudio } from '../lib/audioFile'
import { audioFileName, type AudioItem } from '../lib/audioItem'
import { audioContext, audioRunning, onAudioContext, resumeAudio, wantSound } from '../lib/audioContext'
import { hidesThing } from '../lib/muteList'
import { useMutes } from './useMutes'
import { useCyberspace } from './useCyberspace'

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
  el: HTMLAudioElement
  url: string
  node: ThreeAudio<GainNode | PannerNode> | null
  offContext?: () => void
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

useMutes.subscribe((s, prev) => { if (s.muted !== prev.muted) stopMutedVoices() })

/**
 * World voices follow the context: one that sounded when the browser (or
 * the phone, for a call or the lock screen) suspended sound is waiting
 * again, so TAP FOR SOUND and NOW PLAYING say so, and the next tap lets it
 * out; resumed, what was still going reads as playing again.
 */
export function syncVoicePhases(): void {
  const running = audioRunning()
  for (const [key, v] of voices) {
    const e = useHiddenAudio.getState().entries[key]
    if (!e || e.mode !== 'world') continue
    if (!running && e.phase === 'playing') { setEntry(key, { ...e, phase: 'waiting' }); wantSound() }
    else if (running && e.phase === 'waiting' && !v.el.paused) setEntry(key, { ...e, phase: 'playing' })
  }
}

onAudioContext(syncVoicePhases)
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
  const v = voices.get(key)
  if (!v) return
  voices.delete(key)
  v.offContext?.()
  v.el.pause()
  try { v.node?.disconnect() } catch { /* already apart */ }
  v.el.removeAttribute('src')
  v.el.load()
  URL.revokeObjectURL(v.url)
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

/** An element for a file, wired to end and fail as one voice. */
function element(key: string, mine: number, url: string, loop: boolean, title: string, mode: VoiceMode, itemKey: string, onEnded: () => void): HTMLAudioElement {
  const el = new Audio()
  el.loop = loop
  el.preload = 'auto'
  el.src = url
  el.addEventListener('ended', () => { if (sessions.get(key) === mine) onEnded() })
  el.addEventListener('error', () => {
    if (sessions.get(key) !== mine) return
    release(key)
    setEntry(key, { phase: 'error', title, mode, itemKey, error: 'This browser cannot play this kind of file. DOWNLOAD it instead.' })
  })
  return el
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
    voices.set(key, { el, url, node })
    setEntry(key, { phase: 'playing', title: audio.title, mode: 'card', itemKey })
    await el.play()
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
    const url = URL.createObjectURL(blob)
    const el = element(key, mine, url, audio.loop, audio.title, 'world', itemKey, () => stopVoice(key))
    const node = new PositionalAudio(l)
    // How loud is the region's fade, on the gain; the panner only places it.
    node.setRolloffFactor(0)
    node.setMediaElementSource(el)
    node.setVolume(pendingGain.get(key) ?? 0)
    const voice: Voice = { el, url, node }
    voices.set(key, voice)
    const go = (): void => {
      if (sessions.get(key) !== mine || !audioRunning()) return
      voice.offContext?.()
      voice.offContext = undefined
      setEntry(key, { phase: 'playing', title: audio.title, mode: 'world', itemKey })
      void el.play().then(() => onStarted?.(), (err: unknown) => {
        if (sessions.get(key) !== mine) return
        // Still held back: wait for the next tap.
        if ((err as { name?: string })?.name === 'NotAllowedError') { setEntry(key, { phase: 'waiting', title: audio.title, mode: 'world', itemKey }); wait() ; return }
        release(key)
        setEntry(key, { phase: 'error', title: audio.title, mode: 'world', itemKey, error: failWith(err) })
      })
    }
    const wait = (): void => {
      wantSound()
      voice.offContext?.()
      voice.offContext = onAudioContext(go)
    }
    if (audioRunning()) go()
    else { setEntry(key, { phase: 'waiting', title: audio.title, mode: 'world', itemKey }); wait() }
  } catch (err) {
    if (sessions.get(key) !== mine) return
    release(key)
    setEntry(key, { phase: 'error', title: audio.title, mode: 'world', itemKey, error: failWith(err) })
  }
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
}
