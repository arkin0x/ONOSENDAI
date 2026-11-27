/**
 * shatter.ts - what the smash draws, worked out once at the moment of impact
 * (block-uses §4.3): each smashed block broken into triangles, and every
 * triangle's whole flight written into a few arrays, so the scene's shader
 * can fly, spin, heat and fade all of them from one time uniform
 * (scene/SmashFx.tsx). Nothing here moves a frame; it only decides.
 *
 * The share. Each block gets up to TRIS_PER_BLOCK triangles, fewer when the
 * smash would pass the device's cap (SHATTER_CAPS): the cap is shared out
 * evenly, a block or two getting one more than the rest so the total comes
 * to the cap exactly. A build of more blocks than the cap gives one triangle
 * to an even spread of them. Fewer triangles a block means larger ones, so a
 * big build on a phone still breaks into a full cloud. Reduced motion draws a
 * third of them.
 *
 * Seeded, so the same smash breaks the same way on every replay (and in the
 * tests). Colours are linear, as the scene's shaders read them.
 */

import { blockKind } from '../terrain/blocks'

/** The most triangles one block breaks into. */
export const TRIS_PER_BLOCK = 48

/** The most triangles one smash draws, by device. */
export const SHATTER_CAPS = { phone: 1_500, laptop: 4_000, desktop: 8_000 } as const

/** How long the impact's white flash lasts. */
export const FLASH_MS = 170
/** How long the shockwave rings take to spread and fade. */
export const RING_MS = 560
/** From impact to the last triangle gone. */
export const SHATTER_MS = 1_400
/** The same, with reduced motion: the shatter fades out sooner. */
export const CALM_SHATTER_MS = 900
/** When the triangles' mesh is freed, after impact. */
export const FREE_MS = 1_600
/** The earliest the ending (dust or burst) starts, after impact: as the shatter thins out. */
export const ENDING_FROM_MS = 1_200
/** How long the grey dust of a miss takes to settle and fade. */
export const DUST_MS = 1_200
/** The smoke is born at the impact, inside the smashed blocks, and is fully there this soon (under the flash). */
export const SMOKE_RISE_MS = 140
/** How long the smoke takes to puff out of the blocks and sink: from the impact to the end of a miss's settling. */
export const SMOKE_MS = ENDING_FROM_MS + DUST_MS
/** How fast the smoke clears when the smash made something. */
export const SMOKE_CLEAR_MS = 350
/** How long a match's burst lasts. */
export const BURST_MS = 480
/** How long the ember takes to fade in and out. */
export const EMBER_FADE_MS = 250

/** The cap for this device: a phone's, or by its cores a laptop's or a desktop's. */
export function shatterCap(profile: 'phone' | 'desktop', cores: number): number {
  if (profile === 'phone') return SHATTER_CAPS.phone
  return cores >= 8 ? SHATTER_CAPS.desktop : SHATTER_CAPS.laptop
}

/** How many triangles each of `blocks` blocks breaks into, under `cap` (a third with reduced motion). */
export function shareOut(blocks: number, cap: number, calm = false): number[] {
  if (blocks <= 0) return []
  let total = Math.min(TRIS_PER_BLOCK * blocks, Math.max(0, Math.floor(cap)))
  if (calm) total = Math.floor(total / 3)
  const base = Math.floor(total / blocks)
  const rest = total - base * blocks
  // The rest one each, spread evenly through the blocks rather than piled at the front.
  return Array.from({ length: blocks }, (_, i) => base + (Math.floor(((i + 1) * rest) / blocks) - Math.floor((i * rest) / blocks)))
}

/**
 * Every triangle of one smash, four floats each in four arrays (instanced
 * attributes, scene/SmashFx.tsx):
 *   start  - where it starts (field cells) and its delay (seconds);
 *   motion - the direction it flies (unit) and its speed (cells a second);
 *   spin   - the axis it turns on (unit) and its rate (radians a second, signed);
 *   look   - its block's colour (linear) and its size (cells across).
 */
