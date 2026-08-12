/**
 * SectorBox.tsx — the sector you are standing in, drawn as an orange cage.
 *
 * A sector is a cube of 2^30 gibsons per axis (§10). Unlike the room nest, which
 * is a consequence of where you happen to be, the sector lattice is absolute and
 * shared: it is the unit relays index public cyberspace objects by, so "which
 * sector am I in" is the coarsest useful answer to "where am I".
 *
 * Drawn at TRUE size, so it scales with zoom rather than being a fixed-size
 * badge. That has a consequence worth knowing: at scaleExp 0 a sector is 2^30
 * cells across, so its walls are half a billion cells away and there is nothing
 * on screen to see. It resolves into view around scaleExp 23, is one cell across
 * at exactly scaleExp 30, and shrinks below a cell above that. Being unable to
 * see the walls of your own sector from inside it is the honest answer, and it
 * is the same reason the room nest stops drawing boxes larger than the window.
 */

import { useMemo } from 'react'
import { BoxGeometry, EdgesGeometry } from 'three'
import { SECTOR_BITS_DEFAULT } from 'cyberspace-core'
import { GRID_RADIUS, cellDelta, type ViewAxes } from '../lib/space'
import { SECTOR } from '../lib/palette'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'

interface Props {
  axes: ViewAxes
}

export function SectorBox({ axes }: Props): JSX.Element | null {
  const position = useCyberspace((s) => s.position)
  const scaleExp = useCyberspace((s) => s.scaleExp)

  const box = useMemo(() => {
    // Cells across, at the current zoom. Fractional above scaleExp 30, where a
    // whole sector no longer fills a single cell.
    const sizeCells = 2 ** (SECTOR_BITS_DEFAULT - scaleExp)
    // Same cutoff as the room nest: a box far larger than the window reads as a
    // flat edge or nothing at all, and building the geometry is wasted work.
    if (sizeCells > GRID_RADIUS * 8) return null

    const origin = alignedOrigin(position, scaleExp)
    const screen = [axes.right, axes.up, axes.out]
    const centre: [number, number, number] = [0, 0, 0]

    for (let s = 0; s < 3; s++) {
      const axis = screen[s].axis
      const lowCorner = (position[axis] >> BigInt(SECTOR_BITS_DEFAULT)) << BigInt(SECTOR_BITS_DEFAULT)
      // cellDelta rather than bigint division: above scaleExp 30 the sector's
      // corner is not aligned to a cell, and truncating would snap it.
      const lo = cellDelta(lowCorner, origin[axis], scaleExp)
      centre[s] = (lo + (sizeCells - 1) / 2) * screen[s].dir
    }

    return { centre, size: sizeCells }
  }, [position, scaleExp, axes])

  const geometry = useMemo(
    () => (box ? new EdgesGeometry(new BoxGeometry(box.size, box.size, box.size)) : null),
    [box],
  )

  if (!box || !geometry) return null

  return (
    <lineSegments geometry={geometry} position={box.centre} frustumCulled={false}>
      <lineBasicMaterial color={SECTOR} toneMapped={false} transparent opacity={0.9} />
    </lineSegments>
  )
}
