/**
 * viewFlyHolds.test.ts - VIEW's fly, after the 2026-11-11 rework: Space flies
 * forward and Shift back (keys), the two fly buttons do the same held, and a
 * drag on a held button steers (orbits). R and F are FAR and NEAR again, a
 * cell at a time, not a fly. The pad no longer flies.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

vi.mock('../../lib/relay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/relay')>()),
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { flyHold } from '../ViewFlyButtons'
import { flyKeyUp } from '../../hooks/useKeyboard'
import { flyDir, takeSteer, useViewFly } from '../../lib/viewFly'

const press = (pointerId = 7, x = 100, y = 100) => ({ pointerType: 'touch', button: 0, pointerId, clientX: x, clientY: y, preventDefault: () => {}, stopPropagation: () => {}, currentTarget: { setPointerCapture: () => {} } })

afterEach(() => { useViewFly.setState({ button: 0, pad: 0, key: 0, touch: 0 }); takeSteer() })

describe('the fly buttons fly while held', () => {
  it('Forward flies forward and Back flies back while held, and stop when let go', () => {
    const fwd = flyHold('button', 1)
    fwd.onPointerDown(press() as never)
    expect(useViewFly.getState().button).toBe(1)
    expect(flyDir()).toBe(1)
    fwd.onPointerUp(press() as never)
    expect(flyDir()).toBe(0)
    const back = flyHold('button', -1)
    back.onPointerDown(press() as never)
    expect(flyDir()).toBe(-1)
    back.onLostPointerCapture(press() as never)
    expect(flyDir()).toBe(0)
  })

  it('a drag on a held fly button gathers steer, in CSS pixels, for the scene to orbit by', () => {
    const fwd = flyHold('button', 1)
    fwd.onPointerDown(press(7, 100, 100) as never)
    fwd.onPointerMove(press(7, 130, 112) as never)
    const s = takeSteer()
    expect(s.dx).toBe(30)
    expect(s.dy).toBe(12)
    // Drained: nothing left for the next frame.
    expect(takeSteer()).toEqual({ dx: 0, dy: 0 })
    fwd.onPointerUp(press(7, 130, 112) as never)
  })
})

describe('Space and Shift fly the view in VIEW', () => {
  it('Space\'s keyup ends the forward fly, Shift\'s the back one', () => {
    useViewFly.getState().setKey(1)
    flyKeyUp(-1)
    expect(useViewFly.getState().key).toBe(1)
    flyKeyUp(1)
    expect(useViewFly.getState().key).toBe(0)
    useViewFly.getState().setKey(-1)
    flyKeyUp(-1)
    expect(flyDir()).toBe(0)
  })

  it('useKeyboard flies forward on Space and back on Shift in VIEW, moves the cursor on R and F, and lets go on keyup and blur', () => {
    const src = readFileSync('src/hooks/useKeyboard.ts', 'utf8')
    // Space in a free view flies forward, never commits there.
    expect(src).toMatch(/if \(canFly\(store, building\)\) \{ useViewFly\.getState\(\)\.setKey\(1\); return \}/)
    // Shift flies back in a free view.
    expect(src).toMatch(/ShiftLeft' \|\| event\.code === 'ShiftRight'\) && canFly\(store, building\)\) \{\s*event\.preventDefault\(\)\s*useViewFly\.getState\(\)\.setKey\(-1\)/)
    // R and F just move the cursor, no fly branch.
    expect(src).toMatch(/if \(event\.code === 'KeyR' \|\| event\.code === 'KeyF'\) \{[\s\S]*?store\.moveCursor\(moveDirection\(axes, MOVE_KEYS\[event\.code\]\)\)/)
    expect(src).not.toMatch(/canFly\(store, building\)\) \{\s*useViewFly\.getState\(\)\.setKey\(event\.code === 'KeyR'/)
    // Keyup and blur release the key fly.
    expect(src).toMatch(/if \(event\.code === 'Space'\) flyKeyUp\(1\)/)
    expect(src).toMatch(/window\.addEventListener\('blur', flyKeysReleased\)/)
  })

  it('the pad no longer flies: FAR and NEAR bind their cursor step like every other key', () => {
    const src = readFileSync('src/hud/TouchControls.tsx', 'utf8')
    expect(src).toMatch(/sub: 'FAR', title: 'Away from camera \(R\)', keyHint: 'R', act: move\('away'\)/)
    expect(src).toMatch(/sub: 'NEAR', title: 'Toward camera \(F\)', keyHint: 'F', act: move\('toward'\)/)
    expect(src).not.toMatch(/flyHold\('pad'/)
    expect(src).toMatch(/\{\.\.\.\(walking && b\.hold \? padHold\(b\) : bind\(b\.act\)\)\}/)
  })
})
