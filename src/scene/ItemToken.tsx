/**
 * ItemToken.tsx: an item that wears no model of its own, drawn as a token
 * from the same family as the sealed letter and the sound's level ring
 * (owner, 2026-11-27: "item with no mesh looks inconsistent. blue cube is
 * lost against a bright mesh bg").
 *
 * A dark tag with its top-left and bottom-right corners cut, the HUD's
 * chamfer, one gibson across (keyBoxSide, as the cube it replaces): a solid
 * dark core, so it reads against a white wall, edged in bright light in its
 * author's colour with a soft glow, so it reads against the dark of space.
 * On both faces, a package drawn in lines, lucide's "package" shape: the
 * neutral mark of a thing you can take. Never a key: an item may be a key
 * item and still stand for anything (owner, 2026-11-27: "it might be a key
 * item but it may not be a literal key"). A thin ring circles it, tilted
 * and turning against it, a single line, so a token never reads as a letter
 * (its ring is glyphs) or a sound (its ring is bars).
 *
 * It turns slowly about the scene's up axis and bobs, as a letter does;
 * with reduced motion it holds still. The paper of the letter and the core
 * here are opaque and out of the bloom (shardFaces basicFaceProps); the
 * edges and the mark are light. Edges are drawn twice: as bands for the
 * look up close, and as lines, which are a pixel wide at any distance, so
 * the token never loses its edge far off (the letter's flap did).
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BufferAttribute, BufferGeometry, DoubleSide, EllipseCurve, LineBasicMaterial, MeshBasicMaterial, Vector3, type Group } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { seedOf } from '../lib/decode'
import { basicFaceProps } from './shardFaces'
import { bandOf, bothFaces, shapeOf } from './LetterField'
import { LABEL_PRIORITY } from './WorldLabel'
import { markFadeLeft } from '../lib/worldMarks'

/** One turn of the token, seconds: a little quicker than a letter, so a row of both never turns as one. */
export const TOKEN_TURN_S = 20
/** The core: the token's dark, opaque face. */
export const TOKEN_CORE = '#08121c'

/** The tag's outline, for a token 1 across: 0.62 wide and 0.82 tall, the HUD's corners cut. */
const W = 0.31, H = 0.41, CUT = 0.11
export const TAG_OUTLINE: Array<[number, number]> = [[-W + CUT, H], [W, H], [W, -H + CUT], [W - CUT, -H], [-W, -H], [-W, H - CUT]]

/** Lucide's package, in the tag's middle: a box seen corner on, a hexagon with the three edges that meet at its front corner. */
function packageStrokes(r: number, cy: number): Array<Array<[number, number]>> {
  const hex: Array<[number, number]> = [0, 1, 2, 3, 4, 5].map((k) => {
    const a = Math.PI / 2 + (k * Math.PI) / 3
    return [Math.cos(a) * r, cy + Math.sin(a) * r]
  })
  const mid: [number, number] = [0, cy]
  return [
    [...hex, hex[0]],
    // The edges meeting at the near corner: up-left, up-right and down.
    [hex[1], mid, hex[5]],
    [mid, hex[3]],
    // The tape across its top.
    [[(hex[0][0] + hex[1][0]) / 2, (hex[0][1] + hex[1][1]) / 2], [(hex[5][0] + mid[0]) / 2 + 0.02, (hex[5][1] + mid[1]) / 2]],
  ]
}
const MARK = packageStrokes(0.16, -0.02)

/** Depths off the core, for a token 1 across. */
const Z_EDGE = 0.008
const Z_LINE = 0.011

const CORE_GEOMETRY = shapeOf(TAG_OUTLINE)
const EDGE_GEOMETRY = bothFaces(mergeGeometries([bandOf(TAG_OUTLINE, 0.026, true), ...MARK.map((s) => bandOf(s, 0.022, false))])!, Z_EDGE)

/** Every edge and stroke as line segments on both faces: a pixel wide at any distance. */
export function tokenLinePoints(): Float32Array {
  const out: number[] = []
  const strokes: Array<{ pts: ReadonlyArray<readonly [number, number]>; closed: boolean }> = [{ pts: TAG_OUTLINE, closed: true }, ...MARK.map((pts) => ({ pts, closed: false }))]
  for (const z of [Z_LINE, -Z_LINE]) {
    for (const { pts, closed } of strokes) {
      const n = closed ? pts.length : pts.length - 1
      for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; out.push(a[0], a[1], z, b[0], b[1], z) }
    }
  }
  return new Float32Array(out)
}
const LINE_GEOMETRY = (() => {
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(tokenLinePoints(), 3))
  return g
})()

