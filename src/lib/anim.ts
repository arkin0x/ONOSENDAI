/**
 * anim.ts: an object's perpetual motion on the shared paced clock (design
 * note anim-block-paced-design-2026-11-10, §4 and §5; DECK-0003 `anim`, in
 * draft).
 *
 * `anim` is an optional payload field: a list of motions, each one JSON
 * array, a word and then integers (and an axis letter). Every motion ends in
 * the same three integers, `c` cycles every `b` paced blocks with a phase
 * offset of `φ` whole degrees, so its phase at paced height β is
 *
 *   u = frac(c × β / b + φ / 360)
 *
 * and its pose is a pure function of u. The motions compose in the order
 * written, the first innermost, about the object's own origin, in its own
 * model frame (cyberspace axes, ticks). Nothing here knows the clock
 * (lib/pacedClock.ts) or the screen (scene/ShardMesh.tsx).
 *
 * THE MOTION TABLE (MOTIONS below) is the only place a motion is defined:
 * its word, how its parameters are read, and its pose at a phase. The names
 * and the parameter model follow the DECK-0003 spec PR once the owner's
 * research on conventions lands (2026-11-14); renaming or adding a motion is
 * one entry there.
 *
 * Reader rules kept here (§4.3): at most four motions are read (the first
 * four entries; later ones are ignored), a malformed entry or an unknown word
 * is ignored and the rest still apply, a rate above 600 cycles per paced
 * block holds that motion at phase 0, and the payload is never rejected for
 * `anim`. Like `constrain` and `bounce`, the field rides in sno-core's
 * `extra` until sno-core learns it; a top-level `anim` is read first.
 */

import type { ShardModel } from 'sno-core/shards'

/** The payload field. */
export const ANIM_FIELD = 'anim'
/** Motions read per object; entries past this are ignored (§4.3). */
export const MAX_MOTIONS = 4
/** Fastest rate a motion may have, cycles per paced block; faster is held still (a strobe, §4.3). */
export const MAX_RATE = 600
/** Waypoints a `path` may have (§4.1). */
export const PATH_MIN = 2
export const PATH_MAX = 32
/** A model unit in ticks (sno-core TICKS_PER_UNIT). */
const TICKS = 120

export type Axis = 'x' | 'y' | 'z'
const AXES: readonly Axis[] = ['x', 'y', 'z']
const AXIS_INDEX: Readonly<Record<Axis, 0 | 1 | 2>> = { x: 0, y: 1, z: 2 }

/** The shared rate and phase of every motion. */
export interface Rate {
  /** Cycles every `b` paced blocks; negative runs the cycle backward. */
  c: number
  /** Paced blocks, at least 1. */
  b: number
  /** Phase offset, whole degrees 0..359. */
  phi: number
}

/** One motion as read: its word, its rate, and its own parameters (numbers only, so a pose allocates nothing). */
export interface Motion extends Rate {
  word: string
  /** Axis index 0..2, for the motions that have one; -1 otherwise. */
  axis: number
  /** The motion's own integers, in the order written after the axis (reach, radius, travel, dwell...). */
  p: number[]
  /** A path's waypoints, four integers each [x, y, z, w]; empty otherwise. */
  pts: number[]
  /** Faster than MAX_RATE: held at phase 0. */
  tooFast: boolean
}

/**
 * Where a motion moves a point, in the model frame: a turn of `angle`
 * radians about axis `axis` (right-handed; -1 for no turn), then a
 * translation `t` in ticks. Written in place.
 */
export interface MotionPose {
  axis: number
  angle: number
  t: [number, number, number]
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)
const isAxis = (v: unknown): v is Axis => typeof v === 'string' && (AXES as readonly string[]).includes(v)

/** The rate from the last three numbers of an entry, or null. */
function readRate(c: unknown, b: unknown, phi: unknown): Rate | null {
  if (!isInt(c) || !isInt(b) || !isInt(phi)) return null
  if (b < 1 || phi < 0 || phi > 359) return null
  return { c, b, phi }
}

/** `ease(x) = 3x² − 2x³` (§4.2). */
export function smoothstep(x: number): number {
  const k = x <= 0 ? 0 : x >= 1 ? 1 : x
  return k * k * (3 - 2 * k)
}

const TAU = 2 * Math.PI

/** A motion's definition: how an entry is read, and its pose at a phase. */
interface MotionDef {
  /** The entry after its word, read into a motion, or null when malformed. */
  read(rest: readonly unknown[]): Omit<Motion, 'word' | 'tooFast'> | null
  /** The pose at phase `u` (0..1), written into `out`. */
  pose(m: Motion, u: number, out: MotionPose): void
}

