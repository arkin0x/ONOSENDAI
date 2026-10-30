/**
 * ChestCeremony.tsx: a chest opening where it stands (lib/ceremony.ts has
 * the timeline; arkinox, 2026-10-30: "when you open the chest the modal goes
 * away and the in-world animation plays").
 *
 * Drawn inside the chest's look (LookMark), so it is the chest's size and
 * turn at any zoom, and nothing in it moves the camera:
 *
 *   - the lid: the closed chest cut at the lid (lib/looks.ts splitAt), the
 *     lid turning up and back on its hinge, ease-out over LID_MS;
 *   - the swap: the open look in its place once the lid is up, under the
 *     glints, so the hollow and the gold appear as the lid arrives;
 *   - the glints: a few dozen points of light at the gold inside, each
 *     twinkling on its own clock, drawn with the shared glow sprite
 *     (lib/glow.ts). Points are seen by the scene's bloom and faces are not
 *     (Scene.tsx WorldBloom), so the gold flares without the frame swelling;
 *   - the rain: glyphs of the wordmark (lib/decode.ts GLYPHS) rising from
 *     the mouth, flickering until they resolve, then fading. One draw call,
 *     their motion worked in the vertex shader, as BurstLines works its.
 *
 * The calm path (reduced motion): the closed look fades into the open one,
 * nothing turns, glints or rises. A look with no lid or no open look
 * crossfades too: the hinge is only ever applied to the built-in TREASURE.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  PointsMaterial,
  ShaderMaterial,
  type Group,
  type Material,
  type Object3D,
  type Texture,
} from 'three'
import { flatten, type ShardModel } from 'sno-core/shards'
import { GLYPHS, hash01 } from '../lib/decode'
import { glowTexture } from '../lib/glow'
import { RAIN_MS, RAIN_SPREAD_MS, calmShare, glintLevel, lidTurn, LID_MS, rainCount, swapped as swappedAt } from '../lib/ceremony'
import type { Look } from '../lib/looks'
import { ACCENT } from '../lib/palette'
import { ShardMesh } from './ShardMesh'
import { breatheMaterial } from './WorldShards'

/** Where the chest's mouth is, in its own units: the rim, a little above the body's walls. */
export const MOUTH_Y = 0.55

interface Props {
  look: Look
  /** performance.now() when the decrypt returned. */
  at: number
  calm: boolean
}

/** A chest opening, drawn in its look's frame. */
export function ChestCeremony({ look, at, calm }: Props): JSX.Element {
  const open = look.open ?? look.closed
  if (calm || !look.lid || !look.open) return <CalmSwap from={look.closed} to={open} at={at} />
  return (
    <>
      <LidOpening look={look} at={at} />
      <Glints model={look.open} at={at} />
      <GlyphRain at={at} />
    </>
  )
}

/** The closed chest with its lid turning, then the open look in its place. */
function LidOpening({ look, at }: { look: Look; at: number }): JSX.Element {
  const lid = look.lid!
  const turn = useRef<Group>(null)
  const [done, setDone] = useState(() => swappedAt(performance.now() - at))
  useEffect(() => {
    if (done) return
    const t = window.setTimeout(() => setDone(true), Math.max(0, at + LID_MS - performance.now()))
    return () => window.clearTimeout(t)
  }, [done, at])
  useFrame(() => {
    if (turn.current) turn.current.rotation.x = lidTurn(performance.now() - at, lid.hinge.angle)
  })
  if (done) return <ShardMesh shard={look.open!} world />
  return (
    <>
      <ShardMesh shard={lid.body} world />
      {/* The lid turns about its hinge line: moved so the hinge is the origin, turned, and moved back. */}
      <group position={[0, lid.hinge.y, lid.hinge.z]}>
        <group ref={turn}>
          <group position={[0, -lid.hinge.y, -lid.hinge.z]}>
            <ShardMesh shard={lid.lid} world />
          </group>
        </group>
      </group>
    </>
  )
}

