/**
 * Avatar.tsx — you.
 *
 * Two marks: an outline on the cell you occupy, and a dot at your exact
 * sub-cell position. At scale 2^0 they coincide. Zoomed out they separate, so
 * you can see where inside a large cell you actually stand.
 */

import { useMemo } from 'react'
import { EdgesGeometry, PlaneGeometry } from 'three'
import { ACCENT } from '../lib/palette'
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
    return [
      cellOffset(position[axes.right.axis], origin[axes.right.axis], scaleExp, axes.right.dir),
      cellOffset(position[axes.up.axis], origin[axes.up.axis], scaleExp, axes.up.dir),
    ]
  }, [position, viewCenter, scaleExp, axes])

  const cellOutline = useMemo(() => new EdgesGeometry(new PlaneGeometry(1, 1)), [])

  return (
    <group position={[0, 0, 0.05]}>
      {/* Occupied cell */}
      <lineSegments geometry={cellOutline} frustumCulled={false}>
        <lineBasicMaterial color={ACCENT} toneMapped={false} />
      </lineSegments>

      {/* Exact position */}
      <mesh position={[ax, ay, 0.01]}>
        <circleGeometry args={[0.16, 24]} />
        <meshBasicMaterial color={ACCENT} toneMapped={false} />
      </mesh>
      <mesh position={[ax, ay, 0.005]}>
        <ringGeometry args={[0.26, 0.32, 32]} />
        <meshBasicMaterial color={ACCENT} toneMapped={false} transparent opacity={0.5} />
      </mesh>
    </group>
  )
}
