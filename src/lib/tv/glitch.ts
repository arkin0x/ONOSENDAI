/**
 * glitch.ts: the set acting up now and then, on Cyberspace TV (arkinox,
 * 2026-10-19: "i want to add a random chromatic abberation glitch to tv mode
 * randomly. maybe pick a time between 25 seconds and 3 minutes and trigger
 * it. i just want it to LERP the chromatic aberration from the current amount
 * to a very high amount and then comes back after 1 to 7 seconds", and "we
 * could do the same thing with screen tears or snow (losing signal effect)
 * every few minutes").
 *
 * Three kinds, each on its own random clock:
 *   aberration: the colours pull far apart and come back, 3 to 8 s, every
 *     25 s to 3 min: a slow creep, a sudden slip most of the way, one slow
 *     swell and back, and a flicker off (2026-10-19: "it slowly then suddenly
 *     slips on, grows and shrinks slowly, then flickers off suddenly");
 *   tear: bands of the picture slip sideways, as a tape losing tracking,
 *     under a second and a half, every 2 to 6 min;
 *   dropout: the signal fades, as if drifting out of range: a slow swell of
 *     snow to about two fifths and away again, wavering, 5 to 12 s, every 2
 *     to 6 min (2026-10-19: "it should fade in slowly and subtly ... and then
 *     fade away. it should take 5-12 seconds to resolve").
 * Each runs on its own clock, so they come at no pattern and may land
 * together ("the delay parameters can be different and run on distinct
 * timers so they can seem random and overlap"). None starts over a cut or a
 * hyperjump's tunnel (effects of their own): one due then is put off a few
 * seconds past it, so it does not read as part of the cut. The clocks start
 * again each time TV comes on, and stop through any stall in the frames (a
 * hidden tab, or a hitch loading the next chain), so time spent away is
 * never a backlog. They used to start again after a stall instead, and a
 * hitch every minute or two kept the snow, whose wait is minutes, from ever
 * coming (2026-10-19: "i don't see the subtle snow happening at all"). The tube
 * (TvScreenEffect) reads the levels each frame; with reduced motion asked
 * for it never asks.
 */

export type GlitchKind = 'aberration' | 'tear' | 'dropout'

/** What the tube is told each frame. */
export interface GlitchLevels {
  /** How many times the usual colour split: 1 is none. */
  aberration: number
  /** How hard the bands slip, 0 to 1. */
  tear: number
  /** Changes a few times a second during a tear, so the bands jump about. */
  tearSeed: number
  /** How far the signal has gone, 0 to 1. */
  dropout: number
}

export const CALM: GlitchLevels = { aberration: 1, tear: 0, tearSeed: 0, dropout: 0 }

interface Timing {
  /** Seconds between one and the next, at least and at most. */
  gap: [number, number]
  /** Seconds it lasts, at least and at most. */
  length: [number, number]
  /**
   * Seconds to come on and to go off, at most (a short one is quicker). An
   * aberration's rise is its creep before the slip, and its fall the flicker.
   */
  rise: number
  fall: number
}

export const GLITCH_TIMING: Record<GlitchKind, Timing> = {
  aberration: { gap: [25, 180], length: [3, 8], rise: 1.2, fall: 0.45 },
  tear: { gap: [120, 360], length: [0.4, 1.5], rise: 0.08, fall: 0.15 },
  dropout: { gap: [120, 360], length: [5, 12], rise: 3.5, fall: 4.5 },
}

/** The colours' split at the height of an aberration: "a very high amount". */
export const PEAK_ABERRATION = 8
const KINDS: GlitchKind[] = ['aberration', 'tear', 'dropout']
/** A gap between frames this long, ms, is time away (a hidden tab, a hitch): the clocks stop for it. */
const STALL_MS = 1000
/** Seconds a glitch due during a cut or the tunnel is put off past it, at least and at most. */
const DEFER_S: [number, number] = [2, 12]
/** How long each pattern of a tear's bands holds, ms: under three changes a second (WCAG 2.3.1). */
const TEAR_STEP_MS = 350

interface Live { start: number; length: number }

export class GlitchDirector {
  private due: Record<GlitchKind, number> = { aberration: 0, tear: 0, dropout: 0 }
  private live: Record<GlitchKind, Live | null> = { aberration: null, tear: null, dropout: null }
  private last = 0

  /** `now` in ms. */
  constructor(now: number, private random: () => number = Math.random) {
    this.reset(now)
  }

  /** Start every clock again from `now`, with nothing on: TV coming on, or back from time away. */
  reset(now: number): void {
    for (const k of KINDS) {
      this.due[k] = now + this.gap(k)
      this.live[k] = null
    }
    this.last = now
  }

  /** Hold every clock still for `ms` of time away: what was due is still as far off, what was on carries on. */
  private stop(ms: number): void {
    for (const k of KINDS) {
      this.due[k] += ms
      const live = this.live[k]
      if (live) live.start += ms
    }
  }

