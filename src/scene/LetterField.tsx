/**
 * LetterField.tsx: every hidden message in view, drawn as a sealed letter in
 * the world with a ring of glyphs orbiting it (owner, 2026-11-26: "in the
 * world: letter with glyph ring from concept 1. make the glyph ring's glyphs
 * randomly change to different characters. keep the ring spin effect ...
 * love the broken seal for read").
 *
 * A folded letter, one gibson wide (LETTER_GIBSONS, as the message's box it
 * replaces was one gibson cubed), turned to face the camera with a slight
 * tilt and a slow bob. On it a hexagonal seal in its author's colour
 * (lib/authorColour) bearing their initial: whole until this identity has
 * opened the message, broken in two after (store/useMessagesRead). Round it
 * the ring of direction 1, katakana, hex and block glyphs, turning once every
 * RING_TURN_S, a few of them changing to other glyphs every frame
 * (lib/glyphRing). With reduced motion the ring holds still, its glyphs
 * stay as they are and the letter does not bob.
 *
 * Built for a hall of letters: every letter is drawn by the same handful of
 * instanced meshes, so fifty letters cost what one does in draw calls. The
 * paper, its folds, the whole seals, the broken seals and the initials are
 * five instanced meshes sharing one matrix per letter, worked out on the CPU
 * each frame; the rings are one mesh of glyph quads placed and turned in the
 * vertex shader from each letter's centre, reading one shared glyph atlas
 * (scene/glyphAtlas). Far off a ring thins to every third glyph, and below
 * a fingertip on screen it is not drawn at all (lib/glyphRing ringShown).
 * Changing glyphs rewrites one small buffer, capped per frame.
 *
 * What each letter is comes from the NoteItem that stands for it in
 * WorldMessages (putLetter, dropLetter), which also holds its tap target and
 * its name. This draws; it takes no taps.
 *
 * The paper and the seals are opaque and out of the bloom (shardFaces
 * basicFaceProps: they show their own colour and write depth, as the
 * message's box did); the folds are thin lines of light; the glyphs blend
 * over what is behind without blooming, so a ring stays crisp.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  BufferGeometry,
  Color,
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
import { ACCENT } from '../lib/palette'
import { changeBudget, glyphChanges, mulberry32, ringAngle, ringRank, ringStart, RING_GLYPHS, RING_GLYPHS_FAR, RING_HIDE_PX, RING_THIN_PX, RING_TURN_S, type Rng } from '../lib/glyphRing'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { basicFaceProps, NO_BLOOM_BLEND, TAG_BLEND } from './shardFaces'
import { ATLAS_COLS, glyphAtlas } from './glyphAtlas'
import { LABEL_PRIORITY } from './WorldLabel'

/** A letter's width, in gibsons: the message's box was one gibson cubed, and the letter is as wide as that box. */
export const LETTER_GIBSONS = 1

/** The letter's height for a width of 1: direction 6's 150 by 98. */
export const LETTER_ASPECT = 98 / 150

/** The ring's radius and a glyph's size, for a letter 1 wide. */
export const RING_RADIUS = 0.74
export const GLYPH_SIZE = 0.18
/** How far the ring reaches across, for a letter 1 wide: what the name over it stands clear of. */
export const LETTER_REACH = 2 * (RING_RADIUS + GLYPH_SIZE / 2)

/** The tilt the letter hangs at, radians (direction 6's -6 degrees). */
const TILT = (-6 * Math.PI) / 180
/** The bob: its height for a letter 1 wide, and its period in seconds. */
const BOB = 0.035
const BOB_S = 5

