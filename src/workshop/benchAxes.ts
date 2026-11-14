/**
 * benchAxes.ts - which way is up on the bench.
 *
 * The nudge keys and pad speak in screen terms, as the cursor's do in the
 * world: W is screen up, S screen down, A left, D right, R into the screen,
 * F out of it. The bench camera orbits freely, so each of those is snapped to
 * the world axis it most nearly points along, and re-snapped as the camera
 * turns. A small store carries the snapped axes out of the canvas for the
 * pad's labels.
 */

import { create } from 'zustand'
import { Quaternion, Spherical, Vector3, type Camera } from 'three'
import type { WorkPlane } from 'sno-core/stamps'

export type NudgeName = 'up' | 'down' | 'left' | 'right' | 'away' | 'toward'

export interface BenchAxis {
  axis: 0 | 1 | 2
  dir: 1 | -1
}

export interface BenchAxes {
  /** World axis pointing right on screen. */
  right: BenchAxis
  /** World axis pointing up on screen. */
  up: BenchAxis
  /** World axis pointing out of the screen, toward the viewer. */
  out: BenchAxis
}

const snap = (v: Vector3): BenchAxis => {
  const a = [Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)]
  const axis: 0 | 1 | 2 = a[0] >= a[1] && a[0] >= a[2] ? 0 : a[1] >= a[2] ? 1 : 2
  const c = axis === 0 ? v.x : axis === 1 ? v.y : v.z
  return { axis, dir: c >= 0 ? 1 : -1 }
}

const RIGHT = new Vector3(), UP = new Vector3(), OUT = new Vector3()

/** The camera's basis, snapped to world axes. */
export function benchAxes(camera: Camera): BenchAxes {
  const q = camera.quaternion
  return {
    right: snap(RIGHT.set(1, 0, 0).applyQuaternion(q)),
    up: snap(UP.set(0, 1, 0).applyQuaternion(q)),
    out: snap(OUT.set(0, 0, 1).applyQuaternion(q)),
  }
}

export interface Nudge {
  axis: 0 | 1 | 2
  delta: 1 | -1
}

/**
 * The model move a screen direction means under these axes. The axes are in
 * render terms; model +Z is render -Z (shards.ts toRender), so a move along
 * render Z comes out with its sign turned.
 */
export function nudgeFor(axes: BenchAxes, name: NudgeName): Nudge {
  const model = (n: Nudge): Nudge => (n.axis === 2 ? { axis: 2, delta: n.delta === 1 ? -1 : 1 } : n)
  const flip = (a: BenchAxis): Nudge => model({ axis: a.axis, delta: a.dir === 1 ? -1 : 1 })
  const keep = (a: BenchAxis): Nudge => model({ axis: a.axis, delta: a.dir })
  switch (name) {
    case 'right': return keep(axes.right)
    case 'left': return flip(axes.right)
    case 'up': return keep(axes.up)
    case 'down': return flip(axes.up)
    case 'toward': return keep(axes.out)
    case 'away': return flip(axes.out)
  }
}

/** "+Y", "−Z": what the pad prints under each arrow. */
export function nudgeLabel(n: Nudge): string {
  return `${n.delta > 0 ? '+' : '−'}${'XYZ'[n.axis]}`
}

export const sameAxes = (a: BenchAxes, b: BenchAxes): boolean =>
  a.right.axis === b.right.axis && a.right.dir === b.right.dir &&
  a.up.axis === b.up.axis && a.up.dir === b.up.dir &&
  a.out.axis === b.out.axis && a.out.dir === b.out.dir

/** The bench's default view: X right, Y up, Z toward the viewer. */
export const DEFAULT_AXES: BenchAxes = { right: { axis: 0, dir: 1 }, up: { axis: 1, dir: 1 }, out: { axis: 2, dir: 1 } }

/** The bench camera's orientation, for the compass in its own canvas. Mutable, per frame, never store state. */
export const benchPose = new Quaternion()
let poseFrames = 0
/** How many frames have written benchPose: a count taken now and seen to grow means the pose is fresh. */
export const benchPoseFrames = (): number => poseFrames
/** The bench writes its camera's pose (Bench ViewDriver), every frame it draws. */
export function notePose(q: Quaternion): void { benchPose.copy(q); poseFrames++ }

