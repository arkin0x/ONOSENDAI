/**
 * Rooms.tsx — the aligned-subtree nest, drawn as rooms you are inside.
 *
 * Per §4.5 an aligned subtree of height h starts at a multiple of 2^h and owns
 * 2^h leaves per axis. So at any position you sit inside a nest of boxes nobody
 * chose, and their edges are exactly the expensive boundaries: crossing out of
 * the height-h box costs 2^h. Ticket 02 argued this single structure is the
 * highest-leverage visual available, because the same boxes are simultaneously
 * the walls, the scale hierarchy and the discovery radii.
 *
 * Brightness rises with the box's height above the current scale's floor, so a
 * room you can barely afford to leave glows and a cheap one is nearly invisible.
 * Uses boundaryIntensity, which the app ships and never calls (ticket 05).
 */

import { useMemo } from 'react'
import { BoxGeometry, EdgesGeometry } from 'three'
import { GRID_RADIUS, stepFor, type ViewAxes } from '../lib/space'
import { boundaryIntensity } from '../lib/palette'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'

/** How many nested subtrees above the current scale to draw. */
const DEPTH = 6

interface Props {
  axes: ViewAxes
}

export function Rooms({ axes }: Props): JSX.Element {
  const position = useCyberspace((s) => s.position)
  const scaleExp = useCyberspace((s) => s.scaleExp)

  const boxes = useMemo(() => {
    const step = stepFor(scaleExp)
    const origin = alignedOrigin(position, scaleExp)
    const screen = [axes.right, axes.up, axes.out]
    const out: Array<{ h: number; centre: [number, number, number]; size: number; intensity: number }> = []

    for (let d = 1; d <= DEPTH; d++) {
      const h = scaleExp + d
      const sizeCells = 2 ** d
      // Skip boxes far larger than the window; they read as a flat edge.
      if (sizeCells > GRID_RADIUS * 8) break

      const centre: [number, number, number] = [0, 0, 0]
      for (let s = 0; s < 3; s++) {
        const axis = screen[s].axis
        const base = (position[axis] >> BigInt(h)) << BigInt(h)
        // Cell offset of the box's low corner from the avatar's aligned cell.
        const lo = Number((base - origin[axis]) / step)
        const hi = lo + sizeCells - 1
        // Screen coordinate flips with the axis direction.
        centre[s] = ((lo + hi) / 2) * screen[s].dir
      }

      out.push({ h, centre, size: sizeCells, intensity: boundaryIntensity(h, scaleExp + 1) })
    }
    return out
  }, [position, scaleExp, axes])

  return (
    <group>
      {boxes.map((b) => (
        <RoomBox key={b.h} centre={b.centre} size={b.size} intensity={b.intensity} />
      ))}
    </group>
  )
}

function RoomBox({
  centre, size, intensity,
}: { centre: [number, number, number]; size: number; intensity: number }): JSX.Element {
  const geometry = useMemo(
    () => new EdgesGeometry(new BoxGeometry(size, size, size)),
    [size],
  )
  return (
    <lineSegments geometry={geometry} position={centre} frustumCulled={false}>
      <lineBasicMaterial
        color="#c07dff"
        toneMapped={false}
        transparent
        opacity={0.15 + 0.85 * intensity}
      />
    </lineSegments>
  )
}
