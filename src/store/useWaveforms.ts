/**
 * useWaveforms.ts: the real shape and length of hidden audio files opened on
 * this device, for the card's waveform scrubber and the lists' thumbnails
 * (lib/waveform.ts; direction 7, Voice line).
 *
 * Two ways to the real shape, neither of which fetches anything for a list:
 *
 * - A file small enough to decode whole safely (useHiddenAudio
 *   decodeForShape: the same byte budget and the same one-at-a-time queue as
 *   a short loop, on the app's one audio context; arkinox, 2026-10-23: one
 *   audio plumbing, never a second context) is decoded when its card opens
 *   and its item says it is that small, or once its PLAY has opened it.
 * - Any other file is drawn as it is heard: while its card plays, the card
 *   hands in how loud it is and where (noteLevel), each bar keeps the loudest
 *   moment heard in its slice, and once nearly every bar has been heard the
 *   shape is the file's own (HEARD_ENOUGH).
 *
 * Until then a file wears its stand-in (lib/waveform hashWave). Shapes are
 * kept by the file's hash for the rest of the visit.
 */

import { create } from 'zustand'
import { openAudio } from '../lib/audioFile'
import type { AudioItem } from '../lib/audioItem'
import { normalise, peaksOf, WAVE_BARS, WAVE_FLOOR } from '../lib/waveform'
import { decodeForShape, DECODE_WHOLE_BYTES, DECODE_WHOLE_WAV_BYTES } from './useHiddenAudio'

/** The share of bars that must have been heard before a heard shape is shown as the file's own. */
export const HEARD_ENOUGH = 0.9

export interface Wave {
  /** WAVE_BARS peaks, 0 to 1, or empty while only the length is known. */
  peaks: number[]
  /** Seconds, or 0 while not known. */
  duration: number
}

interface WaveformsState {
  /** By the file's hash (AudioItem hash). */
  waves: Record<string, Wave>
}

export const useWaveforms = create<WaveformsState>(() => ({ waves: {} }))

/** Hashes decoded, being decoded, or tried and failed: never asked twice in a visit. */
const tried = new Set<string>()
/** Per hash, the loudest level heard in each bar's slice so far; -1 not heard yet. */
const heard = new Map<string, number[]>()

/** Keep a file's shape and length. */
export function setWave(hash: string, peaks: number[], duration: number): void {
  useWaveforms.setState((s) => ({ waves: { ...s.waves, [hash]: { peaks, duration } } }))
}

/** A file's length, learnt from its PLAY: kept beside a shape it may already have. */
export function noteDuration(hash: string, duration: number): void {
  if (!(duration > 0) || !Number.isFinite(duration)) return
  const was = useWaveforms.getState().waves[hash]
  if (was && Math.abs(was.duration - duration) < 0.05) return
  setWave(hash, was?.peaks ?? [], duration)
}

/**
 * How loud the file is at `fraction` of the way through, heard while its
 * card plays. Once HEARD_ENOUGH of the bars have been heard, the shape is
 * the heard one, its gaps filled from their neighbours.
 */
export function noteLevel(hash: string, fraction: number, level: number, duration: number): void {
  if (!hash || !(fraction >= 0) || fraction > 1 || !(level >= 0)) return
  if (useWaveforms.getState().waves[hash]?.peaks.length) return
  const bars = heard.get(hash) ?? new Array<number>(WAVE_BARS).fill(-1)
  heard.set(hash, bars)
  const b = Math.min(WAVE_BARS - 1, Math.floor(fraction * WAVE_BARS))
  bars[b] = Math.max(bars[b], level)
  const known = bars.filter((v) => v >= 0).length
  if (known / WAVE_BARS < HEARD_ENOUGH) return
  setWave(hash, heardShape(bars), duration)
  heard.delete(hash)
}

/** A heard shape with its unheard bars filled from the nearest heard ones, scaled so the loudest is full height. */
export function heardShape(bars: readonly number[]): number[] {
  const filled = bars.map((v, i) => {
    if (v >= 0) return v
    for (let d = 1; d < bars.length; d++) {
      const l = bars[i - d], r = bars[i + d]
      if (l !== undefined && l >= 0) return l
      if (r !== undefined && r >= 0) return r
    }
    return WAVE_FLOOR
  })
  return normalise(filled)
}

/**
 * Whether a file of `bytes` (0 when the item does not say) and type `mime`
 * is small enough to be opened for its shape before it is played: the
 * budget decodeForShape holds it to, so nothing is fetched that would not be
 * decoded (a WAV up to DECODE_WHOLE_WAV_BYTES, anything else up to DECODE_WHOLE_BYTES).
 */
export function waveDecodable(bytes: number, mime = ''): boolean {
  const cap = /wav/i.test(mime) ? DECODE_WHOLE_WAV_BYTES : DECODE_WHOLE_BYTES
  return bytes > 0 && bytes <= cap
}

/**
 * Make a file's shape by decoding it whole, if it is small enough and not
 * made yet. `opened`: its PLAY has opened the file already, so nothing more
 * is fetched and its own bytes decide.
 */
export function wantWave(audio: Pick<AudioItem, 'url' | 'hash' | 'originalHash' | 'keyHex' | 'nonceHex' | 'mime' | 'size'>, opened = false): void {
  const hash = audio.hash
  if (!hash || tried.has(hash) || useWaveforms.getState().waves[hash]?.peaks.length) return
  if (!opened && !waveDecodable(audio.size, audio.mime)) return
  tried.add(hash)
  void openAudio(audio)
    .then(async (blob) => {
      // Past the largest file decoded whole, its bytes are not even read.
      if (blob.size > DECODE_WHOLE_WAV_BYTES) return
      const buffer = await decodeForShape(blob, new Uint8Array(await blob.arrayBuffer()))
      // Too large to decode whole: it is drawn as it is heard instead (noteLevel).
      if (!buffer) return
      const channels: Float32Array[] = []
      for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c))
      setWave(hash, peaksOf(channels, WAVE_BARS), buffer.duration)
    })
    // No shape: the stand-in stays. The card's PLAY says why a file will not open.
    .catch(() => undefined)
}

/** Forget every shape (tests). */
export function forgetWaves(): void {
  tried.clear()
  heard.clear()
  useWaveforms.setState({ waves: {} })
}
