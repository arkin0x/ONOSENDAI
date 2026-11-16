/**
 * placeholderField.ts - DRONE RUN's BUILT-IN FIELD: an original battlefield
 * authored here in code, so the game ships with a world of its own. Pure and
 * deterministic: the same level and payloads on every call (a fixed seed, no
 * clock, no Math.random). The fixture generator (__tests__/droneRun.gen.test.ts)
 * signs it into fixture/droneRun.fixture.json; the app reads the fixture,
 * never this file.
 *
 * Same frame and zones as the full battlefield the owner imports (level
 * package, level/package.ts), so the simulation and the HUD behave the same
 * on either: region height 8, ground y 64, entry [128, 65, 196], the start
 * zone's front line at z 184 and the finish zone's at z 84 (100 apart), the
 * same spawn points s1..s14 and patrol loop.
 *
 * The look is PS1: flat per-face colours, and "pixel texture" where it is
 * cheap, a face split into a grid of cells, each cell its own colour from a
 * small palette (ground checker, bricks, crate planks, dais tiles).
 *
 * What stands on it (region-local gibsons; the run goes toward -Z):
 *
 * - ground: nine 64-gibson slabs over x and z 32..224, top at y 64, gentle
 *   bumps of at most a gibson away from the slab edges, sides down to y 48;
 * - perimeter: walls 24 high on all four sides, overlapping at the corners
 *   and in the middle of each side, so nobody leaves;
 * - an OPEN LANE up the middle (x about 118..138): two small crates and a low
 *   berm before the end zone;
 * - a COVERED LANE in the west: walls 11 high (above eye height when you
 *   stand on a 2-gibson body, and above the 9 that blocks sight) in a zigzag,
 *   tall blocks and crates;
 * - MID-FIELD cover between them: blocks, crates, low walls;
 * - the EAST: a ramp onto a raised strip 4 high and 60 long, ruin-like
 *   pillars, berms;
 * - the END-ZONE DAIS: a step of 1, then the top at 2 (y 66), covering the
 *   finish zone;
 * - fog posts (points, glow fog, opacity 0, constrain off) and light posts
 *   (points, glow light): cyan on the safe zone's front line, gold on the end
 *   zone's.
 *
 * Payload frame (DECK-0003): a wire vertex (x, y, z) placed at `at` lands at
 * (at.x + x, at.y + y, at.z - z), sno-core fromPayload negating z. Pieces are
 * authored here in region axes and written through that mirror; each face is
 * wound so its front (the right-hand normal in the wire's frame) looks out.
 */

import { packFaceColors, packTicks, TICKS_PER_UNIT } from 'sno-core/shards'
import { LEVEL_FORMAT, type Level, type LevelPiece, type Local } from './level'

/** One payload, in the wire's form (DECK-0003 §1), with the fields this field uses. */
export interface FieldPayload {
  v: 2
  name: string
  unit: 0
  extent: number
  mode: 'solid' | 'points'
  vertices: Array<[number, number, number]>
  ticks?: Array<[number, number, number] | number>
  colors: number[]
  faces: Array<[number, number, number]>
  facecolors?: number[]
  palette: Array<[number, number, number]>
  opacity?: number
  constrain: 'all' | 'off'
  glow?: ['light' | 'fog', number, number]
  pointsize?: number
}

/** The built-in field: its level and each piece's payload by name. */
export interface PlaceholderField {
  level: Level
  payloads: Record<string, FieldPayload>
}

type V3 = [number, number, number]
type RGB = [number, number, number]

/** The ground's top, region-local. */
export const FIELD_GROUND_Y = 64
/** The slabs' bases. */
const SLAB_BASE = -16
/** The perimeter walls' height above the ground. */
export const PERIMETER_HEIGHT = 24
/** The field's edges on x and z: walls stand just outside them. */
export const FIELD_LO = 32
export const FIELD_HI = 224

// ---------------------------------------------------------------- randomness

/** mulberry32: a small seeded generator, so the field is the same every time. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------- mesh

/** A mesh in region axes (offsets from the piece's origin), faces coloured one palette index each. */
class Mesh {
  readonly verts: V3[] = []
  readonly vcol: number[] = []
  readonly faces: Array<[number, number, number]> = []
  readonly fcol: number[] = []
  private readonly index = new Map<string, number>()

