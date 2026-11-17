/**
 * Bench.tsx — the workshop's 3D view.
 *
 * A grid at the current level, the shard drawn live in its mode, a handle on
 * every point, and a ghost of what the next tap would make. Taps do the work:
 * on the grid, STAMP lands a shape and ADD a vertex at the snapped point; on
 * a handle, SELECT picks it and FACE collects it; on a face, FACE selects it
 * and its corners, so the move handles move it and DELETE can take it.
 * One finger orbits in every tool (workshop redesign, phase 2, decision 1),
 * and so does the view ball at the top right. In SELECT, the BOX switch makes
 * a drag draw a box instead (arkinox, 2026-10-10): each box adds the points
 * inside it, so several little boxes build a selection, and REMOVE makes taps
 * and boxes take away. Two fingers pan and pinch; a two-finger tap undoes and
 * a three-finger tap redoes. Nothing on the bench lets go by itself: a tap on
 * empty space is nothing in every tool, and the held bar's count and Esc let
 * go. R3F
 * reports how far the pointer travelled between down and up, and the bench
 * compares that with a dead zone that depends on what pressed (deadZone.ts):
 * wide for a finger or a pen, narrow for a mouse. Inside the zone the orbit
 * is held still and a lift is a tap, so a thumb that rolls still picks the
 * point it pressed; past it, the drag is an orbit from there.
 *
 * The ghost is the aim. A mouse hovers it into place; a finger presses and
 * slides it; either way you see where the thing will land before it lands,
 * which on a grid seen in perspective is the difference between placing and
 * guessing.
 */

import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Line, LineBasicMaterial, PerspectiveCamera, Vector3, Matrix4 } from 'three'
import { markerEdges } from '../scene/avatarMarker'
import { ACCENT, BG, WARN } from '../lib/palette'
import { glowTexture } from '../lib/glow'
import { GRID_HALF, TICKS_PER_UNIT, centroid, pointKey, rgbToHex, ticksOf, toRender } from 'sno-core/shards'
import { BenchGrid } from './benchGrid'
import { VIEW_DIRS, benchAxes, notePose, frameOffset, frameZoom, nudgeFor, reportHandles, orbitOffset, planeAfter, sameAxes, setOrbitSink, useBenchView, type NudgeName } from './benchAxes'
import { landing, preview, type WorkPlane } from 'sno-core/stamps'
import { ShardMesh, faceOfHit } from '../scene/ShardMesh'
import { AnimClock, movingOn, reducedMotionNow } from '../scene/animMotion'
import { animOf, hasAnim } from '../lib/anim'
import { cycleSeconds } from '../lib/animEdit'
import type { ClockReading } from '../lib/worldClock'
import { useAnimPreview } from '../store/animPreview'
import { OVERLAY_ORDER } from '../scene/shardFaces'
import { ShardLights } from '../scene/shardLight'
import { nextSelection, ownAddress, useWorkshop, type Tool } from '../store/useWorkshop'
import { partMatrix } from 'sno-core/parts'
import { OwnPartsContext, useResolved } from '../lib/parts'
import { BASE_FAR, BASE_NEAR, MIN_DISTANCE, clipPlanes, fitDistance, nextMaxDistance, reachFor, reachRadius, shardSphere, type Sphere } from './benchReach'
import { useCyberspace } from '../store/useCyberspace'
import { Hold, multiPress, noteGesture, noteMultiTouch, slopFor, tapSlop } from './deadZone'
import { HandleDots, HandleHalos, HandleHits, PressMemory, dotCapacity, type Halo } from './handleDots'
import { keepPrograms } from '../lib/keepPrograms'
import { useBeginner } from './beginner'
import { BenchLookRig, BenchShard } from './benchLook'
import { isLook } from './lookTool'
import { BenchBloom } from './benchBloom'
import { usedBenchEye } from '../lib/avatarEye'
import { FacingArrow, FacingPreviewGroup } from './FacingPreview'
import { useFacingPreview } from '../store/facingPreview'

type P3 = [number, number, number]

/** The grid point a pointer over the plane means, at the level the store says. */
/**
 * The bench point (render units) to the nearest snap step, in model ticks, on
 * the current level. Model +Z is render -Z (shards.ts toRender), so the tap's
 * render z comes back negated.
 */
function snap(p: Vector3, level: number, step: number, plane: WorkPlane): P3 {
  const q = (v: number): number => Math.round((v * TICKS_PER_UNIT) / step) * step
  // The two coordinates in the plane snap; the one along its normal is the level.
  if (plane === 0) return [level, q(p.y), -q(p.z)]
  if (plane === 2) return [q(p.x), q(p.y), level]
  return [q(p.x), level, -q(p.z)]
}
/** Where the camera sits from its target when sent home: the bench's opening view, pulled back along it for a shard too big to fit there. */
const HOME: P3 = [10, 9, 12]
/** Ticks to render units, one axis (for Y, which is not mirrored). */
const U = (t: number): number => t / TICKS_PER_UNIT
/** A model position as the bench draws it. */
const UP = toRender

/**
 * You, to scale, at the grid's centre. An avatar is one gibson wide, and a
 * grid unit is 2^multiplier gibsons, so this is the body the shard is being
 * built around: a whole unit at multiplier 0, a speck at 2^10, gone by 2^20,
 * which is the point. White, as another identity is drawn in the world.
 */
function ScaleAvatar(): JSX.Element {
  const unit = useWorkshop((s) => s.current()?.unit ?? 0)
  // Standing on the grid, its lowest point its origin, as in the world (scene/avatarMarker.ts).
  const geometry = useMemo(() => markerEdges(true), [])
  useEffect(() => () => geometry.dispose(), [geometry])
  const k = Math.pow(2, -unit)
  return (
    <lineSegments geometry={geometry} scale={k} frustumCulled={false}>
      <lineBasicMaterial color="#ffffff" transparent opacity={0.85} toneMapped={false} />
    </lineSegments>
  )
}

/**
 * The axes, in the compass's colors: X red, Y green, Z blue. Not three's own
 * helper, whose blue points along render +Z: cyberspace +Z is drawn along
 * render -Z here as in the world, so the blue arrow goes that way.
 */
function BenchAxes({ reach }: { reach: number }): JSX.Element {
  const geometry = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute([0, 0, 0, reach, 0, 0, 0, 0, 0, 0, reach, 0, 0, 0, 0, 0, 0, -reach], 3))
    g.setAttribute('color', new Float32BufferAttribute([1, 0.2, 0.2, 1, 0.2, 0.2, 0.2, 1, 0.2, 0.2, 1, 0.2, 0.2, 0.4, 1, 0.2, 0.4, 1], 3))
    return g
  }, [reach])
  useEffect(() => () => geometry.dispose(), [geometry])
  // A hair above the grid plane, or the grid's centre lines draw over the red and blue.
  return (
    <lineSegments geometry={geometry} position={[0, 0.004, 0]} frustumCulled={false}>
      <lineBasicMaterial vertexColors toneMapped={false} />
    </lineSegments>
  )
}

