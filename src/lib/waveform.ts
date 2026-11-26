/**
 * waveform.ts: hidden audio drawn as its own sound (owner, 2026-11-26: "the
 * audio look is amazing from the hidden message looks. lets replace audio
 * with this", direction 7, Voice line).
 *
 * The card's large waveform is the scrubber, and a list's thumbnail is the
 * same waveform small. Both are a row of bars, each the loudest moment in its
 * slice of the file (peaksOf), scaled so the loudest bar is full height.
 *
 * Until a file has been opened on this device its real shape is not known,
 * and nothing is fetched for a list. Its bars are then a quiet pattern made
 * from the file's hash (hashWave), drawn dim, the same every time for the
 * same file, so a list of sounds is not a list of blanks; the card swaps in
 * the real shape once it has it.
 *
 * Pure: no store, no DOM, no audio.
 */

import { hash01, seedOf } from './decode'

/** How many bars the card's waveform has. */
export const WAVE_BARS = 72
/** How many a thumbnail has. */
export const THUMB_BARS = 18
/** The shortest bar, as a share of full height, so silence still draws a line. */
export const WAVE_FLOOR = 0.06

/**
 * The peaks of some channels of samples in `bars` slices: each slice's
 * largest absolute sample across every channel, then all of them scaled so
 * the largest is 1. Silence is a row of WAVE_FLOOR.
 */
export function peaksOf(channels: ReadonlyArray<ArrayLike<number>>, bars: number): number[] {
  const length = channels.reduce((m, c) => Math.max(m, c.length), 0)
  const out = new Array<number>(bars).fill(0)
  if (length === 0 || bars <= 0) return out.map(() => WAVE_FLOOR)
  for (let b = 0; b < bars; b++) {
    const from = Math.floor((b * length) / bars)
    const to = Math.max(from + 1, Math.floor(((b + 1) * length) / bars))
    let peak = 0
    for (const c of channels) {
      // A long slice is sampled, not read whole: 400 looks per bar is plenty for a picture.
      const step = Math.max(1, Math.floor((to - from) / 400))
      for (let i = from; i < to && i < c.length; i += step) {
        const v = Math.abs(c[i])
        if (v > peak) peak = v
      }
    }
    out[b] = peak
  }
  return normalise(out)
}

/** Scaled so the largest is 1, none under WAVE_FLOOR. */
export function normalise(values: readonly number[]): number[] {
  const max = values.reduce((m, v) => Math.max(m, v), 0)
  if (!(max > 0)) return values.map(() => WAVE_FLOOR)
  return values.map((v) => Math.max(WAVE_FLOOR, Math.min(1, v / max)))
}

/** A file's stand-in shape before its real one is known: from its hash, the same every time. */
export function hashWave(hash: string, bars: number): number[] {
  const seed = seedOf(hash)
  const out: number[] = []
  for (let b = 0; b < bars; b++) {
    // A slow swell under a quick flicker, so it reads as sound and not noise.
    const swell = 0.55 + 0.45 * Math.sin((b / bars) * Math.PI * 2 * (1 + hash01(0, seed) * 2) + hash01(1, seed) * 6)
    out.push(0.25 + 0.55 * swell * (0.5 + 0.5 * hash01(b + 7, seed)))
  }
  return normalise(out)
}

/** Fewer bars from more, each the loudest it covers: the card's shape as a thumbnail. */
export function shrinkPeaks(peaks: readonly number[], bars: number): number[] {
  if (peaks.length === 0) return new Array<number>(bars).fill(WAVE_FLOOR)
  const out: number[] = []
  for (let b = 0; b < bars; b++) {
    const from = Math.floor((b * peaks.length) / bars)
    const to = Math.max(from + 1, Math.floor(((b + 1) * peaks.length) / bars))
    let m = 0
    for (let i = from; i < to; i++) m = Math.max(m, peaks[i])
    out.push(m)
  }
  return out
}

/** The time a scrub to `fraction` of the way across lands on, seconds; 0 with no length known. */
export function scrubTime(fraction: number, duration: number): number {
  if (!(duration > 0)) return 0
  return Math.min(duration, Math.max(0, fraction * duration))
}

/** Where a pointer at `x` lands across a waveform from `left` that is `width` wide: 0 to 1. */
export function scrubFraction(x: number, left: number, width: number): number {
  if (!(width > 0)) return 0
  return Math.min(1, Math.max(0, (x - left) / width))
}

/** How many of `bars` are played at `time` of `duration`. */
export function playedBars(time: number, duration: number, bars: number): number {
  if (!(duration > 0)) return 0
  return Math.round(Math.min(1, Math.max(0, time / duration)) * bars)
}

/** A time as a clock: 0:41, 1:58, 1:02:05. Unknown is "-:--". */
export function clockWords(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '-:--'
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}
