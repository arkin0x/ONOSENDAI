/**
 * Bench.tsx — the workshop's 3D view.
 *
 * A grid at the current level, the shard drawn live in its mode, a handle on
 * every point, and a ghost of what the next tap would make. Taps do the work:
 * on the grid, STAMP lands a shape and ADD a vertex at the snapped point; on
 * a handle, SELECT picks it and FACE collects it; on a face, FACE selects it
 * so DELETE can take it. Dragging orbits. R3F
 * reports how far the pointer travelled between down and up, which is what
 * separates a tap from an orbit, so a thumb that wobbles still taps.
 *
 * The ghost is the aim. A mouse hovers it into place; a finger presses and
 * slides it; either way you see where the thing will land before it lands,
 * which on a grid seen in perspective is the difference between placing and
 * guessing.
 */

import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useEffect, useMemo, useRef } from 'react'
import { AdditiveBlending, BufferGeometry, DoubleSide, EdgesGeometry, Float32BufferAttribute, Group, IcosahedronGeometry, Line, LineBasicMaterial, PerspectiveCamera, Vector3 } from 'three'
import { ACCENT, BG, WARN } from '../lib/palette'
import { glowTexture } from '../lib/glow'
import { GRID_HALF, TICKS_PER_UNIT, centroid, pointKey, rgbToHex, ticksOf, toRender } from '../lib/shards'
import { benchAxes, benchPose, nudgeFor, planeAfter, sameAxes, useBenchView, type NudgeName } from './benchAxes'
import { landing, preview, type WorkPlane } from '../lib/stamps'
import { ShardMesh } from '../scene/ShardMesh'
import { useWorkshop, type Tool } from '../store/useWorkshop'

/** A press that travels further than this is an orbit, not a tap. */
const TAP_SLOP = 8
/** The unit grid's line colour when a unit is not divided. */
const UNIT_LINE = '#1d3547'
/**
 * When a unit is divided the unit lines step up toward the axis lines'
 * light blue, and the division lines take the unit lines' old colour, so
 * the unit grid stays the unit grid however fine the snap.
 */
const UNIT_LINE_DIVIDED = '#166c86'

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
/** Where the camera sits from its target when sent home: the bench's opening view. */
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
  const geometry = useMemo(() => new EdgesGeometry(new IcosahedronGeometry(0.5, 1)), [])
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
  const places = tool === 'add' || tool === 'stamp'

  const onClick = (e: ThreeEvent<MouseEvent>): void => {
    if (e.delta > TAP_SLOP) return
    e.stopPropagation()
    // Read the store at tap time rather than from the render closure: a level
    // changed a moment ago must apply to this tap even if the bench has not
    // re-rendered yet.
    const w = useWorkshop.getState()
    const at = snap(e.point, w.level, w.step(), w.plane)
    if (w.tool === 'stamp') w.placeStamp(at)
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
      {/* The visible lattice. One cell per unit, so what you tap is what you get. */}
      <gridHelper key={`u${extent}-${division > 1 ? 1 : 0}`} args={[extent * 2, extent * 2, ACCENT, division > 1 ? UNIT_LINE_DIVIDED : UNIT_LINE]} />
      {/* The snap grid between the unit lines when a unit is divided, in the unit lines' plain colour. */}
      {division > 1 && <gridHelper key={`d${extent}-${division}`} args={[extent * 2, extent * 2 * division, UNIT_LINE, UNIT_LINE]} position={[0, -0.002, 0]} />}
      {/*
        The surface taps land on, in the placing tools only. In select and face
        mode it carries no handler at all, so the raycaster ignores it: a raised
        grid plane must not sit in front of the vertex handles and swallow the
        taps meant for them, and an empty-space tap should reach onPointerMissed
        to deselect rather than being caught here.
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
  // Built once per shape, color and plane; the aim only moves it. Built per cell, the
  // ghost cost a fresh geometry every time the pointer crossed a grid line.
  const model = useMemo(() => (tool === 'stamp' ? preview(kind, size, facing, color, plane) : null), [tool, kind, size, facing, color, plane])
  const extent = useWorkshop((s) => s.current()?.extent ?? GRID_HALF)
  if (!aim) return null
  if (tool === 'add') {
    return (
      <mesh position={UP(aim)}>
        <sphereGeometry args={[0.1, 12, 12]} />
        <meshBasicMaterial color={rgbToHex(color)} transparent opacity={0.5} toneMapped={false} depthWrite={false} />
      </mesh>
    )
  }
  if (!model) return null
  return (
    <group position={UP(landing(kind, size, facing, aim, extent, plane))}>
      <ShardMesh shard={model} ghost />
    </group>
  )
}

/**
 * Handle sizes in CSS pixels, not bench units.
 *
 * Each handle sits in a group scaled by its own distance from the camera
 * (`ScreenScale`), so a radius of 1 draws one pixel across whatever the zoom.
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
/** The finger target: bigger than the dot, and smaller in ADD and FACE, where a
 * tap beside a point means the plane or the face rather than the point. */
const HIT_R = 10
const HIT_NARROW_R = 5.5
function hitRadiusFor(tool: Tool): number {
  return tool === 'add' || tool === 'face' ? HIT_NARROW_R : HIT_R
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
    const perPixel = 2 * Math.tan((cam.fov * Math.PI) / 360) / state.size.height
    g.scale.setScalar(Math.max(1e-5, cam.position.distanceTo(g.position) * perPixel))
  })
  return <group ref={ref} position={position}>{children}</group>
}

