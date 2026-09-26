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

import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import {
  AddEquation,
  FrontSide,
  CustomBlending,
  OneFactor,
  ZeroFactor,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  BoxGeometry,
  EdgesGeometry,
  Line,
  LineBasicMaterial,
  Matrix4,
} from 'three'
import { easeOutCubic, hash01, scrambleOffset, seedOf, SHARD_DECODE_MS } from '../lib/decode'
import { MAX_UNIT, expandFaceColors, flatten, posed, ticksOf, toRender, type Part, type ShardModel } from 'sno-core/shards'
import { partMatrix, refKey, type Placed } from 'sno-core/parts'
import { useResolved, type Resolved } from '../lib/parts'
import { ACCENT } from '../lib/palette'
import type { Pose } from '../lib/pose'
import { boxContains, clipMesh, clipPoints, type Box } from '../lib/clip'
import { orientShard } from 'sno-core/orient'
import { faceEdges } from 'sno-core/outline'
import { SHARD_DOTS, SHARD_POINTS, createDiscMaterial, sizeDisc, withDiscColors } from './pointDisc'

interface Props {
  shard: ShardModel
  /** Render units per model unit. */
  scale?: number
  /** Dimmed, for a preview that is not yet real. */
  ghost?: boolean
  /**
   * Lit, as on the bench: faces shaded flat by the scene's lights, each one's
   * front as its winding gives it (DECK-0003 §1.4) and its back painted dark,
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
  /** performance.now() when this client opened the shard; runs the decode. */
  birth?: number
  /**
   * A tap on a SOLID face, with the shard's own index for it; the workshop's
   * FACE tool. Not `e.faceIndex`, which counts the triangles drawn, and the
   * bench leaves out the faces buried in a join.
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
   * The shard standing on the Earth where it is hidden, in the view frame
   * (lib/pose.ts drawPoseAt): the turn applied to every vertex before the
   * render mapping, so the bottom faces the ground and +Z faces its spin.
   * Absent for a shard lying on cyberspace axes as it was built, which is
   * every shard hidden before the pose existed and every one in cyberspace.
   */
  pose?: Pose
  /**
   * A placed object's own placements, already resolved by the parent's draw
   * (DECK-0003 §1.10). Given, this mesh is a part: it fetches nothing itself
   * and follows the chain the parent resolved, which is what bounds the depth
   * at four and makes a loop a placeholder.
   */
  nested?: Placed[]
}

const STATIC = [0, 0.9, 1] as const

/**
 * The shard's own face index for a ray's hit on either side of a face, or
 * null for a hit on anything else. Both face meshes carry `faceOf`, the map
 * from a drawn triangle to its face: the bench leaves out faces buried in a
 * join, so the triangle's index is not the face's. A face must answer a tap
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

/**
 * Colour written opaque, alpha written as 0: the tag. (Blending needs the
 * material transparent, which the face already is for its opacity.)
 */
const TAG_BLEND = { blending: CustomBlending, blendEquation: AddEquation, blendSrc: OneFactor, blendDst: ZeroFactor, blendSrcAlpha: ZeroFactor, blendDstAlpha: ZeroFactor } as const

