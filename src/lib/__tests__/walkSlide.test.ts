/**
 * walkSlide.test.ts - WALK's 8-direction heading and its wall slide and
 * diagonal (lib/walkSlide.ts), on a grid of blocked cells, away from the
 * walls and the store (RULED 2026-11-03):
 *
 * - facing snaps to 8 directions, a diagonal within 22.5 degrees of 45;
 * - a diagonal is one step changing two axes, only when both side cells are
 *   open, otherwise a slide along the open side;
 * - a blocked press slides only toward the side it is angled to, and
 *   straight on into a flat wall does nothing;
 * - nothing ever moves backward; BACKWARD mirrors all of it.
 */
import { describe, expect, it } from 'vitest'
import { DIAGONAL_HALF_DEG, SLIDE_MIN_DEG, planWalkMove, walkHeading, type Stepper, type Vec3, type WalkHeading } from '../walkSlide'
import type { AxisName, Position } from '../space'

/**
 * Facing `deg` degrees right of cyberspace -Z, level: the camera looks along
 * `forward` with `right` to its right (at 0, -Z and +X; at 90, +X and +Z).
 */
function facing(deg: number): { forward: Vec3; right: Vec3 } {
  const t = (deg * Math.PI) / 180
  return { forward: { x: Math.sin(t), y: 0, z: -Math.cos(t) }, right: { x: Math.cos(t), y: 0, z: Math.sin(t) } }
}
const head = (deg: number, fwd: 1 | -1 = 1, strafe: -1 | 0 | 1 = 0): WalkHeading | null => {
  const f = facing(deg)
  return walkHeading(f.forward, f.right, 'y', fwd, strafe)
}
const d = (axis: AxisName, dir: 1 | -1) => ({ axis, dir })

describe('the heading snaps to 8 directions', () => {
  it('straight within 22.5 degrees of an axis, diagonal within 22.5 of 45', () => {
    expect(head(0)).toEqual({ main: d('z', -1), side: null, lean: null })
    expect(head(22.4)).toEqual({ main: d('z', -1), side: null, lean: d('x', 1) })
    expect(head(22.5)).toEqual({ main: d('z', -1), side: d('x', 1), lean: null })
    expect(head(45)?.side).not.toBeNull()
    expect(head(67.5)).toEqual({ main: d('x', 1), side: d('z', -1), lean: null })
    expect(head(67.6)).toEqual({ main: d('x', 1), side: null, lean: d('z', -1) })
    expect(head(90)).toEqual({ main: d('x', 1), side: null, lean: null })
    expect(head(-30)).toEqual({ main: d('z', -1), side: d('x', -1), lean: null })
    expect(head(180 + 30)).toEqual({ main: d('z', 1), side: d('x', -1), lean: null })
    expect(DIAGONAL_HALF_DEG).toBe(22.5)
  })

  it('all the way round: diagonal exactly where the angle off an axis is 22.5 to 67.5', () => {
    for (let deg = -180; deg < 180; deg += 0.25) {
      const h = head(deg + 0.01)!
      const off = (((deg + 0.01) % 90) + 90) % 90
      expect(h.side !== null, `at ${deg + 0.01}`).toBe(off >= 22.5 && off <= 67.5)
      // A diagonal's two axes are the two the heading leans along, never one against it.
      const f = facing(deg + 0.01).forward
      for (const a of [h.main, h.side ?? h.lean].filter(Boolean)) expect(f[a!.axis] * a!.dir).toBeGreaterThanOrEqual(0)
    }
  })

  it('leans to the side it is angled toward, from 5 degrees; straight on it does not lean', () => {
    expect(head(SLIDE_MIN_DEG - 0.1)?.lean).toBeNull()
    expect(head(-(SLIDE_MIN_DEG - 0.1))?.lean).toBeNull()
    expect(head(SLIDE_MIN_DEG)?.lean).toEqual(d('x', 1))
    expect(head(-SLIDE_MIN_DEG)?.lean).toEqual(d('x', -1))
    expect(head(10)?.lean).toEqual(d('x', 1))
    expect(head(-10)?.lean).toEqual(d('x', -1))
  })

  it('BACKWARD mirrors it: the same snap, every axis the other way', () => {
    const flip = (a: { axis: AxisName; dir: 1 | -1 } | null) => (a ? { axis: a.axis, dir: -a.dir } : null)
    for (let deg = -180; deg < 180; deg += 7.3) {
      const f = head(deg)!
      expect(head(deg, -1)).toEqual({ main: flip(f.main), side: flip(f.side), lean: flip(f.lean) })
    }
  })

  it('a side key held with W or S turns it 45 degrees that way', () => {
    // Facing straight: W with D is the diagonal forward and right, W with A forward and left.
    expect(head(0, 1, 1)).toEqual({ main: d('z', -1), side: d('x', 1), lean: null })
    expect(head(0, 1, -1)).toEqual({ main: d('z', -1), side: d('x', -1), lean: null })
    // S with D: back and right.
    expect(head(0, -1, 1)).toEqual({ main: d('z', 1), side: d('x', 1), lean: null })
    // Facing 30 right, W with D is 75 right: straight along +X, leaning back to -Z.
    expect(head(30, 1, 1)).toEqual({ main: d('x', 1), side: null, lean: d('z', -1) })
  })

  it('in the plane across the walk\'s up, whatever it is, and none when looking along it', () => {
    // Up is Z (no gravity, the screen's up on Z): the plane is X and Y.
    expect(walkHeading({ x: 0.7, y: 0.7, z: 0.2 }, { x: 0.7, y: -0.7, z: 0 }, 'z', 1)).toMatchObject({ main: { axis: 'x', dir: 1 }, side: { axis: 'y', dir: 1 } })
    // Looking straight along up: nothing to go by.
    expect(walkHeading({ x: 0, y: -1, z: 0 }, { x: 1, y: 0, z: 0 }, 'y', 1)).toBeNull()
    // Looking down steeply is still a heading: only the level part counts.
    expect(walkHeading({ x: 0.01, y: -0.99, z: -0.1 }, { x: 1, y: 0, z: 0.1 }, 'y', 1)?.main).toEqual(d('z', -1))
  })
})

