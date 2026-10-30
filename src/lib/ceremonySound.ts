/**
 * ceremonySound.ts: the OPEN ceremony's sound and buzz (arkinox,
 * 2026-10-30, sound A: "our own synthesized sounds through the existing
 * audio context ... plus a short haptic via the existing buzz gate; sound
 * and haptic each at most once per 10 s").
 *
 * Synthesised on the spot through the one audio context (lib/audioContext),
 * no asset, nothing copied from any game: for a chest, a lock tick (a short
 * band of noise and a low click), then three rising notes of our own (C5,
 * E5, A5). Quiet, at the chime's gain, and failing silent where there is
 * no audio. The buzz is three short pulses through lib/buzz.ts.
 *
 * Gated across every chest and door together: the sound at most once per
 * CEREMONY_GAP_MS, the buzz at most once per CEREMONY_GAP_MS, so opening
 * ten chests in a row sounds the first and stays quiet until ten seconds
 * have passed. The ceremony's picture is never gated.
 */

import { audioContext } from './audioContext'
import { buzzGate, onceEvery } from './buzz'
import type { CeremonyKind } from './ceremony'

/** The least time between two ceremony sounds, and between two ceremony buzzes. */
export const CEREMONY_GAP_MS = 10_000
/** The buzz: two short pulses and a longer one. */
export const CEREMONY_BUZZ: Record<CeremonyKind, number[]> = { chest: [30, 40, 60], door: [50] }

const sounded = new Map<string, number>()

/** What was let through: the sound and the buzz, each by its own gate. */
export interface Feedback { sound: boolean; buzz: boolean }

/**
 * Sound and buzz for an opening, each only if its gate lets it. Call inside
 * or right after the tap (OPEN), with resumeAudio() already called in the
 * tap, so a phone lets the sound out.
 */
export function ceremonyFeedback(kind: CeremonyKind, now = Date.now()): Feedback {
  const sound = onceEvery(sounded, 'ceremony', now, CEREMONY_GAP_MS)
  if (sound) play(kind)
  const buzz = buzzGate(['ceremony'], now, CEREMONY_GAP_MS, CEREMONY_BUZZ[kind])
  return { sound, buzz }
}

/** For tests: forget when the last sound played. */
export function resetCeremonySound(): void {
  sounded.clear()
}

function play(kind: CeremonyKind): void {
  try {
    const ac = audioContext()
    if (!ac) return
    if (ac.state === 'suspended') void ac.resume()
    if (kind === 'chest') chestOpening(ac, ac.currentTime)
  } catch {
    /* no audio here */
  }
}

/** A short burst of white noise, made once per context. */
const noises = new WeakMap<AudioContext, AudioBuffer>()
function noise(ac: AudioContext): AudioBuffer {
  let b = noises.get(ac)
  if (!b) {
    b = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.5), ac.sampleRate)
    const d = b.getChannelData(0)
    // Deterministic, so the tick is the same tick every time.
    let x = 0x2545f491
    for (let i = 0; i < d.length; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; d[i] = ((x >>> 0) / 4294967296) * 2 - 1 }
    noises.set(ac, b)
  }
  return b
}

/** One enveloped voice: attack to `peak`, then down to nothing by `t0 + length`. */
function envelope(ac: AudioContext, t0: number, peak: number, length: number, attack = 0.008): GainNode {
  const g = ac.createGain()
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + length)
  g.connect(ac.destination)
  return g
}

/** The lock's tick: 60 ms of noise through a narrow band, and a low click under it. */
function lockTick(ac: AudioContext, t0: number): void {
  const src = ac.createBufferSource()
  src.buffer = noise(ac)
  const band = ac.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.setValueAtTime(2600, t0)
  band.Q.setValueAtTime(4, t0)
  src.connect(band)
  band.connect(envelope(ac, t0, 0.12, 0.06, 0.002))
  src.start(t0)
  src.stop(t0 + 0.07)
  const click = ac.createOscillator()
  click.type = 'sine'
  click.frequency.setValueAtTime(190, t0)
  click.frequency.exponentialRampToValueAtTime(90, t0 + 0.04)
  click.connect(envelope(ac, t0, 0.07, 0.05, 0.002))
  click.start(t0)
  click.stop(t0 + 0.06)
}

/** Rising notes, each a sine with a quiet octave above it. */
function notes(ac: AudioContext, t0: number, list: ReadonlyArray<readonly [number, number]>, peak = 0.07): void {
  for (const [freq, at] of list) {
    const g = envelope(ac, t0 + at, peak, 0.32)
    for (const [mul, type] of [[1, 'sine'], [2, 'triangle']] as const) {
      const osc = ac.createOscillator()
      osc.type = type
      osc.frequency.setValueAtTime(freq * mul, t0 + at)
      if (mul === 1) osc.connect(g)
      else { const quiet = ac.createGain(); quiet.gain.setValueAtTime(0.18, t0 + at); osc.connect(quiet); quiet.connect(g) }
      osc.start(t0 + at)
      osc.stop(t0 + at + 0.34)
    }
  }
}

/** A chest opening: the tick at once, then C5, E5, A5 rising from 150 ms over the lid's turn. */
export const CHEST_NOTES: ReadonlyArray<readonly [number, number]> = [[523.25, 0.15], [659.25, 0.33], [880, 0.51]]

function chestOpening(ac: AudioContext, t0: number): void {
  lockTick(ac, t0)
  notes(ac, t0, CHEST_NOTES)
}
