/**
 * Cursor.tsx - the uncommitted destination.
 *
 * WASD moves this, not you. The tether from the avatar is the route Space
 * would run, drawn from the same planner the store executes (lib/movePlan.ts)
 * so what you see is what you get: amber dashed legs are hops, purple legs
 * are sidesteps of exactly 1 gibson through a wall, and a purple mark sits on
 * every sidestep landing. When the hop fits the ceiling the route is one
 * amber leg straight to the cursor. A route too long to draw in full ends in
 * a red leg to the cursor. While a proof is computing the display locks to
 * the committed target instead of the live cursor.
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
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  BoxGeometry,
} from 'three'
import { useCalibration } from '../lib/calibration'
import { nextStep, type PlanStep } from '../lib/movePlan'
import { ACCENT, DANGER, SIDESTEP, WARN } from '../lib/palette'
/** Paid legs: the cloud's warm gold, the colour the HUD uses for HOSAKA. */
const CLOUD = '#ffd27d'
import { cellCentre, type Position, type ViewAxes } from '../lib/space'
import {
  MAX_COMPUTE_HEIGHT,
  alignedOrigin,
  samePosition,
  useCyberspace,
} from '../store/useCyberspace'

/** Steps drawn in full; past this the tether ends in one red leg. */
const DRAWN_STEPS = 48

interface Props {
  axes: ViewAxes
}

type Pt = readonly [number, number, number]

function makeDashedSegments(geometry: BufferGeometry, color: number | string): LineSegments {
  const legs = new LineSegments(
    geometry,
    new LineDashedMaterial({
      color,
      dashSize: 0.32,
      gapSize: 0.2,
      transparent: true,
      opacity: 0.9,
      toneMapped: false,
      depthTest: false,
    }),
  )
  legs.frustumCulled = false
  legs.renderOrder = 10
  return legs
}

function makeSolidSegments(geometry: BufferGeometry, color: number | string): LineSegments {
  const legs = new LineSegments(
    geometry,
    new LineBasicMaterial({ color, transparent: true, opacity: 0.95, toneMapped: false, depthTest: false }),
  )
  legs.frustumCulled = false
  legs.renderOrder = 10
  return legs
}

/** Fill a segments geometry from (from, to) pairs; hidden when there are none. */
function setSegments(legs: LineSegments, geometry: BufferGeometry, pairs: ReadonlyArray<readonly [Pt, Pt]>): void {
  const arr = new Float32Array(pairs.length * 6)
  pairs.forEach(([a, b], i) => {
    arr[i * 6] = a[0]; arr[i * 6 + 1] = a[1]; arr[i * 6 + 2] = a[2]
    arr[i * 6 + 3] = b[0]; arr[i * 6 + 4] = b[1]; arr[i * 6 + 5] = b[2]
  })
  // Replacing an attribute leaves the old one's GL buffer allocated until the
  // geometry is disposed; dispose first (the object stays usable and uploads
  // the new buffer on the next frame), or every cursor move leaked one.
  geometry.dispose()
  geometry.setAttribute('position', new Float32BufferAttribute(arr, 3))
  geometry.computeBoundingSphere()
  legs.computeLineDistances()
  legs.visible = pairs.length > 0
}

