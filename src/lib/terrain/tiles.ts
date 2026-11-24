/**
 * tiles.ts - the blocks' pictures: a 16 by 16 tile for each kind's top,
 * sides and bottom, drawn by code, ported from the 3D previews
 * (craft-design/previews/terrain-viewer.html, makeTile, 2026-11-24). Our own
 * art: no texture from any other block game. Alpha carries the glow (255 is
 * none, 0 glows fully), as the previews' atlas does.
 *
 * The atlas is 8 by 8 cells of 32 pixels, each tile in the middle of its
 * cell with its edge pixels repeated outward, so a mipmap never bleeds one
 * tile into the next. Tile `kind * 3 + face`, face 0 top (cyberspace +Y), 1
 * side, 2 bottom.
 */

import { KINDS, UNKNOWN_KIND, type BlockKind } from './blocks'

type Px = [number, number, number, number]
type Rgb = [number, number, number]

export const ATLAS = 256
export const CELL = 32
export const TILE = 16

function hex(h: string): Rgb { return [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)] }
function H(x: number, y: number, s: number): number { let h = Math.imul((x * 374761393 + y * 668265263 + s * 1442695041) | 0, 1274126177); h ^= h >>> 13; h = Math.imul(h, 1103515245); return ((h ^ (h >>> 16)) >>> 0) / 4294967296 }
const sh = (c: readonly number[], k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k]
const mix = (a: readonly number[], b: readonly number[], t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const WHITE: Rgb = [255, 255, 255]
function mulberry32(seed: number): () => number { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

/** One tile: 256 pixels, row by row, [r, g, b, glow 0..1]. */
export function makeTile(kind: BlockKind, face: number): Px[] {
  // The previews key their art by id, which is the DECK's: an unknown kind gets the plain tile.
  const art = kind === UNKNOWN_KIND ? 0 : kind.id
  const base = hex(kind.color), acc = hex(kind.edge), s = art * 7 + face * 131
  const out: Px[] = new Array(256)
  const put = (x: number, y: number, c: readonly number[], e = 0): void => { out[y * 16 + x] = [c[0], c[1], c[2], e] }
  const bevel = (k: number): void => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const p = out[y * 16 + x]; if (p[3] > 0.5) continue
      const hi = y === 0 || x === 0, lo = y === 15 || x === 15
      if (hi && !lo) { const c = sh(mix(p, WHITE, 0.1 * k), 1 + 0.12 * k); out[y * 16 + x] = [c[0], c[1], c[2], p[3]] }
      else if (lo) { const c = sh(p, 1 - 0.3 * k); out[y * 16 + x] = [c[0], c[1], c[2], p[3]] }
    }
  }
  const gridstone = (b: Rgb, a: Rgb): void => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      let c = sh(b, 0.86 + 0.18 * H(x >> 2, y >> 2, s + 5) + 0.1 * H(x, y, s)); const r = H(x, y, s + 1)
      if (r < 0.1) c = mix(b, a, 0.75); else if (r < 0.17) c = sh(b, 0.66)
      put(x, y, c)
    }
  }
  const silt = (b: Rgb, a: Rgb): void => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const blot = H(x >> 1, y >> 1, s + 3) * 0.55 + H(x >> 2, y >> 2, s + 4) * 0.45
      let c = mix(sh(b, 0.8), a, blot * 0.42)
      if (H(x, y, s + 9) < 0.05) c = sh(b, 0.58)
      put(x, y, c)
    }
  }
  const slate = (b: Rgb, a: Rgb): void => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      let c = sh(b, 0.9 + 0.16 * H(x >> 1, y, s))
      const line = face === 1 ? (y + (x >> 3)) % 4 === 1 : x % 5 === 2 && (y + x) % 3 !== 0
      if (line) c = mix(c, a, 0.38)
      put(x, y, c)
    }
  }
  const kindArt = (name: string): [Rgb, Rgb] => { const k = KINDS.find((q) => q.name === name)!; return [hex(k.color), hex(k.edge)] }
  switch (art) {
    case 1: gridstone(base, acc); bevel(1); break
    case 2: slate(base, acc); bevel(1); break
    case 3: silt(base, acc); for (let i = 0; i < 16; i++) { const p = out[15 * 16 + i]; out[15 * 16 + i] = [p[0] * 0.9, p[1] * 0.9, p[2] * 0.9, 0] } break
    case 4:
      if (face === 0) {
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { let c = sh(base, 0.66 + 0.22 * H(x >> 1, y, s) + 0.08 * H(x, y, s + 3)); const r = H(x, y, s + 1); if (r < 0.1) c = sh(acc, 0.8); else if (r > 0.92) c = sh(base, 0.45); put(x, y, c) }
        bevel(0.6)
      } else {
        const [sb, sa] = kindArt('Driftsilt'); silt(sb, sa)
        if (face === 1) for (let x = 0; x < 16; x++) {
          const L = 3 + Math.floor(H(x, 0, s + 2) * 4) + (x % 3 === 0 ? 1 : 0)
          for (let y = 0; y < L; y++) { let c = sh(base, 0.8 + 0.25 * H(x, y, s + 6)); if (y === 0 && H(x, 1, s) < 0.5) c = sh(acc, 0.9); if (y === L - 1) c = sh(base, 0.62); put(x, y, c) }
        }
      }
      break
    case 5:
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const t = face === 1 ? (x + y) % 6 : (x - y + 48) % 6
        put(x, y, t < 2 ? mix(base, acc, 0.5 + 0.12 * H(x, y, s)) : sh(base, 0.84 + 0.2 * H(x, y, s + 1)))
      }
      bevel(1); break
    case 6: {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) put(x, y, sh(base, 0.84 + 0.12 * H(x >> 1, y >> 1, s)))
      const rnd = mulberry32(s + 77)
      for (let w = 0; w < 2; w++) {
        let cx = Math.floor(rnd() * 16), cy = 0
        const dy = w === 0 ? 1 : 0
        if (w === 1) { cx = 0; cy = Math.floor(rnd() * 16) }
        for (let st = 0; st < 22; st++) {
          if (cx < 0 || cy < 0 || cx > 15 || cy > 15) break
          put(cx, cy, mix(base, acc, 0.78))
          if (cx + 1 < 16) { const q = out[cy * 16 + cx + 1]; out[cy * 16 + cx + 1] = [Math.min(255, q[0] * 1.06), Math.min(255, q[1] * 1.06), Math.min(255, q[2] * 1.06), 0] }
          const rr = rnd()
          if (dy) { cy += 1; if (rr < 0.3) cx -= 1; else if (rr > 0.7) cx += 1 } else { cx += 1; if (rr < 0.3) cy -= 1; else if (rr > 0.7) cy += 1 }
        }
      }
      bevel(1.3); break
    }
    case 7:
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        let c = sh(base, 0.75 + 0.6 * H(x >> 1, y >> 1, s)); const r = H(x, y, s + 1); let e = 0
        if (r < 0.03) { c = acc; e = 0.45 } else if (r < 0.06) { c = mix(base, acc, 0.35); e = 0.12 }
        put(x, y, c, e)
      }
      for (let i = 0; i < 16; i++) {
        const a0 = out[i], a1 = out[i * 16]
        if (a0[3] < 0.5) { const m = mix(a0, [80, 60, 110], 0.5); out[i] = [m[0], m[1], m[2], 0] }
        if (a1[3] < 0.5) { const m = mix(a1, [80, 60, 110], 0.5); out[i * 16] = [m[0], m[1], m[2], 0] }
      }
      break
    case 8:
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const f = (x >= y ? 1 : 0) + (x + y >= 15 ? 2 : 0)
        let c = sh(base, [1.0, 1.28, 0.62, 0.86][f] * (0.9 + 0.08 * H(x, y, s))); let e = 0.08
        if (x === y || x + y === 15) { c = mix(base, acc, 0.6); e = 0.22 }
        if (x === 0 || y === 0 || x === 15 || y === 15) { c = mix(acc, base, 0.55); e = 0.12 }
        put(x, y, c, e)
      }
      break
    case 40: case 41: {
      if (art === 40) { const [b, a] = kindArt('Gridstone'); gridstone(b, a) } else { const [b, a] = kindArt('Umberslate'); slate(b, a) }
      bevel(1)
      const rn = mulberry32(s + 991), n = art === 40 ? 5 : 4
      for (let i = 0; i < n; i++) {
        let nx = 1 + Math.floor(rn() * 12), ny = 1 + Math.floor(rn() * 12)
        if (art === 40) {
          const wv = 2 + Math.floor(rn() * 2), hv = 2
          for (let y = 0; y < hv; y++) for (let x = 0; x < wv; x++) put(nx + x, ny + y, sh(acc, 0.8 + 0.15 * H(x, y, s + i)), 0.08)
          put(nx, ny, mix(acc, WHITE, 0.55), 0.3); put(nx + wv - 1, ny + hv - 1, sh(acc, 0.55), 0)
        } else {
          nx = Math.min(13, Math.max(2, nx)); ny = Math.min(13, Math.max(2, ny))
          for (const d of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) put(nx + d[0], ny + d[1], sh(acc, 0.9), 0.3)
          put(nx, ny, mix(acc, WHITE, 0.6), 0.6); put(nx + 1, ny + 1, sh(acc, 0.5), 0.1)
        }
      }
      break
    }
    case 42:
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const dd = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5))
        let c = sh(base, 0.9 + 0.3 * H(x, y, s)); let e = 0
        if (dd < 1.6) { c = mix(acc, WHITE, 0.65); e = 1 } else if (dd < 3.6) { c = acc; e = 1 } else if (dd < 4.6) { c = mix(base, acc, 0.45); e = 0.5 }
        if ((x === 1 || x === 14) && (y === 1 || y === 14)) { c = acc; e = 0.7 }
        put(x, y, c, e)
      }
      bevel(0.8); break
    case 43:
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        let c = sh(base, 0.85 + 0.25 * H(x, y, s)); let e = 0
        if ((x + y) % 4 === 1 || (x - y + 48) % 4 === 1) { c = mix(base, acc, 0.6); e = 0.3 }
        if ((x + y) % 4 === 1 && (x - y + 48) % 4 === 1) { c = mix(acc, WHITE, 0.3); e = 0.7 }
        if (x === 0 || y === 0 || x === 15 || y === 15) { c = acc; e = 0.75 }
        put(x, y, c, e)
      }
      break
    case 192:
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const ddx = x - 7.5, ddy = y - 7.5, rad = Math.sqrt(ddx * ddx + ddy * ddy)
        let c = sh(base, 0.8 + 0.4 * H(x, y, s)); let e = 0
        const ray = Math.abs(ddx) < 0.6 || Math.abs(ddy) < 0.6 || Math.abs(Math.abs(ddx) - Math.abs(ddy)) < 0.7
        if (ray && rad < 7.2) { c = mix(acc, base, rad / 9); e = 1 - rad / 10 }
        if (rad < 1.8) { c = mix(acc, WHITE, 0.7); e = 1 }
        if (x === 0 || y === 0 || x === 15 || y === 15) { c = mix(base, acc, 0.45); e = 0.4 }
        put(x, y, c, e)
      }
      break
    default:
      // A block this client does not know: plain, with a hatched border, so it reads as unknown.
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const edge = x === 0 || y === 0 || x === 15 || y === 15
        put(x, y, edge || (x + y) % 5 === 0 ? acc : sh(base, 0.9 + 0.15 * H(x, y, s)))
      }
  }
  return out
}

