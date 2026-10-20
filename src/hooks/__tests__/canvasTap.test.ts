import { describe, expect, it, vi } from 'vitest'
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

function setup() {
  const win = new EventTarget()
  const onTap = vi.fn()
  const off = installCanvasTap(win, onTap)
  /** A tap on the canvas: down, lift, then the click, with `between` run after the lift (the browser's gap). */
  const tap = (opts: { at?: object; clickOn?: object; moved?: number; heldMs?: number; scene?: () => void } = {}) => {
    const at = opts.at ?? canvas
    win.dispatchEvent(ev('pointerdown', at, 100, 100, 0))
    win.dispatchEvent(ev('pointerup', at, 100 + (opts.moved ?? 0), 100, opts.heldMs ?? 80))
    // R3F's onClick runs on the canvas, before the window's own listener.
    opts.scene?.()
    win.dispatchEvent(ev('click', opts.clickOn ?? at))
  }
  return { win, onTap, off, tap }
}

describe('scene tap: the controls toggle only when nothing in the scene took the tap', () => {
  it('a tap on empty space toggles', () => {
    const { onTap, tap } = setup()
    tap()
    expect(onTap).toHaveBeenCalledTimes(1)
  })

  it('a tap a shard takes on its click does not toggle', () => {
    const { onTap, tap } = setup()
    tap({ scene: markSceneTapHandled })
    expect(onTap).not.toHaveBeenCalled()
  })

  it('nothing is decided at the lift: no toggle before the click comes', () => {
    const { win, onTap } = setup()
    win.dispatchEvent(ev('pointerdown', canvas, 100, 100, 0))
    win.dispatchEvent(ev('pointerup', canvas, 100, 100, 80))
    expect(onTap).not.toHaveBeenCalled()
  })

  it('a drag, a long press, a press off the canvas, or a click landing on a control does not toggle', () => {
    const { onTap, tap } = setup()
    tap({ moved: 40 })
    tap({ heldMs: 900 })
    tap({ at: button })
    tap({ clickOn: button })
    expect(onTap).not.toHaveBeenCalled()
  })

  it('a click with no tap before it (a keyboard click, a cancelled press) does not toggle', () => {
    const { win, onTap } = setup()
    win.dispatchEvent(ev('click', canvas))
    win.dispatchEvent(ev('pointerdown', canvas, 100, 100, 0))
    win.dispatchEvent(new Event('pointercancel'))
    win.dispatchEvent(ev('click', canvas))
    expect(onTap).not.toHaveBeenCalled()
  })

  it('uninstalled, it listens to nothing', () => {
    const { onTap, off, tap } = setup()
    off()
    tap()
    expect(onTap).not.toHaveBeenCalled()
  })
})
