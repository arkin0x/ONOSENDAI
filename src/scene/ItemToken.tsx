/**
 * ItemToken.tsx: an item that wears no model of its own, drawn as a token
 * under the one rulebook every hidden thing shares (lib/hiddenLook.ts; owner
 * ruling, 2026-11-27, option A of the hidden-item cohesion page: "the key
 * item becomes a solid cut-corner card with the maker's hexagon seal and a
 * notch code").
 *
 * A solid card one gibson tall (keyBoxSide, as the cube it replaced), its
 * top-left and bottom-right corners cut, the HUD's chamfer, in the shared
 * face (hiddenParts faceMaterial). On both faces its maker's seal, the
 * letter's hexagon in their colour with their initial pressed in, inlaid; a
 * round hole at its top corner; and down its right edge a row of notches,
 * the item's own code (lib/hiddenLook notchCode), so two tokens side by side
 * never look the same. Never a literal key, and no box icon: an item may be
 * a key item and still stand for anything (owner, 2026-11-27: "it might be a
 * key item but it may not be a literal key").
 *
 * Every hard edge is outlined OUTLINE_PX wide at any distance, bright until
 * its card has been opened and steel after. Round it, facing the camera, the
 * thin line ring every item wears, the HUD's cyan, turning and riding the
 * shared idle wave; a NEW item sends a pulse out of it every PULSE_S until
 * its card is opened. It turns about the scene's up axis in the shared turn
 * and bobs with the shared bob; with reduced motion it holds still, square
 * on, and NEW is a faint still ring.
 *
 * It rests over its place rather than about it (TOKEN_LIFT, lib/restLift.ts):
 * its lowest point stands a little over the level of its place, where a
 * floor at that height lies and a chest's base stands, so the floor never
 * cuts its lower half. The faces and the seal are opaque and out of the
 * bloom; the outline and the ring are light.
 */

import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, DoubleSide, MeshBasicMaterial, PlaneGeometry, ShaderMaterial, type BufferGeometry, type Group, type InterleavedBufferAttribute, type Mesh } from 'three'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { seedOf } from '../lib/decode'
import { BOB, HIDDEN_FACE, RING_COLOUR, RING_REACH, SEAL_INK, bobAt, hiddenLook, labelShape, notchCode, pulseAt, ringTurnAt, turnAt, waveAt, wavePhaseAt, type HiddenState } from '../lib/hiddenLook'
import { basicFaceProps } from './shardFaces'
import { bothFaces } from './LetterField'
import { ATLAS_UV, LINE_RING_SEGMENTS, PULSE_GEOMETRY, SEAL_DEPTH, circleHole, edgeSegments, faceMaterial, hexPoints, lineRingGeometry, lineRingMaterial, liveOutlineLines, outlineLines, outlineMaterial, pulseMaterial, sealInlay, segmentColours, setFaceOpacity, shapeFrom, sizeOutline, slab } from './hiddenParts'
import { glyphAtlas } from './glyphAtlas'
import { LABEL_PRIORITY } from './WorldLabel'
import { markFadeLeft } from '../lib/worldMarks'
import { restLift } from '../lib/restLift'

/** One turn of the token, seconds: the shared turn. */
export { TURN_S as TOKEN_TURN_S } from '../lib/hiddenLook'
/** The core: the shared face. */
export const TOKEN_CORE = HIDDEN_FACE

/** The card, for a token 1 across: 0.62 wide and 0.82 tall, the HUD's corners cut, 0.07 thick. */
const W = 0.31, H = 0.41, CUT = 0.11, T = 0.07
/** A notch's depth for each step of the code, and where the row starts and how far apart they are. */
const NOTCH_U = 0.024, NOTCH_TOP = 0.22, NOTCH_H = 0.055, NOTCH_STEP = 0.09
/** The hole at the top corner, and the seal. */
const HOLE = { x: -0.12, y: 0.27, r: 0.045 }
const SEAL = { x: -0.04, y: -0.06, r: 0.12 }

/** The card's outline, for a token 1 across, its notch code cut down its right edge. */
export function cardOutline(id: string): Array<[number, number]> {
  const pts: Array<[number, number]> = [[-W + CUT, H], [W, H]]
  let y = NOTCH_TOP
  for (const b of notchCode(id)) {
    pts.push([W, y], [W - b * NOTCH_U, y], [W - b * NOTCH_U, y - NOTCH_H], [W, y - NOTCH_H])
    y -= NOTCH_STEP
  }
  pts.push([W, -H + CUT], [W - CUT, -H], [-W, -H], [-W, H - CUT])
  return pts
}

