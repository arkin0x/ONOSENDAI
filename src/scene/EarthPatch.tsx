/**
 * EarthPatch.tsx - the ground: Earth's surface drawn where you actually are.
 *
 * The globe in Earth.tsx exists only while the whole planet fits the grid,
 * which is scale 2^50 and coarser; below that the renderer used to draw
 * nothing, and the planet you were standing on vanished. This fills that
 * dead band. From 2^49 down to human scale the surface is a graticule
 * PATCH: the piece of the true WGS84 ellipsoid within reach of the anchor,
 * with vertices computed as float64 metre deltas from the render origin
 * (earthSurface.ts), so precision holds at every zoom with no Decimal
 * anywhere in the render path.
 *
 * The curvature is never approximated: the patch IS the ellipsoid,
 * evaluated only where the view can see it. Across the grid the sagitta is
 * about 0.4 cells at 2^40, 12 cells at 2^45, and the full hemispheric wrap
 * by 2^49, so the band where Earth visibly curves is exactly the band the
 * globe could never reach.
 *
 * Below human scale (2^34) the patch fades, gone at 2^31: a graticule is a
 * map of places, and metre scale is where the view stops being about
 * places. The fade is deliberate teaching, zooming past the shoreline is
 * supposed to feel like leaving geography for the microscopic.
 *
 * Graticule lines sit on 1/2/5-decade degree rulings anchored to the
 * planet, so moving slides you across a fixed grid rather than dragging
 * one along. The equator and prime meridian draw in v1's green with v1's
 * labels, and the shorelines draw over the rulings from whichever Natural
 * Earth tier the zoom deserves (coastline.ts), brighter than the grid:
 * the graticule is reference, the coast is content. A depth-only ground
 * mesh sits a couple of cells beneath the lines, so the far side of the
 * horizon hides what is beyond it.
 */

import { useEffect, useMemo } from 'react'
import { BackSide, BufferGeometry, DoubleSide, Float32BufferAttribute, FrontSide } from 'three'
import { EARTH, LAND, MERIDIAN, OCEAN } from '../lib/palette'
import { GRID_RADIUS, type ViewAxes } from '../lib/space'
import { axesToLatLon } from '../lib/hyperspace/landfall'
import {
  EARTH_RADIUS_KM,
  earthRadiusCells,
  graticuleStep,
  originCsMetres,
  outwardSide,
  surfaceDetailOpacity,
  surfaceVertex,
} from '../lib/earthSurface'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { coastTier, linesInWindow } from '../lib/coastline'
import { LAND_CHORD_SAG_M, landTier, trianglesInWindow } from '../lib/land'
import { useCoastline } from '../hooks/useCoastline'
import { useLand } from '../hooks/useLand'
import { WorldLabel } from './WorldLabel'

const REACH = GRID_RADIUS * 8

/** Samples per graticule line: smooth at hemispheric spans, cheap always. */
const SAMPLES = 48

/** Ground occluder resolution, quads per side. */
const GROUND_N = 24

interface BuiltPatch {
  grid: BufferGeometry
  green: BufferGeometry | null
  coast: BufferGeometry | null
  land: BufferGeometry | null
  landSide: typeof FrontSide | typeof BackSide
  ground: BufferGeometry
  equatorAt: [number, number, number] | null
  meridianAt: [number, number, number] | null
  opacity: number
}

