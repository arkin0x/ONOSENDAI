/**
 * ClickPlane.tsx — invisible plane that captures taps and sets cursor position.
 *
 * On mobile, users tap the grid to set the cursor. This component renders an
 * invisible plane at the avatar's depth that captures those taps and converts
 * them to grid coordinates.
 *
 * The plane is rendered in the rotated scene group, so we need to convert
 * world-space click coordinates to local-space to compute grid row/col.
 */

import { useMemo } from 'react'
import { PlaneGeometry, DoubleSide } from 'three'
import { GRID_RADIUS } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import type { ViewAxes } from '../lib/space'

interface Props {
  axes: ViewAxes
}

export function ClickPlane({ axes }: Props): JSX.Element {
  const position = useCyberspace((s) => s.position)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const view = useCyberspace((s) => s.view)

  // Create a plane that covers the visible grid area
  const geometry = useMemo(() => {
    const size = (GRID_RADIUS * 2 + 1) * 1.1 // Slightly larger than grid
    return new PlaneGeometry(size, size)
  }, [])

  // Handle click: convert world position to grid row/col
  const handleClick = (event: any) => {
    event.stopPropagation()
    
    // Get the intersection point in world space
    const worldPoint = event.point
    
    // Convert world-space point to local-space by applying inverse rotation
    const localPoint = worldPoint.clone()
    localPoint.applyQuaternion(view.clone().invert())
    
    // Get the aligned origin (grid center) in local space
    const origin = alignedOrigin(position, scaleExp)
    
    // Convert world coordinates to grid row/col
    // The grid is centered on origin, so we need to compute offset
    const rightAxis = axes.right.axis
    const upAxis = axes.up.axis
    
    // Get the local-space offset from origin (convert bigint to number)
    const rightOffset = Number(localPoint[rightAxis]) - Number(origin[rightAxis])
    const upOffset = Number(localPoint[upAxis]) - Number(origin[upAxis])
    
    // Convert to cell coordinates
    // Cell size is 2^scaleExp in world space
    const cellSize = Math.pow(2, scaleExp)
    
    // Account for axis direction
    const col = Math.round((rightOffset / cellSize) * axes.right.dir + GRID_RADIUS)
    const row = Math.round((upOffset / cellSize) * axes.up.dir + GRID_RADIUS)
    
    // Clamp to valid range
    const size = GRID_RADIUS * 2 + 1
    const clampedRow = Math.max(0, Math.min(size - 1, row))
    const clampedCol = Math.max(0, Math.min(size - 1, col))
    
    // Set cursor at this cell
    useCyberspace.getState().setCursorAtCell(clampedRow, clampedCol)
  }

  return (
    <mesh
      geometry={geometry}
      onClick={handleClick}
      visible={false}
      renderOrder={-1}
    >
      <meshBasicMaterial 
        transparent 
        opacity={0} 
        side={DoubleSide}
        depthWrite={false}
      />
    </mesh>
  )
}