export function ShardMesh({ shard: given, scale = 1, ghost = false, birth, onFaceClick, world = false, lit = false, clip, pose, nested }: Props): JSX.Element | null {
  // The objects this one places, fetched once for the whole app; a part's own
  // parts come resolved from its parent instead.
  const resolved = useResolved(nested ? null : given)
  // A face that carries its own colour needs three corners of its own, or the
  // colour would bleed across every edge it shares. Expanded here and nowhere
  // else, so the winding pass, the clipper and the face picker below never
  // learn the feature exists.
  const shard = useMemo(() => expandFaceColors(given), [given])
  const { positions, colors, index, faces, drawn } = useMemo(() => {
    const f = flatten(shard, pose)
    // On the bench, without the faces buried inside a join, which would only
    // fight the face they sit against (orient.ts). Their winding is kept.
    const buried = lit ? orientShard(shard.vertices.map((v) => toRender(posed(ticksOf(v), pose))), shard.faces).interior : null
    const drawn = shard.faces.map((_, i) => i).filter((i) => !buried?.[i])
    const oriented = buried ? { ...f, index: drawn.flatMap((i) => shard.faces[i]) } : f
    if (!clip || boxContains(clip, oriented.positions)) return { ...oriented, faces: shard.faces as number[][], drawn }
    // Cropped to its region: the faces cut at the walls, and the points that
    // are left are the vertices of the cut faces, or, for a shard with no
    // faces, its own points inside the walls.
    if (shard.faces.length === 0) {
      const pts = clipPoints(oriented.positions, oriented.colors, clip)
      return { positions: pts.positions, colors: pts.colors, index: [] as number[], faces: [] as number[][], drawn: [] as number[] }
    }
    const cut = clipMesh(oriented, clip)
    const faces: number[][] = []
    for (let t = 0; t + 2 < cut.index.length; t += 3) faces.push([cut.index[t], cut.index[t + 1], cut.index[t + 2]])
    return { ...cut, faces, drawn: faces.map((_, i) => i) }
  }, [shard.vertices, shard.faces, lit, clip, pose])

  // Live copies: the decode writes into these, the targets stay untouched.
  const posAttr = useMemo(() => new Float32BufferAttribute(positions.slice(), 3), [positions])
  const colAttr = useMemo(() => new Float32BufferAttribute(colors.slice(), 3), [colors])

  const plain = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', posAttr)
    g.setAttribute('color', colAttr)
    // The same colours under the name the disc shader reads (scene/pointDisc).
    return withDiscColors(g, colAttr)
  }, [posAttr, colAttr])

  const indexed = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', posAttr)
    g.setAttribute('color', colAttr)
    g.setIndex(index)
    g.computeVertexNormals()
    return g
  }, [posAttr, colAttr, index])

  // The inside of every face as a front face of its own: the same triangles
  // wound the other way. Flat shading takes a face's normal from the screen,
  // and a back face's points away from the viewer, so drawn as back faces the
  // insides could only ever be ambient; drawn as front faces they take the
  // lights like the outsides do.
  const inside = useMemo(() => {
    if (!lit) return null
    const g = new BufferGeometry()
    g.setAttribute('position', posAttr)
    g.setAttribute('color', colAttr)
    const flipped: number[] = []
    for (let i = 0; i + 2 < index.length; i += 3) flipped.push(index[i], index[i + 2], index[i + 1])
    g.setIndex(flipped)
    return g
  }, [posAttr, colAttr, index, lit])

  // The points, drawn as the terrain field draws its gibsons: a feathered disc
  // with a bright core for the bloom, sized in pixels between a floor and a cap.
  const pointMaterial = useMemo(() => {
    const seen = ghost ? 0.45 : 1
    return createDiscMaterial(shard.mode === 'points' ? SHARD_POINTS : SHARD_DOTS, shard.mode === 'points' ? seen : seen * 0.55)
  }, [shard.mode, ghost])
  useEffect(() => () => pointMaterial.dispose(), [pointMaterial])

  /**
   * LINES mode: every edge of every face, each drawn once.
   *
   * Built from the shard's own faces rather than the triangulated index, so a
   * polygon shows its outline and not the diagonals its triangles were cut
   * along, and an edge two faces share is drawn once rather than twice.
   */
  const outline = useMemo(() => {
    if (faces.length === 0) return null
    const idx = faceEdges(faces)
    if (idx.length === 0) return null
    const g = new BufferGeometry()
    g.setAttribute('position', posAttr)
    g.setAttribute('color', colAttr)
    g.setIndex(idx)
    return g
  }, [posAttr, colAttr, faces])

  useEffect(() => () => { outline?.dispose() }, [outline])

  const line = useMemo(() => {
    const l = new Line(plain, new LineBasicMaterial({ vertexColors: true, toneMapped: false, transparent: true, opacity: ghost ? 0.45 : 1 }))
    l.frustumCulled = false
    return l
  }, [plain, ghost])

  // A rebuild replaces these; nothing else lets the GPU buffers go. The line
  // is a primitive, which R3F never disposes, so its material is ours too.
  useEffect(() => () => { plain.dispose() }, [plain])
  useEffect(() => () => { indexed.dispose() }, [indexed])
  useEffect(() => () => { inside?.dispose() }, [inside])
  useEffect(() => () => { line.material.dispose() }, [line])

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

  const done = useRef(false)
  const frame = useRef(0)

  useFrame((state) => {
    // The disc is sized in pixels, so it needs the canvas it is drawn on.
    sizeDisc(pointMaterial, state.gl.getPixelRatio(), state.size.height)
    if (birth === undefined || noise === null || done.current) return
    const t = Math.min(1, (performance.now() - birth) / SHARD_DECODE_MS)
    const e = easeOutCubic(t)
    const jitter = (1 - t) ** 2 * 0.12 * noise.extent
    frame.current++
    const p = posAttr.array as Float32Array
    const c = colAttr.array as Float32Array
    for (let i = 0; i < p.length; i++) {
      const j = t < 1 ? (hash01(i * 13 + frame.current, noise.seed) - 0.5) * jitter : 0
      p[i] = noise.pos[i] + (positions[i] - noise.pos[i]) * e + j
      c[i] = noise.col[i] + (colors[i] - noise.col[i]) * e
    }
    posAttr.needsUpdate = true
    colAttr.needsUpdate = true
    if (t >= 1) done.current = true
  })

  const placements = (given.parts?.length ?? 0) > 0
    ? <Placements shard={given} byRef={resolved} nested={nested} lit={lit} ghost={ghost} world={world} pose={pose} />
    : null
  // An object may be nothing but the arrangement of others (§1.9 rule 13).
  if (shard.vertices.length === 0) return placements ? <group scale={scale}>{placements}</group> : null
  const opacity = ghost ? 0.45 : 1
  // The nearest hit is on whichever side faces the tap; it answers and stops it there.
  const pick = { userData: { faceOf: drawn }, ...(onFaceClick ? { onClick: (e: ThreeEvent<MouseEvent>) => { const f = faceOfHit(e); if (f !== null) onFaceClick(e, f) } } : {}) }

  return (
    <group scale={scale}>
      {placements}
      {shard.mode === 'solid' && index.length > 0 && (
        <group>
          <mesh name="shard-faces" geometry={indexed} frustumCulled={false} {...pick}>
            {lit
              ? <meshLambertMaterial vertexColors flatShading side={FrontSide} transparent opacity={opacity} />
              : <meshBasicMaterial vertexColors side={DoubleSide} toneMapped={false} transparent opacity={opacity} {...(world && !ghost ? TAG_BLEND : {})} />}
          </mesh>
          {lit && inside && (
            <mesh geometry={inside} frustumCulled={false} {...pick}>
              {/* The inside of a face: lit like the outside, darker by a multiplier so it still reads as inside. */}
              <meshLambertMaterial vertexColors flatShading color="#6a6a6a" side={FrontSide} transparent opacity={opacity} />
            </mesh>
          )}
        </group>
      )}
      {/* Faces as outlines. A shard with no faces has no edges to draw, so it
          keeps the old single line through its points, which is all there is. */}
      {shard.mode === 'lines' && outline && (
        <lineSegments geometry={outline} frustumCulled={false}>
          <lineBasicMaterial vertexColors toneMapped={false} transparent opacity={opacity} />
        </lineSegments>
      )}
      {shard.mode === 'lines' && !outline && shard.vertices.length > 1 && <primitive object={line} />}
      {(shard.mode === 'points' || shard.mode === 'solid' || shard.mode === 'lines') && (
        <points geometry={plain} material={pointMaterial} frustumCulled={false} />
      )}
    </group>
  )
}