/** Move the final vertex of a segments geometry (the leg ending on the cursor). */
function setLastVertex(legs: LineSegments, geometry: BufferGeometry, b: Pt): void {
  const attr = geometry.getAttribute('position') as Float32BufferAttribute | undefined
  if (!attr || attr.count === 0) return
  const arr = attr.array as Float32Array
  const i = (attr.count - 1) * 3
  arr[i] = b[0]; arr[i + 1] = b[1]; arr[i + 2] = b[2]
  attr.needsUpdate = true
  legs.computeLineDistances()
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
  geometry.dispose()
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
  const anchor = useCyberspace((s) => s.anchor)
  const atHead = useCyberspace((s) => s.atHead())
  // Looking at a focus the cursor cannot be used, so its size label would
  // just hang in the middle of the view.
  const focused = useCyberspace((s) => s.focus !== null)

  // In history there is no move being lined up, so no tether and no target
  // cell. The scale label stays, riding the anchor instead of the cursor.
  const target = atHead ? (pendingTarget ?? cursor) : anchor
  const active = atHead && !samePosition(position, target)

  // The ceiling a commit would use right now, the same number the store
  // routes with: the hard cap lowered to what calibration measured.
  const hopCeil = useCalibration((s) => s.hopHeight)
  const sidestepCeil = useCalibration((s) => s.sidestepHeight)
  const cloudLimits = useCyberspace((s) => (s.cloudPrefs.mode === 'off' ? null : s.cloud.limits))
  const ceiling = Math.min(MAX_COMPUTE_HEIGHT, hopCeil)
  const ceilings = useMemo(() => ({
    hop: ceiling,
    sidestep: sidestepCeil,
    cloudHop: cloudLimits?.max_hop_height ?? 0,
    cloudSidestep: cloudLimits?.max_sidestep_height ?? 0,
  }), [ceiling, sidestepCeil, cloudLimits])

  // The route Space would run, from the planner the store executes. Drawn
  // step by step up to DRAWN_STEPS; a longer route is marked capped and its
  // remainder becomes one red leg.
  const route = useMemo(() => {
    if (!active) return null
    const steps: PlanStep[] = []
    let cur = position
    let capped = false
    for (;;) {
      const step = nextStep(cur, target, ceilings)
      if (!step) break
      if (steps.length >= DRAWN_STEPS) { capped = true; break }
      steps.push(step)
      cur = step.to
    }
    return { steps, capped, last: cur }
  }, [active, position, target, ceilings])

  // Screen-space endpoints, at cell CENTRES.
  //
  // These used to come from which carries a half-cell bias: it was
  // written when a cell was drawn as a square anchored at its corner. Now the
  // cursor is a cube centred on its cell, and terrain points sit at integer cell
  // offsets, so that bias put the line's endpoint on the cube's face rather than
  // at its centre. The offset is 0.5 - 0.5/step, so it is invisible at scaleExp
  // 0 and grows to nearly half a cell by scaleExp 14.
  const points = useMemo(() => {
    const origin = alignedOrigin(anchor, scaleExp)
    const centre = (p: Position) => cellCentre(p, origin, scaleExp, axes)
    const b = centre(target)
    const steps = route?.steps ?? []
    const local = steps.filter((st) => st.source !== 'cloud')
    const paid = steps.filter((st) => st.source === 'cloud')
    const last = steps[steps.length - 1]
    return {
      a: centre(position),
      b,
      hops: local.filter((st) => st.kind === 'hop').map((st) => [centre(st.from), centre(st.to)] as const),
      sidesteps: local.filter((st) => st.kind === 'sidestep').map((st) => [centre(st.from), centre(st.to)] as const),
      cloud: paid.map((st) => [centre(st.from), centre(st.to)] as const),
      landings: steps.filter((st) => st.kind === 'sidestep').map((st) => centre(st.to)),
      rest: route?.capped ? ([centre(route.last), b] as const) : null,
      lastIsHop: !!last && last.kind === 'hop' && last.source !== 'cloud' && !route?.capped,
      lastIsCloud: !!last && last.source === 'cloud' && !route?.capped,
      targetCell: b,
    }
  }, [position, target, route, scaleExp, axes, anchor])

  const hopGeometry = useMemo(() => new BufferGeometry(), [])
  const sideGeometry = useMemo(() => new BufferGeometry(), [])
  const restGeometry = useMemo(() => new BufferGeometry(), [])
  const cloudGeometry = useMemo(() => new BufferGeometry(), [])
  const hopLegs = useMemo(() => makeDashedSegments(hopGeometry, WARN), [hopGeometry])
  const sideLegs = useMemo(() => makeSolidSegments(sideGeometry, SIDESTEP), [sideGeometry])
  const cloudLegs = useMemo(() => makeDashedSegments(cloudGeometry, CLOUD), [cloudGeometry])
  const restLeg = useMemo(() => makeDashedLine(restGeometry), [restGeometry])

  // A cube, not a square: the view orbits now, so the target cell has to read
  // as a volume from any angle rather than as a plane seen face-on.
  const cellOutline = useMemo(() => new EdgesGeometry(new BoxGeometry(1, 1, 1)), [])

  const targetColor = route?.capped ? DANGER : WARN

  useLayoutEffect(() => {
    setSegments(hopLegs, hopGeometry, points.hops)
    setSegments(sideLegs, sideGeometry, points.sidesteps)
    setSegments(cloudLegs, cloudGeometry, points.cloud)
    if (points.rest) {
      setSegment(restLeg, restGeometry, points.rest[0], points.rest[1], DANGER)
      restLeg.visible = true
    } else {
      restLeg.visible = false
    }
  }, [points, hopLegs, sideLegs, cloudLegs, restLeg, hopGeometry, sideGeometry, cloudGeometry, restGeometry])

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
    const live = s.atHead() ? (s.pendingTarget ?? s.cursor) : s.anchor
    const b = cellCentre(live, alignedOrigin(s.anchor, s.scaleExp), s.scaleExp, axes)
    if (outline.current) outline.current.position.set(b[0], b[1], b[2])
    // The leg that ends on the cursor follows it within the frame.
    if (restLeg.visible) setSegmentEnd(restLeg, restGeometry, b)
    else if (points.lastIsHop) setLastVertex(hopLegs, hopGeometry, b)
    else if (points.lastIsCloud) setLastVertex(cloudLegs, cloudGeometry, b)
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
      {!focused && <WorldLabel
        text={formatCellSize(scaleExp)}
        color={active ? targetColor : ACCENT}
        offset={[1.5, 0.7, 0]}
        opacity={active ? 1 : 0.75}
        follow={() => {
          const s = useCyberspace.getState()
          return cellCentre(
            s.atHead() ? (s.pendingTarget ?? s.cursor) : s.anchor,
            alignedOrigin(s.anchor, s.scaleExp), s.scaleExp, axes,
          )
        }}
      />}

      {active && (
        <>
          <primitive object={hopLegs} />
          <primitive object={sideLegs} />
          <primitive object={cloudLegs} />
          <primitive object={restLeg} />

          {/* Every sidestep landing: 1 gibson through a wall */}
          {points.landings.map((p, i) => (
            <mesh key={i} position={p} renderOrder={10}>
              <circleGeometry args={[0.14, 4]} />
              <meshBasicMaterial color={SIDESTEP} toneMapped={false} transparent depthTest={false} />
            </mesh>
          ))}

          {/* The cell the lined-up action targets */}
          <lineSegments ref={outline} geometry={cellOutline} position={points.targetCell} frustumCulled={false} renderOrder={10}>
            <lineBasicMaterial color={targetColor} toneMapped={false} transparent opacity={0.85} depthTest={false} />
          </lineSegments>
        </>
      )}
    </group>
  )
}
