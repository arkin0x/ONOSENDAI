/**
 * useCover.test.ts: the covers over the scene are measured only while the
 * scene watches them, in BUILD (review of #505: the pad is registered nearly
 * all the time, and a layout read twice a second through HOP, VIEW and TV
 * bought nothing).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** An element whose box can be moved, counting the layout reads made of it. */
function fakeElement(box: { left: number; top: number; right: number; bottom: number }): { el: HTMLElement; reads: () => number; move: (top: number) => void } {
  let n = 0
  const b = { ...box }
  const el = {
    getBoundingClientRect: () => { n++; return { ...b, width: b.right - b.left, height: b.bottom - b.top } },
  } as unknown as HTMLElement
  return { el, reads: () => n, move: (top) => { const h = b.bottom - b.top; b.top = top; b.bottom = top + h } }
}

describe('useCover', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('window', {
      setInterval: (f: () => void, ms: number) => setInterval(f, ms),
      clearInterval: (id: number) => clearInterval(id),
      addEventListener: () => {},
      removeEventListener: () => {},
    })
    vi.resetModules()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('reads no layout while nothing watches, however long the pad is up', async () => {
    const { registerCover } = await import('../useCover')
    const pad = fakeElement({ left: 276, top: 659, right: 398, bottom: 823 })
    const off = registerCover(pad.el, 'bottom')
    vi.advanceTimersByTime(10_000)
    expect(pad.reads()).toBe(0)
    off()
    expect(pad.reads()).toBe(0)
  })

  it('measures when the watch begins, twice a second while it lasts, and stops with it', async () => {
    const { readCovers, registerCover, setCoverWatch } = await import('../useCover')
    const pad = fakeElement({ left: 276, top: 659, right: 398, bottom: 823 })
    const off = registerCover(pad.el, 'bottom')
    setCoverWatch(true)
    expect(readCovers()).toEqual([{ edge: 'bottom', box: { left: 276, top: 659, right: 398, bottom: 823 } }])
    const first = readCovers()
    vi.advanceTimersByTime(1000)
    expect(pad.reads()).toBe(3)
    // Nothing moved: the same snapshot, so the scene keeps its worked-out framing.
    expect(readCovers()).toBe(first)
    // A pad that moves without changing size is caught by the next measure.
    pad.move(620)
    vi.advanceTimersByTime(500)
    expect(readCovers()[0].box.top).toBe(620)
    setCoverWatch(false)
    const reads = pad.reads()
    vi.advanceTimersByTime(10_000)
    expect(pad.reads()).toBe(reads)
    off()
  })
})
