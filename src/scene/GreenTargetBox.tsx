/**
 * GreenTargetBox.tsx: the tour's "go here" mark, one component for both places
 * the tour sends a newcomer (owner, 2026-11-23: "make the acceptable movement
 * target a small region denoted by a green box similar to the first green box
 * ... and don't obscure it with a white sphere. However, I like the green ring
 * and green beam above it ... make the original green box outlines from step 1
 * be the same green as the ring/beam. Put the ring and beam around the first
 * green box from step 1, and around this target's green box").
 *
 *   - a green outline cube: the region that counts, always;
 *   - while the step that sends the player there waits ('guiding'): a level
 *     green ring round it at half its height, clear of its corners, a beam
 *     of the same green from the cube's top straight up, and a ring that
 *     pings outward. Once the step is done only the outline stays, so a ring
 *     never sweeps across the camera on the later steps.
 * Nothing solid: the outline is lines, and nothing here writes depth, so the
 * cursor and the avatar inside the cube always show through (the white
 * diamond that used to stand on the course target hid the cursor). The beam
 * starts at the cube's top, so it never crosses the cube's inside. Nothing
 * can be tapped (every raycast is off).
 *
 * Drawn in gibsons: the parent places it at the cube's middle, scaled so one
 * unit is a gibson, and turned so its up is cyberspace +Y.
 */

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { AdditiveBlending, BoxGeometry, EdgesGeometry, type Group, type Mesh, type MeshBasicMaterial, type Quaternion } from 'three'
import { OFF_FACES, OVER_FACES } from './ClipWalls'

/** The ring, the beam and the cube's outline: spring green, apart from every colour already on the course. */
export const TARGET_GREEN = '#2bff88'
/** How far above the cube's top the beam reaches, in gibsons, at least. */
const BEAM_MIN = 16
/** One ping outward, in seconds. */
const PING_S = 1.6
/** Off the raycaster: nothing here is a thing to tap. */
const noRaycast = (): void => {}

/** The ring's radius for a cube of `side` gibsons: past its corners (half the diagonal of its face is 0.71 of a side). */
export function ringRadius(side: number): number {
  return side * 0.8
}

/** The beam's thickness for a cube of `side` gibsons, and how far it reaches past the cube's top. */
export function beamOf(side: number): { radius: number; length: number } {
  return { radius: Math.max(0.12, side * 0.05), length: Math.max(BEAM_MIN, side * 2) }
}

export interface GreenTargetBoxProps {
  /** The cube's middle, in render cells. */
  centre: [number, number, number]
  /** Render cells to a gibson. */
  scale: number
  /** Stands its up on cyberspace +Y. */
  turn: Quaternion
  /** The cube's side, in gibsons. */
  side: number
  /** The step that sends the player here is waiting: the beam and the ping too. */
  guiding: boolean
  /** A name for the group, for tests and the scene's inspector. */
  name: string
}

export function GreenTargetBox({ centre, scale, turn, side, guiding, name }: GreenTargetBoxProps): JSX.Element {
  const edges = useMemo(() => {
    const box = new BoxGeometry(side, side, side)
    const e = new EdgesGeometry(box)
    box.dispose()
    return e
  }, [side])
  const ring = ringRadius(side)
  const beam = beamOf(side)
  const tube = Math.max(0.05, side * 0.008)
  const pings = useRef<Array<Mesh | null>>([])
  const group = useRef<Group>(null)
  useFrame(({ clock }) => {
    if (!guiding || !group.current?.visible) return
    const k = (clock.getElapsedTime() % PING_S) / PING_S
    for (const m of pings.current) {
      if (!m) continue
      m.scale.setScalar(1 + 0.8 * k)
      ;(m.material as MeshBasicMaterial).opacity = 0.85 * (1 - k)
    }
  })
  return (
    <group ref={group} name={name} position={centre} scale={scale} quaternion={turn}>
      {/* The region that counts: lines only, depth never written, drawn before the cursor so it never hides it. */}
      <lineSegments geometry={edges} raycast={noRaycast} renderOrder={-1}>
        <lineBasicMaterial color={TARGET_GREEN} toneMapped={false} transparent opacity={0.95} depthWrite={false} />
      </lineSegments>
      {guiding && (
        <>
          <mesh rotation={[Math.PI / 2, 0, 0]} raycast={noRaycast}>
            <torusGeometry args={[ring, tube * 1.5, 8, 64]} />
            <meshBasicMaterial color={TARGET_GREEN} toneMapped={false} transparent opacity={0.9} depthWrite={false} />
          </mesh>
          {/* The beam and the ping, translucent, each twice split by the stencil (ClipWalls OFF_FACES / OVER_FACES):
              over a shard face the face keeps its alpha tag, so the bloom never blows the course's platforms out behind them. */}
          {[{ ...OFF_FACES, blending: AdditiveBlending }, OVER_FACES].map((split, i) => (
            <mesh key={`beam-${i}`} position={[0, side / 2 + beam.length / 2, 0]} raycast={noRaycast}>
              <cylinderGeometry args={[beam.radius, beam.radius, beam.length, 12, 1, true]} />
              <meshBasicMaterial color={TARGET_GREEN} toneMapped={false} transparent opacity={0.6} depthWrite={false} {...split} />
            </mesh>
          ))}
          {[OFF_FACES, OVER_FACES].map((split, i) => (
            <mesh key={`ping-${i}`} raycast={noRaycast} rotation={[Math.PI / 2, 0, 0]} ref={(m) => { pings.current[i] = m }}>
              <torusGeometry args={[ring, tube, 6, 64]} />
              <meshBasicMaterial color={TARGET_GREEN} toneMapped={false} transparent opacity={0.85} depthWrite={false} {...split} />
            </mesh>
          ))}
        </>
      )}
    </group>
  )
}
