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
import { useFrame } from '@react-three/fiber'
import { formatCellSize } from '../lib/scale'
import { WorldLabel } from './WorldLabel'
import {
  BufferGeometry,
  EdgesGeometry,
  Float32BufferAttribute,
  Line,
  LineDashedMaterial,
  LineSegments,
  BoxGeometry,
} from 'three'
import { estimateHopCost } from 'cyberspace-core'
import { ACCENT, DANGER, SIDESTEP, WARN } from '../lib/palette'
import { cellCentre, type Position, type ViewAxes } from '../lib/space'
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

/** Move just the far end of a segment, in place, without reallocating. */
function setSegmentEnd(line: Line, geometry: BufferGeometry, b: [number, number, number]): void {
  const attr = geometry.attributes.position as Float32BufferAttribute | undefined
  if (!attr || attr.count < 2) return
  const arr = attr.array as Float32Array
  if (arr[3] === b[0] && arr[4] === b[1] && arr[5] === b[2]) return
  arr[3] = b[0]; arr[4] = b[1]; arr[5] = b[2]
  attr.needsUpdate = true
  line.computeLineDistances()
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
    const centre = (p: Position) => cellCentre(p, origin, scaleExp, axes)
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

  // The cursor's position is driven per frame, straight from the store, rather
  // than waiting for a React commit.
  //
  // The point field already magnifies terrain around uFocus this way, so before
  // this the two ran on different clocks: the gibsons swelled on the next frame
  // while the cube waited a render out, and every long frame widened the gap.
  // Reading both from the same store in the same frame makes them simultaneous
  // by construction rather than by luck. Only the cube, the label and the live
  // end of the tether move here; which legs exist and what colour they are stay
  // in React, because those change with the plan, not with the cursor.
  const outline = useRef<LineSegments>(null)
  useFrame(() => {
    const s = useCyberspace.getState()
    const live = s.pendingTarget ?? s.cursor
    const b = cellCentre(live, alignedOrigin(s.position, s.scaleExp), s.scaleExp, axes)
    if (outline.current) outline.current.position.set(b[0], b[1], b[2])
    setSegmentEnd(leg2.visible ? leg2 : leg1, leg2.visible ? leg2Geometry : leg1Geometry, b)
  })

  return (
    <group position={[0, 0, 0.04]}>
      {/*
        The scale reading is always up, even with the cursor parked on the
        avatar. What one cell measures is a fact about the current zoom rather
        than about any pending action, and it is the only thing on screen that
        ties the abstract ladder to a physical size, so having it appear only
        once you started moving meant the answer to "how big is a gibson here"
        vanished exactly when you stopped to think about it. It rides the cursor,
        which sits on the avatar while idle, so it has a home either way.
      */}
      <WorldLabel
        text={formatCellSize(scaleExp)}
        color={active ? targetColor : ACCENT}
        offset={[0.7, 0.7, 0]}
        opacity={active ? 1 : 0.75}
        follow={() => {
          const s = useCyberspace.getState()
          return cellCentre(
            s.pendingTarget ?? s.cursor,
            alignedOrigin(s.position, s.scaleExp), s.scaleExp, axes,
          )
        }}
      />

      {active && (
        <>
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
          <lineSegments ref={outline} geometry={cellOutline} position={points.targetCell} frustumCulled={false} renderOrder={10}>
            <lineBasicMaterial color={targetColor} toneMapped={false} transparent opacity={0.85} depthTest={false} />
          </lineSegments>
        </>
      )}
    </group>
  )
}
