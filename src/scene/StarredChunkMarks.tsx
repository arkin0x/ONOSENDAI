/**
 * StarredChunkMarks.tsx - your saved (starred) chunks in the world (owner,
 * 2026-11-28: "I don't want to lose track of myself while I'm navigating
 * around and forget what chunk had the glowcore"; store/starredChunks.ts).
 *
 * - THE OUTLINES. A saved chunk within NEAR_CHUNKS of the chunk you stand in
 *   shows its twelve edges faintly in gold. The one you stand in is lit
 *   brighter, with a stronger glow, and the one being guided to
 *   breathes. The visual language is SurveyGlow's (the chunk's edges as one
 *   screen-space line, a wide faint line under it for the glow, a hair
 *   outside the chunk so it never fights the blocks on its border), in the
 *   saved chunk's gold instead of the SURVEY hold's mint. No filled faces:
 *   standing inside, even a 2% gold face over the black sky reads as an olive
 *   wash once it is brought to the screen's colours (seen in the screenshots).
 * - THE BEACON (SET WAYPOINT). A tall light pillar of gold rising from the
 *   middle of the chunk's floor, a five-pointed star at its top, standing in
 *   the world so the way to it reads from far off. Drawn like a distant
 *   marker: past BEACON_FAR render units it is brought in along its own line
 *   of sight and scaled down to match, so it keeps its true size on screen,
 *   and never smaller on screen than BEACON_MIN_SHARE of its distance tall,
 *   so it never dwindles to nothing. Drawn after the blocks and depth tested:
 *   a hill in front hides its foot, never its top.
 *
 * Local only: neither is ever published (the HUD TARGET marker is
 * hooks/useTargets.ts). Drawn while TERRAIN is on, in the plane of the chunk.
 *
 * Everything is made once and kept; a frame moves, scales and fades it and
 * makes nothing new. The field's frame (TerrainLayer.tsx fieldMatrix) is
 * worked out again only when the anchor, the zoom or the field changes; the
 * chunks near you are looked for four times a second, not every frame.
 * Nothing here blooms (NO_BLOOM_BLEND).
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  BoxGeometry, CylinderGeometry, DoubleSide, Group, Matrix4, Mesh, MeshBasicMaterial, Shape, ShapeGeometry, ShaderMaterial, Color, Vector3,
} from 'three'
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import type { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { headNow, terrainSession, useTerrain, type TerrainSession } from '../store/useTerrain'
import { useCyberspace } from '../store/useCyberspace'
import { useStarredChunks } from '../store/starredChunks'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { parseChunkKey, type ChunkBase } from '../lib/terrain/coords'
import { STAR_GOLD } from '../lib/terrain/starredChunk'
import type { ViewAxes } from '../lib/space'
import { NO_BLOOM_BLEND } from './shardFaces'
import { edgeSegments, outlineLines, outlineMaterial, sizeOutline } from './hiddenParts'
import { drawnAnchor, drawnScale, fieldMatrix } from './TerrainLayer'

/** A chunk's side, in blocks. */
const SIDE = 32
/** Saved chunks this many chunks from yours (on every axis) show their outline. */
export const NEAR_CHUNKS = 2
/** The most outlines drawn at once. */
const POOL = 8
/** How far outside the chunk its outline is drawn, in blocks (as SurveyGlow's). */
const PAD = 0.06
/** The pillar: how tall and how wide, in blocks. */
export const BEACON_HEIGHT = 224
const CORE_RADIUS = 0.9
const HALO_RADIUS = 4.5
const STAR_SIZE = 9
/** Past this many render units the beacon is brought in along its line of sight (the camera's far plane is 6000). */
export const BEACON_FAR = 1500
/** The beacon is never shorter on screen than this share of its distance (about a fifth of a phone's height). */
export const BEACON_MIN_SHARE = 0.32
/** One breath of the beacon and of the guided chunk's outline, ms. */
const BREATH_MS = 2400
/** How often the chunks near you are looked for, ms. */
const LOOK_MS = 250

/** The chunk's twelve edges, worked out once from a box that is then let go. */
const EDGES = edgeSegments(new BoxGeometry(SIDE + PAD, SIDE + PAD, SIDE + PAD))

