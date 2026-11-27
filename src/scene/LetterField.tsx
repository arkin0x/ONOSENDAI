/**
 * LetterField.tsx: every hidden message in view, drawn as a sealed letter in
 * the world with a ring of glyphs orbiting it (owner, 2026-11-26: "in the
 * world: letter with glyph ring from concept 1. make the glyph ring's glyphs
 * randomly change to different characters. keep the ring spin effect ...
 * love the broken seal for read"), under the one rulebook every hidden thing
 * shares (lib/hiddenLook.ts; owner ruling, 2026-11-27, option A of the
 * hidden-item cohesion page).
 *
 * A folded letter, one gibson wide (LETTER_GIBSONS, as the message's box it
 * replaces was one gibson cubed), now a solid sheet LETTER_T thick, so it is
 * a real object as it turns: a thing in the place that turns slowly about the
 * scene's up axis (TURN_S), with a slight tilt and the shared bob, its flap
 * and seal on both faces (owner, 2026-11-27: "the letter should not always
 * face me and should spin slowly"). The glyph ring still faces the camera, so
 * its glyphs always read, and bobs with its letter. On the letter a hexagonal
 * seal in its author's colour (lib/authorColour) bearing their initial, inlaid
 * on both faces: whole until this identity has opened the message, broken in
 * two after (store/useMessagesRead). Round it the ring of direction 1:
 * capital letters, digits, katakana and now and then a block texture, turning
 * once every RING_TURN_S, riding the shared idle wave, a few of them changing
 * to other glyphs every frame (lib/glyphRing).
 *
 * The rulebook: the sheet wears the shared face (hiddenParts faceMaterial),
 * every hard edge of it and the flap's fold are outlined OUTLINE_PX wide at
 * any distance (bright unread, steel read), the ring is the HUD's cyan at its
 * state's opacity (RING_OPACITY), and lines and rings glow while faces never
 * do. A letter found and not yet opened (NEW) sends a pulse out of its ring
 * every PULSE_S. With reduced motion the ring holds still, its glyphs stay as
 * they are, the letter neither turns nor bobs, and NEW is a faint still ring.
 *
 * Built for a hall of letters: every letter is drawn by the same handful of
 * instanced meshes, so fifty letters cost what one does in draw calls. The
 * sheet, the whole seals, the broken seals, the initials and the pulses are
 * instanced meshes sharing one matrix per letter, worked out on the CPU each
 * frame; the outlines are one screen-space line object written on the CPU
 * with them; the rings are one mesh of glyph quads placed and turned in the
 * vertex shader from each letter's centre, reading one shared glyph atlas
 * (scene/glyphAtlas). Far off a ring thins to every third glyph, and below
 * a fingertip on screen it is not drawn at all (lib/glyphRing ringShown).
 * Changing glyphs rewrites one small buffer, capped per frame.
 *
 * What each letter is comes from the NoteItem that stands for it in
 * WorldMessages (putLetter, dropLetter), which also holds its tap target and
 * its name. This draws; it takes no taps.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Shape,
  ShapeGeometry,
  Vector3,
  type Mesh,
  type PerspectiveCamera,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { changeBudget, glyphChanges, mulberry32, ringAngle, ringRank, ringStart, RING_GLYPHS, RING_GLYPHS_FAR, RING_HIDE_PX, RING_THIN_PX, type Rng } from '../lib/glyphRing'
import { BOB, BOB_S, HIDDEN_FACE, OUTLINE_READ, OUTLINE_UNREAD, RING_COLOUR, RING_RADIUS as SHARED_RING_RADIUS, RING_REACH, SEAL_INK, TURN_S, bobAt, hiddenLook, pulseAt, ringTurnAt, turnAt, wavePhaseAt, type HiddenState } from '../lib/hiddenLook'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { basicFaceProps, TAG_BLEND } from './shardFaces'
import { glyphAtlas, refreshGlyphAtlas } from './glyphAtlas'
import { ATLAS_UV, drawSegments, edgeSegments, faceMaterial, liveOutlineGeometry, liveOutlineLines, outlineMaterial, PULSE_GEOMETRY, pulseMaterial, polySegments, sealInlay, SEAL_DEPTH, segmentColours, segmentPositions, shapeFrom, sizeOutline, slab } from './hiddenParts'
import { seedOf } from '../lib/decode'
import { LABEL_PRIORITY } from './WorldLabel'
import { restLift } from '../lib/restLift'

/** A letter's width, in gibsons: the message's box was one gibson cubed, and the letter is as wide as that box. */
export const LETTER_GIBSONS = 1

/** The letter's height for a width of 1: direction 6's 150 by 98. */
export const LETTER_ASPECT = 98 / 150

/** The sheet's thickness, for a letter 1 wide: enough to be a solid as it turns. */
export const LETTER_T = 0.03