/** Every material under `root` at opacity `b` (WorldShards breatheMaterial, as EDIT's breath writes it). */
export function fadeAll(root: Object3D | null, b: number): void {
  root?.traverse((o) => {
    const m = (o as { material?: Material | Material[] }).material
    if (!m) return
    if (Array.isArray(m)) m.forEach((one) => breatheMaterial(one, b))
    else breatheMaterial(m, b)
  })
}

/** The calm path: one look fading into the other, drawn as ghosts are so their opacity is real. */
export function CalmSwap({ from, to, at }: { from: ShardModel; to: ShardModel; at: number }): JSX.Element {
  const a = useRef<Group>(null)
  const b = useRef<Group>(null)
  useFrame(() => {
    const share = calmShare(performance.now() - at)
    fadeAll(a.current, 1 - share)
    fadeAll(b.current, share)
  })
  return (
    <>
      <group ref={a}><ShardMesh shard={from} world ghost /></group>
      {to !== from && <group ref={b}><ShardMesh shard={to} world ghost /></group>}
    </>
  )
}

/** The gold glinting: the open look's gold points inside, below the rim. */
export function glintPoints(model: ShardModel, below = MOUTH_Y + 0.05): Float32Array {
  const f = flatten(model)
  const out: number[] = []
  for (let i = 0; i < model.vertices.length; i++) {
    const [r, g, b] = model.vertices[i].c
    // Gold in the owner's palette: red high, green between, blue low.
    const gold = r > 0.6 && g > 0.4 && g < 0.95 && b < 0.55 && r > b + 0.35
    if (!gold || f.positions[i * 3 + 1] > below) continue
    out.push(f.positions[i * 3], f.positions[i * 3 + 1] + 0.04, f.positions[i * 3 + 2])
  }
  return new Float32Array(out)
}

const GOLD = new Color('#ffd27d')

/** Points of gold light at the heap, twinkling, fading with the timeline. */
function Glints({ model, at }: { model: ShardModel; at: number }): JSX.Element | null {
  const positions = useMemo(() => glintPoints(model), [model])
  const count = positions.length / 3
  const geometry = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(positions, 3))
    g.setAttribute('color', new Float32BufferAttribute(new Float32Array(positions.length), 3))
    return g
  }, [positions])
  const material = useMemo(() => new PointsMaterial({
    size: 6, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, depthTest: false,
    blending: AdditiveBlending, toneMapped: false, map: glowTexture() ?? undefined,
  }), [])
  useEffect(() => () => { geometry.dispose(); material.dispose() }, [geometry, material])
  useFrame(() => {
    const t = performance.now() - at
    const level = glintLevel(t)
    const c = geometry.getAttribute('color') as Float32BufferAttribute
    const arr = c.array as Float32Array
    for (let i = 0; i < count; i++) {
      // Each point on its own clock, a sharp twinkle rather than a pulse.
      const phase = hash01(i, 7) * Math.PI * 2
      const rate = 7 + hash01(i, 11) * 9
      const tw = Math.max(0, Math.sin(phase + (t / 1000) * rate)) ** 3
      // Dim at rest and bright only at a twinkle's peak: under the bloom a
      // steady gold field reads as one white blob, not as glints.
      const v = level * (0.08 + 0.62 * tw)
      arr[i * 3] = GOLD.r * v
      arr[i * 3 + 1] = GOLD.g * v
      arr[i * 3 + 2] = GOLD.b * v
    }
    c.needsUpdate = true
  })
  if (count === 0) return null
  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={20} />
}

/** The glyphs drawn once into a texture: a square grid of cells, white on nothing. */
let atlasCache: { texture: Texture; cols: number; count: number } | null | undefined
function glyphAtlas(): { texture: Texture; cols: number; count: number } | null {
  if (atlasCache !== undefined) return atlasCache
  if (typeof document === 'undefined') return (atlasCache = null)
  const glyphs = [...GLYPHS]
  const cols = Math.ceil(Math.sqrt(glyphs.length))
  const cell = 48
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = cols * cell
  const ctx = canvas.getContext('2d')
  if (!ctx) return (atlasCache = null)
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `${Math.round(cell * 0.78)}px monospace`
  glyphs.forEach((g, i) => ctx.fillText(g, (i % cols) * cell + cell / 2, Math.floor(i / cols) * cell + cell / 2))
  return (atlasCache = { texture: new CanvasTexture(canvas), cols, count: glyphs.length })
}