function Grid(): JSX.Element {
  const level = useWorkshop((s) => s.level)
  const plane = useWorkshop((s) => s.plane)
  const division = useWorkshop((s) => s.division)
  const extent = useWorkshop((s) => s.current()?.extent ?? GRID_HALF)
  const tool = useWorkshop((s) => s.tool)
  // Not while FACING turns the shape on the bench: a tap would land where the turned shape is not (FacingPreview).
  const facingShown = useFacingPreview((s) => s.on)
  const places = (tool === 'add' || tool === 'stamp') && !facingShown
  const invalidate = useThree((s) => s.invalidate)
  // One quad and a shader, whatever the division and the extent (benchGrid.ts).
  const grid = useMemo(() => new BenchGrid(), [])
  useEffect(() => () => grid.dispose(), [grid])
  useLayoutEffect(() => { grid.set(extent, division); invalidate() }, [grid, extent, division, invalidate])

  const onClick = (e: ThreeEvent<MouseEvent>): void => {
    if (e.delta > tapSlop() || multiPress()) return
    e.stopPropagation()
    // Read the store at tap time rather than from the render closure: a level
    // changed a moment ago must apply to this tap even if the bench has not
    // re-rendered yet.
    const w = useWorkshop.getState()
    const at = snap(e.point, w.level, w.step(), w.plane)
    if (w.tool === 'stamp' && w.stampMode === 'object') {
      w.placeObject(at, ownAddress(useCyberspace.getState().identity.pubkey, w.currentId))
    } else if (w.tool === 'stamp') w.placeStamp(at)
    else w.addVertex(at)
  }

  const onMove = (e: ThreeEvent<PointerEvent>): void => {
    const w = useWorkshop.getState()
    w.setAim(snap(e.point, w.level, w.step(), w.plane))
  }

  // A finger lifts and the ghost goes with it; a mouse keeps hovering.
  const onUp = (e: ThreeEvent<PointerEvent>): void => {
    if (e.pointerType !== 'mouse') useWorkshop.getState().setAim(null)
  }

  // The grid is drawn on the floor and turned to its plane: a quarter about Z
  // to face +X, a quarter about X to face +Z (render -Z is model +Z, so the
  // level along model Z sits at render -level).
  const position: P3 = plane === 0 ? [U(level), 0, 0] : plane === 2 ? [0, 0, -U(level)] : [0, U(level), 0]
  const rotation: P3 = plane === 0 ? [0, 0, -Math.PI / 2] : plane === 2 ? [Math.PI / 2, 0, 0] : [0, 0, 0]
  return (
    <group position={position} rotation={rotation}>
      {/* The visible lattice: a line for every unit and every division of one, so what you tap is what you get. */}
      <primitive object={grid.mesh} />
      {/*
        The surface taps land on, in the placing tools only. In select and face
        mode it carries no handler at all, so the raycaster ignores it: a raised
        grid plane must not sit in front of the vertex handles and swallow the
        taps meant for them. A tap on empty space there is nothing at all
        (arkinox, 2026-10-10: it used to deselect, and on a phone it kept doing
        so by accident).
      */}
      {places && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} onClick={onClick} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => useWorkshop.getState().setAim(null)}>
          <planeGeometry key={extent} args={[extent * 2 + 1, extent * 2 + 1]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
    </group>
  )
}

/** What the next tap would make, drawn faint where it would land. */
function Ghost(): JSX.Element | null {
  const aim = useWorkshop((s) => s.aim)
  const tool = useWorkshop((s) => s.tool)
  const kind = useWorkshop((s) => s.stampKind)
  const size = useWorkshop((s) => s.stampSize)
  const facing = useWorkshop((s) => s.stampFacing)
  const color = useWorkshop((s) => s.color)
  const plane = useWorkshop((s) => s.plane)
  const mode = useWorkshop((s) => s.stampMode)
  const object = useWorkshop((s) => s.stampObject)
  const unit = useWorkshop((s) => s.current()?.unit ?? 0)
  // Built once per shape, color and plane; the aim only moves it. Built per cell, the
  // ghost cost a fresh geometry every time the pointer crossed a grid line.
  const model = useMemo(() => (tool === 'stamp' && mode === 'shape' ? preview(kind, size, facing, color, plane) : null), [tool, mode, kind, size, facing, color, plane])
  const extent = useWorkshop((s) => s.current()?.extent ?? GRID_HALF)
  if (!aim) return null
  if (tool === 'stamp' && mode === 'object') {
    if (!object) return null
    // Through the same placement a tap makes (store placeObject), so the ghost
    // stands exactly where and how the object will.
    const m = new Matrix4().fromArray(partMatrix({ ref: 0, at: aim, turn: [0, (90 * facing) % 360, 0], step: 0 }, unit, object.shard.unit))
    return (
      <group matrix={m} matrixAutoUpdate={false}>
        <ShardMesh shard={object.shard} ghost still />
      </group>
    )
  }
  if (tool === 'add') {
    return (
      <mesh position={UP(aim)} renderOrder={OVERLAY_ORDER}>
        <sphereGeometry args={[0.1, 12, 12]} />
        <meshBasicMaterial color={rgbToHex(color)} transparent opacity={0.5} toneMapped={false} depthWrite={false} />
      </mesh>
    )
  }
  if (!model) return null
  return (
    <group position={UP(landing(kind, size, facing, aim, extent, plane))}>
      <ShardMesh shard={model} ghost still />
    </group>
  )
}

/**
 * Handle sizes in CSS pixels, not bench units.
 *
 * Each handle is scaled by its own distance from the camera (handleDots.ts,
 * and `ScreenScale` for a picked corner's ring), so a radius of 1 draws one
 * pixel across whatever the zoom.
 * That is the whole point: a ball sized in the world is a good target when you
 * are looking at the whole shard and a screenful when you lean in to place two
 * points inside one gibson. Constant on screen, it is the same target at every
 * zoom, and zooming in spreads the points apart underneath it, which is what
 * makes close work possible.
 */
const DOT_R = 4.25
const DOT_ON_R = 6
const HALO_PX = 26
const RING_R = 11
const RING_OUT = 13
/**
 * The finger target, in CSS pixels of radius (the handle holds its size on
 * screen). Bigger than the dot everywhere. In ADD it is small, because a tap
 * beside a point means the plane, and places another point near it. In FACE
 * it is the largest of all: the corner is the thing being aimed at, three or
 * four times in a row, and at 5.5 it was the same eleven pixel circle as ADD,
 * which made joining corners into a face a matter of luck on a phone. A tap
 * on a drawn face away from its corners still selects the face.
 */
const HIT_R = 12
const HIT_FACE_R = 16
const HIT_NARROW_R = 5.5
function hitRadiusFor(tool: Tool): number {
  if (tool === 'add') return HIT_NARROW_R
  if (tool === 'face' || tool === 'paint') return HIT_FACE_R
  return HIT_R
}

/**
 * A group that holds its size on screen: scaled by its distance from the camera
 * and the view's pixels per world unit, so its children's units are CSS pixels.
 */
function ScreenScale({ position, children }: { position: [number, number, number]; children: React.ReactNode }): JSX.Element {
  const ref = useRef<Group>(null)
  useFrame((state) => {
    const g = ref.current
    if (!g) return
    const cam = state.camera as PerspectiveCamera
    const perPixel = 2 * Math.tan((cam.fov * Math.PI) / 360) / fieldHeight(cam, state.size.height)
    g.scale.setScalar(Math.max(1e-5, cam.position.distanceTo(g.position) * perPixel))
  })
  return <group ref={ref} position={position}>{children}</group>
}

/**
 * One handle per point. Several vertices can share a point once stamps have
 * landed on each other; they read and act as one, so they draw as one.
 *
 * However many points there are, this is three objects in three's scene and
 * no React element per point (handleDots.ts): the dots, their halos, and one
 * invisible object that answers taps by arithmetic and says which point it
 * met. A mesh and a group per point, each with a frame callback, cost a
 * Basilica nave 3,462 matrices and 1,731 callbacks every frame, and a re-diff
 * of 1,731 elements on every tap (arkinox, 2026-10-31: "locking up only a
 * minute after opening it"). A corner picked for a face keeps its ring, as
 * its own object: a face has few corners.
 */
