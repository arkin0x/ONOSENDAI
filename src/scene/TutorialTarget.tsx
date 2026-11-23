/**
 * TutorialTarget.tsx: the first-arrival tutorial's two "go here" marks, both
 * the shared green target box (scene/GreenTargetBox.tsx; owner, 2026-11-23):
 *   - TutorialTarget, the course step's hop target: a 3-gibson cube over the
 *     start square (tutorial/course.ts TARGET_ZONE), any cursor inside it
 *     counts; the white diamond that hid the cursor is gone;
 *   - TutorialBoxMark, step 1's green box (the box region the chest is in),
 *     drawn here in the same green with the same ring and beam, in place of
 *     the staged lime outline shard, which is kept for its region and its taps
 *     but not drawn (tutorial/guideBags.ts drawnByMark).
 *
 * The notes below are the course target's history (owner, 2026-11-13: "make
 * the target clearly visible a couple gibsons above the course").
 *
 * A scene mark, not a sealed shard: a shard can only be still lines or faces,
 * and the world draws a shard's faces blind to the bloom, so the first target
 * (two thin rings) read as a few ticks on a phone among the region lines and
 * the Black Sun. This one glows and moves, so the eye finds it first:
 *   - a white-hot diamond, about two gibsons tall, turning slowly and
 *     breathing, around the target's gibson (tutorial/course.ts TARGET);
 *   - a spring-green ring level round it, a colour nothing else near the
 *     course uses (the box is lime, the regions cyan, yellow and magenta);
 *   - while the course step is up and not yet done, a beam of the same green
 *     from high above down onto it, and a ring that pings outward from it.
 * All of it only while the course step waits (targetPhase); once the player
 * has landed on it, the ring alone stays, still, so their avatar shows inside
 * it, and nothing moves frame to frame.
 * Local only, like everything the tutorial stages: drawn from the layout
 * (pure from the spawn), never sealed, signed or published. Nothing here can
 * be tapped (every mesh's raycast is off) and it is no find, so the workshop
 * step never copies it.
 *
 * It stands down within a few gibsons of the camera: on the target, in
 * WALK, the player is inside it, and after GRAVITY drops them the 2 onto the
 * start square it is over their head. Walked a few gibsons off from under it,
 * the still ring shows again above.
 */

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Quaternion, Vector3, type Group } from 'three'
import type { Plane } from 'cyberspace-core'
import { GRID_RADIUS, itemCentre, type Position, type ViewAxes } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { useTutorial } from '../store/useTutorial'
import { useTutorialStage } from '../tutorial/director'
import { TARGET_SIDE, targetAt } from '../tutorial/course'
import type { TutorialLayout } from '../tutorial/layout'
import { BOX_HEIGHT } from '../tutorial/layout'
import { useDrawReach } from './buildZoom'
import { GreenTargetBox } from './GreenTargetBox'

export { TARGET_GREEN } from './GreenTargetBox'

/** Beyond this it would be drawn somewhere nobody can see. */
const REACH = GRID_RADIUS * 8
/** The step-1 box's side, in gibsons: its height-3 region. */
export const BOX_SIDE = 2 ** BOX_HEIGHT

/** Render cells to a gibson at `scaleExp`, and the turn that stands a mark on cyberspace +Y; null when a gibson is too small to see. */
function scaleAndTurn(scaleExp: number, axes: ViewAxes): { scale: number; turn: Quaternion } | null {
  // A gibson is 2^-scaleExp render cells, as a shard is drawn.
  const scale = 1 / Number(1n << BigInt(scaleExp))
  if (scale < 0.02) return null
  const view = [axes.right, axes.up, axes.out]
  const i = view.findIndex((a) => a.axis === 'y')
  const up = new Vector3(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0).multiplyScalar(i >= 0 ? view[i].dir : 1)
  return { scale, turn: new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), up) }
}

/**
 * Where the course target is drawn, in render cells (the middle of its cube,
 * which is the target gibson's middle), its scale (render cells to a gibson)
 * and the turn that stands it on cyberspace +Y; null while the tutorial is
 * off, its layout not in, the view in the other plane, or the mark too small
 * or too far to see.
 */
export function targetMark(active: boolean, layout: TutorialLayout | null, anchor: Position, anchorPlane: Plane, scaleExp: number, axes: ViewAxes, reach = REACH): { centre: [number, number, number]; scale: number; turn: Quaternion } | null {
  if (!active || !layout || layout.plane !== anchorPlane) return null
  const st = scaleAndTurn(scaleExp, axes)
  if (!st) return null
  // Placed as a shard at that gibson is (itemCentre).
  const centre = itemCentre(targetAt(layout.frame), alignedOrigin(anchor, scaleExp), scaleExp, axes)
  return Math.hypot(...centre) > reach ? null : { centre, ...st }
}