/** The card made solid, with its hole. */
export function cardGeometry(id: string): BufferGeometry {
  return slab(shapeFrom(cardOutline(id), [circleHole(HOLE.x, HOLE.y, HOLE.r)]), T)
}

/** The maker's seal, inlaid on both faces. */
const SEAL_GEOMETRY = sealInlay([shapeFrom(hexPoints(SEAL.r, SEAL.x, SEAL.y))], T)
/** The seal's initial on both faces, turned on the back so it reads. */
const INITIAL_GEOMETRY = (() => {
  const g = new PlaneGeometry(SEAL.r * 1.25, SEAL.r * 1.25)
  g.translate(SEAL.x, SEAL.y - SEAL.r * 0.04, 0)
  return bothFaces(g, T / 2 + SEAL_DEPTH + 0.002, true)
})()

/** The token's bob each way, for a token 1 across: the shared bob. */
export const TOKEN_BOB = BOB

/**
 * How far a token 1 across reaches under its middle as drawn: its card's
 * lowest edge. It turns only about the up axis, so no turn changes a height;
 * its ring faces the camera, a halo about it rather than it, and is not
 * counted, as a letter's ring is not.
 */
export const TOKEN_LOW = H

/**
 * How far over its place a token is drawn, for a token 1 across: its lowest
 * point at the bottom of its bob stands REST_HOVER over its place's level.
 */
export const TOKEN_LIFT = restLift(TOKEN_LOW, TOKEN_BOB)

/** The shape its name stands clear of, for a token 1 across (WorldLabel `clear` shape): the shared ring reach, and the card turning in it. */
export const TOKEN_SHAPE = labelShape(0.52, 0.45)

const INITIAL_VERTEX = /* glsl */ `
  uniform float uGlyph;
  varying vec2 vUv;
  ${ATLAS_UV}
  void main() {
    vUv = atlasUv(uGlyph, uv);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const INITIAL_FRAGMENT = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    if (texture2D(uAtlas, vUv).a < 0.5) discard;
    gl_FragColor = vec4(uColor, uOpacity);
  }
`

