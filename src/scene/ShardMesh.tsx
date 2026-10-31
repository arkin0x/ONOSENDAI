/**
 * ShardMesh.tsx — a shard drawn in its mode, and how it arrives.
 *
 * SOLID draws the indexed triangles, LINES the vertex order as one line, and
 * every mode draws the vertices as points so a shard is visible at any size.
 * LINES draws every edge of every face once, so a shape reads as a wireframe;
 * with no faces there are no edges, and it falls back to one line through the
 * points in the order they were made.
 * The two geometries share one pair of attribute buffers.
 *
 * With a `birth`, the shard is one this client has just found, and it does not
 * simply appear: for SHARD_DECODE_MS its vertices sit scattered through the
 * volume the model occupies in cyan static, then settle into place and color
 * with an ease-out, jittering less as they land. Decryption made visible.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import {
  FrontSide,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  BoxGeometry,
  EdgesGeometry,
  Line,
  LineBasicMaterial,
  Matrix4,
  Vector3,
  type Plane,
} from 'three'
import { easeOutCubic, hash01, scrambleOffset, seedOf, SHARD_DECODE_MS } from '../lib/decode'
import { dissolveShare } from '../lib/ceremony'
import { MAX_UNIT, expandFaceColors, flatten, toRender, type Part, type Ref, type ShardModel } from 'sno-core/shards'
import { parseAddress, partMatrix, placedBounds, refKey, type Placed } from 'sno-core/parts'
import { useResolved, type Resolved } from '../lib/parts'
import { dropDemand, provisional, setDemand, useAllowance, type Allowance } from './meshBudget'
import { followsVersion, onFollows, trustedAuthor } from '../lib/trust'
import { ACCENT, WARN } from '../lib/palette'
import { renderPose, type Pose } from '../lib/pose'
import { boxContains, clipMesh, clipPoints, type Box } from '../lib/clip'
import { faceEdges } from 'sno-core/outline'
import { BACK_SHADE_COLOR, SHARD_FACES_TONE_MAPPED } from './shardLight'
import { SHARD_DOTS, SHARD_POINTS, createDiscMaterial, sizeDisc, withDiscColors } from './pointDisc'
import { DOTS_ORDER, basicFaceProps, benchOrders, lineProps, litFaceProps, shardOpacity, shardOrder } from './shardFaces'

import { HEADLAMP_FACES, HEADLAMP_LINES } from './headlamp'
import { holdPlaced, placedBuffers, type PlacedBuffers } from './placedBuffers'

export { FACE_TAG_STENCIL } from './shardFaces'

interface Props {
  shard: ShardModel
  /** Render units per model unit. */
  scale?: number
  /** Dimmed, for a preview that is not yet real. */
  ghost?: boolean
  /**
   * Lit, as on the bench: faces shaded flat by the canvas's ShardLights
   * (shardLight.tsx, anchored at the world's full color), each one's
   * front as its winding gives it (DECK-0003 §1.4) and its back painted darker,
   * so a face that looks the wrong way is plain to see and FLIP can turn it.
   * Nothing is guessed here: the winding is the author's. The world draws
   * unlit under its bloom instead.
   */
  lit?: boolean
  /**
   * Drawn in the world, under its bloom. The bloom adds a blurred copy of
   * everything lit back onto the frame, and across a filled face that is
   * several times the face's own colour, so faces came out white with a
   * tint. Out there the faces write their colour with alpha 0, a tag the
   * scene's bloom is blind to (Scene.tsx WorldBloom), so they draw at their
   * own colours, as on the bench; points and lines are untagged and glow as
   * they always did. Not for a ghost, whose translucency needs real alpha.
   */
  world?: boolean
  /**
   * Shaded by the world's headlamp (scene/headlamp.ts): faces darker as they
   * turn from the view, everything dimmer with distance, while the View
   * panel's switch is on. For whatever the main scene draws unlit: on with
   * `world`, and the placing ghost asks for it too. Never with `lit`, whose
   * bench lights do the same work.
   */
  headlamp?: boolean
  /** performance.now() when this client opened the shard; runs the decode. */
  birth?: number
  /**
   * performance.now() when the shard began to decode AWAY: the decode run
   * backwards and upward, every vertex lifting into cyan static over
   * DOOR_DISSOLVE_MS, for a door's slab sliding up out of its doorway
   * (scene/DoorCeremony). The caller fades the materials and unmounts it.
   */
  dissolve?: number
  /**
   * A tap on a SOLID face, with the shard's own index for it; the workshop's
   * FACE tool, through the face meshes' `faceOf` map (shardGeometry `drawn`).
   */
  onFaceClick?: (e: ThreeEvent<MouseEvent>, face: number) => void
  /**
   * The region the shard is sealed to, in this frame (lib/clip.ts regionBox).
   * What lies outside it is not drawn: faces are cut at the walls and points
   * beyond them dropped. Absent on the bench and for avatars, which are not
   * region-encrypted.
   */
  clip?: Box
  /**
   * Planes in world space to cut the faces, lines and points at, on the GPU,
   * for a shape that moves inside walls that do not (an item's model in
   * motion, scene/ItemModel.tsx): `clip` cuts the geometry once, where it
   * stands, and a turning shape would carry that cut round with it. The
   * caller keeps the planes current; the materials hold the same array.
   */
  clipPlanes?: Plane[]
  /**
   * The turn applied to every vertex before the render mapping (lib/pose.ts
   * placedPose). In the world it is always given, because it carries the
   * view frame: a shard standing on the Earth where it is hidden, bottom to
   * the ground and +Z to its spin, or one lying on cyberspace axes as it was
   * built, and either way turned to the compass's view. Absent on the bench
   * and for avatars, which are drawn in the render mapping as it is.
   */
  pose?: Pose
  /**
   * A placed object's own placements, already resolved by the parent's draw
   * (DECK-0003 §1.10). Given, this mesh is a part: it fetches nothing itself
   * and follows the chain the parent resolved, which is what bounds the depth
   * at four and makes a loop a placeholder.
   */
  nested?: Placed[]
  /** Drawn by a parent's placement: its geometry can be shared with every other placement of the object (placedBuffers.ts). */
  placed?: boolean
  /** A tap on a placed object, with its index in `parts`: the workshop's SELECT takes it whole. */
  onPartClick?: (e: ThreeEvent<MouseEvent>, part: number) => void
  /** Placements drawn with the selection's box around them. */
  selectedParts?: number[]
  /**
   * A shard in the world's scene, which draws its placed objects within the
   * scene's budget (scene/meshBudget.ts): its key, whether its author is
   * trusted (lib/trust.ts), and where it stands in the render frame, its
   * centre and scale, for nearest first. Absent everywhere else.
   */
  budget?: { key: string; trusted: boolean; centre: [number, number, number]; scale: number }
  /**
   * Fronts only, for an avatar seen from inside it (WALK's first person):
   * the faces' backs are culled, so what sticks out of the body still shows
   * and the inside of its own walls does not. The points and lines are not
   * drawn at all then, having no back to cull. The world otherwise draws
   * both sides of an unlit face.
   */
  cull?: boolean
  /**
   * Draw it opaque whatever its own `opacity` says: an avatar (DECK-0003
   * §3.3). Proof of work prices an avatar's size and detail, not how hard it
   * is to see, and a near-invisible body is a stealth tool. Carried to its
   * placed objects too, so no part of an avatar is see-through either.
   */
  ignoreOpacity?: boolean
}

