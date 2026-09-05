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

import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useEffect, useMemo, useRef } from 'react'
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Line, LineBasicMaterial, Vector3 } from 'three'
import { ACCENT, BG, WARN } from '../lib/palette'
import { GRID_HALF, centroid, pointKey, rgbToHex } from '../lib/shards'
import { landing, preview } from '../lib/stamps'
import { ShardMesh } from '../scene/ShardMesh'
import { useWorkshop } from '../store/useWorkshop'

/** A press that travels further than this is an orbit, not a tap. */
const TAP_SLOP = 8

type P3 = [number, number, number]

/** The grid point a pointer over the plane means, at the level the store says. */
function snap(p: Vector3, level: number): P3 {
  return [Math.round(p.x), level, Math.round(p.z)]
}

function Grid(): JSX.Element {
  const level = useWorkshop((s) => s.level)
  const tool = useWorkshop((s) => s.tool)
  const places = tool === 'add' || tool === 'stamp'

  const onClick = (e: ThreeEvent<MouseEvent>): void => {
    if (e.delta > TAP_SLOP) return
    e.stopPropagation()
    // Read the store at tap time rather than from the render closure: a level
    // changed a moment ago must apply to this tap even if the bench has not
    // re-rendered yet.
    const w = useWorkshop.getState()
    const at = snap(e.point, w.level)
    if (w.tool === 'stamp') w.placeStamp(at)
    else w.addVertex(at)
  }

  const onMove = (e: ThreeEvent<PointerEvent>): void => {
    const w = useWorkshop.getState()
    w.setAim(snap(e.point, w.level))
  }

  // A finger lifts and the ghost goes with it; a mouse keeps hovering.
  const onUp = (e: ThreeEvent<PointerEvent>): void => {
    if (e.pointerType !== 'mouse') useWorkshop.getState().setAim(null)
  }

  return (
    <group position={[0, level, 0]}>
      {/* The visible lattice. One cell per unit, so what you tap is what you get. */}
      <gridHelper args={[GRID_HALF * 2, GRID_HALF * 2, ACCENT, '#1d3547']} />
      {/*
        The surface taps land on, in the placing tools only. In select and face
        mode it carries no handler at all, so the raycaster ignores it: a raised
        grid plane must not sit in front of the vertex handles and swallow the
        taps meant for them, and an empty-space tap should reach onPointerMissed
        to deselect rather than being caught here.
      */}
      {places && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} onClick={onClick} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => useWorkshop.getState().setAim(null)}>
          <planeGeometry args={[GRID_HALF * 2 + 1, GRID_HALF * 2 + 1]} />
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
  // Built once per shape and color; the aim only moves it. Built per cell, the
  // ghost cost a fresh geometry every time the pointer crossed a grid line.
  const model = useMemo(() => (tool === 'stamp' ? preview(kind, size, facing, color) : null), [tool, kind, size, facing, color])
  if (!aim) return null
  if (tool === 'add') {
    return (
      <mesh position={aim}>
        <sphereGeometry args={[0.2, 12, 12]} />
        <meshBasicMaterial color={rgbToHex(color)} transparent opacity={0.5} toneMapped={false} depthWrite={false} />
      </mesh>
    )
  }
  if (!model) return null
  return (
    <group position={landing(kind, size, facing, aim)}>
      <ShardMesh shard={model} ghost />
    </group>
  )
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
    shard?.vertices.forEach((v, i) => { const k = pointKey(v.p); m.set(k, [...(m.get(k) ?? []), i]) })
    return [...m.values()]
  }, [shard?.vertices])
  if (!shard) return null

  const onClick = (first: number, isSel: boolean) => (e: ThreeEvent<MouseEvent>): void => {
    if (e.delta > TAP_SLOP) return
    e.stopPropagation()
    const w = useWorkshop.getState()
    if (tool === 'face') w.pickForFace(first)
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
          <group key={first} position={v.p}>
            {/* A generous invisible hit target; the visible handle is small. */}
            <mesh onClick={onClick(first, isSel)}>
              <sphereGeometry args={[0.42, 10, 10]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
            <mesh>
              <sphereGeometry args={[isSel || picked ? 0.2 : 0.12, 12, 12]} />
              <meshBasicMaterial color={isSel ? WARN : picked ? ACCENT : rgbToHex(v.c)} toneMapped={false} />
            </mesh>
            {picked && (
              <mesh>
                <ringGeometry args={[0.3, 0.36, 24]} />
                <meshBasicMaterial color={ACCENT} toneMapped={false} side={2} />
              </mesh>
            )}
          </group>
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
    const pts = facePick.map((i) => shard.vertices[i]?.p).filter((p): p is P3 => !!p)
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
    const pts = f.map((i) => shard.vertices[i].p)
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
  useEffect(() => {
    // The browser harness projects handle positions through this to click them.
    if (import.meta.env.DEV) (window as unknown as { __benchCamera?: unknown }).__benchCamera = camera
  }, [camera])
  const target = useMemo(() => {
    const shard = useWorkshop.getState().current()
    return shard ? centroid(shard) : [0, 0, 0]
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
        v.set(vert.p[0], vert.p[1], vert.p[2]).project(camera)
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
      const nudge: Record<string, [0 | 1 | 2, number]> = {
        ArrowRight: [0, 1], ArrowLeft: [0, -1], KeyD: [0, 1], KeyA: [0, -1],
        ArrowUp: [2, -1], ArrowDown: [2, 1], KeyW: [2, -1], KeyS: [2, 1],
        KeyR: [1, 1], KeyF: [1, -1],
      }
      if (nudge[e.code]) { e.preventDefault(); w.moveSelected(...nudge[e.code]); return }
      if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); if (w.selectedFace !== null) w.deleteSelectedFace(); else w.deleteSelected(); return }
      if (e.code === 'Enter') { if (w.facePick.length >= 3) { e.preventDefault(); w.fill() } return }
      if (e.code === 'Escape') { e.preventDefault(); if (w.selection.length || w.selectedFace !== null || w.facePick.length) { w.selectVertex(null); w.clearFacePick() } else w.closeWorkshop(); return }
      if (e.code === 'KeyC') { w.selectConnected(); return }
      if (e.code === 'Digit1') w.setTool('stamp')
      if (e.code === 'Digit2') w.setTool('add')
      if (e.code === 'Digit3') w.setTool('select')
      if (e.code === 'Digit4') w.setTool('face')
      if (e.code === 'KeyQ') w.turnStamp()
      if (e.code === 'BracketRight') w.setLevel(w.level + 1)
      if (e.code === 'BracketLeft') w.setLevel(w.level - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return null
}

export function Bench(): JSX.Element {
  const shard = useWorkshop((s) => s.current())
  const tool = useWorkshop((s) => s.tool)
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
      <ambientLight intensity={1} />
      {/* One finger or left drag orbits, except in SELECT where that drag is the
          marquee's. Two fingers, or the right button, pan the view in the screen
          plane; pinch or the wheel dollies. These are the controls' own bindings. */}
      <OrbitControls makeDefault enablePan screenSpacePanning panSpeed={0.9} enableRotate={tool !== 'select'} minDistance={3} maxDistance={60} dampingFactor={0.12} />
      <Marquee />
      <Aim />
      <Keys />
      {/* Axes, in the compass's colors, so X is red here and out there. */}
      <axesHelper args={[GRID_HALF + 1]} />
      <Grid />
      {shard && <ShardMesh shard={shard} onFaceClick={tool === 'face' ? onFace : undefined} />}
      <Ghost />
      <PickLoop />
      <FaceHighlight />
      <Handles />
    </Canvas>
  )
}
