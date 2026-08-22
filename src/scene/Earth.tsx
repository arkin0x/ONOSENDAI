/**
 * Earth.tsx — the planet, at the size the protocol actually puts it.
 *
 * Dataspace (plane 0) maps WGS84 onto the axes, and §9.7 fixes both the scale
 * and the placement exactly:
 *
 *   units_per_km = 1000 * 2^33      (from Cantor height 34 = 2 metres)
 *   u = km * units_per_km + 2^84
 *
 * So the planet's centre is the half-axis point on all three axes, and its
 * radius is 6371 km expressed in those units: 54,726,473,285,632,000 gibsons,
 * or 2^55.6. Nothing here is a chosen number. v1 drew a globe too but at an
 * invented scale, which quietly made every distance around it a lie.
 *
 * The consequence is worth stating, because it is the honest shape of dataspace
 * rather than a limitation of this component. The planet is 2^56.6 gibsons
 * across inside an axis 2^85 long, so it occupies about a 250-billionth of each
 * axis. A pubkey-derived spawn lands uniformly in that range and is therefore
 * some 10^8 Earth radii away from it. You do not stumble across Earth. You go
 * there, and until you do this draws nothing.
 */

import { useMemo } from 'react'
import { EARTH } from '../lib/palette'
import { GRID_RADIUS, cellDelta, stepFor, type ViewAxes } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { WorldLabel } from './WorldLabel'

/** §9.7: 1 km = 1000 * 2^33 gibsons. */
const GIBSONS_PER_KM = 1000n * (1n << 33n)

/**
 * Mean radius, not the WGS84 semi-major axis.
 *
 * The mapping itself is a proper ellipsoid conversion, but the ellipsoid is
 * flattened by about a third of a percent, which is a quarter of a pixel on a
 * globe drawn twenty cells wide. A sphere at the mean radius is the honest
 * summary at any zoom this is visible at.
 */
const RADIUS_KM = 6371n
const RADIUS_GIBSONS = RADIUS_KM * GIBSONS_PER_KM

/** §9.7: the mapping is centred on the half-axis point. */
const CENTRE = 1n << 84n

interface Props {
  axes: ViewAxes
}

/** Fixed-point bigint division, so the ratio survives past 2^53. */
function inCells(value: bigint, step: bigint): number {
  return Number((value * 10_000n) / step) / 10_000
}

export function Earth({ axes }: Props): JSX.Element | null {
  const position = useCyberspace((s) => s.position)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const plane = useCyberspace((s) => s.plane)

  const globe = useMemo(() => {
    // Ideaspace has no physical mapping at all (§9.1), so there is no planet in
    // it to draw.
    if (plane !== 0) return null

    const step = stepFor(scaleExp)
    const radius = inCells(RADIUS_GIBSONS, step)

    // Too big to read as a sphere, or smaller than the unit you move in. Both
    // ends are the same cutoff the sector cage uses, for the same reason.
    if (radius * 2 > GRID_RADIUS * 8 || radius * 2 < 1) return null

    const origin = alignedOrigin(position, scaleExp)
    const centre = [axes.right, axes.up, axes.out].map(
      (a) => cellDelta(CENTRE, origin[a.axis], scaleExp) * a.dir,
    ) as [number, number, number]

    // Off in the dark somewhere. Building a sphere nobody can see is wasted
    // work, and at a random spawn this is the overwhelmingly common case.
    const reach = GRID_RADIUS * 8 + radius
    if (Math.hypot(...centre) > reach) return null

    return { centre, radius }
  }, [position, scaleExp, plane, axes])

  if (!globe) return null

  return (
    <group position={globe.centre}>
      <mesh>
        <sphereGeometry args={[globe.radius, 48, 24]} />
        <meshBasicMaterial color={EARTH} wireframe transparent opacity={0.32} toneMapped={false} />
      </mesh>
      <WorldLabel
        text={`EARTH\nr 6371 km`}
        color={EARTH}
        at={[0, globe.radius, 0]}
        align="center"
        offset={[0, 0.8, 0]}
        px={11}
        opacity={0.9}
      />
    </group>
  )
}
