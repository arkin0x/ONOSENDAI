/**
 * SphereOfInterest.tsx - the boundary of the sphere of interest, drawn on
 * the ground.
 *
 * From 2^49 down the stop field is cut to a sphere around the focus
 * (interest.ts), and a cut that is not drawn looks like missing data: the
 * dots just stop. This draws the circle where that sphere meets the
 * ellipsoid, in the accent colour, so the edge of the lit region reads as
 * a boundary that was planned. A label at the circle's northernmost point
 * says how big the sphere is, in the units every other distance in the
 * HUD uses, and which aligned height it is.
 *
 * Drawn the way EarthPatch draws its graticule: the ring's vertices are
 * latitude/longitude pairs, each solved exactly on the ellipsoid by
 * sphereRing, turned into float64 meter deltas from the render origin by
 * surfaceVertex. So the circle sits on the same ground as the rulings and
 * the coast at every zoom from 2^49 to 2^32, and fades out with them below
 * human scale, where the sphere still culls but there is no ground left to
 * draw its edge on. Lifted half a cell so it is never buried in the
 * graticule where the two cross.
 */

import { useEffect, useMemo } from 'react'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import { ACCENT } from '../lib/palette'
import type { ViewAxes } from '../lib/space'
import { formatDistance } from '../lib/scale'
import { GIBSONS_PER_M, originCsMetres, sphereRing, surfaceDetailOpacity, surfaceVertex } from '../lib/earthSurface'
import { interestSphere } from '../lib/hyperspace/interest'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { WorldLabel } from './WorldLabel'

/**
 * Vertices around the ring. Its radius is 32 cells at every zoom, so the
 * chord sag at this count is four thousandths of a cell: a circle at any
 * distance the camera can be from it.
 */
const SEGMENTS = 192

interface BuiltRing {
  geometry: BufferGeometry
  labelAt: [number, number, number]
  label: string
  opacity: number
}

export function SphereOfInterest({ axes }: { axes: ViewAxes }): JSX.Element | null {
  const anchor = useCyberspace((s) => s.anchor)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const plane = useCyberspace((s) => s.anchorPlane)
  const focus = useCyberspace((s) => s.focus)

  const built = useMemo((): BuiltRing | null => {
    if (plane !== 0) return null
    const sphere = interestSphere(focus, scaleExp)
    if (!sphere) return null
    const opacity = surfaceDetailOpacity(scaleExp)
    if (opacity <= 0) return null
    // The radius is a power of two gibsons, so this division is exact.
    const radiusM = Number(sphere.radius) / GIBSONS_PER_M
    const ring = sphereRing(originCsMetres(sphere.centre), radiusM, SEGMENTS)
    if (!ring) return null

    const originM = originCsMetres(alignedOrigin(anchor, scaleExp))
    const cellM = 2 ** (scaleExp - 33)
    const verts: number[] = []
    let top = ring[0]
    for (const pt of ring) {
      verts.push(...surfaceVertex(pt[0], pt[1], 0.5 * cellM, originM, scaleExp, axes))
      if (pt[0] > top[0]) top = pt
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(verts, 3))
    const built = {
      geometry,
      labelAt: surfaceVertex(top[0], top[1], 2 * cellM, originM, scaleExp, axes),
      label: `r ${formatDistance(sphere.radius)} · h${sphere.height}`,
      opacity,
    }
    // The same dev hook style as __stopField: lets a headless harness read
    // the ring that reached the GPU rather than squint at a screenshot.
    if (import.meta.env.DEV) {
      geometry.computeBoundingSphere()
      const w = window as unknown as { __sphereRing?: unknown }
      w.__sphereRing = {
        height: sphere.height,
        label: built.label,
        vertices: verts.length / 3,
        // Cells, so a harness can tell whether it is in frame at all.
        radiusCells: geometry.boundingSphere?.radius ?? null,
        centreCells: geometry.boundingSphere?.center.toArray() ?? null,
      }
    }
    return built
  }, [focus, scaleExp, plane, anchor, axes])

  useEffect(() => {
    if (!import.meta.env.DEV || built) return
    ;(window as unknown as { __sphereRing?: unknown }).__sphereRing = null
  }, [built])

  // GPU buffers are not garbage collected; release each ring when replaced.
  useEffect(() => () => { built?.geometry.dispose() }, [built])

  if (!built) return null

  return (
    <group>
      <lineLoop geometry={built.geometry} frustumCulled={false}>
        <lineBasicMaterial color={ACCENT} transparent opacity={0.9 * built.opacity} toneMapped={false} />
      </lineLoop>
      <WorldLabel text={built.label} color={ACCENT} at={built.labelAt} px={11} opacity={0.9 * built.opacity} align="center" />
    </group>
  )
}
