/**
 * Cursor.tsx - the uncommitted destination.
 *
 * WASD moves this, not you. The dashed tether from the avatar is the action
 * you are lining up. When the hop fits the Cantor ceiling it is one amber
 * leg straight to the cursor. When a wall blocks it, the tether splits: a
 * purple leg to the sidestep landing (1 gibson past the wall, where Space
 * actually takes you) and a second leg for the remaining journey, amber if a
 * hop can finish it, red if another wall still stands. While a proof is
 * computing the display locks to the committed target instead of the live
 * cursor.
 */

import { useLayoutEffect, useMemo, useRef } from 'react'
import { Billboard, Text } from '@react-three/drei'
import { useFrame, type RootState } from '@react-three/fiber'
import { Group, Vector3 } from 'three'
import { formatCellSize } from '../lib/scale'
import {
  BufferGeometry,
  EdgesGeometry,
  Float32BufferAttribute,
  Line,
  LineDashedMaterial,
  BoxGeometry,
} from 'three'
import { estimateHopCost } from 'cyberspace-core'
import { DANGER, SIDESTEP, WARN } from '../lib/palette'
import { alignTo, cellDelta, type Position, type ViewAxes } from '../lib/space'
import {
  MAX_COMPUTE_HEIGHT,
  alignedOrigin,
  samePosition,
  sidestepTarget,
  useCyberspace,
} from '../store/useCyberspace'

interface Props {
  axes: ViewAxes
}

