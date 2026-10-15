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
 * Placed where a hidden item or a starred place's star at the same
 * coordinate is drawn: itemCentre against the anchor's aligned origin, the
 * true coordinate plus half a gibson. The pin's coordinate is already on the
 * ellipsoid, having come from a click on the globe or from the canonical GPS
 * mapping, so it needs no surface walk to sit on the ground. It used to be
 * placed with pointCentre, which StopField uses for every dot and which puts
 * a coordinate on its gibson's low corner, half a gibson short on every axis.
 * Above 2^0 that is a hair, but at 2^0 a gibson is the whole cell, so VIEW on
 * a starred place drew the cross on the corner of the cell with the star in
 * its middle (arkinox, 2026-10-08). The crosshair is drawn in the view
 * frame's own X and Y, which is screen right and screen up, so it reads as a
 * target from any angle, and it is sized in cells, so it holds its size on
 * screen at every zoom.
 *
 * The label goes when one of your Starred Places stands at the pin with its
 * own words under it (StarredMarks.tsx): VIEW on a starred place drops the pin
 * under the place's name, and the two names one above the other said the same
 * thing twice (arkinox, 2026-10-08). Matched by coordinate and plane, not by
 * the words, so a pin dropped by a typed place name over a star nicknamed
 * otherwise loses its label too: the star already names the spot. A bare star
 * (one known only by its axes) has no words of its own, so the pin keeps its
 * label there.
 */

import { useEffect, useMemo } from 'react'
import { type ThreeEvent } from '@react-three/fiber'
import type { Plane } from 'cyberspace-core'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import { markSceneTapHandled } from '../hooks/useCanvasTap'
import { WARN } from '../lib/palette'
import { GRID_RADIUS, itemCentre, type Position, type ViewAxes } from '../lib/space'
import { placedStars, placePosition, sceneLabel, type StarredPlace } from '../lib/starred'
import { alignedOrigin, samePosition, useCyberspace } from '../store/useCyberspace'
import { useStarred } from '../store/useStarred'
import { STAR_REACH } from './StarredMarks'
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

/**
 * Where the pin's dot and the middle of its cross are drawn: the point a
 * hidden item or a starred place's star at the same coordinate is drawn at
 * (itemCentre), so the cross frames the star rather than its cell's corner.
 */
export function pinPoint(
  position: Position, origin: Position, scaleExp: number, axes: ViewAxes,
): [number, number, number] {
  return itemCentre(position, origin, scaleExp, axes)
}

/**
 * Whether a starred place's star stands at the pin with words under it, so
 * the pin's own label would only repeat it. The star must be one the scene
 * draws right now (StarredMarks: same plane, within its reach); a star culled
 * or in the other plane leaves the pin its label.
 */
export function starNamesPin(
  pin: Position, places: StarredPlace[], origin: Position, plane: Plane, scaleExp: number, axes: ViewAxes,
): boolean {
  return placedStars(places, origin, plane, scaleExp, axes, STAR_REACH).some(({ place }) => {
    const at = placePosition(place.input)
    return at !== null && samePosition(at, pin) && sceneLabel(place) !== null
  })
}

export function EarthPin({ axes }: { axes: ViewAxes }): JSX.Element | null {
  const pin = useCyberspace((s) => s.pin)
  const anchor = useCyberspace((s) => s.anchor)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const plane = useCyberspace((s) => s.anchorPlane)
  const places = useStarred((s) => s.places)

  const built = useMemo(() => {
    // The pin is a dataspace thing: in ideaspace there is no Earth to pin to.
    if (!pin || plane !== 0) return null
    const origin = alignedOrigin(anchor, scaleExp)
    const c = pinPoint(pin.position, origin, scaleExp, axes)
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

    const named = starNamesPin(pin.position, places, origin, plane, scaleExp, axes)
    return { dot, arms, at: c, labelAt: [c[0], c[1] + ARM, c[2]] as [number, number, number], named }
  }, [pin, anchor, scaleExp, plane, axes, places])

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
      {!built.named && <WorldLabel text={pin.label} color={WARN} at={built.labelAt} px={12} opacity={1} align="center" />}
    </group>
  )
}
