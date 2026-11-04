/**
 * Every placement of an object shares one set of geometry (scene/placedBuffers):
 * an object placed a thousand times held a thousand copies of its arrays and GL
 * buffers, and built them a thousand times on the main thread.
 */
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BufferAttribute, BufferGeometry } from 'three'
import { holdPlaced, placedBuffers, type PlacedBuffers } from '../placedBuffers'

function geometry(): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(9), 3))
  return g
}

function make(): PlacedBuffers<{ id: string }> {
  const plain = geometry(), indexed = geometry()
  const inside = geometry()
  return {
    shard: { id: 'x' }, positions: new Float32Array(9), colors: new Float32Array(9), index: [0, 1, 2], faces: [[0, 1, 2]], drawn: [0],
    plain, indexed, outline: null, inside: () => inside, geometries: () => [plain, indexed, inside],
  }
}

const CANVAS = {}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('sharing one object among its placements', () => {
  it('a thousand placements build it once', () => {
    const model = {}
    const build = vi.fn(make)
    const seen = new Set<unknown>()
    for (let i = 0; i < 1000; i++) seen.add(placedBuffers(model, CANVAS, build))
    expect(build).toHaveBeenCalledTimes(1)
    expect(seen.size).toBe(1)
  })

  it('two objects never share', () => {
    expect(placedBuffers({}, CANVAS, make)).not.toBe(placedBuffers({}, CANVAS, make))
  })

  it('stays while any placement holds it, and lets go of every GL buffer after the last', () => {
    const model = {}
    const b = placedBuffers(model, CANVAS, make)
    const disposed = vi.fn()
    for (const g of b.geometries()) g.addEventListener('dispose', disposed)
    const first = holdPlaced(model, CANVAS, b)
    const second = holdPlaced(model, CANVAS, b)
    first()
    vi.runAllTimers()
    expect(disposed).not.toHaveBeenCalled()
    expect(placedBuffers(model, CANVAS, make)).toBe(b)
    second()
    vi.runAllTimers()
    expect(disposed).toHaveBeenCalledTimes(3)
    // Gone: the next placement builds it again.
    expect(placedBuffers(model, CANVAS, make)).not.toBe(b)
  })

  it('a placement replaced by another in one commit does not lose the buffers', () => {
    const model = {}
    const b = placedBuffers(model, CANVAS, make)
    const disposed = vi.fn()
    b.plain.addEventListener('dispose', disposed)
    const old = holdPlaced(model, CANVAS, b)
    // A commit runs every cleanup, then every new effect.
    old()
    const next = holdPlaced(model, CANVAS, b)
    vi.runAllTimers()
    expect(disposed).not.toHaveBeenCalled()
    expect(placedBuffers(model, CANVAS, make)).toBe(b)
    next()
    vi.runAllTimers()
    expect(disposed).toHaveBeenCalledTimes(1)
  })

  it('many placements leaving at once dispose once', () => {
    const model = {}
    const b = placedBuffers(model, CANVAS, make)
    const disposed = vi.fn()
    b.plain.addEventListener('dispose', disposed)
    const holds = Array.from({ length: 50 }, () => holdPlaced(model, CANVAS, b))
    for (const h of holds) h()
    vi.runAllTimers()
    expect(disposed).toHaveBeenCalledTimes(1)
  })

  it('a hold on buffers let go between render and effect owns them again', () => {
    const model = {}
    const b = placedBuffers(model, CANVAS, make)
    holdPlaced(model, CANVAS, b)()
    vi.runAllTimers()
    const again = holdPlaced(model, CANVAS, b)
    expect(placedBuffers(model, CANVAS, make)).toBe(b)
    const disposed = vi.fn()
    b.plain.addEventListener('dispose', disposed)
    again()
    vi.runAllTimers()
    expect(disposed).toHaveBeenCalledTimes(1)
  })
})

describe('one set per canvas (review of #563)', () => {
  it('two canvases drawing one object each have their own', () => {
    const model = {}, a = {}, b = {}
    expect(placedBuffers(model, a, make)).not.toBe(placedBuffers(model, b, make))
    const again = placedBuffers(model, a, make)
    expect(placedBuffers(model, a, make)).toBe(again)
  })

  it('a canvas frees its copy when its own placements leave, while another still draws the object', () => {
    const model = {}, parked = {}, world = {}
    const small = placedBuffers(model, parked, make), big = placedBuffers(model, world, make)
    const freedSmall = vi.fn(), freedBig = vi.fn()
    small.plain.addEventListener('dispose', freedSmall)
    big.plain.addEventListener('dispose', freedBig)
    const leaving = holdPlaced(model, parked, small)
    const staying = holdPlaced(model, world, big)
    leaving()
    vi.runAllTimers()
    expect(freedSmall).toHaveBeenCalledTimes(1)
    expect(freedBig).not.toHaveBeenCalled()
    staying()
    vi.runAllTimers()
    expect(freedBig).toHaveBeenCalledTimes(1)
  })
})

describe('ShardMesh uses it', () => {
  const text = fs.readFileSync(path.resolve(__dirname, '../ShardMesh.tsx'), 'utf8')

  it('a placement says it is one', () => {
    expect(text).toMatch(/<ShardMesh shard=\{model\} placed nested=\{r\.children\}/)
  })

  it('anything that writes vertices, or changes them, keeps its own copy', () => {
    expect(text).toMatch(/const sharing = placed && !clip && !pose && birth === undefined && dissolve === undefined/)
  })

  it('a shared geometry is never disposed by the placement drawing it', () => {
    for (const g of ['plain', 'indexed', 'inside', 'outline']) {
      expect(text).toMatch(new RegExp(`useEffect\\(\\(\\) => \\(shared \\? undefined : \\(\\) => \\{ ${g}\\??\\.dispose\\(\\) \\}\\)`))
    }
  })

  it('the shared buffers make no spare copies of the arrays', () => {
    const build = text.slice(text.indexOf('function buildPlaced'))
    expect(build.slice(0, build.indexOf('\n}\n'))).toMatch(/new BufferAttribute\(positions, 3\)/)
    expect(build.slice(0, build.indexOf('\n}\n'))).not.toMatch(/Float32BufferAttribute|\.slice\(\)/)
  })
})