  vertex(p: V3, color: number): number {
    const k = `${p[0]},${p[1]},${p[2]}`
    const have = this.index.get(k)
    if (have !== undefined) return have
    this.verts.push([p[0], p[1], p[2]])
    this.vcol.push(color)
    this.index.set(k, this.verts.length - 1)
    return this.verts.length - 1
  }

  /** A triangle whose front looks along `out` (region axes). */
  tri(a: V3, b: V3, c: V3, color: number, out: V3): void {
    // The wire's frame is region axes with z negated: wind there.
    const w = (p: V3): V3 => [p[0], p[1], -p[2]]
    const [wa, wb, wc] = [w(a), w(b), w(c)]
    const u: V3 = [wb[0] - wa[0], wb[1] - wa[1], wb[2] - wa[2]]
    const v: V3 = [wc[0] - wa[0], wc[1] - wa[1], wc[2] - wa[2]]
    const n: V3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const o = w(out)
    const flip = n[0] * o[0] + n[1] * o[1] + n[2] * o[2] < 0
    const ia = this.vertex(a, color), ib = this.vertex(b, color), ic = this.vertex(c, color)
    if (ia === ib || ib === ic || ia === ic) return
    this.faces.push(flip ? [ia, ic, ib] : [ia, ib, ic])
    this.fcol.push(color)
  }

  /** A quad a b c d (in order round it), its front along `out`. */
  quad(a: V3, b: V3, c: V3, d: V3, color: number, out: V3): void {
    this.tri(a, b, c, color, out)
    this.tri(a, c, d, color, out)
  }

  /** A flat face from `o`, spanned by `u` and `v` and cut into nu by nv cells, each coloured by `color(i, j)`. */
  grid(o: V3, u: V3, v: V3, nu: number, nv: number, out: V3, color: (i: number, j: number) => number): void {
    const at = (i: number, j: number): V3 => [o[0] + u[0] * i / nu + v[0] * j / nv, o[1] + u[1] * i / nu + v[1] * j / nv, o[2] + u[2] * i / nu + v[2] * j / nv]
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) this.quad(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1), color(i, j), out)
  }

  /**
   * A box from lo to hi, each face cut into cells of about `cell` gibsons and
   * coloured by `color(face, i, j, nu, nv)`; no bottom unless asked.
   */
  box(lo: V3, hi: V3, cell: number, color: (face: string, i: number, j: number, nu: number, nv: number) => number, bottom = false): void {
    const [x0, y0, z0] = lo, [x1, y1, z1] = hi
    const n = (len: number): number => Math.max(1, Math.round(len / cell))
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0
    const side = (face: string, o: V3, u: V3, v: V3, nu: number, nv: number, out: V3): void => this.grid(o, u, v, nu, nv, out, (i, j) => color(face, i, j, nu, nv))
    side('top', [x0, y1, z0], [dx, 0, 0], [0, 0, dz], n(dx), n(dz), [0, 1, 0])
    if (bottom) side('bottom', [x0, y0, z0], [dx, 0, 0], [0, 0, dz], n(dx), n(dz), [0, -1, 0])
    side('-x', [x0, y0, z0], [0, 0, dz], [0, dy, 0], n(dz), n(dy), [-1, 0, 0])
    side('+x', [x1, y0, z0], [0, 0, dz], [0, dy, 0], n(dz), n(dy), [1, 0, 0])
    side('-z', [x0, y0, z0], [dx, 0, 0], [0, dy, 0], n(dx), n(dy), [0, 0, -1])
    side('+z', [x0, y0, z1], [dx, 0, 0], [0, dy, 0], n(dx), n(dy), [0, 0, 1])
  }
}

/** A coordinate as the wire writes it: its floor and the rest in ticks. */
function split(v: number): [number, number] {
  const ticks = Math.round(v * TICKS_PER_UNIT)
  const whole = Math.floor(ticks / TICKS_PER_UNIT)
  return [whole, ticks - whole * TICKS_PER_UNIT]
}