const STATIC = [0, 0.9, 1] as const

/** Whether two lists hold the same numbers, in the same order. */
export function sameNumbers(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/**
 * The list last handed over while the new one holds the same numbers, so what
 * is keyed on it stands. The numbers are read at most once per change of the
 * model, and that is far less than what it saves: painting a face changes no
 * position and no triangle, and rebuilt, it was five new geometries and their
 * GPU buffers per paint.
 */
/**
 * What the position and color attributes live and die by. Every geometry a
 * shard draws shares them, and disposing a geometry makes three delete the GL
 * buffer of each attribute it holds, even one another geometry still uses. That
 * geometry's vertex array goes on reading the deleted buffer, while three writes
 * to a new one: a paint changes the store and the buffer and nothing on screen
 * (SOLID, LINES, SOLID, then paint: review of #562). So they are made again
 * whenever any geometry using them is: the points, the triangles (a FLIP), the
 * mode (the wireframe) and `lit` (the insides). A paint changes none of these.
 */
export function sharedBufferDeps(positions: ArrayLike<number>, colorCount: number, index: ArrayLike<number>, mode: string, lit: boolean): unknown[] {
  return [positions, colorCount, index, mode, lit]
}

function useSame<T extends ArrayLike<number>>(next: T): T {
  const held = useRef(next)
  if (!sameNumbers(held.current, next)) held.current = next
  return held.current
}

/**
 * What a shard draws: its points in the render mapping, and every one of its
 * faces (DECK-0003 §1.4: a reader draws them all, both sides, whatever their
 * winding). `drawn` maps each drawn triangle to the shard's own face: the
 * identity, since every face is drawn and faces are triangles, kept so a
 * tap still lands on the right face if anything is ever left out again. On
 * the clip path it maps the cut pieces to themselves, so a clipped shard's
 * piece is not a face; nothing that clips takes taps.
 *
 * The bench once left out the faces sno-core's outward guess called buried
 * inside a join, by counting what rays from each face's middle crossed. That
 * count only holds for one closed solid, and a shard is seldom one: arkinox's
 * Stair run lost one triangle of each of risers 2 and 3, three whole risers
 * above them, and every face FILLed in such a spot was added and never seen
 * (2026-10-23). Every face is drawn now, on the bench as in the world.
 *
 * Cropped to its region (`clip`), the faces are cut at the walls, and the
 * points that are left are the vertices of the cut faces, or, for a shard
 * with no faces, its own points inside the walls.
 */
export function shardGeometry(shard: ShardModel, clip?: Box, pose?: Pose): { positions: Float32Array; colors: Float32Array; index: number[]; faces: number[][]; drawn: number[] } {
  const f = flatten(shard, pose)
  if (!clip || boxContains(clip, f.positions)) return { ...f, faces: shard.faces as number[][], drawn: shard.faces.map((_, i) => i) }
  if (shard.faces.length === 0) {
    const pts = clipPoints(f.positions, f.colors, clip)
    return { positions: pts.positions, colors: pts.colors, index: [] as number[], faces: [] as number[][], drawn: [] as number[] }
  }
  const cut = clipMesh(f, clip)
  const faces: number[][] = []
  for (let t = 0; t + 2 < cut.index.length; t += 3) faces.push([cut.index[t], cut.index[t + 1], cut.index[t + 2]])
  return { ...cut, faces, drawn: faces.map((_, i) => i) }
}

/** A shard's points and lines: one vertex each, with the colours again under the name the disc shader reads (scene/pointDisc). */
function plainGeometry(posAttr: BufferAttribute, colAttr: BufferAttribute): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', posAttr)
  g.setAttribute('color', colAttr)
  return withDiscColors(g, colAttr)
}