/** The ring's radius and a glyph's size, for a letter 1 wide (the shared ring radius). */
export const RING_RADIUS = SHARED_RING_RADIUS
export const GLYPH_SIZE = 0.18
/**
 * The shape a letter's name stands over, for a letter 1 wide (WorldLabel
 * `clear` shape): the ring's reach, a disc turned to the camera, the same for
 * every hidden thing (lib/hiddenLook labelShape), and the sheet turning in it,
 * an upright ellipsoid that holds its corners and its bob.
 */
export const LETTER_SHAPE = { flat: RING_REACH, radius: 0.71, height: 0.56 } as const

/** The tilt the letter hangs at, radians (direction 6's -6 degrees). */
const TILT = (-6 * Math.PI) / 180
/** One turn of the letter about the scene's up axis, seconds: the shared turn. */
export const LETTER_TURN_S = TURN_S

/** The paper: the shared face colour. */
export const PAPER = HIDDEN_FACE
/** The outline of a letter not yet read, and of one read: the shared outline colours. */
export const FOLD_UNREAD = OUTLINE_UNREAD
export const FOLD_READ = OUTLINE_READ
/** The initial on a whole seal: near black, as pressed into wax. */
export const INITIAL_INK = SEAL_INK

/** What NoteItem says a letter is. */
export interface LetterSpec {
  key: string
  /** Its centre, scene units. */
  centre: [number, number, number]
  /** Its width, scene units: LETTER_GIBSONS at the zoom it is drawn at. */
  width: number
  /** Its author's colour, a #hex. */
  colour: string
  /** The seal's initial, as its index in the glyph atlas. */
  initial: number
  /** Read: the seal is drawn broken, the outline steel and the ring dim. */
  broken: boolean
  /** NEW: found and not yet opened, so its ring sends out a pulse. Never with `broken`. */
  fresh?: boolean
}

/** A letter's state under the rulebook. */
export function letterState(l: Pick<LetterSpec, 'broken' | 'fresh'>): HiddenState {
  return l.broken ? 'read' : l.fresh ? 'new' : 'unread'
}

const letters = new Map<string, LetterSpec>()
let version = 0
const listeners = new Set<() => void>()
function changed(): void {
  version++
  for (const l of listeners) l()
}

/** Draw a letter, or redraw it as it now is. Unchanged, nothing is redrawn. */
export function putLetter(spec: LetterSpec): void {
  const was = letters.get(spec.key)
  if (was && was.width === spec.width && was.colour === spec.colour && was.initial === spec.initial && was.broken === spec.broken && !!was.fresh === !!spec.fresh
    && was.centre[0] === spec.centre[0] && was.centre[1] === spec.centre[1] && was.centre[2] === spec.centre[2]) return
  letters.set(spec.key, spec)
  changed()
}

/** Stop drawing a letter. */
export function dropLetter(key: string): void {
  if (letters.delete(key)) changed()
}

/** The letters drawn now (tests). */
export function lettersDrawn(): LetterSpec[] {
  return [...letters.values()]
}

const subscribe = (l: () => void): (() => void) => { listeners.add(l); return () => listeners.delete(l) }
const snapshot = (): number => version

// ---------- Geometry, built once and shared ----------

/** A polygon as a flat shape, points in a letter 1 wide, centred. */
export function shapeOf(points: ReadonlyArray<readonly [number, number]>): ShapeGeometry {
  const s = new Shape()
  points.forEach(([x, y], i) => (i === 0 ? s.moveTo(x, y) : s.lineTo(x, y)))
  s.closePath()
  return new ShapeGeometry(s)
}

/** Direction 6's coordinates (150 by 98, y down) in a letter 1 wide, centred, y up. */
function fromMock(x: number, y: number): [number, number] {
  return [x / 150 - 0.5, LETTER_ASPECT / 2 - y / 150]
}

/** The paper's outline: corner cut top left and bottom right, as every chamfered frame in the HUD. */
const PAPER_OUTLINE: Array<[number, number]> = [[12, 0], [150, 0], [150, 86], [138, 98], [0, 98], [0, 12]].map(([x, y]) => fromMock(x, y))
/** The flap's fold: from the left edge down to the seal and up to the top right. */
const FLAP: Array<[number, number]> = [[0, 12], [75, 58], [150, 0]].map(([x, y]) => fromMock(x, y))
/** Where the seal sits: on the flap's point. */
export const SEAL_CENTRE = fromMock(75, 56)
/** The seal's radius, centre to corner. */
export const SEAL_RADIUS = 20 / 150