/** The wire payload of a solid mesh: z through the mirror, ticks for what is not whole, face colours packed. */
function solid(name: string, mesh: Mesh, palette: RGB[]): FieldPayload {
  const vertices: Array<[number, number, number]> = []
  const rest: Array<[number, number, number]> = []
  let reach = 1
  for (const [x, y, z] of mesh.verts) {
    const sx = split(x), sy = split(y), sz = split(-z)
    vertices.push([sx[0], sy[0], sz[0]])
    rest.push([sx[1], sy[1], sz[1]])
    reach = Math.max(reach, Math.ceil(Math.abs(x)), Math.ceil(Math.abs(y)), Math.ceil(Math.abs(z)))
  }
  const ticks = packTicks(rest)
  const wholeOnly = ticks.length === 1 && typeof ticks[0] === 'number'
  return {
    v: 2, name, unit: 0, extent: Math.min(64, reach), mode: 'solid',
    vertices, ...(wholeOnly ? {} : { ticks }),
    colors: mesh.vcol, faces: mesh.faces, facecolors: packFaceColors(mesh.fcol), palette,
    constrain: 'all',
  }
}

/** The wire payload of a cloud of points (whole gibsons), glowing. */
function points(name: string, pts: V3[], colors: number[], palette: RGB[], glow: ['light' | 'fog', number, number], extra: { opacity?: number; pointsize?: number }): FieldPayload {
  let reach = 1
  for (const p of pts) reach = Math.max(reach, ...p.map((c) => Math.abs(c)))
  return {
    v: 2, name, unit: 0, extent: Math.min(64, reach), mode: 'points',
    vertices: pts.map(([x, y, z]) => [x, y, -z + 0]), colors, faces: [], palette,
    ...(extra.opacity !== undefined ? { opacity: extra.opacity } : {}),
    constrain: 'off', glow, ...(extra.pointsize !== undefined ? { pointsize: extra.pointsize } : {}),
  }
}

// ---------------------------------------------------------------- palettes

// A PS1 field under a black sky: deep greens and earth browns on the ground,
// dark stones. A palette value is drawn as linear light (the world's faces are
// unlit vertex colours, shown through the sRGB output), so it shows much
// lighter than it reads: [11, 32, 6] shows as a deep grass green near
// [58, 100, 42]. The values here are chosen dark for that.
const GROUND: RGB[] = [[11, 32, 6], [16, 43, 8], [7, 23, 4], [35, 20, 8], [22, 12, 5], [27, 51, 9]]
const STONE: RGB[] = [[30, 29, 25], [23, 22, 19], [40, 37, 31], [16, 15, 14], [50, 45, 35]]
const BRICK: RGB[] = [[40, 13, 8], [29, 9, 6], [51, 17, 10], [19, 6, 4], [14, 12, 12]]
const WOOD: RGB[] = [[59, 25, 8], [40, 17, 5], [24, 10, 4], [80, 35, 12]]
const CONCRETE: RGB[] = [[35, 37, 37], [26, 27, 29], [46, 46, 43], [18, 19, 22]]
const BERM: RGB[] = [[15, 32, 6], [35, 20, 8], [10, 24, 5], [46, 27, 11]]
const DAIS: RGB[] = [[48, 40, 25], [34, 29, 18], [63, 51, 30], [20, 17, 12], [141, 78, 10]]
const FOG: RGB[] = [[27, 35, 45], [19, 26, 35], [38, 46, 55]]
const CYAN: RGB[] = [[190, 244, 255], [70, 214, 255]]
const GOLD: RGB[] = [[255, 196, 64], [255, 236, 170]]

// ---------------------------------------------------------------- pieces

