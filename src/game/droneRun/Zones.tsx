/**
 * Zones.tsx - the safe zone and the end zone, readable from anywhere on the
 * field without ever flooding the screen: each zone's footprint traced on the
 * ground by a soft band that follows the ground under it, filled very faintly,
 * with a line of thin posts of light standing round its edge, bright at the
 * foot and fading upward. Cyan for the start, gold for the finish. Drawn
 * through the fog (it is a guide, not part of the world), never written to
 * the depth buffer, and added onto what is behind it.
 *
 * The posts are thin on purpose: across the field they read as a row of
 * lines, and standing among them (in the safe zone, on the end zone's dais)
 * each covers a sliver of the view, so the WAVE CLEAR card never sits on a
 * coloured screen. While the eye is inside a zone its marks fade to
 * INSIDE_SHARE of their light, eased, and come back as you step out.
 *
 * Drawn by the game from the level's zone boxes, never as world shards.
 * Ledger: the zones are class (b) (the variant's rules); this look is (c).
 */

import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { AdditiveBlending, BufferGeometry, DoubleSide, Float32BufferAttribute, Mesh, MeshBasicMaterial } from 'three'
import { groundBelow, type Box3, type Solids } from '../../lib/games/droneRun/sim'

/** The start zone's cyan and the finish's gold. */
export const ZONE_COLORS = { start: [0.25, 0.92, 1] as const, finish: [1, 0.78, 0.22] as const }
/** How far apart the posts stand round a zone's edge, gibsons (at most; corners always get one). */
export const POST_SPACING = 4
/** A post's height and width, gibsons. */
export const POST_HEIGHT = 3
export const POST_WIDTH = 0.18
/** A post's light at its foot, as a share of the zone's colour (it fades to nothing at the top). */
export const POST_LIGHT = 0.7
/** The band on the ground round the footprint: its width (inward from the edge), gibsons, and light. */
export const BAND_WIDTH = 0.35
export const BAND_LIGHT = 0.45
/** The fill over the footprint, a share of the zone's colour. */
export const FILL_LIGHT = 0.035
/** The marks' light while the eye is inside their zone, as a share of their full light. */
export const INSIDE_SHARE = 0.3
/** How far over the ground the band and the fill lie, gibsons. */
const LIFT = 0.05

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

/**
 * Points round a zone's footprint (cyberspace x, z), every corner and then
 * evenly along each side at most `spacing` apart, once each, in order round it.
 */
export function edgePoints(box: Box3, spacing: number): Array<[number, number]> {
  const c: Array<[number, number]> = [[box.lo[0], box.lo[2]], [box.hi[0], box.lo[2]], [box.hi[0], box.hi[2]], [box.lo[0], box.hi[2]]]
  const out: Array<[number, number]> = []
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4]
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / spacing))
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n])
  }
  return out
}

