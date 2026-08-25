/**
 * TransitAvatar.tsx - you, mid-hyperjump.
 *
 * While a ride proof is computing, the identity is provably BETWEEN blocks:
 * boarding pinned it to the station, and the finished proof will set it down
 * at the destination, so the honest picture of the ride is a presence
 * walking the line. This ghost draws the avatar's icosahedron at the stop
 * whose height matches the proof's progress, hopping block to block as
 * leaves complete, with the count riding above it. The real avatar stays
 * wherever the chain last put it, because nothing about the chain has moved
 * yet: the ghost is the ride, not the record.
 */
import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { EdgesGeometry, IcosahedronGeometry, LineBasicMaterial } from 'three'
import { pointCentre, type ViewAxes } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { getStopByHeight } from '../store/useHyperspace'
import { rideVisualHeight } from '../lib/hyperspace/ride'
import { stopPlane, stopPosition, useRideRun } from '../hud/HyperspacePanel'
import { WorldLabel } from './WorldLabel'

/** The avatar's own red; the ghost is you, so it wears your colour. */
const YOU = '#ff2323'

export function TransitAvatar({ axes }: { axes: ViewAxes }): JSX.Element | null {
  const anchor = useCyberspace((s) => s.anchor)
  const anchorPlane = useCyberspace((s) => s.anchorPlane)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const progress = useRideRun((s) => s.progress)
  const path = useRideRun((s) => s.path)

  const geometry = useMemo(() => new EdgesGeometry(new IcosahedronGeometry(0.5, 1)), [])
  const material = useMemo(
    () => new LineBasicMaterial({ color: YOU, toneMapped: false, transparent: true }),
    [],
  )
  useEffect(() => () => { geometry.dispose(); material.dispose() }, [geometry, material])

  // A ghost breathes: computation is happening right now, and a steady mesh
  // would read as a thing standing still instead of a thing in flight.
  useFrame((state) => {
    material.opacity = 0.6 + 0.3 * Math.sin(state.clock.elapsedTime * 5)
  })

  if (!progress || !path) return null
  const height = rideVisualHeight(path.fromHeight, path.toHeight, progress.done, progress.total)
  const stop = getStopByHeight(height)
  if (!stop || stopPlane(stop) !== anchorPlane) return null
  const centre = pointCentre(stopPosition(stop), alignedOrigin(anchor, scaleExp), scaleExp, axes)

  // Sized like the stop cubes: honest at gibson scale, clamped to a landmark
  // at planetary zoom, so the ghost reads beside the blocks it is passing.
  const k = Math.max(2 ** -scaleExp, 0.15)

  return (
    <group position={centre}>
      <group scale={[k, k, k]}>
        <lineSegments geometry={geometry} material={material} frustumCulled={false} renderOrder={6} />
      </group>
      <WorldLabel
        text={`RIDING · BLOCK ${height} · ${Math.min(progress.done, progress.total)}/${progress.total}`}
        color={YOU}
        at={[0, k * 0.9 + 0.35, 0]}
        px={10}
        opacity={0.9}
      />
    </group>
  )
}
