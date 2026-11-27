/**
 * hammerAnim.ts - the first-person smash, as numbers (owner, 2026-11-27: "i
 * want the hammer to be extended forward so we can see it, then have it light
 * up and start the charging noise ... then raise above and behind view, the
 * view moves slightly ... and then the hammer comes down swinging from above
 * the head and smashing straight into the blocks").
 *
 * Time in, a phase and a pose out; nothing here draws, sounds or keeps state.
 * The held Compiler (terrain/HeldCompiler.tsx), the camera's kick
 * (scene/SmashKick.tsx) and the sounds (smashSound.ts) all read the same
 * clock through these functions, so they stay in step.
 *
 * The phases, across a hold of any length (`ms` is whatever the hold lasts):
 *
 *   ready    the hammer comes in from the corner to a large two-handed hold
 *            in front of you: the first READY_SHARE of the hold, at most
 *            READY_MAX_MS;
 *   charge   held there while the rings, then the edges, then the striking
 *            faces light, and sparks fly, more as it fills;
 *   windup   the last WINDUP_SHARE of the hold (at most WINDUP_MAX_MS): a
 *            small dip, then up and back over the head, the view tilting up
 *            a little with it;
 *   swing    the hold is complete: down from overhead in `swingMs`;
 *   impact   the hit-stop, HITSTOP_MS with the head on the blocks;
 *   recover  a rebound, then back to the corner in RECOVER_MS.
 *
 * Letting go early is `cancel`: from wherever the hammer was, back to the
 * corner in CANCEL_MS, its light winding down.
 *
 * With reduced motion the hammer still comes forward and charges, but it
 * never goes overhead: it dips at the strike. The view never moves.
 */

/** The share of the hold the hammer takes to come forward, and the most that may last. */
export const READY_SHARE = 0.15
export const READY_MAX_MS = 600
/** The share of the hold, at its end, the wind-up takes, and the most that may last. */
export const WINDUP_SHARE = 0.24
export const WINDUP_MAX_MS = 900
/** The hit-stop: the head stays on the blocks this long. */
export const HITSTOP_MS = 75
/** From the end of the hit-stop back to the corner. */
export const RECOVER_MS = 650
/** From letting go early back to the corner. */
export const CANCEL_MS = 380

export type HammerPhase = 'idle' | 'ready' | 'charge' | 'windup' | 'swing' | 'impact' | 'recover' | 'cancel'

/** The clock the animation reads: the hold (terrain/smashHold.ts), and a let-go the tracker noted (terrain/hammerClock.ts). */
export interface HammerClock {
  /** When the hold began, or null. */
  since: number | null
  /** How long the hold lasts. */
  ms: number
  /** When the last completed hold ended and its swing began, or null. */
  swingAt: number | null
  /** When a hold was let go early, or null. */
  cancelAt: number | null
  /** How far into its hold, in ms, the let-go came. */
  cancelFrom: number
}

export const IDLE_CLOCK: HammerClock = { since: null, ms: 0, swingAt: null, cancelAt: null, cancelFrom: 0 }

/**
 * Where the hammer is and how it glows. Positions are shares of the screen,
 * from the middle: y of half its height; x of half its width (of half its
 * height, on a wide screen), or, for the corner (`wide`), how far in from
 * the right edge, in half heights. `depth` is how far in front of the eye
 * its grip is, in hammer lengths. Angles in radians: `pitch` tips the head away
 * from you (negative: back over your shoulder), `yaw` turns it about its own
 * shaft, `roll` leans it in the plane of the screen (negative: to the right).
 */
export interface HammerPose {
  x: number
  /** 0 to 1: whether x is measured in from the right edge (1, the corner item), or out from the middle (0). */
  wide: number
  y: number
  depth: number
  pitch: number
  yaw: number
  roll: number
  /** 0 to 1: how lit the head is. */
  charge: number
  /** 0 to 1: how fast sparks leave the lit edges. */
  sparks: number
  /** 0 to 1: how hard it trembles in the hands. */
  tremble: number
  /** 0 to 1: the streak behind the head in the swing. */
  trail: number
  /** 0 to 1: the flash at the head on impact. */
  flash: number
  /** The view's tilt, radians: up is positive. Zero with reduced motion. */
  camPitch: number
  /** The view's lean, radians. Zero with reduced motion. */
  camRoll: number
  /** 0 to 1: the view's shake. Zero with reduced motion. */
  shake: number
}

