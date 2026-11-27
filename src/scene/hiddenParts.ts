/**
 * hiddenParts.ts: the shared three.js parts every hidden thing is built from
 * (lib/hiddenLook.ts holds the numbers): the face every solid wears, the
 * outline every hard edge gets, the thin line ring, the NEW pulse and the
 * seal inlay. One builder each, so the letter, an item's token and a sound
 * cannot come to look as if different people made them.
 *
 * Faces are opaque and out of the bloom (shardFaces TAG_BLEND, as basicFaceProps
 * gives a world face), shaded by a light that follows the eye and a faint
 * cyan rim, so a solid reads as a solid. Outlines are three's screen-space
 * lines (LineSegments2), the same OUTLINE_PX on screen at any distance where a
 * plain line is a single pixel and a band of geometry thins to nothing far
 * off; they glow, as every line in the world does.
 */

import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  EdgesGeometry,
  ExtrudeGeometry,
  InterleavedBufferAttribute,
  Path,
  RingGeometry,
  Shape,
  ShaderMaterial,
  MeshBasicMaterial,
  Float32BufferAttribute,
  type InstancedInterleavedBuffer,
} from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { HIDDEN_FACE, LINE_RING_RADIUS, OUTLINE_PX, RING_COLOUR, RING_LINE_PX } from '../lib/hiddenLook'
import { basicFaceProps } from './shardFaces'
import { ATLAS_COLS } from './glyphAtlas'

// ---------- Shapes ----------

/** A closed polygon as a three Shape, with any holes. */
export function shapeFrom(points: ReadonlyArray<readonly [number, number]>, holes: Path[] = []): Shape {
  const s = new Shape()
  points.forEach(([x, y], i) => (i === 0 ? s.moveTo(x, y) : s.lineTo(x, y)))
  s.closePath()
  for (const h of holes) s.holes.push(h)
  return s
}

/** A round hole of radius `r` at (cx, cy), wound against its shape. */
export function circleHole(cx: number, cy: number, r: number, n = 20): Path {
  const p = new Path()
  for (let i = 0; i <= n; i++) {
    const a = -(i / n) * Math.PI * 2
    if (i === 0) p.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
    else p.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
  }
  return p
}

/** A shape made solid, `depth` thick, centred on its own plane. */
export function slab(shape: Shape | Shape[], depth: number): BufferGeometry {
  const g = new ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 20 })
  g.translate(0, 0, -depth / 2)
  return g
}

/** The hard edges of a solid as line segments (x, y, z for each end): every crease of `threshold` degrees or more. */
export function edgeSegments(geometry: BufferGeometry, threshold = 30): Float32Array {
  const e = new EdgesGeometry(geometry, threshold)
  const out = new Float32Array(e.getAttribute('position').array as ArrayLike<number>)
  e.dispose()
  return out
}

/** A polyline as segments at depth `z`. */
export function polySegments(points: ReadonlyArray<readonly [number, number]>, z: number, closed: boolean): number[] {
  const out: number[] = []
  const n = closed ? points.length : points.length - 1
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[(i + 1) % points.length]
    out.push(a[0], a[1], z, b[0], b[1], z)
  }
  return out
}

/** A flat circle of radius `r` as `n` segments, in its own plane. */
export function circleSegments(r: number, n: number): Float32Array {
  const out = new Float32Array(n * 6)
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, b = ((i + 1) / n) * Math.PI * 2
    out.set([Math.cos(a) * r, Math.sin(a) * r, 0, Math.cos(b) * r, Math.sin(b) * r, 0], i * 6)
  }
  return out
}

/** The six corners of a maker's seal, pointed top and bottom, about (cx, cy). */
export function hexPoints(r: number, cx = 0, cy = 0): Array<[number, number]> {
  return [0, 1, 2, 3, 4, 5].map((k) => {
    const a = Math.PI / 2 - (k * Math.PI) / 3
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]
  })
}

/** How proud of its face a seal stands. */
export const SEAL_DEPTH = 0.014

/**
 * A seal inlaid on both faces of a slab `thickness` thick: the shapes
 * extruded SEAL_DEPTH out of each face, the back mirrored through the slab
 * so it lies on the same corners (drawn double sided).
 */
