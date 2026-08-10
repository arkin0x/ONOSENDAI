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
import { useEffect, useMemo, useRef } from 'react'
import { Vector3 } from 'three'
import { GRID_RADIUS } from '../lib/space'
import { useCyberspace } from '../store/useCyberspace'

const CAMERA_DISTANCE = 200

export function ViewRig(): null {
  const target = useCyberspace((s) => s.view)
  const cursor = useCyberspace((s) => s.cursor)
  const position = useCyberspace((s) => s.position)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const offset = useRef(new Vector3())

  // Resolve the pan during render, not inside useFrame.
  //
  // Reading it live meant the camera moved on the next animation frame while
  // Cursor, which writes its geometry in a layout effect, waited for React to
  // commit. That left one frame with the camera already at the new cell and
  // the cursor still drawn at the old one, so the cursor appeared to lag and
  // then snap. Deriving it here puts both on the same commit.
  const pan = useMemo(
    () => useCyberspace.getState().cursorOffset(),
    [cursor, position, scaleExp, target],
  )

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

    const [panRight, panUp, panOut] = pan

    camera.position.copy(
      offset.current
        .set(panRight, panUp, CAMERA_DISTANCE + panOut)
        .applyQuaternion(target),
    )
  })

  return null
}