/** A grid of blocked cells on x and z (y is never blocked): `#` is a wall, `.` open, rows north (-z) first; `@` is the walker. */
function grid(rows: string[]): { from: Position; step: Stepper<string> } {
  const walls = new Set<string>()
  let from: Position = { x: 0n, y: 0n, z: 0n }
  rows.forEach((row, r) => [...row].forEach((ch, c) => {
    if (ch === '#') walls.add(`${c},${r}`)
    if (ch === '@') from = { x: BigInt(c), y: 0n, z: BigInt(r) }
  }))
  const step: Stepper<string> = (at, axis, dir, length) => {
    let p = { ...at }
    for (let n = 0n; n < length; n++) {
      const q = { ...p, [axis]: p[axis] + BigInt(dir) }
      if (walls.has(`${q.x},${q.z}`)) return { to: p, by: 'wall' }
      p = q
    }
    return { to: p, by: null }
  }
  return { from, step }
}
const rel = (from: Position, to: Position): [number, number] => [Number(to.x - from.x), Number(to.z - from.z)]

describe('a press among walls', () => {
  it('goes straight when the way ahead is open, at any angle in the straight sector', () => {
    const { from, step } = grid(['...', '...', '.@.'])
    for (const deg of [0, 10, -10]) expect(planWalkMove(from, head(deg)!, 1n, step)).toMatchObject({ kind: 'straight', along: d('z', -1) })
    expect(rel(from, planWalkMove(from, head(10)!, 1n, step).to)).toEqual([0, -1])
  })

  it('blocked ahead, slides right when angled right and left when angled left', () => {
    const { from, step } = grid(['###', '.@.'])
    const right = planWalkMove(from, head(10)!, 1n, step)
    expect(right).toMatchObject({ kind: 'slide', along: d('x', 1) })
    expect(rel(from, right.to)).toEqual([1, 0])
    const left = planWalkMove(from, head(-10)!, 1n, step)
    expect(left).toMatchObject({ kind: 'slide', along: d('x', -1) })
    expect(rel(from, left.to)).toEqual([-1, 0])
  })

  it('straight on into a flat wall does nothing, and names the wall', () => {
    const { from, step } = grid(['###', '.@.'])
    expect(planWalkMove(from, head(0)!, 1n, step)).toEqual({ to: from, by: 'wall', kind: 'held', along: null, side: null })
    expect(planWalkMove(from, head(SLIDE_MIN_DEG - 1)!, 1n, step).kind).toBe('held')
  })

  it('slides only to the side it is angled toward: that side shut, nothing', () => {
    const { from, step } = grid(['###', '.@#'])
    expect(planWalkMove(from, head(10)!, 1n, step).kind).toBe('held')
    expect(rel(from, planWalkMove(from, head(-10)!, 1n, step).to)).toEqual([-1, 0])
  })

  it('at a corridor corner, pushing on round it nudges you into the open side', () => {
    // The corridor runs north and turns east at its end.
    const { from, step } = grid(['####', '#...', '#@##'])
    const s = planWalkMove(from, head(10)!, 1n, step)
    expect(rel(from, s.to)).toEqual([0, -1])
    const at = { ...from, z: from.z - 1n }
    expect(rel(at, planWalkMove(at, head(10)!, 1n, step).to)).toEqual([1, 0])
    // Angled the other way (into the corner's wall): nothing.
    expect(planWalkMove(at, head(-10)!, 1n, step).kind).toBe('held')
  })

  it('a diagonal with both side cells open is one step on two axes', () => {
    const { from, step } = grid(['...', '...', '.@.'])
    const m = planWalkMove(from, head(45)!, 1n, step)
    expect(m).toMatchObject({ kind: 'diagonal', by: null })
    expect(rel(from, m.to)).toEqual([1, -1])
    expect([m.along, m.side]).toEqual(expect.arrayContaining([d('x', 1), d('z', -1)]))
    // A step of 4 (zoom 2^2): 4 on each axis.
    const big = grid(['......', '......', '......', '......', '@.....'])
    expect(rel(big.from, planWalkMove(big.from, head(40)!, 4n, big.step).to)).toEqual([4, -4])
  })

  it('never cuts a corner: a side cell shut, it slides along the open side instead', () => {
    // North shut: east.
    let g = grid(['.#.', '.@.'])
    let m = planWalkMove(g.from, head(45)!, 1n, g.step)
    expect(m).toMatchObject({ kind: 'slide', along: d('x', 1) })
    expect(rel(g.from, m.to)).toEqual([1, 0])
    // East shut: north.
    g = grid(['...', '.@#'])
    m = planWalkMove(g.from, head(45)!, 1n, g.step)
    expect(m).toMatchObject({ kind: 'slide', along: d('z', -1) })
    expect(rel(g.from, m.to)).toEqual([0, -1])
    // Both shut: nothing, though the diagonal cell is open.
    g = grid(['.#.', '.@#'])
    expect(planWalkMove(g.from, head(45)!, 1n, g.step)).toMatchObject({ kind: 'held', to: g.from, by: 'wall' })
  })

  it('both sides open but the diagonal cell shut: along the side nearer the facing', () => {
    const g = grid(['..#', '.@.'])
    expect(planWalkMove(g.from, head(30)!, 1n, g.step)).toMatchObject({ kind: 'slide', along: d('z', -1) })
    expect(planWalkMove(g.from, head(60)!, 1n, g.step)).toMatchObject({ kind: 'slide', along: d('x', 1) })
  })

  it('BACKWARD mirrors it', () => {
    // Facing 10 right of north, backward is 10 left of south: a wall to the south slides west.
    const { from, step } = grid(['.@.', '###'])
    const m = planWalkMove(from, head(10, -1)!, 1n, step)
    expect(m).toMatchObject({ kind: 'slide', along: d('x', -1) })
    // A backward diagonal: south and west.
    const g = grid(['.@.', '...'])
    expect(rel(g.from, planWalkMove(g.from, head(45, -1)!, 1n, g.step).to)).toEqual([-1, 1])
  })

  it('never moves backward, among random walls at any angle', () => {
    let seed = 7
    const rand = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
    for (let k = 0; k < 2000; k++) {
      const rows: string[][] = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => (rand() < 0.35 ? '#' : '.')))
      rows[2][2] = '@'
      const { from, step } = grid(rows.map((r) => r.join('')))
      const deg = rand() * 360 - 180
      const fwd = rand() < 0.5 ? 1 : -1
      const h = head(deg, fwd)!
      const m = planWalkMove(from, h, 1n, step)
      const f = facing(deg).forward
      const [dx, dz] = rel(from, m.to)
      // Never against the heading on either axis, and never more than one cell on each.
      expect(dx * f.x * fwd).toBeGreaterThanOrEqual(-1e-9)
      expect(dz * f.z * fwd).toBeGreaterThanOrEqual(-1e-9)
      expect(Math.abs(dx) + Math.abs(dz)).toBeLessThanOrEqual(2)
      // Never into a wall, and a diagonal only with both sides open.
      expect(rows[2 + dz][2 + dx]).not.toBe('#')
      if (m.kind === 'diagonal') {
        expect(rows[2][2 + dx]).toBe('.')
        expect(rows[2 + dz][2]).toBe('.')
      }
    }
  })
})
