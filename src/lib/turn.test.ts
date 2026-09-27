import { describe, expect, it } from 'vitest'
import { fromPayload, newShard, ticksOf, toPayload, type ShardModel } from 'sno-core/shards'
import { turnShard, type Turns } from './turn'

const T = 120
const L: ShardModel = {
  ...newShard('L'),
  vertices: [
    { p: [0, 0, 0], c: [1, 0, 0] },
    { p: [2, 0, 0], c: [0, 1, 0] },
    { p: [0, 1, 0], t: [0, 60, 0], c: [0, 0, 1] },
  ],
  faces: [[0, 1, 2]],
  facecolors: [[1, 1, 0]],
  refs: [['a', `33331:${'ab'.repeat(32)}:col`]],
  parts: [{ ref: 0, at: [3 * T, 0, 0], turn: [0, 0, 0], step: 0 }],
}
const pts = (s: ShardModel) => s.vertices.map((v) => ticksOf(v))

describe('turnShard', () => {
  it('is the same object with no turns', () => {
    expect(turnShard(L, [0, 0, 0])).toBe(L)
    expect(turnShard(L, [4, 8, -4])).toBe(L)
  })

  it('a quarter on Y takes +X to -Z, on Z takes +X to +Y, on X takes +Y to +Z (right-handed)', () => {
    expect(pts(turnShard(L, [0, 1, 0]))[1]).toEqual([0, 0, -2 * T])
    expect(pts(turnShard(L, [0, 0, 1]))[1]).toEqual([0, 2 * T, 0])
    expect(pts(turnShard(L, [1, 0, 0]))[2]).toEqual([0, 0, 1.5 * T])
  })

  it('stays exactly on the lattice, keeps faces, colors and face colors, and leaves the model alone', () => {
    const out = turnShard(L, [1, 3, 2])
    for (const p of pts(out)) for (const n of p) expect(Number.isInteger(n)).toBe(true)
    expect(out.faces).toEqual(L.faces)
    expect(out.facecolors).toEqual(L.facecolors)
    expect(out.vertices.map((v) => v.c)).toEqual(L.vertices.map((v) => v.c))
    expect(pts(L)[1]).toEqual([2 * T, 0, 0])
  })

  it('four quarters on any axis is the identity; two halves undo each other', () => {
    for (const t of [[4, 0, 0], [0, 4, 0], [0, 0, 4]] as Turns[]) expect(pts(turnShard(L, t))).toEqual(pts(L))
    expect(pts(turnShard(turnShard(L, [0, 2, 0]), [0, 2, 0]))).toEqual(pts(L))
  })

  it('placed objects swing with the points and turn themselves', () => {
    const out = turnShard(L, [0, 0, 1])
    expect(out.parts![0].at).toEqual([0, 3 * T, 0])
    expect(out.parts![0].turn).not.toEqual([0, 0, 0])
    expect(out.refs).toEqual(L.refs)
  })

  it('round-trips through the wire', () => {
    const out = turnShard(L, [1, 1, 1])
    const back = fromPayload(toPayload(out), 'x')!
    expect(pts(back)).toEqual(pts(out))
  })
})
