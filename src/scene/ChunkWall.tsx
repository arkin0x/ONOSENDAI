/**
 * ChunkWall.tsx - the glow wall at the edge of the chunk you stand in, in
 * TERRAIN (terrain/chunkStay.ts says when; lib/terrain/chunkWall.ts has the
 * numbers; owner, 2026-11-28: "like maybe a green glowing wall that indicates
 * I'm about to leave the chunk I'm currently in").
 *
 * Within WALL_FAR steps of the chunk's edge, the nearest face on each axis
 * shows a soft round patch of TERRAIN's mint centred on the point of the face
 * nearest you, fading in as you near it (nothing four steps off, clear one
 * step off), with the gibson grid drawn on it so the line reads to the
 * gibson, and a brighter line where the face ends at the chunk's edge (at an
 * edge or a corner, up to three faces show and meet there). A slow shimmer
 * runs across it, additive like SurveyGlow's faces; reduced motion keeps it
 * still. It never collides: WALK's walls never read it. While STAY IN THIS
 * CHUNK is on it shows solid, a lock (lucide's) in every other gibson.
 *
 * Drawn in TerrainLayer's Marks frame (a gibson q spans q to q + 1) after the
 * blocks, depth tested and pulled a hair toward the eye, so solid blocks in
 * front of it hide it and it shows exactly where the space is open, the
 * faces of the next chunk's blocks on the line included. One mesh, made once
 * for the page: three quads in one geometry, placed by the vertex shader from
 * uniforms. A frame writes uniforms only; nothing is made.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  AddEquation, BufferAttribute, BufferGeometry, CanvasTexture, Color, CustomBlending, DoubleSide, OneFactor, ShaderMaterial, SrcAlphaFactor, Vector2, Vector3,
  Vector4, ZeroFactor, type Mesh, type Texture,
} from 'three'
import { terrainSession, useTerrain, type TerrainSession } from '../store/useTerrain'
import { useCyberspace } from '../store/useCyberspace'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { useChunkStay } from '../terrain/chunkStay'
import { useStayLock } from '../terrain/stayLock'
import { parseChunkKey } from '../lib/terrain/coords'
import { CHUNK_SIDE, PATCH_RADIUS, PATCH_SOFT_FROM, makeFaces, nearFaces } from '../lib/terrain/chunkWall'
import type { Position } from '../lib/space'

/** TERRAIN's mint (holdProgress.ts, SurveyGlow). */
export const WALL_COLOUR = '#7cffc4'
/** The patch's fill and grid at full strength, open and while the lock is on (solid). */
export const WALL_FILL = 0.05
export const WALL_FILL_LOCKED = 0.24
export const WALL_GRID = 0.5
export const WALL_GRID_LOCKED = 0.75
/** The locks drawn on the wall while STAY IN THIS CHUNK is on, one in every other gibson: each this share of a gibson's side. */
export const WALL_LOCK_SIZE = 0.44
/** How quickly the patch follows a step, seconds (as fluid WALK's glide, store/walkFluid.ts GLIDE_TAU_S). */
const FOLLOW_TAU_S = 0.09
/** A jump further than this (gibsons) is a cut, not a step: the patch goes there at once. */
const FOLLOW_CUT = 6
/** How often whether the chunk is drawn (surveyed, blocks in) is looked at again, ms. */
const LOOK_MS = 200

/** Additive in colour, the alpha under it kept: it lights the scene and never feeds the bloom (shardFaces NO_BLOOM_BLEND's rule). */
const ADD_NO_BLOOM = { blending: CustomBlending, blendEquation: AddEquation, blendSrc: SrcAlphaFactor, blendDst: OneFactor, blendSrcAlpha: ZeroFactor, blendDstAlpha: OneFactor } as const

