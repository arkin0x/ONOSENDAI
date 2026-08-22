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
  cellCentre,
  cellDelta,
  cellOffset,
  claimScreenAxes,
  clampAxis,
  flipHandedness,
  originShift,
  renderDirection,
  rotateView,
  snapToAxis,
  stepFor,
  subCellFraction,
  topDownQuaternion,
  trailingZeros,
  viewAxes,
  type Position,
  type ViewAxes,
} from './space'
import { alignedOrigin } from '../store/useCyberspace'

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

describe('cellDelta / cellOffset', () => {
  it('measures signed distance from an origin, in cells', () => {
    expect(cellDelta(1034n, 1024n, 0)).toBe(10)
    expect(cellDelta(512n, 1024n, 10)).toBeCloseTo(-0.5, 3)
  })

  it('survives steps larger than 2^53, where float division would collapse', () => {
    const origin = 1n << 84n
    expect(cellDelta(origin + (1n << 83n), origin, 84)).toBeCloseTo(0.5, 3)
  })

  it('centres the marker on the occupied gibson at gibson scale', () => {
    // A coordinate names a whole unit gibson; at 2^0 the cell IS the gibson,
    // so the marker sits dead centre, not at the lattice corner.
    expect(cellOffset(12345n, 12345n, 0, 1)).toBe(0)
    expect(cellOffset(12345n, 12345n, 0, -1)).toBe(0)
    expect(cellOffset(12346n, 12345n, 0, 1)).toBe(1)
  })

  it('mirrors screen offsets when the axis points left or down', () => {
    // A point 1/4 into the avatar's cell renders 1/4 from the low edge (plus
    // the half-gibson centring nudge), and the low edge swaps sides when the
    // axis is flipped.
    const nudge = 0.5 / 1024
    expect(cellOffset(1024n + 256n, 1024n, 10, 1)).toBeCloseTo(-0.25 + nudge, 6)
    expect(cellOffset(1024n + 256n, 1024n, 10, -1)).toBeCloseTo(0.25 - nudge, 6)
  })

  it('reaches into neighbouring cells for cursor endpoints', () => {
    // Three cells to the right of the aligned origin, dead centre.
    expect(cellOffset(1024n * 4n + 512n, 1024n, 10, 1)).toBeCloseTo(3, 2)
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

describe('renderDirection: where an absolute axis has gone on screen', () => {
  const ALL = ['x', 'y', 'z'] as const

  it('puts the black sun dead ahead in the canonical view', () => {
    // Section 11.3's canonical view faces the black sun, so +Z_cs must come out
    // as straight into the screen. Render -Z is the direction the camera looks.
    const axes = viewAxes(canonicalQuaternion())
    expect(renderDirection(axes, 'z')).toEqual([0, 0, -1])
  })

  it('is a signed unit vector on exactly one render axis, for every view', () => {
    // Every orientation reachable by 90 degree rotations, which is every view
    // the app can be in.
    const seen = quarterTurnViews()
    for (const axes of seen) {
      for (const axis of ALL) {
        const v = renderDirection(axes, axis)
        const nonZero = v.filter((c) => c !== 0)
        expect(nonZero).toHaveLength(1)
        expect(Math.abs(nonZero[0])).toBe(1)
      }
    }
  })

  it('sends the three axes to three different render axes', () => {
    // viewAxes returns a permutation, so the inverse must be one too. If two
    // cyberspace axes landed on the same render axis, a direction-anchored
    // object would sit on top of another one and never separate.
    for (const axes of quarterTurnViews()) {
      const slots = ALL.map((a) => renderDirection(axes, a).findIndex((c) => c !== 0))
      expect(new Set(slots).size).toBe(3)
    }
  })

  it('agrees with viewAxes about which axis is where', () => {
    for (const axes of quarterTurnViews()) {
      const basis = [axes.right, axes.up, axes.out]
      for (let i = 0; i < 3; i++) {
        const v = renderDirection(axes, basis[i].axis)
        expect(v[i]).toBe(basis[i].dir)
      }
    }
  })
})

/** Every view reachable by 90 degree rotations from top-down. */
function quarterTurnViews(): ViewAxes[] {
  const out: ViewAxes[] = []
  const dirs = ['left', 'right', 'up', 'down'] as const
  for (const a of dirs) {
    for (const b of dirs) {
      let q = topDownQuaternion()
      q = rotateView(q, a)
      q = rotateView(q, b)
      out.push(viewAxes(q))
    }
  }
  out.push(viewAxes(topDownQuaternion()))
  out.push(viewAxes(canonicalQuaternion()))
  return out
}
/**
 * Deterministic [0, 1) stream, so a failing rotation is reproducible rather
 * than a one-off that vanishes on the next run.
 */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('screen axis permutation', () => {
  // Regression guard for the unreachable-axis bug. Snapping the camera's three
  // basis vectors to cyberspace axes INDEPENDENTLY does not have to yield three
  // different axes: near 45 degrees two of them round to the same one, and the
  // axis nobody claimed then has no key bound to it, so R/F aliases onto W/S and
  // the cursor cannot leave the screen plane. Nothing about the picture looks
  // wrong when that happens, which is why it needs an assertion rather than an
  // eye.
  const LOCAL = viewAxes(topDownQuaternion())

  /** The camera's basis, in the scene's local frame, for a given orientation. */
  const basisOf = (q: Quaternion): [Vector3, Vector3, Vector3] => [
    new Vector3(1, 0, 0).applyQuaternion(q),
    new Vector3(0, 1, 0).applyQuaternion(q),
    new Vector3(0, 0, 1).applyQuaternion(q),
  ]

  /** Index of the largest component: what independent snapping picks. */
  const dominant = (v: Vector3): number => {
    const c = [v.x, v.y, v.z]
    let i = 0
    for (let k = 1; k < 3; k++) if (Math.abs(c[k]) > Math.abs(c[i])) i = k
    return i
  }

  const expectPermutation = (a: ViewAxes): void => {
    expect(new Set([a.right.axis, a.up.axis, a.out.axis]).size).toBe(3)
    for (const d of [a.right, a.up, a.out]) {
      expect(Math.abs(d.dir)).toBe(1)
      expect(['x', 'y', 'z']).toContain(d.axis)
    }
  }

  it('leaves an axis-aligned camera exactly as it found it', () => {
    const [r, u, o] = basisOf(new Quaternion())
    expect(claimScreenAxes(r, u, o, LOCAL)).toEqual(LOCAL)
  })

  it('is a permutation at the 45 degree angles that broke it', () => {
    // Built by hand rather than by rotating a quaternion, because at exactly 45
    // degrees the two competing components are equal and the tie is the whole
    // point: routed through sin and cos they come out a bit apart, and which of
    // them wins is then an accident of rounding rather than the case under test.
    const s = Math.SQRT1_2
    const bases: Array<[Vector3, Vector3, Vector3]> = []
    for (const k of [1, -1]) {
      // Yaw, pitch and roll, each half-way between two axes.
      bases.push([new Vector3(s, 0, -k * s), new Vector3(0, 1, 0), new Vector3(k * s, 0, s)])
      bases.push([new Vector3(1, 0, 0), new Vector3(0, s, k * s), new Vector3(0, -k * s, s)])
      bases.push([new Vector3(s, k * s, 0), new Vector3(-k * s, s, 0), new Vector3(0, 0, 1)])
    }

    for (const [r, u, o] of bases) {
      // Assert the fixture really is adversarial before asserting the fix
      // survives it. A test built on a case that was never degenerate under the
      // old code protects nothing.
      expect(new Set([dominant(r), dominant(u), dominant(o)]).size).toBeLessThan(3)
      expectPermutation(claimScreenAxes(r, u, o, LOCAL))
    }
  })

  it('is a permutation on either side of 45 degrees, where the tie breaks', () => {
    // Just off the tie the old code is sometimes fine and sometimes not, which
    // is what made the bug intermittent: an orbit sweep measured 4 frames in 24
    // degenerate. Sweep the neighbourhood rather than only the exact angle.
    let degenerate = 0
    const axes = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]
    for (const axis of axes) {
      for (const turns of [1, 3, 5, 7]) {
        for (const nudge of [-1e-3, 0, 1e-3]) {
          const q = new Quaternion().setFromAxisAngle(axis, (turns * Math.PI) / 4 + nudge)
          const [r, u, o] = basisOf(q)
          if (new Set([dominant(r), dominant(u), dominant(o)]).size < 3) degenerate++
          expectPermutation(claimScreenAxes(r, u, o, LOCAL))
        }
      }
    }
    expect(degenerate).toBeGreaterThan(0)
  })

  it('is a permutation under a diagonal orbit, where all three vectors tie', () => {
    // Yaw and pitch both at 45 degrees puts the camera down a cube diagonal,
    // which is the worst case: no basis vector has a clear winner.
    const q = new Quaternion()
      .setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 4)
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 4))
    const [r, u, o] = basisOf(q)
    expectPermutation(claimScreenAxes(r, u, o, LOCAL))
  })

  it('is a permutation for a thousand random orbits', () => {
    const next = rng(0x5eed)
    for (let i = 0; i < 1000; i++) {
      // Uniform over the rotation group, so no region of the orbit is skipped.
      const [u1, u2, u3] = [next(), next(), next()]
      const q = new Quaternion(
        Math.sqrt(1 - u1) * Math.sin(2 * Math.PI * u2),
        Math.sqrt(1 - u1) * Math.cos(2 * Math.PI * u2),
        Math.sqrt(u1) * Math.sin(2 * Math.PI * u3),
        Math.sqrt(u1) * Math.cos(2 * Math.PI * u3),
      )
      const [r, u, o] = basisOf(q)
      expectPermutation(claimScreenAxes(r, u, o, LOCAL))
    }
  })

  it('is a permutation in every one of the 24 axis-aligned views', () => {
    const dirs = ['left', 'up', 'right', 'down'] as const
    let q = topDownQuaternion()
    for (let i = 0; i < 24; i++) {
      q = rotateView(q, dirs[i % 4])
      const [r, u, o] = basisOf(q)
      expectPermutation(claimScreenAxes(r, u, o, viewAxes(q)))
    }
  })

  it('is a permutation even for inputs that are not a basis at all', () => {
    // Nothing downstream re-checks this, so it must hold by construction rather
    // than because the camera happens to hand over something well formed.
    const same = new Vector3(1, 1, 1).normalize()
    expectPermutation(claimScreenAxes(same, same.clone(), same.clone(), LOCAL))
    const zero = new Vector3()
    expectPermutation(claimScreenAxes(zero, zero.clone(), zero.clone(), LOCAL))
  })
})

