/**
 * RegionSelectBox.tsx - region mode's selection, drawn live (store/useRegion.ts).
 *
 * The box is the region a /C/ prefix fixes (lib/coordRoute.ts prefixRegion),
 * the same aligned slab PrefixRegionBox draws for a visited /C/ link, in the
 * same bright lemon (palette PREFIX), brighter than the amber move cursor so
 * the region you are picking never reads as a hop. At the cursor spins a glyph
 * shaped like lucide's `expand`, turning on Y, to say the cursor now grows a
 * region rather than lining up a move.
 *
 * Only while region mode is on, which is only ever inside VIEW; the ordinary
 * cursor cube stands down for it (scene/Cursor.tsx).
 */

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BoxGeometry, BufferGeometry, EdgesGeometry, Float32BufferAttribute, type Group } from 'three'
import { aimCentres, GRID_RADIUS, cellDelta, type ViewAxes } from '../lib/space'
import { PREFIX } from '../lib/palette'
import { prefixRegion } from '../lib/coordRoute'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { useRegion } from '../store/useRegion'
import { WorldLabel } from './WorldLabel'

interface Props {
  axes: ViewAxes
}

/** Cells a side of 2^h gibsons spans at this zoom (as PrefixRegionBox counts them). */
function cells(h: number, scaleExp: number): number {
  const exp = h - scaleExp
  return exp >= 0 ? 2 ** exp : 1 / 2 ** -exp
}

/**
 * Lucide `expand` as line segments on the XY plane: four arrows reaching out
 * to the corners. Unit-ish, scaled to sit inside one cell at the cursor.
 */
function expandGlyph(): BufferGeometry {
  const seg: number[] = []
  const line = (ax: number, ay: number, bx: number, by: number): void => { seg.push(ax, ay, 0, bx, by, 0) }
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const ix = 0.34 * sx, iy = 0.34 * sy
      const ox = 0.92 * sx, oy = 0.92 * sy
      line(ix, iy, ox, oy)            // the diagonal shaft
      line(ox, oy, ox - 0.34 * sx, oy) // one barb, along x
      line(ox, oy, ox, oy - 0.34 * sy) // the other, along y
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(seg, 3))
  return g
}

export function RegionSelectBox({ axes }: Props): JSX.Element | null {
  const active = useRegion((s) => s.active)
  const prefix = useRegion((s) => s.prefix)
  const anchor = useCyberspace((s) => s.anchor)
  const scaleExp = useCyberspace((s) => s.scaleExp)

  const boxGeom = useMemo(() => new EdgesGeometry(new BoxGeometry(1, 1, 1)), [])
  const glyphGeom = useMemo(() => expandGlyph(), [])

  const box = useMemo(() => {
    if (!prefix) return null
    const region = prefixRegion(prefix)
    const origin = alignedOrigin(anchor, scaleExp)
    const centre: [number, number, number] = [0, 0, 0]
    const size: [number, number, number] = [1, 1, 1]
    let tooBig = false
    let tooSmall = true
    ;[axes.right, axes.up, axes.out].forEach((a, i) => {
      const side = cells(region.heights[a.axis], scaleExp)
      if (side > GRID_RADIUS * 8) tooBig = true
      if (side >= 0.02) tooSmall = false
      const lo = cellDelta(region.base[a.axis], origin[a.axis], scaleExp)
      centre[i] = (lo + (side - 1) / 2) * a.dir
      size[i] = side
    })
    if (tooBig || tooSmall) return null
    return { centre, size }
  }, [prefix, anchor, scaleExp, axes])

  // The glyph rides the live cursor cell and spins, straight from the store.
  const glyph = useRef<Group>(null)
  useFrame((_, dt) => {
    const g = glyph.current
    if (!g) return
    const s = useCyberspace.getState()
    const { point } = aimCentres(s.cursor, alignedOrigin(s.anchor, s.scaleExp), s.scaleExp, axes)
    g.position.set(point[0], point[1], point[2])
    g.rotation.y += dt * 1.8
  })

  if (!active) return null

  return (
    <group>
      {box && (
        <>
          <lineSegments geometry={boxGeom} position={box.centre} scale={box.size} frustumCulled={false} renderOrder={9}>
            <lineBasicMaterial color={PREFIX} toneMapped={false} transparent opacity={0.9} depthTest={false} />
          </lineSegments>
          {prefix && (
            <WorldLabel
              text={`C/${prefix}`}
              color={PREFIX}
              at={[box.centre[0] - box.size[0] / 2, box.centre[1] + box.size[1] / 2, box.centre[2]]}
              px={13}
            />
          )}
        </>
      )}
      <group ref={glyph} scale={0.6}>
        <lineSegments geometry={glyphGeom} frustumCulled={false} renderOrder={11}>
          <lineBasicMaterial color={PREFIX} toneMapped={false} transparent opacity={0.95} depthTest={false} />
        </lineSegments>
      </group>
    </group>
  )
}
