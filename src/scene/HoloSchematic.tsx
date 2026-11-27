/**
 * HoloSchematic.tsx - a blueprint card in the world (DECK-0010 §7.3), in the
 * hidden things' one rulebook (lib/hiddenLook.ts, scene/hiddenParts.ts; #945
 * and the owner's word: everything but the blocks is expendable):
 *
 * - its blocks, in their own colours and kept out of the glow (TAG_BLEND),
 *   each outlined in its own edge colour at the rulebook's 1.5 px; a hidden
 *   cell is grey smoke;
 * - corner brackets round a 0.84 box (option B), 1.5 px, through the shared
 *   outline material, coloured by its state (NEW, UNREAD, READ);
 * - a scan plane climbing it once every WAVE_S, the rulebook's wave;
 * - the thin camera-facing line ring riding the wave, and the pulse while
 *   NEW;
 * - the rulebook's bob, standing over its place (restLift); it never turns:
 *   a blueprint is read in the world's own axes (§3.1), so its blocks are
 *   drawn in cyberspace X, Y and Z whichever way the view is turned.
 *
 * The world marker has no axis compass and no sun (the sheet and the card
 * keep theirs). Pure drawing: the caller places it (`at`, render frame),
 * sizes it (`side`, scene units), and holds its tap target and its name.
 */

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  BoxGeometry, Color, DoubleSide, EdgesGeometry, InstancedMesh, MeshBasicMaterial, Object3D, PlaneGeometry, type Group, type InterleavedBufferAttribute, type Mesh,
} from 'three'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { cellAt, type FinderView } from '../lib/blueprint/format'
import { blockKind } from '../lib/terrain/blocks'
import { ACCENT } from '../lib/palette'
import type { ViewAxes } from '../lib/space'
import { BOB, RING_COLOUR, RING_REACH, WAVE_S, bobAt, hiddenLook, pulseAt, ringTurnAt, waveAt, wavePhaseAt, type HiddenState } from '../lib/hiddenLook'
import { restLift } from '../lib/restLift'
import { LINE_RING_SEGMENTS, PULSE_GEOMETRY, lineRingGeometry, lineRingMaterial, liveOutlineLines, outlineLines, outlineMaterial, pulseMaterial, segmentColours, sizeOutline } from './hiddenParts'
import { basicFaceProps } from './shardFaces'

type V3 = [number, number, number]

/** How much of the cube the model fills along its longest side. */
export const MODEL_FILL = 0.72
/** Each cell's cube as a share of its cell, so the voxels read apart. */
const VOXEL_SHARE = 0.86
/** The smoke's grey and how see-through it is. */
const SMOKE = '#aeb8c2'
const SMOKE_OPACITY = 0.26
/** The bracketed box, for a marker one across, and how long each bracket's arm is, as a share of its edge. */
export const BRACKET_BOX = 0.84
const BRACKET_ARM = 0.22
/** How far it stands over its place, for one across: its box's half, its bob and the rulebook's hover. */
export const SCHEMATIC_LIFT = restLift(BRACKET_BOX / 2, BOB)

/** A cyberspace vector in the render frame: the view's signed permutation of axes (lib/space.ts itemCentre). */
export function toRender(axes: ViewAxes, v: readonly number[]): V3 {
  const at = (a: 'x' | 'y' | 'z'): number => (a === 'x' ? v[0] : a === 'y' ? v[1] : v[2])
  return [at(axes.right.axis) * axes.right.dir + 0, at(axes.up.axis) * axes.up.dir + 0, at(axes.out.axis) * axes.out.dir + 0]
}

/** The model's cells inside a cube of side 1 centred on the origin, in cyberspace axes: hidden ones and revealed ones with their colour. */
export function schematicCells(view: FinderView): { k: number; smoke: V3[]; solid: Array<{ at: V3; color: string; edge: string }> } {
  const [sx, sy, sz] = view.size
  const k = MODEL_FILL / Math.max(sx, sy, sz, 1)
  const smoke: V3[] = []
  const solid: Array<{ at: V3; color: string; edge: string }> = []
  view.occupied.forEach((occ, i) => {
    if (!occ) return
    const [x, y, z] = cellAt(view.size, i)
    const at: V3 = [(x + 0.5 - sx / 2) * k, (y + 0.5 - sy / 2) * k, (z + 0.5 - sz / 2) * k]
    const id = view.revealed.get(i)
    if (id === undefined) smoke.push(at)
    else solid.push({ at, color: blockKind(id)?.color ?? SMOKE, edge: blockKind(id)?.edge ?? SMOKE })
  })
  return { k, smoke, solid }
}

// Shared by every schematic: never disposed.
const UNIT_BOX = new BoxGeometry(1, 1, 1)
const SCAN_PLANE = new PlaneGeometry(1, 1)