function zoneObjects(box: Box3, solids: Solids, rgb: readonly [number, number, number]): { materials: MeshBasicMaterial[]; objects: Mesh[]; dispose: () => void } {
  const floor = zoneFloor(box, solids)
  const top = box.hi[1] + 2
  // The ground under a point of the footprint (render z = -cyberspace z).
  const ground = (x: number, z: number): number => groundBelow(solids, x, top, z, top - box.lo[1] + 6) ?? floor
  const cx = (box.lo[0] + box.hi[0]) / 2, cz = (box.lo[2] + box.hi[2]) / 2
  const shade = (k: number): number[] => [rgb[0] * k, rgb[1] * k, rgb[2] * k]
  const mesh = (pos: number[], col: number[]): { m: Mesh; mat: MeshBasicMaterial; g: BufferGeometry } => {
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(pos, 3))
    g.setAttribute('color', new Float32BufferAttribute(col, 3))
    const mat = new MeshBasicMaterial({ vertexColors: true, fog: false, depthWrite: false, side: DoubleSide, toneMapped: false, transparent: true, blending: AdditiveBlending })
    const m = new Mesh(g, mat)
    m.frustumCulled = false; m.renderOrder = 18; m.raycast = () => {}
    return { m, mat, g }
  }

  // The band: round the edge every gibson, each point paired with one BAND_WIDTH toward the middle, both on the ground.
  const ring = edgePoints(box, 1)
  const inward = ([x, z]: [number, number]): [number, number] => {
    const dx = Math.sign(cx - x) * Math.min(BAND_WIDTH, Math.abs(cx - x)), dz = Math.sign(cz - z) * Math.min(BAND_WIDTH, Math.abs(cz - z))
    return [x + dx, z + dz]
  }
  const bandPos: number[] = [], bandCol: number[] = []
  const at = ([x, z]: [number, number]): number[] => [x, ground(x, z) + LIFT, -z]
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length]
    const ai = inward(a), bi = inward(b)
    // A corner's inward point is diagonal: the band turns the corner square.
    for (const p of [at(a), at(b), at(bi), at(a), at(bi), at(ai)]) { bandPos.push(...p); bandCol.push(...shade(BAND_LIGHT)) }
  }
  const band = mesh(bandPos, bandCol)

  // The fill: one flat sheet at the zone's floor, faint.
  const fy = floor + LIFT
  const fc = [[box.lo[0], -box.lo[2]], [box.hi[0], -box.lo[2]], [box.hi[0], -box.hi[2]], [box.lo[0], -box.hi[2]]]
  const fillPos: number[] = [], fillCol: number[] = []
  for (const k of [0, 1, 2, 0, 2, 3]) { fillPos.push(fc[k][0], fy, fc[k][1]); fillCol.push(...shade(FILL_LIGHT)) }
  const fill = mesh(fillPos, fillCol)

  // The posts: two crossed thin quads each, bright at the foot, nothing at the top.
  const postPos: number[] = [], postCol: number[] = []
  const w = POST_WIDTH / 2
  for (const [x, z] of edgePoints(box, POST_SPACING)) {
    const y0 = ground(x, z), y1 = y0 + POST_HEIGHT, rz = -z
    for (const [dx, dz] of [[w, 0], [0, w]]) {
      const lo = shade(POST_LIGHT), hi = shade(0)
      const quad: Array<[number[], number[]]> = [
        [[x - dx, y0, rz - dz], lo], [[x + dx, y0, rz + dz], lo], [[x + dx, y1, rz + dz], hi],
        [[x - dx, y0, rz - dz], lo], [[x + dx, y1, rz + dz], hi], [[x - dx, y1, rz - dz], hi],
      ]
      for (const [p, c] of quad) { postPos.push(...p); postCol.push(...c) }
    }
  }
  const posts = mesh(postPos, postCol)

  const made = [fill, band, posts]
  return {
    materials: made.map((x) => x.mat),
    objects: made.map((x) => x.m),
    dispose: () => { for (const x of made) { x.g.dispose(); x.mat.dispose() } },
  }
}

export function Zones({ start, finish, solids }: { start: Box3; finish: Box3; solids: Solids }): JSX.Element {
  const made = useMemo(() => [
    zoneObjects(start, solids, ZONE_COLORS.start),
    zoneObjects(finish, solids, ZONE_COLORS.finish),
  ], [start, finish, solids])
  useEffect(() => () => { for (const z of made) z.dispose() }, [made])
  // Inside a zone its marks dim (see the header); eased so stepping in or out never flicks.
  const boxes = [start, finish]
  useFrame(({ camera }, dt) => {
    const k = 1 - Math.exp(-Math.min(dt, 0.25) * 6)
    for (let i = 0; i < made.length; i++) {
      const want = overZone(boxes[i], camera.position.x, camera.position.z) ? INSIDE_SHARE : 1
      for (const m of made[i].materials) m.color.setScalar(m.color.r + (want - m.color.r) * k)
    }
  })
  return <>{made.flatMap((z, i) => z.objects.map((o, j) => <primitive key={`${i}:${j}`} object={o} />))}</>
}
