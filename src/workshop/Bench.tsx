/**
 * Bench.tsx — the workshop's 3D view.
 *
 * A grid at the current level, the shard drawn live in its mode, and a handle
 * on every vertex. Taps do the work: on the grid, the add tool places a vertex
 * at the snapped point; on a handle, select picks it or the face tool collects
 * it. Dragging orbits. R3F reports how far the pointer travelled between down
 * and up, which is what separates the two, so a thumb that wobbles still taps.
 */

import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useEffect, useMemo, useRef } from 'react'
import { Vector3 } from 'three'
import { ACCENT, BG, WARN } from '../lib/palette'
import { GRID_HALF, centroid } from '../lib/shards'
import { ShardMesh } from '../scene/ShardMesh'
import { useWorkshop } from '../store/useWorkshop'

/** A press that travels further than this is an orbit, not a tap. */
const TAP_SLOP = 8

function Grid(): JSX.Element {
  const level = useWorkshop((s) => s.level)
  const tool = useWorkshop((s) => s.tool)

  const onClick = (e: ThreeEvent<MouseEvent>): void => {
    if (e.delta > TAP_SLOP) return
    e.stopPropagation()
    // Read the store at tap time rather than from the render closure: a level
    // changed a moment ago must apply to this tap even if the bench has not
    // re-rendered yet.
    const w = useWorkshop.getState()
    const p = e.point
    w.addVertex([Math.round(p.x), w.level, Math.round(p.z)])
  }

  return (
    <group position={[0, level, 0]}>
      {/* The visible lattice. One cell per unit, so what you tap is what you get. */}
      <gridHelper args={[GRID_HALF * 2, GRID_HALF * 2, ACCENT, '#1d3547']} />
      {/*
        The surface taps land on, in ADD mode only. In select and face mode it
        carries no handler at all, so the raycaster ignores it: a raised grid
        plane must not sit in front of the vertex handles and swallow the taps
        meant for them, and an empty-space tap should reach onPointerMissed to
        deselect rather than being caught here.
      */}
      {tool === 'add' && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} onClick={onClick}>
          <planeGeometry args={[GRID_HALF * 2 + 1, GRID_HALF * 2 + 1]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
    </group>
  )
}

function Handles(): JSX.Element | null {
  const shard = useWorkshop((s) => s.current())
  const selected = useWorkshop((s) => s.selected)
  const facePick = useWorkshop((s) => s.facePick)
  const tool = useWorkshop((s) => s.tool)
  if (!shard) return null

  const onClick = (index: number) => (e: ThreeEvent<MouseEvent>): void => {
    if (e.delta > TAP_SLOP) return
    e.stopPropagation()
    const w = useWorkshop.getState()
    if (tool === 'face') w.pickForFace(index)
    else w.selectVertex(w.selected === index ? null : index)
  }

  return (
    <>
      {shard.vertices.map((v, i) => {
        const picked = facePick.indexOf(i)
        const isSel = selected === i
        return (
          <group key={i} position={v.p}>
            {/* A generous invisible hit target; the visible handle is small. */}
            <mesh onClick={onClick(i)}>
              <sphereGeometry args={[0.42, 10, 10]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
            <mesh>
              <sphereGeometry args={[isSel || picked >= 0 ? 0.2 : 0.12, 12, 12]} />
              <meshBasicMaterial color={isSel ? WARN : picked >= 0 ? ACCENT : `rgb(${v.c.map((x) => Math.round(x * 255)).join(',')})`} toneMapped={false} />
            </mesh>
            {picked >= 0 && (
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

/** Keyboard on the bench: nudge, delete, tools. */
function Keys(): null {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const w = useWorkshop.getState()
      const nudge: Record<string, [0 | 1 | 2, number]> = {
        ArrowRight: [0, 1], ArrowLeft: [0, -1], KeyD: [0, 1], KeyA: [0, -1],
        ArrowUp: [2, -1], ArrowDown: [2, 1], KeyW: [2, -1], KeyS: [2, 1],
        KeyR: [1, 1], KeyF: [1, -1],
      }
      if (nudge[e.code]) { e.preventDefault(); w.moveSelected(...nudge[e.code]); return }
      if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); w.deleteSelected(); return }
      if (e.code === 'Escape') { e.preventDefault(); if (w.selected !== null || w.facePick.length) { w.selectVertex(null); w.clearFacePick() } else w.closeWorkshop(); return }
      if (e.code === 'Digit1') w.setTool('add')
      if (e.code === 'Digit2') w.setTool('select')
      if (e.code === 'Digit3') w.setTool('face')
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
  const first = useRef(true)
  useEffect(() => { first.current = false }, [])

  return (
    <Canvas
      camera={{ fov: 50, position: [10, 9, 12], near: 0.05, far: 200 }}
      dpr={[1, 2]}
      gl={{ antialias: true }}
      style={{ background: BG }}
      // A click that hits nothing deselects and drops a half-built face. In ADD
      // mode the grid plane catches the click first, so this fires only on true
      // empty space; in select and face mode there is no plane, so a tap off any
      // handle lands here.
      onPointerMissed={(e) => {
        if ((e as PointerEvent).button !== 0) return
        const w = useWorkshop.getState()
        if (w.selected !== null || w.facePick.length) { w.selectVertex(null); w.clearFacePick() }
      }}
    >
      <ambientLight intensity={1} />
      <OrbitControls makeDefault enablePan={false} minDistance={3} maxDistance={60} dampingFactor={0.12} />
      <Aim />
      <Keys />
      {/* Axes, in the compass's colours, so X is red here and out there. */}
      <axesHelper args={[GRID_HALF + 1]} />
      <Grid />
      {shard && <ShardMesh shard={shard} />}
      <Handles />
    </Canvas>
  )
}
