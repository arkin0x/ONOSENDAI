/**
 * Avatar.tsx — you.
 *
 * A red wireframe icosahedron marks your position in cyberspace. Same shape as
 * Onosendai v1.
 *
 * It sits at the origin, which is its own aligned cell, so the gibson point for
 * that cell falls at the exact centre of the mesh. It previously carried a 0.1
 * lift on the out axis, which floated it above a flat plane and, once the scene
 * became a volume, simply pushed it off its own gibson.
 *
 * The one exception to sitting at the origin is a commit, where it is drawn
 * trailing behind its committed cell and catches up over a few hundred
 * milliseconds. See travel.ts for why the animation lives here rather than in
 * the coordinate.
 */

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { IcosahedronGeometry, EdgesGeometry, Group } from 'three'
import { travelOffset } from '../lib/travel'

export function Avatar(): JSX.Element {
  const group = useRef<Group>(null)

  const avatarGeometry = useMemo(() => {
    const geo = new IcosahedronGeometry(0.5, 1)
    return new EdgesGeometry(geo)
  }, [])

  useFrame(() => {
    if (group.current) group.current.position.copy(travelOffset)
  })

  return (
    <group ref={group} position={[0, 0, 0]}>
      <lineSegments geometry={avatarGeometry} frustumCulled={false}>
        <lineBasicMaterial color="#ff2323" toneMapped={false} />
      </lineSegments>
    </group>
  )
}
