// TERRAIN generator, revision 2: measure what the tables make, against the owner's targets (2026-11-24).
// 1. MAXK_AT_LEAST: the share of chunks whose costliest cube reaches each K, over N_K random chunks (K only, cheap).
// 2. Every block's rates over N_GEN random chunks with the full generator: share of solid cells per family,
//    chance a chunk has any, amount when present. The rare band is measured analytically (eligible share x chance)
//    and checked by a run with its chances raised.
// Usage: [SEED=n] [RAISE=1] node scripts/terrain-calibrate.mjs [N_K] [N_GEN]
import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

const N_K = Number(process.argv[2] ?? 200000), N_GEN = Number(process.argv[3] ?? 3000)
const dir = mkdtempSync(join(process.env.TERRAIN_TMP ?? tmpdir(), 'terrain-cal-'))
const out = join(dir, 'gen.mjs')
await build({ entryPoints: ['src/lib/terrain/generate.ts'], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' })
const G = await import(pathToFileURL(out).href)
let a = Number(process.env.SEED ?? 12345) >>> 0
const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const axis = () => { let v = 0n; for (let i = 0; i < 3; i++) v = (v << 32n) | BigInt((rnd() * 4294967296) >>> 0); v &= (1n << 85n) - 1n; return (v >> 5n) << 5n }
const chunk = (i) => ({ x: axis(), y: axis(), z: axis(), plane: i & 1 })

const hist = new Array(17).fill(0)
for (let i = 0; i < N_K; i++) hist[G.chunkMaxK(chunk(i))]++
const atLeast = hist.map((_, k) => hist.slice(k).reduce((x, y) => x + y, 0) / N_K)
console.log('MAXK_AT_LEAST', JSON.stringify(atLeast.map((v) => +v.toFixed(6))))

const name = { 1: 'Gridstone', 2: 'Umberslate', 3: 'Driftsilt', 4: 'Mossveil', 5: 'Rustband', 6: 'Frostshale', 7: 'Cinderrock', 8: 'Prismite', 9: 'Basaltine', 10: 'Rimeglass', 11: 'Tidewater', 12: 'Magmaflow', 13: 'Lumenwood', 14: 'Canopy glass', 40: 'Ferrovein', 41: 'Cobaltine', 42: 'Glowcore', 43: 'Gibsonite', 192: 'Relic shard', 193: 'Voidpearl', 194: 'Auroric', 195: 'Chronite', 196: 'Singularity core', 197: 'Genesis shard' }
const fam = {}
const conds = {}
const has = {}, amount = {}
let chunks = 0
const odds = process.env.RAISE ? { features: G.FEATURES, rare: G.RARE.map(([id, k]) => [id, k, 2 ** 32]) } : undefined
const t0 = Date.now()
for (let i = 0; i < N_GEN; i++) {
  const b = chunk(i)
  const g = G.generate(b, odds)
  if (i < 200 && g.maxK !== G.chunkMaxK(b)) throw new Error(`chunkMaxK ${G.chunkMaxK(b)} differs from the generator's ${g.maxK}`)
  chunks++
  const c = {}
  let solid = 0
  for (const id of g.blocks) if (id) { c[id] = (c[id] ?? 0) + 1; solid++ }
  const f = fam[g.family] ??= { n: 0, share: {} }
  f.n++
  const any = (id) => (c[id] ?? 0) > 0
  const cond = (name, eligible, hit) => { const r = conds[name] ??= { n: 0, hit: 0, amt: [] }; if (eligible) { r.n++; if (hit) r.hit++ } }
  const tk = g.family === 'temperate' || g.family === 'karst'
  cond('Lumenwood trees: temperate or karst with a tree site', tk && g.treeSites > 0, any(13))
  cond('Magmaflow: volcanic, K 11+', g.family === 'volcanic' && g.maxK >= 11, any(12))
  cond('Tidewater: every chunk', true, any(11))
  cond('Tidewater: mean K under 7', g.meanK < 7, any(11))
  cond('Tidewater: mean K 9 and up', g.meanK >= 9, any(11))
  cond('Ferrovein: every chunk', true, any(40))
  cond('Cobaltine: K 6+', g.maxK >= 6, any(41))
  cond('Prismite veins: K 9+, outside crystal ground', g.maxK >= 9 && g.family !== 'crystal', any(8))
  cond('Glowcore: K 10+', g.maxK >= 10, any(42))
  cond('Mossveil: temperate or karst', tk, any(4))
  if (process.env.RAISE) for (const [id, k] of G.RARE) cond(`${name[id]} placed when eligible (K ${k}+, chance raised to 1)`, g.maxK >= k, any(id))
  for (const [id, n] of Object.entries(c)) {
    f.share[id] = (f.share[id] ?? 0) + n / solid
    has[id] = (has[id] ?? 0) + 1
    ;(amount[id] ??= []).push(n)
  }
}
console.log('ms per chunk', ((Date.now() - t0) / N_GEN).toFixed(1))
console.log('family chunks', JSON.stringify(Object.fromEntries(Object.entries(fam).map(([k, v]) => [k, v.n]))))
for (const [k, v] of Object.entries(fam)) console.log(k, Object.entries(v.share).sort((x, y) => y[1] - x[1]).map(([id, s]) => `${name[id] ?? id} ${(100 * s / v.n).toFixed(1)}%`).join(', '))
const med = (xs) => { const s = [...xs].sort((p, q) => p - q); return s[s.length >> 1] }
for (const id of Object.keys(name)) {
  const n = has[id] ?? 0
  console.log(`${name[id]}: in ${(100 * n / chunks).toFixed(2)}% of chunks, median ${n ? med(amount[id]) : 0} blocks when present`)
}
for (const [k, v] of Object.entries(conds)) console.log(`${k}: ${v.hit} of ${v.n} = ${(100 * v.hit / Math.max(1, v.n)).toFixed(1)}%`)
// Per surveyed chunk: this sample's share of eligible chunks times the generator's chance given eligibility (placement never fails when eligible: RAISE=1 checks it).
console.log('RARE per chunk:', G.RARE_ODDS.map(([id, k, p]) => `${name[id]} 1 in ${Math.round(4294967296 / (atLeast[k] * p))} (target 1 in ${Math.round(1 / G.RARE_TARGET[id])}, eligible ${(100 * atLeast[k]).toFixed(2)}% of chunks)`).join('; '))