/**
 * One handle per point. Several vertices can share a point once stamps have
 * landed on each other; they read and act as one, so they draw as one.
 */
function Handles(): JSX.Element | null {
  const shard = useWorkshop((s) => s.current())
  const selection = useWorkshop((s) => s.selection)
  const facePick = useWorkshop((s) => s.facePick)
  const tool = useWorkshop((s) => s.tool)
  const chosen = useMemo(() => new Set(selection), [selection])
  const groups = useMemo(() => {
    const m = new Map<string, number[]>()
    shard?.vertices.forEach((v, i) => { const k = pointKey(ticksOf(v)); m.set(k, [...(m.get(k) ?? []), i]) })
    return [...m.values()]
  }, [shard?.vertices])
  if (!shard) return null
  const glow = glowTexture()
  const hitRadius = hitRadiusFor(tool)

  const onClick = (first: number, isSel: boolean) => (e: ThreeEvent<MouseEvent>): void => {
    if (e.delta > TAP_SLOP) return
    e.stopPropagation()
    const w = useWorkshop.getState()
    if (tool === 'face') {
      // The sphere stands proud of the faces, so it meets the ray first even when
      // the tap was on a face beside the corner. If a face is under the tap and
      // the ray passes farther from the corner than its drawn dot, the face wins.
      const centre = new Vector3(...UP(ticksOf(shard.vertices[first])))
      const face = e.intersections.find((i) => i.object.name === 'shard-faces')
      // The dot's drawn radius in world units: its pixels times the group's own scale.
      const drawn = DOT_ON_R * (e.object.parent?.scale.x ?? 1)
      if (face && face.faceIndex !== undefined && e.ray.distanceToPoint(centre) > drawn) { w.selectFace(face.faceIndex); return }
      w.pickForFace(first)
    }
    // In SELECT a tap adds or removes the point; elsewhere it picks that point alone.
    else if (tool === 'select') w.toggleVertex(first)
    else w.selectVertex(isSel ? null : first)
  }

  return (
    <>
      {groups.map((g) => {
        const first = g[0]
        const v = shard.vertices[first]
        const isSel = g.some((i) => chosen.has(i))
        const picked = facePick.some((i) => g.includes(i))
        return (
          <ScreenScale key={first} position={UP(ticksOf(v))}>
            {/* An invisible hit target wider than the handle, narrower in ADD so a tap
                beside a point lands on the plane and places another one near it. */}
            <mesh onClick={onClick(first, isSel)}>
              <sphereGeometry args={[hitRadius, 10, 10]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
            <mesh>
              <sphereGeometry args={[isSel || picked ? DOT_ON_R : DOT_R, 12, 12]} />
              <meshBasicMaterial color={isSel ? WARN : picked ? ACCENT : rgbToHex(v.c)} toneMapped={false} />
            </mesh>
            {/* A halo, so a small selected handle still stands out. */}
            {(isSel || picked) && glow && (
              <sprite scale={[HALO_PX, HALO_PX, 1]}>
                <spriteMaterial map={glow} color={isSel ? WARN : ACCENT} transparent opacity={0.85} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
              </sprite>
            )}
            {picked && (
              <mesh>
                <ringGeometry args={[RING_R, RING_OUT, 24]} />
                <meshBasicMaterial color={ACCENT} toneMapped={false} side={2} />
              </mesh>
            )}
          </ScreenScale>
        )
      })}
    </>
  )
}

/** The face being picked, as a line through its corners so far, closing once it could. */
function PickLoop(): JSX.Element | null {
  const shard = useWorkshop((s) => s.current())
  const facePick = useWorkshop((s) => s.facePick)
  const line = useMemo(() => {
    if (!shard || facePick.length < 2) return null
    const pts = facePick.map((i) => shard.vertices[i]).filter((v) => !!v).map((v) => UP(ticksOf(v)))
    if (pts.length >= 3) pts.push(pts[0])
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(pts.flat(), 3))
    const l = new Line(g, new LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.6, toneMapped: false }))
    l.frustumCulled = false
    return l
  }, [shard, facePick])
  useEffect(() => () => { line?.geometry.dispose(); line?.material.dispose() }, [line])
  return line ? <primitive object={line} /> : null
}