/** Which render axis (0 right, 1 up, 2 out) carries a cyberspace axis, for the scan plane. */
function renderIndexOf(axes: ViewAxes, axis: 'x' | 'y' | 'z'): 0 | 1 | 2 {
  return axes.right.axis === axis ? 0 : axes.up.axis === axis ? 1 : 2
}

/** The corner brackets of a cube of side `b` centred on the origin: three arms at each of its eight corners, six numbers a segment. */
export function bracketSegments(b: number, arm = BRACKET_ARM): Float32Array {
  const h = b / 2, a = b * arm
  const out: number[] = []
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const c: V3 = [sx * h, sy * h, sz * h]
    out.push(...c, c[0] - sx * a, c[1], c[2])
    out.push(...c, c[0], c[1] - sy * a, c[2])
    out.push(...c, c[0], c[1], c[2] - sz * a)
  }
  return new Float32Array(out)
}

/** Every revealed block's twelve edges at its place (render frame, one across), and their colours: each block's own edge colour. */
function blockEdges(cells: ReturnType<typeof schematicCells>, axes: ViewAxes): { positions: Float32Array; colours: Float32Array } {
  const unit = new EdgesGeometry(UNIT_BOX).getAttribute('position')
  const voxel = cells.k * VOXEL_SHARE
  const pos: number[] = []
  const col: number[] = []
  const c = new Color()
  for (const s of cells.solid) {
    const r = toRender(axes, s.at)
    c.set(s.edge)
    for (let i = 0; i < unit.count; i++) {
      pos.push(r[0] + unit.getX(i) * voxel, r[1] + unit.getY(i) * voxel, r[2] + unit.getZ(i) * voxel)
      col.push(c.r, c.g, c.b)
    }
  }
  return { positions: new Float32Array(pos), colours: new Float32Array(col) }
}

interface Props {
  view: FinderView
  /** Its place in the render frame: it stands over it (SCHEMATIC_LIFT) and bobs. */
  at: V3
  /** Its size in scene units: one gibson. */
  side: number
  axes: ViewAxes
  /** NEW, UNREAD or READ (lib/hiddenLook hiddenState). */
  state?: HiddenState
  /** 1 in the world; a card already held draws fainter. */
  opacity?: number
  /** Its own phase, so markers side by side do not bob as one. */
  phase?: number
}

