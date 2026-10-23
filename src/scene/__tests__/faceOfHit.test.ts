import { describe, it, expect } from 'vitest'
import { faceOfHit } from '../ShardMesh'

describe('faceOfHit', () => {
  it("maps a drawn triangle to the shard's own face, on either side's mesh", () => {
    // A map in which triangle 1 is face 2: the triangles drawn are not always the faces (a region cut draws pieces).
    const faceOf = [0, 2]
    expect(faceOfHit({ object: { userData: { faceOf } }, faceIndex: 1 })).toBe(2)
    expect(faceOfHit({ object: { userData: { faceOf } }, faceIndex: 0 })).toBe(0)
  })
  it('answers null for anything that is not a face mesh, or a triangle past the map', () => {
    expect(faceOfHit({ object: { userData: {} }, faceIndex: 0 })).toBeNull()
    expect(faceOfHit({ object: { userData: { faceOf: [0] } }, faceIndex: 5 })).toBeNull()
    expect(faceOfHit({ object: { userData: { faceOf: [0] } }, faceIndex: null })).toBeNull()
  })
})