  private gap(kind: GlitchKind): number {
    const [lo, hi] = GLITCH_TIMING[kind].gap
    return (lo + (hi - lo) * this.random()) * 1000
  }

  /** The glitches on now: for tests and the probe. */
  get current(): GlitchKind[] {
    return KINDS.filter((k) => this.live[k] !== null)
  }

  /**
   * The levels at `now` (ms). `held` is a moment no glitch may start in (a
   * cut, the tunnel, tuning): one that is due waits for it to pass. One
   * already on plays out, unless `clear`: the HOSAKA spot and the tunnel end
   * it there and then, under the cut into them (review of #388: an
   * aberration carried into the spot smeared its words unreadable).
   */
  levels(now: number, held: boolean, clear = false): GlitchLevels {
    if (now - this.last > STALL_MS) this.stop(now - this.last)
    this.last = now
    const out = { ...CALM }
    for (const kind of KINDS) {
      if (clear && this.live[kind]) this.live[kind] = { start: now - 1, length: 0 }
      let live = this.live[kind]
      // Over: the next of its kind is a new while away, from now.
      if (live && now >= live.start + live.length) {
        this.due[kind] = now + this.gap(kind)
        live = this.live[kind] = null
      }
      // Due during a cut or the tunnel: a few seconds past it instead.
      if (!live && held && now >= this.due[kind]) {
        const [lo, hi] = DEFER_S
        this.due[kind] = now + (lo + (hi - lo) * this.random()) * 1000
      }
      if (!live && !held && now >= this.due[kind]) {
        const [lo, hi] = GLITCH_TIMING[kind].length
        live = this.live[kind] = { start: now, length: (lo + (hi - lo) * this.random()) * 1000 }
      }
      if (!live) continue
      const t = (now - live.start) / 1000
      if (kind === 'aberration') {
        out.aberration = 1 + (PEAK_ABERRATION - 1) * slip(t, live.length / 1000, GLITCH_TIMING.aberration)
        continue
      }
      const env = envelope(t, live.length / 1000, GLITCH_TIMING[kind])
      if (kind === 'tear') {
        out.tear = env
        out.tearSeed = 1 + (Math.floor(now / TEAR_STEP_MS) % 97)
      } else {
        // Not a clean ramp: reception comes and goes a little as it fades.
        out.dropout = env * (0.85 + 0.15 * Math.sin(t * 1.9) * Math.sin(t * 0.7 + 1))
      }
    }
    return out
  }
}

/** How far an aberration has crept before it slips, of its height. */
export const CREEP_LEVEL = 0.12
/** How far the slip takes it, of its height: the swell grows from here to all of it and back. */
export const SLIP_LEVEL = 0.75
/** Seconds the slip takes: sudden. */
export const SLIP_S = 0.1
/** The flicker off, in seconds into it: gone, back once, gone (one and a half flashes, under WCAG 2.3.1's three a second). */
const BLINK: [number, number] = [0.15, 0.27]
/** How far the blink back comes, of its height. */
const BLINK_LEVEL = 0.6

/**
 * An aberration's shape, 0 to 1, `t` s into one `length` s long: it creeps
 * up a little over `rise` s, slips most of the way in a tenth of a second,
 * swells once slowly to all of it and back, then flickers off over the last
 * `fall` s. No wobble: between the slip and the flicker it only breathes.
 */
export function slip(t: number, length: number, timing: Pick<Timing, 'rise' | 'fall'>): number {
  if (t <= 0 || t >= length) return 0
  const creep = Math.min(timing.rise, length * 0.25)
  const flicker = Math.min(timing.fall, length * 0.15)
  const ease = (x: number): number => x * x * (3 - 2 * x)
  if (t < creep) return CREEP_LEVEL * ease(t / creep)
  if (t < creep + SLIP_S) return CREEP_LEVEL + (SLIP_LEVEL - CREEP_LEVEL) * Math.sin(((t - creep) / SLIP_S) * Math.PI / 2)
  const off = length - flicker
  if (t < off) {
    const swell = (t - creep - SLIP_S) / (off - creep - SLIP_S)
    return SLIP_LEVEL + (1 - SLIP_LEVEL) * Math.sin(swell * Math.PI) ** 2
  }
  // In the flicker's own seconds, as if it were the whole `fall` long.
  const into = ((t - off) / flicker) * timing.fall
  return into >= BLINK[0] && into < BLINK[1] ? BLINK_LEVEL : 0
}

/** Up, held, and down, eased: 0 to 1 over a glitch `length` s long, `t` s in. */
export function envelope(t: number, length: number, timing: Pick<Timing, 'rise' | 'fall'>): number {
  if (t <= 0 || t >= length) return 0
  const rise = Math.min(timing.rise, length * 0.3)
  const fall = Math.min(timing.fall, length * 0.4)
  const ease = (x: number): number => x * x * (3 - 2 * x)
  if (t < rise) return ease(t / rise)
  if (t > length - fall) return ease((length - t) / fall)
  return 1
}
