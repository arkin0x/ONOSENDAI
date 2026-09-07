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
import { Quaternion, Vector3, type Camera } from 'three'
import type { WorkPlane } from '../lib/stamps'

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

/** What the view pad asks of the camera: only the way home, now that the arrows turn the grid. */
export type ViewAsk = { kind: 'home' }
export type ViewRequest = ViewAsk & { id: number }

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

export const useBenchView = create<{ axes: BenchAxes; request: ViewRequest | null }>(() => ({ axes: DEFAULT_AXES, request: null }))

let asked = 0
/** Ask the bench camera for the default view. */
export function requestView(ask: ViewAsk): void {
  useBenchView.setState({ request: { ...ask, id: ++asked } })
}
