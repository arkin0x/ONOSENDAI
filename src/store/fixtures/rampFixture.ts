/**
 * rampFixture.ts - a ramp authored for the walk tests (store/__tests__/walkFluid.test.ts):
 * a ground sheet at unit 0 with a flat foot, a slope and a flat top, along +X.
 *
 * | Part | Model x | Height (y) |
 * |---|---|---|
 * | foot | -32 to -8 | a hair under 0 (-0.05) |
 * | slope | -8 to 24 | rising to 10, with a small wobble so most heights fall between whole units |
 * | top | 24 to 48 | 10 |
 *
 * It runs from z -16 to 16, two triangles to each 2 by 4 cell. One sheet
 * only: a single-plane floor holds a walker as the top of a solid does.
 */
import { newShard, type ShardModel } from 'sno-core/shards'

/** Ticks to a unit (sno-core): a vertex is a whole unit `p` plus `t` ticks. */
const TICKS = 120

/** The ground's height at model x. */
export function rampHeight(x: number): number {
  if (x <= -8) return -0.05
  if (x >= 24) return 10
  const along = (x + 8) / 32
  return Math.max(-0.05, along * 10 + 0.35 * Math.sin(x * 0.9) * Math.sin(along * Math.PI))
}

export function rampFixture(): ShardModel {
  const vertices: ShardModel['vertices'] = []
  const faces: Array<[number, number, number]> = []
  const xs: number[] = []
  for (let x = -32; x <= 48; x += 2) xs.push(x)
  const zs = [-16, -12, -8, -4, 0, 4, 8, 12, 16]
  const at = (i: number, k: number): number => i * zs.length + k
  for (const x of xs) {
    for (const z of zs) {
      const t = [x, rampHeight(x), z].map((v) => Math.round(v * TICKS))
      const p = t.map((v) => Math.floor(v / TICKS)) as [number, number, number]
      const r = t.map((v, n) => v - p[n] * TICKS) as [number, number, number]
      const shade = 0.3 + 0.05 * ((x / 2 + z / 4) & 1)
      vertices.push(r.some((v) => v !== 0) ? { p, t: r, c: [0.2, shade, 0.25] } : { p, c: [0.2, shade, 0.25] })
    }
  }
  for (let i = 0; i + 1 < xs.length; i++) {
    for (let k = 0; k + 1 < zs.length; k++) {
      faces.push([at(i, k), at(i + 1, k), at(i + 1, k + 1)], [at(i, k), at(i + 1, k + 1), at(i, k + 1)])
    }
  }
  return { ...newShard('Ramp fixture'), mode: 'solid', vertices, faces }
}