/** The face tapped in FACE mode, lit in the selection color so DELETE FACE has a visible target. */
function FaceHighlight(): JSX.Element | null {
  const shard = useWorkshop((s) => s.current())
  const face = useWorkshop((s) => s.selectedFace)
  const lit = useMemo(() => {
    const f = face === null ? undefined : shard?.faces[face]
    if (!shard || !f) return null
    const pts = f.map((i) => UP(ticksOf(shard.vertices[i])))
    // Four points: the mesh draws the first three as its one triangle, the line closes the loop.
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute([...pts, pts[0]].flat(), 3))
    const edge = new Line(g, new LineBasicMaterial({ color: WARN, toneMapped: false }))
    edge.frustumCulled = false
    return { g, edge }
  }, [shard, face])
  useEffect(() => () => { lit?.g.dispose(); lit?.edge.material.dispose() }, [lit])
  if (!lit) return null
  return (
    <>
      <mesh geometry={lit.g} frustumCulled={false}>
        <meshBasicMaterial color={WARN} transparent opacity={0.5} side={DoubleSide} depthWrite={false} polygonOffset polygonOffsetFactor={-4} toneMapped={false} />
      </mesh>
      <primitive object={lit.edge} />
    </>
  )
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

/** Keyboard on the bench: undo, tools, nudge, fill, delete, level, turn. */
/**
 * A box dragged on the bench in SELECT: every point whose projection falls
 * inside is selected, live as the box grows; shift keeps what was selected.
 * The box is a plain element over the canvas, drawn here without React. A
 * tap (no drag) is left to the handles and to onPointerMissed; orbit is off
 * in SELECT (Bench), so a one-finger drag is the box's alone. A second
 * finger means a pan: the box cancels and the selection is put back.
 */
function Marquee(): null {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const tool = useWorkshop((s) => s.tool)
  useEffect(() => {
    if (tool !== 'select') return
    const canvas = gl.domElement
    const host = canvas.parentElement
    if (!host) return
    const box = document.createElement('div')
    box.className = 'bench__marquee'
    box.hidden = true
    host.appendChild(box)
    let start: { x: number; y: number } | null = null
    let base: number[] = []
    let shift = false
    let active = false
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
      return out
    }
    const cancel = (): void => {
      // A second finger has landed: this is a pan, not a box. Put the
      // selection back as it was when the first finger touched.
      if (start && active) useWorkshop.getState().setSelection(base)
      start = null
      active = false
      box.hidden = true
    }
    const down = (e: PointerEvent): void => {
      if (!e.isPrimary) { cancel(); return }
      if (e.button !== 0) return
      start = local(e)
      base = useWorkshop.getState().selection
      shift = e.shiftKey
      active = false
    }
    const move = (e: PointerEvent): void => {
      if (!start) return
      const { x, y } = local(e)
      if (!active && Math.hypot(x - start.x, y - start.y) < TAP_SLOP) return
      active = true
      const x0 = Math.min(start.x, x), y0 = Math.min(start.y, y), x1 = Math.max(start.x, x), y1 = Math.max(start.y, y)
      box.hidden = false
      box.style.left = `${x0}px`; box.style.top = `${y0}px`; box.style.width = `${x1 - x0}px`; box.style.height = `${y1 - y0}px`
      useWorkshop.getState().setSelection([...(shift ? base : []), ...inside(x0, y0, x1, y1)])
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
  }, [tool, gl, camera])
  return null
}

