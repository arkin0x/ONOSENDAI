/**
 * TutorialTarget.tsx: the first-arrival tutorial's hop target, drawn while
 * the tutorial runs (owner, 2026-11-13: "make the target clearly visible a
 * couple gibsons above the course").
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
import { AdditiveBlending, Quaternion, Vector3, type Group, type Mesh, type MeshBasicMaterial } from 'three'
import { OFF_FACES, OVER_FACES } from './ClipWalls'
import type { Plane } from 'cyberspace-core'
import { GRID_RADIUS, itemCentre, type Position, type ViewAxes } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { useTutorial } from '../store/useTutorial'
import { useTutorialStage } from '../tutorial/director'
import { targetAt } from '../tutorial/course'
import type { TutorialLayout } from '../tutorial/layout'

/** The ring and the beam: spring green, apart from every colour already on the course. */
export const TARGET_GREEN = '#2bff88'
/** The diamond's half height, in gibsons: about two tall, filling the target's cell and more. */
const DIAMOND = 1.05
/** The level ring's radius, in gibsons. */
const RING = 1.75
/** How far above the target the beam reaches, in gibsons. */
const BEAM = 16
/** Within this many gibsons of the camera it stands down (the player is inside it, or right under it). */
const NEAR = 3
/** One ping outward, in seconds. */
const PING_S = 1.6
/** Beyond this it would be drawn somewhere nobody can see. */
const REACH = GRID_RADIUS * 8
/** Off the raycaster: nothing here is a thing to tap. */
const noRaycast = (): void => {}

/**
 * Where the mark is drawn, in render cells, its scale (render cells to a
 * gibson) and the turn that stands it on cyberspace +Y; null while the
 * tutorial is off, its layout not in, the view in the other plane, or the
 * mark too small or too far to see.
 */
export function targetMark(active: boolean, layout: TutorialLayout | null, anchor: Position, anchorPlane: Plane, scaleExp: number, axes: ViewAxes): { centre: [number, number, number]; scale: number; turn: Quaternion } | null {
  if (!active || !layout || layout.plane !== anchorPlane) return null
  // A gibson is 2^-scaleExp render cells, as a shard is drawn.
  const scale = 1 / Number(1n << BigInt(scaleExp))
  if (scale < 0.02) return null
  // Placed as a shard at that gibson is (itemCentre), and turned so its up is cyberspace +Y however the view is turned.
  const centre = itemCentre(targetAt(layout.frame), alignedOrigin(anchor, scaleExp), scaleExp, axes)
  const view = [axes.right, axes.up, axes.out]
  const i = view.findIndex((a) => a.axis === 'y')
  const up = new Vector3(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0).multiplyScalar(i >= 0 ? view[i].dir : 1)
  const turn = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), up)
  return Math.hypot(...centre) > REACH ? null : { centre, scale, turn }
}

/**
 * What of the mark shows, by where the tutorial is: nothing before the course
 * step; the whole mark, turning and breathing with its beam and ping, while
 * the course step waits ('guiding'); once the player has landed on it, and
 * for the rest of the run, the green ring alone and still ('after'), which
 * their avatar sits inside, visible (the diamond would swallow it).
 */
export type TargetPhase = 'off' | 'guiding' | 'after'

export function targetPhase(s: { active: boolean; done: boolean; index: number; script: { steps: Array<{ id: string }> } }): TargetPhase {
  const course = s.script.steps.findIndex((st) => st.id === 'to-course')
  if (!s.active || course < 0 || s.index < course) return 'off'
  return s.index === course && !s.done ? 'guiding' : 'after'
}

export function TutorialTarget({ axes }: { axes: ViewAxes }): JSX.Element | null {
  const phase = useTutorial(targetPhase)
  const layout = useTutorialStage((s) => s.layout)
  const anchor = useCyberspace((s) => s.anchor)
  const anchorPlane = useCyberspace((s) => s.anchorPlane)
  const scaleExp = useCyberspace((s) => s.scaleExp)

  const at = useMemo(() => targetMark(phase !== 'off', layout, anchor, anchorPlane, scaleExp, axes), [phase, layout, anchorPlane, anchor, scaleExp, axes])
  const guiding = phase === 'guiding'

  const group = useRef<Group>(null)
  const diamond = useRef<Mesh>(null)
  const pings = useRef<Array<Mesh | null>>([])
  useFrame(({ camera, clock }) => {
    const g = group.current
    if (!g || !at) return
    // Its own position: World has no transformed parent, so the group's position is where it is drawn.
    const near = camera.position.distanceTo(g.position) <= NEAR * at.scale
    if (g.visible === near) g.visible = !near
    // Moves only while it guides, and only while seen: otherwise nothing changes frame to frame and the frame gate can idle.
    if (!guiding || near) return
    const t = clock.getElapsedTime()
    if (diamond.current) {
      diamond.current.rotation.y = t * 0.9
      diamond.current.scale.setScalar(1 + 0.12 * Math.sin(t * 4))
    }
    const k = (t % PING_S) / PING_S
    for (const m of pings.current) {
      if (!m) continue
      m.scale.setScalar(1 + 1.8 * k)
      ;(m.material as MeshBasicMaterial).opacity = 0.85 * (1 - k)
    }
  })

  if (!at) return null
  return (
    <group ref={group} name="tutorial-target" position={at.centre} scale={at.scale} quaternion={at.turn}>
      <mesh rotation={[Math.PI / 2, 0, 0]} raycast={noRaycast}>
        <torusGeometry args={[RING, 0.09, 8, 48]} />
        <meshBasicMaterial color={TARGET_GREEN} toneMapped={false} />
      </mesh>
      {guiding && (
        <>
          <mesh ref={diamond} raycast={noRaycast}>
            <octahedronGeometry args={[DIAMOND, 0]} />
            <meshBasicMaterial color="#ffffff" toneMapped={false} />
          </mesh>
          {/* The beam and the ping, translucent, each twice split by the stencil (ClipWalls OFF_FACES / OVER_FACES):
              over a shard face the face keeps its alpha tag, so the bloom never blows the course's platforms out behind them. */}
          {[{ ...OFF_FACES, blending: AdditiveBlending }, OVER_FACES].map((split, i) => (
            <mesh key={`beam-${i}`} position={[0, DIAMOND + BEAM / 2, 0]} raycast={noRaycast}>
              <cylinderGeometry args={[0.14, 0.14, BEAM, 12, 1, true]} />
              <meshBasicMaterial color={TARGET_GREEN} toneMapped={false} transparent opacity={0.6} depthWrite={false} {...split} />
            </mesh>
          ))}
          {[OFF_FACES, OVER_FACES].map((split, i) => (
            <mesh key={`ping-${i}`} raycast={noRaycast} rotation={[Math.PI / 2, 0, 0]} ref={(m) => { pings.current[i] = m }}>
              <torusGeometry args={[RING, 0.06, 6, 48]} />
              <meshBasicMaterial color={TARGET_GREEN} toneMapped={false} transparent opacity={0.85} depthWrite={false} {...split} />
            </mesh>
          ))}
        </>
      )}
    </group>
  )
}
