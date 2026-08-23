/**
 * DeployRegionBox.tsx — the area a hidden thing can be found from.
 *
 * While deploying, a green box marks the aligned 2^height cube the cursor sits
 * in: the region whose key opens the content (spec §7). It grows and shrinks by
 * powers of two as you change the height, so you can see how far away someone
 * could be and still find it. At height 0 it is a single gibson; each step up
 * doubles each side. Drawn from the cursor, so it moves as you aim.
 */

import { useMemo } from 'react'
import { BoxGeometry, EdgesGeometry } from 'three'
import { GRID_RADIUS, cellDelta, type AxisName, type ViewAxes } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { useShards } from '../store/useShards'

/** The green of "found here", the same as the LIVE tag. */
const REGION = '#52e39f'

interface Props {
  axes: ViewAxes
}

export function DeployRegionBox({ axes }: Props): JSX.Element | null {
  const pending = useShards((s) => s.pending)
  const height = useShards((s) => s.deployHeight)
  const cursor = useCyberspace((s) => s.cursor)
  const anchor = useCyberspace((s) => s.anchor)
  const scaleExp = useCyberspace((s) => s.scaleExp)

  const geometry = useMemo(() => new EdgesGeometry(new BoxGeometry(1, 1, 1)), [])

  const box = useMemo(() => {
    if (!pending) return null
    // Side length in cells at this zoom: 2^(height - scaleExp).
    const exp = height - scaleExp
    const side = exp >= 0 ? Number(1n << BigInt(exp)) : 1 / Number(1n << BigInt(-exp))
    // Too large to read, or the cursor cube already covers it: skip.
    if (side > GRID_RADIUS * 8 || side < 0.02) return null

    const origin = alignedOrigin(anchor, scaleExp)
    const h = BigInt(height)
    const centre: [number, number, number] = [0, 0, 0]
    ;[axes.right, axes.up, axes.out].forEach((a, i) => {
      const axis: AxisName = a.axis
      const base = (cursor[axis] >> h) << h
      const lo = cellDelta(base, origin[axis], scaleExp)
      // The cube spans `side` cells from its low corner; centre it.
      centre[i] = (lo + (side - 1) / 2) * a.dir
    })
    return { centre, side }
  }, [pending, height, cursor, anchor, scaleExp, axes])

  if (!box) return null

  return (
    <lineSegments geometry={geometry} position={box.centre} scale={box.side} frustumCulled={false} renderOrder={9}>
      <lineBasicMaterial color={REGION} toneMapped={false} transparent opacity={0.85} depthTest={false} />
    </lineSegments>
  )
}