/** Thin quads along a polyline: lines of light with a width, which an instanced mesh can draw. */
export function bandOf(points: ReadonlyArray<readonly [number, number]>, width: number, closed: boolean): BufferGeometry {
  const pos: number[] = []
  const n = points.length
  const segs = closed ? n : n - 1
  for (let i = 0; i < segs; i++) {
    const [ax, ay] = points[i]
    const [bx, by] = points[(i + 1) % n]
    const len = Math.hypot(bx - ax, by - ay) || 1
    // Half the width out to each side, and as much again along the line, so corners meet.
    const nx = (-(by - ay) / len) * (width / 2)
    const ny = ((bx - ax) / len) * (width / 2)
    const ex = ((bx - ax) / len) * (width / 2)
    const ey = ((by - ay) / len) * (width / 2)
    const a0 = [ax - ex + nx, ay - ey + ny], a1 = [ax - ex - nx, ay - ey - ny]
    const b0 = [bx + ex + nx, by + ey + ny], b1 = [bx + ex - nx, by + ey - ny]
    pos.push(a0[0], a0[1], 0, a1[0], a1[1], 0, b0[0], b0[1], 0, b0[0], b0[1], 0, a1[0], a1[1], 0, b1[0], b1[1], 0)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  return g
}

/** Two geometries as one (positions only). */
export function merged(...parts: BufferGeometry[]): BufferGeometry {
  const pos: number[] = []
  for (const p of parts) {
    const g = p.index ? p.toNonIndexed() : p
    pos.push(...Array.from(g.getAttribute('position').array as ArrayLike<number>))
  }
  const out = new BufferGeometry()
  out.setAttribute('position', new Float32BufferAttribute(pos, 3))
  return out
}

/** The six corners of the seal, pointed top and bottom, about its centre. */
function hexPoints(r: number): Array<[number, number]> {
  return [0, 1, 2, 3, 4, 5].map((k) => {
    const a = Math.PI / 2 - (k * Math.PI) / 3
    return [Math.cos(a) * r, Math.sin(a) * r]
  })
}

/** The crack down a seal, top to bottom, jagged. */
function crack(r: number): Array<[number, number]> {
  return [[0, r], [0.14 * r, 0.38 * r], [-0.12 * r, 0.02 * r], [0.1 * r, -0.42 * r], [0, -r]]
}

/** Points turned by `a` radians about the origin, then moved. */
function moved(points: ReadonlyArray<readonly [number, number]>, a: number, dx: number, dy: number): Array<[number, number]> {
  const c = Math.cos(a), s = Math.sin(a)
  return points.map(([x, y]) => [x * c - y * s + dx, x * s + y * c + dy])
}

/** A whole seal at the flap's point. */
export function wholeSealPoints(): Array<[number, number]> {
  return moved(hexPoints(SEAL_RADIUS), 0, SEAL_CENTRE[0], SEAL_CENTRE[1])
}

/**
 * A broken seal: the hexagon split down its crack, the halves turned apart
 * and pushed outward, as direction 6's card draws it (left half turned 14
 * degrees one way and moved left, the right the other way).
 */
export function brokenSealHalves(): [Array<[number, number]>, Array<[number, number]>] {
  const r = SEAL_RADIUS
  const h = hexPoints(r)
  const c = crack(r)
  // Right half: top, the right-hand corners, bottom, then up the crack.
  const right = [h[0], h[1], h[2], h[3], ...c.slice(1, -1).reverse()]
  // Left half: top, down the crack, bottom, the left-hand corners.
  const left = [h[0], ...c.slice(1, -1), h[3], h[4], h[5]]
  const turn = (14 * Math.PI) / 180
  const push = 0.3 * r
  return [
    moved(left, turn, SEAL_CENTRE[0] - push, SEAL_CENTRE[1] - 0.12 * r),
    moved(right, -turn, SEAL_CENTRE[0] + push, SEAL_CENTRE[1] - 0.12 * r),
  ]
}

/** A non-indexed geometry with each triangle's winding reversed, so its front faces the other way. */
function reversed(g: BufferGeometry): BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g.clone()
  for (const name of Object.keys(out.attributes)) {
    const a = out.getAttribute(name) as BufferAttribute
    const n = a.itemSize
    const arr = a.array as Float32Array
    for (let t = 0; t + 2 < a.count; t += 3) {
      for (let k = 0; k < n; k++) {
        const i1 = (t + 1) * n + k, i2 = (t + 2) * n + k
        const tmp = arr[i1]; arr[i1] = arr[i2]; arr[i2] = tmp
      }
    }
    a.needsUpdate = true
  }
  return out
}

/**
 * A face's geometry on both faces of a flat thing: as made, a hair in front,
 * and mirrored through the paper's plane to stand a hair behind, facing out
 * the back. Mirrored, not turned half round: the paper is one sheet seen
 * from both sides, so from behind its cut corners are where they were, and
 * the back's edge, flap and seal must lie on the same corners (review of the
 * first round: a turned copy cut the opposite corners and crossed the flap).
 * `turn` turns the back copy half round instead, for what must read the
 * right way round from behind and stands on the middle line, as the seal's
 * initial does.
 */
