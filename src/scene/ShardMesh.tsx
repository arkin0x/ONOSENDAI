/**
 * ShardMesh.tsx — a shard drawn in its mode, and how it arrives.
 *
 * SOLID draws the indexed triangles, LINES the vertex order as one line, and
 * every mode draws the vertices as points so a shard is visible at any size.
 * The two geometries share one pair of attribute buffers.
 *
 * With a `birth`, the shard is one this client has just found, and it does not
 * simply appear: for SHARD_DECODE_MS its vertices sit scattered through the
 * volume the model occupies in cyan static, then settle into place and color
 * with an ease-out, jittering less as they land. Decryption made visible.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import {
  AddEquation,
  AdditiveBlending,
  FrontSide,
  CustomBlending,
  OneFactor,
  ZeroFactor,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Line,
  LineBasicMaterial,
} from 'three'
import { easeOutCubic, hash01, scrambleOffset, seedOf, SHARD_DECODE_MS } from '../lib/decode'
import { flatten, ticksOf, toRender, type ShardModel } from '../lib/shards'
import { glowTexture } from '../lib/glow'
import { orientShard } from '../lib/orient'

interface Props {
  shard: ShardModel
  /** Render units per model unit. */
  scale?: number
  /** Dimmed, for a preview that is not yet real. */
  ghost?: boolean
  /**
   * Lit, as on the bench: faces shaded flat by the scene's lights, wound
   * consistently outward (lib/orient.ts) and their backs painted dark, so an
   * open shape shows its inside and a missing face is plain to see. The
   * world draws unlit under its bloom instead.
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
  /** A tap on a SOLID face (its index is `e.faceIndex`); the workshop's FACE tool. */
  onFaceClick?: (e: ThreeEvent<MouseEvent>) => void
}

const STATIC = [0, 0.9, 1] as const

/**
 * Colour written opaque, alpha written as 0: the tag. (Blending needs the
 * material transparent, which the face already is for its opacity.)
 */
const TAG_BLEND = { blending: CustomBlending, blendEquation: AddEquation, blendSrc: OneFactor, blendDst: ZeroFactor, blendSrcAlpha: ZeroFactor, blendDstAlpha: ZeroFactor } as const

export function ShardMesh({ shard, scale = 1, ghost = false, birth, onFaceClick, world = false, lit = false }: Props): JSX.Element | null {
  const { positions, colors, index } = useMemo(() => {
    const f = flatten(shard)
    if (!lit) return f
    // Wound outward, and without the faces buried inside a join, which would
    // only fight the face they sit against (orient.ts).
    const o = orientShard(shard.vertices.map((v) => toRender(ticksOf(v))), shard.faces)
    return { ...f, index: o.faces.filter((_, i) => !o.interior[i]).flat() }
  }, [shard.vertices, shard.faces, lit])

  // Live copies: the decode writes into these, the targets stay untouched.
  const posAttr = useMemo(() => new Float32BufferAttribute(positions.slice(), 3), [positions])
  const colAttr = useMemo(() => new Float32BufferAttribute(colors.slice(), 3), [colors])

  const plain = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', posAttr)
    g.setAttribute('color', colAttr)
    return g
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

  useFrame(() => {
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

  if (shard.vertices.length === 0) return null
  const opacity = ghost ? 0.45 : 1
  const glow = glowTexture()

  return (
    <group scale={scale}>
      {shard.mode === 'solid' && index.length > 0 && (
        <group>
          <mesh name="shard-faces" geometry={indexed} frustumCulled={false} {...(onFaceClick ? { onClick: onFaceClick } : {})}>
            {lit
              ? <meshLambertMaterial vertexColors flatShading side={FrontSide} transparent opacity={opacity} />
              : <meshBasicMaterial vertexColors side={DoubleSide} toneMapped={false} transparent opacity={opacity} {...(world && !ghost ? TAG_BLEND : {})} />}
          </mesh>
          {lit && inside && (
            <mesh geometry={inside} frustumCulled={false}>
              {/* The inside of a face: lit like the outside, darker by a multiplier so it still reads as inside. */}
              <meshLambertMaterial vertexColors flatShading color="#6a6a6a" side={FrontSide} transparent opacity={opacity} />
            </mesh>
          )}
        </group>
      )}
      {shard.mode === 'lines' && shard.vertices.length > 1 && <primitive object={line} />}
      {(shard.mode === 'points' || shard.mode === 'solid' || shard.mode === 'lines') && (
        <points geometry={plain} frustumCulled={false}>
          {/* Small and glowing: a soft round sprite tinted by the vertex colour, added
              to what is behind it, so a point reads as a light rather than a tile. */}
          <pointsMaterial
            vertexColors
            size={shard.mode === 'points' ? 0.22 : 0.1}
            sizeAttenuation
            transparent
            opacity={shard.mode === 'points' ? opacity : opacity * 0.9}
            blending={AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
            {...(glow ? { map: glow, alphaTest: 0.02 } : {})}
          />
        </points>
      )}
    </group>
  )
}
