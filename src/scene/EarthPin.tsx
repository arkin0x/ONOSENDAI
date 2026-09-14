/**
 * EarthPin.tsx - the place you asked to look at, left standing in the scene.
 *
 * Clicking the globe or typing a place into the POSITION panel moves the
 * camera there, and until now that was all it did: the focal point was
 * implied by where the camera happened to be pointing, and the moment you
 * clicked a landfall to look at it the place you came from was gone. The pin
 * is that place made into a thing. It survives a focus change to a block, so
 * you can look around and come back to it; RETURN and REMOVE PIN take it
 * away. Clicking it looks at it again, at the zoom it was dropped at
 * (useCyberspace.viewPin).
 *
 * Drawn in WARN amber, which is nothing else in dataspace: the sphere's ring
 * and the nearest-landfall marker are both ACCENT cyan, and a pin that
 * shared their colour would read as part of the ring.
 *
 * Placed by the house rule, pointCentre against the anchor's aligned origin,
 * which is what StopField uses for every dot: the pin's coordinate is
 * already on the ellipsoid, having come from a click on the globe or from
 * the canonical GPS mapping, so it needs no surface walk to sit on the
 * ground. The crosshair is drawn in the view frame's own X and Y, which is
 * screen right and screen up, so it reads as a target from any angle, and it
 * is sized in cells, so it holds its size on screen at every zoom.
 */

import { useEffect, useMemo } from 'react'
import { type ThreeEvent } from '@react-three/fiber'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import { markSceneTapHandled } from '../hooks/useCanvasTap'
import { WARN } from '../lib/palette'
import { GRID_RADIUS, pointCentre, type ViewAxes } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { WorldLabel } from './WorldLabel'

/** Beyond this many cells from the anchor the pin is off the grid and not drawn. */
const PIN_REACH = GRID_RADIUS * 8

/** Half-length of each crosshair arm, in cells. */
const ARM = 0.9

/** The gap at the centre, in cells, so the arms frame the point rather than cover it. */
const GAP = 0.3

/** The dot's size in CSS pixels, held constant at any camera distance. */
const DOT_PX = 13

/** Same tap-vs-drag slop as every other clickable thing in the scene. */
const TAP_SLOP = 8

export function EarthPin({ axes }: { axes: ViewAxes }): JSX.Element | null {
  const pin = useCyberspace((s) => s.pin)
  const anchor = useCyberspace((s) => s.anchor)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const plane = useCyberspace((s) => s.anchorPlane)

  const built = useMemo(() => {
    // The pin is a dataspace thing: in ideaspace there is no Earth to pin to.
    if (!pin || plane !== 0) return null
    const c = pointCentre(pin.position, alignedOrigin(anchor, scaleExp), scaleExp, axes)
    if (Math.abs(c[0]) > PIN_REACH || Math.abs(c[1]) > PIN_REACH || Math.abs(c[2]) > PIN_REACH) return null

    const dot = new BufferGeometry()
    dot.setAttribute('position', new Float32BufferAttribute([c[0], c[1], c[2]], 3))

    // Four arms in screen right and screen up, each from GAP to ARM cells.
    const cross: number[] = []
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      cross.push(c[0] + dx * GAP, c[1] + dy * GAP, c[2])
      cross.push(c[0] + dx * ARM, c[1] + dy * ARM, c[2])
    }
    const arms = new BufferGeometry()
    arms.setAttribute('position', new Float32BufferAttribute(cross, 3))

    return { dot, arms, at: c, labelAt: [c[0], c[1] + ARM, c[2]] as [number, number, number] }
  }, [pin, anchor, scaleExp, plane, axes])

  // GPU buffers are not garbage collected; release each pin when replaced.
  useEffect(() => () => { built?.dot.dispose(); built?.arms.dispose() }, [built])

  if (!built || !pin) return null

  const pick = (e: ThreeEvent<MouseEvent>): void => {
    if (e.delta > TAP_SLOP) return
    e.stopPropagation()
    markSceneTapHandled()
    useCyberspace.getState().viewPin()
  }

  return (
    <group>
      <points geometry={built.dot} onClick={pick}>
        <pointsMaterial color={WARN} size={DOT_PX} sizeAttenuation={false} toneMapped={false} transparent={false} />
      </points>
      <lineSegments geometry={built.arms} frustumCulled={false}>
        <lineBasicMaterial color={WARN} toneMapped={false} transparent opacity={0.95} fog={false} />
      </lineSegments>
      <WorldLabel text={pin.label} color={WARN} at={built.labelAt} px={12} opacity={1} align="center" />
    </group>
  )
}