export function sealInlay(shapes: Shape[], thickness: number): BufferGeometry {
  const front = new ExtrudeGeometry(shapes, { depth: SEAL_DEPTH, bevelEnabled: false })
  front.translate(0, 0, thickness / 2)
  const back = front.clone()
  back.scale(1, 1, -1)
  const pos = [front, back].map((g) => (g.index ? g.toNonIndexed() : g))
  const a = pos[0].getAttribute('position').array as Float32Array
  const b = pos[1].getAttribute('position').array as Float32Array
  const arr = new Float32Array(a.length + b.length)
  arr.set(a, 0)
  arr.set(b, a.length)
  const out = new BufferGeometry()
  out.setAttribute('position', new Float32BufferAttribute(arr, 3))
  for (const g of new Set([front, back, ...pos])) g.dispose()
  return out
}

// ---------- Materials ----------

const FACE_VERTEX = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    #ifdef USE_INSTANCING
      mat4 m = modelViewMatrix * instanceMatrix;
    #else
      mat4 m = modelViewMatrix;
    #endif
    vec4 mv = m * vec4(position, 1.0);
    vN = normalize(mat3(m) * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`

const FACE_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uRimColor;
  uniform float uRim;
  uniform float uOpacity;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vec3 n = normalize(vN);
    if (!gl_FrontFacing) n = -n;
    float light = 0.62 + 0.42 * max(dot(n, normalize(vec3(0.35, 0.8, 0.5))), 0.0);
    float rim = pow(1.0 - max(dot(n, normalize(vV)), 0.0), 2.5);
    gl_FragColor = vec4(uColor * light + uRimColor * rim * uRim, uOpacity);
  }
`

/**
 * The face every hidden solid wears: HIDDEN_FACE, shaded, out of the bloom,
 * writing depth; see-through at `opacity` under 1 (a thing fading out or
 * being moved). Works on a mesh and on an instanced mesh alike.
 */
export function faceMaterial(opacity = 1, color: string = HIDDEN_FACE, rim = 0.2): ShaderMaterial {
  const props = basicFaceProps(opacity, { ghost: false, world: true })
  const m = new ShaderMaterial({
    vertexShader: FACE_VERTEX,
    fragmentShader: FACE_FRAGMENT,
    uniforms: { uColor: { value: new Color(color) }, uRimColor: { value: new Color(RING_COLOUR) }, uRim: { value: rim }, uOpacity: { value: opacity } },
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 2,
    ...props,
  })
  m.toneMapped = false
  return m
}

/** A face's opacity, as it fades: its uniform. */
export function setFaceOpacity(m: ShaderMaterial, opacity: number): void {
  m.uniforms.uOpacity.value = opacity
}

/**
 * The outline every hard edge gets: OUTLINE_PX on screen at any distance,
 * glowing. `vertexColors` reads a colour per segment (a field of letters, each
 * in its own state); otherwise `color`.
 */
export function outlineMaterial({ color = '#ffffff', opacity = 1, vertexColors = false, px = OUTLINE_PX }: { color?: string; opacity?: number; vertexColors?: boolean; px?: number } = {}): LineMaterial {
  const m = new LineMaterial({ color: new Color(color).getHex(), linewidth: px, worldUnits: false, vertexColors, transparent: true, opacity, depthWrite: false })
  m.toneMapped = false
  return m
}

/** Keep an outline's width in CSS pixels: its resolution is the canvas's size in CSS pixels. */
export function sizeOutline(m: LineMaterial, size: { width: number; height: number }): void {
  const r = m.resolution
  if (r.x !== size.width || r.y !== size.height) r.set(size.width, size.height)
}

/** Nothing to hit: hidden things take taps on their tap targets, never on their lines. */
function noRaycast(): void {}

/**
 * Fixed outline segments (in the object's own frame) as a screen-space line
 * object: the segments `positions`, six numbers each.
 */
export function outlineLines(positions: Float32Array, material: LineMaterial): LineSegments2 {
  const g = new LineSegmentsGeometry()
  g.setPositions(positions)
  const l = new LineSegments2(g, material)
  l.frustumCulled = false
  l.raycast = noRaycast
  return l
}

/**
 * Outline segments rewritten every frame (a field of letters moved on the
 * CPU, a sound's slices swelling): room for `segments`, each with its own
 * colour when `colours`. Draw `count` with drawSegments.
 */
export function liveOutlineGeometry(segments: number, colours: boolean): LineSegmentsGeometry {
  const g = new LineSegmentsGeometry()
  g.setPositions(new Float32Array(Math.max(1, segments) * 6))
  ;(g.getAttribute('instanceStart') as InterleavedBufferAttribute).data.setUsage(DynamicDrawUsage)
  if (colours) {
    g.setColors(new Float32Array(Math.max(1, segments) * 6))
    ;(g.getAttribute('instanceColorStart') as InterleavedBufferAttribute).data.setUsage(DynamicDrawUsage)
  }
  g.instanceCount = 0
  return g
}

/** The live geometry's position array (six numbers per segment), to write into. */
export function segmentPositions(g: LineSegmentsGeometry): Float32Array {
  return (g.getAttribute('instanceStart') as InterleavedBufferAttribute).data.array as Float32Array
}

/** The live geometry's colour array (six numbers per segment), to write into. */
export function segmentColours(g: LineSegmentsGeometry): Float32Array {
  return (g.getAttribute('instanceColorStart') as InterleavedBufferAttribute).data.array as Float32Array
}

/** Send what was written and draw the first `count` segments. */
export function drawSegments(g: LineSegmentsGeometry, count: number, colours = false): void {
  ;((g.getAttribute('instanceStart') as InterleavedBufferAttribute).data as InstancedInterleavedBuffer).needsUpdate = true
  if (colours) ((g.getAttribute('instanceColorStart') as InterleavedBufferAttribute).data as InstancedInterleavedBuffer).needsUpdate = true
  g.instanceCount = count
}

/** A live line object for a live geometry. */
export function liveOutlineLines(g: LineSegmentsGeometry, material: LineMaterial): LineSegments2 {
  const l = new LineSegments2(g, material)
  l.frustumCulled = false
  l.raycast = noRaycast
  return l
}

// ---------- Rings ----------

/** How many segments the thin line ring is drawn in. */
export const LINE_RING_SEGMENTS = 96

/** The thin line ring (an item's), in its own plane, a colour per segment so its idle wave can run round it. */
export function lineRingGeometry(): LineSegmentsGeometry {
  const g = new LineSegmentsGeometry()
  g.setPositions(circleSegments(LINE_RING_RADIUS, LINE_RING_SEGMENTS))
  g.setColors(new Float32Array(LINE_RING_SEGMENTS * 6).fill(1))
  ;(g.getAttribute('instanceColorStart') as InterleavedBufferAttribute).data.setUsage(DynamicDrawUsage)
  return g
}

/** The thin ring's line material: RING_LINE_PX, coloured per segment. */
export function lineRingMaterial(opacity: number): LineMaterial {
  return outlineMaterial({ vertexColors: true, opacity, px: RING_LINE_PX })
}

/** The NEW pulse: a thin ring of radius 1 in its own plane (scaled to the ring's reach), added to what is behind it so it glows and fades. */
export const PULSE_GEOMETRY = new RingGeometry(0.985, 1, 96)

/** The pulse's material: the ring colour, faded by its colour (additive), so many pulses share it. */
export function pulseMaterial(): MeshBasicMaterial {
  const m = new MeshBasicMaterial({ color: RING_COLOUR, transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, forceSinglePass: true, opacity: 1 })
  m.toneMapped = false
  return m
}

// ---------- The seal's initial ----------

/** A glyph's cell in the glyph atlas from its index: shared by every shader that draws one. */
export const ATLAS_UV = /* glsl */ `
  vec2 atlasUv(float glyph, vec2 uv) {
    float cols = ${ATLAS_COLS.toFixed(1)};
    float col = mod(glyph, cols);
    float row = floor(glyph / cols);
    // The canvas is flipped as it is uploaded: its top row is at v = 1.
    return vec2((col + uv.x) / cols, 1.0 - (row + 1.0 - uv.y) / cols);
  }
`
