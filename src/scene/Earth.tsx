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

import { useEffect, useMemo } from 'react'
import { markSceneTapHandled } from '../hooks/useCanvasTap'
import { BackSide, BufferGeometry, Float32BufferAttribute } from 'three'
import { COAST, EARTH, MERIDIAN } from '../lib/palette'
import { GRID_RADIUS, cellDelta, stepFor, type ViewAxes } from '../lib/space'
import { EARTH_RADIUS_KM, originCsMetres, surfaceVertex } from '../lib/earthSurface'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { ownHyperspaceView } from '../store/useHyperspace'
import { useCoastline } from '../hooks/useCoastline'
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
  const position = useCyberspace((s) => s.anchor)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const plane = useCyberspace((s) => s.anchorPlane)
  // The coarsest shoreline tier, whole: 5k points, 41 KB, fetched once.
  const coast = useCoastline(plane === 0 ? '110m' : null)

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
    // Minus one half: the continuous family's cell-cube convention, the same
    // shift pointCentre applies, so the globe and its landfall shell stay
    // glued to each other AND to the cell-drawn world around them.
    const centre = [axes.right, axes.up, axes.out].map(
      (a) => (cellDelta(CENTRE, origin[a.axis], scaleExp) - 0.5) * a.dir,
    ) as [number, number, number]

    // Off in the dark somewhere. Building a sphere nobody can see is wasted
    // work, and at a random spawn this is the overwhelmingly common case.
    const reach = GRID_RADIUS * 8 + radius
    if (Math.hypot(...centre) > reach) return null

    return { centre, radius }
  }, [position, scaleExp, plane, axes])

  // The graticule, replacing the old view-relative wireframe: a sphere
  // mesh's poles follow the camera's up axis, so its "meridians" were
  // decoration that reoriented with the view. These rings are geographic,
  // poles where §9.4 puts them, so the lines MEAN latitude and longitude
  // and the equator and prime meridian can be named. Vertices are float64
  // metre deltas from the render origin on the true ellipsoid
  // (earthSurface.ts), absolute in render space, so they live outside the
  // centred group below.
  const graticule = useMemo(() => {
    if (!globe) return null
    const originM = originCsMetres(alignedOrigin(position, scaleExp))
    const at = (lat: number, lon: number, altM = 0): [number, number, number] =>
      surfaceVertex(lat, lon, altM, originM, scaleExp, axes)
    const blue: number[] = []
    const green: number[] = []
    const ring = (
      out: number[], fix: 'lat' | 'lon', v: number, from: number, to: number, n: number,
    ): void => {
      let prev: [number, number, number] | null = null
      for (let i = 0; i <= n; i++) {
        const t = from + ((to - from) * i) / n
        const p = fix === 'lat' ? at(v, t) : at(t, v)
        if (prev) out.push(...prev, ...p)
        prev = p
      }
    }
    for (let lat = -75; lat <= 75; lat += 15) ring(lat === 0 ? green : blue, 'lat', lat, -180, 180, 96)
    for (let lon = -165; lon <= 180; lon += 15) if (lon !== 0) ring(blue, 'lon', lon, -90, 90, 24)
    // The prime meridian proper: the Greenwich half, pole to pole at lon 0.
    ring(green, 'lon', 0, -90, 90, 24)
    // The continents, whole: brighter than the rulings, because the
    // graticule is reference and the coast is content. 3D chords, so lines
    // crossing the antimeridian need no seam handling.
    const coastArr: number[] = []
    if (coast) {
      for (const line of coast.lines) {
        const n = line.pts.length / 2
        let prev: [number, number, number] | null = null
        for (let i = 0; i < n; i++) {
          const pnt = at(line.pts[i * 2], line.pts[i * 2 + 1])
          if (prev) coastArr.push(...prev, ...pnt)
          prev = pnt
        }
      }
    }
    const lift = EARTH_RADIUS_KM * 1000 * 0.06
    const make = (v: number[]): BufferGeometry => {
      const g = new BufferGeometry()
      g.setAttribute('position', new Float32BufferAttribute(v, 3))
      return g
    }
    return {
      blue: make(blue),
      green: make(green),
      coast: coastArr.length > 0 ? make(coastArr) : null,
      equatorAt: at(0, 90, lift),
      meridianAt: at(50, 0, lift),
    }
  }, [globe, position, scaleExp, axes, coast])

  useEffect(() => () => {
    if (!graticule) return
    graticule.blue.dispose()
    graticule.green.dispose()
    graticule.coast?.dispose()
  }, [graticule])

  if (!globe || !graticule) return null

  return (
    <>
      <group position={globe.centre}>
        {/* The planet's body: the oceans, and the solid the depth buffer
            and the raycaster need. Back faces only, so the camera sees
            INTO the globe but not THROUGH it and stops between the camera
            and the centre stay readable; what that paints is the far
            inner surface, which from outside reads as the planet's disc.
            Slightly under the true radius so surface landfalls and the
            graticule are not z-fought away. Opaque on purpose: a
            transparent body would sort into the blended pass and stop
            hiding the far side's dots. A click still recentres the orbit
            on Earth. */}
        <mesh
          onClick={(e) => {
            if (e.delta > 8) return
            e.stopPropagation()
            markSceneTapHandled()
            ownHyperspaceView()
            useCyberspace.getState().focusOn({ x: CENTRE, y: CENTRE, z: CENTRE }, 0, 'EARTH')
          }}
        >
          <sphereGeometry args={[globe.radius * 0.995, 32, 16]} />
          <meshBasicMaterial colorWrite={false} side={BackSide} />
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
      <lineSegments geometry={graticule.blue} frustumCulled={false}>
        <lineBasicMaterial color={EARTH} transparent opacity={0.32} toneMapped={false} />
      </lineSegments>
      {graticule.coast && (
        <lineSegments geometry={graticule.coast} frustumCulled={false}>
          <lineBasicMaterial color={COAST} transparent opacity={0.75} toneMapped={false} />
        </lineSegments>
      )}
      <lineSegments geometry={graticule.green} frustumCulled={false}>
        <lineBasicMaterial color={MERIDIAN} transparent opacity={0.75} toneMapped={false} />
      </lineSegments>
      <WorldLabel text="EQUATOR" color={MERIDIAN} at={graticule.equatorAt} px={10} opacity={0.85} align="center" />
      <WorldLabel text="PRIME MERIDIAN" color={MERIDIAN} at={graticule.meridianAt} px={10} opacity={0.85} align="center" />
    </>
  )
}
