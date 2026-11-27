/**
 * HoloSchematic.tsx - a blueprint card in the world (DECK-0010 §7.3): a holo
 * schematic. A small wireframe cube of cyan lines, one gibson on a side as a
 * message's box is, with a smoke model of the blueprint's shape inside it and
 * the XYZ compass beside it: X red, Y green, Z blue, and past +Z the black
 * sun, a violet ring with a black centre.
 *
 * It holds still. A blueprint is read in the world's own axes (§3.1: no turns,
 * no mirror images), so the cube, the model and the compass are drawn in
 * cyberspace's X, Y and Z, whichever way the view is turned (ViewAxes), and
 * never spin or bob. Only light moves: a thin scan plane climbs through the
 * cube and the smoke breathes, and with reduced motion both hold still.
 *
 * The model: every occupied cell of the box as a small cube, scaled so the
 * whole box fits inside with room around it. A hidden cell is grey smoke,
 * see-through; a revealed one wears its block's colour (lib/terrain/blocks.ts
 * blockKind). A dark see-through core behind the lines keeps them readable
 * against a bright wall, as the item token's core does.
 *
 * Pure drawing: the caller places it (`at`, render frame) and sizes it
 * (`side`, scene units), and holds its tap target and its name.
 */

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, CircleGeometry, Color, DoubleSide, EdgesGeometry,
  InstancedMesh, LineBasicMaterial, MeshBasicMaterial, Object3D, PlaneGeometry, RingGeometry, type Group, type Mesh,
} from 'three'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { AXIS_COLOR, SUN_CORE, SUN_GLOW } from '../lib/blueprint/draw'
import { cellAt, type FinderView } from '../lib/blueprint/format'
import { blockKind } from '../lib/terrain/blocks'
import { ACCENT } from '../lib/palette'
import type { ViewAxes } from '../lib/space'

type V3 = [number, number, number]

/** How much of the cube the model fills along its longest side. */
export const MODEL_FILL = 0.72
/** Each cell's cube as a share of its cell, so the voxels read apart. */
const VOXEL_SHARE = 0.86
/** The smoke's grey and how see-through it is, breathing between the two. */
const SMOKE = '#aeb8c2'
const SMOKE_OPACITY: readonly [number, number] = [0.16, 0.3]
/** A revealed block's opacity. */
const SOLID_OPACITY = 0.9
/** The dark core behind the lines. */
const CORE = '#03121a'
const CORE_OPACITY = 0.38
/** The compass: where its origin stands beside the cube (cube units, cyberspace axes) and how long each axis is. */
const COMPASS_AT: V3 = [-0.68, -0.5, -0.68]
const COMPASS_LEN = 0.34
/** Seconds for the scan plane to climb the cube once. */
const SCAN_S = 3.2

/** A cyberspace vector in the render frame: the view's signed permutation of axes (lib/space.ts itemCentre). */
export function toRender(axes: ViewAxes, v: readonly number[]): V3 {
  const at = (a: 'x' | 'y' | 'z'): number => (a === 'x' ? v[0] : a === 'y' ? v[1] : v[2])
  return [at(axes.right.axis) * axes.right.dir + 0, at(axes.up.axis) * axes.up.dir + 0, at(axes.out.axis) * axes.out.dir + 0]
}

/** The model's cells inside a cube of side 1 centred on the origin, in cyberspace axes: hidden ones and revealed ones with their colour. */
export function schematicCells(view: FinderView): { k: number; smoke: V3[]; solid: Array<{ at: V3; color: string }> } {
  const [sx, sy, sz] = view.size
  const k = MODEL_FILL / Math.max(sx, sy, sz, 1)
  const smoke: V3[] = []
  const solid: Array<{ at: V3; color: string }> = []
  view.occupied.forEach((occ, i) => {
    if (!occ) return
    const [x, y, z] = cellAt(view.size, i)
    const at: V3 = [(x + 0.5 - sx / 2) * k, (y + 0.5 - sy / 2) * k, (z + 0.5 - sz / 2) * k]
    const id = view.revealed.get(i)
    if (id === undefined) smoke.push(at)
    else solid.push({ at, color: blockKind(id)?.color ?? SMOKE })
  })
  return { k, smoke, solid }
}