/** A shard's faces. */
function indexedGeometry(posAttr: BufferAttribute, colAttr: BufferAttribute, index: number[]): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', posAttr)
  g.setAttribute('color', colAttr)
  g.setIndex(index)
  g.computeVertexNormals()
  return g
}

/** The same triangles wound the other way: the insides, for a lit draw. */
function insideGeometry(posAttr: BufferAttribute, colAttr: BufferAttribute, index: number[]): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', posAttr)
  g.setAttribute('color', colAttr)
  const flipped: number[] = []
  for (let i = 0; i + 2 < index.length; i += 3) flipped.push(index[i], index[i + 2], index[i + 1])
  g.setIndex(flipped)
  return g
}

/** LINES mode: every edge of every face, once. Null with no edges to draw. */
function outlineGeometry(posAttr: BufferAttribute, colAttr: BufferAttribute, faces: number[][]): BufferGeometry | null {
  if (faces.length === 0) return null
  const idx = faceEdges(faces)
  if (idx.length === 0) return null
  const g = new BufferGeometry()
  g.setAttribute('position', posAttr)
  g.setAttribute('color', colAttr)
  g.setIndex(idx)
  return g
}

/** One object's buffers, for all its placements (placedBuffers.ts): no decode writes to them, so no second copy of any array. */
function buildPlaced(model: ShardModel): PlacedBuffers<ShardModel> {
  const shard = expandFaceColors(model)
  const { positions, colors, index, faces, drawn } = shardGeometry(shard)
  const posAttr = new BufferAttribute(positions, 3)
  const colAttr = new BufferAttribute(colors, 3)
  const plain = plainGeometry(posAttr, colAttr)
  const indexed = indexedGeometry(posAttr, colAttr, index)
  const outline = outlineGeometry(posAttr, colAttr, faces)
  let inside: BufferGeometry | null = null
  return {
    shard, positions, colors, index, faces, drawn, plain, indexed, outline,
    inside: () => (inside ??= insideGeometry(posAttr, colAttr, index)),
    geometries: () => [plain, indexed, ...(outline ? [outline] : []), ...(inside ? [inside] : [])],
  }
}

/**
 * The shard's own face index for a ray's hit on either side of a face, or
 * null for a hit on anything else. Both face meshes carry `faceOf`, the map
 * from a drawn triangle to its face (shardGeometry `drawn`). A face must answer a tap
 * from behind as well as from in front; each mesh is hit only on the
 * triangles that face the ray, so the outsides alone let a tap pass through
 * a face seen from behind to the next front beyond it (arkinox's Disco
 * Floor, 2026-09-25).
 */
export function faceOfHit(i: { object: { userData: { faceOf?: number[] } }; faceIndex?: number | null }): number | null {
  const map = i.object.userData.faceOf
  const k = i.faceIndex
  return map && k != null && map[k] !== undefined ? map[k] : null
}

