/**
 * useHiddenAudio.ts: hidden audio playing, and what is playing (DECK-0007).
 *
 * One place for every sound a hidden item makes, so the card's PLAY, the
 * world's sources (spatial playback, the next step) and the NOW PLAYING list
 * all read and drive the same thing: one entry per item, by its world key.
 *
 * The card's PLAY is the file as it is, not placed in space: a tap, which a
 * browser lets sound start in, decrypts the file (lib/audioFile openAudio)
 * and plays it through a plain audio element, as Cyberspace TV's music plays
 * (useTvMusic). It loops when the item loops, and ends by itself otherwise.
 * DOWNLOAD saves the decrypted file under the item's title.
 */

import { create } from 'zustand'
import { openAudio } from '../lib/audioFile'
import { audioFileName, type AudioItem } from '../lib/audioItem'

export type AudioPhase = 'loading' | 'playing' | 'error'

export interface AudioEntry {
  phase: AudioPhase
  title: string
  /** Why it failed, for the card. */
  error?: string
}

interface HiddenAudioState {
  /** By world item key. Absent: silent. */
  entries: Record<string, AudioEntry>
}

export const useHiddenAudio = create<HiddenAudioState>(() => ({ entries: {} }))

const elements = new Map<string, { el: HTMLAudioElement; url: string }>()
/** Changes on every play and stop of a key: what an answer for an older one is ignored by. */
const sessions = new Map<string, number>()

function setEntry(key: string, entry: AudioEntry | null): void {
  const entries = { ...useHiddenAudio.getState().entries }
  if (entry) entries[key] = entry
  else delete entries[key]
  useHiddenAudio.setState({ entries })
}

function release(key: string): void {
  const held = elements.get(key)
  if (!held) return
  elements.delete(key)
  held.el.pause()
  held.el.removeAttribute('src')
  held.el.load()
  URL.revokeObjectURL(held.url)
}

/** Whether an item is sounding, or about to. */
export function isPlaying(key: string): boolean {
  const e = useHiddenAudio.getState().entries[key]
  return e?.phase === 'playing' || e?.phase === 'loading'
}

/** Stop an item, and forget it. */
export function stopAudio(key: string): void {
  sessions.set(key, (sessions.get(key) ?? 0) + 1)
  release(key)
  setEntry(key, null)
}

/**
 * Play an item from the start, from a tap. Its file is fetched and
 * decrypted the first time; a play already going is started over.
 */
export async function playAudio(key: string, audio: AudioItem): Promise<void> {
  if (typeof Audio === 'undefined') return
  const mine = (sessions.get(key) ?? 0) + 1
  sessions.set(key, mine)
  release(key)
  setEntry(key, { phase: 'loading', title: audio.title })
  try {
    const blob = await openAudio(audio)
    if (sessions.get(key) !== mine) return
    const url = URL.createObjectURL(blob)
    const el = new Audio()
    el.loop = audio.loop
    el.preload = 'auto'
    el.src = url
    elements.set(key, { el, url })
    el.addEventListener('ended', () => { if (sessions.get(key) === mine) stopAudio(key) })
    el.addEventListener('error', () => {
      if (sessions.get(key) !== mine) return
      release(key)
      setEntry(key, { phase: 'error', title: audio.title, error: 'This browser cannot play this kind of file. DOWNLOAD it instead.' })
    })
    setEntry(key, { phase: 'playing', title: audio.title })
    await el.play()
  } catch (err) {
    if (sessions.get(key) !== mine) return
    release(key)
    const name = (err as { name?: string })?.name
    const error = name === 'NotAllowedError'
      ? 'The browser held the sound back. Tap PLAY again.'
      : name === 'NotSupportedError'
        ? 'This browser cannot play this kind of file. DOWNLOAD it instead.'
        : err instanceof Error && err.message ? err.message : 'The file could not be played.'
    setEntry(key, { phase: 'error', title: audio.title, error })
  }
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
  for (const key of [...elements.keys(), ...Object.keys(useHiddenAudio.getState().entries)]) stopAudio(key)
}
