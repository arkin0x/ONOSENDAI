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

export type ViewDir = 'up' | 'down' | 'left' | 'right'
/** What the view pad and keys ask of the camera. */
export type ViewAsk = { kind: 'rotate'; dir: ViewDir } | { kind: 'top' } | { kind: 'back' }
export type ViewRequest = ViewAsk & { id: number }

export const useBenchView = create<{ axes: BenchAxes; request: ViewRequest | null; canGoBack: boolean }>(() => ({ axes: DEFAULT_AXES, request: null, canGoBack: false }))

let asked = 0
/** Ask the bench camera for a quarter turn, the top view, or the view before. */
export function requestView(ask: ViewAsk): void {
  useBenchView.setState({ request: { ...ask, id: ++asked } })
}
