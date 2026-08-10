/**
 * ClickPlane.tsx — invisible plane that captures taps and sets the cursor.
 *
 * Tapping the grid places the cursor on the avatar's current plane. The plane
 * is a child of the rotated world group, so its local X/Y are screen right/up
 * in cell units, which is the same frame the grid and cursor are drawn in.
 *
 * The mesh must not use `visible={false}`: three.js raycasting skips invisible
 * objects, so the handler would never fire. A fully transparent material draws
 * nothing while still being hit-testable.
 */

import { useMemo } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { PlaneGeometry, DoubleSide } from 'three'
import { GRID_RADIUS, stepFor, type ViewAxes } from '../lib/space'
import { useCyberspace } from '../store/useCyberspace'

interface Props {
  axes: ViewAxes
}

export function ClickPlane({ axes }: Props): JSX.Element {
  const geometry = useMemo(() => {
    // Cover the full grid, with a margin so edge cells are reachable.
    const size = (GRID_RADIUS * 2 + 1) * 1.1
    return new PlaneGeometry(size, size)
  }, [])

  const handleClick = (event: ThreeEvent<MouseEvent>): void => {
    event.stopPropagation()

    // Intersection in the plane's own frame: local X/Y are screen right/up.
    const local = event.object.worldToLocal(event.point.clone())

    const scaleExp = useCyberspace.getState().scaleExp

    // Inverse of cellOffset, which biases by half a cell minus half a step.
    // The scene is drawn around the avatar's aligned cell, the same origin
    // setCursorAtCell measures row/col from, so no further correction applies.
    const step = Number(stepFor(scaleExp))
    const bias = 0.5 - 0.5 / step

    const col = Math.round(local.x + axes.right.dir * bias)
    const row = Math.round(local.y + axes.up.dir * bias)

    useCyberspace.getState().setCursorAtCell(
      Math.max(-GRID_RADIUS, Math.min(GRID_RADIUS, row)),
      Math.max(-GRID_RADIUS, Math.min(GRID_RADIUS, col)),
    )
  }

  return (
    <mesh geometry={geometry} onClick={handleClick} renderOrder={-1}>
      <meshBasicMaterial
        transparent
        opacity={0}
        side={DoubleSide}
        depthWrite={false}
      />
    </mesh>
  )
}
