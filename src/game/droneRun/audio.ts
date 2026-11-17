/**
 * audio.ts - DRONE RUN's sounds: short synth blips through the app's one
 * audio context (lib/audioContext; arkinox's ruling, one audio plumbing),
 * no files, nothing copied from any game.
 *
 * Each is under 300 ms except the clear chime, and quiet: at or under the
 * message chime's gain (lib/chime.ts). Silent when the game's own sound is
 * off (M, the speaker on the HUD; this device, localStorage) or when MUTE
 * ALL is on (store/useSoundMutes, NOW PLAYING's switch over the sounds
 * placed in the world). Fails silent where there is no Web Audio.
 *
 * | Sound | What it is |
 * |---|---|
 * | shot 0 (PULSE RIFLE) | a square blip falling 900 to 260 Hz, 80 ms |
 * | shot 1 (ARC SCATTER) | a band of noise round 1.4 kHz over a low thump, 160 ms |
 * | shot 2 (CHARGE RAIL) | a saw falling 1.8 kHz to 140 Hz with a bright tick, 240 ms; louder with more charge |
 * | hurt | a low sine thud 130 to 45 Hz with dull noise, 220 ms |
 * | overheat | high noise, fading, 280 ms |
 * | reload | two clicks 90 ms apart |
 * | wave | two rising square notes, 260 ms |
 * | clear | four rising sine notes (C5 E5 G5 C6), 700 ms |
 * | fail | a triangle falling 330 to 140 Hz, 290 ms |
 *
 * A bullet landing on a drone (the hitmarker), the kill shot and every
 * control's press are clicks.ts.
 *
 * Every sound goes out through one gain (gameBus), which the mutes close.
 * The drones' own voices, placed where each drone flies, are droneVoices.ts
 * and go out through the same gain.
 *
 * Ledger class (c), client: sounds are this client's own.
 */

import { create } from 'zustand'
import { audioContext, wantSound } from '../../lib/audioContext'
import { useSoundMutes } from '../../store/useSoundMutes'

export type DroneSound = 'shot' | 'hurt' | 'overheat' | 'reload' | 'wave' | 'clear' | 'fail'

const MUTE_KEY = 'onosendai:drone-run:muted'

function loadMuted(): boolean {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(MUTE_KEY) === '1' } catch { return false }
}

/** The game's own sound switch: off is remembered on this device. */
export const useDroneRunSound = create<{ muted: boolean }>(() => ({ muted: loadMuted() }))

export function toggleDroneRunSound(): void {
  const muted = !useDroneRunSound.getState().muted
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0') } catch { /* private mode */ }
  useDroneRunSound.setState({ muted })
}

/** Whether the game's sounds are silent now: its own switch, or MUTE ALL. */
export function droneRunSilent(): boolean {
  return useDroneRunSound.getState().muted || useSoundMutes.getState().master
}

/** The sound may start: the context is made, and the next tap or key lets it out (lib/audioContext). */
export function warmSound(): void {
  if (!droneRunSilent()) wantSound()
}

/** Seconds since each sound last played, so eight pellets of one pull are one shot and one tick. */
const lastAt = new Map<string, number>()
/** The least gap between two of the same sound, seconds. */
const REPEAT_GAP_S = 0.03

let noise: { ctx: BaseAudioContext; buf: AudioBuffer } | null = null
/** Two seconds of white noise per context: the one-shots' hiss, and the drones' looped rotor wash (long enough that its loop is not heard). */
export function noiseBuffer(ac: BaseAudioContext): AudioBuffer {
  if (noise?.ctx === ac) return noise.buf
  const len = Math.floor(ac.sampleRate * 2)
  const buf = ac.createBuffer(1, len, ac.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  noise = { ctx: ac, buf }
  return buf
}

/** A gain envelope: up to `peak` in `attack`, down to silence by `end` (seconds from t0), into `to`. */
function env(ac: BaseAudioContext, to: AudioNode, t0: number, peak: number, attack: number, end: number): GainNode {
  const g = ac.createGain()
  // Silent until t0, not at a gain's default of 1 (a source a sample early through a filter is a loud click).
  g.gain.value = 0
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + end)
  g.connect(to)
  return g
}

function tone(ac: BaseAudioContext, to: AudioNode, t0: number, type: OscillatorType, f0: number, f1: number, dur: number, peak: number): void {
  const g = env(ac, to, t0, peak, 0.005, dur)
  const o = ac.createOscillator()
  o.type = type
  o.frequency.setValueAtTime(f0, t0)
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur)
  o.connect(g)
  o.start(t0)
  o.stop(t0 + dur + 0.02)
}