export function HoloSchematic({ view, at, side, axes, state = 'unread', opacity = 1, phase = 0 }: Props): JSX.Element {
  const reduced = useReducedMotion()
  const cells = useMemo(() => schematicCells(view), [view])
  const look = hiddenLook(state)

  const materials = useMemo(() => ({
    smoke: new MeshBasicMaterial({ color: SMOKE, toneMapped: false, ...basicFaceProps(Math.min(SMOKE_OPACITY * opacity, 0.999), { ghost: false, world: true }) }),
    solid: new MeshBasicMaterial({ color: '#ffffff', toneMapped: false, ...basicFaceProps(opacity, { ghost: false, world: true }) }),
    blockLines: outlineMaterial({ vertexColors: true, opacity }),
    brackets: outlineMaterial({ color: look.outline, opacity }),
    scan: new MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.12 * opacity, depthWrite: false, side: DoubleSide, forceSinglePass: true, toneMapped: false }),
    ring: lineRingMaterial(look.ringOpacity * opacity),
    pulse: pulseMaterial(),
  // The brackets' colour and the ring's opacity follow the state below, never by rebuilding.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [opacity])
  useEffect(() => () => { for (const m of Object.values(materials)) m.dispose() }, [materials])
  useLayoutEffect(() => {
    materials.brackets.color.set(look.outline)
    materials.brackets.linewidth = look.outlinePx
  }, [materials, look.outline, look.outlinePx])

  // The model: one instanced draw for the smoke, one for the revealed blocks, in a frame one across (the group scales).
  const smoke = useMemo(() => (cells.smoke.length ? new InstancedMesh(UNIT_BOX, materials.smoke, cells.smoke.length) : null), [cells, materials])
  const solid = useMemo(() => (cells.solid.length ? new InstancedMesh(UNIT_BOX, materials.solid, cells.solid.length) : null), [cells, materials])
  useEffect(() => () => { smoke?.dispose(); solid?.dispose() }, [smoke, solid])
  useLayoutEffect(() => {
    const o = new Object3D()
    const voxel = cells.k * VOXEL_SHARE
    const put = (mesh: InstancedMesh, i: number, v: V3): void => {
      const r = toRender(axes, v)
      o.position.set(r[0], r[1], r[2])
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
  }, [cells, smoke, solid, axes])

  // Each block's edges in its own edge colour; the brackets round the box.
  const edgeLines = useMemo(() => {
    if (!cells.solid.length) return null
    const { positions, colours } = blockEdges(cells, axes)
    const l = outlineLines(positions, materials.blockLines)
    l.geometry.setColors(colours)
    l.name = 'blueprint-block-lines'
    return l
  }, [cells, axes, materials])
  useEffect(() => () => edgeLines?.geometry.dispose(), [edgeLines])
  const bracketLines = useMemo(() => {
    const l = outlineLines(bracketSegments(BRACKET_BOX), materials.brackets)
    l.name = 'blueprint-brackets'
    return l
  }, [materials])
  useEffect(() => () => bracketLines.geometry.dispose(), [bracketLines])

  // The ring, the pulse, and the wave riding the ring.
  const ringGeometry = useMemo(() => lineRingGeometry(), [])
  useEffect(() => () => ringGeometry.dispose(), [ringGeometry])
  const ringLine = useMemo(() => {
    const l = liveOutlineLines(ringGeometry, materials.ring)
    l.name = 'blueprint-ring'
    return l
  }, [ringGeometry, materials])
  const ringColour = useMemo(() => new Color(RING_COLOUR), [])
  const pulseNow = useMemo(() => ({ scale: 0, opacity: 0 }), [])
  const waved = useRef<unknown>(null)

  // The scan plane lies across cyberspace Y and climbs it.
  const yIndex = renderIndexOf(axes, 'y')
  const ySign = [axes.right, axes.up, axes.out][yIndex].dir
  const scanRot: V3 = yIndex === 0 ? [0, Math.PI / 2, 0] : yIndex === 1 ? [-Math.PI / 2, 0, 0] : [0, 0, 0]

  const group = useRef<Group>(null)
  const ring = useRef<Group>(null)
  const scan = useRef<Mesh>(null)
  const pulse = useRef<Mesh>(null)
  useFrame((st) => {
    const g = group.current
    if (!g) return
    const t = st.clock.elapsedTime
    sizeOutline(materials.blockLines, st.size)
    sizeOutline(materials.brackets, st.size)
    sizeOutline(materials.ring, st.size)
    materials.ring.opacity = look.ringOpacity * opacity
    // The rulebook's bob, over its place; it never turns.
    g.position.set(at[0], at[1] + (SCHEMATIC_LIFT + bobAt(t, phase, reduced)) * side, at[2])
    g.scale.setScalar(side)
    const s = scan.current
    if (s) {
      const share = reduced ? 0.5 : (t % WAVE_S) / WAVE_S
      const along = (share - 0.5) * BRACKET_BOX * ySign
      s.position.set(yIndex === 0 ? along : 0, yIndex === 1 ? along : 0, yIndex === 2 ? along : 0)
      s.visible = !reduced
    }
    const r = ring.current
    if (r) {
      r.quaternion.copy(st.camera.quaternion)
      if (!reduced || waved.current !== ringGeometry) {
        waved.current = reduced ? ringGeometry : null
        const turn = ringTurnAt(t, reduced)
        const wph = wavePhaseAt(t, reduced)
        const cols = segmentColours(ringGeometry)
        for (let i = 0; i < LINE_RING_SEGMENTS; i++) {
          for (let k = 0; k < 2; k++) {
            const v = 0.45 + 0.55 * waveAt(((i + k) / LINE_RING_SEGMENTS) * Math.PI * 2 + turn, wph)
            const o = i * 6 + k * 3
            cols[o] = ringColour.r * v; cols[o + 1] = ringColour.g * v; cols[o + 2] = ringColour.b * v
          }
        }
        ;(ringGeometry.getAttribute('instanceColorStart') as InterleavedBufferAttribute).data.needsUpdate = true
      }
      const p = pulse.current
      if (p) {
        p.visible = look.pulse
        if (look.pulse) {
          const now = pulseAt(t, phase, reduced, pulseNow)
          p.scale.setScalar(RING_REACH * now.scale)
          materials.pulse.opacity = now.opacity * opacity
        }
      }
    }
  })

  return (
    <group ref={group} position={[at[0], at[1] + SCHEMATIC_LIFT * side, at[2]]} scale={side} name="blueprint-marker">
      {smoke && <primitive object={smoke} />}
      {solid && <primitive object={solid} />}
      {edgeLines && <primitive object={edgeLines} />}
      <primitive object={bracketLines} />
      <mesh ref={scan} geometry={SCAN_PLANE} material={materials.scan} scale={BRACKET_BOX * 0.98} rotation={scanRot} renderOrder={3} />
      <group ref={ring}>
        <primitive object={ringLine} />
        <mesh ref={pulse} geometry={PULSE_GEOMETRY} material={materials.pulse} visible={false} frustumCulled={false} name="blueprint-pulse" />
      </group>
    </group>
  )
}
