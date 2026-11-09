/**
 * r3fRoot.ts - a react-three-fiber root with no WebGL, for tests that need
 * R3F itself: its scene graph of real three objects, its frame loop and its
 * pointer events, exactly as the app's Canvas runs them.
 *
 * The renderer is a stand-in that draws nothing; its render brings the
 * scene's and camera's world matrices up to date, as three's own does before
 * a frame is drawn. Frames run only when the test asks (`frame`, R3F's own
 * `advance` with the frameloop off). Pointer events go through R3F's own
 * handlers (createPointerEvents): the same raycast of every object with a
 * handler, the same record of what the press hit (`initialHits`), the same
 * click distance and propagation, so a test presses, releases and clicks as
 * a finger does. No DOM: the canvas is a record that takes listeners and
 * keeps none.
 */

import { act, advance, createPointerEvents, createRoot, extend, type RootState } from '@react-three/fiber'
import type { ReactNode } from 'react'
import * as THREE from 'three'
import type { Camera, Scene } from 'three'

// What the app's Canvas does on import: every three class as an element (<mesh>, <boxGeometry>).
extend(THREE)

export interface R3fRoot {
  state: () => RootState
  render: (children: ReactNode) => Promise<void>
  /** One frame: every useFrame callback, then the stand-in render. */
  frame: () => Promise<void>
  /** A pointer event at (x, y) CSS pixels from the canvas's top left, through R3F's handler for it. */
  pointer: (type: 'pointerdown' | 'pointerup' | 'click', x: number, y: number) => Promise<void>
  /** Press, release and click at one place: a tap. */
  tap: (x: number, y: number) => Promise<void>
  unmount: () => Promise<void>
}

const HANDLER = { pointerdown: 'onPointerDown', pointerup: 'onPointerUp', click: 'onClick' } as const

export async function r3fRoot(size = { width: 800, height: 800 }): Promise<R3fRoot> {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const canvas = { addEventListener: () => {}, removeEventListener: () => {}, style: {} }
  const gl = {
    domElement: canvas,
    render: (scene: Scene, camera: Camera) => { scene.updateMatrixWorld(); camera.updateMatrixWorld() },
    setSize: () => {},
    setPixelRatio: () => {},
    getPixelRatio: () => 1,
  }
  const root = createRoot(canvas as never)
  root.configure({ gl: gl as never, size: { ...size, top: 0, left: 0 }, dpr: 1, frameloop: 'never', events: createPointerEvents, camera: { position: [0, 0, 10], fov: 50, near: 0.1, far: 1000 } })
  let store: { getState: () => RootState } | null = null
  let time = 0
  const state = (): RootState => store!.getState()
  const pointer = async (type: 'pointerdown' | 'pointerup' | 'click', x: number, y: number): Promise<void> => {
    const handler = (state().events.handlers as Record<string, ((e: unknown) => void) | undefined>)[HANDLER[type]]
    if (!handler) throw new Error(`R3F has no ${HANDLER[type]} handler`)
    const target = { setPointerCapture: () => {}, releasePointerCapture: () => {}, hasPointerCapture: () => false }
    await act(async () => { handler({ type, offsetX: x, offsetY: y, clientX: x, clientY: y, pointerId: 1, button: 0, buttons: type === 'pointerdown' ? 1 : 0, target, currentTarget: target, stopPropagation: () => {}, preventDefault: () => {} }) })
  }
  return {
    state,
    render: async (children) => { await act(async () => { store = root.render(children) as never }); await act(async () => { gl.render(state().scene, state().camera) }) },
    frame: async () => { time += 1 / 60; await act(async () => { advance(time, true, state()) }) },
    pointer,
    tap: async (x, y) => { await pointer('pointerdown', x, y); await pointer('pointerup', x, y); await pointer('click', x, y) },
    unmount: async () => { await act(async () => { root.unmount() }) },
  }
}
