/**
 * animEdit.ts: the workshop's animation editor, as data (the drawing is
 * workshop/AnimEditor.tsx). Pure: presets with familiar names that write the
 * canonical motions, the unit conversions between what the controls show and
 * what the field stores, and every edit, each returning a new motion list
 * that only ever holds what DECK-0003 §1.14 lets a writer write.
 *
 * Names live here, never in the data (motion research 2026-11-14): the menu
 * says SPIN, the payload says `turn`.
 *
 * Two frames. The field is written in DECK-0003's §2 frame (+Z toward the
 * viewer); the workshop shows sno-core's frame, cyberspace axes, where the
 * bench's blue Z arrow points into the screen. So a point or a signed travel
 * along Z is negated between what the controls show and what is stored
 * (uiZ / dataZ). Distances the controls show are in gibsons: a tick is
 * 1/120 of a model unit, and a model unit is 2^unit gibsons.
 */

import type { ShardModel } from 'sno-core/shards'
import { gcd, MAX_MOTIONS, MAX_PER_SECOND, MAX_SECONDS, MAX_WEIGHT, PATH_MAX, PATH_MIN, readMotion, REACH, writeMotion, type Motion } from './anim'

const TICKS = 120

/** What each motion is called in the editor: the preset that writes it (a BOB is a small BACK AND FORTH). */
export const MOTION_NAMES: Readonly<Record<string, string>> = {
  turn: 'SPIN', swing: 'PENDULUM', slide: 'BACK AND FORTH', orbit: 'FERRIS WHEEL', lift: 'ELEVATOR', path: 'FOLLOW PATH',
}

export type PresetId = 'spin' | 'bob' | 'pendulum' | 'slide' | 'elevator' | 'orbit' | 'path'

export interface Preset {
  id: PresetId
  /** The button's label. */
  label: string
  /** Its tooltip. */
  tip: string
  /** The motion, in the §2 frame, sized for an object that reaches `size` ticks from its origin. */
  make: (size: number) => unknown[]
}

const clampReach = (n: number): number => Math.max(1, Math.min(REACH, Math.round(n)))

/**
 * The presets, in menu order. Speeds are c cycles every b seconds, short
 * fractions: SPIN's 1 every 20 s is 3 turns a minute.
 */
export const PRESETS: readonly Preset[] = [
  { id: 'spin', label: 'SPIN', tip: 'Turn round and round', make: () => ['turn', 'y', 1, 20, 0] },
  { id: 'bob', label: 'BOB', tip: 'Float up and down a little', make: (r) => ['slide', 'y', clampReach(Math.max(15, r / 8)), 1, 4, 0] },
  { id: 'pendulum', label: 'PENDULUM', tip: 'Swing back and forth', make: () => ['swing', 'x', 30, 1, 10, 0] },
  { id: 'slide', label: 'BACK AND FORTH', tip: 'Glide side to side', make: (r) => ['slide', 'x', clampReach(r), 1, 15, 0] },
  { id: 'elevator', label: 'ELEVATOR', tip: 'Rise, wait, come back', make: (r) => ['lift', 'y', clampReach(Math.max(240, 2 * r)), 25, 1, 30, 0] },
  { id: 'orbit', label: 'FERRIS WHEEL', tip: 'Ride a circle, stay upright', make: (r) => ['orbit', 'z', clampReach(r), 1, 30, 0] },
  { id: 'path', label: 'FOLLOW PATH', tip: 'Travel a loop of points', make: (r) => { const d = clampReach(Math.max(240, r)); return ['path', 1, 60, 0, [d, 0, 0, 1], [0, 0, 0, 1]] } },
]

/** How far an object reaches from its origin, in ticks of its own lattice: what a preset sizes to (at least one unit). */
export function objectReach(s: Pick<ShardModel, 'vertices'>): number {
  let m = 0
  for (const v of s.vertices) for (let k = 0; k < 3; k++) m = Math.max(m, Math.abs(v.p[k] * TICKS + (v.t?.[k] ?? 0)))
  return Math.max(TICKS, Math.min(REACH, m))
}

// ---- messages ------------------------------------------------------------------

/** The plain messages the editor shows when an edit meets a limit. */
export const LIMITS = {
  motions: `Up to ${MAX_MOTIONS} motions`,
  speed: `Top speed is ${MAX_PER_SECOND * 60} a minute`,
  slowest: 'That is as slow as it goes',
  points: `Up to ${PATH_MAX} points`,
  fewPoints: `A path needs ${PATH_MIN} points`,
  reach: 'That is as far as it goes',
  near: 'That is as small as it goes',
  time: 'A leg takes up to 1000',
  ratio: 'Same timing, smaller numbers',
  flicker: 'This may flicker more than 3 times a second',
} as const