// Shared by every schematic: never disposed.
const UNIT_BOX = new BoxGeometry(1, 1, 1)
const UNIT_EDGES = new EdgesGeometry(UNIT_BOX)
const SCAN_PLANE = new PlaneGeometry(1, 1)
const SUN_RING = new RingGeometry(0.62, 1, 32)
const SUN_HALO = new RingGeometry(0.9, 1.6, 32)
const SUN_DISC = new CircleGeometry(0.64, 32)

/** Which render axis (0 right, 1 up, 2 out) carries cyberspace Y, for the scan plane. */
function renderIndexOf(axes: ViewAxes, axis: 'x' | 'y' | 'z'): 0 | 1 | 2 {
  return axes.right.axis === axis ? 0 : axes.up.axis === axis ? 1 : 2
}

interface Props {
  view: FinderView
  /** Its centre in the render frame. */
  at: V3
  /** The cube's edge in scene units. */
  side: number
  axes: ViewAxes
  /** 1 in the world; the ghost and a card already held draw fainter. */
  opacity?: number
}

export function HoloSchematic({ view, at, side, axes, opacity = 1 }: Props): JSX.Element {
  const still = useReducedMotion()
  const cells = useMemo(() => schematicCells(view), [view])

  const smokeMat = useMemo(() => new MeshBasicMaterial({ color: SMOKE, transparent: true, opacity: SMOKE_OPACITY[1] * opacity, depthWrite: false, toneMapped: false }), [opacity])
  const solidMat = useMemo(() => new MeshBasicMaterial({ color: '#ffffff', transparent: opacity < 1 || SOLID_OPACITY < 1, opacity: SOLID_OPACITY * opacity, toneMapped: false }), [opacity])
  const coreMat = useMemo(() => new MeshBasicMaterial({ color: CORE, transparent: true, opacity: CORE_OPACITY * opacity, depthWrite: false, side: DoubleSide, forceSinglePass: true }), [opacity])
  const edgeMat = useMemo(() => new LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.95 * opacity, toneMapped: false }), [opacity])
  const glowMat = useMemo(() => new LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.28 * opacity, blending: AdditiveBlending, depthWrite: false, toneMapped: false }), [opacity])
  const scanMat = useMemo(() => new MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.14 * opacity, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, forceSinglePass: true, toneMapped: false }), [opacity])
  const axisMat = useMemo(() => new LineBasicMaterial({ vertexColors: true, transparent: opacity < 1, opacity, toneMapped: false }), [opacity])
  const ringMat = useMemo(() => new MeshBasicMaterial({ color: SUN_CORE, transparent: opacity < 1, opacity, side: DoubleSide, forceSinglePass: true, toneMapped: false }), [opacity])
  const haloMat = useMemo(() => new MeshBasicMaterial({ color: SUN_GLOW, transparent: true, opacity: 0.35 * opacity, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, forceSinglePass: true, toneMapped: false }), [opacity])
  const discMat = useMemo(() => new MeshBasicMaterial({ color: '#000000', transparent: opacity < 1, opacity, side: DoubleSide, forceSinglePass: true }), [opacity])
  useEffect(() => () => { for (const m of [smokeMat, solidMat, coreMat, edgeMat, glowMat, scanMat, axisMat, ringMat, haloMat, discMat]) m.dispose() }, [smokeMat, solidMat, coreMat, edgeMat, glowMat, scanMat, axisMat, ringMat, haloMat, discMat])

  // The model: one instanced draw for the smoke, one for the revealed blocks.
  const smoke = useMemo(() => (cells.smoke.length ? new InstancedMesh(UNIT_BOX, smokeMat, cells.smoke.length) : null), [cells, smokeMat])
  const solid = useMemo(() => (cells.solid.length ? new InstancedMesh(UNIT_BOX, solidMat, cells.solid.length) : null), [cells, solidMat])
  useEffect(() => () => { smoke?.dispose(); solid?.dispose() }, [smoke, solid])
  useLayoutEffect(() => {
    const o = new Object3D()
    const voxel = cells.k * VOXEL_SHARE * side
    const put = (mesh: InstancedMesh, i: number, v: V3): void => {
      const r = toRender(axes, v)
      o.position.set(r[0] * side, r[1] * side, r[2] * side)
      o.scale.setScalar(voxel)
      o.updateMatrix()
      mesh.setMatrixAt(i, o.matrix)
    }
    if (smoke) { cells.smoke.forEach((v, i) => put(smoke, i, v)); smoke.instanceMatrix.needsUpdate = true; smoke.computeBoundingSphere() }
    if (solid) {
      const c = new Color()
      cells.solid.forEach((s, i) => { put(solid, i, s.at); solid.setColorAt(i, c.set(s.color)) })
      solid.instanceMatrix.needsUpdate = true
      if (solid.instanceColor) solid.instanceColor.needsUpdate = true
      solid.computeBoundingSphere()
    }
  }, [cells, smoke, solid, axes, side])

  // The compass's three axes, in their colours, from its origin beside the cube.
  const compass = useMemo(() => {
    const o = COMPASS_AT
    const ends: V3[] = [[o[0] + COMPASS_LEN, o[1], o[2]], [o[0], o[1] + COMPASS_LEN, o[2]], [o[0], o[1], o[2] + COMPASS_LEN]]
    const colours = [AXIS_COLOR.X, AXIS_COLOR.Y, AXIS_COLOR.Z].map((h) => new Color(h))
    const pos: number[] = []
    const col: number[] = []
    ends.forEach((e, i) => {
      for (const p of [o, e]) { const r = toRender(axes, p); pos.push(r[0] * side, r[1] * side, r[2] * side) }
      for (let j = 0; j < 2; j++) col.push(colours[i].r, colours[i].g, colours[i].b)
    })
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
    g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3))
    return g
  }, [axes, side])
  useEffect(() => () => compass.dispose(), [compass])
  // The black sun, past +Z of the compass, facing the camera.
  const sunAt = useMemo(() => {
    const r = toRender(axes, [COMPASS_AT[0], COMPASS_AT[1], COMPASS_AT[2] + COMPASS_LEN * 1.6])
    return [r[0] * side, r[1] * side, r[2] * side] as V3
  }, [axes, side])
  const sunR = side * 0.06

  // The scan plane lies across cyberspace Y and climbs it.
  const yIndex = renderIndexOf(axes, 'y')
  const ySign = [axes.right, axes.up, axes.out][yIndex].dir
  const scanRot: V3 = yIndex === 0 ? [0, Math.PI / 2, 0] : yIndex === 1 ? [-Math.PI / 2, 0, 0] : [0, 0, 0]

  const sun = useRef<Group>(null)
  const scan = useRef<Mesh>(null)
  useFrame((state) => {
    // The sun's ring faces the camera: it is a mark, not a thing with a side.
    sun.current?.quaternion.copy(state.camera.quaternion)
    const t = state.clock.elapsedTime
    const s = scan.current
    if (s) {
      const share = still ? 0.5 : (t % SCAN_S) / SCAN_S
      const along = (share - 0.5) * 0.96 * side * ySign
      s.position.set(yIndex === 0 ? along : 0, yIndex === 1 ? along : 0, yIndex === 2 ? along : 0)
      s.visible = !still
    }
    if (!still) {
      const breath = 0.5 + 0.5 * Math.sin(t * 1.6)
      smokeMat.opacity = (SMOKE_OPACITY[0] + (SMOKE_OPACITY[1] - SMOKE_OPACITY[0]) * breath) * opacity
    }
  })

  return (
    <group position={at}>
      <mesh geometry={UNIT_BOX} material={coreMat} scale={side * 0.98} renderOrder={1} />
      <lineSegments geometry={UNIT_EDGES} material={edgeMat} scale={side} />
      <lineSegments geometry={UNIT_EDGES} material={glowMat} scale={side * 1.045} />
      {smoke && <primitive object={smoke} renderOrder={2} />}
      {solid && <primitive object={solid} />}
      <mesh ref={scan} geometry={SCAN_PLANE} material={scanMat} scale={side * 0.98} rotation={scanRot} renderOrder={3} />
      <lineSegments geometry={compass} material={axisMat} />
      <group ref={sun} position={sunAt} scale={sunR}>
        <mesh geometry={SUN_HALO} material={haloMat} />
        <mesh geometry={SUN_RING} material={ringMat} />
        <mesh geometry={SUN_DISC} material={discMat} />
      </group>
    </group>
  )
}