export function Handles(): JSX.Element | null {
  const shard = useWorkshop((s) => s.current())
  const selection = useWorkshop((s) => s.selection)
  const facePick = useWorkshop((s) => s.facePick)
  const tool = useWorkshop((s) => s.tool)
  const previewing = useAnimPreview((s) => s.on)
  const moving = previewing
  const invalidate = useThree((s) => s.invalidate)
  const chosen = useMemo(() => new Set(selection), [selection])
  const groups = useMemo(() => {
    const m = new Map<string, number[]>()
    shard?.vertices.forEach((v, i) => {
      const k = pointKey(ticksOf(v))
      const g = m.get(k)
      if (g) g.push(i); else m.set(k, [i])
    })
    return [...m.values()]
  }, [shard?.vertices])
  // Made again only when the points outgrow them, so placing points one by one does not make one each time.
  const capacity = dotCapacity(groups.length)
  const dots = useMemo(() => new HandleDots(capacity), [capacity])
  useEffect(() => () => dots.dispose(), [dots])
  const halos = useMemo(() => new HandleHalos(capacity, glowTexture(), HALO_PX, 0.85), [capacity])
  useEffect(() => () => halos.dispose(), [halos])
  const hits = useMemo(() => new HandleHits(), [])
  const pickedSet = useMemo(() => new Set(facePick), [facePick])
  useLayoutEffect(() => {
    if (!shard) { dots.set([]); halos.set([]); hits.set([]); invalidate(); return }
    const at = groups.map((g) => UP(ticksOf(shard.vertices[g[0]])))
    const lit: Halo[] = []
    dots.set(groups.map((g, k) => {
      const isSel = g.some((i) => chosen.has(i))
      const picked = pickedSet.size > 0 && g.some((i) => pickedSet.has(i))
      if (isSel || picked) lit.push({ at: at[k], color: isSel ? WARN : ACCENT })
      return { at: at[k], radiusPx: isSel || picked ? DOT_ON_R : DOT_R, color: isSel ? WARN : picked ? ACCENT : rgbToHex(shard.vertices[g[0]].c) }
    }))
    halos.set(lit)
    hits.set(at)
    // These are written behind R3F's back, which would not know to draw.
    invalidate()
  }, [dots, halos, hits, groups, shard, chosen, pickedSet, invalidate])
  useLayoutEffect(() => { hits.radiusPx = hitRadiusFor(tool) }, [hits, tool])
  useFrame((state) => {
    dots.update(state.camera as PerspectiveCamera, fieldHeight(state.camera as PerspectiveCamera, state.size.height))
    hits.heightPx = fieldHeight(state.camera as PerspectiveCamera, state.size.height)
  })
  const pressed = useMemo(() => new PressMemory(), [])
  if (!shard) return null
  // LOOK shows the shard as the world does, with no handles (benchLook.tsx).
  if (isLook(tool)) return null
  // In the motion preview a shard with `anim` is drawn moving (ShardMesh \`still\`): handles at its rest pose would hang in the air beside it.
  if (moving && hasAnim(shard)) return null

  const onPress = (e: ThreeEvent<PointerEvent>): void => { pressed.press(e.nativeEvent, e.index) }

  const onClick = (e: ThreeEvent<MouseEvent>): void => {
    if (e.delta > tapSlop() || multiPress()) return
    const g = e.index === undefined ? undefined : groups[e.index]
    if (!g || !pressed.met(e.index as number)) return
    const first = g[0]
    const isSel = g.some((i) => chosen.has(i))
    const w = useWorkshop.getState()
    // The sphere stands proud of the faces, so it meets the ray first even when
    // the tap was on a face beside the corner. If a face is under the tap and
    // the ray passes farther from the corner than its drawn dot, the face won.
    // Either side of a face, the nearer first (ShardMesh faceOfHit).
    const face = e.intersections.map(faceOfHit).find((f) => f !== null) ?? null
    const faceWins = (): boolean => {
      if (face === null) return false
      const centre = new Vector3(...UP(ticksOf(shard.vertices[first])))
      // The dot's drawn radius in world units: its pixels times a pixel's size there.
      const cam = e.camera as PerspectiveCamera
      return e.ray.distanceToPoint(centre) > DOT_ON_R * hits.pixelAt(e.index as number, cam.position, cam.fov)
    }
    // SELECT takes what its switch says: a point here, a face under the tap,
    // or nothing, so a placed object under the dot gets the tap.
    if (tool === 'select' && w.selectKind !== 'points') {
      if (w.selectKind === 'faces' && face !== null) { e.stopPropagation(); w.selectFace(face) }
      return
    }
    e.stopPropagation()
    if (tool === 'paint') {
      // POINT paints the point it met, however wide the hit; FACE paints the
      // face under the tap, however near a corner; the rest go by which the
      // tap was nearer to, the dot or the face.
      const onFace = face !== null && w.paintMode !== 'point' && (w.paintMode === 'face' || faceWins())
      const hit = onFace ? { face: face as number } : { vertex: first }
      // The dropper, armed: this tap takes a color instead, once.
      if (w.paintTake) { w.takeColorAt(hit); w.setPaintTake(false) } else w.paintTap(hit)
      return
    }
    // FACE only makes faces (phase 3, decision 3): a tap picks a corner.
    if (tool === 'face') w.pickForFace(first)
    // In SELECT a tap adds or removes the point; elsewhere it picks that point alone.
    else if (tool === 'select') w.toggleVertex(first)
    else w.selectVertex(isSel ? null : first)
  }

  return (
    <>
      <primitive object={dots.mesh} />
      <primitive object={halos.points} renderOrder={OVERLAY_ORDER} />
      <primitive object={hits} onPointerDown={onPress} onClick={onClick} />
      {facePick.length > 0 && groups.filter((g) => g.some((i) => pickedSet.has(i))).map((g) => (
        <ScreenScale key={g[0]} position={UP(ticksOf(shard.vertices[g[0]]))}>
          <mesh>
            <ringGeometry args={[RING_R, RING_OUT, 24]} />
            <meshBasicMaterial color={ACCENT} toneMapped={false} side={2} />
          </mesh>
        </ScreenScale>
      ))}
    </>
  )
}

/** The face being picked, as a line through its corners so far, closing once it could. */
function PickLoop(): JSX.Element | null {
  const shard = useWorkshop((s) => s.current())
  const facePick = useWorkshop((s) => s.facePick)
  const look = useWorkshop((s) => isLook(s.tool))
  const line = useMemo(() => {
    if (!shard || facePick.length < 2) return null
    const pts = facePick.map((i) => shard.vertices[i]).filter((v) => !!v).map((v) => UP(ticksOf(v)))
    if (pts.length >= 3) pts.push(pts[0])
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(pts.flat(), 3))
    const l = new Line(g, new LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.6, toneMapped: false }))
    l.frustumCulled = false
    l.renderOrder = OVERLAY_ORDER
    return l
  }, [shard, facePick])
  useEffect(() => () => { line?.geometry.dispose(); line?.material.dispose() }, [line])
  return line && !look ? <primitive object={line} /> : null
}

/**
 * The faces tapped in FACE mode, each lit in the selection color so DELETE and
 * the bucket have a visible target. Every one in hand stays lit (arkinox,
 * 2026-10-31). One fill and one set of outlines however many there are: made
 * when the faces in hand or the shard change, never per frame.
 */
export function FaceHighlight(): JSX.Element | null {
  const shard = useWorkshop((s) => s.current())
  const faces = useWorkshop((s) => s.selectedFaces)
  const look = useWorkshop((s) => isLook(s.tool))
  const lit = useMemo(() => {
    if (!shard || faces.length === 0) return null
    const fill: number[] = []
    const lines: number[] = []
    for (const k of faces) {
      const f = shard.faces[k]
      if (!f) continue
      const [a, b, c] = f.map((i) => UP(ticksOf(shard.vertices[i])))
      fill.push(...a, ...b, ...c)
      lines.push(...a, ...b, ...b, ...c, ...c, ...a)
    }
    if (fill.length === 0) return null
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(fill, 3))
    const e = new BufferGeometry()
    e.setAttribute('position', new Float32BufferAttribute(lines, 3))
    return { g, e }
  }, [shard, faces])
  useEffect(() => () => { lit?.g.dispose(); lit?.e.dispose() }, [lit])
  if (!lit || look) return null
  // Transparent, at OVERLAY_ORDER, the fill and the outlines alike: both draw
  // after a see-through shard's faces (order 1), or a face blends over them
  // and the highlight vanishes on a see-through shard (shardFaces.ts).
  return (
    <>
      <mesh geometry={lit.g} frustumCulled={false} renderOrder={OVERLAY_ORDER}>
        <meshBasicMaterial color={WARN} transparent opacity={0.5} side={DoubleSide} forceSinglePass depthWrite={false} polygonOffset polygonOffsetFactor={-4} toneMapped={false} />
      </mesh>
      <lineSegments geometry={lit.e} frustumCulled={false} renderOrder={OVERLAY_ORDER}>
        <lineBasicMaterial color={WARN} toneMapped={false} transparent />
      </lineSegments>
    </>
  )
}