/** A ground slab, 64 a side, top at 0 with gentle bumps (none near its edges), sides down to SLAB_BASE. */
function ground(name: string, seed: number, bumps: number): FieldPayload {
  const m = new Mesh()
  const N = 16, S = 64 / N
  const r = rng(seed)
  const hills = Array.from({ length: bumps }, () => ({ x: -20 + r() * 40, z: -20 + r() * 40, rad: 8 + r() * 8, h: 0.5 + r() * 0.5 }))
  const height = (i: number, j: number): number => {
    if (i <= 1 || j <= 1 || i >= N - 1 || j >= N - 1) return 0
    const x = -32 + i * S, z = -32 + j * S
    let h = 0
    for (const k of hills) { const d = Math.hypot(x - k.x, z - k.z); if (d < k.rad) h += k.h * (0.5 + 0.5 * Math.cos(Math.PI * d / k.rad)) }
    // Quarters of a gibson: a gentle lump, never a step.
    return Math.min(1, Math.round(h * 4) / 4)
  }
  // Patches of four by four cells (16 gibsons): mostly grass, some moss, some bare earth; inside a patch,
  // 2 by 2 checks of its two shades with a few odd cells, so every cell reads as a PS1 texel.
  const patch = Array.from({ length: (N / 4) * (N / 4) }, () => { const v = r(); return v < 0.22 ? 'earth' : v < 0.42 ? 'moss' : 'grass' })
  const cellColor = (i: number, j: number): number => {
    const v = r()
    const even = ((i >> 1) + (j >> 1)) % 2 === 0
    switch (patch[(i >> 2) * (N / 4) + (j >> 2)]) {
      case 'earth': return v < 0.15 ? 2 : even ? 3 : 4
      case 'moss': return v < 0.12 ? 3 : even ? 5 : 1
      default: return v < 0.1 ? 4 : v < 0.25 ? 5 : even ? 0 : (v < 0.6 ? 1 : 2)
    }
  }
  const at = (i: number, j: number): V3 => [-32 + i * S, height(i, j), -32 + j * S]
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) m.quad(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1), cellColor(i, j), [0, 1, 0])
  const b = SLAB_BASE
  m.quad([-32, 0, -32], [32, 0, -32], [32, b, -32], [-32, b, -32], 4, [0, 0, -1])
  m.quad([-32, 0, 32], [32, 0, 32], [32, b, 32], [-32, b, 32], 4, [0, 0, 1])
  m.quad([-32, 0, -32], [-32, 0, 32], [-32, b, 32], [-32, b, -32], 4, [-1, 0, 0])
  m.quad([32, 0, -32], [32, 0, 32], [32, b, 32], [32, b, -32], 4, [1, 0, 0])
  return solid(name, m, GROUND)
}

/** A brick colour for cell (i, j): rows offset by half a brick, a few darker. */
function brick(i: number, j: number, r: () => number): number {
  const v = r()
  if (v < 0.08) return 3
  return (i + (j % 2)) % 2 === 0 ? (v < 0.5 ? 0 : 2) : 1
}

/**
 * A perimeter wall, 100 long and 2 thick, from SLAB_BASE to PERIMETER_HEIGHT,
 * bricks on the face that looks into the field (`inward`), plain elsewhere.
 */
function perimeter(name: string, alongX: boolean, inward: V3, seed: number): FieldPayload {
  const m = new Mesh()
  const r = rng(seed)
  const L = 50, T = 1, H = PERIMETER_HEIGHT, B = SLAB_BASE
  const lo: V3 = alongX ? [-L, B, -T] : [-T, B, -L]
  const hi: V3 = alongX ? [L, H, T] : [T, H, L]
  const plain = 4
  // The plain shell: top, both ends, the outer face, the inner face below the ground.
  m.quad([lo[0], H, lo[2]], [hi[0], H, lo[2]], [hi[0], H, hi[2]], [lo[0], H, hi[2]], plain, [0, 1, 0])
  const axis = alongX ? 2 : 0
  const inner = inward[axis] > 0 ? hi[axis] : lo[axis]
  const outer = inward[axis] > 0 ? lo[axis] : hi[axis]
  const outward: V3 = [-inward[0], -inward[1], -inward[2]]
  const face = (c: number, y0: number, y1: number, color: number, out: V3): void => {
    if (alongX) m.quad([-L, y0, c], [L, y0, c], [L, y1, c], [-L, y1, c], color, out)
    else m.quad([c, y0, -L], [c, y0, L], [c, y1, L], [c, y1, -L], color, out)
  }
  face(outer, B, H, plain, outward)
  face(inner, B, 0, plain, inward)
  // Ends.
  if (alongX) {
    m.quad([-L, B, -T], [-L, B, T], [-L, H, T], [-L, H, -T], plain, [-1, 0, 0])
    m.quad([L, B, -T], [L, B, T], [L, H, T], [L, H, -T], plain, [1, 0, 0])
  } else {
    m.quad([-T, B, -L], [T, B, -L], [T, H, -L], [-T, H, -L], plain, [0, 0, -1])
    m.quad([-T, B, L], [T, B, L], [T, H, L], [-T, H, L], plain, [0, 0, 1])
  }
  // Bricks, 4 by 4, above the ground on the inner face.
  const o: V3 = alongX ? [-L, 0, inner] : [inner, 0, -L]
  const u: V3 = alongX ? [2 * L, 0, 0] : [0, 0, 2 * L]
  m.grid(o, u, [0, H, 0], 25, 6, inward, (i, j) => brick(i, j, r))
  return solid(name, m, BRICK)
}