const RAIN_VERTEX = /* glsl */ `
  attribute float aGlyph;
  attribute float aDelay;
  attribute vec3 aDrift;
  uniform float uT;
  uniform float uDur;
  uniform float uSize;
  uniform float uCount;
  varying float vGlyph;
  varying float vAlpha;
  void main() {
    float p = clamp((uT - aDelay) / uDur, 0.0, 1.0);
    float rise = 1.0 - (1.0 - p) * (1.0 - p);
    vec3 pos = position + vec3(aDrift.x * p, aDrift.y * rise, aDrift.z * p);
    vAlpha = (uT < aDelay) ? 0.0 : min(1.0, p / 0.12) * (1.0 - smoothstep(0.55, 1.0, p));
    // Flickers through glyphs until halfway, then holds the one it resolved to.
    float steps = floor(min(p, 0.5) * 22.0);
    vGlyph = mod(aGlyph + steps * 7.0, uCount);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = uSize;
  }
`

const RAIN_FRAGMENT = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform vec3 uColor;
  uniform float uCols;
  varying float vGlyph;
  varying float vAlpha;
  void main() {
    float g = floor(vGlyph + 0.5);
    vec2 cell = vec2(mod(g, uCols), floor(g / uCols));
    vec2 uv = vec2((cell.x + gl_PointCoord.x) / uCols, 1.0 - (cell.y + gl_PointCoord.y) / uCols);
    float a = texture2D(uAtlas, uv).a * vAlpha;
    if (a < 0.02) discard;
    gl_FragColor = vec4(uColor * a, a);
  }
`

/** Glyphs rising out of the chest's mouth, resolving, fading. One draw call. */
function GlyphRain({ at }: { at: number }): JSX.Element | null {
  const width = useThree((s) => s.size.width)
  const dpr = useThree((s) => s.viewport.dpr)
  const atlas = useMemo(() => glyphAtlas(), [])
  const n = rainCount(width)
  const geometry = useMemo(() => {
    const pos = new Float32Array(n * 3), drift = new Float32Array(n * 3), glyph = new Float32Array(n), delay = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (hash01(i * 5, 3) - 0.5) * 0.6
      pos[i * 3 + 1] = MOUTH_Y
      pos[i * 3 + 2] = (hash01(i * 5 + 1, 3) - 0.5) * 0.5
      drift[i * 3] = (hash01(i * 5 + 2, 3) - 0.5) * 0.5
      drift[i * 3 + 1] = 0.6 + hash01(i * 5 + 3, 3) * 1.2
      drift[i * 3 + 2] = (hash01(i * 5 + 4, 3) - 0.5) * 0.5
      glyph[i] = Math.floor(hash01(i, 13) * (atlas?.count ?? 1))
      delay[i] = hash01(i, 17) * RAIN_SPREAD_MS
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(pos, 3))
    g.setAttribute('aDrift', new Float32BufferAttribute(drift, 3))
    g.setAttribute('aGlyph', new Float32BufferAttribute(glyph, 1))
    g.setAttribute('aDelay', new Float32BufferAttribute(delay, 1))
    return g
  }, [n, atlas])
  const material = useMemo(() => atlas && new ShaderMaterial({
    vertexShader: RAIN_VERTEX,
    fragmentShader: RAIN_FRAGMENT,
    uniforms: {
      uT: { value: 0 }, uDur: { value: RAIN_MS }, uSize: { value: 15 }, uCount: { value: atlas.count },
      uAtlas: { value: atlas.texture }, uCols: { value: atlas.cols }, uColor: { value: new Color(ACCENT) },
    },
    transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending, toneMapped: false,
  }), [atlas])
  useEffect(() => () => { geometry.dispose(); material?.dispose() }, [geometry, material])
  useFrame(() => {
    if (!material) return
    material.uniforms.uT.value = performance.now() - at - LID_MS
    material.uniforms.uSize.value = 15 * dpr
  })
  if (!material) return null
  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={21} />
}