/** The thin ring about it, flat in its own plane: tilted and turned in the frame. */
const RING_GEOMETRY = (() => {
  const pts = new EllipseCurve(0, 0, 0.6, 0.6, 0, Math.PI * 2, false, 0).getPoints(64)
  return new BufferGeometry().setFromPoints(pts.map((p) => new Vector3(p.x, p.y, 0)))
})()

export function ItemToken({ id, at, side, colour, opacity = 1, fadeOut }: {
  /** What it stands for, for its own starting angle. */
  id: string
  at: [number, number, number]
  /** Its width in scene units (keyBoxSide): one gibson. */
  side: number
  /** Its author's colour, a #hex: its edges, its mark and its ring. */
  colour: string
  opacity?: number
  /** From this moment (performance.now()), fading out over MARK_FADE_MS and then gone: TAKE. */
  fadeOut?: number
}): JSX.Element {
  const reduced = useReducedMotion()
  const group = useRef<Group>(null)
  const ring = useRef<Group>(null)
  const materials = useMemo(() => ({
    // Fading out (TAKE), the core is see-through from the start, so its opacity takes: the tag blend ignores it.
    core: new MeshBasicMaterial({ color: TOKEN_CORE, toneMapped: false, ...basicFaceProps(fadeOut !== undefined ? Math.min(opacity, 0.999) : opacity, { ghost: false, world: true }), side: DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 }),
    edge: new MeshBasicMaterial({ color: colour, toneMapped: false, transparent: true, opacity: 0.95 * opacity, depthWrite: false }),
    line: new LineBasicMaterial({ color: colour, toneMapped: false, transparent: true, opacity: 0.95 * opacity, depthWrite: false }),
    ring: new LineBasicMaterial({ color: colour, toneMapped: false, transparent: true, opacity: 0.5 * opacity, depthWrite: false }),
  }), [colour, opacity, fadeOut])
  useEffect(() => () => { for (const m of Object.values(materials)) m.dispose() }, [materials])
  const phase = useMemo(() => (seedOf(id) / 4294967296) * Math.PI * 2, [id])

  useFrame((state) => {
    const g = group.current
    if (!g) return
    if (fadeOut !== undefined) {
      const left = markFadeLeft(performance.now() - fadeOut)
      g.visible = left > 0
      materials.edge.opacity = 0.95 * opacity * left
      materials.line.opacity = 0.95 * opacity * left
      materials.ring.opacity = 0.5 * opacity * left
      // The core, see-through while it fades (its material above), goes with the rest.
      materials.core.opacity = Math.min(opacity, 0.999) * left
    }
    const t = reduced ? 0 : state.clock.elapsedTime
    g.position.set(at[0], at[1] + (reduced ? 0 : Math.sin(t * 1.25 + phase) * 0.03 * side), at[2])
    // Held still with reduced motion, square on, never edge on.
    g.rotation.set(0, reduced ? 0 : phase + (t / TOKEN_TURN_S) * Math.PI * 2, 0)
    g.scale.setScalar(side)
    // The ring leans back and turns the other way, so it never lines up with the tag.
    if (ring.current) ring.current.rotation.set(1.15, 0, -(t / (TOKEN_TURN_S * 0.75)) * Math.PI * 2)
  }, LABEL_PRIORITY)

  return (
    <group ref={group} position={at} scale={side} rotation={[0, phase, 0]} name="item-token">
      <mesh geometry={CORE_GEOMETRY} material={materials.core} name="item-token-core" />
      <mesh geometry={EDGE_GEOMETRY} material={materials.edge} name="item-token-edges" />
      <lineSegments geometry={LINE_GEOMETRY} material={materials.line} frustumCulled={false} name="item-token-lines" />
      <group ref={ring} rotation={[1.15, 0, 0]}>
        <lineLoop geometry={RING_GEOMETRY} material={materials.ring} frustumCulled={false} name="item-token-ring" />
      </group>
    </group>
  )
}
