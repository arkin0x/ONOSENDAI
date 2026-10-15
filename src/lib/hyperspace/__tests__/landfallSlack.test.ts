/**
 * What would fail silently without this test: the nearest-stop search
 * (station.ts nearestExact) trusts that every landfall is filed within
 * 2^LANDFALL_SLACK_BITS G of its exact point on each axis. Random block
 * hashes almost never land near a pole, so a sample of them measures a few
 * hundred gibsons and says nothing about the worst case, which is where
 * sqrt(1 - z^2) loses half its digits: z within a few ulps of +-1. If the
 * float path ever strayed past the slack there, a stop beside a cube face
 * could be filed on the wrong side of it, the search would not look for it,
 * and GOAL or a ride would name the wrong station with nothing looking
 * broken. Here sha256 is replaced so the seed itself is chosen: the poles
 * from both sides, every float rounding boundary near them, and the
 * longitudes that put the error on each axis, all through the real exact
 * and float derivations.
 */
import { describe, expect, it, vi } from 'vitest'

let nextSeed: Uint8Array = new Uint8Array(32)

vi.mock('cyberspace-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('cyberspace-core')>()
  return { ...actual, sha256: () => nextSeed }
})

const { landfallXyz, landfallXyzApprox } = await import('../landfall')
const { LANDFALL_SLACK_BITS } = await import('../compactIndex')

const HASH = '00'.repeat(32)

function seedOf(u1: bigint, u2: bigint): Uint8Array {
  const s = new Uint8Array(32)
  for (let i = 0; i < 16; i++) {
    s[15 - i] = Number((u1 >> BigInt(8 * i)) & 0xffn)
    s[31 - i] = Number((u2 >> BigInt(8 * i)) & 0xffn)
  }
  return s
}

function axisError(u1: bigint, u2: bigint): bigint {
  nextSeed = seedOf(u1, u2)
  const exact = landfallXyz(HASH)
  const approx = landfallXyzApprox(HASH)
  const abs = (v: bigint): bigint => (v < 0n ? -v : v)
  const e = [abs(exact.x - approx.x), abs(exact.y - approx.y), abs(exact.z - approx.z)]
  return e.reduce((a, b) => (b > a ? b : a))
}

const TWO_128 = 1n << 128n
const TWO_64 = 1n << 64n

describe('landfall filing slack', () => {
  it('keeps the float path within the slack at the poles, on every axis', () => {
    // u1 at 0.5 and 0.75 puts the longitude at 0 and pi/2, so the
    // horizontal error lands whole on x, then whole on the other axis.
    const longitudes = [TWO_128 / 2n, (TWO_128 / 4n) * 3n, TWO_128 / 8n, 12345678901234567890123456789n]
    // u2's top 64 bits are what the float path reads (rounded to 53); the
    // exact path reads all 128. Near 2^64 the float rounds up to exactly 1.0
    // (z = 1, rxy = 0) while the exact z is a hair below it; near 0 the
    // subtraction 2u2 - 1 rounds instead. Sweep both edges densely, with
    // low halves of all zeros, all ones, and a mix.
    const lows = [0n, TWO_64 - 1n, 0x5555555555555555n]
    const tops: bigint[] = []
    for (let k = 0n; k < 4096n; k += 1n) tops.push(TWO_64 - 1n - k, k)
    for (let b = 12n; b < 40n; b += 1n) tops.push(TWO_64 - (1n << b), TWO_64 - (1n << b) - 1n, 1n << b, (1n << b) + 1n)
    let worst = 0n
    let cases = 0
    for (const u1 of longitudes.slice(0, 2)) {
      for (const top of tops) {
        const err = axisError(u1, (top << 64n) | lows[cases % lows.length])
        if (err > worst) worst = err
        cases++
      }
    }
    for (const u1 of longitudes) {
      for (const low of lows) {
        for (const top of [TWO_64 - 1n, TWO_64 - 1024n, TWO_64 - 2048n, 0n, 1n, 1024n]) {
          const err = axisError(u1, (top << 64n) | low)
          if (err > worst) worst = err
          cases++
        }
      }
    }
    // Analytically the worst is about 2^30 G: an error of up to 2.5 ulp in
    // 1 - z^2 is about 2^-51.7, its square root about 2^-25.8, times the
    // equatorial radius in gibsons (2^55.6). Ask for that, so a regression
    // well inside the slack still shows here first.
    expect(worst).toBeLessThan(1n << 31n)
    expect(worst).toBeLessThan(1n << BigInt(LANDFALL_SLACK_BITS))
    // And the sweep did reach the bad region: the error there is millions
    // of times the few hundred gibsons a random hash shows.
    expect(worst).toBeGreaterThan(1n << 28n)
    expect(cases).toBeGreaterThan(16_000)
  }, 120_000)
})
