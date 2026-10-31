/**
 * editCost.test.ts: what a tap and a paint cost on a big shard (arkinox,
 * 2026-10-31: "perf in the workshop is awful. locking up only a minute after
 * opening it"). scripts/perf-workshop.mjs measures these in a real browser;
 * these pin the three shapes that keep them cheap, so an edit that undoes one
 * fails here rather than showing up as a slow bench.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sameNumbers } from '../../scene/ShardMesh'

const workshop = readFileSync(join(__dirname, '..', 'Workshop.tsx'), 'utf8')
const mesh = readFileSync(join(__dirname, '..', '..', 'scene', 'ShardMesh.tsx'), 'utf8')

describe('sameNumbers, which decides whether a geometry stands', () => {
  it('compares by value across list kinds', () => {
    expect(sameNumbers(new Float32Array([1, 2, 3]), new Float32Array([1, 2, 3]))).toBe(true)
    expect(sameNumbers([1, 2, 3], [1, 2, 3])).toBe(true)
    const same = new Float32Array([1, 2])
    expect(sameNumbers(same, same)).toBe(true)
  })
  it('notices a change anywhere, and a change of length', () => {
    expect(sameNumbers(new Float32Array([1, 2, 3]), new Float32Array([1, 2, 4]))).toBe(false)
    expect(sameNumbers(new Float32Array([0, 2, 3]), new Float32Array([1, 2, 3]))).toBe(false)
    expect(sameNumbers([1, 2], [1, 2, 3])).toBe(false)
  })
})

describe('a paint on the bench', () => {
  it('keeps the geometries and their GPU buffers: the colors go into the buffer that is there', () => {
    expect(mesh).toMatch(/const positions = useSame\(built\.positions\)/)
    expect(mesh).toMatch(/const index = useSame\(built\.index\)/)
    expect(mesh).toMatch(/new Float32BufferAttribute\(colors\.slice\(\), 3\), \[colors\.length\]\)/)
    expect(mesh).toMatch(/a\.set\(colors\)\s+colAttr\.needsUpdate = true/)
  })
  it('asks a canvas that draws on demand for a frame, since R3F set nothing', () => {
    expect(mesh).toMatch(/colAttr\.needsUpdate = true[\s\S]{0,160}invalidate\(\)/)
  })
  it('builds the wireframe only for a shard drawn as lines, and keeps it through a paint', () => {
    expect(mesh).toMatch(/if \(shard\.mode !== 'lines' \|\| faces\.length === 0\) return null/)
    expect(mesh).toMatch(/\[posAttr, colAttr, index, shard\.mode\]\)/)
  })
})

describe('the workshop shell, on every tap and paint', () => {
  it('writes the object out for its size and fingerprint only while SHARD shows them', () => {
    expect(workshop).toMatch(/const seen = panel === 'shard' \? shard : null/)
    expect(workshop).toMatch(/shardFingerprint\(seen\)/)
    expect(workshop).toMatch(/JSON\.stringify\(toPayload\(withAuthoredConstrain\(seen\)\)\)/)
  })
  it('prices the avatar only while AVATAR shows it', () => {
    expect(workshop).toMatch(/if \(!pricing \|\| !shard \|\| !buildable\)/)
  })
  it('keeps the shard list out of its own render: memoized, reading the shards itself', () => {
    expect(workshop).toMatch(/const ShardList = memo\(function ShardList\(\{ currentId \}: \{ currentId: string \}\)/)
    expect(workshop).toMatch(/<ShardList currentId=\{shard\.id\} \/>/)
    const shell = workshop.slice(workshop.indexOf('export function Workshop('))
    expect(shell).not.toMatch(/useWorkshop\(\(s\) => s\.shards\)/)
    expect(shell).not.toMatch(/useNewestFirst\(/)
    expect(shell).not.toMatch(/<ShardFolders /)
  })
})