/** Every kind's tiles, and the unknown kind's. */
export const TILE_KINDS: readonly BlockKind[] = [...KINDS, UNKNOWN_KIND]

/** The atlas, RGBA, ATLAS by ATLAS, alpha 255 minus the glow. */
export function buildAtlas(): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(ATLAS * ATLAS * 4)
  TILE_KINDS.forEach((kind) => {
    for (let face = 0; face < 3; face++) {
      const t = makeTile(kind, face), ti = kind.index * 3 + face
      const ox = (ti % 8) * CELL, oy = Math.floor(ti / 8) * CELL
      for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
        const sx = Math.min(15, Math.max(0, x - 8)), sy = Math.min(15, Math.max(0, y - 8)), p = t[sy * 16 + sx]
        const o = ((oy + y) * ATLAS + ox + x) * 4
        data[o] = Math.max(0, Math.min(255, Math.round(p[0])))
        data[o + 1] = Math.max(0, Math.min(255, Math.round(p[1])))
        data[o + 2] = Math.max(0, Math.min(255, Math.round(p[2])))
        data[o + 3] = Math.round(255 * (1 - p[3]))
      }
    }
  })
  return data
}

const urls = new Map<string, string>()

/** A kind's tile as a picture for the HUD (a data URL), drawn once; '' where there is no canvas. */
export function tileUrl(kind: BlockKind, face = 1): string {
  const key = `${kind.index}:${face}`
  const had = urls.get(key)
  if (had !== undefined) return had
  let url = ''
  try {
    const canvas = document.createElement('canvas')
    canvas.width = TILE; canvas.height = TILE
    const ctx = canvas.getContext('2d')
    if (ctx) {
      const img = ctx.createImageData(TILE, TILE)
      makeTile(kind, face).forEach((p, i) => {
        // The glow brightens the picture, as the scene draws it.
        const g = 1 + p[3] * 0.6
        img.data[i * 4] = Math.min(255, p[0] * g); img.data[i * 4 + 1] = Math.min(255, p[1] * g); img.data[i * 4 + 2] = Math.min(255, p[2] * g); img.data[i * 4 + 3] = 255
      })
      ctx.putImageData(img, 0, 0)
      url = canvas.toDataURL()
    }
  } catch { url = '' }
  urls.set(key, url)
  return url
}