/**
 * The orbit's dead zone. OrbitControls starts turning on the first pixel of a
 * drag, so a thumb pressing a dot moved the view under itself. From the press
 * until it has travelled past the slop for its pointer type, the controls'
 * rotate speed is zero: the view holds still and a lift is a tap. Once past,
 * the speed comes back and the drag orbits from there with no jump, because
 * the controls measure each move from the last one. The press's pointer type
 * is noted here, in capture, before any tap handler runs, so tapSlop() is
 * right for the taps of this very press. A second finger means a pan, which
 * has its own speed and is never held.
 */
function OrbitHold(): null {
  const gl = useThree((s) => s.gl)
  const controls = useThree((s) => s.controls) as unknown as { rotateSpeed: number } | null
  useEffect(() => {
    if (!controls) return
    const canvas = gl.domElement
    const speed = controls.rotateSpeed
    const hold = new Hold(tapSlop)
    const release = (): void => { if (hold.holding) controls.rotateSpeed = speed; hold.up() }
    const down = (e: PointerEvent): void => {
      if (!e.isPrimary) { release(); return }
      noteGesture(e.pointerType)
      if (e.button !== 0) return
      hold.down(e.clientX, e.clientY)
      controls.rotateSpeed = 0
    }
    const move = (e: PointerEvent): void => {
      if (!hold.holding) return
      if (!hold.move(e.clientX, e.clientY)) controls.rotateSpeed = speed
    }
    canvas.addEventListener('pointerdown', down, true)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    return () => {
      canvas.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
      controls.rotateSpeed = speed
    }
  }, [gl, controls])
  return null
}

/**
 * Aim the orbit at the shard's centre when you switch to it, and only then.
 * Re-aiming on every added vertex slid the whole view under your thumb each
 * time you tapped, which is exactly when you are looking at where to tap next.
 */
function Aim(): null {
  const id = useWorkshop((s) => s.currentId)
  const controls = useThree((s) => s.controls) as unknown as { target: Vector3; update: () => void } | null
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    // The browser harness projects handle positions through the camera to click them,
    // reaches the lights through the scene, and dollies the view through the controls
    // (setting the camera alone is undone on their next update).
    if (import.meta.env.DEV) Object.assign(window as unknown as Record<string, unknown>, { __benchCamera: camera, __benchScene: scene, __benchControls: controls })
  }, [camera, scene, controls])
  const target = useMemo(() => {
    const shard = useWorkshop.getState().current()
    return shard ? UP(centroid(shard)) : [0, 0, 0]
  }, [id])
  useEffect(() => {
    if (!controls) return
    controls.target.set(target[0], target[1], target[2])
    controls.update()
  }, [controls, target])
  return null
}

/**
 * A box dragged on the bench in SELECT with BOX on (workshop redesign,
 * phase 2): every point whose projection falls inside is added to the
 * selection, live as the box grows, and the box's own additions shrink back
 * as it does. Each box adds to what was in hand when the finger touched, so
 * several little boxes build a selection (arkinox, 2026-10-10, decision A);
 * under REMOVE a box takes away instead. The box is a plain element over the
 * canvas, drawn here without React. A tap (no drag) is left to the handles;
 * orbit is off while BOX is on (Bench), so a one-finger drag is the box's
 * alone, and the view ball turns the view meanwhile. A second finger means a
 * pan: the box cancels and the selection is put back.
 */
function Marquee(): null {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const facingShown = useFacingPreview((s) => s.on)
  const on = useWorkshop((s) => s.tool === 'select' && s.boxSelect) && !facingShown
  useEffect(() => {
    if (!on) return
    const canvas = gl.domElement
    const host = canvas.parentElement
    if (!host) return
    const box = document.createElement('div')
    box.className = 'bench__marquee'
    box.hidden = true
    host.appendChild(box)
    let start: { x: number; y: number } | null = null
    let base: number[] = []
    let baseParts: number[] = []
    let baseFaces: number[] = []
    let partsIn: number[] = []
    let invert = false
    // POINTS, FACES or OBJECTS, read at the press (workshop redesign, phase 3).
    let kind: 'points' | 'faces' | 'objects' = 'points'
    let active = false
    // Written only when the box changes something: the store re-renders every
    // handle on each write, and a box over empty space wrote on every move.
    const same = (a: number[], b: number[]): boolean => a.length === b.length && a.every((n, i) => n === b[i])
    const local = (e: PointerEvent): { x: number; y: number } => {
      const r = canvas.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const v = new Vector3()
    const inside = (x0: number, y0: number, x1: number, y1: number): number[] => {
      const shard = useWorkshop.getState().current()
      if (!shard) return []
      const r = canvas.getBoundingClientRect()
      const out: number[] = []
      shard.vertices.forEach((vert, i) => {
        v.set(...UP(ticksOf(vert))).project(camera)
        if (v.z > 1) return
        const px = ((v.x + 1) / 2) * r.width
        const py = ((1 - v.y) / 2) * r.height
        if (px >= x0 && px <= x1 && py >= y0 && py <= y1) out.push(i)
      })
      // A placed object is in the box when where it stands is: it is taken
      // whole, never by its own points, which are not this object's.
      partsIn = []
      ;(shard.parts ?? []).forEach((q, i) => {
        v.set(...UP(q.at)).project(camera)
        if (v.z > 1) return
        const px = ((v.x + 1) / 2) * r.width
        const py = ((1 - v.y) / 2) * r.height
        if (px >= x0 && px <= x1 && py >= y0 && py <= y1) partsIn.push(i)
      })
      return out
    }
    const cancel = (): void => {
      // A second finger has landed: this is a pan, not a box. Put the
      // selection back as it was when the first finger touched.
      if (start && active) { useWorkshop.getState().setSelection(base); useWorkshop.getState().setPartSelection(baseParts); useWorkshop.setState({ selectedFaces: baseFaces }) }
      start = null
      active = false
      box.hidden = true
    }
    const down = (e: PointerEvent): void => {
      if (!e.isPrimary) { cancel(); return }
      if (e.button !== 0) return
      start = local(e)
      const w = useWorkshop.getState()
      base = w.selection
      baseParts = w.partSel
      baseFaces = w.selectedFaces
      kind = w.selectKind
      // Read at the press: INVERT toggled mid-drag applies to the next box.
      invert = w.invert
      active = false
    }
    const move = (e: PointerEvent): void => {
      if (!start) return
      const { x, y } = local(e)
      if (!active && Math.hypot(x - start.x, y - start.y) < tapSlop()) return
      active = true
      const x0 = Math.min(start.x, x), y0 = Math.min(start.y, y), x1 = Math.max(start.x, x), y1 = Math.max(start.y, y)
      box.hidden = false
      box.style.left = `${x0}px`; box.style.top = `${y0}px`; box.style.width = `${x1 - x0}px`; box.style.height = `${y1 - y0}px`
      const within = inside(x0, y0, x1, y1)
      const w = useWorkshop.getState()
      if (kind === 'objects') {
        const parts = nextSelection(baseParts, partsIn, invert)
        if (!same(parts, w.partSel)) w.setPartSelection(parts)
        return
      }
      if (kind === 'faces') {
        // A face is in the box when every corner is; it comes with its corners, as a tapped face does.
        const shard = w.current()
        if (!shard) return
        const set = new Set(within)
        const facesIn = shard.faces.map((f, k) => (f.every((v) => set.has(v)) ? k : -1)).filter((k) => k >= 0)
        const faces = nextSelection(baseFaces, facesIn, invert)
        // Held with every vertex on their corners' points, as a tapped face is.
        if (!same(faces, w.selectedFaces)) w.holdFaces(faces)
        return
      }
      const points = nextSelection(base, within, invert)
      if (!same(points, w.selection)) w.setSelection(points)
    }
    const up = (): void => { start = null; if (active) { active = false; box.hidden = true } }
    canvas.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      canvas.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      box.remove()
    }
  }, [on, gl, camera])
  return null
}

