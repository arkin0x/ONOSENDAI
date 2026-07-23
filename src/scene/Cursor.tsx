/**
 * Cursor.tsx - the uncommitted destination.
 *
 * WASD moves this, not you. The dashed tether from the avatar is the hop you
 * are lining up, coloured by whether that hop is even computable, and the
 * outlined cell is where Space would land you. While a proof is computing the
 * tether locks to the committed target instead of the live cursor.
 */

import { useLayoutEffect, useMemo } from 'react'
import {
  BufferGeometry,
  EdgesGeometry,
  Float32BufferAttribute,
  Line,
  LineDashedMaterial,
  PlaneGeometry,
} from 'three'
import { estimateHopCost } from 'cyberspace-core'
import { DANGER, WARN } from '../lib/palette'
import { alignTo, cellDelta, cellOffset, type Position, type ViewAxes } from '../lib/space'
import { alignedOrigin, samePosition, useCyberspace } from '../store/useCyberspace'

interface Props {
  axes: ViewAxes
}

export function Cursor({ axes }: Props): JSX.Element | null {
  const position = useCyberspace((s) => s.position)
  const cursor = useCyberspace((s) => s.cursor)
  const pendingTarget = useCyberspace((s) => s.pendingTarget)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const plane = useCyberspace((s) => s.plane)

  const target = pendingTarget ?? cursor
  const active = !samePosition(position, target)

  const feasible = useMemo(() => {
    if (!active) return true
    return !estimateHopCost(
      position.x, position.y, position.z,
      target.x, target.y, target.z,
      plane,
    ).exceedsLimit
  }, [active, position, target, plane])

  // Screen-space endpoints. In-plane axes measure from the aligned cell (the
  // grid's frame); the depth axis measures from the avatar's exact slice.
  const [a, b, cellCenter] = useMemo(() => {
    const origin = alignedOrigin(position, scaleExp)
    const point = (p: Position): [number, number, number] => [
      cellOffset(p[axes.right.axis], origin[axes.right.axis], scaleExp, axes.right.dir),
      cellOffset(p[axes.up.axis], origin[axes.up.axis], scaleExp, axes.up.dir),
      cellDelta(p[axes.out.axis], position[axes.out.axis], scaleExp) * axes.out.dir,
    ]
    const targetCell: [number, number, number] = [
      cellDelta(alignTo(target[axes.right.axis], scaleExp), origin[axes.right.axis], scaleExp) * axes.right.dir,
      cellDelta(alignTo(target[axes.up.axis], scaleExp), origin[axes.up.axis], scaleExp) * axes.up.dir,
      point(target)[2],
    ]
    return [point(position), point(target), targetCell]
  }, [position, target, scaleExp, axes])

  const tetherGeometry = useMemo(() => new BufferGeometry(), [])
  const tether = useMemo(() => {
    const line = new Line(
      tetherGeometry,
      new LineDashedMaterial({
        dashSize: 0.32,
        gapSize: 0.2,
        transparent: true,
        opacity: 0.9,
        toneMapped: false,
        // The cursor can sit behind the slice plane (negative depth after a
        // rotation). It must never vanish there, so it ignores the depth
        // buffer and draws late.
        depthTest: false,
      }),
    )
    line.frustumCulled = false
    line.renderOrder = 10
    return line
  }, [tetherGeometry])

  const cellOutline = useMemo(() => new EdgesGeometry(new PlaneGeometry(1, 1)), [])

  useLayoutEffect(() => {
    tetherGeometry.setAttribute('position', new Float32BufferAttribute([...a, ...b], 3))
    tetherGeometry.attributes.position.needsUpdate = true
    // Dash rendering needs per-vertex distances recomputed on every reshape.
    tether.computeLineDistances()
    ;(tether.material as LineDashedMaterial).color.set(feasible ? WARN : DANGER)
  }, [a, b, feasible, tether, tetherGeometry])

  if (!active) return null

  const color = feasible ? WARN : DANGER

  return (
    <group position={[0, 0, 0.04]}>
      <primitive object={tether} />

      {/* The cell Space would land you in */}
      <lineSegments geometry={cellOutline} position={cellCenter} frustumCulled={false} renderOrder={10}>
        <lineBasicMaterial color={color} toneMapped={false} transparent opacity={0.85} depthTest={false} />
      </lineSegments>

      {/* Exact cursor point */}
      <mesh position={b} renderOrder={10}>
        <ringGeometry args={[0.12, 0.2, 24]} />
        <meshBasicMaterial color={color} toneMapped={false} transparent depthTest={false} />
      </mesh>
    </group>
  )
}
