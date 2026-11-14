/**
 * ScanRegionBox.tsx - SCAN mode's cube, drawn live (store/useScan.ts).
 *
 * The aligned cube of side 2^height holding the cursor: exactly the region
 * one scan at that height looks in (lib/scanCube.ts). Purple, the mode's
 * color (palette SCAN), drawn as the deploy box draws a hide's region
 * (DeployRegionBox): a clear outline, the WALK grid faint on its walls, and,
 * for a cube too big for the view, clipped about the cursor with ZOOM OUT
 * walls breathing out of each face it continues through. A label on its top
 * corner names the height.
 *
 * While a scan runs the box stays on the cube being scanned, wherever the
 * cursor goes meanwhile, so what is being looked at never moves. Only in
 * SCAN: leaving the mode takes the box away (a scan under way keeps running).
 */

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BoxGeometry, EdgesGeometry, type Mesh } from 'three'
import type { ViewAxes } from '../lib/space'
import { SCAN } from '../lib/palette'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { useBuilder } from '../store/useBuilder'
import { scanCubeShown, useScan } from '../store/useScan'
import { drawnRegion } from './DeployRegionBox'
import { ClipWalls } from './ClipWalls'
import { UNIT_BOX, WALL_RENDER_ORDER, gridMaterial, setGrid, tickWallClock } from './Rooms'
import { WorldLabel } from './WorldLabel'

/** The widest the box is drawn, in cells, as the deploy box (DeployRegionBox MAX_CELLS). */
const MAX_CELLS = 25

/** The grid's ceiling on the walls, as the deploy box's. */
const GRID_OPACITY = 0.12

interface Props {
  axes: ViewAxes
}

export function ScanRegionBox({ axes }: Props): JSX.Element | null {
  const active = useScan((s) => s.active)
  const chosen = useScan((s) => s.height)
  const job = useScan((s) => s.job)
  const viewing = useCyberspace((s) => s.viewing())
  const building = useBuilder((s) => s.active)
  const cursor = useCyberspace((s) => s.cursor)
  const anchor = useCyberspace((s) => s.anchor)
  const plane = useCyberspace((s) => s.anchorPlane)
  const scaleExp = useCyberspace((s) => s.scaleExp)

  const geometry = useMemo(() => new EdgesGeometry(new BoxGeometry(1, 1, 1)), [])
  useEffect(() => () => geometry.dispose(), [geometry])

  const cube = scanCubeShown({ active, height: chosen, job }, { cursor, anchorPlane: plane, viewing, building })
  const at = cube?.at ?? null
  const height = cube?.height ?? chosen
  const box = useMemo(
    () => (at ? drawnRegion(at, alignedOrigin(anchor, scaleExp), height, scaleExp, axes, MAX_CELLS) : null),
    [at, anchor, height, scaleExp, axes],
  )

  const showing = box !== null
  const material = useMemo(() => (showing ? gridMaterial() : null), [showing])
  useEffect(() => () => material?.dispose(), [material])
  const walls = useRef<Mesh>(null)
  useLayoutEffect(() => {
    const mesh = walls.current
    if (!box || !material || !mesh) return
    mesh.scale.set(box.size[0], box.size[1], box.size[2])
    mesh.position.set(box.centre[0], box.centre[1], box.centre[2])
    const corner: [number, number, number] = [0, 1, 2].map((i) => box.centre[i] - box.size[i] / 2) as [number, number, number]
    setGrid(material, SCAN, GRID_OPACITY, height, corner)
  }, [box, material, height])
  useFrame(() => { if (material) tickWallClock() })

  if (!box) return null

  return (
    <group>
      <lineSegments geometry={geometry} position={box.centre} scale={box.size} frustumCulled={false} renderOrder={9}>
        <lineBasicMaterial color={SCAN} toneMapped={false} transparent opacity={box.faces.length > 0 ? 0.6 : 0.95} depthTest={false} />
      </lineSegments>
      {material && box.whole && (
        <mesh ref={walls} geometry={UNIT_BOX} material={material} frustumCulled={false} renderOrder={WALL_RENDER_ORDER} />
      )}
      <ClipWalls centre={box.centre} size={box.size} faces={box.faces} color={SCAN} hideNear />
      <WorldLabel
        text={`SCAN 2^${height}`}
        color={SCAN}
        at={[box.centre[0] - box.size[0] / 2, box.centre[1] + box.size[1] / 2, box.centre[2]]}
        px={12}
      />
    </group>
  )
}
