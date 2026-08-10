/**
 * ViewRig.tsx — the camera.
 *
 * The camera snaps instantly to the target orientation. No slerp animation.
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
    camera.position.copy(
      offset.current.set(0, 0, CAMERA_DISTANCE).applyQuaternion(target),
    )
  })

  return null
}