/**
 * Two fingers tapped together undo; three redo (workshop redesign, phase 2;
 * as Procreate, Nomad and Shapr3D do). A tap is every finger down within a
 * moment of the first, and all of them up again soon, none having moved past
 * the slop: a pinch or a pan moves, and is never a tap. The buttons stay.
 */
const MULTI_TAP_MS = 300
function MultiTap(): null {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    const canvas = gl.domElement
    const down = new Map<number, { x: number; y: number }>()
    let most = 0
    let first = 0
    let spoiled = false
    const press = (e: PointerEvent): void => {
      if (e.pointerType !== 'touch') return
      if (down.size === 0) { first = e.timeStamp; most = 0; spoiled = false; noteMultiTouch(false) }
      if (down.size >= 1) noteMultiTouch(true)
      if (e.timeStamp - first > MULTI_TAP_MS) spoiled = true
      down.set(e.pointerId, { x: e.clientX, y: e.clientY })
      most = Math.max(most, down.size)
    }
    const move = (e: PointerEvent): void => {
      const at = down.get(e.pointerId)
      if (at && Math.hypot(e.clientX - at.x, e.clientY - at.y) > slopFor('touch')) spoiled = true
    }
    const lift = (e: PointerEvent): void => {
      if (!down.delete(e.pointerId)) return
      if (e.type === 'pointercancel') spoiled = true
      if (down.size > 0) return
      if (spoiled || e.timeStamp - first > MULTI_TAP_MS * 2) return
      if (most === 2) useWorkshop.getState().undo()
      else if (most === 3) useWorkshop.getState().redo()
    }
    canvas.addEventListener('pointerdown', press, true)
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', lift, true)
    window.addEventListener('pointercancel', lift, true)
    return () => {
      canvas.removeEventListener('pointerdown', press, true)
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', lift, true)
      window.removeEventListener('pointercancel', lift, true)
    }
  }, [gl])
  return null
}

/**
 * Reports where the move handles stand (benchAxes reportHandles): the middle
 * of the held points and placed objects, and how far one unit along each
 * model axis reaches on screen from there. Measured each frame something is
 * held, since the camera or the selection may have moved; the middle itself
 * only when the shard or what is held changes.
 */
function HandleProjector(): null {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const invalidate = useThree((s) => s.invalidate)
  const shard = useWorkshop((s) => s.current())
  const selection = useWorkshop((s) => s.selection)
  const partSel = useWorkshop((s) => s.partSel)
  // LOOK has no move handles (benchLook.tsx). A shard drawn moving (the
  // motion preview) has no rest pose on screen to hang them from, as Handles has none.
  const look = useWorkshop((s) => isLook(s.tool))
  const previewing = useAnimPreview((s) => s.on)
  const moving = previewing && !!shard && hasAnim(shard)
  // SET EYE: the handles stand on the eye, in any tool (shell/EyeBar).
  const eyeEdit = useWorkshop((s) => s.eyeEdit)
  // FACING turns the shape on the bench while the AVATAR sheet is open: no handles on where it is not.
  const facingShown = useFacingPreview((s) => s.on)
  const center = useMemo(() => {
    // The eye WALK uses (an eye past the size limit pulled in), where the row and the numbers say it is.
    if (shard && eyeEdit) { const r = UP(usedBenchEye(shard)); return new Vector3(r[0], r[1], r[2]) }
    if (!shard || look || moving || facingShown || (selection.length === 0 && partSel.length === 0)) return null
    const seen = new Set<string>()
    let x = 0, y = 0, z = 0, n = 0
    for (const i of selection) {
      const v = shard.vertices[i]
      if (!v) continue
      const t = ticksOf(v)
      const k = t.join(',')
      if (seen.has(k)) continue
      seen.add(k)
      const r = UP(t); x += r[0]; y += r[1]; z += r[2]; n++
    }
    for (const i of partSel) {
      const q = shard.parts?.[i]
      if (!q) continue
      const r = UP(q.at); x += r[0]; y += r[1]; z += r[2]; n++
    }
    return n ? new Vector3(x / n, y / n, z / n) : null
  }, [shard, look, moving, selection, partSel, eyeEdit, facingShown])
  // Held, or let go: a frame, so the handles come or go even on a still bench.
  useEffect(() => { if (!center) reportHandles(null); invalidate() }, [center, invalidate])
  useEffect(() => () => reportHandles(null), [])
  const v = useMemo(() => new Vector3(), [])
  // Model axes in render units: X and Y as they are, model +Z is render -Z.
  const dirs = useMemo(() => [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, -1)], [])
  useFrame(() => {
    if (!center) return
    const toPx = (p: Vector3): [number, number] | null => {
      v.copy(p).project(camera)
      if (v.z > 1 || v.z < -1) return null
      return [((v.x + 1) / 2) * size.width, ((1 - v.y) / 2) * size.height]
    }
    const c = toPx(center)
    if (!c) { reportHandles(null); return }
    const perUnit = dirs.map((d) => {
      const e = toPx(v.copy(center).add(d))
      return e ? [e[0] - c[0], e[1] - c[1]] as [number, number] : [0, 0] as [number, number]
    }) as [[number, number], [number, number], [number, number]]
    reportHandles(eyeEdit ? { center: c, perUnit, origin: toPx(v.set(0, 0, 0)) } : { center: c, perUnit })
  })
  return null
}

