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

  it('keeps measuring while the target markers watch, whatever the scene does', async () => {
    const { readCovers, registerCover, setCoverWatch } = await import('../useCover')
    const col = fakeElement({ left: 16, top: 16, right: 336, bottom: 784 })
    const off = registerCover(col.el, 'left')
    setCoverWatch(true, 'targets')
    expect(readCovers()).toHaveLength(1)
    // BUILD starts and ends: the scene's watch ending must not end the markers'.
    setCoverWatch(true)
    setCoverWatch(false)
    col.move(100)
    vi.advanceTimersByTime(500)
    expect(readCovers()[0].box.top).toBe(100)
    setCoverWatch(false, 'targets')
    const reads = col.reads()
    vi.advanceTimersByTime(10_000)
    expect(col.reads()).toBe(reads)
    off()
  })

  it('says which covers the target markers keep clear of: all but the pad', async () => {
    const { readCovers, registerCover, setCoverWatch } = await import('../useCover')
    const col = fakeElement({ left: 16, top: 16, right: 336, bottom: 784 })
    const pad = fakeElement({ left: 276, top: 659, right: 398, bottom: 823 })
    const offCol = registerCover(col.el, 'left')
    const offPad = registerCover(pad.el, 'bottom', false)
    setCoverWatch(true, 'targets')
    // The markers alone: the pad is not even measured.
    expect(readCovers()).toEqual([{ edge: 'left', box: { left: 16, top: 16, right: 336, bottom: 784 } }])
    expect(pad.reads()).toBe(0)
    // BUILD's framing joins and counts it, marked as one the markers ignore.
    setCoverWatch(true)
    const covers = readCovers()
    expect(covers.find((c) => c.edge === 'left')?.markers).toBeUndefined()
    expect(covers.find((c) => c.edge === 'bottom')?.markers).toBe(false)
    // And when the framing leaves, the markers' measure drops it again.
    setCoverWatch(false)
    expect(readCovers()).toHaveLength(1)
    setCoverWatch(false, 'targets')
    offCol()
    offPad()
  })
})