/** The paper: a dark blue-black, so the folds and the seal read on it. */
export const PAPER = '#0b1824'
/** The folds of a letter not yet read, and of one read: bright, then quieter. */
export const FOLD_UNREAD = '#c8f5ff'
export const FOLD_READ = '#5d7a88'
/** The initial on a whole seal: near black, as pressed into wax. */
export const INITIAL_INK = '#140d03'

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
  /** Read: the seal is drawn broken. */
  broken: boolean
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
  if (was && was.width === spec.width && was.colour === spec.colour && was.initial === spec.initial && was.broken === spec.broken
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
function shapeOf(points: ReadonlyArray<readonly [number, number]>): ShapeGeometry {
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
function bandOf(points: ReadonlyArray<readonly [number, number]>, width: number, closed: boolean): BufferGeometry {
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
function merged(...parts: BufferGeometry[]): BufferGeometry {
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

/** Local depths, for a letter 1 wide: the paper, then the folds, the seal and the initial, each a hair nearer the eye. */
const Z_FOLD = 0.006
const Z_SEAL = 0.012
const Z_INITIAL = 0.018

const PAPER_GEOMETRY = shapeOf(PAPER_OUTLINE)
const FOLD_GEOMETRY = (() => {
  const g = merged(bandOf(PAPER_OUTLINE, 0.022, true), bandOf(FLAP, 0.016, false))
  g.translate(0, 0, Z_FOLD)
  return g
})()
const SEAL_GEOMETRY = (() => {
  const g = shapeOf(wholeSealPoints())
  g.translate(0, 0, Z_SEAL)
  return g
})()
const BROKEN_GEOMETRY = (() => {
  const [l, r] = brokenSealHalves()
  const g = merged(shapeOf(l), shapeOf(r))
  g.translate(0, 0, Z_SEAL)
  return g
})()
const INITIAL_GEOMETRY = (() => {
  const g = new PlaneGeometry(SEAL_RADIUS * 1.25, SEAL_RADIUS * 1.25)
  g.translate(SEAL_CENTRE[0], SEAL_CENTRE[1] - SEAL_RADIUS * 0.04, Z_INITIAL)
  return g
})()

// ---------- Shaders ----------

/** A glyph's cell in the atlas, from its index: shared by the ring and the initials. */
const ATLAS_UV = /* glsl */ `
  vec2 atlasUv(float glyph, vec2 uv) {
    float cols = ${ATLAS_COLS.toFixed(1)};
    float col = mod(glyph, cols);
    float row = floor(glyph / cols);
    // The canvas is flipped as it is uploaded: its top row is at v = 1.
    return vec2((col + uv.x) / cols, 1.0 - (row + 1.0 - uv.y) / cols);
  }
`

const RING_VERTEX = /* glsl */ `
  attribute vec3 aCentre;
  attribute float aWidth;
  attribute float aAngle;
  attribute float aGlyph;
  attribute float aRank;
  uniform float uTurn;
  uniform float uPerPixel;
  varying vec2 vUv;
  varying float vFade;
  ${ATLAS_UV}
  void main() {
    vec4 c = modelViewMatrix * vec4(aCentre, 1.0);
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
    // Each glyph stands on the ring, its foot toward the letter, as type set on a circle.
    float turn = a - 1.5707963;
    vec2 q = vec2(position.x * cos(turn) - position.y * sin(turn), position.x * sin(turn) + position.y * cos(turn));
    vec3 p = c.xyz + vec3(vec2(cos(a), sin(a)) * ${RING_RADIUS.toFixed(3)} * aWidth + q * ${GLYPH_SIZE.toFixed(3)} * aWidth, 0.0);
    gl_Position = projectionMatrix * vec4(p, 1.0);
    vUv = atlasUv(aGlyph, uv);
    // Fades in over the last few pixels before it is drawn at all.
    vFade = clamp((px - ${RING_HIDE_PX.toFixed(1)}) / 8.0, 0.0, 1.0);
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

/** The glyph ring's colour: the HUD's cyan, the colour of ciphertext everywhere in the app. */
const RING_COLOUR = ACCENT

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
  const folds = useRef<InstancedMesh>(null)
  const whole = useRef<InstancedMesh>(null)
  const broken = useRef<InstancedMesh>(null)
  const initials = useRef<InstancedMesh>(null)
  const ring = useRef<Mesh>(null)

  const materials = useMemo(() => {
    const atlas = glyphAtlas()
    const opaque = basicFaceProps(1, { ghost: false, world: true })
    return {
      paper: new MeshBasicMaterial({ color: PAPER, toneMapped: false, ...opaque, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 }),
      // Lines of light, as the box's edges were: they glow a little, and write no depth.
      folds: new MeshBasicMaterial({ color: '#ffffff', toneMapped: false, transparent: true, opacity: 0.9, depthWrite: false }),
      seal: new MeshBasicMaterial({ color: '#ffffff', toneMapped: false, ...opaque }),
      initial: new ShaderMaterial({
        vertexShader: INITIAL_VERTEX,
        fragmentShader: INITIAL_FRAGMENT,
        uniforms: { uAtlas: { value: atlas }, uColor: { value: new Color(INITIAL_INK) } },
        transparent: true,
        ...TAG_BLEND,
      }),
      ring: new ShaderMaterial({
        vertexShader: RING_VERTEX,
        fragmentShader: RING_FRAGMENT,
        uniforms: { uAtlas: { value: atlas }, uColor: { value: new Color(RING_COLOUR) }, uOpacity: { value: 0.95 }, uTurn: { value: 0 }, uPerPixel: { value: 0.001 } },
        transparent: true,
        depthWrite: false,
        ...NO_BLOOM_BLEND,
      }),
    }
  }, [])
  useEffect(() => () => { for (const m of Object.values(materials)) m.dispose() }, [materials])

  // The initials' glyph per instance, and the rings' geometry, sized to the capacity.
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
  useEffect(() => () => { initialGeometry.dispose(); ringGeometry.dispose() }, [initialGeometry, ringGeometry])

  // Which letters wear a whole seal and which a broken one, and each ring's place and glyphs: rebuilt when the letters change.
  const layout = useMemo(() => {
    const unread: number[] = []
    const read: number[] = []
    // Each letter's place among the whole seals or the broken ones.
    const slot: number[] = []
    list.forEach((l, i) => { const to = l.broken ? read : unread; slot.push(to.length); to.push(i) })
    return { unread, read, slot }
  }, [list])
  // Each ring keeps its glyphs across a rebuild, so a letter added elsewhere does not reshuffle every ring.
  const glyphsOf = useRef(new Map<string, number[]>())

  // Before the frame is drawn, so no instance is ever drawn where it has not been placed.
  useLayoutEffect(() => {
    const colour = new Color()
    const fold = (read: boolean): Color => colour.set(read ? FOLD_READ : FOLD_UNREAD)
    list.forEach((l, i) => folds.current?.setColorAt(i, fold(l.broken)))
    layout.unread.forEach((li, k) => whole.current?.setColorAt(k, colour.set(list[li].colour)))
    layout.read.forEach((li, k) => broken.current?.setColorAt(k, colour.set(list[li].colour)))
    const ig = initialGeometry.getAttribute('aGlyph') as InstancedBufferAttribute
    layout.unread.forEach((li, k) => { ig.setX(k, list[li].initial) })
    ig.needsUpdate = true
    for (const m of [folds.current, whole.current, broken.current]) if (m?.instanceColor) m.instanceColor.needsUpdate = true
    if (paper.current) paper.current.count = list.length
    if (folds.current) folds.current.count = list.length
    if (whole.current) whole.current.count = layout.unread.length
    if (initials.current) initials.current.count = layout.unread.length
    if (broken.current) broken.current.count = layout.read.length

    const centre = ringGeometry.getAttribute('aCentre') as InstancedBufferAttribute
    const width = ringGeometry.getAttribute('aWidth') as InstancedBufferAttribute
    const glyph = ringGeometry.getAttribute('aGlyph') as InstancedBufferAttribute
    const keep = new Map<string, number[]>()
    list.forEach((l, i) => {
      const glyphs = glyphsOf.current.get(l.key) ?? ringStart(l.key)
      keep.set(l.key, glyphs)
      for (let g = 0; g < RING_GLYPHS; g++) {
        const s = i * RING_GLYPHS + g
        centre.setXYZ(s, l.centre[0], l.centre[1], l.centre[2])
        width.setX(s, l.width)
        glyph.setX(s, glyphs[g])
      }
    })
    glyphsOf.current = keep
    centre.needsUpdate = true
    width.needsUpdate = true
    // The whole buffer, whatever stretch the last frame sent.
    glyph.clearUpdateRanges()
    glyph.needsUpdate = true
    ringGeometry.instanceCount = list.length * RING_GLYPHS
  }, [list, layout, initialGeometry, ringGeometry])

  // Per frame: each letter turned to the camera, tilted and bobbing; the ring's turn; a few glyphs changed.
  const scratch = useMemo(() => ({ m: new Matrix4(), q: new Quaternion(), tilt: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), TILT), p: new Vector3(), s: new Vector3(), up: new Vector3() }), [])
  const rng = useRef<Rng>(mulberry32((Date.now() >>> 0) ^ 0x5eed))
  const carry = useRef(0)
  const last = useRef<number | null>(null)
  // With reduced motion nothing bobs, so the matrices change only when the camera turns or the letters change.
  const still = useRef({ q: new Quaternion(), list: null as LetterSpec[] | null })
  useFrame((state) => {
    const cam = state.camera as PerspectiveCamera
    const t = state.clock.elapsedTime
    const { m, q, tilt, p, s, up } = scratch
    const unchanged = reduced && still.current.list === list && still.current.q.equals(cam.quaternion)
    still.current.list = list
    still.current.q.copy(cam.quaternion)
    if (!unchanged) placeLetters()
    function placeLetters(): void {
    q.copy(cam.quaternion).multiply(tilt)
    up.set(0, 1, 0).applyQuaternion(cam.quaternion)
    list.forEach((l, i) => {
      const bob = reduced ? 0 : Math.sin((t / BOB_S) * Math.PI * 2 + (i * 1.7)) * BOB * l.width
      p.set(l.centre[0], l.centre[1], l.centre[2]).addScaledVector(up, bob)
      s.setScalar(l.width)
      m.compose(p, q, s)
      paper.current?.setMatrixAt(i, m)
      folds.current?.setMatrixAt(i, m)
      if (l.broken) broken.current?.setMatrixAt(layout.slot[i], m)
      else {
        whole.current?.setMatrixAt(layout.slot[i], m)
        initials.current?.setMatrixAt(layout.slot[i], m)
      }
    })
    for (const mesh of [paper.current, folds.current, whole.current, broken.current, initials.current]) if (mesh) mesh.instanceMatrix.needsUpdate = true
    }

    const u = materials.ring.uniforms
    u.uPerPixel.value = (2 * Math.tan((cam.fov * Math.PI) / 360)) / Math.max(1, state.size.height)
    if (reduced) { last.current = null; return }
    u.uTurn.value = ((t % RING_TURN_S) / RING_TURN_S) * Math.PI * 2
    const dt = last.current === null ? 0 : t - last.current
    last.current = t
    const budget = changeBudget(list.length, dt, carry.current)
    carry.current = budget.carry
    if (budget.count === 0) return
    const glyph = ringGeometry.getAttribute('aGlyph') as InstancedBufferAttribute
    let lo = Infinity
    let hi = -1
    for (const c of glyphChanges(rng.current, list.length * RING_GLYPHS, budget.count)) {
      glyph.setX(c.slot, c.glyph)
      lo = Math.min(lo, c.slot)
      hi = Math.max(hi, c.slot)
      const kept = glyphsOf.current.get(list[Math.floor(c.slot / RING_GLYPHS)].key)
      if (kept) kept[c.slot % RING_GLYPHS] = c.glyph
    }
    // Only the stretch that changed goes to the GPU.
    glyph.clearUpdateRanges()
    if (hi >= lo) glyph.addUpdateRange(lo, hi - lo + 1)
    glyph.needsUpdate = true
  }, LABEL_PRIORITY)

  return (
    <group name="letters">
      <instancedMesh ref={paper} args={[PAPER_GEOMETRY, materials.paper, capacity]} frustumCulled={false} name="letter-paper" />
      <instancedMesh ref={folds} args={[FOLD_GEOMETRY, materials.folds, capacity]} frustumCulled={false} name="letter-folds" />
      <instancedMesh ref={whole} args={[SEAL_GEOMETRY, materials.seal, capacity]} frustumCulled={false} name="letter-seal" />
      <instancedMesh ref={broken} args={[BROKEN_GEOMETRY, materials.seal, capacity]} frustumCulled={false} name="letter-seal-broken" />
      <instancedMesh ref={initials} args={[initialGeometry, materials.initial, capacity]} frustumCulled={false} name="letter-initial" />
      <mesh ref={ring} geometry={ringGeometry} material={materials.ring} frustumCulled={false} renderOrder={RING_ORDER} name="letter-rings" />
    </group>
  )
}