/**
 * What the view ball's menu asks of the camera: HOME (the opening view),
 * FIT (the whole shard, seen from where you are), or straight down a world
 * axis, TOP, FRONT or SIDE (workshop redesign, phase 1).
 */
export type ViewKind = 'home' | 'fit' | 'top' | 'front' | 'side'
export type ViewAsk = { kind: ViewKind }
export type ViewRequest = ViewAsk & { id: number }

/**
 * The camera's direction from its target for each fixed view, in render
 * units. TOP is a hair off the vertical, since straight down the up axis
 * leaves the camera no way to know which way is up; FRONT and SIDE look from
 * the side HOME opens on, so a view and HOME are never back to front.
 */
export const VIEW_DIRS: Record<'top' | 'front' | 'side', [number, number, number]> = {
  top: [0, 1, 0.001],
  front: [0, 0, 1],
  side: [1, 0, 0],
}

/**
 * The working grid after a quarter turn about a screen axis. 'tip' turns it
 * about the screen's horizontal (the top comes toward you), 'roll' about the
 * line of sight. A plane is its normal axis, so a turn about the normal itself
 * changes nothing; then the turn is taken about the screen's vertical instead,
 * so every arrow does something from every view. Either way round lands on
 * the same plane, which is why the pad's opposite arrows agree.
 */
export function planeAfter(plane: WorkPlane, axes: BenchAxes, about: 'tip' | 'roll'): WorkPlane {
  let a: number = about === 'tip' ? axes.right.axis : axes.out.axis
  if (a === plane) a = axes.up.axis
  if (a === plane) return plane
  return (3 - plane - a) as WorkPlane
}

/**
 * How much of the bench the workshop's fixed places and an open sheet cover,
 * in CSS pixels from the top and from the bottom (Workshop measures them),
 * and `rest`, what the bottom bars alone cover with no sheet up. The bench
 * frames the shard into what is left, so a sheet never hides it (Bench
 * Framer; workshop redesign, phase 1).
 */
export interface BenchInsets {
  top: number
  bottom: number
  rest?: number
  /** A side panel (landscape phone, desktop: the open area as a column) covering the right, in CSS pixels. */
  right?: number
}

export const useBenchView = create<{ axes: BenchAxes; request: ViewRequest | null; insets: BenchInsets }>(() => ({ axes: DEFAULT_AXES, request: null, insets: { top: 0, bottom: 0, rest: 0, right: 0 } }))

/** One axis of frameOffset: a virtual length and where the shown part starts. */
function frameAxis(length: number, shift: number): { full: number; at: number } {
  // Shown band [0, length] of a virtual one `length + |shift|` long: its
  // middle lands at (length - shift) / 2, the middle of what is uncovered.
  return shift > 0 ? { full: length + shift, at: shift } : { full: length - shift, at: 0 }
}

/**
 * The camera's view offset for insets on a canvas `width` by `height`: a
 * larger virtual view whose middle sits in the middle of the uncovered part,
 * of which the canvas shows the part on screen; down from the top bar to the
 * strip or a sheet, and in from a side panel on the right (phase 5). Null when
 * the uncovered part is already centred. Pure, so the framing is tested
 * without a camera.
 */
export function frameOffset(width: number, height: number, insets: BenchInsets): { fullWidth: number; fullHeight: number; x: number; y: number; width: number; height: number } | null {
  const shiftY = Math.round(insets.bottom - insets.top)
  const shiftX = Math.round(insets.right ?? 0)
  if (width <= 0 || height <= 0 || (shiftY === 0 && shiftX === 0) || Math.abs(shiftY) >= height || Math.abs(shiftX) >= width) return null
  const v = frameAxis(height, shiftY)
  const h = frameAxis(width, shiftX)
  return { fullWidth: h.full, fullHeight: v.full, x: h.at, y: v.at, width, height }
}

/**
 * The camera zoom that goes with frameOffset: the field of view spans the
 * whole virtual view's height, so without it the shown part would be
 * magnified by fullHeight / height (a three.js view offset keeps pixels
 * square, so the height alone sets the scale). At rest (no sheet up) the
 * bench keeps the scale it always had; a sheet or a side panel shrinks it by
 * the share of the resting band it takes, so what fitted still fits. Pure.
 */