/** A wall standing on the ground: `len` long along x (or z), `thick` through, `h` high, bricks of `cell`. */
function wall(name: string, alongX: boolean, len: number, thick: number, h: number, cell: number, seed: number): FieldPayload {
  const m = new Mesh()
  const r = rng(seed)
  const lo: V3 = alongX ? [-len / 2, 0, -thick / 2] : [-thick / 2, 0, -len / 2]
  const hi: V3 = alongX ? [len / 2, h, thick / 2] : [thick / 2, h, len / 2]
  m.box(lo, hi, cell, (face, i, j) => (face === 'top' ? 4 : brick(i, j, r)))
  return solid(name, m, BRICK)
}

/** A concrete block, `w` a side and `h` high, panels of `cell`. */
function block(name: string, w: number, h: number, cell: number, seed: number): FieldPayload {
  const m = new Mesh()
  const r = rng(seed)
  m.box([-w / 2, 0, -w / 2], [w / 2, h, w / 2], cell, (face, i, j) => (face === 'top' ? 2 : (i + j) % 2 === 0 ? (r() < 0.2 ? 3 : 0) : 1))
  return solid(name, m, CONCRETE)
}

/** A crate, `w` a side, one-gibson planks: a frame of dark wood round lighter boards. */
function crate(name: string, w: number): FieldPayload {
  const m = new Mesh()
  m.box([-w / 2, 0, -w / 2], [w / 2, w, w / 2], 1, (_face, i, j, nu, nv) => (i === 0 || j === 0 || i === nu - 1 || j === nv - 1 ? 2 : (i + j) % 2 === 0 ? 0 : 3))
  return solid(name, m, WOOD)
}

/** A berm: a low mound `len` long along x, `w` wide at its foot, `h` high, its ends tapering into the ground. */
function berm(name: string, len: number, w: number, h: number): FieldPayload {
  const m = new Mesh()
  const seg = 12
  const cross = [-w / 2, -1, 1, w / 2]
  const lift = [0, 1, 1, 0]
  const at = (k: number, c: number): V3 => {
    const x = -len / 2 + (len * k) / seg
    const taper = Math.sin(Math.PI * k / seg)
    return [x, Math.round(h * lift[c] * taper * 4) / 4, cross[c] * (0.5 + 0.5 * taper)]
  }
  for (let k = 0; k < seg; k++) {
    for (let c = 0; c < 3; c++) {
      const color = c === 1 ? ((k % 2) === 0 ? 3 : 1) : (k + c) % 2 === 0 ? 0 : 2
      m.quad(at(k, c), at(k + 1, c), at(k + 1, c + 1), at(k, c + 1), color, [0, 1, 0])
    }
  }
  return solid(name, m, BERM)
}

/** The raised strip: 10 wide, top 4 up, 60 long, a ramp 12 long at its +z end (the start's side). */
function strip(name: string, seed: number): FieldPayload {
  const m = new Mesh()
  const r = rng(seed)
  const W = 5, H = 4, Z0 = -30, Z1 = 30, R = 42
  // Top, slabs of 2.
  m.grid([-W, H, Z0], [2 * W, 0, 0], [0, 0, Z1 - Z0], 5, 30, [0, 1, 0], (i, j) => ((i + j) % 2 === 0 ? (r() < 0.15 ? 3 : 0) : 1))
  // The ramp, 6 boards up its length.
  m.grid([-W, H, Z1], [2 * W, 0, 0], [0, -H, R - Z1], 5, 6, [0, 1, 0.3], (i, j) => ((i + j) % 2 === 0 ? 2 : 1))
  // Sides of the strip and the ramp, the front drop.
  m.quad([-W, 0, Z0], [-W, 0, Z1], [-W, H, Z1], [-W, H, Z0], 3, [-1, 0, 0])
  m.quad([W, 0, Z0], [W, 0, Z1], [W, H, Z1], [W, H, Z0], 3, [1, 0, 0])
  m.tri([-W, 0, Z1], [-W, 0, R], [-W, H, Z1], 3, [-1, 0, 0])
  m.tri([W, 0, Z1], [W, 0, R], [W, H, Z1], 3, [1, 0, 0])
  m.quad([-W, 0, Z0], [W, 0, Z0], [W, H, Z0], [-W, H, Z0], 3, [0, 0, -1])
  return solid(name, m, STONE)
}