/** Three quads, one per face slot: corners at -1 and 1, and which slot each vertex is. Made once for the page. */
function wallGeometry(): BufferGeometry {
  const corner: number[] = [], face: number[] = [], index: number[] = []
  for (let f = 0; f < 3; f++) {
    const n = f * 4
    corner.push(-1, -1, 1, -1, 1, 1, -1, 1)
    face.push(f, f, f, f)
    index.push(n, n + 1, n + 2, n, n + 2, n + 3)
  }
  const g = new BufferGeometry()
  // A position the renderer needs; the shader places every vertex from the uniforms.
  g.setAttribute('position', new BufferAttribute(new Float32Array(12 * 3), 3))
  g.setAttribute('aCorner', new BufferAttribute(new Float32Array(corner), 2))
  g.setAttribute('aFace', new BufferAttribute(new Float32Array(face), 1))
  g.setIndex(index)
  return g
}

const VERTEX = /* glsl */ `
  attribute vec2 aCorner;
  attribute float aFace;
  uniform vec3 uCentre[3];
  uniform vec3 uU[3];
  uniform vec3 uV[3];
  uniform vec2 uAt[3];
  uniform vec4 uRect[3];
  uniform float uStrength[3];
  uniform float uRadius;
  varying vec2 vGrid;
  varying vec2 vLocal;
  varying vec4 vRect;
  varying float vStrength;
  void main() {
    int f = int(aFace + 0.5);
    vec2 local = aCorner * uRadius;
    vLocal = local;
    vGrid = uAt[f] + local;
    vRect = uRect[f];
    vStrength = uStrength[f];
    vec3 p = uCentre[f] + uU[f] * local.x + uV[f] * local.y;
    // A face not showing draws nothing (all its corners at one point).
    gl_Position = vStrength > 0.001 ? projectionMatrix * modelViewMatrix * vec4(p, 1.0) : vec4(0.0, 0.0, 2.0, 1.0);
  }
`

const FRAGMENT = /* glsl */ `
  uniform vec3 uColour;
  uniform float uRadius;
  uniform float uSoftFrom;
  uniform float uTime;
  uniform float uShimmer;
  uniform float uFill;
  uniform float uGrid;
  uniform float uLock;
  uniform float uLockSize;
  uniform sampler2D uLockMap;
  varying vec2 vGrid;
  varying vec2 vLocal;
  varying vec4 vRect;
  varying float vStrength;
  void main() {
    // Only on the chunk's own face: the patch stops at its edges.
    if (vGrid.x < vRect.x || vGrid.y < vRect.y || vGrid.x > vRect.z || vGrid.y > vRect.w) discard;
    float r = length(vLocal);
    float fall = 1.0 - smoothstep(uSoftFrom, uRadius, r);
    if (fall <= 0.0) discard;
    // The gibson grid: a line on every whole coordinate, a pixel and a bit wide at any distance.
    vec2 w = max(fwidth(vGrid), vec2(1e-4));
    vec2 toLine = abs(fract(vGrid + 0.5) - 0.5);
    vec2 line = 1.0 - smoothstep(w * 0.5, w * 1.6, toLine);
    float grid = max(line.x, line.y);
    // The chunk's edge, where this face meets the next: brighter.
    vec2 toEdge = min(vGrid - vRect.xy, vRect.zw - vGrid);
    float edge = 1.0 - smoothstep(0.0, max(w.x, w.y) * 3.0 + 0.03, min(toEdge.x, toEdge.y));
    float shimmer = 1.0 + uShimmer * 0.28 * sin(uTime * 1.9 + (vGrid.x + vGrid.y) * 0.55);
    float a = (uFill + grid * uGrid + edge * 0.7) * fall * shimmer;
    // While STAY IN THIS CHUNK is on: lucide's lock in every other gibson, a checker, so it reads near or far.
    if (uLock > 0.5) {
      vec2 id = floor(vGrid);
      if (mod(id.x + id.y, 2.0) < 0.5) {
        vec2 t = (fract(vGrid) - 0.5) / uLockSize + 0.5;
        if (t.x >= 0.0 && t.x <= 1.0 && t.y >= 0.0 && t.y <= 1.0) a += texture2D(uLockMap, t).a * 0.85 * fall;
      }
    }
    gl_FragColor = vec4(uColour, clamp(a * vStrength, 0.0, 1.0));
  }
`