export function ShardMesh({ shard: given, scale = 1, ghost = false, birth, dissolve, onFaceClick, world = false, headlamp = world, lit = false, clip, clipPlanes, pose, nested, placed = false, onPartClick, selectedParts, cull = false, ignoreOpacity = false, budget }: Props): JSX.Element | null {
  // What everything below is drawn at: the object's own opacity (DECK-0003
  // §1.11, with its 10% floor), times a ghost's; an avatar ignores its own.
  // A placed object reaches here with its own model, so it never takes its
  // parent's (§1.10). See shardFaces.ts for how see-through faces blend.
  const opacity = shardOpacity(given, { ghost, ignoreOpacity })
  // This shard's own share, without a ghost's, written on each of its own
  // materials for whatever animates them by material (WorldShards' EDIT
  // breath), which reaches placed parts too and must not give them ours.
  // Set as one key (R3F's pierced `userData-share`), never by replacing
  // userData: TV keeps its own state there (TvFinds lookOne).
  const own = shardOpacity(given, { ignoreOpacity })
  const order = shardOrder(opacity, ghost)
  const bench = benchOrders(opacity, ghost)
  // The objects this one places, fetched once for the whole app; a part's own
  // parts come resolved from its parent instead. In the world's scene, what it
  // reads is charged to the read pool of its trust (lib/readPools.ts).
  const resolved = useResolved(nested ? null : given, budget ? (budget.trusted ? 'trusted' : 'stranger') : undefined)
  // In the world's scene: what its placed objects would draw, at every depth,
  // said to the scene's budget, and how many it may (scene/meshBudget.ts).
  // Split by which share pays for each object, as WALK's walls charge
  // (lib/trust.ts chargeByTrust): a stranger's object placed by a shard of
  // yours, and everything under it, is the strangers' to pay for.
  const trusted = budget?.trusted ?? false
  const follows = useSyncExternalStore(onFollows, followsVersion)
  const split = useMemo(() => {
    if (!budget || nested) return { trusted: 0, stranger: 0 }
    let t = 0, n = 0
    for (const [a, b] of placementSplits(given, resolved, trusted)) { t += a; n += b }
    return { trusted: t, stranger: n }
    // `follows` changes whom a shard trusts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [budget, nested, given, resolved, trusted, follows])
  const budgetKey = budget && !nested ? budget.key : undefined
  // Coarsely, in eighths of a doubling: a step of the anchor moves every
  // shard's centre a little, and a shard says so only when it has moved a
  // good way nearer or farther, not on every step.
  const distance = budget ? Math.round(Math.log2(1 + Math.hypot(...budget.centre)) * 8) / 8 : 0
  useLayoutEffect(() => {
    if (!budgetKey) return
    setDemand(budgetKey, { trusted: split.trusted, stranger: split.stranger, distance })
  }, [budgetKey, split, distance])
  useLayoutEffect(() => (budgetKey ? () => dropDemand(budgetKey) : undefined), [budgetKey])
  // Before its first allocation lands (later in the same task), what is left
  // of its pool, so its first frame is not an outline.
  const allocated = useAllowance(budgetKey)
  const allowance = budgetKey ? allocated ?? provisional({ trusted: split.trusted, stranger: split.stranger, distance }) : undefined
  const near = useMemo(() => (budget ? { centre: budget.centre, scale: budget.scale, pose } : undefined), [budget, pose])
  // A face that carries its own colour needs three corners of its own, or the
  // colour would bleed across every edge it shares. Expanded here and nowhere
  // else, so the clipper and the face picker below never learn the feature
  // exists.
  // A placed object that does nothing of its own shares one set of buffers with
  // every other placement of it (placedBuffers.ts). Decoding or dissolving writes
  // to its vertices, and a clip or a pose changes them, so those keep their own.
  const sharing = placed && !clip && !pose && birth === undefined && dissolve === undefined
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shared = useMemo(() => (sharing ? placedBuffers(given, () => buildPlaced(given)) : null), [sharing, given])
  useEffect(() => (shared ? holdPlaced(given, shared as PlacedBuffers<unknown>) : undefined), [shared, given])
  const shard = useMemo(() => shared?.shard ?? expandFaceColors(given), [given, shared])
  // Keyed on the points and faces rather than the whole model, so a parent
  // that hands over a fresh copy of the same shard does not rebuild it
  // (unless it has face colours: the expansion above makes new arrays).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const built = useMemo(() => shared ?? shardGeometry(shard, clip, pose), [shared, shard.vertices, shard.faces, clip, pose])
  const { colors, faces, drawn } = built
  const positions = useSame(built.positions)
  const index = useSame(built.index)

  // Live copies: the decode writes into these, the targets stay untouched. A
  // placement sharing its object's buffers has none of its own.
  // Made again with the geometries that share them (sharedBufferDeps), and not
  // for a paint: new colors on the same corners go into the buffer that is
  // there, once, below.
  const buffers = sharedBufferDeps(positions, colors.length, index, shard.mode, lit)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const posAttr = useMemo(() => (shared ? null : new Float32BufferAttribute(positions.slice(), 3)), [...buffers, shared])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const colAttr = useMemo(() => (shared ? null : new Float32BufferAttribute(colors.slice(), 3)), [...buffers, shared])
  const invalidate = useThree((s) => s.invalidate)
  useLayoutEffect(() => {
    if (!colAttr) return
    const a = colAttr.array as Float32Array
    if (sameNumbers(a, colors)) return
    a.set(colors)
    colAttr.needsUpdate = true
    // Nothing R3F set has changed, so it would not know to draw on a canvas that draws on demand.
    invalidate()
  }, [colAttr, colors, invalidate])

  const plain = useMemo(() => shared?.plain ?? plainGeometry(posAttr!, colAttr!), [posAttr, colAttr, shared])

  const indexed = useMemo(() => shared?.indexed ?? indexedGeometry(posAttr!, colAttr!, index), [posAttr, colAttr, index, shared])

  // The inside of every face as a front face of its own: the same triangles
  // wound the other way. Flat shading takes a face's normal from the screen,
  // and a back face's points away from the viewer, so drawn as back faces the
  // insides could only ever be ambient; drawn as front faces they take the
  // lights like the outsides do.
  const inside = useMemo(() => {
    if (!lit) return null
    return shared ? shared.inside() : insideGeometry(posAttr!, colAttr!, index)
  }, [posAttr, colAttr, index, lit, shared])

  // The points, drawn as the terrain field draws its gibsons: a feathered disc
  // with a bright core for the bloom, sized in pixels between a floor and a cap.
  const pointMaterial = useMemo(() => {
    return createDiscMaterial(shard.mode === 'points' ? SHARD_POINTS : SHARD_DOTS, shard.mode === 'points' ? opacity : opacity * 0.55, headlamp && !lit)
  }, [shard.mode, opacity, headlamp, lit])
  useEffect(() => () => pointMaterial.dispose(), [pointMaterial])
  useEffect(() => { pointMaterial.clippingPlanes = clipPlanes ?? null }, [pointMaterial, clipPlanes])

  /**
   * LINES mode: every edge of every face, each drawn once.
   *
   * Built from the shard's own faces rather than the triangulated index, so a
   * polygon shows its outline and not the diagonals its triangles were cut
   * along, and an edge two faces share is drawn once rather than twice.
   */
  const outline = useMemo(() => {
    if (shared) return shared.outline
    if (shard.mode !== 'lines') return null
    return outlineGeometry(posAttr!, colAttr!, faces)
    // Keyed on the triangle list, the steady twin of `faces`: a paint that leaves it alone keeps the outline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posAttr, colAttr, index, shard.mode, shared])

  useEffect(() => (shared ? undefined : () => { outline?.dispose() }), [outline, shared])

  const line = useMemo(() => {
    const m = new LineBasicMaterial({ vertexColors: true, toneMapped: false, ...lineProps(opacity, ghost) })
    if (headlamp && !lit) Object.assign(m, HEADLAMP_LINES)
    const l = new Line(plain, m)
    l.frustumCulled = false
    l.renderOrder = shardOrder(opacity, ghost)
    l.material.userData.share = own
    return l
  }, [plain, opacity, ghost, own, headlamp, lit])

  // A rebuild replaces these; nothing else lets the GPU buffers go. The line
  // is a primitive, which R3F never disposes, so its material is ours too.
  useEffect(() => (shared ? undefined : () => { plain.dispose() }), [plain, shared])
  useEffect(() => (shared ? undefined : () => { indexed.dispose() }), [indexed, shared])
  useEffect(() => (shared ? undefined : () => { inside?.dispose() }), [inside, shared])
  useEffect(() => () => { line.material.dispose() }, [line])
  useEffect(() => { (line.material as LineBasicMaterial).clippingPlanes = clipPlanes ?? null }, [line, clipPlanes])
  // Spread into each JSX material: nothing at all when there are no planes, so those materials are as they were.
  const cut = clipPlanes ? { clippingPlanes: clipPlanes } : {}
  // The same two functions on every world face and every world line: one program each (scene/headlamp.ts).
  const lampFaces = headlamp ? HEADLAMP_FACES : {}
  const lampLines = headlamp && !lit ? HEADLAMP_LINES : {}

  // The scrambled start: each vertex thrown somewhere in the model's extent.
  const noise = useMemo(() => {
    if (birth === undefined) return null
    const seed = seedOf(shard.id)
    let extent = 1
    for (let i = 0; i < positions.length; i++) extent = Math.max(extent, Math.abs(positions[i]))
    const pos = new Float32Array(positions.length)
    const col = new Float32Array(colors.length)
    for (let v = 0; v < positions.length / 3; v++) {
      const o = scrambleOffset(v, seed, extent)
      pos[v * 3] = positions[v * 3] + o[0]
      pos[v * 3 + 1] = positions[v * 3 + 1] + o[1]
      pos[v * 3 + 2] = positions[v * 3 + 2] + o[2]
      const b = 0.35 + 0.65 * hash01(v * 5, seed)
      col[v * 3] = STATIC[0] * b
      col[v * 3 + 1] = STATIC[1] * b
      col[v * 3 + 2] = STATIC[2] * b
    }
    return { pos, col, extent, seed }
  }, [birth, positions, colors, shard.id])

  // Going away: each vertex's own scatter and lift, and its static brightness.
  // Made once, not per vertex per frame: the decode runs every frame for DOOR_DISSOLVE_MS.
  const away = useMemo(() => {
    if (dissolve === undefined) return null
    const seed = seedOf(shard.id) ^ 0x5bd1e995
    let extent = 1
    for (let i = 0; i < positions.length; i++) extent = Math.max(extent, Math.abs(positions[i]))
    const n = positions.length / 3
    const scatter = new Float32Array(n * 3)
    const lift = new Float32Array(n)
    const shade = new Float32Array(n)
    for (let v = 0; v < n; v++) {
      // A little scatter, never enough to stretch a face across the room.
      const o = scrambleOffset(v, seed, extent * 0.06)
      scatter[v * 3] = o[0]
      scatter[v * 3 + 1] = Math.abs(o[1])
      scatter[v * 3 + 2] = o[2]
      // Upward first and most: the slab slides up into the lintel as it goes.
      lift[v] = extent * (0.25 + 0.45 * hash01(v * 7, seed))
      shade[v] = 0.35 + 0.65 * hash01(v * 5, seed)
    }
    return { seed, extent, scatter, lift, shade }
  }, [dissolve, positions, shard.id])

  const done = useRef(false)
  const frame = useRef(0)

  useFrame((state) => {
    // The disc is sized in pixels, so it needs the canvas it is drawn on.
    sizeDisc(pointMaterial, state.gl.getPixelRatio(), state.size.height)
    if (dissolve !== undefined && away !== null) {
      if (done.current) return
      const t = dissolveShare(performance.now() - dissolve)
      const e = t * t
      frame.current++
      // Dissolving never shares (see `sharing`), so these are its own.
      const p = posAttr!.array as Float32Array
      const c = colAttr!.array as Float32Array
      const n = p.length / 3
      const toStatic = Math.min(1, t * 2.5)
      for (let v = 0; v < n; v++) {
        const j = t > 0 && t < 1 ? (hash01(v * 13 + frame.current, away.seed) - 0.5) * 0.04 * away.extent * t : 0
        p[v * 3] = positions[v * 3] + away.scatter[v * 3] * e + j
        p[v * 3 + 1] = positions[v * 3 + 1] + away.scatter[v * 3 + 1] * e + away.lift[v] * e + j
        p[v * 3 + 2] = positions[v * 3 + 2] + away.scatter[v * 3 + 2] * e + j
        const b = away.shade[v]
        for (let k = 0; k < 3; k++) c[v * 3 + k] = colors[v * 3 + k] + (STATIC[k] * b - colors[v * 3 + k]) * toStatic
      }
      posAttr!.needsUpdate = true
      colAttr!.needsUpdate = true
      if (t >= 1) done.current = true
      return
    }
    if (birth === undefined || noise === null || done.current) return
    const t = Math.min(1, (performance.now() - birth) / SHARD_DECODE_MS)
    const e = easeOutCubic(t)
    const jitter = (1 - t) ** 2 * 0.12 * noise.extent
    frame.current++
    // Decoding never shares either.
    const p = posAttr!.array as Float32Array
    const c = colAttr!.array as Float32Array
    for (let i = 0; i < p.length; i++) {
      const j = t < 1 ? (hash01(i * 13 + frame.current, noise.seed) - 0.5) * jitter : 0
      p[i] = noise.pos[i] + (positions[i] - noise.pos[i]) * e + j
      c[i] = noise.col[i] + (colors[i] - noise.col[i]) * e
    }
    posAttr!.needsUpdate = true
    colAttr!.needsUpdate = true
    if (t >= 1) done.current = true
  })

  const placements = (given.parts?.length ?? 0) > 0
    ? <Placements shard={given} byRef={resolved} nested={nested} lit={lit} ghost={ghost} world={world} headlamp={headlamp} pose={pose} onPartClick={onPartClick} selected={selectedParts} cull={cull} ignoreOpacity={ignoreOpacity} allowance={allowance} near={near} rootTrusted={trusted} />
    : null
  // An object may be nothing but the arrangement of others (§1.9 rule 13).
  if (shard.vertices.length === 0) return placements ? <group scale={scale}>{placements}</group> : null
  // The nearest hit is on whichever side faces the tap; it answers and stops it there.
  const pick = { userData: { faceOf: drawn }, ...(onFaceClick ? { onClick: (e: ThreeEvent<MouseEvent>) => { const f = faceOfHit(e); if (f !== null) onFaceClick(e, f) } } : {}) }

  return (
    <group scale={scale}>
      {placements}
      {shard.mode === 'solid' && index.length > 0 && (
        <group>
          <mesh name="shard-faces" geometry={indexed} frustumCulled={false} renderOrder={lit ? bench.front : order} {...pick}>
            {/* forceSinglePass: three draws a transparent DoubleSide material
                in two passes, back then front, and to do it flips the side
                and sets needsUpdate twice per object per frame. Each flip is
                a shader program lookup that allocates (getParameters, a
                cache key join): ~106 KB of garbage a frame with 150 shards
                around, which a 144 Hz desktop turns into about a gigabyte a
                minute, and twice the draw calls. These faces write depth at
                opacity 1, so one pass draws the same picture, and a
                see-through shard (its own opacity) keeps one pass too: one
                colour blends the same in either order. Ghosts (0.45) keep the
                two passes for cleaner self-overlap: there are few
                (arkinox's 10 GB Windows tabs, 2026-10-14). The props are
                basicFaceProps (shardFaces.ts), which sets forceSinglePass. */}
            {lit
              ? <meshLambertMaterial vertexColors flatShading side={FrontSide} toneMapped={SHARD_FACES_TONE_MAPPED} {...litFaceProps(opacity, ghost)} userData-share={own} {...cut} />
              // `transparent forceSinglePass` repeat basicFaceProps so singlePass.test.ts's source scan sees this material.
              // lampFaces: opaque and see-through alike (the headlamp scales rgb only, so it composes with either blend).
              : <meshBasicMaterial vertexColors side={cull ? FrontSide : DoubleSide} toneMapped={SHARD_FACES_TONE_MAPPED} transparent forceSinglePass={!ghost} {...basicFaceProps(opacity, { ghost, world })} {...lampFaces} userData-share={own} {...cut} />}
          </mesh>
          {lit && inside && (
            <mesh geometry={inside} frustumCulled={false} renderOrder={bench.inside} {...pick}>
              {/* The inside of a face: lit like the outside, darker by a multiplier so it still reads as inside.
                  The multiplier and the light are shardLight's (arkinox, 2026-10-12). */}
              <meshLambertMaterial vertexColors flatShading color={BACK_SHADE_COLOR} side={FrontSide} toneMapped={SHARD_FACES_TONE_MAPPED} {...litFaceProps(opacity, ghost)} userData-share={own} {...cut} />
            </mesh>
          )}
        </group>
      )}
      {/* Faces as outlines. A shard with no faces has no edges to draw, so it
          keeps the old single line through its points, which is all there is. */}
      {/* Seen from inside (cull, WALK's first person) only the faces' fronts
          are drawn. The points and lines have no back to cull: every vertex
          dot and edge of your own body would sit across the view, which is
          what arkinox still saw with the backs culled (2026-10-13). */}
      {shard.mode === 'lines' && outline && !cull && (
        <lineSegments geometry={outline} frustumCulled={false} renderOrder={order}>
          <lineBasicMaterial vertexColors toneMapped={false} {...lineProps(opacity, ghost)} {...lampLines} userData-share={own} {...cut} />
        </lineSegments>
      )}
      {shard.mode === 'lines' && !outline && !cull && shard.vertices.length > 1 && <primitive object={line} />}
      {!cull && (shard.mode === 'points' || shard.mode === 'solid' || shard.mode === 'lines') && (
        <points geometry={plain} material={pointMaterial} frustumCulled={false} renderOrder={DOTS_ORDER} />
      )}
    </group>
  )
}

/** A unit cube's twelve edges, centred on the origin: the placeholder (§1.10). */
export const CUBE_EDGES = new EdgesGeometry(new BoxGeometry(1, 1, 1))

/**
 * Each placed object where its placement stands, or a placeholder there: a
 * wireframe cube one unit on a side in the accent, for anything not fetched,
 * not valid, too deep, a loop, or scaled out of range (§1.10). Nothing is
 * drawn for a reference still being fetched, so opening an object does not
 * flash cubes before its parts arrive. Parts are not clipped to the region:
 * a hidden object's parts are its author's to place.
 */
/** How faint the outline round what the scene's budget cut is drawn. */
const CUT_OPACITY = 0.35

/** One placement as Placements draws it: where it stands, and what it resolved to (undefined while it is fetched). */
type Listed = { part: Part; r: Resolved | undefined; ref?: Ref }

/** A shard's placements as listed for drawing: its own `parts`, each with its reference and what that resolved to. */
function listOf(shard: ShardModel, byRef: Map<string, Resolved>, nested?: Placed[]): Listed[] {
  return nested
    ? nested.map((p) => ({ part: p.part, r: p, ref: p.ref }))
    : (shard.parts ?? []).map((part) => {
      const ref = shard.refs?.[part.ref]
      return { part, r: ref ? byRef.get(refKey(ref)) : undefined, ...(ref ? { ref } : {}) }
    })
}

/** Whether the object a reference places is by you or someone you follow: an `e`, whose author is not known, is not. */
function refTrusted(ref: Ref | undefined): boolean {
  const a = ref && ref[0] === 'a' ? parseAddress(ref[1]) : null
  return !!a && trustedAuthor(a.pubkey)
}

/**
 * A resolved placement's objects split by which share pays for them, [trusted,
 * stranger]: the placement and everything under it is trusted while it, and
 * every placement above it, places an object by you or someone you follow; from
 * the first that does not, all of it is the strangers'. Once per resolved
 * object, whom you follow and whether its parent was trusted.
 */
const splits = new WeakMap<object, Map<string, [number, number]>>()
function treeSplit(r: Pick<Resolved, 'model' | 'children'> | undefined, ref: Ref | undefined, parentTrusted: boolean): [number, number] {
  const charged = parentTrusted && refTrusted(ref)
  if (!charged) return [0, treeSize(r)]
  if (!r || !r.model) return [1, 0]
  const key = `${followsVersion()}`
  let byKey = splits.get(r)
  if (!byKey) splits.set(r, (byKey = new Map()))
  let got = byKey.get(key)
  if (!got) {
    got = [1, 0]
    for (const c of r.children) { const [a, b] = treeSplit(c, c.ref, true); got[0] += a; got[1] += b }
    byKey.set(key, got)
  }
  return got
}

/** What each of a shard's root placements draws, split by which share pays ([trusted, stranger]), for a shard trusted or not. */
export function placementSplits(shard: ShardModel, byRef: Map<string, Resolved>, rootTrusted: boolean): Array<[number, number]> {
  return listOf(shard, byRef).map(({ r, ref }) => treeSplit(r, ref, rootTrusted))
}

/** How many placed objects a resolved placement draws, itself and everything under it; once per resolved object. */
const sizes = new WeakMap<object, number>()
function treeSize(r: Pick<Resolved, 'model' | 'children'> | undefined): number {
  if (!r || !r.model) return 1
  let n = sizes.get(r)
  if (n === undefined) {
    n = 1
    for (const c of r.children) n += treeSize(c)
    sizes.set(r, n)
  }
  return n
}

/** What each of a shard's root placements draws, as Placements lists them. */
export function placementSizes(shard: ShardModel, byRef: Map<string, Resolved>): number[] {
  return listOf(shard, byRef).map(({ r }) => treeSize(r))
}

/** Where a shard stands in the render frame: its centre, its scale, and its pose (turned in the view frame, or on the Earth). */
export interface Near { centre: [number, number, number]; scale: number; pose?: Pose }

/**
 * Which of `list` to draw within `allowance` placed objects, nearest the anchor
 * first: each placement whole or not at all, at the place its origin stands in
 * the render frame, through the shard's pose, scale and centre (`near`). Null
 * for all of them.
 */
export function budgeted(list: readonly Listed[], allowance: Allowance | undefined, near?: Near, rootTrusted = false): Set<number> | null {
  if (allowance === undefined) return null
  const each = list.map(({ r, ref }) => treeSplit(r, ref, rootTrusted))
  let wantT = 0, wantS = 0
  for (const [a, b] of each) { wantT += a; wantS += b }
  if (wantT <= allowance.trusted && wantS <= allowance.stranger) return null
  // Each distance once, before the sort.
  const turn = near?.pose ? renderPose(near.pose) : null
  const c = near?.centre ?? [0, 0, 0], k = near?.scale ?? 1
  const v = new Vector3()
  const far = list.map(({ part }) => {
    v.fromArray(toRender(part.at))
    if (turn) v.applyMatrix4(turn)
    return Math.hypot(c[0] + v.x * k, c[1] + v.y * k, c[2] + v.z * k)
  })
  const order = list.map((_, i) => i).sort((a, b) => far[a] - far[b])
  // Each placement whole, while both of its parts fit what is left of each.
  const keep = new Set<number>()
  let t = allowance.trusted, n = allowance.stranger
  for (const i of order) {
    const [a, b] = each[i]
    if (a > t || b > n) continue
    t -= a
    n -= b
    keep.add(i)
  }
  return keep
}

/** The bounds of what a resolved placement draws, in its own frame; once per resolved object. */
const bounds = new WeakMap<object, { min: number[]; max: number[] }>()
function boundsOf(r: Resolved | undefined): { min: number[]; max: number[] } {
  if (!r?.model) return { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] }
  let b = bounds.get(r)
  if (!b) bounds.set(r, (b = placedBounds(r.model, r.children) ?? { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] }))
  return b
}

/**
 * The placements drawn only as the shard's one faint outline: those the
 * scene's budget cut (not in `keep`), and those sno-core could not read for
 * want of reads ('objects'), never one cube each.
 */
export function cutOf(list: readonly Pick<Listed, 'r'>[], keep: ReadonlySet<number> | null | undefined): number[] {
  return list.map((_, i) => i).filter((i) => (keep && !keep.has(i)) || list[i].r?.missing === 'objects')
}

/** One box round every placement the budget cut, in the shard's frame: drawn as one outline. */
function cutBox(shard: ShardModel, list: readonly Listed[], cut: readonly number[]): { min: number[]; max: number[] } | null {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (const i of cut) {
    const { part, r } = list[i]
    const b = boundsOf(r)
    const m = partMatrix(part, shard.unit, r?.model ? r.model.unit : shard.unit)
    for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) {
      for (let k = 0; k < 3; k++) {
        const v = m[k] * x + m[4 + k] * y + m[8 + k] * z + m[12 + k]
        if (v < min[k]) min[k] = v
        if (v > max[k]) max[k] = v
      }
    }
  }
  return min[0] === Infinity ? null : { min, max }
}

function Placements({ shard, byRef, nested, lit, ghost, world, headlamp, pose, onPartClick, selected, cull, ignoreOpacity, allowance, near, rootTrusted = false }: {
  shard: ShardModel
  byRef: Map<string, Resolved>
  nested?: Placed[]
  lit: boolean
  ghost: boolean
  world: boolean
  headlamp: boolean
  pose?: Pose
  onPartClick?: (e: ThreeEvent<MouseEvent>, part: number) => void
  selected?: number[]
  cull: boolean
  ignoreOpacity: boolean
  /** How many placed objects it may draw from each share, at every depth (scene/meshBudget.ts); undefined for no budget. */
  allowance?: Allowance
  /** Whether the shard itself is trusted, for which share pays for each placement. */
  rootTrusted?: boolean
  /** Where the shard stands in the render frame, for nearest first. */
  near?: Near
}): JSX.Element | null {
  const list = useMemo(() => listOf(shard, byRef, nested), [shard, byRef, nested])
  const turn = useMemo(() => (pose ? renderPose(pose) : null), [pose])
  // Within the scene's budget: nearest first, each placement whole, and the
  // rest as one outline (it stops nothing: WALK has its own budget).
  const keep = useMemo(() => budgeted(list, allowance, near, rootTrusted), [list, allowance, near, rootTrusted])
  // What the scene's budget cut, and what sno-core could not read for want of
  // reads ('objects', lib/readPools.ts): one faint outline round all of it.
  const outline = useMemo(() => {
    const cut = cutOf(list, keep)
    return cut.length ? cutBox(shard, list, cut) : null
  }, [keep, list, shard])
  if (list.length === 0) return null
  const drawn = list.map(({ part, r }, i) => {
    if (!r) return null
    if (keep && !keep.has(i)) return null
    if (r.missing === 'objects') return null
    const model = r.model && r.model.unit + part.step >= 0 && r.model.unit + part.step <= MAX_UNIT ? r.model : null
    const matrix = new Matrix4().fromArray(partMatrix(part, shard.unit, model ? model.unit : shard.unit))
    let body: ReactNode = <lineSegments geometry={CUBE_EDGES}><lineBasicMaterial color={ACCENT} toneMapped={false} transparent opacity={ghost ? 0.45 : 0.8} /></lineSegments>
    // The part's own model, so its own opacity, never the parent's (§1.10).
    if (model) body = <ShardMesh shard={model} placed nested={r.children} lit={lit} ghost={ghost} world={world} headlamp={headlamp} cull={cull} ignoreOpacity={ignoreOpacity} />
    // Selected: an amber box around what the placement draws, in its own frame so it turns with it.
    const box = selected?.includes(i) ? (model ? placedBounds(model, r.children) : null) ?? { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] } : null
    return (
      <group key={i} matrix={matrix} matrixAutoUpdate={false} {...(onPartClick ? { onClick: (e: ThreeEvent<MouseEvent>) => onPartClick(e, i) } : {})}>
        {body}
        {box && (
          <lineSegments
            geometry={CUBE_EDGES}
            position={[(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2]}
            scale={[Math.max(box.max[0] - box.min[0], 0.05) + 0.1, Math.max(box.max[1] - box.min[1], 0.05) + 0.1, Math.max(box.max[2] - box.min[2], 0.05) + 0.1]}
          >
            <lineBasicMaterial color={WARN} toneMapped={false} />
          </lineSegments>
        )}
      </group>
    )
  })
  const cutOutline = outline && (
    <lineSegments
      key="cut"
      geometry={CUBE_EDGES}
      position={[(outline.min[0] + outline.max[0]) / 2, (outline.min[1] + outline.max[1]) / 2, (outline.min[2] + outline.max[2]) / 2]}
      scale={[Math.max(outline.max[0] - outline.min[0], 0.05), Math.max(outline.max[1] - outline.min[1], 0.05), Math.max(outline.max[2] - outline.min[2], 0.05)]}
    >
      {/* Its share kept as the EDIT breath and TV's look scale it (WorldShards breatheMaterial). */}
      <lineBasicMaterial color={ACCENT} toneMapped={false} transparent opacity={CUT_OPACITY} userData-share={CUT_OPACITY} />
    </lineSegments>
  )
  return turn ? <group matrix={turn} matrixAutoUpdate={false}>{drawn}{cutOutline}</group> : <>{drawn}{cutOutline}</>
}
