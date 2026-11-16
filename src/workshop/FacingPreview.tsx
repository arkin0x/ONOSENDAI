/**
 * FacingPreview.tsx - FACING on the bench (DECK-0003 §1.18; arkinox,
 * 2026-11-16: "when upright is chosen, the bench preview shows the avatar
 * upright"). While the AVATAR sheet is open the shape on the bench is turned
 * as it would be on a move up and to the right, which an arrow beside it
 * draws: PATH points its front along the arrow and tilts up with it; UPRIGHT
 * turns to the right and stays on its feet. Both turns are the world's own
 * (lib/facing.ts avatarTurn and uprightTurn) in the default view, so the
 * bench shows exactly what the world will.
 *
 * The handles, the ghost and the face highlight step aside while it shows
 * (Bench), since they stand where the shape is unturned. Close the sheet and
 * the shape is as built again.
 */

import { useLayoutEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { BufferGeometry, Float32BufferAttribute, Line, LineDashedMaterial, Quaternion } from 'three'
import { drawnFace, type FaceMode } from 'sno-core/face'
import { TICKS_PER_UNIT, ticksOf, type ShardModel } from 'sno-core/shards'
import { avatarTurn, facingTurn } from '../lib/facing'
import { ACCENT } from '../lib/palette'
import type { Position, ViewAxes } from '../lib/space'
import { OVERLAY_ORDER } from '../scene/shardFaces'
import { useFacingPreview } from '../store/facingPreview'
import { useWorkshop } from '../store/useWorkshop'

/** The default view, in which the bench draws: screen right +X, up +Y, out of the screen -Z (pose.ts viewPose is then the identity). */
const BENCH_AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: -1 } }

/** The sample move: one step right and one up, in cyberspace axes (the bench's +X and +Y). */
export const SAMPLE_MOVE: readonly [Position, Position] = [{ x: 0n, y: 0n, z: 0n }, { x: 1n, y: 1n, z: 0n }]

/** The turn the shape on the bench carries for `face` on the sample move. Pure. */
export function facingPreviewTurn(face: FaceMode): Quaternion {
  return facingTurn(BENCH_AXES, SAMPLE_MOVE, face)
}

/** How far the shape reaches across and how tall it stands, in bench units, for placing the arrow. */
function reachOf(shard: ShardModel | null): { side: number; top: number; bottom: number } {
  if (!shard || shard.vertices.length === 0) return { side: 0.5, top: 0.5, bottom: -0.5 }
  let side = 0, top = -Infinity, bottom = Infinity
  for (const v of shard.vertices) {
    const t = ticksOf(v)
    side = Math.max(side, Math.hypot(t[0], t[2]) / TICKS_PER_UNIT)
    top = Math.max(top, t[1] / TICKS_PER_UNIT)
    bottom = Math.min(bottom, t[1] / TICKS_PER_UNIT)
  }
  return { side, top, bottom }
}

/** The shape's turn while the preview shows, applied to whatever it wraps (the shape on the bench). */
export function FacingPreviewGroup({ children }: { children: React.ReactNode }): JSX.Element {
  const on = useFacingPreview((s) => s.on)
  const face = useWorkshop((s) => { const c = s.current(); return c ? drawnFace(c) : 'path' })
  const invalidate = useThree((s) => s.invalidate)
  const turn = useMemo(() => (on ? facingPreviewTurn(face) : new Quaternion()), [on, face])
  useLayoutEffect(() => { invalidate() }, [turn, invalidate])
  return <group quaternion={turn}>{children}</group>
}

/** The move the preview turns for: a dashed arrow up and to the right, beside the shape. */
export function FacingArrow(): JSX.Element | null {
  const on = useFacingPreview((s) => s.on)
  const shard = useWorkshop((s) => s.current())
  const r = useMemo(() => reachOf(shard), [shard])
  const line = useMemo(() => {
    const len = Math.max(1, (r.top - r.bottom) * 0.6)
    const x0 = r.side + Math.max(0.5, len * 0.4)
    const y0 = r.bottom
    const k = len / Math.SQRT2
    const head = len * 0.18
    // The shaft, then the two barbs of its head, back along the shaft and off to either side.
    const tip = [x0 + k, y0 + k]
    const back = [-Math.SQRT1_2, -Math.SQRT1_2]
    const barb = (s: number): number[] => [tip[0] + head * (back[0] * Math.cos(s) - back[1] * Math.sin(s)), tip[1] + head * (back[0] * Math.sin(s) + back[1] * Math.cos(s))]
    const a = barb(0.5), b = barb(-0.5)
    const pts = [x0, y0, 0, tip[0], tip[1], 0, tip[0], tip[1], 0, a[0], a[1], 0, tip[0], tip[1], 0, b[0], b[1], 0]
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(pts, 3))
    const l = new Line(g, new LineDashedMaterial({ color: ACCENT, dashSize: len / 12, gapSize: len / 24, depthTest: false, transparent: true, opacity: 0.9, toneMapped: false }))
    l.computeLineDistances()
    l.renderOrder = OVERLAY_ORDER
    return l
  }, [r])
  useLayoutEffect(() => () => { line.geometry.dispose(); (line.material as LineDashedMaterial).dispose() }, [line])
  if (!on) return null
  return <primitive object={line} />
}

/** The path turn alone, for tests that compare the two. */
export const pathPreviewTurn = (): Quaternion => avatarTurn(BENCH_AXES, SAMPLE_MOVE)
