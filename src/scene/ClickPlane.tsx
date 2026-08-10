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
import { useCyberspace } from '../store/useCyberspace'
import type { ViewAxes } from '../lib/space'

interface Props {
  axes: ViewAxes
}

export function ClickPlane({ axes }: Props): JSX.Element {

  // Create a plane that covers the visible grid area
  const geometry = useMemo(() => {
    const size = (GRID_RADIUS * 2 + 1) * 1.1 // Slightly larger than grid
    return new PlaneGeometry(size, size)
  }, [])

  // Handle click: convert local position to grid row/col
  const handleClick = (event: any) => {
    event.stopPropagation()
    
    // Get the intersection point in the mesh's local coordinate system
    // This is already in the grid's coordinate space (centered on avatar)
    const localPoint = event.localPoint
    console.log('[ClickPlane] Click at local point:', localPoint.toArray())
    
    // Convert world coordinates to grid row/col
    // The grid is centered on origin, so we need to compute offset
    const rightAxis = axes.right.axis
    const upAxis = axes.up.axis
    
    // Get the local-space offset from origin
    const rightOffset = localPoint[rightAxis]
    const upOffset = localPoint[upAxis]
    console.log('[ClickPlane] Offsets:', { rightOffset, upOffset })
    
    // Convert to cell coordinates
    // Cell size is 1 in local space (already normalized)
    // Account for axis direction
    const col = Math.round(rightOffset * axes.right.dir)
    const row = Math.round(upOffset * axes.up.dir)
    console.log('[ClickPlane] Raw row/col:', { row, col })
    
    // Clamp to valid range
    const clampedRow = Math.max(-GRID_RADIUS, Math.min(GRID_RADIUS, row))
    const clampedCol = Math.max(-GRID_RADIUS, Math.min(GRID_RADIUS, col))
    console.log('[ClickPlane] Clamped row/col:', { clampedRow, clampedCol })
    
    // Set cursor at this cell
    useCyberspace.getState().setCursorAtCell(clampedRow, clampedCol)
    console.log('[ClickPlane] Set cursor at offset:', { clampedRow, clampedCol })
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
