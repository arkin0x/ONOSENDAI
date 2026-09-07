import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCyberspace } from './useCyberspace'

const S = () => useCyberspace.getState()

describe('the free view', () => {
  beforeEach(() => { S().clearFocus() })

  it('brings the cursor along and lets the pad drive it there', () => {
    const home = { ...S().position }
    const there = { x: home.x + 1000n, y: home.y, z: home.z + 5n }
    S().focusOn(there, S().plane, 'there', undefined, true)
    expect(S().atHead()).toBe(false)
    expect(S().canDrive()).toBe(true)
    expect(S().cursor).toEqual(there)
    expect(S().anchor).toEqual(there)
    vi.useFakeTimers()
    try {
      S().moveCursor({ axis: 'x', dir: 1 })
      S().moveCursor({ axis: 'x', dir: 1 })
      expect(S().cursor.x).toBeGreaterThan(there.x)
      // The cursor moves at once; the view catches up once the presses settle.
      expect(S().anchor).toEqual(there)
      vi.advanceTimersByTime(300)
      expect(S().anchor).toEqual(S().cursor)
      expect(S().focus?.position).toEqual(S().cursor)
      expect(S().position).toEqual(home)
    } finally { vi.useRealTimers() }
  })

  it('does not catch up after RETURN', () => {
    vi.useFakeTimers()
    try {
      S().focusOn({ x: 20n, y: 20n, z: 20n }, 0, 'there', undefined, true)
      S().moveCursor({ axis: 'y', dir: 1 })
      S().clearFocus()
      vi.advanceTimersByTime(300)
      expect(S().anchor).toEqual(S().position)
      expect(S().focus).toBeNull()
    } finally { vi.useRealTimers() }
  })

  it('shows and flips the plane it looks at, keeping the cursor', () => {
    S().focusOn({ x: 5n, y: 5n, z: 5n }, 1, 'there', undefined, true)
    expect(S().anchorPlane).toBe(1)
    const mine = S().plane
    S().togglePlane()
    expect(S().anchorPlane).toBe(0)
    expect(S().focus?.plane).toBe(0)
    expect(S().cursor).toEqual({ x: 5n, y: 5n, z: 5n })
    // The flip is the view's alone; home is still in your own plane.
    expect(S().plane).toBe(mine)
    S().clearFocus()
    expect(S().anchorPlane).toBe(mine)
  })

  it('leaves the cursor where it was for a plain focus, which cannot be driven', () => {
    const before = { ...S().cursor }
    S().focusOn({ x: 7n, y: 7n, z: 7n }, 0, 'a shard')
    expect(S().canDrive()).toBe(false)
    expect(S().cursor).toEqual(before)
    S().moveCursor({ axis: 'x', dir: 1 })
    expect(S().cursor).toEqual(before)
  })

  it('RETURN puts the anchor home and the pad back on your head', () => {
    S().focusOn({ x: 9n, y: 9n, z: 9n }, 0, 'there', undefined, true)
    S().clearFocus()
    expect(S().atHead()).toBe(true)
    expect(S().anchor).toEqual(S().position)
    expect(S().cursor).toEqual(S().position)
  })
})
