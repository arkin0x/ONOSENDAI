/**
 * useWaveforms.ts: the real shape and length of hidden audio files opened on
 * this device, for the card's waveform scrubber and the lists' thumbnails
 * (lib/waveform.ts; direction 7, Voice line).
 *
 * A shape is made when a card opens on a small file, or after its PLAY has
 * opened a file anyway: the decrypted file (lib/audioFile openAudio, which
 * keeps the few heard last, so a PLAY and the shape share one fetch) is
 * decoded on the app's one audio context (lib/audioContext; arkinox,
 * 2026-10-23: one audio plumbing, never a second context) and its peaks
 * kept here by the file's hash for the rest of the visit. Nothing is fetched
 * for a list.
 *
 * Decoding a file whole allocates all of its samples, so only a file small
 * enough to do that safely on a phone is decoded (WAVE_DECODE_MAX_BYTES, and
 * the decoded size under useHiddenAudio's own cap). A larger one keeps its
 * stand-in shape (lib/waveform hashWave) and learns its length from its PLAY
 * (noteDuration).
 */

import { create } from 'zustand'
import { audioContext } from '../lib/audioContext'
import { openAudio } from '../lib/audioFile'
import type { AudioItem } from '../lib/audioItem'
import { peaksOf, WAVE_BARS } from '../lib/waveform'
import { DECODE_WHOLE_MAX_PCM, isPcmWav, wavDecodedBytes } from './useHiddenAudio'

/** The largest file a shape is decoded for, bytes: about a minute and a half of a typical MP3. */
export const WAVE_DECODE_MAX_BYTES = 1.5 * 1024 * 1024

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

/** Hashes being decoded now, or already tried and failed: never asked twice in a visit. */
const tried = new Set<string>()

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

/** Whether a file of `bytes` (0 when the item does not say) may be decoded for its shape before it is opened. */
export function waveDecodable(bytes: number): boolean {
  return bytes > 0 && bytes <= WAVE_DECODE_MAX_BYTES
}

/**
 * Make a file's shape if it is small enough and not made yet. `opened`: its
 * PLAY has opened the file already, so its size is checked on the bytes and
 * nothing more is fetched.
 */
export function wantWave(audio: Pick<AudioItem, 'url' | 'hash' | 'originalHash' | 'keyHex' | 'nonceHex' | 'mime' | 'size'>, opened = false): void {
  const hash = audio.hash
  if (!hash || tried.has(hash) || useWaveforms.getState().waves[hash]?.peaks.length) return
  if (!opened && !waveDecodable(audio.size)) return
  const ctx = audioContext()
  if (!ctx) return
  tried.add(hash)
  void openAudio(audio)
    .then(async (blob) => {
      if (blob.size > WAVE_DECODE_MAX_BYTES + 16) return
      const bytes = new Uint8Array(await blob.arrayBuffer())
      // A WAV says how large it decodes: one too large for a phone is never decoded.
      if (isPcmWav(bytes) && (wavDecodedBytes(bytes, ctx.sampleRate) ?? Infinity) > DECODE_WHOLE_MAX_PCM) return
      const buffer = await new Promise<AudioBuffer>((resolve, reject) => {
        const p = ctx.decodeAudioData(bytes.buffer.slice(0) as ArrayBuffer, resolve, reject)
        if (p && typeof (p as Promise<AudioBuffer>).catch === 'function') (p as Promise<AudioBuffer>).catch(() => { /* told by the callback */ })
      })
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
  useWaveforms.setState({ waves: {} })
}
