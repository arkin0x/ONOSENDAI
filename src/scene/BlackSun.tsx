/**
 * BlackSun.tsx — the one absolute bearing in cyberspace.
 *
 * §11.2 puts a purple marker at the +Z_cs boundary and §11.3's canonical view
 * faces it. It has no coordinate: it sits at +Z infinity, so it is a DIRECTION,
 * not a place. Nothing about it depends on where you are standing.
 *
 * That is why it is drawn as a fixed-size disc pinned to the camera rather than
 * as geometry somewhere in the world. Being at infinity means exactly two
 * things, and pinning delivers both for free: no parallax, because moving the
 * camera cannot change the bearing to an infinitely distant point; and constant
 * apparent size, because the distance never changes. A proxy placed on some
 * volume's +Z face would have had to be repositioned every time that volume
 * changed, and would have blinked out at the many zooms where no such volume is
 * drawn.
 *
 * The consequence worth stating: this is the only thing on screen that does not
 * move when you do. Everything else is relative to the avatar and re-anchors
 * under it. The sun is the fixed point the rest of the space can be read
 * against, which is the whole reason the spec puts it there.
 *
 * Billboarded, so turning away slides it across the view without squashing it
 * into an ellipse. A distant object does not foreshorten as you turn your head.
 */

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { DoubleSide, Group, Vector3 } from 'three'
import { holdAtBearing } from '../lib/bearing'
import { BLACK_SUN } from '../lib/palette'
import { renderDirection, type ViewAxes } from '../lib/space'
import { WorldLabel } from './WorldLabel'

/**
 * Distance from the camera, in render units.
 *
 * Bounded above by the camera's far plane of 6000, and this is measured FROM the
 * camera, so it stays inside it wherever the camera goes. Otherwise arbitrary:
 * nothing is ever between you and it, so the only job the number has is to set
 * the scale the radii below are quoted in.
 */
const DISTANCE = 4000

/**
 * Radii, in the same render units.
 *
 * A vertical fov of 55 degrees puts the visible half-height at
 * DISTANCE * tan(27.5 deg), about 2082 units, so an outer radius of 450 draws a
 * disc about 22 percent of the screen height across: measured at 194px in a
 * 900px viewport. Large on purpose. It is the only fixed thing in the space, so
 * it has to read as a horizon you are oriented against rather than as one more
 * marker competing with the cursor, and at the previous seventh of that size it
 * sat inside the cursor's own glow in the canonical view.
 *
 * INNER holds the same ratio to OUTER, so the corona stays a rim rather than
 * thickening into a disc as the whole thing grows.
 *
 * Drawn as a ring, not a disc, which is what makes it a BLACK sun: the centre is
 * unlit space showing through, and the corona is the only thing emitted. Bloom
 * runs at a threshold near zero, so the ring glows and the hole stays black.
 */
/** When in the frame the sun is placed and faced: after the camera has moved (0, 0.5), before the composer draws (1). */
const SUN_PRIORITY = 0.9

const OUTER = 450
const INNER = 372

interface Props {
  axes: ViewAxes
}

export function BlackSun({ axes }: Props): JSX.Element {
  const group = useRef<Group>(null)
  const face = useRef<Group>(null)
  // +Z_cs in render space. Changes only when the view frame does, which is what
  // makes the sun rotate with the scene rather than sticking to the screen.
  const dir = useMemo(() => renderDirection(axes, 'z'), [axes])
  // Where the sun stands from the camera. One vector for the life of the
  // sun, set again whenever the bearing changes, because the meshes under it
  // read it on every draw (lib/bearing.ts).
  const offset = useMemo(() => new Vector3(), [])
  const fromCamera = useMemo(() => dir.map((v) => v * DISTANCE) as [number, number, number], [dir])

  // Per frame rather than per render: the camera moves continuously under orbit
  // and under the rig's eased follow, neither of which React sees. A sun that
  // updated on render would swim against the world by a frame.
  //
  // Late in the frame, after every camera mover (the rig at 0, Cyberspace
  // TV's camera at 0.5), and turned to the camera here rather than by drei's
  // Billboard at the frame's start: placed and faced a frame behind a moving
  // camera, the ring was seen a little from the side and seemed to tip and
  // turn, flat, through a TV shot's move (arkinox, 2026-10-18).
  //
  // The world position below is only what the renderer sorts by. Where the
  // sun is drawn comes from the camera's turn and the offset alone
  // (holdAtBearing), because the camera can be so far from the render origin
  // that adding 4000 to its position changes nothing. Measured at 4.4e24
  // after a far cut in TV: the sun sat on the eye, culled on some frames and
  // drawn on others, which is the flicker arkinox saw in TV and after a
  // recall from a far cursor at 2^0 (2026-10-20).
  useFrame((state) => {
    const g = group.current
    if (!g) return
    offset.set(fromCamera[0], fromCamera[1], fromCamera[2])
    const c = state.camera.position
    g.position.set(c.x + offset.x, c.y + offset.y, c.z + offset.z)
    if (face.current) face.current.quaternion.copy(state.camera.quaternion)
    holdAtBearing(g, offset)
  }, SUN_PRIORITY)

  return (
    <group ref={group}>
      <group ref={face}>
        <mesh>
          <ringGeometry args={[INNER, OUTER, 96]} />
          {/*
            Fog off, or this renders as nothing at all: the scene fogs to pure
            black by 96 units and the sun sits at 4000. Same reason toneMapped is
            off, so the purple reaches bloom at the value it was authored at.
          */}
          <meshBasicMaterial
            color={BLACK_SUN}
            fog={false}
            toneMapped={false}
            transparent
            opacity={0.9}
            side={DoubleSide}
            forceSinglePass
          />
        </mesh>
      </group>
      <WorldLabel
        text={`BLACK SUN\n+Z`}
        color={BLACK_SUN}
        at={[0, -OUTER, 0]}
        align="center"
        offset={[0, -0.4, 0]}
        px={11}
        opacity={0.75}
        fromCamera={fromCamera}
      />
    </group>
  )
}
