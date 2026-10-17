/**
 * ClipWalls.tsx — "this box goes on past here": the walls that breathe outward
 * from a box drawn smaller than the region it stands for.
 *
 * A box too big for the view is drawn clipped, which is honest about where the
 * region is and silent about how far it goes, and that silence was read as
 * "small and broken" rather than "bigger than the view". So each face the true
 * region continues through repeatedly slides one cell outward while fading,
 * then snaps back: motion pointing out of the box, on exactly those faces, with
 * ZOOM OUT written on it. The move box was first (CoveringBox); the deploy
 * region box uses the same walls (arkinox, 2026-10-16: "make it like the blue
 * region for moves with the zoom out expanding walls when the cube doesn't
 * fit").
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  AddEquation, CustomBlending, DoubleSide, EqualStencilFunc, Group, MeshBasicMaterial,
  NotEqualStencilFunc, OneFactor, OneMinusSrcAlphaFactor, PlaneGeometry, SrcAlphaFactor, Vector3, ZeroFactor,
} from 'three'
import { WorldLabel } from './WorldLabel'
import { FACE_TAG_STENCIL } from './ShardMesh'

/** Seconds one outward breath of a clipped wall takes. */
const WALL_CYCLE = 1.6

/**
 * Peak opacity of a breathing wall, well above a box fill's ceiling (0.09).
 * The fill only whispers "this is a volume"; a breathing wall is the one active
 * message in the scene, "the region continues past this face", and at fill
 * strength it would read as a rendering artifact rather than a signal.
 */
const WALL_OPACITY = 0.25

/**
 * A box's translucent planes, drawn in two halves split by the stencil.
 *
 * Off the shard faces: exactly as before, ordinary blending, so the box reads
 * the same against the dark and the lattice and blooms as it always has.
 *
 * Over a shard face: the same color blend, but the alpha under it is left as
 * it was. The face's alpha is its tag, the thing that keeps the bloom off it
 * (Scene.tsx WorldBloom), and ordinary blending overwrote it with the box's
 * own opacity: the bloom then saw a white face as light and blew it out into
 * a glowing blob wherever the box covered it, which is exactly where your own
 * avatar always sits (arkinox, 2026-10-12). The face still takes the box's
 * tint; it just stays a face.
 */
export const OFF_FACES = { stencilWrite: true, stencilRef: FACE_TAG_STENCIL, stencilFunc: NotEqualStencilFunc } as const
export const OVER_FACES = {
  stencilWrite: true, stencilRef: FACE_TAG_STENCIL, stencilFunc: EqualStencilFunc,
  blending: CustomBlending, blendEquation: AddEquation,
  blendSrc: SrcAlphaFactor, blendDst: OneMinusSrcAlphaFactor, blendSrcAlpha: ZeroFactor, blendDstAlpha: OneFactor,
} as const

/** One face of a drawn box that the true region extends beyond. */
export interface ClipFace {
  /** Render axis the face is perpendicular to: 0 right, 1 up, 2 out. */
  slot: 0 | 1 | 2
  /** Which of the pair: +1 the face on the +axis side, breathing toward +axis; -1 the other. */
  sign: 1 | -1
}

interface Wall extends ClipFace {
  geometry: PlaneGeometry
  rotation: [number, number, number]
  /** Face centre at rest, in cells; each breath departs from here. */
  base: [number, number, number]
}

interface Props {
  /** The drawn box's centre and extent, in render cells. */
  centre: [number, number, number]
  size: [number, number, number]
  /** The faces the true region continues through. */
  faces: ClipFace[]
  color: string
  /**
   * Leave out a wall while the camera is beyond it, between you and the box:
   * that wall faces you across the whole view, and at the deploy box's size
   * it washed the screen in its color (2026-10-16). The box's outline still
   * marks the face.
   */
  hideNear?: boolean
}