export function bothFaces(front: BufferGeometry, z: number, turn = false): BufferGeometry {
  const a = front.index ? front.toNonIndexed() : front.clone()
  a.translate(0, 0, z)
  let b: BufferGeometry
  if (turn) {
    b = a.clone()
    b.rotateY(Math.PI)
  } else {
    b = reversed(a)
    b.scale(1, 1, -1)
  }
  return mergeGeometries([a, b])!
}

/** The sheet: the paper's outline made solid, LETTER_T thick. */
const PAPER_GEOMETRY = slab(shapeFrom(PAPER_OUTLINE), LETTER_T)

/** How far the flap's fold stands off each face, for a letter 1 wide: a hair, so it wins over the face. */
const Z_FLAP = LETTER_T / 2 + 0.002

/**
 * The letter's outline in its own frame (x, y, z for each end, a segment
 * after another): every hard edge of the sheet, front, back and round its
 * side, and the flap's fold on both faces. Drawn as screen-space lines, the
 * same width at any distance (the flap was once a band that thinned to
 * nothing far off; owner, 2026-11-27: "the envelope flap disappears
 * sometimes depending on my angle and distance").
 */
export function foldLinePoints(): Float32Array {
  const edges = Array.from(edgeSegments(PAPER_GEOMETRY, 30))
  return new Float32Array([...edges, ...polySegments(FLAP, Z_FLAP, false), ...polySegments(FLAP, -Z_FLAP, false)])
}
const FOLD_LINES = foldLinePoints()
/** Vertices of outline per letter (two per segment). */
export const FOLD_LINE_VERTS = FOLD_LINES.length / 3
/** Segments of outline per letter. */
const FOLD_SEGMENTS = FOLD_LINE_VERTS / 2

/**
 * How far a letter 1 wide reaches under its middle as it is drawn: the
 * lowest corner of its sheet at its tilt (its turn about the up axis never
 * changes a height; the seals sit inside the sheet). The glyph ring is not
 * counted: it turns to face the camera and reaches past the gibson, a halo
 * about the letter rather than the letter, and counting it would float the
 * letter most of a gibson up.
 */
export const LETTER_LOW = (() => {
  const c = Math.cos(TILT), sn = Math.sin(TILT)
  let low = 0
  for (let i = 0; i < FOLD_LINES.length; i += 3) low = Math.min(low, FOLD_LINES[i] * sn + FOLD_LINES[i + 1] * c)
  return -low
})()

/**
 * How far over its place a letter 1 wide is drawn (lib/restLift.ts): the
 * sheet's lowest point at the bottom of its bob stands REST_HOVER over the
 * level of its place, where a floor at that height lies and a chest's base
 * stands, so the floor never cuts its lower half (NoteItem).
 */
export const LETTER_LIFT = restLift(LETTER_LOW, BOB)

/** The seals, inlaid on both faces: whole, and broken in two. */
const SEAL_GEOMETRY = sealInlay([shapeFrom(wholeSealPoints())], LETTER_T)
const BROKEN_GEOMETRY = (() => {
  const [l, r] = brokenSealHalves()
  return sealInlay([shapeFrom(l), shapeFrom(r)], LETTER_T)
})()
/** The initial, on the seal's face on both sides. */
const Z_INITIAL = LETTER_T / 2 + SEAL_DEPTH + 0.002
const INITIAL_GEOMETRY = (() => {
  const g = new PlaneGeometry(SEAL_RADIUS * 1.25, SEAL_RADIUS * 1.25)
  g.translate(SEAL_CENTRE[0], SEAL_CENTRE[1] - SEAL_RADIUS * 0.04, 0)
  return bothFaces(g, Z_INITIAL, true)
})()

// ---------- Shaders ----------

const TAU_GLSL = '6.2831853'

