import { describe, expect, it } from 'vitest'
import { GHOST_FADE_MS, WalkGhost, type GhostInput } from '../walkGhost'
import { canonicalQuaternion, viewAxes, type Position } from '../space'

const axes = viewAxes(canonicalQuaternion())
const at = (x: number): Position => ({ x: 1000n + BigInt(x), y: 500n, z: 500n })

/** The store as the ghost reads it: proven head `head`, the walk's eye at `eye`, the scene anchored on the head. */
function input(head: number, eye: number, walking = true): GhostInput {
  return { walking, cursor: at(eye), position: at(head), anchor: at(head), scaleExp: 0, axes: () => axes }
}

/** Distance along the walk, in cells, between where the ghost is drawn and the eye. */
function gap(g: { at: [number, number, number] }, head: number, eye: number): number {
  // The scene is anchored on `head`, so the eye is drawn at (eye - head) cells along the walk's axis.
  const along = axes.right.axis === 'x' ? 0 : axes.up.axis === 'x' ? 1 : 2
  const sign = [axes.right, axes.up, axes.out].find((a) => a.axis === 'x')!.dir
  return (eye - head) * sign - g.at[along]
}

describe('WalkGhost', () => {
  it('is not drawn while the chain is caught up and nothing has been pressed', () => {
    const g = new WalkGhost()
    expect(g.frame(input(0, 0), 0, 0.016)).toBeNull()
  })

  it('appears at the proven head at once, at full strength, when a step is pressed', () => {
    const g = new WalkGhost()
    const f = g.frame(input(0, 1), 0, 0.016)!
    expect(f.fade).toBe(1)
    expect(gap(f, 0, 1)).toBeCloseTo(1)
  })

  it('glides from one proven step to the next while still behind, and never passes the eye', () => {
    const g = new WalkGhost()
    g.frame(input(0, 3), 0, 0.016)
    // Step 1 lands: the scene re-anchors on it, and the ghost starts where it was drawn.
    const first = g.frame(input(1, 3), 16, 0)!
    expect(gap(first, 1, 3)).toBeCloseTo(3)
    let last = first
    for (let t = 32; t < 2000; t += 16) {
      last = g.frame(input(1, 3), t, 0.016)!
      expect(gap(last, 1, 3)).toBeGreaterThanOrEqual(2 - 1e-9)
    }
    expect(gap(last, 1, 3)).toBeCloseTo(2)
  })

  it('fades out where it stood when the chain catches up, without moving to the eye', () => {
    const g = new WalkGhost()
    g.frame(input(0, 1), 0, 0.016)
    for (let t = 16; t < 1000; t += 16) g.frame(input(0, 1), t, 0.016)
    // The last step lands: head and eye are the same cell now.
    const landed = g.frame(input(1, 1), 1000, 0.016)!
    expect(gap(landed, 1, 1)).toBeCloseTo(1)
    expect(landed.fade).toBeCloseTo(1)
    const mid = g.frame(input(1, 1), 1000 + GHOST_FADE_MS / 2, 0.016)!
    expect(gap(mid, 1, 1)).toBeCloseTo(1)
    expect(mid.fade).toBeCloseTo(0.5)
    expect(g.frame(input(1, 1), 1000 + GHOST_FADE_MS, 0.016)).toBeNull()
    expect(g.frame(input(1, 1), 2000, 0.016)).toBeNull()
  })

  it('comes back at the proven head with no glide when pressed again, even mid-fade', () => {
    const g = new WalkGhost()
    g.frame(input(0, 1), 0, 0.016)
    g.frame(input(1, 1), 500, 0.016)
    const again = g.frame(input(1, 2), 600, 0.016)!
    expect(again.fade).toBe(1)
    expect(gap(again, 1, 2)).toBeCloseTo(1)
  })

  it('is never drawn out of WALK, and starts fresh on the way back in', () => {
    const g = new WalkGhost()
    g.frame(input(0, 2), 0, 0.016)
    expect(g.frame(input(0, 2, false), 16, 0.016)).toBeNull()
    expect(g.frame(input(0, 0), 32, 0.016)).toBeNull()
  })
})