/** The look per state: the edges and the glow under them. */
const LOOK = {
  near: { edge: 0.32, halo: 0.08 },
  guided: { edge: 0.62, halo: 0.2 },
  here: { edge: 0.95, halo: 0.36 },
} as const

/** A five-pointed star, flat, pointing up, `r` across from its middle to a point. */
export function starShape(r: number, inner = 0.42): Shape {
  const s = new Shape()
  for (let k = 0; k < 10; k++) {
    const a = (Math.PI / 5) * k + Math.PI / 2
    const rr = k % 2 === 0 ? r : r * inner
    const x = rr * Math.cos(a), y = rr * Math.sin(a)
    if (k === 0) s.moveTo(x, y)
    else s.lineTo(x, y)
  }
  s.closePath()
  return s
}

/** The pillar's light: bright at its foot and along its axis, fading up its height and out to its sides. */
function pillarMaterial(color: string, strength: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color(color) }, uOpacity: { value: 0 }, uStrength: { value: strength } },
    vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform vec3 uColor; uniform float uOpacity; uniform float uStrength; varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main() { float up = pow(1.0 - vUv.y, 1.6); float edge = pow(abs(dot(vN, vV)), 1.4); gl_FragColor = vec4(uColor, uOpacity * uStrength * up * edge); }',
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: DoubleSide,
    toneMapped: false,
    ...NO_BLOOM_BLEND,
  })
}

interface Slot {
  group: Group
  edges: LineMaterial
  halo: LineMaterial
  edgeLines: LineSegments2
  haloLines: LineSegments2
}

/** The outlines' and the beacon's parts, made once. */
function makeParts(): { slots: Slot[]; beacon: Group; core: ShaderMaterial; glow: ShaderMaterial; starMat: MeshBasicMaterial; star: Mesh; geos: Array<{ dispose: () => void }> } {

  const slots: Slot[] = Array.from({ length: POOL }, () => {
    const edges = Object.assign(outlineMaterial({ color: STAR_GOLD, opacity: 0, px: 2 }), NO_BLOOM_BLEND, { side: DoubleSide })
    const halo = Object.assign(outlineMaterial({ color: STAR_GOLD, opacity: 0, px: 8 }), NO_BLOOM_BLEND, { side: DoubleSide })
    const edgeLines = outlineLines(EDGES, edges)
    const haloLines = outlineLines(EDGES, halo)
    haloLines.renderOrder = 4
    edgeLines.renderOrder = 5
    const group = new Group()
    group.visible = false
    group.add(haloLines, edgeLines)
    return { group, edges, halo, edgeLines, haloLines }
  })
  // The beacon, in blocks, its foot at the origin, rising along +Y.
  const coreGeo = new CylinderGeometry(CORE_RADIUS, CORE_RADIUS, BEACON_HEIGHT, 10, 1, true)
  coreGeo.translate(0, BEACON_HEIGHT / 2, 0)
  const glowGeo = new CylinderGeometry(HALO_RADIUS, HALO_RADIUS * 0.6, BEACON_HEIGHT, 16, 1, true)
  glowGeo.translate(0, BEACON_HEIGHT / 2, 0)
  const starGeo = new ShapeGeometry(starShape(STAR_SIZE))
  const core = pillarMaterial('#fff1c2', 1)
  const glow = pillarMaterial(STAR_GOLD, 0.55)
  const starMat = new MeshBasicMaterial({ color: STAR_GOLD, transparent: true, opacity: 0, depthWrite: false, side: DoubleSide, toneMapped: false, ...NO_BLOOM_BLEND })
  const beacon = new Group()
  beacon.visible = false
  const coreMesh = new Mesh(coreGeo, core)
  const glowMesh = new Mesh(glowGeo, glow)
  const star = new Mesh(starGeo, starMat)
  star.position.set(0, BEACON_HEIGHT + STAR_SIZE * 0.6, 0)
  for (const m of [coreMesh, glowMesh, star]) { m.raycast = () => {}; m.frustumCulled = false; m.renderOrder = 6 }
  beacon.add(glowMesh, coreMesh, star)
  return { slots, beacon, core, glow, starMat, star, geos: [coreGeo, glowGeo, starGeo] }
}