/** An edit's result: the new list, and a message when a limit changed what was asked. */
export interface Edited { list: Motion[]; note?: string }

// ---- units ---------------------------------------------------------------------

/** Ticks to gibsons, for an object of `unit`. */
export function gibsonsOf(ticks: number, unit: number): number {
  return (ticks / TICKS) * 2 ** unit
}

/** Gibsons to whole ticks, for an object of `unit`. */
export function ticksOf(gibsons: number, unit: number): number {
  return Math.round((gibsons / 2 ** unit) * TICKS)
}

/** Cycles a minute, signed. */
export function perMinute(m: Pick<Motion, 'c' | 'b'>): number {
  return (m.c / m.b) * 60
}

/**
 * The rate for a speed in cycles a minute (its sign the direction): exactly
 * what is shown, to two decimals, as c cycles every b seconds in lowest
 * terms (3 a minute is 1 every 20 s; 2.5 is 1 every 24 s), clamped to what
 * the field allows (at most one a second, never stopped). A note when clamped.
 */
export function rateFor(perMin: number): { c: number; b: number; note?: string } {
  const sign = perMin < 0 || Object.is(perMin, -0) ? -1 : 1
  // Hundredths of a cycle a minute: the speed over 6000 is cycles a second.
  const hundredths = Math.round(Math.abs(perMin) * 100)
  if (hundredths > MAX_PER_SECOND * 6000) return { c: sign * MAX_PER_SECOND, b: 1, note: LIMITS.speed }
  if (hundredths === 0) return { c: sign, b: MAX_SECONDS, note: LIMITS.slowest }
  const g = gcd(hundredths, 6000)
  return { c: sign * (hundredths / g), b: 6000 / g }
}

/**
 * Whether a motion may flicker more than three times a second (§1.14: an
 * authoring tool SHOULD warn): its cycles a second, times its legs for a path.
 */
export function mayFlicker(m: Motion): boolean {
  const perSecond = Math.abs(m.c) / m.b
  const flashes = m.word === 'path' ? perSecond * (m.pts.length / 4) : perSecond
  return flashes > 3
}

/** The speeds the − and + step through, cycles a minute. */
export const SPEED_STEPS = [0.1, 0.2, 0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50] as const

/** The next speed step up (dir 1) or down (dir −1) from `perMin`'s size. */
export function stepSpeed(perMin: number, dir: 1 | -1): number {
  const a = Math.abs(perMin)
  const sign = perMin < 0 ? -1 : 1
  const next = dir > 0 ? SPEED_STEPS.find((s) => s > a * 1.0001) : [...SPEED_STEPS].reverse().find((s) => s < a * 0.9999)
  return sign * (next ?? (dir > 0 ? SPEED_STEPS[SPEED_STEPS.length - 1] : SPEED_STEPS[0]))
}

/** A speed for showing: up to two decimals, no trailing zeros. */
export function showNumber(n: number): string {
  const r = Math.round(n * 100) / 100
  return String(Object.is(r, -0) ? 0 : r)
}

// ---- the frames ------------------------------------------------------------------

/** A stored z (§2 frame) as the workshop shows it, and back: the same negation both ways. */
export function uiZ(z: number): number { return 0 - z }
export const dataZ = uiZ

// ---- edits -----------------------------------------------------------------------

/** The motions an object carries, as the editor edits them. */
export function listOf(raw: readonly unknown[]): Motion[] {
  const out: Motion[] = []
  for (const e of raw.slice(0, MAX_MOTIONS)) { const m = readMotion(e); if (m) out.push(m) }
  return out
}

/** The list as the field stores it (canonical, lib/anim writeMotion). */
export function rawOf(list: readonly Motion[]): unknown[][] {
  return list.map(writeMotion)
}

const copy = (m: Motion): Motion => ({ ...m, p: [...m.p], pts: [...m.pts] })
const replace = (list: readonly Motion[], i: number, m: Motion): Motion[] => list.map((x, k) => (k === i ? m : x))

/** A preset added at the end, sized for the object. */
export function addPreset(list: readonly Motion[], id: PresetId, size: number): Edited {
  if (list.length >= MAX_MOTIONS) return { list: [...list], note: LIMITS.motions }
  const preset = PRESETS.find((p) => p.id === id)
  const m = preset ? readMotion(preset.make(size)) : null
  return m ? { list: [...list, m] } : { list: [...list] }
}

