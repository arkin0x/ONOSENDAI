/**
 * ViewRig.tsx — the camera.
 *
 * The camera follows the cursor when active, otherwise tracks the avatar.
 * The grid (terrain, LCA lines) stays anchored to the avatar via the
 * world group's quaternion-only transform.
 */

import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Vector3 } from 'three'
import { GRID_RADIUS } from '../lib/space'
import { samePosition, useCyberspace } from '../store/useCyberspace'

const CAMERA_DISTANCE = 200

export function ViewRig(): null {
  const target = useCyberspace((s) => s.view)
  const position = useCyberspace((s) => s.position)
  const cursor = useCyberspace((s) => s.cursor)
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
    
    // Get cursor offset from avatar in local space
    const cursorOffset = useCyberspace.getState().cursorOffset()
    
    // Camera follows cursor when active, otherwise tracks avatar (offset = 0)
    const isActive = !samePosition(position, cursor)
    const panX = isActive ? cursorOffset[0] : 0
    const panY = isActive ? cursorOffset[1] : 0
    const panZ = isActive ? cursorOffset[2] : 0
    
    // Position camera: offset by pan in local space, then translate to world
    camera.position.copy(
      offset.current.set(panX, panY, CAMERA_DISTANCE + panZ).applyQuaternion(target),
    )
  })

  return null
}
