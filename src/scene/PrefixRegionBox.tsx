/**
 * PrefixRegionBox.tsx - the region a /C/ link's coordinate prefix names
 * (lib/coordRoute.ts, store/useCoordRoute.ts), drawn while the link's view
 * lasts.
 *
 * Yellow (palette PREFIX), edges only, in the manner of the game and deploy
 * boxes. A prefix fixes the top bits of the interleaved coordinate, so the
 * axes can stop at different heights and the box is a slab or a cube: each
 * axis is sized on its own. Labelled with the prefix, so a shared region
 * says what it is. Skipped when it would be too large or too small to read
 * at the zoom, as the other boxes are.
 */

import { useMemo } from 'react'
import { BoxGeometry, EdgesGeometry } from 'three'
import { GRID_RADIUS, cellDelta, type ViewAxes } from '../lib/space'
import { PREFIX } from '../lib/palette'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { useCoordRoute } from '../store/useCoordRoute'
import { WorldLabel } from './WorldLabel'

interface Props {
  axes: ViewAxes
}

/** Cells a side of 2^h gibsons spans at this zoom. */
function cells(h: number, scaleExp: number): number {
  const exp = h - scaleExp
  return exp >= 0 ? 2 ** exp : 1 / 2 ** -exp
}

export function PrefixRegionBox({ axes }: Props): JSX.Element | null {
  const region = useCoordRoute((s) => s.region)
  const anchor = useCyberspace((s) => s.anchor)
  const anchorPlane = useCyberspace((s) => s.anchorPlane)
  const scaleExp = useCyberspace((s) => s.scaleExp)

  const geometry = useMemo(() => new EdgesGeometry(new BoxGeometry(1, 1, 1)), [])

  const box = useMemo(() => {
    if (!region || region.plane !== anchorPlane) return null
    const origin = alignedOrigin(anchor, scaleExp)
    const centre: [number, number, number] = [0, 0, 0]
    const size: [number, number, number] = [1, 1, 1]
    let tooBig = false
    let tooSmall = true
    ;[axes.right, axes.up, axes.out].forEach((a, i) => {
      const side = cells(region.heights[a.axis], scaleExp)
      if (side > GRID_RADIUS * 8) tooBig = true
      if (side >= 0.02) tooSmall = false
      const lo = cellDelta(region.base[a.axis], origin[a.axis], scaleExp)
      centre[i] = (lo + (side - 1) / 2) * a.dir
      size[i] = side
    })
    if (tooBig || tooSmall) return null
    return { centre, size }
  }, [region, anchor, anchorPlane, scaleExp, axes])

  if (!box || !region) return null
  const top: [number, number, number] = [box.centre[0] - box.size[0] / 2, box.centre[1] + box.size[1] / 2, box.centre[2]]
  return (
    <>
      <lineSegments geometry={geometry} position={box.centre} scale={box.size} frustumCulled={false} renderOrder={9}>
        <lineBasicMaterial color={PREFIX} toneMapped={false} transparent opacity={0.85} depthTest={false} />
      </lineSegments>
      <WorldLabel text={`C/${region.prefix}`} color={PREFIX} at={top} px={13} />
    </>
  )
}