export interface Shatter {
  count: number
  start: Float32Array
  motion: Float32Array
  spin: Float32Array
  look: Float32Array
  /** How far the build reaches from its centre, in cells: the rings and the flash are sized by it. */
  radius: number
}

export interface ShatterBlock { at: readonly [number, number, number]; id: number }

/** A small seeded random source (mulberry32): the same seed, the same smash. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A hex colour (#rrggbb) as linear floats, as three's colour management reads it. */
export function linearRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16)
  const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return [lin(((n >> 16) & 255) / 255), lin(((n >> 8) & 255) / 255), lin((n & 255) / 255)]
}

/** A random direction, written into `out`. */
function unit(rand: () => number, out: number[]): number[] {
  const z = rand() * 2 - 1
  const a = rand() * Math.PI * 2
  const r = Math.sqrt(1 - z * z)
  out[0] = r * Math.cos(a); out[1] = r * Math.sin(a); out[2] = z
  return out
}

/** How far a set of blocks reaches from `centre`: to the far corner of the farthest one. */
export function buildRadius(blocks: ReadonlyArray<ShatterBlock>, centre: readonly [number, number, number]): number {
  let far = 0
  for (const b of blocks) far = Math.max(far, Math.hypot(b.at[0] + 0.5 - centre[0], b.at[1] + 0.5 - centre[1], b.at[2] + 0.5 - centre[2]))
  return far + Math.sqrt(3) / 2
}

/**
 * The triangles of a smash. Each starts somewhere inside its block and flies
 * out from the build's centre (the impact), scattered and lifted a little, the
 * blocks nearest the centre breaking first. With reduced motion they fly
 * slower and turn less.
 */
export function buildShatter(blocks: ReadonlyArray<ShatterBlock>, centre: readonly [number, number, number], opts: { cap: number; calm?: boolean; seed: number }): Shatter {
  const calm = !!opts.calm
  const shares = shareOut(blocks.length, opts.cap, calm)
  const count = shares.reduce((a, b) => a + b, 0)
  const start = new Float32Array(count * 4), motion = new Float32Array(count * 4), spin = new Float32Array(count * 4), look = new Float32Array(count * 4)
  const rand = seeded(opts.seed)
  const jitter = [0, 0, 0], axis = [0, 0, 0]
  let i = 0
  blocks.forEach((b, bi) => {
    const n = shares[bi]
    if (n === 0) return
    const kind = blockKind(b.id)
    const face = linearRgb(kind?.color ?? '#808080'), edge = linearRgb(kind?.edge ?? '#ffffff')
    // Fewer triangles, larger ones: about the same area of the block in flight.
    const grow = Math.min(2.5, Math.sqrt(TRIS_PER_BLOCK / n))
    for (let k = 0; k < n; k++, i++) {
      const o = i * 4
      const x = b.at[0] + 0.1 + 0.8 * rand(), y = b.at[1] + 0.1 + 0.8 * rand(), z = b.at[2] + 0.1 + 0.8 * rand()
      let dx = x - centre[0], dy = y - centre[1], dz = z - centre[2]
      const dist = Math.hypot(dx, dy, dz)
      if (dist > 1e-4) { dx /= dist; dy /= dist; dz /= dist } else { unit(rand, jitter); [dx, dy, dz] = jitter }
      // Out from the impact, scattered, and lifted a little.
      unit(rand, jitter)
      dx += jitter[0] * 0.55; dy += jitter[1] * 0.55 + 0.3; dz += jitter[2] * 0.55
      const len = Math.hypot(dx, dy, dz) || 1
      start[o] = x; start[o + 1] = y; start[o + 2] = z
      start[o + 3] = Math.min(0.2, dist * 0.018 + rand() * 0.07)
      motion[o] = dx / len; motion[o + 1] = dy / len; motion[o + 2] = dz / len
      motion[o + 3] = (3 + 5 * rand() * rand() + 2 * rand()) * (calm ? 0.45 : 1)
      unit(rand, axis)
      spin[o] = axis[0]; spin[o + 1] = axis[1]; spin[o + 2] = axis[2]
      spin[o + 3] = (5 + 13 * rand()) * (rand() < 0.5 ? -1 : 1) * (calm ? 0.35 : 1)
      // Mostly the block's face, some of its accent: veins and edges break too.
      const c = rand() < 0.75 ? face : edge
      look[o] = c[0]; look[o + 1] = c[1]; look[o + 2] = c[2]
      look[o + 3] = (0.16 + 0.26 * rand()) * grow
    }
  })
  return { count, start, motion, spin, look, radius: buildRadius(blocks, centre) }
}

