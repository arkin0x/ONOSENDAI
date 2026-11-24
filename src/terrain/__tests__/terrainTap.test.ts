/**
 * terrainTap.test.ts - a tap on the scene in TERRAIN mines, and never folds
 * the controls (owner, 2026-11-24: "tapping still toggle-collapses the
 * controls panel. disable that in terrain mode"); in WALK a tap still folds
 * and unfolds them, as it always has.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { useTerrain } from '../../store/useTerrain'
import { tapScene, usePad } from '../../store/usePad'
import { terrainPointer } from '../TerrainView'
import { terrainInput } from '../terrainInput'

/** A stand-in for the scene's canvas: what the handler reads of an event's target. */
class FakeCanvas extends EventTarget {
  tagName = 'CANVAS'
  closest(): null { return null }
  getBoundingClientRect(): { left: number; top: number; width: number; height: number } { return { left: 0, top: 0, width: 400, height: 800 } }
}

function press(on: EventTarget, type: string, x: number, y: number): void {
  const e = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(e, { pointerId: 1, pointerType: 'touch', button: 0, clientX: x, clientY: y, movementX: 0, movementY: 0 })
  on.dispatchEvent(e)
}

/** A tap as the app hears it: the pointer down and up on the canvas, then the scene tap (App's useCanvasTap). */
function tap(canvas: EventTarget): void {
  press(canvas, 'pointerdown', 200, 400)
  press(canvas, 'pointerup', 200, 400)
  tapScene()
}

beforeEach(() => {
  terrainInput.action = null
  usePad.setState({ open: true })
})

describe('a tap on the scene', () => {
  it('in TERRAIN mines at the point, and the controls stay out', () => {
    useTerrain.setState({ active: true, sheet: false })
    const canvas = new FakeCanvas()
    const stop = terrainPointer(canvas)
    try {
      tap(canvas)
      expect(terrainInput.action?.kind).toBe('mine')
      expect(terrainInput.action?.at?.x).toBeCloseTo(0)
      expect(terrainInput.action?.at?.y).toBeCloseTo(0)
      expect(usePad.getState().open).toBe(true)
      tap(canvas)
      expect(usePad.getState().open).toBe(true)
    } finally {
      stop()
      useTerrain.setState({ active: false })
    }
  })

  it('in WALK still folds the controls, and the next tap brings them back', () => {
    useTerrain.setState({ active: false })
    tapScene()
    expect(usePad.getState().open).toBe(false)
    tapScene()
    expect(usePad.getState().open).toBe(true)
  })
})