export function removeMotion(list: readonly Motion[], i: number): Edited {
  return { list: list.filter((_, k) => k !== i) }
}

/** Motion i moved one place earlier (dir −1) or later (dir 1). Order is meaning: the first is innermost. */
export function moveMotion(list: readonly Motion[], i: number, dir: 1 | -1): Edited {
  const j = i + dir
  if (j < 0 || j >= list.length) return { list: [...list] }
  const out = [...list]
  ;[out[i], out[j]] = [out[j], out[i]]
  return { list: out }
}

export function setAxis(list: readonly Motion[], i: number, axis: 0 | 1 | 2): Edited {
  const m = list[i]
  if (!m || m.axis < 0) return { list: [...list] }
  const next = { ...copy(m), axis }
  // An elevator's travel is signed, and Z is shown negated: keep the number shown when crossing Z.
  if (m.word === 'lift' && (m.axis === 2) !== (axis === 2)) next.p[0] = 0 - m.p[0]
  return { list: replace(list, i, next) }
}

/** Motion i at a speed in cycles a minute (its sign the direction), stored as c/b in lowest terms. */
export function setSpeed(list: readonly Motion[], i: number, perMin: number): Edited {
  const m = list[i]
  if (!m) return { list: [...list] }
  const r = rateFor(perMin)
  const next = { ...copy(m), c: r.c, b: r.b }
  return { list: replace(list, i, next), note: r.note ?? (mayFlicker(next) ? LIMITS.flicker : undefined) }
}

/** Motion i run the other way. */
export function reverse(list: readonly Motion[], i: number): Edited {
  const m = list[i]
  return m ? { list: replace(list, i, { ...copy(m), c: -m.c }) } : { list: [...list] }
}

/** Motion i with its phase offset at `deg`, wrapped into 0..359. */
export function setPhase(list: readonly Motion[], i: number, deg: number): Edited {
  const m = list[i]
  if (!m) return { list: [...list] }
  const phi = ((Math.round(deg) % 360) + 360) % 360
  return { list: replace(list, i, { ...copy(m), phi }) }
}

/** What a motion's AMOUNT is: degrees for a pendulum, gibsons for the rest that have one. */
export function amountKind(m: Motion): 'degrees' | 'distance' | null {
  if (m.word === 'swing') return 'degrees'
  if (m.word === 'slide' || m.word === 'orbit' || m.word === 'lift') return 'distance'
  return null
}

/** Motion i's AMOUNT as the controls show it: degrees, or gibsons (a lift's signed, in the workshop's frame). */
export function amountOf(m: Motion, unit: number): number {
  if (m.word === 'swing') return m.p[0]
  if (m.word === 'lift') return gibsonsOf(m.axis === 2 ? uiZ(m.p[0]) : m.p[0], unit)
  return gibsonsOf(m.p[0], unit)
}

/** Motion i with its AMOUNT set from what the controls show, clamped to the field's range. */
export function setAmount(list: readonly Motion[], i: number, value: number, unit: number): Edited {
  const m = list[i]
  if (!m || amountKind(m) === null) return { list: [...list] }
  const p = [...m.p]
  let note: string | undefined
  if (m.word === 'swing') {
    const d = Math.round(value)
    p[0] = Math.max(1, Math.min(180, d))
    if (p[0] !== d) note = d > 180 ? LIMITS.reach : LIMITS.near
  } else {
    let t = ticksOf(value, unit)
    if (m.word === 'lift') {
      if (m.axis === 2) t = dataZ(t)
      const want = t
      t = Math.max(-REACH, Math.min(REACH, t))
      if (t === 0) t = want < 0 ? -1 : 1
      if (Math.abs(want) > REACH) note = LIMITS.reach
      else if (want === 0) note = LIMITS.near
    } else {
      const want = t
      t = Math.max(1, Math.min(REACH, t))
      if (want > REACH) note = LIMITS.reach
      else if (want < 1) note = LIMITS.near
    }
    p[0] = t
  }
  return { list: replace(list, i, { ...copy(m), p }), note }
}

/** An elevator's rest share at each stop, whole percent 0..49. */
export function setRest(list: readonly Motion[], i: number, percent: number): Edited {
  const m = list[i]
  if (!m || m.word !== 'lift') return { list: [...list] }
  const d = Math.max(0, Math.min(49, Math.round(percent)))
  const p = [...m.p]
  p[1] = d
  return { list: replace(list, i, { ...copy(m), p }), note: d !== Math.round(percent) ? (percent > 49 ? 'Rests take up to 49% at each stop' : LIMITS.near) : undefined }
}

// ---- path points ------------------------------------------------------------------

