/**
 * StopCubes.tsx - the hyperjumps themselves, drawn the way v1 drew them: a
 * bright yellow rotating cube, one gibson along each edge.
 *
 * The StopField's points say "there are stops over there"; a cube says "you
 * are AT a stop". One gibson is 2^-scaleExp render cells, so the cube is only
 * honestly visible near gibson scale; below a floor it is clamped so a stop
 * you have flown to never vanishes into a subpixel while still reading as a
 * small landmark rather than a billboard.
 */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Group } from 'three'
import { xyzToCoord } from 'cyberspace-core'
import { cellCentre, GRID_RADIUS, type ViewAxes } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { getStopByHeight, getStopIndex, useHyperspace } from '../store/useHyperspace'
import { nearestStops } from '../lib/hyperspace/station'
import { type Stop } from '../lib/hyperspace/stops'
import { stopPlane, stopPosition } from '../hud/HyperspacePanel'
import { WorldLabel } from './WorldLabel'

/** v1's HYPERJUMP colour. */
const CUBE_COLOR = '#ffff00'
/** At most this many cubes; the point field carries the rest. */
const MAX_CUBES = 24
/** A cube never renders smaller than this many cells (visibility floor). */
const MIN_CELLS = 0.3
const REACH = GRID_RADIUS * 8

export function StopCubes({ axes }: { axes: ViewAxes }): JSX.Element | null {
  const anchor = useCyberspace((s) => s.anchor)
  const anchorPlane = useCyberspace((s) => s.anchorPlane)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const indexVersion = useHyperspace((s) => s.indexVersion)
  const scrubHeight = useHyperspace((s) => s.scrubHeight)
  const destination = useHyperspace((s) => s.destination)

  const cubes = useMemo(() => {
    void indexVersion
    const index = getStopIndex()
    if (index.stops.length === 0) return []
    const origin = alignedOrigin(anchor, scaleExp)
    const anchorCoord = xyzToCoord(anchor.x, anchor.y, anchor.z, anchorPlane)
    const candidates: Stop[] = []
    const seen = new Set<number>()
    const consider = (stop: Stop | undefined): void => {
      if (!stop || seen.has(stop.height)) return
      seen.add(stop.height)
      candidates.push(stop)
    }
    // The stop being viewed and the chosen destination always get a cube;
    // then the prefix-nearest stops fill the rest.
    consider(scrubHeight !== null ? getStopByHeight(scrubHeight) : undefined)
    consider(destination !== null ? getStopByHeight(destination) : undefined)
    for (const near of nearestStops(index, anchorCoord, MAX_CUBES * 2)) consider(near.stop)

    const out: Array<{ stop: Stop; centre: [number, number, number] }> = []
    for (const stop of candidates) {
      if (out.length >= MAX_CUBES) break
      if (stopPlane(stop) !== anchorPlane) continue
      const centre = cellCentre(stopPosition(stop), origin, scaleExp, axes)
      if (Math.abs(centre[0]) > REACH || Math.abs(centre[1]) > REACH || Math.abs(centre[2]) > REACH) continue
      out.push({ stop, centre })
    }
    return out
  }, [indexVersion, anchor, anchorPlane, scaleExp, axes, scrubHeight, destination])

  const spin = useRef<Group>(null)
  useFrame((_, dt) => {
    const g = spin.current
    if (!g) return
    for (const child of g.children) {
      child.rotation.y += dt * 0.9
      child.rotation.x += dt * 0.45
    }
  })

  if (cubes.length === 0) return null
  const side = Math.max(2 ** -scaleExp, MIN_CELLS)

  return (
    <>
      <group ref={spin}>
        {cubes.map(({ stop, centre }) => (
          <mesh key={stop.height} position={centre}>
            <boxGeometry args={[side, side, side]} />
            <meshBasicMaterial color={CUBE_COLOR} toneMapped={false} />
          </mesh>
        ))}
      </group>
      {cubes.map(({ stop, centre }) => (
        <WorldLabel
          key={`l${stop.height}`}
          text={`BLOCK ${stop.height}`}
          color={CUBE_COLOR}
          at={[centre[0], centre[1] + side * 0.9 + 0.3, centre[2]]}
          px={11}
          opacity={0.85}
        />
      ))}
    </>
  )
}