/**
 * The smoke of a smash, born from the blocks themselves at the moment of
 * impact (owner, 2026-11-27: "the smoke falling effect currently triggers
 * late and it looks weird because it appears out of nowhere"): each mote
 * starts inside one of the smashed blocks, shared evenly among them, and
 * `drift` is how far it is pushed out from the build's centre and sinks
 * while it settles (three floats each).
 */
export function buildSmoke(blocks: ReadonlyArray<ShatterBlock>, centre: readonly [number, number, number], count: number, seed: number): { at: Float32Array; drift: Float32Array } {
  const rand = seeded(seed ^ 0x5f3759df)
  const at = new Float32Array(count * 3), drift = new Float32Array(count * 3)
  if (blocks.length === 0) return { at, drift }
  const u = [0, 0, 0]
  for (let i = 0; i < count; i++) {
    const b = blocks[Math.min(blocks.length - 1, Math.floor(((i + rand()) * blocks.length) / count))]
    const x = b.at[0] + rand(), y = b.at[1] + rand(), z = b.at[2] + rand()
    at[i * 3] = x; at[i * 3 + 1] = y; at[i * 3 + 2] = z
    let dx = x - centre[0], dy = y - centre[1], dz = z - centre[2]
    const dist = Math.hypot(dx, dy, dz)
    if (dist > 1e-4) { dx /= dist; dy /= dist; dz /= dist } else { unit(rand, u); [dx, dy, dz] = u }
    // Pushed out by the blow, then falling.
    const out = 0.25 + 0.75 * rand()
    drift[i * 3] = dx * out + (rand() - 0.5) * 0.4
    drift[i * 3 + 1] = dy * out * 0.4 - (0.6 + rand() * 1.1)
    drift[i * 3 + 2] = dz * out + (rand() - 0.5) * 0.4
  }
  return { at, drift }
}

/**
 * How thick the smoke is at `now`, 0 to 1: there from the impact, hanging
 * while the compile works, settling away over a miss's ending, cleared
 * quickly when the smash made something (the burst takes its place).
 */
export function smokeLevel(show: { struck: number; outcome: 'pending' | 'match' | 'miss'; resolvedAt: number | null }, now: number): number {
  const t = now - show.struck
  if (t < 0) return 0
  const rise = Math.min(1, t / SMOKE_RISE_MS)
  const from = endingFrom(show)
  if (show.outcome === 'pending' || from === null || now < from) return rise
  const e = (now - from) / (show.outcome === 'miss' ? DUST_MS : SMOKE_CLEAR_MS)
  if (e >= 1) return 0
  return rise * (show.outcome === 'miss' ? 1 - e * e : 1 - e)
}

/** When a show's ending (dust or burst) starts: once its outcome is known, never before the shatter thins out. */
export function endingFrom(show: { struck: number; resolvedAt: number | null }): number | null {
  return show.resolvedAt === null ? null : Math.max(show.resolvedAt, show.struck + ENDING_FROM_MS)
}

/** Whether a show still draws something at `now`: the frames must keep coming while it does. */
export function smashBusy(show: { struck: number; outcome: 'pending' | 'match' | 'miss'; resolvedAt: number | null } | null, now: number): boolean {
  if (!show) return false
  if (now - show.struck < FREE_MS) return true
  // The ember glows until the outcome is known, then fades.
  if (show.outcome === 'pending') return true
  const from = endingFrom(show)!
  return now < Math.max(from + (show.outcome === 'miss' ? DUST_MS : BURST_MS), show.resolvedAt! + EMBER_FADE_MS)
}
