/**
 * PROTOTYPE — throwaway. Ticket 03, variant D: "the room you are in".
 *
 * One aligned subtree is *current*. You are inside it. Its walls are drawn, its
 * parent is drawn faintly beyond it, its siblings are dimmed, and the black sun
 * is painted on its `+Z_cs` wall.
 *
 * The room is the subtree at height `scaleExp + ROOM_DEPTH`, so zooming moves
 * you up and down the nest: scale stops being a lattice swap and becomes a
 * choice of which subtree to inhabit.
 *
 * Per ticket 07 the black sun has no coordinate. It is a proxy polygon at the
 * `+Z` face of whatever volume is primary at the current scale, and here that
 * volume is the room, so it moves outward through the nest as you zoom.
 */

import { useMemo } from 'react'
import { BoxGeometry, EdgesGeometry, DoubleSide } from 'three'
import { stepFor, type AxisName, type ViewAxes } from '../../lib/space'
import { alignedOrigin, useCyberspace } from '../../store/useCyberspace'

/** Heights above the current scale that the current room sits at. */
const ROOM_DEPTH = 4

interface Props {
  axes: ViewAxes
}

/** Screen-space extent, in cells, of the aligned subtree of height h. */
function roomBox(
  position: { x: bigint; y: bigint; z: bigint },
  scaleExp: number,
  axes: ViewAxes,
  h: number,
): { centre: [number, number, number]; size: number; zFace: { s: number; sign: number } } {
  const step = stepFor(scaleExp)
  const origin = alignedOrigin(position, scaleExp)
  const screen = [axes.right, axes.up, axes.out]
  const sizeCells = 2 ** (h - scaleExp)

  const centre: [number, number, number] = [0, 0, 0]
  let zFace = { s: 2, sign: 1 }

  for (let s = 0; s < 3; s++) {
    const axis: AxisName = screen[s].axis
    const base = (position[axis] >> BigInt(h)) << BigInt(h)
    const lo = Number((base - origin[axis]) / step)
    centre[s] = (lo + (sizeCells - 1) / 2) * screen[s].dir
    // Which screen axis carries +Z_cs, and which way it points on screen.
    if (axis === 'z') zFace = { s, sign: screen[s].dir }
  }

  return { centre, size: sizeCells, zFace }
}

export function Room({ axes }: Props): JSX.Element {
  const position = useCyberspace((s) => s.position)
  const scaleExp = useCyberspace((s) => s.scaleExp)

  const { room, parent } = useMemo(() => ({
    room: roomBox(position, scaleExp, axes, scaleExp + ROOM_DEPTH),
    parent: roomBox(position, scaleExp, axes, scaleExp + ROOM_DEPTH + 1),
  }), [position, scaleExp, axes])

  const roomEdges = useMemo(
    () => new EdgesGeometry(new BoxGeometry(room.size, room.size, room.size)),
    [room.size],
  )
  const parentEdges = useMemo(
    () => new EdgesGeometry(new BoxGeometry(parent.size, parent.size, parent.size)),
    [parent.size],
  )

  // The black sun: a proxy disc at the room's +Z side.
  //
  // It faces the viewer rather than lying in the wall plane. Orienting it to the
  // wall makes it edge-on and therefore invisible from most views, and it is
  // conceptually a thing at +Z infinity, not a decal on a surface. The scene is
  // drawn in screen-axis space, so an unrotated disc always faces the camera.
  const sun = useMemo(() => {
    const pos: [number, number, number] = [...room.centre]
    pos[room.zFace.s] += room.zFace.sign * (room.size / 2)
    return { pos }
  }, [room])

  return (
    <group>
      {/* The parent room, faint: what contains the room you are in. */}
      <lineSegments geometry={parentEdges} position={parent.centre} frustumCulled={false}>
        <lineBasicMaterial color="#c07dff" toneMapped={false} transparent opacity={0.18} />
      </lineSegments>

      {/* The room you are in. */}
      <lineSegments geometry={roomEdges} position={room.centre} frustumCulled={false}>
        <lineBasicMaterial color="#c07dff" toneMapped={false} transparent opacity={0.95} />
      </lineSegments>

      {/* Black sun on the room's +Z wall. No coordinate; a proxy at the face. */}
      <mesh position={sun.pos} frustumCulled={false}>
        <circleGeometry args={[room.size * 0.28, 48]} />
        <meshBasicMaterial
          color="#7d3cff"
          toneMapped={false}
          transparent
          opacity={0.55}
          side={DoubleSide}
        />
      </mesh>
    </group>
  )
}