/** Keyboard on the bench: undo, tools, nudge, fill, delete, level, turn, SET EYE. Exported for its tests. */
export function Keys(): null {
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const w = useWorkshop.getState()
      // While FACING turns the shape on the bench, only UNDO and REDO: the rest would act on a shape drawn elsewhere.
      if (useFacingPreview.getState().on && !((e.metaKey || e.ctrlKey) && (e.code === 'KeyZ' || e.code === 'KeyY'))) return
      if ((e.metaKey || e.ctrlKey) && !e.altKey) {
        if (e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) w.redo(); else w.undo() }
        if (e.code === 'KeyY') { e.preventDefault(); w.redo() }
        // COPY and PASTE (workshop redesign, phase 2): what is held, and back where it came from.
        // Text selected on the page (a shard's name in MENU) copies as text, as anywhere else.
        if (e.code === 'KeyC' && (w.selection.length || w.partSel.length) && !window.getSelection()?.toString()) { e.preventDefault(); w.copySelection() }
        if (e.code === 'KeyV' && w.clip) { e.preventDefault(); w.pasteClip('exact', ownAddress(useCyberspace.getState().identity.pubkey, w.currentId)) }
        return
      }
      if (e.altKey) return
      // Shift+W/S tips the working grid a quarter about the screen's horizontal,
      // Shift+A/D rolls it about the line of sight; the geometry stays put.
      if (e.shiftKey && (e.code === 'KeyW' || e.code === 'KeyA' || e.code === 'KeyS' || e.code === 'KeyD')) {
        e.preventDefault()
        w.setPlane(planeAfter(w.plane, useBenchView.getState().axes, e.code === 'KeyW' || e.code === 'KeyS' ? 'tip' : 'roll'))
        return
      }
      // Screen directions, as the cursor's keys are in the world: W up, S down,
      // A left, D right, R into the screen, F out of it, whatever way the bench
      // camera has been turned.
      const nudge: Record<string, NudgeName> = {
        ArrowRight: 'right', ArrowLeft: 'left', KeyD: 'right', KeyA: 'left',
        ArrowUp: 'up', ArrowDown: 'down', KeyW: 'up', KeyS: 'down',
        KeyR: 'away', KeyF: 'toward',
      }
      // LOOK only looks: what is held is out of sight there, so its keys leave it alone (benchLook.tsx).
      const look = isLook(w.tool)
      // SET EYE: the same keys step the eye, in any tool (shell/EyeBar).
      if (nudge[e.code] && w.eyeEdit) { e.preventDefault(); const n = nudgeFor(benchAxes(camera), nudge[e.code]); w.moveEye(n.axis, n.delta * w.step()); return }
      if (nudge[e.code]) { e.preventDefault(); if (look) return; const n = nudgeFor(benchAxes(camera), nudge[e.code]); w.moveSelected(n.axis, n.delta * w.step()); return }
      if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); if (look) return; if (w.selectedFaces.length > 0) w.deleteSelectedFace(); else w.deleteSelected(); return }
      if (e.code === 'Enter') { e.preventDefault(); if (look) return; if (w.facePick.length >= 3) w.fill(); else if (w.selection.length >= 3) w.fillSelection(); return }
      // Escape is not here: it goes through the Escape stack (useEscape), so
      // the palette sheet and the confirmations over the bench close before
      // the bench does. Workshop registers what it clears and closes.
      if (e.code === 'KeyC') { if (!look) w.selectConnected(); return }
      // B, the held bar's COLOR: the color in hand onto what is held (points, or a face's corners).
      if (e.code === 'KeyB') { if (w.selection.length && !look) w.colorSelected(w.color); return }
      // The keys run 1 to 6 along the dock, left to right (Dock.tsx DOCK).
      if (e.code === 'Digit1') w.setTool('view')
      if (e.code === 'Digit2') w.setTool('stamp')
      if (e.code === 'Digit3') w.setTool('select')
      if (e.code === 'Digit4') w.setTool('paint')
      // ADD and FACE by key bring them onto a beginner's dock (phase 4).
      if ((e.code === 'Digit5' || e.code === 'Digit6') && useBeginner.getState().tools === 'four') useBeginner.getState().setTools('all')
      if (e.code === 'Digit5') w.setTool('add')
      if (e.code === 'Digit6') w.setTool('face')
      // Q and E turn the selection a quarter turn while SELECT holds one; Q turns the stamp otherwise.
      if (e.code === 'KeyQ') { if (w.tool === 'select' && (w.selection.length || w.partSel.length)) w.rotateSelected(-1); else if (!look) w.turnStamp() }
      // E: a quarter turn while SELECT holds something; with nothing held and no corners picked, SET EYE in hand or put down (AVATAR's FIRST-PERSON EYE).
      if (e.code === 'KeyE') {
        const holding = w.selection.length > 0 || w.partSel.length > 0 || w.selectedFaces.length > 0
        if (w.tool === 'select' && (w.selection.length || w.partSel.length)) w.rotateSelected(1)
        else if (!holding && w.facePick.length === 0) w.setEyeEdit(!w.eyeEdit)
      }
      if (e.code === 'BracketRight') w.setLevel(w.level + w.step())
      if (e.code === 'BracketLeft') w.setLevel(w.level - w.step())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [camera])
  return null
}

/** Publishes the camera's snapped axes for the pad outside the canvas, only when they change. */
/**
 * Turns the camera on request from the view ball's menu (benchAxes ViewKind):
 * HOME, the default oblique view with the target kept; TOP, FRONT and SIDE,
 * straight down an axis at the distance HOME would take; FIT, the whole
 * shard from where the camera already looks. Shares the camera's orientation
 * with the view ball every frame.
 */
function ViewDriver({ sphere }: { sphere: { current: Sphere | null } }): null {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const controls = useThree((s) => s.controls) as unknown as { target: Vector3; update: () => void } | null
  const request = useBenchView((s) => s.request)
  useFrame(() => { notePose(camera.quaternion) })
  useEffect(() => {
    if (!request || !controls) return
    const cam = camera as PerspectiveCamera
    if (request.kind === 'fit') {
      // The whole shard, from the way the camera faces now: aimed at the
      // middle of what it draws, as far back as that needs.
      const s = sphere.current
      const dir = camera.position.clone().sub(controls.target)
      if (dir.lengthSq() === 0) dir.set(HOME[0], HOME[1], HOME[2])
      if (s) controls.target.set(s.center[0], s.center[1], s.center[2])
      dir.setLength(Math.max(MIN_DISTANCE, fitDistance(s ? s.radius : reachRadius(null, controls.target), cam.fov, canvasAspect(size))))
      camera.position.copy(controls.target).add(dir)
      controls.update()
      return
    }
    // Home is the opening view's direction, at its distance or farther: as far
    // as the whole shard needs to fit from the target (benchReach.ts), so a
    // court sent home is seen whole rather than from inside its walls. TOP,
    // FRONT and SIDE take the same distance down their own axis.
    const home = new Vector3(HOME[0], HOME[1], HOME[2])
    const length = Math.max(home.length(), fitDistance(reachRadius(sphere.current, controls.target), cam.fov, canvasAspect(size)))
    const dir = request.kind === 'home' ? home : new Vector3(...VIEW_DIRS[request.kind])
    dir.setLength(length)
    camera.position.copy(controls.target).add(dir)
    controls.update()
  }, [request]) // eslint-disable-line react-hooks/exhaustive-deps
  // The view ball (shell/ViewBall) turns the camera about the controls'
  // target through this sink, outside React: a drag arrives at pointer rate.
  // OrbitControls rebuilds its own angles from the camera's position on every
  // update, so moving the camera and calling update keeps the two agreed.
  useEffect(() => {
    if (!controls) return
    setOrbitSink((dx, dy) => {
      const offset = camera.position.clone().sub(controls.target)
      camera.position.copy(controls.target).add(orbitOffset(offset, dx, dy))
      camera.lookAt(controls.target)
      controls.update()
    })
    return () => setOrbitSink(null)
  }, [camera, controls])
  return null
}

/**
 * The canvas height the camera's field of view spans, in CSS pixels: the
 * canvas's own, or the taller virtual view Framer frames the shard in.
 * What keeps a handle or a dot its size on screen divides by this.
 */
function fieldHeight(camera: PerspectiveCamera, height: number): number {
  const v = camera.view
  return (v && v.enabled && v.height > 0 ? v.fullHeight * (height / v.height) : height) * camera.zoom
}

/**
 * The canvas's own shape. The camera's aspect is the virtual view's while
 * Framer offsets it, which is not what fits a shard on the screen.
 */
function canvasAspect(size: { width: number; height: number }): number {
  return size.height > 0 ? size.width / size.height : 1
}

/** How far the framing moves toward where it is going, per frame. */
const FRAME_EASE = 0.25

/**
 * Frames the shard into the part of the bench nothing covers (workshop
 * redesign, phase 1): the top bar above, the strip and dock below, or a sheet
 * risen over them. The canvas stays the whole screen, so nothing under a
 * finger moves or resizes; the camera's view offset (benchAxes frameOffset)
 * puts the middle of its picture in the middle of the uncovered band, eased
 * there over a few frames, and the camera's zoom keeps the scale (frameZoom):
 * as it always was at rest, smaller by the share a sheet takes. Both are part
 * of the projection, so taps, the box and the handles all read them as they
 * read the camera.
 */