export function ItemToken({ id, at, side, colour, initial, state = 'unread', opacity = 1, fadeOut, groupRef }: {
  /** What it stands for: its own starting angle and its notch code. */
  id: string
  at: [number, number, number]
  /** Its height in scene units (keyBoxSide): one gibson. */
  side: number
  /** Its maker's colour, a #hex: its seal. */
  colour: string
  /** Its maker's initial, as its index in the glyph atlas (glyphAtlas atlasIndex); none, no initial. */
  initial?: number
  /** NEW, UNREAD or READ (lib/hiddenLook hiddenState). */
  state?: HiddenState
  opacity?: number
  /** From this moment (performance.now()), fading out over MARK_FADE_MS and then gone: TAKE. */
  fadeOut?: number
  /** Handed the token's group, which stands where it rests and bobs. */
  groupRef?: MutableRefObject<Group | null>
}): JSX.Element {
  const reduced = useReducedMotion()
  const own = useRef<Group | null>(null)
  const group = groupRef ?? own
  const body = useRef<Group>(null)
  const ring = useRef<Group>(null)
  const pulse = useRef<Mesh>(null)
  const pulseNow = useMemo(() => ({ scale: 0, opacity: 0 }), [])
  const look = hiddenLook(state)
  // Fading out (TAKE), the faces are see-through from the start, so their opacity takes: the tag blend ignores it.
  const faceOpacity = fadeOut !== undefined ? Math.min(opacity, 0.999) : opacity
  const materials = useMemo(() => ({
    core: faceMaterial(faceOpacity),
    seal: new MeshBasicMaterial({ color: colour, toneMapped: false, ...basicFaceProps(faceOpacity, { ghost: false, world: true }), side: DoubleSide }),
    initial: new ShaderMaterial({
      vertexShader: INITIAL_VERTEX,
      fragmentShader: INITIAL_FRAGMENT,
      uniforms: { uAtlas: { value: glyphAtlas() }, uColor: { value: new Color(SEAL_INK) }, uOpacity: { value: faceOpacity }, uGlyph: { value: initial ?? 0 } },
      ...basicFaceProps(faceOpacity, { ghost: false, world: true }),
    }),
    line: outlineMaterial({ color: look.outline, opacity }),
    ring: lineRingMaterial(look.ringOpacity * opacity),
    pulse: pulseMaterial(),
  // The outline's colour and the ring's opacity are set every frame from the state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [colour, faceOpacity, opacity, initial])
  useEffect(() => () => { for (const m of Object.values(materials)) m.dispose() }, [materials])
  const card = useMemo(() => {
    const geometry = cardGeometry(id)
    const lines = outlineLines(edgeSegments(geometry, 30), materials.line)
    lines.name = 'item-token-lines'
    return { geometry, lines }
  }, [id, materials])
  useEffect(() => () => { card.geometry.dispose(); card.lines.geometry.dispose() }, [card])
  const ringLine = useMemo(() => {
    const l = liveOutlineLines(lineRingGeometry(), materials.ring)
    l.name = 'item-token-ring'
    return l
  }, [materials])
  useEffect(() => () => ringLine.geometry.dispose(), [ringLine])
  const phase = useMemo(() => (seedOf(id) / 4294967296) * Math.PI * 2, [id])
  const ringColour = useMemo(() => new Color(RING_COLOUR), [])
  const waved = useRef(false)

  useFrame((state3) => {
    const g = group.current
    if (!g) return
    let left = 1
    if (fadeOut !== undefined) {
      left = markFadeLeft(performance.now() - fadeOut)
      g.visible = left > 0
      setFaceOpacity(materials.core, faceOpacity * left)
      materials.seal.opacity = faceOpacity * left
      materials.initial.uniforms.uOpacity.value = faceOpacity * left
    }
    sizeOutline(materials.line, state3.size)
    sizeOutline(materials.ring, state3.size)
    materials.line.color.set(look.outline)
    materials.line.linewidth = look.outlinePx
    materials.line.opacity = opacity * left
    materials.ring.opacity = look.ringOpacity * opacity * left
    const t = state3.clock.elapsedTime
    g.position.set(at[0], at[1] + (TOKEN_LIFT + bobAt(t, phase, reduced)) * side, at[2])
    g.scale.setScalar(side)
    if (body.current) body.current.rotation.set(0, turnAt(t, phase, reduced), 0)
    const r = ring.current
    if (r) {
      // The ring faces the camera; the group holding it never turns.
      r.quaternion.copy(state3.camera.quaternion)
      // The idle wave running round it: rewritten each frame, once with reduced motion.
      if (!reduced || !waved.current) {
        waved.current = true
        const turn = ringTurnAt(t, reduced)
        const wph = wavePhaseAt(t, reduced)
        const cols = segmentColours(ringLine.geometry)
        for (let i = 0; i < LINE_RING_SEGMENTS; i++) {
          for (let k = 0; k < 2; k++) {
            const v = 0.45 + 0.55 * waveAt(((i + k) / LINE_RING_SEGMENTS) * Math.PI * 2 + turn, wph)
            const o = i * 6 + k * 3
            cols[o] = ringColour.r * v; cols[o + 1] = ringColour.g * v; cols[o + 2] = ringColour.b * v
          }
        }
        ;(ringLine.geometry.getAttribute('instanceColorStart') as InterleavedBufferAttribute).data.needsUpdate = true
      }
      const p = pulse.current
      if (p) {
        p.visible = look.pulse
        if (look.pulse) {
          const now = pulseAt(t, phase, reduced, pulseNow)
          p.scale.setScalar(RING_REACH * now.scale)
          materials.pulse.opacity = now.opacity * opacity * left
        }
      }
    }
  }, LABEL_PRIORITY)

  return (
    <group ref={group} position={[at[0], at[1] + TOKEN_LIFT * side, at[2]]} scale={side} name="item-token">
      <group ref={body} rotation={[0, phase, 0]}>
        <mesh geometry={card.geometry} material={materials.core} name="item-token-core" />
        <primitive object={card.lines} />
        <mesh geometry={SEAL_GEOMETRY} material={materials.seal} name="item-token-seal" />
        {initial !== undefined && <mesh geometry={INITIAL_GEOMETRY} material={materials.initial} name="item-token-initial" />}
      </group>
      <group ref={ring}>
        <primitive object={ringLine} />
        <mesh ref={pulse} geometry={PULSE_GEOMETRY} material={materials.pulse} visible={false} frustumCulled={false} name="item-token-pulse" />
      </group>
    </group>
  )
}