const DEG = Math.PI / 180

const glowless = { charge: 0, sparks: 0, tremble: 0, trail: 0, flash: 0, camPitch: 0, camRoll: 0, shake: 0 }

/** A small item tucked in the bottom right corner, shaft toward the lower left, head up and to the right. */
export const POSE_IDLE: HammerPose = { x: 0.3, wide: 1, y: -0.62, depth: 6.4, pitch: 14 * DEG, yaw: -32 * DEG, roll: -40 * DEG, ...glowless }
/** Large, in both hands, across the lower screen: the left hand low by the shaft's end, the right under the head. */
export const POSE_READY: HammerPose = { x: -0.06, wide: 0, y: -0.6, depth: 3.9, pitch: 24 * DEG, yaw: -30 * DEG, roll: -27 * DEG, ...glowless }
/** Overhead and behind: the head is out of sight above, only the shaft's end left in view. */
export const POSE_WINDUP: HammerPose = { x: 0.04, wide: 0, y: 1.07, depth: 2.2, pitch: -75 * DEG, yaw: -90 * DEG, roll: -6 * DEG, ...glowless }
/** The blow landed: the shaft runs away from you, the head on the cross. */
export const POSE_IMPACT: HammerPose = { x: 0.02, wide: 0, y: -0.56, depth: 2.3, pitch: 58 * DEG, yaw: -80 * DEG, roll: -3 * DEG, ...glowless }
/** Reduced motion's strike: a short dip from the ready hold. */
export const POSE_CALM_DIP: HammerPose = { ...POSE_READY, y: -0.68, pitch: 38 * DEG }

/** The most the view tilts up in the wind-up, and kicks down at the impact. */
export const CAM_WINDUP_PITCH = 2.6 * DEG
export const CAM_IMPACT_PITCH = -2.2 * DEG
export const CAM_WINDUP_ROLL = -0.8 * DEG

const clamp01 = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t)
export const smooth = (t: number): number => { const c = clamp01(t); return c * c * (3 - 2 * c) }
export const easeOutCubic = (t: number): number => 1 - (1 - clamp01(t)) ** 3
export const easeInOutCubic = (t: number): number => { const c = clamp01(t); return c < 0.5 ? 4 * c * c * c : 1 - (-2 * c + 2) ** 3 / 2 }
/** Past the end and back: the overshoot of something heavy arriving. */
export const easeOutBack = (t: number, over = 1.4): number => { const c = clamp01(t) - 1; return 1 + (over + 1) * c * c * c + over * c * c }

/** When, in ms from the start of a hold of `ms`, the hammer is fully forward and the charge begins. */
export function readyMs(ms: number): number {
  return Math.min(Math.max(0, ms) * READY_SHARE, READY_MAX_MS)
}

/** When, in ms from the start of a hold of `ms`, the wind-up begins. */
export function windupFromMs(ms: number): number {
  const m = Math.max(0, ms)
  return m - Math.min(m * WINDUP_SHARE, WINDUP_MAX_MS)
}

/** How lit the head is `elapsed` ms into a hold of `ms`: nothing until the hammer is forward, then filling to the end. */
export function chargeAt(elapsed: number, ms: number): number {
  const from = readyMs(ms)
  return smooth((elapsed - from) / Math.max(1, ms - from))
}

/** The phase at `now`, how far through it (0 to 1), and the ms since the impact (null before one). */
export interface PhaseNow { phase: HammerPhase; t: number; sinceImpact: number | null }