export function EarthPatch({ axes }: { axes: ViewAxes }): JSX.Element | null {
  const anchor = useCyberspace((s) => s.anchor)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const plane = useCyberspace((s) => s.anchorPlane)

  // The shoreline tier this zoom deserves, fetched once per page. Null while
  // the patch cannot draw at all, so ideaspace never pulls megabytes of coast.
  const wantCoast =
    plane === 0 &&
    surfaceDetailOpacity(scaleExp) > 0 &&
    earthRadiusCells(scaleExp) * 2 > GRID_RADIUS * 8
  const coast = useCoastline(wantCoast ? coastTier(scaleExp) : null)
  // The land fill stops two tiers before the lines do (see landTier): a 50m
  // polygon edge sits a kilometre or two off the 10m shoreline it would be
  // drawn under, which is nothing across a continent and obvious across a
  // bay. Lines keep their own finer tiers; only the fill bows out.
  const land = useLand(wantCoast ? landTier(scaleExp) : null)

  const built = useMemo((): BuiltPatch | null => {
    // Ideaspace has no planet (§9.1); the globe regime belongs to Earth.tsx.
    if (plane !== 0) return null
    const opacity = surfaceDetailOpacity(scaleExp)
    if (opacity <= 0) return null
    if (earthRadiusCells(scaleExp) * 2 <= GRID_RADIUS * 8) return null

    // Where the ground is: the geodetic foot of the anchor. If the surface
    // is farther away than the view reaches, there is no ground in frame.
    const geo = axesToLatLon(anchor.x, anchor.y, anchor.z)
    const cellM = 2 ** (scaleExp - 33)
    const reachM = REACH * cellM
    if (Math.abs(geo.altM) > reachM * 1.5) return null

    // The lat/lon window the reach can see, capped at a hemisphere: at the
    // top of the regime the window IS the visible face of the planet, and
    // the surface curling over the horizon is the point.
    const radiusM = EARTH_RADIUS_KM * 1000
    const halfLat = Math.min(90, (reachM / radiusM) * (180 / Math.PI) * 1.2)
    const cosLat = Math.max(0.05, Math.cos((geo.lat * Math.PI) / 180))
    const halfLon = Math.min(179.9, halfLat / cosLat)
    const step = graticuleStep(halfLat * 2)

    const originM = originCsMetres(alignedOrigin(anchor, scaleExp))
    const at = (lat: number, lon: number, altM = 0): [number, number, number] =>
      surfaceVertex(lat, lon, altM, originM, scaleExp, axes)

    const blue: number[] = []
    const greenArr: number[] = []
    const polyline = (
      out: number[], fix: 'lat' | 'lon', v: number, from: number, to: number,
    ): void => {
      let prev: [number, number, number] | null = null
      for (let i = 0; i <= SAMPLES; i++) {
        const t = from + ((to - from) * i) / SAMPLES
        const p = fix === 'lat' ? at(v, t) : at(t, v)
        if (prev) out.push(...prev, ...p)
        prev = p
      }
    }

    const latFrom = geo.lat - halfLat
    const latTo = geo.lat + halfLat
    const lonFrom = geo.lon - halfLon
    const lonTo = geo.lon + halfLon
    const latLo = Math.max(-90, latFrom)
    const latHi = Math.min(90, latTo)

    // Ruling multiples of the step, so the grid belongs to the planet. The
    // zero rulings are the equator and the prime meridian, drawn in green.
    for (let k = Math.ceil(latFrom / step); k * step <= latTo; k++) {
      const lat = k * step
      if (lat < -90 || lat > 90) continue
      polyline(k === 0 ? greenArr : blue, 'lat', lat, lonFrom, lonTo)
    }
    for (let k = Math.ceil(lonFrom / step); k * step <= lonTo; k++) {
      polyline(k === 0 ? greenArr : blue, 'lon', k * step, latLo, latHi)
    }

    // Labels ride a little above the ground so they never z-fight it.
    const lift = 2 * cellM
    const equatorAt = latFrom < 0 && latTo > 0 ? at(0, geo.lon, lift) : null
    const meridianAt = lonFrom < 0 && lonTo > 0
      ? at(Math.max(latLo, Math.min(latHi, geo.lat)), 0, lift)
      : null

    // The shorelines crossing the window. Rendering is 3D, so a segment
    // hopping the antimeridian is a short chord and needs no splitting;
    // only the inside test walks longitude modulo a full turn. A segment
    // draws when either end is inside, and the fringe a long segment adds
    // past the edge is invisible against the reach.
    const coastArr: number[] = []
    if (coast) {
      const lonSpan = lonTo - lonFrom
      const insideLon = (lon: number): boolean => (((lon - lonFrom) % 360) + 360) % 360 <= lonSpan
      const inside = (lat: number, lon: number): boolean =>
        lat >= latLo && lat <= latHi && insideLon(lon)
      for (const line of linesInWindow(coast, latLo, latHi, lonFrom, lonTo)) {
        const n = line.pts.length / 2
        let prev: [number, number, number] | null = null
        let prevIn = false
        for (let i = 0; i < n; i++) {
          const lat = line.pts[i * 2]
          const lon = line.pts[i * 2 + 1]
          const curIn = inside(lat, lon)
          const cur = curIn || prevIn ? at(lat, lon) : null
          if (prev && cur && (curIn || prevIn)) coastArr.push(...prev, ...cur)
          prev = cur ?? (curIn ? at(lat, lon) : null)
          prevIn = curIn
        }
      }
    }

    // The land inside the window, drawn one cell under the lines. Only the
    // triangles the window touches are mapped, which at a regional zoom is a
    // handful out of the tier's thousands.
    const landArr: number[] = []
    if (land) {
      const tris = trianglesInWindow(land, latLo, latHi, lonFrom, lonTo)
      for (let i = 0; i < tris.length; i++) {
        const v = tris[i]
        landArr.push(...at(land.pts[v * 2], land.pts[v * 2 + 1], -1 * cellM))
      }
    }

    // The ground, sunk under the lines: the camera can see the surface but
    // not through it, so the far side of the horizon hides its stops the way
    // the globe's occluder does at planetary zoom. It paints the oceans while
    // it is there, which costs nothing it was not already drawing.
    //
    // Sunk past the fill's chord sag as well as the two cells, because it is
    // opaque: a refined triangle's middle sits up to 15.6 km below the
    // surface its corners are on, and a ground plane any higher than that
    // would bury the interior of every large continent while leaving its
    // coast drawn. Depth is all this plane does, so a few more kilometres of
    // it costs nothing to look at.
    const ground: number[] = []
    const idx: number[] = []
    for (let r = 0; r <= GROUND_N; r++) {
      const lat = latLo + ((latHi - latLo) * r) / GROUND_N
      for (let c = 0; c <= GROUND_N; c++) {
        const lon = lonFrom + ((lonTo - lonFrom) * c) / GROUND_N
        ground.push(...at(lat, lon, -2 * cellM - LAND_CHORD_SAG_M))
      }
    }
    for (let r = 0; r < GROUND_N; r++) {
      for (let c = 0; c < GROUND_N; c++) {
        const a = r * (GROUND_N + 1) + c
        const b = a + 1
        const d = a + (GROUND_N + 1)
        idx.push(a, b, d, b, d + 1, d)
      }
    }

    const make = (v: number[]): BufferGeometry => {
      const g = new BufferGeometry()
      g.setAttribute('position', new Float32BufferAttribute(v, 3))
      return g
    }
    const groundGeom = make(ground)
    groundGeom.setIndex(idx)
    return {
      grid: make(blue),
      green: greenArr.length > 0 ? make(greenArr) : null,
      coast: coastArr.length > 0 ? make(coastArr) : null,
      land: landArr.length > 0 ? make(landArr) : null,
      landSide: outwardSide(originM, scaleExp, axes),
      ground: groundGeom,
      equatorAt,
      meridianAt,
      opacity,
    }
  }, [anchor, scaleExp, plane, axes, coast, land])

  // GPU buffers are not garbage collected; release each set when replaced.
  useEffect(() => () => {
    if (!built) return
    built.grid.dispose()
    built.green?.dispose()
    built.coast?.dispose()
    built.land?.dispose()
    built.ground.dispose()
  }, [built])

  if (!built) return null

  return (
    <group>
      <mesh geometry={built.ground} frustumCulled={false} renderOrder={-2}>
        <meshBasicMaterial color={OCEAN} side={DoubleSide} toneMapped={false} />
      </mesh>
      {built.land && (
        <mesh geometry={built.land} frustumCulled={false} renderOrder={-1}>
          <meshBasicMaterial
            color={LAND}
            side={built.landSide}
            transparent
            opacity={0.22 * built.opacity}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      )}
      <lineSegments geometry={built.grid} frustumCulled={false}>
        <lineBasicMaterial color={EARTH} transparent opacity={0.32 * built.opacity} toneMapped={false} />
      </lineSegments>
      {built.coast && (
        <lineSegments geometry={built.coast} frustumCulled={false}>
          <lineBasicMaterial color={EARTH} transparent opacity={0.6 * built.opacity} toneMapped={false} />
        </lineSegments>
      )}
      {built.green && (
        <lineSegments geometry={built.green} frustumCulled={false}>
          <lineBasicMaterial color={MERIDIAN} transparent opacity={0.75 * built.opacity} toneMapped={false} />
        </lineSegments>
      )}
      {built.equatorAt && (
        <WorldLabel text="EQUATOR" color={MERIDIAN} at={built.equatorAt} px={10} opacity={0.85 * built.opacity} align="center" />
      )}
      {built.meridianAt && (
        <WorldLabel text="PRIME MERIDIAN" color={MERIDIAN} at={built.meridianAt} px={10} opacity={0.85 * built.opacity} align="center" />
      )}
    </group>
  )
}
