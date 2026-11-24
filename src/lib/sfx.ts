/**
 * sfx.ts: the game's short sound effects, behind one call, `sfx.play(name)`
 * (arkinox, 2026-11-24: "make a PR that makes a bouncing sound effect when
 * you bounce on a shard ... for now this can be a shim").
 *
 * Today there is one: `bounce`, played by WALK (store/useWalk.ts, (E)) each
 * time your own walker is launched off a bouncy shard, whether it landed on
 * the pad or stepped or walked onto a springboard, in step WALK and fluid
 * walk alike (both bounce through the same two places). It is decided by the
 * bounce actually happening, never by a field, so every bouncy shard sounds
 * it: the tutorial's trampoline, every shard already placed, every one
 * imported. Nothing is written into a payload or the spec.
 *
 * SHIM: the bounce's sound is DEFAULT_BOUNCE, the default bounce until
 * DECK-0003 SFX. When the spec gives a shard a sound of its own, the
 * shard's sound is chosen where the bounce is (useWalk's bounceOff and
 * padLaunch know the pad) and handed here in place of the default; the gates
 * below stay the same for every sound.
 *
 * Synthesised on the spot through the one audio context (lib/audioContext,
 * the ruling of 2026-10-23: one audio plumbing, never a second context), as
 * the chime and the OPEN ceremony are: no file to download, nothing to
 * license. A few nodes are made per sound, never per frame.
 *
 * A sound is let out only when:
 *   - the page is not Cyberspace TV's broadcast, and TV is not on (TV plays
 *     no game sounds; the stream carries only its music);
 *   - the page is visible: no sound from a tab in the background;
 *   - Sound effects is on in Settings > Effects (store/sfxSwitch; owner,
 *     2026-11-24), kept per identity, on by default;
 *   - MUTE ALL (NOW PLAYING; store/useSoundMutes) is off. The app has no
 *     volume of its own: TV's music keeps its own (store/useTvMusic), and a
 *     sound effect is as quiet as the message chime;
 *   - the same sound did not play within its gap (SFX_GAP_MS), so a run of
 *     quick bounces sounds as a run, not a pile.
 * The browser holds sound back until the page is touched; WALK is walked by
 * keys and taps, so by the first bounce it nearly always has been. Where it
 * is still held back, this asks for it (wantSound) and sounds only if it is
 * let out at once: a boing that came late would land after the bounce.
 */

import { audioContext, wantSound } from './audioContext'
import { onceEvery } from './buzz'
import { isBroadcast } from './tv/broadcast'
import { tvIsOn } from '../store/tvOn'
import { useSoundMutes } from '../store/useSoundMutes'
import { sfxOn } from '../store/sfxSwitch'

/** The sounds there are. */
export type SfxName = 'bounce'

/**
 * A sound: scheduled at `t0` on the context's clock, with `strength`, 0 to
 * 1, how hard the moment was (for a bounce, how high it launches).
 */
export type SfxVoice = (ac: AudioContext, t0: number, strength: number) => void

/** The least time between two plays of the same sound, ms. */
export const SFX_GAP_MS: Record<SfxName, number> = { bounce: 150 }

/** How long a held-back context may take to be let out and still sound, ms. */
const LATE_MS = 80

/** The loudest a bounce gets: about the message chime's (lib/chime.ts, 0.08). */
const BOUNCE_PEAK = 0.07

/**
 * DEFAULT BOUNCE UNTIL DECK-0003 SFX: a soft "boing" under 0.4 s, a
 * triangle swept up fast and easing back down with a quick wobble, a
 * quiet sine an octave above for a little shine, through a lowpass so it
 * never buzzes. A higher launch is a little deeper and a little longer.
 */
export const DEFAULT_BOUNCE: SfxVoice = (ac, t0, strength) => {
  const s = Math.min(1, Math.max(0, strength))
  const f0 = 260 - 80 * s
  const len = 0.3 + 0.06 * s
  const end = t0 + len
  const out = ac.createGain()
  out.gain.setValueAtTime(0.0001, t0)
  out.gain.exponentialRampToValueAtTime(BOUNCE_PEAK, t0 + 0.006)
  out.gain.exponentialRampToValueAtTime(0.0001, end)
  out.connect(ac.destination)
  const soft = ac.createBiquadFilter()
  soft.type = 'lowpass'
  soft.frequency.setValueAtTime(2400, t0)
  soft.Q.setValueAtTime(0.7, t0)
  soft.connect(out)
  // The wobble: a slow sine bending the pitch, dying away with the sound.
  const wobble = ac.createOscillator()
  wobble.type = 'sine'
  wobble.frequency.setValueAtTime(18, t0)
  wobble.start(t0)
  wobble.stop(end + 0.02)
  for (const [mul, type, level] of [[1, 'triangle', 1], [2, 'sine', 0.2]] as const) {
    // The wobble's depth in Hz, scaled with the note, so the octave bends with the tone it shines over.
    const depth = ac.createGain()
    depth.gain.setValueAtTime(f0 * mul * 0.15, t0)
    depth.gain.exponentialRampToValueAtTime(mul, end)
    wobble.connect(depth)
    const osc = ac.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(f0 * mul, t0)
    osc.frequency.exponentialRampToValueAtTime(f0 * mul * 2.4, t0 + 0.07)
    osc.frequency.exponentialRampToValueAtTime(f0 * mul * 1.5, end)
    depth.connect(osc.frequency)
    if (level === 1) osc.connect(soft)
    else {
      const quiet = ac.createGain()
      quiet.gain.setValueAtTime(level, t0)
      osc.connect(quiet)
      quiet.connect(soft)
    }
    osc.start(t0)
    osc.stop(end + 0.02)
  }
}

/** Each sound's voice. Bounce: the shim above, until DECK-0003 gives shards sounds. */
const VOICES: Record<SfxName, SfxVoice> = { bounce: DEFAULT_BOUNCE }

const played = new Map<string, number>()

/** Whether a sound effect may be heard now: not TV, a visible page, Sound effects on, MUTE ALL off. */
export function sfxAllowed(): boolean {
  if (isBroadcast() || tvIsOn()) return false
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false
  return !useSoundMutes.getState().master && sfxOn()
}

/**
 * Play `name` with `strength`, 0 to 1 (clamped). Safe to call anywhere and
 * fails silent. True when it was let through the gates (it sounds, or will
 * the moment the browser lets sound out); false when a gate kept it quiet.
 */
function play(name: SfxName, strength = 0, now: number = performance.now()): boolean {
  if (!sfxAllowed()) return false
  if (!onceEvery(played, name, now, SFX_GAP_MS[name])) return false
  try {
    const ac = audioContext()
    if (!ac) return false
    const voice = VOICES[name]
    if (ac.state === 'running') {
      voice(ac, ac.currentTime, strength)
      return true
    }
    // Held back: ask for sound (the next tap lets it out), and sound now only if it comes at once.
    wantSound()
    void ac.resume().then(() => {
      if (ac.state === 'running' && performance.now() - now <= LATE_MS) voice(ac, ac.currentTime, strength)
    }, () => { /* still held back */ })
    return true
  } catch {
    return false
  }
}

/** The one door every sound effect goes through. */
export const sfx = { play }

/** For tests: forget when each sound last played. */
export function resetSfx(): void {
  played.clear()
}
