/**
 * space.test.ts — covers the coordinate and view maths that the renderer
 * depends on. These are the parts that fail silently: a wrong axis mapping or a
 * float-truncated offset still draws a plausible-looking grid.
 */

import { describe, it, expect } from 'vitest'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { AXIS_MAX, findLcaHeight } from 'cyberspace-core'
import {
  MAX_SCALE_EXP,
  alignTo,
  boundaryCoord,
  boundaryHeight,
  canonicalQuaternion,
  clampAxis,
  flipHandedness,
  rotateView,
  snapToAxis,
  stepFor,
  subCellFraction,
  topDownQuaternion,
  trailingZeros,
  viewAxes,
} from './space'

describe('scale helpers', () => {
  it('computes step sizes as powers of two', () => {
    expect(stepFor(0)).toBe(1n)
    expect(stepFor(10)).toBe(1024n)
    expect(stepFor(84)).toBe(1n << 84n)
  })

  it('aligns down to the containing cell', () => {
    expect(alignTo(1000n, 0)).toBe(1000n)
    expect(alignTo(1000n, 10)).toBe(0n)
    expect(alignTo(1025n, 10)).toBe(1024n)
  })

  it('counts trailing zeros', () => {
    expect(trailingZeros(0n)).toBe(0)
    expect(trailingZeros(1n)).toBe(0)
    expect(trailingZeros(8n)).toBe(3)
    expect(trailingZeros(1n << 40n)).toBe(40)
  })

  it('clamps to the axis bounds', () => {
    expect(clampAxis(-5n)).toBe(0n)
    expect(clampAxis(AXIS_MAX + 10n)).toBe(AXIS_MAX)
    expect(clampAxis(42n)).toBe(42n)
  })
})

describe('boundary cost', () => {
  // Spec 4.4: cost depends on which boundary is crossed, not distance travelled.
  it('charges more to cross into 8 than into 9', () => {
    expect(boundaryHeight(8n, 0)).toBe(4)
    expect(boundaryHeight(9n, 0)).toBe(1)
  })

  it('charges the full height at a large power-of-two boundary', () => {
    // Crossing into 2^k costs k + 1, following h = bit_length(v1 XOR v2):
    // (2^34 - 1) XOR 2^34 = 2^35 - 1, whose bit length is 35.
    //
    // CYBERSPACE_V2.md section 4.4 says this step has "LCA height 34" and needs
    // "over 17 billion leaves". That prose is off by one against the spec's own
    // formula and its own worked 7 -> 8 example (7 XOR 8 = 15, bit_length 4,
    // h = 4, i.e. crossing into 2^3 costs 4). The formula is authoritative and
    // is what both the Python and TypeScript implementations do.
    expect(boundaryHeight(1n << 34n, 0)).toBe(35)
    expect(boundaryHeight(8n, 0)).toBe(4) // the spec's own example, same rule
  })

  it('never reports below the floor for the scale', () => {
    for (let scaleExp = 0; scaleExp <= 20; scaleExp++) {
      const step = stepFor(scaleExp)
      // A boundary two cells up is aligned but otherwise unremarkable.
      const c = step * 2n
      expect(boundaryHeight(c, scaleExp)).toBeGreaterThanOrEqual(scaleExp + 1)
    }
  })

  it('agrees with the protocol LCA function', () => {
    const step = stepFor(6)
    const c = step * 5n
    expect(boundaryHeight(c, 6)).toBe(findLcaHeight(c - step, c))
  })

  it('returns 0 at the axis origin, where there is nothing to cross', () => {
    expect(boundaryHeight(0n, 0)).toBe(0)
  })
})

describe('boundaryCoord', () => {
  const origin = 1000n
  const step = 8n

  it('resolves the boundary below cell i when the axis points right', () => {
    // Cell 0 starts at 1000, cell -1 starts at 992, so the boundary is 1000.
    expect(boundaryCoord(origin, 0, step, 1)).toBe(1000n)
    expect(boundaryCoord(origin, 1, step, 1)).toBe(1008n)
    expect(boundaryCoord(origin, -1, step, 1)).toBe(992n)
  })

  it('resolves the same physical boundaries when the axis is flipped', () => {
    // With dir = -1 the cells march the other way, but each returned value must
    // still be a real cell start, never a midpoint.
    for (let i = -4; i <= 4; i++) {
      const c = boundaryCoord(origin, i, step, -1)
      expect(c % step).toBe(0n)
    }
    expect(boundaryCoord(origin, 0, step, -1)).toBe(1008n)
    expect(boundaryCoord(origin, 1, step, -1)).toBe(1000n)
  })

  it('always returns the larger of the two adjacent cell starts', () => {
    for (const dir of [1, -1]) {
      for (let i = -3; i <= 3; i++) {
        const here = origin + BigInt(i) * step * BigInt(dir)
        const before = origin + BigInt(i - 1) * step * BigInt(dir)
        expect(boundaryCoord(origin, i, step, dir)).toBe(here > before ? here : before)
      }
    }
  })
})

