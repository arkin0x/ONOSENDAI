/**
 * WaveBars.tsx: hidden audio as its waveform (owner, 2026-11-26: "the audio
 * look is amazing from the hidden message looks. lets replace audio with
 * this", direction 7, Voice line).
 *
 * - WaveScrubber: the card's large waveform, 64 px tall, which is also where
 *   you are in the file: the played part lit, the rest dim. Tap or drag on it
 *   to move there; with the keyboard, the arrows step five seconds and Home
 *   and End go to either end. It is a slider to a screen reader.
 * - WaveThumb: the same shape small, in the 80px chamfered frame every row
 *   picture wears, for the lists.
 *
 * The shape is the file's own once it has been opened here
 * (store/useWaveforms); before that a quiet stand-in from its hash, drawn
 * dimmer (lib/waveform hashWave).
 */

import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import type { AudioItem } from '../lib/audioItem'
import { clockWords, hashWave, playedBars, scrubFraction, shrinkPeaks, THUMB_BARS, WAVE_BARS } from '../lib/waveform'
import { useWaveforms } from '../store/useWaveforms'
import { Chamfer, THUMB_PX } from './ui/Chamfer'

/** A file's shape as far as it is known: its own peaks, or the stand-in, and its length (0 unknown). */
export function useWave(audio: Pick<AudioItem, 'hash'>, bars: number = WAVE_BARS): { peaks: number[]; real: boolean; duration: number } {
  const wave = useWaveforms((s) => s.waves[audio.hash])
  const real = !!wave && wave.peaks.length > 0
  const peaks = real ? (bars === wave.peaks.length ? wave.peaks : shrinkPeaks(wave.peaks, bars)) : hashWave(audio.hash, bars)
  return { peaks, real, duration: wave?.duration ?? 0 }
}

/** The bars, as spans: `played` of them lit. */
function Bars({ peaks, played, className }: { peaks: readonly number[]; played: number; className: string }): JSX.Element {
  return (
    <span className={className} aria-hidden="true">
      {peaks.map((p, i) => <i key={i} className={i < played ? 'is-on' : undefined} style={{ height: `${Math.round(p * 100)}%` }} />)}
    </span>
  )
}

/** How far the arrow keys move, seconds. */
const KEY_STEP_S = 5

export function WaveScrubber({ peaks, real, time, duration, onSeek, label }: {
  peaks: readonly number[]
  real: boolean
  /** Where it is, seconds. */
  time: number
  /** How long it is, seconds; 0 while not known. */
  duration: number
  /** Move to this share of the way through, 0 to 1. */
  onSeek: (fraction: number) => void
  label: string
}): JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const at = (e: PointerEvent): number => {
    const r = box.current?.getBoundingClientRect()
    return r ? scrubFraction(e.clientX, r.left, r.width) : 0
  }
  const down = (e: PointerEvent<HTMLDivElement>): void => {
    dragging.current = true
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* a synthetic event has no pointer to capture */ }
    onSeek(at(e))
  }
  const move = (e: PointerEvent<HTMLDivElement>): void => { if (dragging.current) onSeek(at(e)) }
  const up = (): void => { dragging.current = false }
  const key = (e: KeyboardEvent): void => {
    if (!(duration > 0)) return
    const step = KEY_STEP_S / duration
    const now = time / duration
    const to = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? now + step
      : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? now - step
        : e.key === 'Home' ? 0 : e.key === 'End' ? 1 : null
    if (to === null) return
    e.preventDefault()
    onSeek(Math.min(1, Math.max(0, to)))
  }
  return (
    <div
      ref={box}
      className={`wave${real ? '' : ' wave--standin'}`}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(time)}
      aria-valuetext={`${clockWords(time)} of ${clockWords(duration > 0 ? duration : null)}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
    >
      <Bars peaks={peaks} played={playedBars(time, duration, peaks.length)} className="wave__bars" />
    </div>
  )
}

/** A sound's waveform as a row's picture. */
export function WaveThumb({ audio, size = THUMB_PX }: { audio: Pick<AudioItem, 'hash'>; size?: number }): JSX.Element {
  const { peaks, real } = useWave(audio, THUMB_BARS)
  return (
    <Chamfer className={`itemthumb wavethumb${real ? '' : ' wavethumb--standin'}`} size={size}>
      <Bars peaks={peaks} played={0} className="wavethumb__bars" />
    </Chamfer>
  )
}