/** The common shape `[word, axis, ...ints, c, b, φ]`, with `n` integers between, each checked by `ok`. */
function axisShape(n: number, ok: (p: number[]) => boolean): MotionDef['read'] {
  return (rest) => {
    if (rest.length !== 1 + n + 3 || !isAxis(rest[0])) return null
    const p = rest.slice(1, 1 + n)
    if (!p.every(isInt) || !ok(p as number[])) return null
    const rate = readRate(rest[1 + n], rest[2 + n], rest[3 + n])
    return rate ? { ...rate, axis: AXIS_INDEX[rest[0]], p: p as number[], pts: [] } : null
  }
}

function still(out: MotionPose): void {
  out.axis = -1; out.angle = 0; out.t[0] = 0; out.t[1] = 0; out.t[2] = 0
}

/**
 * THE MOTION TABLE. Word -> parameters -> pose. The only place a motion is
 * defined (see the header).
 */
export const MOTIONS: Readonly<Record<string, MotionDef>> = {
  /** `["turn", axis, c, b, φ]`: 360 degrees a cycle about the axis through the origin. */
  turn: {
    read: axisShape(0, () => true),
    pose: (m, u, out) => { still(out); out.axis = m.axis; out.angle = TAU * u },
  },
  /** `["swing", axis, reach, c, b, φ]`: back and forth, angle = reach × sin(2πu), reach 1..180 degrees. */
  swing: {
    read: axisShape(1, ([reach]) => reach >= 1 && reach <= 180),
    pose: (m, u, out) => { still(out); out.axis = m.axis; out.angle = (m.p[0] * Math.PI / 180) * Math.sin(TAU * u) },
  },
  /** `["slide", axis, reach, c, b, φ]`: along the axis, offset = reach × sin(2πu), reach in ticks. */
  slide: {
    read: axisShape(1, () => true),
    pose: (m, u, out) => { still(out); out.t[m.axis] = m.p[0] * Math.sin(TAU * u) },
  },
  /**
   * `["orbit", axis, radius, c, b, φ]`: the origin goes round a circle of
   * `radius` ticks about the axis, without turning. At u = 0 it sits at
   * `radius` along the next axis (x->y, y->z, z->x), and it goes round the
   * way a turn does (right-handed).
   */
  orbit: {
    read: axisShape(1, ([radius]) => radius >= 0),
    pose: (m, u, out) => {
      still(out)
      const a = m.axis, e1 = (a + 1) % 3, e2 = (a + 2) % 3
      // A right-handed turn about `a` by θ takes e1 to cos θ e1 + sin θ e2.
      const th = TAU * u
      out.t[e1] = m.p[0] * Math.cos(th)
      out.t[e2] = m.p[0] * Math.sin(th)
    },
  },
  /**
   * `["lift", axis, travel, dwell, c, b, φ]`: rests at the origin, travels
   * `travel` ticks (signed) eased, rests, comes back; `dwell` is the share of
   * the cycle resting at EACH stop, whole percent 0..49 (§4.2).
   */
  lift: {
    read: axisShape(2, ([, dwell]) => dwell >= 0 && dwell <= 49),
    pose: (m, u, out) => {
      still(out)
      const d = m.p[1] / 100
      let s: number
      if (u < d) s = 0
      else if (u < 0.5) s = smoothstep((u - d) / (0.5 - d))
      else if (u < 0.5 + d) s = 1
      else s = 1 - smoothstep((u - 0.5 - d) / (0.5 - d))
      out.t[m.axis] = m.p[0] * s
    },
  },
  /**
   * `["path", c, b, φ, [x, y, z, w], ...]`: the origin travels a closed loop
   * of 2 to 32 waypoints in ticks, linearly. Leg i runs from the waypoint
   * before it to waypoint i and takes w_i / Σw of the cycle (w ≥ 1), so at
   * u = 0 the origin is at the last waypoint.
   */
  path: {
    read: (rest) => {
      if (rest.length < 3 + PATH_MIN || rest.length > 3 + PATH_MAX) return null
      const rate = readRate(rest[0], rest[1], rest[2])
      if (!rate) return null
      const pts: number[] = []
      for (const w of rest.slice(3)) {
        if (!Array.isArray(w) || w.length !== 4 || !w.every(isInt) || w[3] < 1) return null
        pts.push(w[0], w[1], w[2], w[3])
      }
      return { ...rate, axis: -1, p: [], pts }
    },
    pose: (m, u, out) => {
      still(out)
      const n = m.pts.length / 4
      let total = 0
      for (let i = 0; i < n; i++) total += m.pts[i * 4 + 3]
      let at = u * total
      for (let i = 0; i < n; i++) {
        const w = m.pts[i * 4 + 3]
        if (at < w || i === n - 1) {
          const f = Math.min(1, Math.max(0, at / w))
          const from = ((i + n - 1) % n) * 4, to = i * 4
          for (let k = 0; k < 3; k++) out.t[k] = m.pts[from + k] + (m.pts[to + k] - m.pts[from + k]) * f
          return
        }
        at -= w
      }
    },
  },
}