/**
 * Where step 1's box is drawn: the middle of its region (between its lowest
 * and highest gibsons' middles), as targetMark; null as it is.
 */
export function boxMark(layout: TutorialLayout | null, anchor: Position, anchorPlane: Plane, scaleExp: number, axes: ViewAxes, reach = REACH): { centre: [number, number, number]; scale: number; turn: Quaternion } | null {
  if (!layout || layout.plane !== anchorPlane) return null
  const st = scaleAndTurn(scaleExp, axes)
  if (!st) return null
  const origin = alignedOrigin(anchor, scaleExp)
  const b = layout.frame.boxBase
  const top = BigInt(BOX_SIDE - 1)
  const lo = itemCentre(b, origin, scaleExp, axes)
  const hi = itemCentre({ x: b.x + top, y: b.y + top, z: b.z + top }, origin, scaleExp, axes)
  const centre: [number, number, number] = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2]
  return Math.hypot(...centre) > reach ? null : { centre, ...st }
}

/**
 * What of the course target shows, by where the tutorial is: nothing before
 * the course step; the cube, its ring, the beam and the ping while the course
 * step waits ('guiding'); once the player has landed in it, and for the rest
 * of the run, the cube's outline alone ('after').
 */
export type TargetPhase = 'off' | 'guiding' | 'after'

export function targetPhase(s: { active: boolean; done: boolean; index: number; script: { steps: Array<{ id: string }> } }): TargetPhase {
  const course = s.script.steps.findIndex((st) => st.id === 'to-course')
  if (!s.active || course < 0 || s.index < course) return 'off'
  return s.index === course && !s.done ? 'guiding' : 'after'
}

/** Whether step 1's box guides now: the box step up and not yet done (the beam and the ping round it). */
export function boxGuiding(s: { active: boolean; done: boolean; index: number; script: { steps: Array<{ id: string }> } }): boolean {
  return s.active && !s.done && s.script.steps[s.index]?.id === 'box'
}

/** Stands a mark down while the camera is inside its cube (the player is in it, in WALK). */
function useInsideHide(side: number, scale: number | undefined): React.RefObject<Group> {
  const group = useRef<Group>(null)
  useFrame(({ camera }) => {
    const g = group.current
    if (!g || scale === undefined) return
    const inside = camera.position.distanceTo(g.position) <= (side / 2) * scale
    if (g.visible === inside) g.visible = !inside
  })
  return group
}

export function TutorialTarget({ axes }: { axes: ViewAxes }): JSX.Element | null {
  const phase = useTutorial(targetPhase)
  const layout = useTutorialStage((s) => s.layout)
  const anchor = useCyberspace((s) => s.anchor)
  const anchorPlane = useCyberspace((s) => s.anchorPlane)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  // As far as the fog's end needs (buildZoom.ts).
  const reach = useDrawReach((s) => Math.max(REACH, s.reach))
  const at = useMemo(() => targetMark(phase !== 'off', layout, anchor, anchorPlane, scaleExp, axes, reach), [phase, layout, anchorPlane, anchor, scaleExp, axes, reach])
  const group = useInsideHide(TARGET_SIDE, at?.scale)
  if (!at) return null
  return (
    <group ref={group} position={at.centre}>
      <GreenTargetBox name="tutorial-target" centre={[0, 0, 0]} scale={at.scale} turn={at.turn} side={TARGET_SIDE} guiding={phase === 'guiding'} />
    </group>
  )
}

export function TutorialBoxMark({ axes }: { axes: ViewAxes }): JSX.Element | null {
  const staged = useTutorialStage((s) => s.stage !== null)
  const layout = useTutorialStage((s) => s.layout)
  const guiding = useTutorial(boxGuiding)
  const anchor = useCyberspace((s) => s.anchor)
  const anchorPlane = useCyberspace((s) => s.anchorPlane)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const reach = useDrawReach((s) => Math.max(REACH, s.reach))
  const at = useMemo(() => (staged ? boxMark(layout, anchor, anchorPlane, scaleExp, axes, reach) : null), [staged, layout, anchorPlane, anchor, scaleExp, axes, reach])
  const group = useInsideHide(BOX_SIDE, at?.scale)
  if (!at) return null
  return (
    <group ref={group} position={at.centre}>
      <GreenTargetBox name="tutorial-box" centre={[0, 0, 0]} scale={at.scale} turn={at.turn} side={BOX_SIDE} guiding={guiding} />
    </group>
  )
}
