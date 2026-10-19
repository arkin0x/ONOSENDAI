/**
 * glContext.test.ts: a lost WebGL context, and its return, are said in the
 * console; after the stop, nothing is.
 */
import { describe, expect, it, vi } from 'vitest'
import { watchContext } from '../glContext'

describe('watching a WebGL context', () => {
  it('warns on loss and on restore, and stops when told', () => {
    const canvas = new EventTarget() as unknown as HTMLCanvasElement
    const warn = vi.fn()
    const stop = watchContext(canvas, 'main view', { warn })
    canvas.dispatchEvent(new Event('webglcontextlost'))
    canvas.dispatchEvent(new Event('webglcontextrestored'))
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn.mock.calls[0][0]).toMatch(/context lost: main view/)
    expect(warn.mock.calls[1][0]).toMatch(/context restored: main view/)
    stop()
    canvas.dispatchEvent(new Event('webglcontextlost'))
    expect(warn).toHaveBeenCalledTimes(2)
  })
})