/** Whether a word names a motion this reader knows. */
export function knownMotion(word: string): boolean {
  return Object.prototype.hasOwnProperty.call(MOTIONS, word)
}

/** One entry read, or null: malformed, or a word this reader does not know. */
export function readMotion(raw: unknown): Motion | null {
  if (!Array.isArray(raw) || typeof raw[0] !== 'string' || !knownMotion(raw[0])) return null
  const read = MOTIONS[raw[0]].read(raw.slice(1))
  if (!read) return null
  return { ...read, word: raw[0], tooFast: Math.abs(read.c) > MAX_RATE * read.b }
}

/** A payload's `anim`, as a reader keeps it: the first four entries, each read or ignored (§4.3). Never throws. */
export function readAnim(raw: unknown): Motion[] {
  if (!Array.isArray(raw)) return []
  const out: Motion[] = []
  for (const entry of raw.slice(0, MAX_MOTIONS)) {
    const m = readMotion(entry)
    if (m) out.push(m)
  }
  return out
}

/** The raw field, top level first (as walkConstrain's constrainOf). */
function rawAnim(s: Pick<ShardModel, 'extra'>): unknown {
  const top = (s as { anim?: unknown }).anim
  return top !== undefined ? top : s.extra?.[ANIM_FIELD]
}

const NONE: readonly Motion[] = Object.freeze([])
const parsed = new WeakMap<object, readonly Motion[]>()

/** A model's motions, read once per model object. */
export function animOf(s: Pick<ShardModel, 'extra'>): readonly Motion[] {
  const held = parsed.get(s)
  if (held) return held
  const raw = rawAnim(s)
  const list = raw === undefined ? NONE : readAnim(raw)
  parsed.set(s, list.length ? list : NONE)
  return list.length ? list : NONE
}

/** Whether a model moves at all (any motion it can read). */
export function hasAnim(s: Pick<ShardModel, 'extra'>): boolean {
  return animOf(s).length > 0
}

/**
 * u = frac(c × β / b + φ / 360), in [0, 1). β's whole part is reduced modulo
 * b first, with exact integer arithmetic where it is safe, so the phase keeps
 * its precision at any height (§2.2).
 */
export function phaseAt(r: Rate, beta: number): number {
  const whole = Math.floor(beta)
  const frac = beta - whole
  const b = r.b
  let v: number
  if (b <= 67_108_864 && Math.abs(r.c) <= 67_108_864) {
    const wm = ((whole % b) + b) % b
    const cm = ((r.c % b) + b) % b
    v = ((cm * wm) % b) / b + (r.c * frac) / b + r.phi / 360
  } else {
    v = (r.c * beta) / b + r.phi / 360
  }
  v -= Math.floor(v)
  return v >= 1 ? 0 : v
}

/** A motion's pose at phase u, written into `out`; a too-fast motion is at phase 0. */
export function motionPose(m: Motion, u: number, out: MotionPose): MotionPose {
  MOTIONS[m.word].pose(m, m.tooFast ? 0 : u, out)
  return out
}

export function newPose(): MotionPose {
  return { axis: -1, angle: 0, t: [0, 0, 0] }
}

/**
 * Compose motion poses, in order, into a 4x4 in the RENDER frame (three's
 * column-major elements, model units): every motion is applied in the model
 * frame (cyberspace axes, ticks), first innermost, and the result is carried
 * through sno-core's toRender, the flip (x, y, -z) / 120, so it can sit
 * directly above a mesh drawn in the render frame. `out` is written in place.
 */