describe('subCellFraction', () => {
  it('is always zero at gibson scale', () => {
    expect(subCellFraction(12345n, 0)).toBe(0)
  })

  it('locates a position inside its cell', () => {
    expect(subCellFraction(1024n + 512n, 10)).toBeCloseTo(0.5, 3)
    expect(subCellFraction(1024n, 10)).toBe(0)
  })

  it('survives steps larger than 2^53, where float division would collapse', () => {
    const scaleExp = 80
    const step = stepFor(scaleExp)
    const value = step * 3n + step / 4n
    expect(subCellFraction(value, scaleExp)).toBeCloseTo(0.25, 3)
    // The naive implementation loses this entirely.
    expect(Number(step / 4n) / Number(step)).not.toBeNaN()
  })

  it('stays within [0, 1) across scales', () => {
    for (let scaleExp = 0; scaleExp <= MAX_SCALE_EXP; scaleExp += 7) {
      const f = subCellFraction((1n << 84n) + 12345n, scaleExp)
      expect(f).toBeGreaterThanOrEqual(0)
      expect(f).toBeLessThan(1)
    }
  })
})

describe('canonical view (CYBERSPACE_V2.md section 11.3)', () => {
  it('faces the black sun: +X right, +Y up, looking toward +Z', () => {
    const axes = viewAxes(canonicalQuaternion())
    expect(axes.right).toEqual({ axis: 'x', dir: 1 })
    expect(axes.up).toEqual({ axis: 'y', dir: 1 })
    // "out" points at the viewer, so looking toward +Z means out is -Z.
    expect(axes.out).toEqual({ axis: 'z', dir: -1 })
  })

  it('is reachable from the top-down view by rotation alone', () => {
    // Section 11.4 forbids mirroring or re-labelling axes, so the canonical
    // view must sit in the same rotation group as every other view.
    const dirs = ['left', 'right', 'up', 'down'] as const
    const target = canonicalQuaternion()
    const seen = new Set<string>()
    const frontier = [topDownQuaternion()]
    let reached = false

    while (frontier.length > 0) {
      const q = frontier.pop()!
      if (q.angleTo(target) < 1e-6) {
        reached = true
        break
      }
      const a = viewAxes(q)
      const k = `${a.right.axis}${a.right.dir}|${a.up.axis}${a.up.dir}`
      if (seen.has(k)) continue
      seen.add(k)
      for (const dir of dirs) frontier.push(rotateView(q, dir))
    }

    expect(reached).toBe(true)
  })

  it('is right-handed in render space, so the image is not mirrored', () => {
    const q = canonicalQuaternion()
    const right = new Vector3(1, 0, 0).applyQuaternion(q)
    const up = new Vector3(0, 1, 0).applyQuaternion(q)
    const back = new Vector3(0, 0, 1).applyQuaternion(q)
    // right x up must equal back for a right-handed basis.
    expect(right.clone().cross(up).angleTo(back)).toBeLessThan(1e-6)
  })
})

describe('handedness (CYBERSPACE_V2.md sections 9.4 and 11.4)', () => {
  it('is its own inverse', () => {
    const v = new Vector3(3, -5, 7)
    expect(flipHandedness(flipHandedness(v)).equals(v)).toBe(true)
  })

  it('inverts handedness, which is what makes cyberspace left-handed', () => {
    // X_cs = X_ecef, Y_cs = Z_ecef, Z_cs = Y_ecef is a two-axis swap of a
    // right-handed frame, so the cyberspace basis has determinant -1.
    const m = new Matrix4().makeBasis(
      new Vector3(1, 0, 0), // X_cs = X_ecef
      new Vector3(0, 0, 1), // Y_cs = Z_ecef
      new Vector3(0, 1, 0), // Z_cs = Y_ecef
    )
    expect(m.determinant()).toBeCloseTo(-1, 10)
  })

  it('renders every view without mirroring', () => {
    // A mirrored basis would still draw a plausible grid, so assert the
    // property directly across the whole reachable view set.
    const dirs = ['left', 'right', 'up', 'down'] as const
    let q = topDownQuaternion()
    for (let i = 0; i < 24; i++) {
      q = rotateView(q, dirs[(i * 5 + 1) % 4])
      const right = new Vector3(1, 0, 0).applyQuaternion(q)
      const up = new Vector3(0, 1, 0).applyQuaternion(q)
      const back = new Vector3(0, 0, 1).applyQuaternion(q)
      expect(right.clone().cross(up).angleTo(back)).toBeLessThan(1e-6)
    }
  })

  it('keeps screen axes a valid cyberspace frame in every view', () => {
    const dirs = ['left', 'up', 'right', 'down'] as const
    let q = topDownQuaternion()
    for (let i = 0; i < 24; i++) {
      q = rotateView(q, dirs[i % 4])
      const a = viewAxes(q)
      expect(new Set([a.right.axis, a.up.axis, a.out.axis]).size).toBe(3)
    }
  })
})

