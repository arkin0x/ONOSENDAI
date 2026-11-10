/**
 * SeedArrows.tsx - which way a seed's bloom will stand, while it is aimed
 * (DECK-0008 §5.7; owner ruling 2026-11-10: "it should show an up arrow to
 * indicate its upward direction, and a forward arrow to indicate its
 * forward-facing direction. label the arrows (up, front)").
 *
 * Two plain arrows from the landing point, in the build cursor's color and
 * line style: "up" along the bloom's +Y and "front" along its +Z, after the
 * deploy bar's TURN and, when it stands on Earth, its SNAP TO EARTH and
 * FINE ROTATION (orientation.ts standArrows). They ride the live landing
 * point each frame, as the ghost does.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BufferGeometry, Float32BufferAttribute, type Group } from 'three'
import type { V3 } from '../lib/pose'
import { BUILD } from '../lib/palette'
import { WorldLabel } from './WorldLabel'

/** Line endpoints for an arrow of `length` along unit `d` from the origin: the shaft and two short barbs. */
export function arrowSegments(d: V3, length: number): number[] {
  const tip: V3 = [d[0] * length, d[1] * length, d[2] * length]
  // Any direction across the shaft: from the axis the arrow points least along.
  const a: V3 = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
  const c: V3 = [d[1] * a[2] - d[2] * a[1], d[2] * a[0] - d[0] * a[2], d[0] * a[1] - d[1] * a[0]]
  const n = Math.hypot(c[0], c[1], c[2]) || 1
  const side: V3 = [c[0] / n, c[1] / n, c[2] / n]
  const h = length * 0.18
  const barb = (s: number): number[] => [...tip, tip[0] - d[0] * h + side[0] * h * 0.5 * s, tip[1] - d[1] * h + side[1] * h * 0.5 * s, tip[2] - d[2] * h + side[2] * h * 0.5 * s]
  return [0, 0, 0, ...tip, ...barb(1), ...barb(-1)]
}

export function SeedArrows({ follow, up, front, length }: { follow: () => [number, number, number]; up: V3; front: V3; length: number }): JSX.Element {
  const group = useRef<Group>(null)
  const geometry = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute([...arrowSegments(up, length), ...arrowSegments(front, length)], 3))
    return g
  }, [up, front, length])
  // FINE ROTATION following the camera makes a new one each degree: the old goes when it is replaced.
  useEffect(() => () => geometry.dispose(), [geometry])
  useFrame(() => {
    const p = follow()
    group.current?.position.set(p[0], p[1], p[2])
  })
  const at = (d: V3) => (): [number, number, number] => {
    const p = follow()
    return [p[0] + d[0] * length * 1.12, p[1] + d[1] * length * 1.12, p[2] + d[2] * length * 1.12]
  }
  return (
    <>
      <group ref={group}>
        <lineSegments name="seed-arrows" geometry={geometry} frustumCulled={false} renderOrder={11}>
          <lineBasicMaterial color={BUILD} toneMapped={false} transparent opacity={0.9} depthTest={false} />
        </lineSegments>
      </group>
      <WorldLabel text="up" color={BUILD} follow={at(up)} align="center" px={12} />
      <WorldLabel text="front" color={BUILD} follow={at(front)} align="center" px={12} />
    </>
  )
}
