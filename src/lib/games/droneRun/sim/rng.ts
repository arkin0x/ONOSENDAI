/**
 * rng.ts - the simulation's only source of chance: mulberry32, a small
 * seeded generator whose whole state is one uint32, kept in the run's state
 * so a replay of the same inputs draws the same numbers. Never Math.random.
 */

/** A generator's state: one uint32, plain data so it hashes and copies with the run. */
export interface Rng {
  s: number
}

/** A generator seeded with `seed` (any number; its low 32 bits are used). */
export function makeRng(seed: number): Rng {
  return { s: seed >>> 0 }
}

/** The next number in [0, 1), advancing `r` (mulberry32). */
export function next(r: Rng): number {
  r.s = (r.s + 0x6d2b79f5) >>> 0
  let t = r.s
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** A number in [lo, hi). */
export function range(r: Rng, lo: number, hi: number): number {
  return lo + (hi - lo) * next(r)
}

/** Two seeds mixed into one (for the run's seed with a wave's). */
export function mixSeeds(a: number, b: number): number {
  let h = Math.imul((a >>> 0) ^ 0x9e3779b9, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13) ^ (b >>> 0), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}