function hiss(ac: BaseAudioContext, to: AudioNode, t0: number, filter: BiquadFilterType, f0: number, f1: number, dur: number, peak: number, q = 1): void {
  const g = env(ac, to, t0, peak, 0.004, dur)
  const f = ac.createBiquadFilter()
  f.type = filter
  f.Q.value = q
  f.frequency.setValueAtTime(f0, t0)
  if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t0 + dur)
  f.connect(g)
  const s = ac.createBufferSource()
  s.buffer = noiseBuffer(ac)
  s.connect(f)
  s.start(t0)
  s.stop(t0 + dur + 0.02)
}

/**
 * The game's own way out to the speakers: one gain on the shared context,
 * into its destination. Every sound of the game goes through it, the drones'
 * voices too (droneVoices.ts), so the game's mutes close it at once, a sound
 * already ringing included, and a recording can listen to the game alone.
 */
let bus: { ctx: BaseAudioContext; node: GainNode } | null = null
export function gameBus(ac: BaseAudioContext): GainNode {
  if (bus?.ctx === ac) return bus.node
  const node = ac.createGain()
  node.gain.value = droneRunSilent() ? 0 : 1
  node.connect(ac.destination)
  bus = { ctx: ac, node }
  return node
}

/** The bus follows the mutes: closed while the game is silent, eased so neither way clicks. */
function followMutes(): void {
  const b = bus
  if (!b) return
  try { b.node.gain.setTargetAtTime(droneRunSilent() ? 0 : 1, b.ctx.currentTime, 0.02) } catch { /* a stand-in context */ }
}
useDroneRunSound.subscribe(followMutes)
useSoundMutes.subscribe(followMutes)

/**
 * One sound, scheduled at `t` on `ac`'s clock into `out`: what playSound
 * plays now. It takes any context and any time, so a test can schedule one on a stand-in.
 */
export function synthAt(ac: BaseAudioContext, out: AudioNode, t: number, sound: DroneSound, weapon = 0, strength = 1): void {
  switch (sound) {
    case 'shot':
      if (weapon === 1) {
        hiss(ac, out, t, 'bandpass', 1400, 700, 0.16, 0.07, 0.8)
        tone(ac, out, t, 'sine', 140, 55, 0.12, 0.08)
      } else if (weapon === 2) {
        const k = 0.5 + 0.5 * Math.max(0, Math.min(1, strength))
        tone(ac, out, t, 'sawtooth', 1800, 140, 0.24, 0.045 * k)
        tone(ac, out, t, 'sine', 3200, 2400, 0.05, 0.03 * k)
      } else {
        tone(ac, out, t, 'square', 900, 260, 0.08, 0.035)
      }
      return
    case 'hurt':
      tone(ac, out, t, 'sine', 130, 45, 0.22, 0.12)
      hiss(ac, out, t, 'lowpass', 500, 200, 0.16, 0.05)
      return
    case 'overheat': hiss(ac, out, t, 'highpass', 3200, 5200, 0.28, 0.05); return
    case 'reload':
      hiss(ac, out, t, 'bandpass', 3000, 3000, 0.02, 0.07, 4)
      hiss(ac, out, t + 0.09, 'bandpass', 2200, 2200, 0.03, 0.07, 4)
      return
    case 'wave':
      tone(ac, out, t, 'square', 330, 330, 0.11, 0.03)
      tone(ac, out, t + 0.13, 'square', 494, 494, 0.13, 0.03)
      return
    case 'clear':
      ;[523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(ac, out, t + i * 0.12, 'sine', f, f, i === 3 ? 0.34 : 0.16, 0.07))
      return
    case 'fail': tone(ac, out, t, 'triangle', 330, 140, 0.29, 0.08); return
  }
}

/**
 * Play one sound. `weapon` picks the gun's shot; `strength` (0..1) is the
 * rail's charge. A repeat of the same sound within 30 ms is one sound.
 * Returns whether it was sent to the speakers.
 */
export function playSound(sound: DroneSound, weapon = 0, strength = 1): boolean {
  if (droneRunSilent()) return false
  try {
    const ac = audioContext()
    if (!ac) return false
    // Not running (suspended before the first tap, interrupted by a call): asked to resume, and this sound dropped, never queued to play late with others.
    if (ac.state !== 'running') { void ac.resume().catch(() => { /* held back until a tap */ }); return false }
    const key = sound === 'shot' ? `shot${weapon}` : sound
    const prev = lastAt.get(key)
    if (prev !== undefined && ac.currentTime - prev < REPEAT_GAP_S && ac.currentTime >= prev) return false
    lastAt.set(key, ac.currentTime)
    synthAt(ac, gameBus(ac), ac.currentTime, sound, weapon, strength)
    return true
  } catch {
    return false
  }
}

/** Forget the repeat gaps and the noise (tests). */
export function resetSoundsForTests(): void {
  lastAt.clear()
  noise = null
  bus = null
}
