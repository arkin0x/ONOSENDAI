/**
 * shardColors.test.ts: a shard's colors reach the GPU as linear light
 * (arkinox, 2026-10-31: "the purple tri here was painted by the blue color in
 * the palette chip -- these don't even look the same"). The palette's blue
 * #1902ff drew as violet #5816ff: its 25 of red, handed to three as if it were
 * already linear, was encoded to 88 on the way to the screen.
 *
 * The whole trip is checked: what three's own encoding makes of what the
 * geometry holds must be the byte the model holds, for every palette entry.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Color } from 'three'
import { BUILT_IN, hexAt } from 'sno-core/snoPalette'
import { hexToRgb, newShard, vertexAt, type ShardModel } from 'sno-core/shards'
import { linearColors } from '../shardColors'
import { shardGeometry } from '../ShardMesh'
import { LOOK } from '../../lib/thumbKey'

/** What the screen shows for a linear channel, as three encodes a frame: back to eight bits. */
function onScreen(linear: number): number {
  return Math.round(new Color(linear, linear, linear).convertLinearToSRGB().r * 255)
}

function shardOf(hex: string): ShardModel {
  const c = hexToRgb(hex)
  const at = (x: number, z: number): ShardModel['vertices'][number] => vertexAt([x * 120, 0, z * 120], c)
  return { ...newShard('t'), mode: 'solid', vertices: [at(0, 0), at(1, 0), at(0, 1)], faces: [[0, 1, 2]] }
}

describe('linearColors', () => {
  it('undoes the encoding three applies to a frame, for every eight-bit value', () => {
    for (let b = 0; b < 256; b++) expect(onScreen(linearColors([b / 255])[0])).toBe(b)
  })

  it('takes the curve itself for a channel between two bytes, as a blended corner can be', () => {
    const n = 0.123456
    expect(linearColors([n])[0]).toBeCloseTo(((n + 0.055) / 1.055) ** 2.4, 6)
  })

  it('leaves its input alone and hands back a new array', () => {
    const input = new Float32Array([0.5, 0.25, 1])
    const out = linearColors(input)
    expect(out).not.toBe(input)
    expect([...input]).toEqual([0.5, 0.25, 1])
  })
})

describe('shardGeometry, what every ShardMesh draws, on the bench and in the world', () => {
  it('draws the blue from the report as the chip shows it, not violet', () => {
    const { colors } = shardGeometry(shardOf('#1902ff'))
    expect([onScreen(colors[0]), onScreen(colors[1]), onScreen(colors[2])]).toEqual([0x19, 0x02, 0xff])
  })

  it('draws every entry of the built-in palette as the byte it holds', () => {
    for (let i = 0; i < 256; i++) {
      const hex = hexAt(BUILT_IN, i)
      const { colors } = shardGeometry(shardOf(hex))
      const seen = [onScreen(colors[0]), onScreen(colors[1]), onScreen(colors[2])]
      expect(seen.map((n) => n.toString(16).padStart(2, '0')).join('')).toBe(hex.replace('#', '').toLowerCase())
    }
  })

  it('leaves the model in sRGB: what is stored and published does not move', () => {
    const s = shardOf('#1902ff')
    const before = JSON.stringify(s)
    shardGeometry(s)
    expect(JSON.stringify(s)).toBe(before)
    expect(s.vertices[0].c).toEqual(hexToRgb('#1902ff'))
  })

  it('converts a seam too: a face color becomes its own corners before the geometry', () => {
    const mesh = readFileSync('src/scene/ShardMesh.tsx', 'utf8')
    expect(mesh).toMatch(/const shard = useMemo\(\(\) => shared\?\.shard \?\? expandFaceColors\(given\), \[given, shared\]\)/)
    expect(mesh).toMatch(/shardGeometry\(shard, clip, pose\)/)
  })
})

describe('a placed piece, whose buffers its placements share (#563)', () => {
  it('builds them through shardGeometry, so it is converted the same way, from its seams too', () => {
    const mesh = readFileSync('src/scene/ShardMesh.tsx', 'utf8')
    const start = mesh.indexOf('function buildPlaced(')
    const build = mesh.slice(start, mesh.indexOf('\n}\n', start))
    expect(start).toBeGreaterThan(-1)
    expect(build).toMatch(/const shard = expandFaceColors\(model\)/)
    expect(build).toMatch(/= shardGeometry\(shard\)/)
  })
})

describe('what goes with it', () => {
  it('the point discs encode what they now receive linear, as every built-in material does', () => {
    expect(readFileSync('src/scene/pointDisc.ts', 'utf8')).toMatch(/#include <colorspace_fragment>/)
  })

  it('every picture drawn the old way is drawn again', () => {
    expect(LOOK).toBeGreaterThanOrEqual(2)
  })
})