export function composeRender(poses: readonly MotionPose[], count: number, out: Float64Array | number[]): void {
  // A 3x3 linear part L (row-major, model frame) and translation T (ticks): p -> L p + T.
  let l0 = 1, l1 = 0, l2 = 0, l3 = 0, l4 = 1, l5 = 0, l6 = 0, l7 = 0, l8 = 1
  let t0 = 0, t1 = 0, t2 = 0
  for (let i = 0; i < count; i++) {
    const q = poses[i]
    // Apply the turn R to both (L, T): L <- R L, T <- R T.
    if (q.axis >= 0 && q.angle !== 0) {
      const c = Math.cos(q.angle), s = Math.sin(q.angle)
      // Right-handed rotation about the axis, row-major r0..r8.
      let r0 = 1, r1 = 0, r2 = 0, r3 = 0, r4 = 1, r5 = 0, r6 = 0, r7 = 0, r8 = 1
      if (q.axis === 0) { r4 = c; r5 = -s; r7 = s; r8 = c }
      else if (q.axis === 1) { r0 = c; r2 = s; r6 = -s; r8 = c }
      else { r0 = c; r1 = -s; r3 = s; r4 = c }
      const n0 = r0 * l0 + r1 * l3 + r2 * l6, n1 = r0 * l1 + r1 * l4 + r2 * l7, n2 = r0 * l2 + r1 * l5 + r2 * l8
      const n3 = r3 * l0 + r4 * l3 + r5 * l6, n4 = r3 * l1 + r4 * l4 + r5 * l7, n5 = r3 * l2 + r4 * l5 + r5 * l8
      const n6 = r6 * l0 + r7 * l3 + r8 * l6, n7 = r6 * l1 + r7 * l4 + r8 * l7, n8 = r6 * l2 + r7 * l5 + r8 * l8
      l0 = n0; l1 = n1; l2 = n2; l3 = n3; l4 = n4; l5 = n5; l6 = n6; l7 = n7; l8 = n8
      const u0 = r0 * t0 + r1 * t1 + r2 * t2, u1 = r3 * t0 + r4 * t1 + r5 * t2, u2 = r6 * t0 + r7 * t1 + r8 * t2
      t0 = u0; t1 = u1; t2 = u2
    }
    t0 += q.t[0]; t1 += q.t[1]; t2 += q.t[2]
  }
  // Render frame: F L F with F = diag(1, 1, -1), translation F T / 120. Column-major.
  out[0] = l0; out[1] = l3; out[2] = -l6; out[3] = 0
  out[4] = l1; out[5] = l4; out[6] = -l7; out[7] = 0
  out[8] = -l2; out[9] = -l5; out[10] = l8; out[11] = 0
  out[12] = t0 / TICKS; out[13] = t1 / TICKS; out[14] = -t2 / TICKS; out[15] = 1
}

// ---- writing --------------------------------------------------------------

/** The canonical entry for a motion (integers only, nothing omitted), as a writer writes it. */
export function writeMotion(m: Motion): unknown[] {
  const axis = m.axis >= 0 ? [AXES[m.axis]] : []
  if (m.word === 'path') {
    const pts: number[][] = []
    for (let i = 0; i < m.pts.length; i += 4) pts.push(m.pts.slice(i, i + 4))
    return [m.word, m.c, m.b, m.phi, ...pts]
  }
  return [m.word, ...axis, ...m.p, m.c, m.b, m.phi]
}

/**
 * `s` with `anim` set to `raw`, read as a reader would and written back
 * canonically; an empty result removes the field. The same object when it
 * already says exactly that. Returns the motions kept too, so a caller can
 * say how many entries were ignored.
 */
export function withAnim<T extends ShardModel>(s: T, raw: unknown): { shard: T; kept: Motion[] } {
  const kept = readAnim(raw)
  const want = kept.length ? kept.map(writeMotion) : undefined
  const extra = s.extra ?? {}
  const top = (s as { anim?: unknown }).anim
  if (top === undefined && JSON.stringify(extra[ANIM_FIELD]) === JSON.stringify(want) && (want !== undefined) === Object.prototype.hasOwnProperty.call(extra, ANIM_FIELD)) return { shard: s, kept }
  const { extra: _old, anim: _a, ...rest } = s as T & { anim?: unknown }
  const entries: Array<[string, unknown]> = Object.entries(extra).filter(([k]) => k !== ANIM_FIELD)
  if (want) entries.push([ANIM_FIELD, want])
  return { shard: (entries.length ? { ...rest, extra: Object.fromEntries(entries) } : rest) as unknown as T, kept }
}

/** A model's `anim` as text for an editor: its raw field as JSON, or empty. */
export function animText(s: Pick<ShardModel, 'extra'>): string {
  const raw = rawAnim(s)
  return raw === undefined ? '' : JSON.stringify(raw)
}