describe('view orientation', () => {
  it('starts top-down with +X right, +Z up, +Y toward the viewer', () => {
    // With handedness converted, forward (+Z, the black sun direction) points
    // up the screen, which is the conventional map orientation.
    const axes = viewAxes(topDownQuaternion())
    expect(axes.right).toEqual({ axis: 'x', dir: 1 })
    expect(axes.up).toEqual({ axis: 'z', dir: 1 })
    expect(axes.out).toEqual({ axis: 'y', dir: 1 })
  })

  it('snaps arbitrary directions to the dominant world axis', () => {
    expect(snapToAxis(new Vector3(0.9, 0.1, 0))).toEqual({ axis: 'x', dir: 1 })
    expect(snapToAxis(new Vector3(0, -0.8, 0.2))).toEqual({ axis: 'y', dir: -1 })
  })

  it('returns to the original orientation after four rotations', () => {
    for (const dir of ['left', 'right', 'up', 'down'] as const) {
      let q = topDownQuaternion()
      for (let i = 0; i < 4; i++) q = rotateView(q, dir)
      expect(q.angleTo(topDownQuaternion())).toBeLessThan(1e-6)
    }
  })

  it('keeps every reachable view axis-aligned', () => {
    // Walk a pseudo-random rotation sequence and assert the basis never drifts
    // off-axis, which is what would break the screen-to-world move mapping.
    const dirs = ['left', 'right', 'up', 'down'] as const
    let q = topDownQuaternion()
    for (let i = 0; i < 40; i++) {
      q = rotateView(q, dirs[(i * 7 + 3) % 4])
      for (const basis of [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]) {
        const v = basis.clone().applyQuaternion(q)
        const dominant = Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z))
        expect(dominant).toBeGreaterThan(0.999)
      }
    }
  })

  it('yields three mutually distinct screen axes in every view', () => {
    const dirs = ['left', 'up', 'right', 'down'] as const
    let q = topDownQuaternion()
    for (let i = 0; i < 24; i++) {
      q = rotateView(q, dirs[i % 4])
      const axes = viewAxes(q)
      const used = new Set([axes.right.axis, axes.up.axis, axes.out.axis])
      expect(used.size).toBe(3)
    }
  })

  it('rotates left and right in opposite directions', () => {
    const base = topDownQuaternion()
    const left = viewAxes(rotateView(base, 'left'))
    const right = viewAxes(rotateView(base, 'right'))
    expect(left.right.axis).toBe(right.right.axis)
    expect(left.right.dir).toBe(-right.right.dir)
  })

  it('preserves the up axis when yawing and the right axis when pitching', () => {
    const base = topDownQuaternion()
    // Yaw keeps screen-up pinned to the same world axis it already had.
    expect(viewAxes(rotateView(base, 'right')).up).toEqual(viewAxes(base).up)
    // Pitch keeps screen-right pinned.
    expect(viewAxes(rotateView(base, 'up')).right).toEqual(viewAxes(base).right)
  })

  it('does not mutate the quaternion it is given', () => {
    const base = topDownQuaternion()
    const snapshot = base.clone()
    rotateView(base, 'left')
    expect(base.equals(snapshot)).toBe(true)
  })
})

describe('view history invariants', () => {
  it('treats rotation as reversible, which is what Tab relies on', () => {
    const base = topDownQuaternion()
    const rotated = rotateView(base, 'right')
    const back = rotateView(rotated, 'left')
    expect(back.angleTo(base)).toBeLessThan(1e-6)
  })

  it('produces exactly 24 distinct axis-aligned orientations', () => {
    const seen = new Set<string>()
    const frontier: Quaternion[] = [topDownQuaternion()]
    const key = (q: Quaternion) => {
      const a = viewAxes(q)
      return `${a.right.axis}${a.right.dir}|${a.up.axis}${a.up.dir}|${a.out.axis}${a.out.dir}`
    }

    while (frontier.length > 0) {
      const q = frontier.pop()!
      const k = key(q)
      if (seen.has(k)) continue
      seen.add(k)
      for (const dir of ['left', 'right', 'up', 'down'] as const) {
        frontier.push(rotateView(q, dir))
      }
    }

    expect(seen.size).toBe(24)
  })
})