const RING_VERTEX = /* glsl */ `
  attribute vec3 aCentre;
  attribute float aWidth;
  attribute float aAngle;
  attribute float aGlyph;
  attribute float aRank;
  attribute float aOpacity;
  attribute float aPhase;
  uniform float uTurn;
  uniform float uWave;
  uniform float uTime;
  uniform float uBob;
  uniform float uPerPixel;
  varying vec2 vUv;
  varying float vFade;
  ${ATLAS_UV}
  void main() {
    // The ring bobs with its letter: the shared bob, from the letter's own phase.
    vec3 centre = aCentre + vec3(0.0, sin(uTime / ${BOB_S.toFixed(1)} * ${TAU_GLSL} + aPhase) * uBob * aWidth, 0.0);
    vec4 c = modelViewMatrix * vec4(centre, 1.0);
    float depth = -c.z;
    // The letter's width on screen, CSS pixels: how many of its glyphs are drawn.
    float px = depth > 0.0 ? aWidth / (depth * uPerPixel) : 0.0;
    float shown = px < ${RING_HIDE_PX.toFixed(1)} ? 0.0 : (px < ${RING_THIN_PX.toFixed(1)} ? ${RING_GLYPHS_FAR.toFixed(1)} : ${RING_GLYPHS.toFixed(1)});
    if (aRank >= shown) {
      // Outside the clip box: nothing is drawn.
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      vUv = vec2(0.0);
      vFade = 0.0;
      return;
    }
    float a = aAngle + uTurn;
    // The shared idle wave: two crests going round, swelling the ring a hair and brightening it.
    float wave = 0.5 + 0.5 * sin(2.0 * a - uWave);
    float r = ${RING_RADIUS.toFixed(3)} + 0.014 * (wave - 0.5);
    // Each glyph stands on the ring, its foot toward the letter, as type set on a circle.
    float turn = a - 1.5707963;
    vec2 q = vec2(position.x * cos(turn) - position.y * sin(turn), position.x * sin(turn) + position.y * cos(turn));
    vec3 p = c.xyz + vec3(vec2(cos(a), sin(a)) * r * aWidth + q * ${GLYPH_SIZE.toFixed(3)} * aWidth, 0.0);
    gl_Position = projectionMatrix * vec4(p, 1.0);
    vUv = atlasUv(aGlyph, uv);
    // Fades in over the last few pixels before it is drawn at all, at its letter's state's opacity.
    vFade = clamp((px - ${RING_HIDE_PX.toFixed(1)}) / 8.0, 0.0, 1.0) * aOpacity * (0.72 + 0.28 * wave);
  }
`

const RING_FRAGMENT = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vFade;
  void main() {
    float a = texture2D(uAtlas, vUv).a * uOpacity * vFade;
    if (a < 0.02) discard;
    gl_FragColor = vec4(uColor, a);
  }