/**
 * Where the beacon stands this frame, and its scale, written into `out`:
 * `at` is the chunk's floor in render space, `eye` the camera. Brought in to
 * BEACON_FAR along the line of sight (and scaled to match) when further, then
 * held at least BEACON_MIN_SHARE of its distance tall. `unit` is one block in
 * render units. Returns the scale.
 */
export function beaconPlacement(out: Vector3, at: Vector3, eye: Vector3, unit: number): number {
  out.copy(at).sub(eye)
  const d = out.length()
  if (!(d > 0)) { out.copy(at); return unit }
  const near = Math.min(d, BEACON_FAR)
  const along = near / d
  out.multiplyScalar(along).add(eye)
  const floor = (near * BEACON_MIN_SHARE) / BEACON_HEIGHT
  return Math.max(unit * along, floor)
}

/** The field-frame offset of a chunk's corner from the field's origin, in blocks; null when the numbers would not be exact. */
function cornerOffset(s: TerrainSession, c: ChunkBase): [number, number, number] | null {
  const o = s.world.origin
  const dx = c.x - o.x, dy = c.y - o.y, dz = c.z - o.z
  const lim = 1n << 52n
  if (dx > lim || dx < -lim || dy > lim || dy < -lim || dz > lim || dz < -lim) return null
  return [Number(dx), Number(dy), Number(dz)]
}