/** A unit cube's twelve edges, centred on the origin: the placeholder (§1.10). */
const CUBE_EDGES = new EdgesGeometry(new BoxGeometry(1, 1, 1))

/**
 * A pose, which turns ticks before the render mapping, as the same turn in
 * render space: the flip on Z, the turn, the flip back. Placements are placed
 * in render space, and a part stands on the Earth with its parent (§1.10: it
 * loses its own `up` and `spin` to the parent's placement).
 */
function poseMatrix(pose: Pose): Matrix4 {
  const f = [1, 1, -1]
  // applyPose: out[j] = sum_i v[i] * pose[i * 3 + j], so the column-vector matrix is M[j][i] = pose[i * 3 + j].
  const m = (j: number, i: number): number => f[j] * pose[i * 3 + j] * f[i]
  return new Matrix4().set(m(0, 0), m(0, 1), m(0, 2), 0, m(1, 0), m(1, 1), m(1, 2), 0, m(2, 0), m(2, 1), m(2, 2), 0, 0, 0, 0, 1)
}

/**
 * Each placed object where its placement stands, or a placeholder there: a
 * wireframe cube one unit on a side in the accent, for anything not fetched,
 * not valid, too deep, a loop, or scaled out of range (§1.10). Nothing is
 * drawn for a reference still being fetched, so opening an object does not
 * flash cubes before its parts arrive. Parts are not clipped to the region:
 * a hidden object's parts are its author's to place.
 */
function Placements({ shard, byRef, nested, lit, ghost, world, pose }: {
  shard: ShardModel
  byRef: Map<string, Resolved>
  nested?: Placed[]
  lit: boolean
  ghost: boolean
  world: boolean
  pose?: Pose
}): JSX.Element | null {
  const list: Array<{ part: Part; r: Resolved | undefined }> = nested
    ? nested.map((p) => ({ part: p.part, r: p }))
    : (shard.parts ?? []).map((part) => ({ part, r: shard.refs?.[part.ref] ? byRef.get(refKey(shard.refs[part.ref])) : undefined }))
  const turn = useMemo(() => (pose ? poseMatrix(pose) : null), [pose])
  if (list.length === 0) return null
  const drawn = list.map(({ part, r }, i) => {
    if (!r) return null
    const model = r.model && r.model.unit + part.step >= 0 && r.model.unit + part.step <= MAX_UNIT ? r.model : null
    const matrix = new Matrix4().fromArray(partMatrix(part, shard.unit, model ? model.unit : shard.unit))
    let body: ReactNode = <lineSegments geometry={CUBE_EDGES}><lineBasicMaterial color={ACCENT} toneMapped={false} transparent opacity={ghost ? 0.45 : 0.8} /></lineSegments>
    if (model) body = <ShardMesh shard={model} nested={r.children} lit={lit} ghost={ghost} world={world} />
    return <group key={i} matrix={matrix} matrixAutoUpdate={false}>{body}</group>
  })
  return turn ? <group matrix={turn} matrixAutoUpdate={false}>{drawn}</group> : <>{drawn}</>
}