/** Written into `out` (one kept by the caller, so a frame allocates nothing) and returned. */
export function phaseAt(now: number, c: HammerClock, swingMs: number, out: PhaseNow = { phase: 'idle', t: 0, sinceImpact: null }): PhaseNow {
  const put = (phase: HammerPhase, t: number, sinceImpact: number | null): PhaseNow => { out.phase = phase; out.t = t; out.sinceImpact = sinceImpact; return out }
  if (c.since !== null) {
    const e = Math.max(0, now - c.since)
    const ready = readyMs(c.ms), wind = windupFromMs(c.ms)
    if (e < ready) return put('ready', e / Math.max(1, ready), null)
    if (e < wind) return put('charge', (e - ready) / Math.max(1, wind - ready), null)
    return put('windup', clamp01((e - wind) / Math.max(1, c.ms - wind)), null)
  }
  // A let-go after the last swing began is the newer of the two.
  if (c.cancelAt !== null && (c.swingAt === null || c.cancelAt >= c.swingAt)) {
    const e = now - c.cancelAt
    if (e >= 0 && e < CANCEL_MS) return put('cancel', e / CANCEL_MS, null)
    return put('idle', 0, null)
  }
  if (c.swingAt !== null) {
    const e = now - c.swingAt
    const swing = Math.max(1, swingMs)
    if (e >= 0 && e < swing) return put('swing', e / swing, null)
    if (e >= swing && e < swing + HITSTOP_MS) return put('impact', (e - swing) / HITSTOP_MS, e - swing)
    if (e >= swing && e < swing + HITSTOP_MS + RECOVER_MS) return put('recover', (e - swing - HITSTOP_MS) / RECOVER_MS, e - swing)
  }
  return put('idle', 0, null)
}

/** The one PhaseNow the frame loops below write into. */
const NOW: PhaseNow = { phase: 'idle', t: 0, sinceImpact: null }

/** Whether anything is still moving at `now`: the frames must keep coming while it is. */
export function hammerBusy(now: number, c: HammerClock, swingMs: number): boolean {
  return phaseAt(now, c, swingMs, NOW).phase !== 'idle'
}

const POSE_KEYS = ['x', 'wide', 'y', 'depth', 'pitch', 'yaw', 'roll', 'charge', 'sparks', 'tremble', 'trail', 'flash', 'camPitch', 'camRoll', 'shake'] as const

/** `a` to `b` by `k`, every number of the pose, written into `out` (which may be either). */
export function mixPose(a: HammerPose, b: HammerPose, k: number, out: HammerPose): HammerPose {
  for (const key of POSE_KEYS) out[key] = a[key] + (b[key] - a[key]) * k
  return out
}

/** A new pose to write into. */
export function newPose(): HammerPose {
  return { ...POSE_IDLE }
}

/** The pose `elapsed` ms into a hold of `ms`, written into `out`. */
function holdPose(elapsed: number, ms: number, calm: boolean, out: HammerPose): HammerPose {
  const ready = readyMs(ms), wind = windupFromMs(ms)
  const charge = chargeAt(elapsed, ms)
  if (elapsed < ready) {
    mixPose(POSE_IDLE, POSE_READY, calm ? smooth(elapsed / Math.max(1, ready)) : easeOutBack(elapsed / Math.max(1, ready)), out)
  } else if (elapsed < wind || calm) {
    mixPose(POSE_READY, POSE_READY, 0, out)
    // It grows heavy as it fills: drawn in toward you a little, ready to go up.
    const c = smooth((elapsed - ready) / Math.max(1, wind - ready))
    out.depth -= 0.12 * c
    out.y -= 0.02 * c
  } else {
    const t = clamp01((elapsed - wind) / Math.max(1, ms - wind))
    // The anticipation: a short dip the other way before it goes up.
    const DIP = 0.22
    if (t < DIP) {
      const d = Math.sin((t / DIP) * Math.PI)
      mixPose(POSE_READY, POSE_READY, 0, out)
      out.depth -= 0.12
      out.y -= 0.02 + 0.07 * d
      out.pitch += 9 * DEG * d
    } else {
      const u = easeInOutCubic((t - DIP) / (1 - DIP))
      mixPose(POSE_READY, POSE_WINDUP, u, out)
      out.depth -= 0.12 * (1 - u)
      out.y -= 0.02 * (1 - u)
      out.camPitch = CAM_WINDUP_PITCH * u
      out.camRoll = CAM_WINDUP_ROLL * u
    }
  }
  out.charge = charge
  out.sparks = charge ** 1.5
  out.tremble = calm ? 0 : charge
  out.trail = 0
  out.flash = 0
  out.shake = 0
  if (calm) { out.camPitch = 0; out.camRoll = 0 }
  return out
}

const scratch: HammerPose = newPose()

/**
 * The pose at `now`, written into `out`. `swingMs` is the swing's length
 * (lib/blueprint/smash.ts SWING_MS); `calm` is reduced motion.
 */
