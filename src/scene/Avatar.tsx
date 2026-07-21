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
import { subCellFraction, type ViewAxes } from '../lib/space'
import { useCyberspace } from '../store/useCyberspace'

interface Props {
  axes: ViewAxes
}

export function Avatar({ axes }: Props): JSX.Element {
  const position = useCyberspace((s) => s.position)
  const scaleExp = useCyberspace((s) => s.scaleExp)

  const [ax, ay] = useMemo(() => {
    const fx = subCellFraction(position[axes.right.axis], scaleExp)
    const fy = subCellFraction(position[axes.up.axis], scaleExp)
    // Screen offset runs backwards when the axis points left or down.
    const sx = axes.right.dir === 1 ? fx : 1 - fx
    const sy = axes.up.dir === 1 ? fy : 1 - fy
    return [sx - 0.5, sy - 0.5]
  }, [position, scaleExp, axes])

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