`

const INITIAL_VERTEX = /* glsl */ `
  attribute float aGlyph;
  varying vec2 vUv;
  ${ATLAS_UV}
  void main() {
    vUv = atlasUv(aGlyph, uv);
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`

const INITIAL_FRAGMENT = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    // Pressed into the wax: solid where the glyph is, nothing elsewhere.
    if (texture2D(uAtlas, vUv).a < 0.5) discard;
    gl_FragColor = vec4(uColor, 1.0);
  }
`

/** The ring's quad: one glyph, its uv the whole cell. */
const QUAD = new PlaneGeometry(1, 1)

/** Room for at least `n`, in steps that double, so a letter or two more never rebuilds everything. */
export function capacityFor(n: number): number {
  let c = 8
  while (c < n) c *= 2
  return c
}

/** Where the ring is drawn among the world's marks: after the shards' see-through faces and overlays. */
export const RING_ORDER = 4

export function LetterField(): JSX.Element | null {
  const v = useSyncExternalStore(subscribe, snapshot, snapshot)
  const list = useMemo(() => lettersDrawn(), [v])
  // Room only grows while mounted, so letters coming and going across a step never rebuild (and reshuffle) every ring.
  const room = useRef(0)
  room.current = Math.max(room.current, capacityFor(list.length))
  const capacity = room.current
  if (list.length === 0) return null
  return <LetterMeshes key={capacity} list={list} capacity={capacity} />
}

/** The meshes for up to `capacity` letters, rebuilt only when that grows. */
function LetterMeshes({ list, capacity }: { list: LetterSpec[]; capacity: number }): JSX.Element {
  const reduced = useReducedMotion()
  const paper = useRef<InstancedMesh>(null)
  const whole = useRef<InstancedMesh>(null)
  const broken = useRef<InstancedMesh>(null)
  const initials = useRef<InstancedMesh>(null)
  const pulses = useRef<InstancedMesh>(null)
  const ring = useRef<Mesh>(null)

  const materials = useMemo(() => {
    const atlas = glyphAtlas()
    const opaque = basicFaceProps(1, { ghost: false, world: true })
    return {
      paper: faceMaterial(1),
      lines: outlineMaterial({ vertexColors: true }),
      seal: new MeshBasicMaterial({ color: '#ffffff', toneMapped: false, ...opaque, side: DoubleSide }),
      initial: new ShaderMaterial({
        vertexShader: INITIAL_VERTEX,
        fragmentShader: INITIAL_FRAGMENT,
        uniforms: { uAtlas: { value: atlas }, uColor: { value: new Color(INITIAL_INK) } },
        transparent: true,
        ...TAG_BLEND,
      }),
      // Rings glow, as every line and ring does under the rulebook.
      ring: new ShaderMaterial({
        vertexShader: RING_VERTEX,
        fragmentShader: RING_FRAGMENT,
        uniforms: { uAtlas: { value: atlas }, uColor: { value: new Color(RING_COLOUR) }, uOpacity: { value: 1 }, uTurn: { value: 0 }, uWave: { value: 0 }, uTime: { value: 0 }, uBob: { value: BOB }, uPerPixel: { value: 0.001 } },
        transparent: true,
        depthWrite: false,
      }),
      pulse: pulseMaterial(),
    }
  }, [])
  useEffect(() => () => { for (const m of Object.values(materials)) m.dispose() }, [materials])

  // The initials' glyph per instance, the rings' geometry and the outline, sized to the capacity.
  const initialGeometry = useMemo(() => {
    const g = INITIAL_GEOMETRY.clone()
    g.setAttribute('aGlyph', new InstancedBufferAttribute(new Float32Array(capacity), 1))
    return g
  }, [capacity])
  const ringGeometry = useMemo(() => {
    const g = new InstancedBufferGeometry()
    // Its own copies: disposing a geometry frees its attributes' buffers, and a shared one would go with it.
    g.index = QUAD.index!.clone()
    g.setAttribute('position', QUAD.getAttribute('position').clone())
    g.setAttribute('uv', QUAD.getAttribute('uv').clone())
    const slots = capacity * RING_GLYPHS
    g.setAttribute('aCentre', new InstancedBufferAttribute(new Float32Array(slots * 3), 3))
    g.setAttribute('aWidth', new InstancedBufferAttribute(new Float32Array(slots), 1))
    g.setAttribute('aOpacity', new InstancedBufferAttribute(new Float32Array(slots), 1))
    g.setAttribute('aPhase', new InstancedBufferAttribute(new Float32Array(slots), 1))
    const angle = new Float32Array(slots)
    const rank = new Float32Array(slots)
    for (let s = 0; s < slots; s++) { angle[s] = ringAngle(s % RING_GLYPHS); rank[s] = ringRank(s % RING_GLYPHS) }
    g.setAttribute('aAngle', new InstancedBufferAttribute(angle, 1))
    g.setAttribute('aRank', new InstancedBufferAttribute(rank, 1))
    const glyph = new InstancedBufferAttribute(new Float32Array(slots), 1)
    glyph.setUsage(DynamicDrawUsage)
    g.setAttribute('aGlyph', glyph)
    g.instanceCount = 0
    return g
  }, [capacity])
  // Every letter's outline, in the scene's frame, written each frame the letters move.
  const lineGeometry = useMemo(() => liveOutlineGeometry(capacity * FOLD_SEGMENTS, true), [capacity])
  const lineObject = useMemo(() => {
    const l = liveOutlineLines(lineGeometry, materials.lines)
    l.name = 'letter-fold-lines'
    return l
  }, [lineGeometry, materials])
  useEffect(() => () => { initialGeometry.dispose(); ringGeometry.dispose(); lineGeometry.dispose() }, [initialGeometry, ringGeometry, lineGeometry])

  // The glyph atlas sent to the GPU again when the WebGL context comes back
  // or the page shows again: a phone that took the context while the app was
  // in the background gave back a blank ring until a reload (glyphAtlas).
  const gl = useThree((st) => st.gl)
  useEffect(() => {
    const canvas = gl?.domElement as HTMLCanvasElement | undefined
    const refresh = (): void => refreshGlyphAtlas()
    const shown = (): void => { if (typeof document !== 'undefined' && document.visibilityState === 'visible') refreshGlyphAtlas() }
    canvas?.addEventListener?.('webglcontextrestored', refresh)
    if (typeof document !== 'undefined') document.addEventListener?.('visibilitychange', shown)
    return () => {
      canvas?.removeEventListener?.('webglcontextrestored', refresh)
      if (typeof document !== 'undefined') document.removeEventListener?.('visibilitychange', shown)
    }
  }, [gl])

  // Which letters wear a whole seal and which a broken one, which pulse, and each ring's place and glyphs: rebuilt when the letters change.
  const layout = useMemo(() => {
    const unread: number[] = []
    const read: number[] = []
    const fresh: number[] = []
    // Each letter's place among the whole seals or the broken ones.
    const slot: number[] = []
    list.forEach((l, i) => {
      const to = l.broken ? read : unread
      slot.push(to.length)
      to.push(i)
      if (letterState(l) === 'new') fresh.push(i)
    })
    return { unread, read, fresh, slot }
  }, [list])
  /** Each letter's own starting angle, from its key, so a row of letters never turns or bobs in step. */
  const phases = useMemo(() => list.map((l) => (seedOf(l.key) / 4294967296) * Math.PI * 2), [list])
  // Each ring keeps its glyphs across a rebuild, so a letter added elsewhere does not reshuffle every ring.
  const glyphsOf = useRef(new Map<string, number[]>())

  // Before the frame is drawn, so no instance is ever drawn where it has not been placed.
  useLayoutEffect(() => {
    const colour = new Color()
    const lineColour = segmentColours(lineGeometry)
    list.forEach((l, i) => {
      colour.set(hiddenLook(letterState(l)).outline)
      for (let v = 0; v < FOLD_LINE_VERTS; v++) {
        const o = (i * FOLD_LINE_VERTS + v) * 3
        lineColour[o] = colour.r; lineColour[o + 1] = colour.g; lineColour[o + 2] = colour.b
      }
    })
    drawSegments(lineGeometry, list.length * FOLD_SEGMENTS, true)
    layout.unread.forEach((li, k) => whole.current?.setColorAt(k, colour.set(list[li].colour)))
    layout.read.forEach((li, k) => broken.current?.setColorAt(k, colour.set(list[li].colour)))
    const ig = initialGeometry.getAttribute('aGlyph') as InstancedBufferAttribute
    layout.unread.forEach((li, k) => { ig.setX(k, list[li].initial) })
    ig.needsUpdate = true
    for (const m of [whole.current, broken.current]) if (m?.instanceColor) m.instanceColor.needsUpdate = true
    if (paper.current) paper.current.count = list.length
    if (whole.current) whole.current.count = layout.unread.length
    if (initials.current) initials.current.count = layout.unread.length
    if (broken.current) broken.current.count = layout.read.length
    if (pulses.current) pulses.current.count = layout.fresh.length

    const centre = ringGeometry.getAttribute('aCentre') as InstancedBufferAttribute
    const width = ringGeometry.getAttribute('aWidth') as InstancedBufferAttribute
    const opacity = ringGeometry.getAttribute('aOpacity') as InstancedBufferAttribute
    const phase = ringGeometry.getAttribute('aPhase') as InstancedBufferAttribute
    const glyph = ringGeometry.getAttribute('aGlyph') as InstancedBufferAttribute
    const keep = new Map<string, number[]>()
    list.forEach((l, i) => {
      const glyphs = glyphsOf.current.get(l.key) ?? ringStart(l.key)
      keep.set(l.key, glyphs)
      const o = hiddenLook(letterState(l)).ringOpacity
      for (let g = 0; g < RING_GLYPHS; g++) {
        const s = i * RING_GLYPHS + g
        centre.setXYZ(s, l.centre[0], l.centre[1], l.centre[2])
        width.setX(s, l.width)
        opacity.setX(s, o)
        phase.setX(s, phases[i])
        glyph.setX(s, glyphs[g])
      }
    })
    glyphsOf.current = keep
    centre.needsUpdate = true
    width.needsUpdate = true
    opacity.needsUpdate = true
    phase.needsUpdate = true
    // The whole buffer, whatever stretch the last frame sent.
    glyph.clearUpdateRanges()
    glyph.needsUpdate = true
    ringGeometry.instanceCount = list.length * RING_GLYPHS
  }, [list, layout, phases, initialGeometry, ringGeometry, lineGeometry])

  // Per frame: each letter turning slowly about the up axis, tilted and bobbing; the ring's turn and wave; the pulses; a few glyphs changed.
  const scratch = useMemo(() => ({ m: new Matrix4(), q: new Quaternion(), spin: new Quaternion(), tilt: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), TILT), p: new Vector3(), s: new Vector3(), up: new Vector3(0, 1, 0), c: new Color(), pulse: { scale: 0, opacity: 0 } }), [])
  const rng = useRef<Rng>(mulberry32((Date.now() >>> 0) ^ 0x5eed))
  const carry = useRef(0)
  const last = useRef<number | null>(null)
  const still = useRef({ list: null as LetterSpec[] | null, reduced: false })
  useFrame((state) => {
    const cam = state.camera as PerspectiveCamera
    const t = state.clock.elapsedTime
    const { m, q, spin, tilt, p, s, up, c } = scratch
    sizeOutline(materials.lines, state.size)
    // With reduced motion nothing turns or bobs: the matrices change only with the letters,
    // and once when reduced motion is turned on, so every letter snaps square on rather than freezing mid-turn.
    const unchanged = reduced && still.current.reduced && still.current.list === list
    still.current.list = list
    still.current.reduced = reduced
    if (!unchanged) placeLetters()
    function placeLetters(): void {
      const pos = segmentPositions(lineGeometry)
      list.forEach((l, i) => {
        p.set(l.centre[0], l.centre[1], l.centre[2]).addScaledVector(up, bobAt(t, phases[i], reduced) * l.width)
        // Held still with reduced motion, every letter square on to the view's front, never edge on.
        q.copy(spin.setFromAxisAngle(up, turnAt(t, phases[i], reduced))).multiply(tilt)
        s.setScalar(l.width)
        m.compose(p, q, s)
        const e = m.elements
        const base = i * FOLD_LINE_VERTS * 3
        for (let k = 0; k < FOLD_LINE_VERTS * 3; k += 3) {
          const x = FOLD_LINES[k], y = FOLD_LINES[k + 1], z = FOLD_LINES[k + 2]
          pos[base + k] = e[0] * x + e[4] * y + e[8] * z + e[12]
          pos[base + k + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]
          pos[base + k + 2] = e[2] * x + e[6] * y + e[10] * z + e[14]
        }
        paper.current?.setMatrixAt(i, m)
        if (l.broken) broken.current?.setMatrixAt(layout.slot[i], m)
        else {
          whole.current?.setMatrixAt(layout.slot[i], m)
          initials.current?.setMatrixAt(layout.slot[i], m)
        }
      })
      for (const mesh of [paper.current, whole.current, broken.current, initials.current]) if (mesh) mesh.instanceMatrix.needsUpdate = true
      drawSegments(lineGeometry, list.length * FOLD_SEGMENTS)
    }

    // NEW letters' pulses: turned to the camera every frame, going out from the ring and fading.
    const pm = pulses.current
    if (pm && layout.fresh.length > 0) {
      for (let k = 0; k < layout.fresh.length; k++) {
        const li = layout.fresh[k]
        const l = list[li]
        const pulse = pulseAt(t, phases[li], reduced, scratch.pulse)
        p.set(l.centre[0], l.centre[1], l.centre[2]).addScaledVector(up, bobAt(t, phases[li], reduced) * l.width)
        s.setScalar(l.width * RING_REACH * pulse.scale)
        m.compose(p, cam.quaternion, s)
        pm.setMatrixAt(k, m)
        // Faded by its colour: the material is the ring colour, added over what is behind.
        pm.setColorAt(k, c.setScalar(pulse.opacity))
      }
      pm.instanceMatrix.needsUpdate = true
      if (pm.instanceColor) pm.instanceColor.needsUpdate = true
    }

    const u = materials.ring.uniforms
    u.uPerPixel.value = (2 * Math.tan((cam.fov * Math.PI) / 360)) / Math.max(1, state.size.height)
    if (reduced) { u.uTurn.value = 0; u.uWave.value = 0; u.uBob.value = 0; last.current = null; return }
    u.uBob.value = BOB
    u.uTime.value = t % BOB_S
    u.uTurn.value = ringTurnAt(t, false)
    u.uWave.value = wavePhaseAt(t, false)
    const dt = last.current === null ? 0 : t - last.current
    last.current = t
    const budget = changeBudget(list.length, dt, carry.current)
    carry.current = budget.carry
    if (budget.count === 0) return
    const glyph = ringGeometry.getAttribute('aGlyph') as InstancedBufferAttribute
    let lo = Infinity
    let hi = -1
    for (const ch of glyphChanges(rng.current, list.length * RING_GLYPHS, budget.count)) {
      glyph.setX(ch.slot, ch.glyph)
      lo = Math.min(lo, ch.slot)
      hi = Math.max(hi, ch.slot)
      const kept = glyphsOf.current.get(list[Math.floor(ch.slot / RING_GLYPHS)].key)
      if (kept) kept[ch.slot % RING_GLYPHS] = ch.glyph
    }
    // Only the stretch that changed goes to the GPU.
    glyph.clearUpdateRanges()
    if (hi >= lo) glyph.addUpdateRange(lo, hi - lo + 1)
    glyph.needsUpdate = true
  }, LABEL_PRIORITY)

  return (
    <group name="letters">
      <instancedMesh ref={paper} args={[PAPER_GEOMETRY, materials.paper, capacity]} frustumCulled={false} name="letter-paper" />
      <primitive object={lineObject} />
      <instancedMesh ref={whole} args={[SEAL_GEOMETRY, materials.seal, capacity]} frustumCulled={false} name="letter-seal" />
      <instancedMesh ref={broken} args={[BROKEN_GEOMETRY, materials.seal, capacity]} frustumCulled={false} name="letter-seal-broken" />
      <instancedMesh ref={initials} args={[initialGeometry, materials.initial, capacity]} frustumCulled={false} name="letter-initial" />
      <instancedMesh ref={pulses} args={[PULSE_GEOMETRY, materials.pulse, capacity]} frustumCulled={false} renderOrder={RING_ORDER} name="letter-pulses" />
      <mesh ref={ring} geometry={ringGeometry} material={materials.ring} frustumCulled={false} renderOrder={RING_ORDER} name="letter-rings" />
    </group>
  )
}
