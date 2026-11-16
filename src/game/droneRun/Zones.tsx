/**
 * Zones.tsx - the safe zone and the end zone, readable on the ground from
 * anywhere on the field: each zone's footprint outlined on the floor under
 * it, filled faintly, with a low curtain of light rising round its edge and
 * fading upward. Cyan for the start, gold for the finish. Drawn through the
 * fog (it is a guide, not part of the world), never written to the depth
 * buffer, and added onto what is behind it.
 *
 * Standing inside a zone, its curtain is all round you at eye height and
 * adds its colour over the whole view (on the end zone's dais the WAVE CLEAR
 * card sat on a gold-white screen): there the curtain fades to
 * INSIDE_SHARE of its light, eased, and comes back as you step out.
 *
 * Drawn by the game from the level's zone boxes, never as world shards.
 * Ledger: the zones are class (b) (the variant's rules); this look is (c).
 */

import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { AdditiveBlending, BufferGeometry, DoubleSide, Float32BufferAttribute, LineBasicMaterial, LineLoop, Mesh, MeshBasicMaterial } from 'three'
import { groundBelow, type Box3, type Solids } from '../../lib/games/droneRun/sim'

/** The start zone's cyan and the finish's gold. */
export const ZONE_COLORS = { start: [0.25, 0.92, 1] as const, finish: [1, 0.78, 0.22] as const }
/** How high the curtain rises, gibsons. */
export const CURTAIN_HEIGHT = 7
/** The curtain's light while the eye is inside its zone, as a share of its full light. */
export const INSIDE_SHARE = 0.2

/** Whether a render-frame point (x, -cyberspace z) stands over a zone's footprint. */
export function overZone(box: Box3, x: number, renderZ: number): boolean {
  const z = -renderZ
  return x >= box.lo[0] && x <= box.hi[0] && z >= box.lo[2] && z <= box.hi[2]
}

/** The floor under a zone: the ground below its middle, else its own bottom. */
export function zoneFloor(box: Box3, solids: Solids): number {
  const cx = (box.lo[0] + box.hi[0]) / 2, cz = (box.lo[2] + box.hi[2]) / 2
  const g = groundBelow(solids, cx, box.hi[1], cz, box.hi[1] - box.lo[1] + 4)
  return g ?? box.lo[1]
}

/** The zone's footprint corners, render frame, at `y`. */
function corners(box: Box3, y: number): number[][] {
  // Render z = -cyberspace z.
  return [[box.lo[0], y, -box.lo[2]], [box.hi[0], y, -box.lo[2]], [box.hi[0], y, -box.hi[2]], [box.lo[0], y, -box.hi[2]]]
}

function zoneObjects(box: Box3, floor: number, rgb: readonly [number, number, number]): { curtain: MeshBasicMaterial; objects: (Mesh | LineLoop)[]; dispose: () => void } {
  const y = floor + 0.04
  const c = corners(box, y)
  // The outline.
  const lineG = new BufferGeometry()
  lineG.setAttribute('position', new Float32BufferAttribute(c.flat(), 3))
  const lineM = new LineBasicMaterial({ transparent: true, opacity: 0.95, fog: false, depthWrite: false, toneMapped: false })
  lineM.color.setRGB(rgb[0], rgb[1], rgb[2])
  const line = new LineLoop(lineG, lineM)
  // The faint fill.
  const fillG = new BufferGeometry()
  fillG.setAttribute('position', new Float32BufferAttribute([...c[0], ...c[1], ...c[2], ...c[0], ...c[2], ...c[3]], 3))
  const fillM = new MeshBasicMaterial({ transparent: true, opacity: 0.05, fog: false, depthWrite: false, side: DoubleSide, toneMapped: false, blending: AdditiveBlending })
  fillM.color.setRGB(rgb[0], rgb[1], rgb[2])
  const fill = new Mesh(fillG, fillM)
  // The curtain: four walls, bright at the floor, black (nothing added) at the top.
  const pos: number[] = []
  const col: number[] = []
  const lo = 0.2, hi = 0
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4]
    const quad = [[a, lo, 0], [b, lo, 0], [b, hi, CURTAIN_HEIGHT], [a, lo, 0], [b, hi, CURTAIN_HEIGHT], [a, hi, CURTAIN_HEIGHT]] as const
    for (const [p, k, h] of quad) {
      pos.push(p[0], p[1] + h, p[2])
      col.push(rgb[0] * k, rgb[1] * k, rgb[2] * k)
    }
  }
  const curtainG = new BufferGeometry()
  curtainG.setAttribute('position', new Float32BufferAttribute(pos, 3))
  curtainG.setAttribute('color', new Float32BufferAttribute(col, 3))
  const curtainM = new MeshBasicMaterial({ vertexColors: true, fog: false, depthWrite: false, side: DoubleSide, toneMapped: false, transparent: true, blending: AdditiveBlending })
  const curtain = new Mesh(curtainG, curtainM)
  for (const o of [line, fill, curtain]) { o.frustumCulled = false; o.renderOrder = 18; o.raycast = () => {} }
  return {
    curtain: curtainM,
    objects: [fill, curtain, line],
    dispose: () => { lineG.dispose(); lineM.dispose(); fillG.dispose(); fillM.dispose(); curtainG.dispose(); curtainM.dispose() },
  }
}

export function Zones({ start, finish, solids }: { start: Box3; finish: Box3; solids: Solids }): JSX.Element {
  const made = useMemo(() => [
    zoneObjects(start, zoneFloor(start, solids), ZONE_COLORS.start),
    zoneObjects(finish, zoneFloor(finish, solids), ZONE_COLORS.finish),
  ], [start, finish, solids])
  useEffect(() => () => { for (const z of made) z.dispose() }, [made])
  // Inside a zone its curtain dims (see the header); eased so stepping in or out never flicks.
  const boxes = [start, finish]
  useFrame(({ camera }, dt) => {
    const k = 1 - Math.exp(-Math.min(dt, 0.25) * 6)
    for (let i = 0; i < made.length; i++) {
      const want = overZone(boxes[i], camera.position.x, camera.position.z) ? INSIDE_SHARE : 1
      const c = made[i].curtain.color
      c.setScalar(c.r + (want - c.r) * k)
    }
  })
  return <>{made.flatMap((z, i) => z.objects.map((o, j) => <primitive key={`${i}:${j}`} object={o} />))}</>
}
