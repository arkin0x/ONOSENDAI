/**
 * sceneEvents.ts - the scene canvas's pointer events: R3F's own, cast from
 * the screen's centre while the mouse is captured.
 */

import { createPointerEvents, type EventManager } from '@react-three/fiber'

/**
 * R3F's pointer, but at the screen's centre while the mouse is captured
 * (TERRAIN's look, terrain/TerrainView.tsx terrainMouseLock): a captured
 * mouse's events keep the place the pointer stood when it was captured, so
 * a click meant for the cross opened whatever shard stood under that old
 * place instead. At the centre a click is cast along the same ray as the
 * cross TERRAIN mines on (TerrainLayer.tsx Marks).
 */
export function sceneEvents(store: Parameters<typeof createPointerEvents>[0]): EventManager<HTMLElement> {
  const events = createPointerEvents(store)
  const compute = events.compute
  return {
    ...events,
    compute(event, state, previous) {
      if (typeof document !== 'undefined' && document.pointerLockElement === state.gl.domElement) {
        state.pointer.set(0, 0)
        state.raycaster.setFromCamera(state.pointer, state.camera)
        return
      }
      compute?.(event, state, previous)
    },
  }
}
