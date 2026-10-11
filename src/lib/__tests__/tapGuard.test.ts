/**
 * tapGuard.test.ts: a press that starts on a backdrop closes the modal and
 * clicks nothing underneath (arkinox, 2026-10-11).
 */
import { describe, expect, it } from 'vitest'
import { installTapGuard, isBackdrop, SWALLOW_MS } from '../tapGuard'

class FakeWin {
  fns: Record<string, ((e: Event) => void)[]> = {}
  addEventListener(t: string, fn: (e: Event) => void): void { (this.fns[t] ??= []).push(fn) }
  removeEventListener(t: string, fn: (e: Event) => void): void { this.fns[t] = (this.fns[t] ?? []).filter((f) => f !== fn) }
  fire(type: string, target: unknown, pointerId = 1): { prevented: boolean; stopped: boolean } {
    const r = { prevented: false, stopped: false }
    const e = { type, target, pointerId, preventDefault: () => { r.prevented = true }, stopPropagation: () => { r.stopped = true } } as unknown as Event
    for (const fn of this.fns[type] ?? []) fn(e)
    return r
  }
}
const el = (...classes: string[]) => ({ classList: { contains: (c: string) => classes.includes(c) } })

describe('tap guard', () => {
  it('knows a backdrop from what sits inside one', () => {
    expect(isBackdrop(el('modal'))).toBe(true)
    expect(isBackdrop(el('modal', 'modal--top'))).toBe(true)
    expect(isBackdrop(el('benchpaste__away'))).toBe(true)
    expect(isBackdrop(el('modal__card'))).toBe(false)
    expect(isBackdrop(null)).toBe(false)
  })

  it('swallows the release and the click of a press that began on a backdrop', () => {
    const w = new FakeWin(); let t = 0
    installTapGuard(w, () => t)
    w.fire('pointerdown', el('modal'))
    const button = el('hud__button')
    expect(w.fire('pointerup', button).stopped).toBe(true)
    expect(w.fire('click', button)).toEqual({ prevented: true, stopped: true })
    // The next, real tap goes through.
    w.fire('pointerdown', button)
    expect(w.fire('pointerup', button).stopped).toBe(false)
    expect(w.fire('click', button).stopped).toBe(false)
  })

  it('leaves a press that began anywhere else alone', () => {
    const w = new FakeWin()
    installTapGuard(w, () => 0)
    w.fire('pointerdown', el('modal__card'))
    expect(w.fire('pointerup', el('x')).stopped).toBe(false)
    expect(w.fire('click', el('x')).stopped).toBe(false)
  })

  it('never eats a click long after the backdrop press', () => {
    const w = new FakeWin(); let t = 0
    installTapGuard(w, () => t)
    w.fire('pointerdown', el('modal'))
    t = SWALLOW_MS + 1
    expect(w.fire('click', el('x')).stopped).toBe(false)
  })

  it('leaves another finger alone', () => {
    const w = new FakeWin()
    installTapGuard(w, () => 0)
    w.fire('pointerdown', el('modal'), 1)
    expect(w.fire('pointerup', el('x'), 2).stopped).toBe(false)
  })
})
