/**
 * Avatar.tsx — you.
 *
 * A red wireframe icosahedron marks your exact position in cyberspace.
 * This is the same avatar shape from Onosendai v1, representing your
 * presence at this coordinate.
 *
 * Since the terrain is anchored to avatar position, the avatar always
 * renders at the origin (0,0,0) of the world group.
 */

import { useMemo } from 'react'
import { IcosahedronGeometry, EdgesGeometry } from 'three'

export function Avatar(): JSX.Element {
  const avatarGeometry = useMemo(() => {
    const geo = new IcosahedronGeometry(0.5, 1)
    return new EdgesGeometry(geo)
  }, [])

  return (
    <group position={[0, 0, 0.1]}>
      <lineSegments geometry={avatarGeometry} frustumCulled={false}>
        <lineBasicMaterial color="#ff2323" toneMapped={false} />
      </lineSegments>
    </group>
  )
}
