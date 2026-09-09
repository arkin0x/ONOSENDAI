import { describe, expect, it } from 'vitest'
import { neighborPositions } from './useChatFeed'

describe('the 26 neighbors', () => {
  it('are one cube away in every direction, and never the cube itself', () => {
    const at = { x: 5n << 12n, y: 7n << 12n, z: 9n << 12n }
    const n = neighborPositions(at, 12)
    expect(n).toHaveLength(26)
    expect(n.some((p) => p.x === at.x && p.y === at.y && p.z === at.z)).toBe(false)
    for (const p of n) for (const a of ['x', 'y', 'z'] as const) expect([-1n, 0n, 1n]).toContain((p[a] - at[a]) / (1n << 12n))
  })

  it('leave out the ones past the edge of cyberspace', () => {
    expect(neighborPositions({ x: 0n, y: 0n, z: 0n }, 12)).toHaveLength(7)
    expect(neighborPositions({ x: (1n << 85n) - 1n, y: 0n, z: 0n }, 12)).toHaveLength(7)
  })
})
