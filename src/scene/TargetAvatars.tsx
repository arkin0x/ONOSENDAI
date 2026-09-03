/**
 * TargetAvatars.tsx — a targeted avatar, once you are close enough to see it.
 *
 * The HUD marker says where a target is from any distance; this is the thing
 * itself when it is inside the drawn world: the same wireframe icosahedron you
 * are drawn as, in the target's own colour, with its name over it. The
 * position is the chain head the tracker keeps current, so a target that hops
 * while you watch moves here the same frame its marker does.
 */

import { useMemo } from 'react'
import { EdgesGeometry, IcosahedronGeometry } from 'three'
import { GRID_RADIUS, cellCentre, type ViewAxes } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { WorldLabel } from './WorldLabel'

/** Same cull as Earth and the spawn marker. */
const REACH = GRID_RADIUS * 8

/**
 * Only at scales below 2^10 gibsons per cell. The icosahedron is a cell wide
 * whatever the zoom, so at the top of the ladder it was an eighth of
 * cyberspace, and it sits on the cell's centre while the HUD marker sits on
 * the exact point, up to a cell apart. Far out, the marker is the target.
 */
const AVATAR_SCALE_LIMIT = 10

interface Props {
  axes: ViewAxes
}

export function TargetAvatars({ axes }: Props): JSX.Element | null {
  const targets = useCyberspace((s) => s.targets)
  const anchor = useCyberspace((s) => s.anchor)
  const anchorPlane = useCyberspace((s) => s.anchorPlane)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const focus = useCyberspace((s) => s.focusPubkey())
  const geometry = useMemo(() => new EdgesGeometry(new IcosahedronGeometry(0.5, 1)), [])

  const near = useMemo(() => {
    if (scaleExp >= AVATAR_SCALE_LIMIT) return []
    const origin = alignedOrigin(anchor, scaleExp)
    const list = useCyberspace.getState().targetList()
    return list
      // Someone standing in the other plane is not here (§2.4).
      .filter((t) => t.id !== focus && targets[t.id]?.plane === anchorPlane)
      .map((t) => ({ ...t, centre: cellCentre(t.at, origin, scaleExp, axes) }))
      .filter((t) => Math.hypot(...t.centre) <= REACH)
    // targets is what targetList reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targets, anchor, anchorPlane, scaleExp, axes, focus])

  if (near.length === 0) return null

  return (
    <>
      {near.map((t) => (
        <group key={t.id} position={t.centre}>
          <lineSegments geometry={geometry} frustumCulled={false}>
            <lineBasicMaterial color={t.color} toneMapped={false} />
          </lineSegments>
          <WorldLabel text={t.label} color={t.color} at={[0, 0.9, 0]} align="center" px={11} opacity={0.9} />
        </group>
      ))}
    </>
  )
}