/** lucide's lock (its rect and its shackle, on lucide's 24 grid), drawn once into a texture; null where there is no canvas. */
let lockMap: Texture | null | undefined
function lockTexture(): Texture | null {
  if (lockMap !== undefined) return lockMap
  lockMap = null
  try {
    const c = typeof document !== 'undefined' ? document.createElement('canvas') : null
    const g = c?.getContext('2d')
    if (!c || !g || typeof Path2D === 'undefined') return null
    c.width = c.height = 128
    g.scale(128 / 24, 128 / 24)
    g.strokeStyle = '#fff'
    g.lineWidth = 2.25
    g.lineCap = 'round'
    g.lineJoin = 'round'
    g.stroke(new Path2D('M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z'))
    g.stroke(new Path2D('M7 11V7a5 5 0 0 1 10 0v4'))
    lockMap = new CanvasTexture(c)
  } catch { lockMap = null }
  return lockMap
}

/** The wall's material, made once for a wall: every number it draws by is a uniform. */
export function makeWallMaterial(): ShaderMaterial {
  const lock = lockTexture()
  return new ShaderMaterial({
    uniforms: {
      uCentre: { value: [new Vector3(), new Vector3(), new Vector3()] },
      uU: { value: [new Vector3(), new Vector3(), new Vector3()] },
      uV: { value: [new Vector3(), new Vector3(), new Vector3()] },
      uAt: { value: [new Vector2(), new Vector2(), new Vector2()] },
      uRect: { value: [new Vector4(), new Vector4(), new Vector4()] },
      uStrength: { value: [0, 0, 0] },
      uRadius: { value: PATCH_RADIUS },
      uSoftFrom: { value: PATCH_SOFT_FROM },
      uColour: { value: new Color(WALL_COLOUR) },
      uTime: { value: 0 },
      uShimmer: { value: 1 },
      uFill: { value: WALL_FILL },
      uGrid: { value: WALL_GRID },
      uLock: { value: 0 },
      uLockSize: { value: WALL_LOCK_SIZE },
      uLockMap: { value: lock },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: DoubleSide,
    // One pass: three's two-pass transparent DoubleSide would draw it twice (scene/__tests__/singlePass.test.ts).
    forceSinglePass: true,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
    ...ADD_NO_BLOOM,
  })
}

/** The axes a face's patch lies along, per axis it stands across: (u, v), v up where the face stands upright. */
const FACE_AXES: ReadonlyArray<readonly [0 | 1 | 2, 0 | 1 | 2]> = [[2, 1], [0, 2], [0, 1]]

/** Where the wall finds the field and the lock (the scene's own; a test passes its own). */
export interface ChunkWallProps {
  session?: () => TerrainSession | null
}

export function ChunkWall({ session = () => terrainSession }: ChunkWallProps): JSX.Element {
  const reduced = useReducedMotion()
  const calm = useRef(reduced)
  calm.current = reduced
  const mesh = useRef<Mesh>(null)
  const geometry = useMemo(() => wallGeometry(), [])
  const material = useMemo(() => makeWallMaterial(), [])
  useEffect(() => () => { geometry.dispose(); material.dispose() }, [geometry, material])
  // Kept between frames: the chunk (its key and low corner in the field's frame), whether it is drawn and when that
  // was looked at, where the walker's gibson is (by its Position object, so a bigint is turned into a number only when
  // you step), where the patch follows it to, and the faces.
  const keep = useMemo(() => ({
    key: null as string | null, field: null as TerrainSession | null, lo: [0, 0, 0] as [number, number, number], drawn: false, lookedAt: -Infinity,
    cursor: null as Position | null, target: [0, 0, 0] as [number, number, number], at: [0, 0, 0] as [number, number, number], placed: false,
    local: [0, 0, 0] as [number, number, number], faces: makeFaces(), time: 0,
  }), [])
  useFrame((_, delta) => {
    const m = mesh.current
    if (!m) return
    const s = session()
    const k = keep
    const here = useChunkStay.getState().here
    const cs = useCyberspace.getState()
    const lockKey = useStayLock.getState().locks[cs.identity.pubkey || 'local'] ?? null
    if (!s || !here || !useTerrain.getState().active || s.plane !== cs.plane) { m.visible = false; k.placed = false; return }
    const now = performance.now()
    if (here !== k.key || s !== k.field) {
      const base = parseChunkKey(here)
      if (!base) { m.visible = false; return }
      k.key = here; k.field = s; k.lookedAt = -Infinity
      const o = s.world.origin
      k.lo[0] = Number(base.x - o.x); k.lo[1] = Number(base.y - o.y); k.lo[2] = Number(base.z - o.z)
    }
    // Shown for a chunk drawn for you (surveyed, its blocks in: there is something to dig), or the one you stay in.
    if (now - k.lookedAt >= LOOK_MS) { k.lookedAt = now; k.drawn = !!s.world.slotByKey(here)?.blocks }
    const locked = lockKey === here
    if (!k.drawn && !locked) { m.visible = false; k.placed = false; return }
    const at = cs.walking ? cs.cursor : cs.position
    if (at !== k.cursor) {
      k.cursor = at
      const o = s.world.origin
      // The gibson's middle, in the field's frame.
      k.target[0] = Number(at.x - o.x) + 0.5; k.target[1] = Number(at.y - o.y) + 0.5; k.target[2] = Number(at.z - o.z) + 0.5
    }
    const dt = Math.min(Math.max(delta, 0), 0.1)
    const follow = 1 - Math.exp(-dt / FOLLOW_TAU_S)
    const far = Math.abs(k.target[0] - k.at[0]) + Math.abs(k.target[1] - k.at[1]) + Math.abs(k.target[2] - k.at[2]) > FOLLOW_CUT
    for (let a = 0; a < 3; a++) {
      k.at[a] = !k.placed || far ? k.target[a] : k.at[a] + (k.target[a] - k.at[a]) * follow
      k.local[a] = Math.min(CHUNK_SIDE, Math.max(0, k.at[a] - k.lo[a]))
    }
    k.placed = true
    const shown = nearFaces(k.local, k.faces)
    if (shown === 0) { m.visible = false; return }
    const u = material.uniforms
    const strength = u.uStrength.value as number[]
    for (let f = 0; f < 3; f++) {
      const face = k.faces[f]
      strength[f] = face.strength
      if (face.strength <= 0) continue
      const [ua, va] = FACE_AXES[face.axis]
      const plane = k.lo[face.axis] + (face.side < 0 ? 0 : CHUNK_SIDE)
      const c = (u.uCentre.value as Vector3[])[f]
      c.set(k.at[0], k.at[1], k.at[2]).setComponent(face.axis, plane)
      ;(u.uU.value as Vector3[])[f].set(0, 0, 0).setComponent(ua, 1)
      ;(u.uV.value as Vector3[])[f].set(0, 0, 0).setComponent(va, 1)
      ;(u.uAt.value as Vector2[])[f].set(k.at[ua], k.at[va])
      ;(u.uRect.value as Vector4[])[f].set(k.lo[ua], k.lo[va], k.lo[ua] + CHUNK_SIDE, k.lo[va] + CHUNK_SIDE)
    }
    k.time += dt
    u.uTime.value = k.time
    u.uShimmer.value = calm.current ? 0 : 1
    u.uLock.value = locked && u.uLockMap.value ? 1 : 0
    u.uFill.value = locked ? WALL_FILL_LOCKED : WALL_FILL
    u.uGrid.value = locked ? WALL_GRID_LOCKED : WALL_GRID
    m.visible = true
  })
  return <mesh ref={mesh} name="terrain-chunk-wall" geometry={geometry} material={material} renderOrder={6} frustumCulled={false} visible={false} raycast={() => {}} />
}