function Framer(): null {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const size = useThree((s) => s.size)
  const invalidate = useThree((s) => s.invalidate)
  const now = useRef({ top: 0, bottom: 0, rest: 0, right: 0 })
  const applied = useRef('')
  useEffect(() => useBenchView.subscribe((s, prev) => { if (s.insets !== prev.insets) invalidate() }), [invalidate])
  useEffect(() => () => { camera.clearViewOffset(); camera.zoom = 1; camera.updateProjectionMatrix() }, [camera])
  useFrame(() => {
    const goal = useBenchView.getState().insets
    const n = now.current
    const still = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const ease = (a: number, b: number): number => (still || Math.abs(b - a) < 0.5 ? b : a + (b - a) * FRAME_EASE)
    n.top = ease(n.top, goal.top)
    n.bottom = ease(n.bottom, goal.bottom)
    n.rest = goal.rest ?? goal.bottom
    n.right = ease(n.right, goal.right ?? 0)
    const o = frameOffset(size.width, size.height, n)
    const zoom = frameZoom(size.height, o ? o.fullHeight : size.height, n, size.width)
    // The aspect is in the key because R3F puts its own back on a resize.
    const keyOf = (): string => `${o ? `${o.fullWidth}:${o.fullHeight}:${o.x}:${o.y}` : 'none'}:${zoom.toFixed(4)}:${camera.aspect}`
    if (keyOf() !== applied.current) {
      camera.zoom = zoom
      if (o) camera.setViewOffset(o.fullWidth, o.fullHeight, o.x, o.y, o.width, o.height)
      else {
        camera.clearViewOffset()
        camera.aspect = canvasAspect(size)
        camera.updateProjectionMatrix()
      }
      applied.current = keyOf()
    }
    if (n.top !== goal.top || n.bottom !== goal.bottom || n.right !== (goal.right ?? 0)) invalidate()
  })
  return null
}

/**
 * The orbit's reach and the camera's depth, for the shard on the bench
 * (benchReach.ts; arkinox, 2026-11-09, a Maze Kit court that would not fit
 * the view). The sphere round everything the shard draws, its placed objects
 * resolved as ShardMesh resolves them, is measured when the shard or what it
 * places changes; each frame then sets how far the controls may pull back to
 * see it whole from where they aim, and pulls the far plane out past it and
 * the near plane out with the distance. A small shard keeps 60 and the planes
 * the bench always had.
 */
function Reach({ sphere }: { sphere: { current: Sphere | null } }): null {
  const shard = useWorkshop((s) => s.current())
  const size = useThree((s) => s.size)
  const resolved = useResolved(shard ?? null)
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const controls = useThree((s) => s.controls) as unknown as { target: Vector3; maxDistance: number } | null
  const invalidate = useThree((s) => s.invalidate)
  const measured = useMemo(() => (shard ? shardSphere(shard, resolved) : null), [shard, resolved])
  useLayoutEffect(() => { sphere.current = measured; invalidate() }, [sphere, measured, invalidate])
  useFrame(() => {
    if (!controls) return
    const distance = camera.position.distanceTo(controls.target)
    const r = reachRadius(sphere.current, controls.target)
    controls.maxDistance = nextMaxDistance(reachFor(r, camera.fov, canvasAspect(size)), distance)
    const { near, far } = clipPlanes(distance, r)
    // Only on a real change: a still bench must not rebuild its projection every frame.
    if (Math.abs(near - camera.near) > camera.near * 0.05 || Math.abs(far - camera.far) > camera.far * 0.05) {
      camera.near = near
      camera.far = far
      camera.updateProjectionMatrix()
    }
  })
  return null
}

/**
 * The bench draws when something changed, never otherwise (frameloop
 * "demand" on the Canvas below). A still bench at 144 Hz drew and sorted
 * everything 144 times a second to show the same picture: the fan, the
 * garbage and the frame budget of a tab doing nothing. R3F draws for what it
 * sets itself, and the orbit controls ask for a frame whenever they move,
 * through their damping too. This asks for the rest: any change to the
 * workshop's store, and a canvas that may have lost its picture.
 */
function BenchWake(): null {
  const invalidate = useThree((s) => s.invalidate)
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    const wake = (): void => invalidate()
    const shown = (): void => { if (document.visibilityState === 'visible') invalidate() }
    const canvas = gl.domElement
    const stop = useWorkshop.subscribe(wake)
    canvas.addEventListener('webglcontextrestored', wake)
    document.addEventListener('visibilitychange', shown)
    if (import.meta.env.DEV) Object.assign(window as unknown as Record<string, unknown>, { __benchInvalidate: invalidate })
    return () => {
      stop()
      canvas.removeEventListener('webglcontextrestored', wake)
      document.removeEventListener('visibilitychange', shown)
    }
  }, [invalidate, gl])
  return null
}

/**
 * An object with `anim` moves on the VIEW tool (ShardMesh `still` is off
 * there): the bench draws on demand, so while anything on it moves, every
 * frame is asked for (scene/animMotion.ts movingOn).
 */
function AnimWake(): null {
  const invalidate = useThree((s) => s.invalidate)
  const gl = useThree((s) => s.gl)
  // Every frame only while it actually moves: playing (or VIEW with no preview), and motion not reduced.
  // Paused, scrubbed or held still, one frame for each change of the preview is enough.
  useFrame(() => {
    if (movingOn(gl) === 0 || reducedMotionNow()) return
    const p = useAnimPreview.getState()
    if (!p.on || p.playing) invalidate()
  })
  const tool = useWorkshop((s) => s.tool)
  useEffect(() => { invalidate() }, [tool, invalidate])
  useEffect(() => useAnimPreview.subscribe(() => invalidate()), [invalidate])
  return null
}

/**
 * The bench's own clock for moving objects (scene/animMotion.ts AnimClock):
 * the motion editor's preview (store/animPreview.ts). Playing, it is the
 * world clock; paused, the moment it was paused at; scrubbed, a share of the
 * longest motion's cycle, a time chosen by hand and so drawn under reduced
 * motion too.
 */
const benchReading: ClockReading = { t: 0, version: 0, nowS: 0, chosen: false }
export function benchClock(shared: ClockReading): ClockReading {
  const p = useAnimPreview.getState()
  benchReading.version = shared.version
  benchReading.nowS = shared.nowS
  benchReading.chosen = p.scrub !== null
  if (p.scrub !== null) {
    const cur = useWorkshop.getState().current()
    benchReading.t = p.scrub * cycleSeconds(cur ? animOf(cur) : [])
  } else if (p.on && !p.playing) benchReading.t = p.frozen
  else benchReading.t = shared.t
  return benchReading
}

/**
 * A path's points on the bench while the motion editor previews it (not in
 * LOOK, which shows only what the world shows): a dot for each and the loop through them, where the object's
 * origin travels, the point being edited larger. The field's frame is the
 * render frame (lib/anim.ts), so a point is drawn at its ticks over 120.
 */