describe('origin re-anchor', () => {
  // A commit re-anchors render space to the avatar's new aligned cell, so every
  // coordinate in the scene changes at once. That is a change of frame, not
  // motion, and the camera absorbs it by adding originShift to both its position
  // and its orbit target in the same frame. If the two do not cancel exactly,
  // the world lurches by the difference and back.
  //
  // Coordinates are deep in the 85-bit axis, which is the whole point of the
  // bigint path, but the CELL separations stay well inside the fixed-point
  // headroom of cellDelta. That is not a convenience: a real move's coordinate
  // delta is small even when its cost is ruinous, because a sidestep across a
  // height-60 wall still lands one gibson past it.
  const VIEWS: ViewAxes[] = (() => {
    const dirs = ['left', 'up', 'right', 'down'] as const
    const out: ViewAxes[] = []
    let q = topDownQuaternion()
    for (let i = 0; i < 8; i++) {
      out.push(viewAxes(q))
      q = rotateView(q, dirs[i % 4])
    }
    return out
  })()

  /**
   * What a fixed world point does, relative to the camera, when the avatar moves
   * from `from` to `to`. Zero on every axis means the re-anchor was invisible.
   */
  const settle = (
    from: Position, to: Position, world: Position, scaleExp: number, axes: ViewAxes,
  ): { net: number[]; shift: number[] } => {
    const before = alignedOrigin(from, scaleExp)
    const after = alignedOrigin(to, scaleExp)
    const wasAt = cellCentre(world, before, scaleExp, axes)
    const nowAt = cellCentre(world, after, scaleExp, axes)
    const shift = originShift(before, after, scaleExp, axes)
    // Adding zero folds -0 onto 0. A flipped axis multiplies a zero delta by -1
    // and toEqual separates the two, which says nothing about the frame.
    return { net: [0, 1, 2].map((s) => nowAt[s] - wasAt[s] - shift[s] + 0), shift }
  }

  const AVATAR: Position = { x: (1n << 70n) + 12345n, y: (1n << 45n) + 777n, z: 9_000_000n }

  /** A handful of fixed world points: the mover, its neighbours, and far off. */
  const witnesses = (p: Position): Position[] => [
    p,
    { ...p, x: p.x + 1n },
    { x: p.x + 3n, y: p.y - 5n, z: p.z + 11n },
    { x: p.x + 4096n, y: p.y + 65536n, z: p.z - 1024n },
    { x: p.x - 1_000_000n, y: p.y + 1_000_000n, z: p.z + 500_000n },
  ]

  it('leaves a fixed point exactly where it was, across scales and moves', () => {
    let moved = 0
    for (const scaleExp of [0, 1, 7, 20, 40, 84]) {
      for (const d of [1n, 2n, 7n, 1024n, 1n << 20n]) {
        const to: Position = { x: AVATAR.x + d, y: AVATAR.y - d, z: AVATAR.z + d * 3n }
        for (const axes of VIEWS) {
          for (const w of witnesses(AVATAR)) {
            const { net, shift } = settle(AVATAR, to, w, scaleExp, axes)
            if (shift.some((v) => v !== 0)) moved++
            expect(net).toEqual([0, 0, 0])
          }
        }
      }
    }
    // The frame really did change in most of those, so the zeros above are the
    // shift cancelling rather than there being nothing to cancel.
    expect(moved).toBeGreaterThan(0)
  })

  it('cancels a move that crosses a large power-of-two boundary', () => {
    // The expensive case in the protocol, and the one where the aligned origin
    // jumps furthest: every bit below the boundary flips at once.
    for (const bit of [20n, 40n, 60n, 84n]) {
      const from: Position = { x: (1n << bit) - 1n, y: (1n << bit) - 1n, z: (1n << bit) - 1n }
      const to: Position = { x: 1n << bit, y: 1n << bit, z: 1n << bit }
      for (const scaleExp of [0, 1, 8, 19]) {
        for (const axes of VIEWS) {
          const { net, shift } = settle(from, to, from, scaleExp, axes)
          expect(net).toEqual([0, 0, 0])
          expect(shift.some((v) => v !== 0)).toBe(true)
        }
      }
    }
  })

  it('does nothing when the move stays inside the avatar cell', () => {
    // Sub-cell moves leave the aligned origin alone, so the camera must not be
    // nudged: the only thing that moved is the avatar within its own cell.
    const to: Position = { x: AVATAR.x + 1n, y: AVATAR.y + 1n, z: AVATAR.z + 1n }
    for (const axes of VIEWS) {
      const shift = originShift(alignedOrigin(AVATAR, 20), alignedOrigin(to, 20), 20, axes)
      expect(shift.map((v) => v + 0)).toEqual([0, 0, 0])
    }
  })
})