export function hammerPose(now: number, c: HammerClock, swingMs: number, calm: boolean, out: HammerPose = newPose()): HammerPose {
  const { phase, t, sinceImpact } = phaseAt(now, c, swingMs, NOW)
  switch (phase) {
    case 'ready': case 'charge': case 'windup':
      return holdPose(Math.max(0, now - (c.since as number)), c.ms, calm, out)
    case 'cancel': {
      // From wherever it was let go, back to the corner, the light winding down.
      holdPose(c.cancelFrom, c.ms, calm, scratch)
      const k = easeOutCubic(t)
      mixPose(scratch, POSE_IDLE, k, out)
      out.sparks = 0
      out.tremble = scratch.tremble * (1 - k)
      return out
    }
    case 'swing': {
      const from = calm ? POSE_READY : POSE_WINDUP, to = calm ? POSE_CALM_DIP : POSE_IMPACT
      // Slow off the top, fastest at the blocks.
      const k = t ** 2.4
      mixPose(from, to, k, out)
      out.charge = 1
      out.sparks = 1
      out.trail = calm ? 0 : t
      if (!calm) {
        out.camPitch = CAM_WINDUP_PITCH + (CAM_IMPACT_PITCH * 0.4 - CAM_WINDUP_PITCH) * k
        out.camRoll = CAM_WINDUP_ROLL * (1 - k)
      }
      return out
    }
    case 'impact': {
      mixPose(calm ? POSE_CALM_DIP : POSE_IMPACT, calm ? POSE_CALM_DIP : POSE_IMPACT, 0, out)
      out.charge = 1
      out.flash = 1 - 0.35 * t
      out.trail = calm ? 0 : 1 - 0.5 * t
      if (!calm) { out.camPitch = CAM_IMPACT_PITCH; out.shake = 1 }
      return out
    }
    case 'recover': {
      const hit = calm ? POSE_CALM_DIP : POSE_IMPACT
      // The rebound: the head jumps back off the blocks in the first fifth, then the hammer is carried home.
      const REBOUND = 0.2
      if (t < REBOUND) {
        mixPose(hit, hit, 0, out)
        const r = Math.sin((t / REBOUND) * Math.PI * 0.5)
        out.pitch -= (calm ? 4 : 13) * DEG * r
        out.y += (calm ? 0.01 : 0.05) * r
      } else {
        mixPose(hit, hit, 0, scratch)
        scratch.pitch -= (calm ? 4 : 13) * DEG
        scratch.y += calm ? 0.01 : 0.05
        mixPose(scratch, POSE_IDLE, easeInOutCubic((t - REBOUND) / (1 - REBOUND)), out)
      }
      out.charge = Math.max(0, 1 - t * 2.2)
      out.flash = Math.max(0, 0.65 - t * 4)
      out.trail = calm ? 0 : Math.max(0, 0.5 - t * 2.5)
      out.sparks = 0
      out.tremble = 0
      if (calm) { out.camPitch = 0; out.camRoll = 0; out.shake = 0 } else {
        // A kick that rings down: a damped swing of the view, and a shake that is gone in a third of a second.
        const s = (sinceImpact ?? 0) / 1000
        out.camPitch = CAM_IMPACT_PITCH * Math.exp(-s * 9) * Math.cos(s * 26)
        out.camRoll = 0
        out.shake = Math.max(0, 1 - s / 0.33) ** 2
      }
      return out
    }
    default:
      return mixPose(POSE_IDLE, POSE_IDLE, 0, out)
  }
}

/**
 * The tracker's step: the clock after the hold's state changed. A hold that
 * ends with no new swing was let go early: the let-go is noted, with how far
 * in it came.
 */
export function nextClock(prev: HammerClock, hold: { since: number | null; ms: number; swingAt: number | null }, now: number): HammerClock {
  const letGo = prev.since !== null && hold.since === null && hold.swingAt === prev.swingAt
  return {
    since: hold.since,
    ms: hold.since !== null ? hold.ms : prev.ms,
    swingAt: hold.swingAt,
    cancelAt: hold.since !== null ? null : letGo ? now : prev.cancelAt,
    cancelFrom: letGo ? Math.min(prev.ms, Math.max(0, now - (prev.since as number))) : prev.cancelFrom,
  }
}