function PathMarks({ show }: { show: boolean }): JSX.Element | null {
  const shard = useWorkshop((s) => s.current())
  const point = useAnimPreview((s) => s.point)
  const paths = useMemo(() => (shard ? animOf(shard).map((m, i) => ({ m, i })).filter(({ m }) => m.word === 'path') : []), [shard])
  const lines = useMemo(() => paths.map(({ m }) => {
    const pts: number[] = []
    for (let k = 0; k < m.pts.length; k += 4) pts.push(m.pts[k] / 120, m.pts[k + 1] / 120, m.pts[k + 2] / 120)
    pts.push(pts[0], pts[1], pts[2])
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(pts, 3))
    const l = new Line(g, new LineBasicMaterial({ color: WARN, transparent: true, opacity: 0.8, depthTest: false, toneMapped: false }))
    l.renderOrder = OVERLAY_ORDER
    return l
  }), [paths])
  useEffect(() => () => { for (const l of lines) { l.geometry.dispose(); (l.material as LineBasicMaterial).dispose() } }, [lines])
  if (!show || paths.length === 0) return null
  return (
    <group renderOrder={OVERLAY_ORDER}>
      {paths.map(({ m, i }, n) => (
        <group key={i}>
          <primitive object={lines[n]} />
          {Array.from({ length: m.pts.length / 4 }, (_, k) => (
            <mesh key={k} position={[m.pts[k * 4] / 120, m.pts[k * 4 + 1] / 120, m.pts[k * 4 + 2] / 120]} renderOrder={OVERLAY_ORDER}>
              <sphereGeometry args={[point && point[0] === i && point[1] === k ? 0.16 : 0.09, 12, 12]} />
              <meshBasicMaterial color={point && point[0] === i && point[1] === k ? ACCENT : WARN} depthTest={false} toneMapped={false} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  )
}

function AxesReporter(): null {
  const camera = useThree((s) => s.camera)
  useFrame(() => {
    const axes = benchAxes(camera)
    if (!sameAxes(axes, useBenchView.getState().axes)) useBenchView.setState({ axes })
  })
  return null
}

/**
 * Memoized: Bench takes no props, so its only legitimate reason to redraw is
 * its own store reads (useWorkshop, useBenchView, useThree). Workshop.tsx is
 * one large component with its own local state (menus, panels, pickers,
 * drag-and-drop); any one of those re-renders Workshop and, with Bench a
 * plain function component, re-executed Bench too, which re-executed every
 * child in its JSX (Grid, Ghost, Handles, ShardMesh) whether or not anything
 * they read had changed. On a Maze Kit Basilica nave (1,896 vertices, ~290
 * deduplicated handle points) a single tap on the canvas was measured to
 * force that whole subtree to re-render ~280 times in a few seconds (none of
 * them a real store change: useWorkshop.subscribe saw zero notifications)
 * for seconds of blocked main thread — arkinox's "lockups" (2026-10-23,
 * scripts/perf-bench-orbit.mjs). Wrapping Bench lets React's default memo
 * comparison (no props, always equal) skip it on every parent-driven
 * re-render that isn't Bench's own; its internal store subscriptions still
 * force a real re-render exactly as before when something they read changes.
 */
function BenchImpl(): JSX.Element {
  const shard = useWorkshop((s) => s.current())
  const tool = useWorkshop((s) => s.tool)
  const boxSelect = useWorkshop((s) => s.boxSelect)
  const look = isLook(tool)
  // The motion editor's preview, with its path marks, whatever the tool (store/animPreview.ts).
  const previewing = useAnimPreview((s) => s.on)
  const extent = shard?.extent ?? GRID_HALF
  const showAvatar = useWorkshop((s) => s.showAvatar)
  const facingShown = useFacingPreview((s) => s.on)
  // What the shard on the bench draws, round: Reach measures it, the home view fits it.
  const sphere = useRef<Sphere | null>(null)
  const first = useRef(true)
  useEffect(() => { first.current = false }, [])

  // A tap on a drawn face in FACE mode selects it. Corners still win: their hit
  // spheres stand proud of the face, so the raycast meets them first.
  // A placed object is one whole thing (DECK-0003 §1.10). In SELECT and in
  // VIEW a tap puts it in or out of the selection, so the pad can move, turn
  // and delete a stamped object with the tool put down (arkinox, 2026-10-10);
  // in FACE it is caught here, so a tap on it never selects a face of this
  // object hidden behind it. In the placing tools it lets the tap through, to
  // the grid it stands on.
  const onPart = (e: ThreeEvent<MouseEvent>, part: number): void => {
    if (e.delta > tapSlop() || multiPress()) return
    e.stopPropagation()
    const w = useWorkshop.getState()
    // OBJECTS in SELECT takes it (workshop redesign, phase 3). In PAINT and
    // FACE the tap stops here, so it never paints or picks through it.
    if (w.tool === 'select' && w.selectKind === 'objects') w.togglePart(part)
  }

  const onFace = (e: ThreeEvent<MouseEvent>, face: number): void => {
    if (e.delta > tapSlop() || multiPress()) return
    e.stopPropagation()
    const w = useWorkshop.getState()
    if (w.tool === 'paint') { if (w.paintTake) { w.takeColorAt({ face }); w.setPaintTake(false) } else w.paintTap({ face }) }
    else if (w.tool === 'select' && w.selectKind === 'faces') w.selectFace(face)
  }

  // A tap that hits nothing is nothing, in every tool (workshop redesign,
  // phase 2): a thumb that missed a point by a hair used to lose the whole
  // selection. The held bar's count and Esc let go.
  return (
    <Canvas
      camera={{ fov: 50, position: HOME, near: BASE_NEAR, far: BASE_FAR }}
      dpr={[1, 2]}
      gl={{ antialias: true }}
      frameloop="demand"
      // Compiled once each, and no synchronous read of the driver's logs once
      // built: a selection coming and going freed programs and compiled them
      // again, which on Direct3D stops the main thread for a second or more
      // each (lib/keepPrograms.ts; every other canvas already did this).
      onCreated={({ gl: renderer, scene }) => keepPrograms(renderer, scene)}
      style={{ background: BG }}
    >
      {/* Your own pieces from your workshop, published or not: the bench is where they are made (lib/parts.ts). */}
      <OwnPartsContext.Provider value>
      {/* A key light high and to one side, a fill from behind, over a strong
          ambient: faces read by their tilt yet stay near the world's full
          color, and the darker backs (ShardMesh lit) show through any hole.
          One rig for the bench, the avatar preview and the thumbnails
          (shardLight.tsx; arkinox, 2026-10-12). */}
      <ShardLights />
      {/* One finger or left drag orbits in every tool, except in SELECT with
          BOX on, where that drag is the box's and the view ball turns the
          view (decision 1 of the workshop redesign). Two fingers, or the right button, pan
          the view in the screen plane; pinch or the wheel dollies, in to 0.6 of a
          gibson so a fifth-gibson step fills a good share of a phone's screen,
          and out as far as the whole shard needs to fit, 60 at the least
          (Reach sets maxDistance each frame). These are the controls' own bindings. */}
      <OrbitControls makeDefault enablePan screenSpacePanning panSpeed={0.9} enableRotate={!(tool === 'select' && boxSelect)} minDistance={MIN_DISTANCE} dampingFactor={0.12} />
      <Reach sphere={sphere} />
      <OrbitHold />
      <Marquee />
      <MultiTap />
      <HandleProjector />
      <Aim />
      <Keys />
      <BenchWake />
      <AnimWake />
      <AxesReporter />
      <ViewDriver sphere={sphere} />
      <Framer />
      {/* Axes, in the compass's colors, so X is red here and out there. */}
      <BenchAxes reach={extent + 1} />
      <Grid />
      {showAvatar && <ScaleAvatar />}
      {/* The shard: as the world draws it in LOOK, under the world's bloom; lit, with handles, in every other tool (benchLook.tsx). */}
      {/* While the AVATAR sheet is open, turned as FACING would turn it on a move up and to the right (FacingPreview). */}
      <FacingPreviewGroup><AnimClock.Provider value={benchClock}><BenchShard onFace={onFace} onPart={onPart} /></AnimClock.Provider></FacingPreviewGroup>
      <FacingArrow />
      {look && <BenchLookRig />}
      {look && <BenchBloom />}
      <PathMarks show={previewing} />
      {/* The handles, the ghost and the face highlight stand where the shape is unturned: aside while FACING shows. */}
      {!facingShown && <Ghost />}
      {!facingShown && <PickLoop />}
      {!facingShown && <FaceHighlight />}
      {!facingShown && <Handles />}
      </OwnPartsContext.Provider>
    </Canvas>
  )
}

export const Bench = memo(BenchImpl)