/** A ruin-like pillar: an octagon of radius 1.5 on a 4 by 4 plinth 1 high, `h` high, its top broken unevenly. */
function pillar(name: string, h: number, seed: number): FieldPayload {
  const m = new Mesh()
  const r = rng(seed)
  m.box([-2, 0, -2], [2, 1, 2], 2, (face, i, j) => (face === 'top' ? 2 : (i + j) % 2 === 0 ? 1 : 3))
  const sides = 8, rad = 1.5
  const rings = Math.max(1, Math.round((h - 1) / 3))
  const ring = (k: number): V3[] => Array.from({ length: sides }, (_, s) => {
    const a = (2 * Math.PI * s) / sides
    const top = k === rings ? h - r() * Math.min(2.5, h / 3) : 1 + ((h - 1) * k) / rings
    return [Math.round(Math.cos(a) * rad * 8) / 8, Math.round(top * 4) / 4, Math.round(Math.sin(a) * rad * 8) / 8]
  })
  const rs = Array.from({ length: rings + 1 }, (_, k) => ring(k))
  for (let k = 0; k < rings; k++) {
    for (let s = 0; s < sides; s++) {
      const t = (s + 1) % sides
      const a = (2 * Math.PI * (s + 0.5)) / sides
      m.quad(rs[k][s], rs[k][t], rs[k + 1][t], rs[k + 1][s], (s + k) % 2 === 0 ? 0 : 4, [Math.cos(a), 0, Math.sin(a)])
    }
  }
  const crown = rs[rings]
  const mid: V3 = [0, Math.min(...crown.map((p) => p[1])) - 0.25, 0]
  for (let s = 0; s < sides; s++) m.tri(mid, crown[s], crown[(s + 1) % sides], 3, [0, 1, 0])
  return solid(name, m, STONE)
}

/** The end-zone dais: a ring step 1 up (32 by 22), the top 2 up (28 by 18) in tiles of 2, a gold rim on its front edge. */
function dais(name: string): FieldPayload {
  const m = new Mesh()
  m.box([-16, 0, -11], [16, 1, 11], 4, (face, i, j) => (face === 'top' ? ((i + j) % 2 === 0 ? 1 : 3) : 3))
  m.box([-14, 1, -9], [14, 2, 9], 2, (face, i, j, nu, nv) => {
    if (face !== 'top') return face === '+z' ? 4 : 1
    if (j === nv - 1) return 4
    if (i === 0 || i === nu - 1) return 3
    return (i + j) % 2 === 0 ? 0 : 2
  })
  return solid(name, m, DAIS)
}

/** A fog post: a loose cloud of points about `rx` across and `ry` high, drawing nothing, its glow a fog. */
function fog(name: string, rx: number, ry: number, count: number, seed: number): FieldPayload {
  const r = rng(seed)
  const pts: V3[] = []
  const seen = new Set<string>()
  while (pts.length < count) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * rx
    const p: V3 = [Math.round(Math.cos(a) * d), Math.round(r() * ry), Math.round(Math.sin(a) * d)]
    const k = p.join(',')
    if (seen.has(k)) continue
    seen.add(k)
    pts.push(p)
  }
  return points(name, pts, pts.map((_, i) => i % 3), FOG, ['fog', 600, 32], { opacity: 0 })
}

/**
 * A line of light points along x, `half` each way, a gibson up, 4 apart: a
 * row of small lamps, each with a halo of 0.6 gibsons at 45% (a wide or close
 * halo here ran together into a wall of haze across the view).
 */
function lightLine(name: string, half: number, palette: RGB[]): FieldPayload {
  const pts: V3[] = []
  for (let x = -half; x <= half; x += 4) pts.push([x, 1, 0])
  return points(name, pts, pts.map((_, i) => i % 2), palette, ['light', 72, 45], { pointsize: 30 })
}

/** A light post: a column of points `h` high, 2 apart, each with a small halo (0.8 gibsons, 45%). */
function lightPost(name: string, h: number, palette: RGB[]): FieldPayload {
  const pts: V3[] = []
  for (let y = 0; y <= h; y += 2) pts.push([0, y, 0])
  return points(name, pts, pts.map((_, i) => i % 2), palette, ['light', 96, 45], { pointsize: 36 })
}

