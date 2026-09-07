import { beforeEach, describe, expect, it } from 'vitest'
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
    S().moveCursor({ axis: 'x', dir: 1 })
    expect(S().cursor.x).toBeGreaterThan(there.x)
    expect(S().position).toEqual(home)
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