/** A path's points as the controls show them: gibsons in the workshop's frame, and each leg's time share. */
export interface ShownPoint { x: number; y: number; z: number; time: number }

export function pointsOf(m: Motion, unit: number): ShownPoint[] {
  const out: ShownPoint[] = []
  for (let i = 0; i < m.pts.length; i += 4) out.push({ x: gibsonsOf(m.pts[i], unit), y: gibsonsOf(m.pts[i + 1], unit), z: gibsonsOf(uiZ(m.pts[i + 2]), unit), time: m.pts[i + 3] })
  return out
}

/** One coordinate or the time share of point j of path i, set from what the controls show. */
export function setPoint(list: readonly Motion[], i: number, j: number, key: keyof ShownPoint, value: number, unit: number): Edited {
  const m = list[i]
  if (!m || m.word !== 'path' || j < 0 || j * 4 >= m.pts.length) return { list: [...list] }
  const pts = [...m.pts]
  let note: string | undefined
  if (key === 'time') {
    const w = Math.round(value)
    pts[j * 4 + 3] = Math.max(1, Math.min(MAX_WEIGHT, w))
    if (pts[j * 4 + 3] !== w) note = w > MAX_WEIGHT ? LIMITS.time : LIMITS.near
    else {
      // The field keeps the weights with no common factor (§1.14): say so when the numbers shrink.
      let g = 0
      for (let q = 3; q < pts.length; q += 4) g = gcd(g, pts[q])
      if (g > 1) note = LIMITS.ratio
    }
  } else {
    const k = key === 'x' ? 0 : key === 'y' ? 1 : 2
    let t = ticksOf(value, unit)
    if (k === 2) t = dataZ(t)
    const want = t
    t = Math.max(-REACH, Math.min(REACH, t))
    if (t !== want) note = LIMITS.reach
    pts[j * 4 + k] = t
  }
  return { list: replace(list, i, { ...copy(m), pts }), note }
}

/**
 * A point added after point j, one model unit up from it. With no j, it goes
 * just before the last point, so a path that starts at its rest pose (its last
 * point at the origin, §1.14) keeps doing so.
 */
export function addPoint(list: readonly Motion[], i: number, after?: number): Edited {
  const m = list[i]
  if (!m || m.word !== 'path') return { list: [...list] }
  const n = m.pts.length / 4
  if (n >= PATH_MAX) return { list: [...list], note: LIMITS.points }
  const j = after === undefined ? n - 2 : Math.max(0, Math.min(n - 1, after))
  const src = m.pts.slice(j * 4, j * 4 + 4)
  const next = [src[0], Math.max(-REACH, Math.min(REACH, src[1] + TICKS)), src[2], src[3]]
  const pts = [...m.pts.slice(0, (j + 1) * 4), ...next, ...m.pts.slice((j + 1) * 4)]
  return { list: replace(list, i, { ...copy(m), pts }) }
}

export function removePoint(list: readonly Motion[], i: number, j: number): Edited {
  const m = list[i]
  if (!m || m.word !== 'path') return { list: [...list] }
  if (m.pts.length / 4 <= PATH_MIN) return { list: [...list], note: LIMITS.fewPoints }
  const pts = [...m.pts.slice(0, j * 4), ...m.pts.slice((j + 1) * 4)]
  return { list: replace(list, i, { ...copy(m), pts }) }
}

export function movePoint(list: readonly Motion[], i: number, j: number, dir: 1 | -1): Edited {
  const m = list[i]
  const n = m ? m.pts.length / 4 : 0
  const k = j + dir
  if (!m || m.word !== 'path' || k < 0 || k >= n) return { list: [...list] }
  const pts = [...m.pts]
  for (let q = 0; q < 4; q++) [pts[j * 4 + q], pts[k * 4 + q]] = [pts[k * 4 + q], pts[j * 4 + q]]
  return { list: replace(list, i, { ...copy(m), pts }) }
}

/** The longest cycle among the motions, in seconds: what the scrub runs through once. */
export function cycleSeconds(list: readonly Pick<Motion, 'c' | 'b'>[]): number {
  let longest = 0
  for (const m of list) if (m.c !== 0) longest = Math.max(longest, m.b / Math.abs(m.c))
  return longest || 1
}

/** Whether b stays within the field (a speed so slow it could not be written is clamped first by rateFor). */
export function rateWritable(m: Pick<Motion, 'c' | 'b'>): boolean {
  return m.c !== 0 && m.b >= 1 && m.b <= MAX_SECONDS && Math.abs(m.c) <= MAX_PER_SECOND * m.b
}