// ---------------------------------------------------------------- the level

/** The zones, the entry point, the spawn points and the patrol loop: the same as the full battlefield's. */
export const FIELD_FRAME = {
  entry: [128, 65, 196] as Local,
  zones: {
    start: { lo: [108, 62, 184] as Local, hi: [148, 80, 204] as Local },
    finish: { lo: [114, 66, 66] as Local, hi: [142, 78, 84] as Local },
  },
  spawns: [
    { id: 's1', at: [128, 92, 150] }, { id: 's2', at: [128, 104, 116] }, { id: 's3', at: [96, 96, 112] },
    { id: 's4', at: [160, 96, 120] }, { id: 's5', at: [48, 84, 150] }, { id: 's6', at: [72, 80, 92] },
    { id: 's7', at: [92, 78, 128] }, { id: 's8', at: [210, 82, 150] }, { id: 's9', at: [192, 76, 104] },
    { id: 's10', at: [176, 80, 70] }, { id: 's11', at: [128, 90, 48] }, { id: 's12', at: [100, 86, 60] },
    { id: 's13', at: [156, 86, 60] }, { id: 's14', at: [200, 88, 136] },
  ] as Array<{ id: string; at: Local }>,
  patrol: [[128, 84, 140], [96, 84, 120], [80, 82, 96], [128, 84, 96], [176, 82, 96], [192, 84, 132], [160, 84, 152], [128, 88, 116]] as Local[],
}

