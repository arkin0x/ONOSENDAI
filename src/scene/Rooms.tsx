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
 * Each box is coloured by the **LCA boundary palette** at its own crossing
 * height, so leaving a room costs exactly what its edges say it costs. The ramp
 * runs from near-black indigo for the cheapest crossings up to near-white violet
 * for the most expensive, which is the same scale the HUD legend documents.
 *
 * The palette takes *excess over the floor*, not absolute height: at scaleExp s
 * the cheapest possible crossing is already height s+1, so passing the raw
 * height saturates the ramp at every scale above about 5 and throws the signal
 * away. That defect is what made the old flat boundary grid uninformative.
 */

import { useMemo } from 'react'
import { BoxGeometry, EdgesGeometry } from 'three'
import { GRID_RADIUS, stepFor, type ViewAxes } from '../lib/space'
import { boundaryColor, boundaryIntensity } from '../lib/palette'
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
    const out: Array<{
      h: number; centre: [number, number, number]; size: number
      intensity: number; color: string
    }> = []

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

      // Absolute crossing height, not excess over the local floor. A room's
      // edges cost 2^h to cross no matter what zoom you happen to be at, so the
      // ramp should mean the same thing everywhere: dark rooms really are cheap
      // to leave, and the whole nest brightens as you zoom out into expensive
      // country. Excess would re-baseline the palette at every scale and make a
      // trivial crossing look identical to a ruinous one.
      out.push({
        h, centre, size: sizeCells,
        intensity: boundaryIntensity(h, scaleExp + 1),
        color: `#${boundaryColor(h).getHexString()}`,
      })
    }
    return out
  }, [position, scaleExp, axes])

  return (
    <group>
      {boxes.map((b) => (
        <RoomBox key={b.h} centre={b.centre} size={b.size} intensity={b.intensity} color={b.color} />
      ))}
    </group>
  )
}

function RoomBox({
  centre, size, intensity, color,
}: {
  centre: [number, number, number]; size: number; intensity: number; color: string
}): JSX.Element {
  const geometry = useMemo(
    () => new EdgesGeometry(new BoxGeometry(size, size, size)),
    [size],
  )
  return (
    <lineSegments geometry={geometry} position={centre} frustumCulled={false}>
      <lineBasicMaterial
        color={color}
        toneMapped={false}
        transparent
        opacity={0.35 + 0.65 * intensity}
      />
    </lineSegments>
  )
}
