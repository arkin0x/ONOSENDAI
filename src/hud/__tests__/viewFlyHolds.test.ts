/**
 * viewFlyHolds.test.ts - FAR and NEAR in VIEW (arkinox, 2026-11-09: "when
 * using the move forward and backward functions in VIEW mode, I want the
 * movement to be smooth and not tied to the nearest cursor block"): the
 * pad's FAR and NEAR, and R and F, held in VIEW, fly the view as the fly
 * buttons do; anywhere else they step the cursor a cell as before.
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
import { flyDir, useViewFly } from '../../lib/viewFly'

const press = { pointerType: 'touch', button: 0, pointerId: 7, preventDefault: () => {}, stopPropagation: () => {}, currentTarget: { setPointerCapture: () => {} } }

afterEach(() => { useViewFly.setState({ button: 0, pad: 0, key: 0, touch: 0 }) })

describe('the pad\'s FAR and NEAR fly while held in VIEW', () => {
  it('FAR flies forward and NEAR back while held, and stop when let go', () => {
    const far = flyHold('pad', 1)
    far.onPointerDown(press as never)
    expect(useViewFly.getState().pad).toBe(1)
    expect(flyDir()).toBe(1)
    far.onPointerUp()
    expect(flyDir()).toBe(0)
    const near = flyHold('pad', -1)
    near.onPointerDown(press as never)
    expect(flyDir()).toBe(-1)
    near.onLostPointerCapture()
    expect(flyDir()).toBe(0)
  })

  it('a lift of one does not stop the other\'s fly, and the pad never touches the buttons\' hold', () => {
    flyHold('pad', 1).onPointerDown(press as never)
    flyHold('pad', -1).onPointerUp()
    expect(useViewFly.getState().pad).toBe(1)
    expect(useViewFly.getState().button).toBe(0)
  })

  it('TouchControls hands FAR and NEAR to the hold only while the view flies (canFly); otherwise they step as before', () => {
    const src = readFileSync('src/hud/TouchControls.tsx', 'utf8')
    expect(src).toMatch(/sub: 'FAR', title: 'Away from camera \(R\)', act: move\('away'\), fly: 1/)
    expect(src).toMatch(/sub: 'NEAR', title: 'Toward camera \(F\)', act: move\('toward'\), fly: -1/)
    expect(src).toMatch(/\{\.\.\.\(flies && b\.fly \? flyHold\('pad', b\.fly\) : bind\(b\.act\)\)\}/)
    expect(src).toMatch(/const flies = useCyberspace\(\(s\) => canFly\(s, building\)\)/)
  })
})

describe('R and F fly while held in VIEW', () => {
  it('R\'s keyup ends R\'s fly, and leaves F\'s alone', () => {
    useViewFly.getState().setKey(1)
    flyKeyUp('KeyF')
    expect(useViewFly.getState().key).toBe(1)
    flyKeyUp('KeyR')
    expect(useViewFly.getState().key).toBe(0)
    useViewFly.getState().setKey(-1)
    flyKeyUp('KeyF')
    expect(flyDir()).toBe(0)
  })

  it('useKeyboard sends R and F to the fly in VIEW, before its cell step, and lets go on keyup and blur', () => {
    const src = readFileSync('src/hooks/useKeyboard.ts', 'utf8')
    const at = src.indexOf("if (event.code === 'KeyR' || event.code === 'KeyF') {")
    const block = src.slice(at, src.indexOf('return\n      }', at))
    expect(block.indexOf('canFly(store, building)')).toBeGreaterThan(0)
    expect(block.indexOf('setKey(')).toBeLessThan(block.indexOf('store.moveCursor('))
    expect(src).toMatch(/if \(event\.code === 'KeyR' \|\| event\.code === 'KeyF'\) flyKeyUp\(event\.code\)/)
    expect(src).toMatch(/window\.addEventListener\('blur', flyKeysReleased\)/)
  })
})
