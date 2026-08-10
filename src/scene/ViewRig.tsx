/**
 * ViewRig.tsx — the camera.
 *
 * The camera snaps instantly to the target orientation. No slerp animation.
 *
 * The camera follows the cursor; the world does not. Everything in the scene
 * is anchored to the avatar's aligned cell, and the camera pans by the
 * cursor's offset from that same origin, which puts the cursor at screen
 * centre without moving the grid, the LCA lines, the trail or the avatar.
 *
 * These have to stay separate knobs. viewCenter() used to do both jobs at
 * once: components measured their positions from it, so pointing it at the
 * cursor re-centred the view and dragged the whole field along with it.
 */

import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Vector3 } from 'three'
import { GRID_RADIUS } from '../lib/space'
import { useCyberspace } from '../store/useCyberspace'

const CAMERA_DISTANCE = 200

export function ViewRig(): null {
  const target = useCyberspace((s) => s.view)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const offset = useRef(new Vector3())

  // Keep the whole grid in frame regardless of window shape.
  useEffect(() => {
    const span = GRID_RADIUS * 2 + 2
    const zoom = Math.min(size.width, size.height) / span
    if ('zoom' in camera) {
      camera.zoom = zoom
      camera.updateProjectionMatrix()
    }
  }, [camera, size])

  useFrame(() => {
    // Snap instantly to target orientation
    camera.quaternion.copy(target)

    // Pan to the cursor. cursorOffset is the cursor's position in the same
    // avatar-anchored, screen-axis frame the scene is drawn in, so placing the
    // camera there lands the cursor dead centre. With the cursor on the avatar
    // it reduces to the avatar's own sub-cell offset, which is what the Avatar
    // draws at, so the avatar sits exactly centred until you aim away.
    // Read live rather than subscribing: this runs per frame anyway, and a
    // subscription would re-render the rig on every cursor step.
    const [panRight, panUp, panOut] = useCyberspace.getState().cursorOffset()

    camera.position.copy(
      offset.current
        .set(panRight, panUp, CAMERA_DISTANCE + panOut)
        .applyQuaternion(target),
    )
  })

  return null
}
