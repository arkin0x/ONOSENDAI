/**
 * Avatar.tsx — you.
 *
 * A red wireframe icosahedron marks your exact position in cyberspace.
 * This is the same avatar shape from Onosendai v1, representing your
 * presence at this coordinate.
 */

import { useMemo } from 'react'
import { IcosahedronGeometry, EdgesGeometry } from 'three'
import { cellOffset, type ViewAxes } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'

interface Props {
  axes: ViewAxes
}

export function Avatar({ axes }: Props): JSX.Element {
  const position = useCyberspace((s) => s.position)
  const viewCenter = useCyberspace((s) => s.viewCenter())
  const scaleExp = useCyberspace((s) => s.scaleExp)

  const [ax, ay] = useMemo(() => {
    const origin = alignedOrigin(viewCenter, scaleExp)
    const ax = cellOffset(position[axes.right.axis], origin[axes.right.axis], scaleExp, axes.right.dir)
    const ay = cellOffset(position[axes.up.axis], origin[axes.up.axis], scaleExp, axes.up.dir)
    return [ax, ay]
  }, [position, viewCenter, scaleExp, axes])

  const avatarGeometry = useMemo(() => {
    const geo = new IcosahedronGeometry(0.5, 1)
    return new EdgesGeometry(geo)
  }, [])

  return (
    <group position={[ax, ay, 0.1]}>
      <lineSegments geometry={avatarGeometry} frustumCulled={false}>
        <lineBasicMaterial color="#ff2323" toneMapped={false} />
      </lineSegments>
    </group>
  )
}
