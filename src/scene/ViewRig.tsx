/**
 * ViewRig.tsx — the camera.
 *
 * The target orientation snaps instantly (so the sampled slice is always
 * correct) while the camera slerps toward it. That gap is the 90-degree swing
 * you see when you shift-rotate, and it is what makes the third axis legible.
 */

import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Quaternion, Vector3 } from 'three'
import { GRID_RADIUS } from '../lib/space'
import { useCyberspace } from '../store/useCyberspace'

const CAMERA_DISTANCE = 200
// Rotation easing. Was 9; slowed 3x so the 90-degree swing reads spatially
// rather than as a cut.
const SLERP_RATE = 3

export function ViewRig(): null {
  const target = useCyberspace((s) => s.view)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const offset = useRef(new Vector3())
  const current = useRef(new Quaternion().copy(target))

  // Keep the whole grid in frame regardless of window shape.
  useEffect(() => {
    const span = GRID_RADIUS * 2 + 2
    const zoom = Math.min(size.width, size.height) / span
    if ('zoom' in camera) {
      camera.zoom = zoom
      camera.updateProjectionMatrix()
    }
  }, [camera, size])

  useFrame((_, delta) => {
    // Frame-rate independent easing toward the target orientation.
    const t = 1 - Math.exp(-SLERP_RATE * delta)
    current.current.slerp(target, t)
    camera.quaternion.copy(current.current)
    camera.position.copy(
      offset.current.set(0, 0, CAMERA_DISTANCE).applyQuaternion(current.current),
    )
  })

  return null
}
