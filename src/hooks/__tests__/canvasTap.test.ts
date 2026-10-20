import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installCanvasTap, markSceneTapHandled } from '../useCanvasTap'

const canvas = { tagName: 'CANVAS' }
const button = { tagName: 'BUTTON' }

function ev(type: string, target: object, x = 100, y = 100, timeStamp = 0, isPrimary = true): Event {
  const e = new Event(type)
  Object.defineProperties(e, {
    target: { value: target },
    clientX: { value: x }, clientY: { value: y },
    timeStamp: { value: timeStamp }, isPrimary: { value: isPrimary },
  })
  return e
}

// One clock for the hook and markSceneTapHandled, moved on a second before
// each test, so a claim made in one test is long gone in the next.
let clock = 0
beforeEach(() => { clock += 1000; vi.spyOn(performance, 'now').mockImplementation(() => clock) })
afterEach(() => { vi.restoreAllMocks() })

interface TapOpts { at?: object; clickOn?: object; moved?: number; heldMs?: number; primary?: boolean; gapMs?: number; scene?: () => void }

function setup() {
  const win = new EventTarget()
  const onTap = vi.fn()
  const off = installCanvasTap(win, onTap)
  /** A press, its lift, then the click after `gapMs`; `scene` runs where R3F's onClick would, before the window's listener. */
  const tap = (o: TapOpts = {}) => {
    const at = o.at ?? canvas
    win.dispatchEvent(ev('pointerdown', at, 100, 100, 0, o.primary ?? true))
    win.dispatchEvent(ev('pointerup', at, 100 + (o.moved ?? 0), 100, o.heldMs ?? 80, o.primary ?? true))
    clock += o.gapMs ?? 10
    o.scene?.()
    win.dispatchEvent(ev('click', o.clickOn ?? at))
    clock += 100
  }
  return { win, onTap, off, tap }
}

describe('scene tap: the controls toggle only when nothing in the scene took the tap', () => {
  it('a tap on empty space toggles', () => {
    const { onTap, tap } = setup()
    tap()
    expect(onTap).toHaveBeenCalledTimes(1)
  })

  it('a tap a shard takes on its click does not toggle, and the next empty tap does', () => {
    const { onTap, tap } = setup()
    tap({ scene: markSceneTapHandled })
    expect(onTap).not.toHaveBeenCalled()
    tap()
    expect(onTap).toHaveBeenCalledTimes(1)
  })

  it('nothing is decided at the lift: no toggle before the click comes', () => {
    const { win, onTap } = setup()
    win.dispatchEvent(ev('pointerdown', canvas, 100, 100, 0))
    win.dispatchEvent(ev('pointerup', canvas, 100, 100, 80))
    expect(onTap).not.toHaveBeenCalled()
  })

  for (const [name, o] of [
    ['a drag past the slop', { moved: 40 }],
    ['a long press', { heldMs: 900 }],
    ['a press that started off the canvas', { at: button }],
    ['a click that lands on a control', { clickOn: button }],
    ['a second finger', { primary: false }],
    ['a click that comes too long after the lift', { gapMs: 1500 }],
  ] as [string, TapOpts][]) {
    it(`${name} does not toggle (and a plain tap after it does)`, () => {
      const { onTap, tap } = setup()
      tap(o)
      expect(onTap).not.toHaveBeenCalled()
      tap()
      expect(onTap).toHaveBeenCalledTimes(1)
    })
  }

  it('a click with no tap before it does not toggle, nor does one after a cancelled press', () => {
    const { win, onTap, tap } = setup()
    win.dispatchEvent(ev('click', canvas))
    win.dispatchEvent(ev('pointerdown', canvas, 100, 100, 0))
    win.dispatchEvent(new Event('pointercancel'))
    win.dispatchEvent(ev('click', canvas))
    expect(onTap).not.toHaveBeenCalled()
    tap()
    expect(onTap).toHaveBeenCalledTimes(1)
  })

  it('one lift answers one click only', () => {
    const { win, onTap, tap } = setup()
    tap()
    win.dispatchEvent(ev('click', canvas))
    expect(onTap).toHaveBeenCalledTimes(1)
  })

  it('uninstalled, a qualifying lift and click toggle nothing', () => {
    const { win, onTap, off } = setup()
    win.dispatchEvent(ev('pointerdown', canvas, 100, 100, 0))
    win.dispatchEvent(ev('pointerup', canvas, 100, 100, 80))
    off()
    win.dispatchEvent(ev('click', canvas))
    expect(onTap).not.toHaveBeenCalled()
  })
})