export function ClipWalls({ centre, size, faces, color, hideNear = false }: Props): JSX.Element | null {
  const walls = useMemo<Wall[]>(() => faces.map(({ slot, sign }) => {
    // PlaneGeometry faces +Z; rotate it to face the slot's render axis. Its
    // extents are the face's own two render axes, so the plane is exactly
    // the wall it stands in for.
    const rotation: [number, number, number] =
      slot === 0 ? [0, Math.PI / 2, 0] : slot === 1 ? [Math.PI / 2, 0, 0] : [0, 0, 0]
    const w = slot === 0 ? size[2] : size[0]
    const h = slot === 1 ? size[2] : size[1]
    const base: [number, number, number] = [centre[0], centre[1], centre[2]]
    base[slot] += (sign * size[slot]) / 2
    return { slot, sign, geometry: new PlaneGeometry(w, h), rotation, base }
  }), [faces, centre, size])

  useEffect(() => () => { for (const w of walls) w.geometry.dispose() }, [walls])

  // One material for all walls: every wall shares one phase, so they share one
  // opacity, and the frame loop then touches a single object (a pair, one per
  // half of the stencil split; see OFF_FACES). DoubleSide, because a breath
  // that carries a wall past the camera still has to be readable from behind;
  // depthWrite off, so a translucent plane never punches a hole in what sits
  // behind it.
  const materials = useMemo(() => [OFF_FACES, OVER_FACES].map((split) => new MeshBasicMaterial({
    color,
    transparent: true,
    opacity: WALL_OPACITY,
    side: DoubleSide,
    // One pass, not three's back-then-front pair (see ShardMesh).
    forceSinglePass: true,
    depthWrite: false,
    toneMapped: false,
    ...split,
  })), [color])
  useEffect(() => () => { for (const m of materials) m.dispose() }, [materials])

  const meshes = useRef<Array<Group | null>>([])
  // Each wall with its label, for hideNear.
  const shown = useRef<Array<Group | null>>([])
  const eye = useMemo(() => new Vector3(), [])

  useFrame((state) => {
    if (walls.length === 0) return
    // Free-running phase rather than a start time: the breath is a state, not
    // an event, and a cycle restarted on every cursor step would stutter.
    const t = (state.clock.elapsedTime % WALL_CYCLE) / WALL_CYCLE
    // Ease-out: the wall departs briskly and decelerates as it fades, which
    // reads as emanating from the box rather than drifting off it.
    const eased = 1 - (1 - t) ** 3
    for (const m of materials) m.opacity = WALL_OPACITY * (1 - eased)
    for (let i = 0; i < walls.length; i++) {
      const mesh = meshes.current[i]
      if (!mesh) continue
      const w = walls[i]
      mesh.position.set(w.base[0], w.base[1], w.base[2])
      // One cell exactly: the breath's reach names the lattice unit, so it
      // reads as "at least one more cell that way", not as vague drift.
      mesh.position.setComponent(w.slot, w.base[w.slot] + w.sign * eased)
      const all = shown.current[i]
      if (hideNear && all?.parent) {
        all.parent.worldToLocal(eye.copy(state.camera.position))
        all.visible = (eye.getComponent(w.slot) - w.base[w.slot]) * w.sign <= 0
      }
    }
  })

  if (walls.length === 0) return null

  return (
    <>
      {walls.map((w, i) => (
        <group key={`${w.slot}${w.sign}`} ref={(g) => { shown.current[i] = g }}>
          <group ref={(g) => { meshes.current[i] = g }} position={w.base}>
            {materials.map((m, k) => (
              <mesh key={k} geometry={w.geometry} material={m} rotation={w.rotation} frustumCulled={false} />
            ))}
          </group>
          {/* The remedy, written on the thing asking for it. Small and the
              box's own color: an instruction, not an alert. */}
          <WorldLabel text="ZOOM OUT" color={color} at={w.base} px={11} align="center" />
        </group>
      ))}
    </>
  )
}