function makeDashedLine(geometry: BufferGeometry): Line {
  const line = new Line(
    geometry,
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
}

function setSegment(line: Line, geometry: BufferGeometry, a: number[], b: number[], color: string): void {
  geometry.setAttribute('position', new Float32BufferAttribute([...a, ...b], 3))
  geometry.attributes.position.needsUpdate = true
  // Dash rendering needs per-vertex distances recomputed on every reshape.
  line.computeLineDistances()
  ;(line.material as LineDashedMaterial).color.set(color)
}

export function Cursor({ axes }: Props): JSX.Element | null {
  const position = useCyberspace((s) => s.position)
  const cursor = useCyberspace((s) => s.cursor)
  const pendingTarget = useCyberspace((s) => s.pendingTarget)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const plane = useCyberspace((s) => s.plane)

  const target = pendingTarget ?? cursor
  const active = !samePosition(position, target)

  // The action being lined up: null legs when inactive; a landing splits the
  // journey when the direct hop is beyond the Cantor ceiling.
  const plan = useMemo(() => {
    if (!active) return null
    const direct = estimateHopCost(
      position.x, position.y, position.z,
      target.x, target.y, target.z,
      plane,
      MAX_COMPUTE_HEIGHT,
    )
    if (!direct.exceedsLimit) return { landing: null, remainderBlocked: false }
    const landing = sidestepTarget(position, target)
    if (samePosition(landing, target)) return { landing: null, remainderBlocked: false }
    const remainder = estimateHopCost(
      landing.x, landing.y, landing.z,
      target.x, target.y, target.z,
      plane,
      MAX_COMPUTE_HEIGHT,
    )
    return { landing, remainderBlocked: remainder.exceedsLimit }
  }, [active, position, target, plane])

  // Screen-space endpoints, at cell CENTRES.
  //
  // These used to come from which carries a half-cell bias: it was
  // written when a cell was drawn as a square anchored at its corner. Now the
  // cursor is a cube centred on its cell, and terrain points sit at integer cell
  // offsets, so that bias put the line's endpoint on the cube's face rather than
  // at its centre. The offset is 0.5 - 0.5/step, so it is invisible at scaleExp
  // 0 and grows to nearly half a cell by scaleExp 14.
  const points = useMemo(() => {
    const origin = alignedOrigin(position, scaleExp)
    const centre = (p: Position): [number, number, number] => [
      cellDelta(alignTo(p[axes.right.axis], scaleExp), origin[axes.right.axis], scaleExp) * axes.right.dir,
      cellDelta(alignTo(p[axes.up.axis], scaleExp), origin[axes.up.axis], scaleExp) * axes.up.dir,
      cellDelta(alignTo(p[axes.out.axis], scaleExp), origin[axes.out.axis], scaleExp) * axes.out.dir,
    ]
    const b = centre(target)
    return {
      a: centre(position),
      b,
      landing: plan?.landing ? centre(plan.landing) : null,
      targetCell: b,
    }
  }, [position, target, plan, scaleExp, axes])

  const leg1Geometry = useMemo(() => new BufferGeometry(), [])
  const leg2Geometry = useMemo(() => new BufferGeometry(), [])
  const leg1 = useMemo(() => makeDashedLine(leg1Geometry), [leg1Geometry])
  const leg2 = useMemo(() => makeDashedLine(leg2Geometry), [leg2Geometry])

  // A cube, not a square: the view orbits now, so the target cell has to read
  // as a volume from any angle rather than as a plane seen face-on.
  const cellOutline = useMemo(() => new EdgesGeometry(new BoxGeometry(1, 1, 1)), [])

  const targetColor = plan?.landing
    ? plan.remainderBlocked ? DANGER : WARN
    : WARN

  useLayoutEffect(() => {
    const { a, b, landing } = points
    if (landing) {
      setSegment(leg1, leg1Geometry, a, landing, SIDESTEP)
      setSegment(leg2, leg2Geometry, landing, b, targetColor)
      leg2.visible = true
    } else {
      setSegment(leg1, leg1Geometry, a, b, targetColor)
      leg2.visible = false
    }
  }, [points, targetColor, leg1, leg2, leg1Geometry, leg2Geometry])

  if (!active) return null

  return (
    <group position={[0, 0, 0.04]}>
      <primitive object={leg1} />
      <primitive object={leg2} />

      {/* Sidestep landing: where Space actually takes you */}
      {points.landing && (
        <mesh position={points.landing} renderOrder={10}>
          <circleGeometry args={[0.14, 4]} />
          <meshBasicMaterial color={SIDESTEP} toneMapped={false} transparent depthTest={false} />
        </mesh>
      )}

      {/* The cell the lined-up action targets */}
      <lineSegments geometry={cellOutline} position={points.targetCell} frustumCulled={false} renderOrder={10}>
        <lineBasicMaterial color={targetColor} toneMapped={false} transparent opacity={0.85} depthTest={false} />
      </lineSegments>

      {/* The scale reading, attached to the cursor rather than parked on the
          left edge. The cursor cube IS the instrument: one cell wide, so the
          label states what that cube measures. Billboarded and scaled to a
          constant screen size, so it stays readable at any orbit distance. */}
      <ScaleLabel scaleExp={scaleExp} color={targetColor} />

      {/* Exact cursor point */}
      <mesh position={points.b} renderOrder={10}>
        <ringGeometry args={[0.12, 0.2, 24]} />
        <meshBasicMaterial color={targetColor} toneMapped={false} transparent depthTest={false} />
      </mesh>
    </group>
  )
}

/** A constant-screen-size, camera-facing label for the cursor's cell size. */
function ScaleLabel({ scaleExp, color }: { scaleExp: number; color: string }): JSX.Element {
  const group = useRef<Group>(null)
  const label = useMemo(() => formatCellSize(scaleExp), [scaleExp])

  // World scale is set from view depth each frame so the text holds a constant
  // pixel height. Without this it shrinks to nothing as you pull the camera out.
  useFrame((state: RootState) => {
    const g = group.current
    if (!g) return
    const cam = state.camera as unknown as { fov?: number; position: Vector3 }
    if (cam.fov === undefined) return
    const depth = Math.max(0.001, cam.position.distanceTo(g.getWorldPosition(new Vector3())))
    const projScale = state.size.height / (2 * Math.tan((cam.fov * Math.PI) / 360))
    const s = (14 * depth) / projScale
    g.scale.setScalar(s)
  })

  return (
    <group ref={group} position={[0.75, 0.75, 0]}>
      <Billboard>
        <Text
          fontSize={1}
          anchorX="left"
          anchorY="middle"
          color={color}
          outlineWidth={0.06}
          outlineColor="#05070d"
        >
          {label}
        </Text>
      </Billboard>
    </group>
  )
}