export function StarredChunkMarks({ axes }: { axes: ViewAxes }): JSX.Element {
  const reduced = useReducedMotion()
  const calm = useRef(reduced)
  calm.current = reduced
  const parts = useMemo(() => makeParts(), [])
  useEffect(() => () => {
    for (const s of parts.slots) { s.edges.dispose(); s.halo.dispose(); s.edgeLines.geometry.dispose(); s.haloLines.geometry.dispose() }
    parts.core.dispose(); parts.glow.dispose(); parts.starMat.dispose()
    for (const g of parts.geos) g.dispose()
  }, [parts])
  const outlines = useRef<Group>(null)
  // The field's frame, kept until what it depends on changes.
  const frame = useRef({ m: new Matrix4(), s: null as TerrainSession | null, anchor: null as unknown, scale: NaN, axes: null as ViewAxes | null })
  // The beacon's chunk, parsed once per guide, and its floor's offset in the field.
  const target = useRef({ key: null as string | null, s: null as TerrainSession | null, base: null as ChunkBase | null, off: null as [number, number, number] | null })
  // The outlines in use, and each one's state, looked for every LOOK_MS.
  const near = useRef({ at: -Infinity, n: 0, here: -1, guided: -1 })
  // The saved chunks' keys parsed once per list (a new list only when one is starred, renamed or removed), and each one's chunk steps.
  const parsed = useRef({ from: null as unknown, list: [] as Array<{ key: string; c: ChunkBase; cx: bigint; cy: bigint; cz: bigint }> })
  const scratch = useMemo(() => ({ at: new Vector3(), pos: new Vector3() }), [])

  useFrame((state) => {
    const og = outlines.current
    if (!og) return
    const s = terrainSession
    const cs = useCyberspace.getState()
    const on = !!s && useTerrain.getState().active && s.plane === cs.plane
    const st = useStarredChunks.getState()
    if (!s || !on) { og.visible = false; parts.beacon.visible = false; return }
    // The field's frame, again only when it changed.
    const f = frame.current
    const anchor = drawnAnchor(), scale = drawnScale()
    if (f.s !== s || f.anchor !== anchor || f.scale !== scale || f.axes !== axes) {
      fieldMatrix(s, axes, scale, f.m)
      f.s = s; f.anchor = anchor; f.scale = scale; f.axes = axes
      og.matrix.copy(f.m)
      og.matrixWorldNeedsUpdate = true
    }
    og.visible = true
    const now = performance.now()
    const breath = calm.current ? 1 : 0.5 - 0.5 * Math.cos((2 * Math.PI * (now % BREATH_MS)) / BREATH_MS)
    const guideKey = st.guide ? st.guide.key : null

    // The saved chunks near you, four times a second.
    const nr = near.current
    if (now - nr.at >= LOOK_MS) {
      nr.at = now
      const head = headNow()
      const hx = head.x >> 5n, hy = head.y >> 5n, hz = head.z >> 5n
      const lim = BigInt(NEAR_CHUNKS)
      const pl = parsed.current
      if (pl.from !== st.entries) {
        pl.from = st.entries
        pl.list = []
        for (const e of st.entries) {
          const c = parseChunkKey(e.c)
          if (c) pl.list.push({ key: e.c, c, cx: c.x >> 5n, cy: c.y >> 5n, cz: c.z >> 5n })
        }
      }
      let n = 0
      nr.here = -1; nr.guided = -1
      for (const { key, c, cx, cy, cz } of pl.list) {
        if (n >= POOL) break
        if (c.plane !== s.plane) continue
        const ax = cx - hx, ay = cy - hy, az = cz - hz
        if (ax > lim || ax < -lim || ay > lim || ay < -lim || az > lim || az < -lim) continue
        const off = cornerOffset(s, c)
        if (!off) continue
        const slot = parts.slots[n]
        slot.group.position.set(off[0] + SIDE / 2, off[1] + SIDE / 2, off[2] + SIDE / 2)
        if (ax === 0n && ay === 0n && az === 0n && cs.headPlane === c.plane) nr.here = n
        else if (key === guideKey) nr.guided = n
        n++
      }
      nr.n = n
    }
    for (let i = 0; i < POOL; i++) {
      const slot = parts.slots[i]
      if (i >= nr.n) { slot.group.visible = false; continue }
      const look = i === nr.here ? LOOK.here : i === nr.guided ? LOOK.guided : LOOK.near
      const lift = i === nr.guided ? 0.7 + 0.3 * breath : 1
      slot.edges.opacity = look.edge * lift
      slot.halo.opacity = look.halo * lift
      sizeOutline(slot.edges, state.size)
      sizeOutline(slot.halo, state.size)
      slot.group.visible = true
    }

    // The beacon, while SET WAYPOINT is on, in the chunk's plane.
    const b = parts.beacon
    const tg = target.current
    if (!st.guide?.waypoint) { b.visible = false; return }
    if (tg.key !== st.guide.key || tg.s !== s) {
      tg.key = st.guide.key; tg.s = s
      tg.base = parseChunkKey(tg.key)
      tg.off = tg.base && tg.base.plane === s.plane ? cornerOffset(s, tg.base) : null
    }
    if (!tg.off) { b.visible = false; return }
    // The middle of the chunk's floor, in render space: its face lowest on screen, whichever axis the view has as up.
    const up = axes.up.axis === 'x' ? 0 : axes.up.axis === 'y' ? 1 : 2
    const lift = axes.up.dir > 0 ? 0 : SIDE
    const o = tg.off
    scratch.at.set(o[0] + (up === 0 ? lift : SIDE / 2), o[1] + (up === 1 ? lift : SIDE / 2), o[2] + (up === 2 ? lift : SIDE / 2)).applyMatrix4(f.m)
    const unit = f.m.getMaxScaleOnAxis()
    const k = beaconPlacement(scratch.pos, scratch.at, state.camera.position, unit)
    b.position.copy(scratch.pos)
    b.scale.setScalar(k)
    // The star faces you wherever you look from (the beacon has no turn of its own).
    parts.star.quaternion.copy(state.camera.quaternion)
    const glow = 0.75 + 0.25 * breath
    parts.core.uniforms.uOpacity.value = 0.9 * glow
    parts.glow.uniforms.uOpacity.value = 0.6 * glow
    parts.starMat.opacity = 0.85 + 0.15 * breath
    b.visible = true
  })

  return (
    <>
      <group ref={outlines} name="starred-chunk-outlines" visible={false} matrixAutoUpdate={false}>
        {parts.slots.map((s, i) => <primitive key={i} object={s.group} />)}
      </group>
      <primitive object={parts.beacon} name="starred-chunk-beacon" />
    </>
  )
}
