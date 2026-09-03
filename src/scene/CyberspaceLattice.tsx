/**
 * CyberspaceLattice.tsx - v1's top and bottom grids, visible when the whole
 * cube is in view.
 *
 * One LineSegments draw call built from lib/lattice.ts in render cells, so
 * it sits on the same coordinates as the point field, the sector cage and
 * the planet. It fades in from 2^78 and is fully there by 2^80; below that it
 * is not drawn at all, because a grid eight divisions across the universe
 * says nothing about the room you are standing in.
 */
import { useLayoutEffect, useMemo } from 'react'
import { BufferGeometry, Color, Float32BufferAttribute, LineSegments } from 'three'
import { latticeOpacity, latticeSegments } from '../lib/lattice'
import type { ViewAxes } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'

interface Props {
  axes: ViewAxes
}

export function CyberspaceLattice({ axes }: Props): JSX.Element | null {
  const anchor = useCyberspace((s) => s.anchor)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const opacity = latticeOpacity(scaleExp)
  const geometry = useMemo(() => new BufferGeometry(), [])
  const lines = useMemo(() => {
    const l = new LineSegments(geometry)
    l.frustumCulled = false
    l.renderOrder = -2
    return l
  }, [geometry])

  useLayoutEffect(() => {
    if (opacity === 0) return
    const segs = latticeSegments(alignedOrigin(anchor, scaleExp), scaleExp, axes)
    const pos = new Float32Array(segs.length * 6)
    const col = new Float32Array(segs.length * 6)
    const c = new Color()
    segs.forEach((s, i) => {
      pos.set(s.a, i * 6); pos.set(s.b, i * 6 + 3)
      c.set(s.color)
      col.set([c.r, c.g, c.b, c.r, c.g, c.b], i * 6)
    })
    geometry.setAttribute('position', new Float32BufferAttribute(pos, 3))
    geometry.setAttribute('color', new Float32BufferAttribute(col, 3))
    geometry.computeBoundingSphere()
  }, [anchor, scaleExp, axes, opacity, geometry])

  if (opacity === 0) return null
  return (
    <primitive object={lines}>
      <lineBasicMaterial attach="material" vertexColors transparent opacity={0.9 * opacity} toneMapped={false} depthWrite={false} />
    </primitive>
  )
}