export function frameZoom(height: number, fullHeight: number, insets: BenchInsets, width = 0): number {
  if (height <= 0 || fullHeight <= 0) return 1
  const rest = Math.min(insets.rest ?? insets.bottom, insets.bottom)
  const restBand = height - insets.top - rest
  const band = height - insets.top - insets.bottom
  const fitY = restBand > 0 && band > 0 ? band / restBand : 1
  const right = insets.right ?? 0
  const fitX = width > 0 && right > 0 && right < width ? (width - right) / width : 1
  return (height / fullHeight) * Math.min(1, fitY, fitX)
}

/** The old orbit ball's diameter in CSS pixels, kept as the drag's scale: the view ball turns the view as the ball did. */
export const SPHERE_PX = 152
/** A drag across the ball's full width turns the view half way round. */
export const RAD_PER_PX = Math.PI / SPHERE_PX
/** The poles stay a hair away, as OrbitControls keeps them: straight along the up axis loses the up vector. */
const POLE_MARGIN = 0.02

/**
 * The camera's offset from its target after a drag of dx, dy pixels on the
 * view ball: longitude from dx, latitude from dy, the same senses as a drag
 * on the bench itself (right turns the view left round the target, down
 * brings the top toward you), the poles kept clear. Pure, so the ball's feel
 * is tested without a camera.
 */
export function orbitOffset(offset: Vector3, dx: number, dy: number, radPerPx: number = RAD_PER_PX): Vector3 {
  const s = new Spherical().setFromVector3(offset)
  s.theta -= dx * radPerPx
  s.phi = Math.min(Math.PI - POLE_MARGIN, Math.max(POLE_MARGIN, s.phi - dy * radPerPx))
  return new Vector3().setFromSpherical(s)
}

type OrbitSink = (dx: number, dy: number) => void
let orbitSink: OrbitSink | null = null
/** The bench registers what an orbit drag does to its camera (Bench ViewDriver); null while no bench is up. */
export function setOrbitSink(sink: OrbitSink | null): void { orbitSink = sink }
/** Turn the bench view by a drag of dx, dy pixels on the view ball. Nothing happens without a bench. */
export function orbitBy(dx: number, dy: number): void { orbitSink?.(dx, dy) }

let asked = 0
/** Ask the bench camera for the default view. */
export function requestView(ask: ViewAsk): void {
  useBenchView.setState({ request: { ...ask, id: ++asked } })
}

/**
 * Where the move handles stand on screen (workshop redesign, phase 2,
 * decision 2): the middle of what is held, and for each model axis the
 * screen pixels one unit along it covers, in canvas pixels. Model +Z is
 * render -Z, which the bench folds in before it reports. Null while nothing
 * is held or nothing held is in front of the camera.
 */
export interface HandleFrame { center: [number, number]; perUnit: [[number, number], [number, number], [number, number]] }

type HandleSink = (frame: HandleFrame | null) => void
let handleSink: HandleSink | null = null
/** The move handles listen here (shell/MoveHandles); the bench reports every frame it draws with something held. */
export function setHandleSink(sink: HandleSink | null): void { handleSink = sink }
/** The bench's report (Bench HandleProjector). */
export function reportHandles(frame: HandleFrame | null): void { handleSink?.(frame) }

/**
 * Grid steps a drag of `dx`, `dy` CSS pixels moves along an axis whose unit
 * covers `perUnit` pixels on screen: the drag's share along the axis, in
 * units, then in ticks, rounded to whole steps of `step` ticks. An axis seen
 * end on (under a pixel a unit) moves nothing rather than leaping. Pure.
 */
export function handleSteps(dx: number, dy: number, perUnit: readonly [number, number], ticksPerUnit: number, step: number): number {
  const len2 = perUnit[0] * perUnit[0] + perUnit[1] * perUnit[1]
  if (len2 < 1 || step <= 0) return 0
  const units = (dx * perUnit[0] + dy * perUnit[1]) / len2
  return Math.round((units * ticksPerUnit) / step)
}