function Keys(): null {
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const w = useWorkshop.getState()
      if ((e.metaKey || e.ctrlKey) && !e.altKey) {
        if (e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) w.redo(); else w.undo() }
        if (e.code === 'KeyY') { e.preventDefault(); w.redo() }
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
      if (nudge[e.code]) { e.preventDefault(); const n = nudgeFor(benchAxes(camera), nudge[e.code]); w.moveSelected(n.axis, n.delta * w.step()); return }
      if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); if (w.selectedFace !== null) w.deleteSelectedFace(); else w.deleteSelected(); return }
      if (e.code === 'Enter') { e.preventDefault(); if (w.facePick.length >= 3) w.fill(); else if (w.selection.length >= 3) w.fillSelection(); return }
      if (e.code === 'Escape') { e.preventDefault(); if (w.selection.length || w.selectedFace !== null || w.facePick.length) { w.selectVertex(null); w.clearFacePick() } else w.closeWorkshop(); return }
      if (e.code === 'KeyC') { w.selectConnected(); return }
      if (e.code === 'Digit1') w.setTool('view')
      if (e.code === 'Digit2') w.setTool('stamp')
      if (e.code === 'Digit3') w.setTool('add')
      if (e.code === 'Digit4') w.setTool('select')
      if (e.code === 'Digit5') w.setTool('face')
      // Q and E turn the selection a quarter turn while SELECT holds one; Q turns the stamp otherwise.
      if (e.code === 'KeyQ') { if (w.tool === 'select' && w.selection.length) w.rotateSelected(-1); else w.turnStamp() }
      if (e.code === 'KeyE') { if (w.tool === 'select' && w.selection.length) w.rotateSelected(1) }
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
 * Sends the camera home on request (the default oblique view, the target kept),
 * and shares its orientation with the compass every frame.
 */
function ViewDriver(): null {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as { target: Vector3; update: () => void } | null
  const request = useBenchView((s) => s.request)
  useFrame(() => { benchPose.copy(camera.quaternion) })
  useEffect(() => {
    if (!request || !controls) return
    camera.position.copy(controls.target).add(new Vector3(HOME[0], HOME[1], HOME[2]))
    controls.update()
  }, [request]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

function AxesReporter(): null {
  const camera = useThree((s) => s.camera)
  useFrame(() => {
    const axes = benchAxes(camera)
    if (!sameAxes(axes, useBenchView.getState().axes)) useBenchView.setState({ axes })
  })
  return null
}

export function Bench(): JSX.Element {
  const shard = useWorkshop((s) => s.current())
  const tool = useWorkshop((s) => s.tool)
  const extent = shard?.extent ?? GRID_HALF
  const showAvatar = useWorkshop((s) => s.showAvatar)
  const first = useRef(true)
  useEffect(() => { first.current = false }, [])

  // A tap on a drawn face in FACE mode selects it. Corners still win: their hit
  // spheres stand proud of the face, so the raycast meets them first.
  const onFace = (e: ThreeEvent<MouseEvent>): void => {
    if (e.delta > TAP_SLOP || e.faceIndex === undefined) return
    e.stopPropagation()
    useWorkshop.getState().selectFace(e.faceIndex)
  }

  return (
    <Canvas
      camera={{ fov: 50, position: [10, 9, 12], near: 0.05, far: 200 }}
      dpr={[1, 2]}
      gl={{ antialias: true }}
      style={{ background: BG }}
      // A click that hits nothing deselects and drops a half-built face. In the
      // placing tools the grid plane catches the click first, so this fires only
      // on true empty space; in select and face mode there is no plane, so a tap
      // off any handle lands here.
      onPointerMissed={(e) => {
        if ((e as PointerEvent).button !== 0) return
        const w = useWorkshop.getState()
        if (w.selection.length || w.selectedFace !== null || w.facePick.length) { w.selectVertex(null); w.clearFacePick() }
      }}
    >
      {/* A key light high and to one side, a dim fill from behind: faces read by
          their tilt, and the dark backs (ShardMesh lit) show through any hole. */}
      <ambientLight intensity={0.4} />
      <directionalLight position={[8, 12, 6]} intensity={0.9} />
      <directionalLight position={[-9, 2, -3]} intensity={0.6} />
      {/* One finger or left drag orbits, except in SELECT where that drag is the
          marquee's. Two fingers, or the right button, pan the view in the screen
          plane; pinch or the wheel dollies, in to 0.6 of a gibson so a fifth-gibson
          step fills a good share of a phone's screen. These are the controls' own bindings. */}
      <OrbitControls makeDefault enablePan screenSpacePanning panSpeed={0.9} enableRotate={tool !== 'select'} minDistance={0.6} maxDistance={60} dampingFactor={0.12} />
      <Marquee />
      <Aim />
      <Keys />
      <AxesReporter />
      <ViewDriver />
      {/* Axes, in the compass's colors, so X is red here and out there. */}
      <BenchAxes reach={extent + 1} />
      <Grid />
      {showAvatar && <ScaleAvatar />}
      {shard && <ShardMesh shard={shard} lit onFaceClick={tool === 'face' ? onFace : undefined} />}
      <Ghost />
      <PickLoop />
      <FaceHighlight />
      <Handles />
    </Canvas>
  )
}