/** The built-in field: its level and payloads (see the header). Pure: the same every call. */
export function placeholderField(): PlaceholderField {
  const payloads: Record<string, FieldPayload> = {
    'field-ground-flat': ground('Drone run field: flat ground', 11, 0),
    'field-ground-bumps-a': ground('Drone run field: bumpy ground', 23, 4),
    'field-ground-bumps-b': ground('Drone run field: bumpy ground b', 37, 5),
    'field-edge-north': perimeter('Drone run field: north edge', true, [0, 0, 1], 41),
    'field-edge-south': perimeter('Drone run field: south edge', true, [0, 0, -1], 43),
    'field-edge-west': perimeter('Drone run field: west edge', false, [1, 0, 0], 47),
    'field-edge-east': perimeter('Drone run field: east edge', false, [-1, 0, 0], 53),
    'field-wall-tall-z': wall('Drone run field: tall wall', false, 16, 2, 11, 2, 59),
    'field-wall-tall-x': wall('Drone run field: tall wall across', true, 16, 2, 11, 2, 61),
    'field-wall-low': wall('Drone run field: low wall', true, 12, 1, 3, 1.5, 67),
    'field-block': block('Drone run field: block', 4, 4, 2, 71),
    'field-block-tall': block('Drone run field: tall block', 4, 10, 2, 73),
    'field-crate': crate('Drone run field: crate', 3),
    'field-crate-small': crate('Drone run field: small crate', 2),
    'field-berm-a': berm('Drone run field: berm', 24, 8, 2),
    'field-strip': strip('Drone run field: raised strip', 79),
    'field-pillar-a': pillar('Drone run field: pillar', 12, 83),
    'field-pillar-b': pillar('Drone run field: broken pillar', 7, 89),
    'field-pillar-stub': pillar('Drone run field: pillar stub', 2.5, 97),
    'field-dais': dais('Drone run field: end dais'),
    'field-fog-west': fog('Drone run field: west fog', 8, 4, 40, 101),
    'field-fog-mid': fog('Drone run field: mid fog', 7, 3, 30, 103),
    'field-fog-east': fog('Drone run field: east fog', 8, 4, 40, 107),
    'field-fog-end': fog('Drone run field: end fog', 9, 3, 36, 109),
    'field-light-safe-line': lightLine('Drone run field: safe zone line', 20, CYAN),
    'field-light-safe-post': lightPost('Drone run field: safe zone post', 8, CYAN),
    'field-light-end-line': lightLine('Drone run field: end zone line', 14, GOLD),
    'field-light-end-post': lightPost('Drone run field: end zone post', 8, GOLD),
  }

  const G = FIELD_GROUND_Y
  const p = (piece: string, x: number, y: number, z: number): LevelPiece => ({ piece, at: [x, y, z] })
  const groundKind = (x: number, z: number): string => (x === 128 && z !== 128 ? 'field-ground-flat' : (x + z) % 128 === 0 ? 'field-ground-bumps-a' : 'field-ground-bumps-b')
  const pieces: LevelPiece[] = []
  for (const z of [192, 128, 64]) for (const x of [64, 128, 192]) pieces.push(p(groundKind(x, z), x, G, z))
  pieces.push(
    // Perimeter: two walls a side, overlapping in the middle and at the corners.
    p('field-edge-north', 80, G, 31), p('field-edge-north', 176, G, 31),
    p('field-edge-south', 80, G, 225), p('field-edge-south', 176, G, 225),
    p('field-edge-west', 31, G, 80), p('field-edge-west', 31, G, 176),
    p('field-edge-east', 225, G, 80), p('field-edge-east', 225, G, 176),
    // The end-zone dais, under the finish zone.
    p('field-dais', 128, G, 75),
    // The open lane: two small crates, a berm before the end zone.
    p('field-crate-small', 134, G, 152), p('field-crate-small', 122, G, 110), p('field-berm-a', 128, G, 98),
    // Mid-field cover.
    p('field-block', 106, G, 154), p('field-block', 150, G, 142),
    p('field-wall-low', 110, G, 132), p('field-wall-low', 146, G, 118),
    p('field-crate', 102, G, 140), p('field-crate', 154, G, 128), p('field-crate', 112, G, 116),
    p('field-wall-low', 108, G, 92), p('field-wall-low', 148, G, 92),
    // The covered lane, west: a zigzag of tall walls, tall blocks, crates, a berm at its mouth.
    p('field-berm-a', 64, G, 186),
    p('field-wall-tall-z', 60, G, 164), p('field-wall-tall-z', 88, G, 148), p('field-wall-tall-x', 74, G, 138),
    p('field-wall-tall-z', 60, G, 124), p('field-wall-tall-z', 88, G, 108), p('field-wall-tall-x', 74, G, 96),
    p('field-block-tall', 78, G, 176), p('field-block-tall', 48, G, 108),
    p('field-crate', 70, G, 154), p('field-crate', 82, G, 124), p('field-crate-small', 66, G, 110), p('field-crate', 92, G, 86),
    // The east: the ramp and raised strip, a crate on it, ruin-like pillars, berms.
    p('field-strip', 172, G, 130), p('field-crate', 172, G + 4, 140), p('field-crate-small', 170, G + 4, 112),
    p('field-pillar-a', 200, G, 152), p('field-pillar-a', 208, G, 116),
    p('field-pillar-b', 194, G, 132), p('field-pillar-b', 212, G, 140),
    p('field-pillar-stub', 198, G, 96), p('field-pillar-stub', 190, G, 166),
    p('field-berm-a', 196, G, 180), p('field-berm-a', 186, G, 86),
    // Fog.
    p('field-fog-west', 74, G + 2, 136), p('field-fog-mid', 128, G + 2, 128), p('field-fog-east', 200, G + 2, 122), p('field-fog-end', 128, G + 2, 100),
    // Light: cyan on the safe zone's front line, gold on the end zone's.
    p('field-light-safe-line', 128, G, 184), p('field-light-safe-post', 108, G, 184), p('field-light-safe-post', 148, G, 184),
    p('field-light-end-line', 128, G + 2, 84), p('field-light-end-post', 114, G + 2, 84), p('field-light-end-post', 142, G + 2, 84),
  )

  const level: Level = {
    format: LEVEL_FORMAT,
    id: 'drone-run-built-in-field',
    name: 'Built-in field',
    groundY: G,
    entry: FIELD_FRAME.entry,
    zones: FIELD_FRAME.zones,
    spawns: FIELD_FRAME.spawns,
    patrol: FIELD_FRAME.patrol,
    routes: [
      { id: 'open', points: [[128, 65, 196], [128, 65, 160], [128, 65, 120], [128, 66, 98], [128, 67, 84]] },
      { id: 'covered', points: [[128, 65, 196], [74, 65, 190], [74, 65, 150], [74, 65, 116], [74, 65, 90], [118, 67, 80]] },
      { id: 'strip', points: [[128, 65, 196], [172, 65, 178], [172, 68, 150], [172, 68, 104], [140, 67, 80]] },
    ],
    pieces,
  }
  return { level, payloads }
}
