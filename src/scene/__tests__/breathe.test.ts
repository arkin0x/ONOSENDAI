/**
 * breathe.test.ts - a shard moved in EDIT breathes, and every placed part in
 * it breathes at its OWN opacity (DECK-0003 §1.11, §1.10), not the moving
 * parent's: the traverse reaches every part (review of #452).
 */

import { describe, expect, it } from 'vitest'
import { LineBasicMaterial, MeshBasicMaterial } from 'three'
import { breatheMaterial } from '../WorldShards'
import { createDiscMaterial, SHARD_DOTS } from '../pointDisc'
import { GHOST_OPACITY, shardOpacity } from '../shardFaces'

/** A material as ShardMesh makes it for a shard of `opacity` percent (its own share on userData). */
function faceOf(opacity?: number): MeshBasicMaterial {
  const m = new MeshBasicMaterial({ transparent: true })
  m.userData.share = shardOpacity(opacity === undefined ? {} : { opacity })
  return m
}

describe('breathing in EDIT', () => {
  it('a 30% part in a solid parent breathes at 30% of the breath; the parent at the breath', () => {
    const parent = faceOf()
    const part = faceOf(30)
    breatheMaterial(parent, 0.7)
    breatheMaterial(part, 0.7)
    expect(parent.opacity).toBeCloseTo(0.7)
    expect(part.opacity).toBeCloseTo(0.21)
  })

  it('a solid part of a 40% parent breathes at the full breath; the parent at 40% of it', () => {
    const parent = faceOf(40)
    const part = faceOf()
    breatheMaterial(parent, 0.5)
    breatheMaterial(part, 0.5)
    expect(parent.opacity).toBeCloseTo(0.2)
    expect(part.opacity).toBeCloseTo(0.5)
  })

  it('reads the share each time, so a changed opacity breathes at the new value', () => {
    const m = faceOf(50)
    breatheMaterial(m, 0.6)
    expect(m.opacity).toBeCloseTo(0.3)
    m.userData.share = shardOpacity({ opacity: 80 })
    breatheMaterial(m, 0.6)
    expect(m.opacity).toBeCloseTo(0.48)
  })

  it('a material with no share (a placeholder\'s edges) breathes at the breath', () => {
    const m = new LineBasicMaterial({ transparent: true })
    breatheMaterial(m, 0.4)
    expect(m.opacity).toBeCloseTo(0.4)
  })

  it('the dots keep their own ratio to the ghost\'s opacity, so they agree with their faces', () => {
    // A 30% part's dots, as ShardMesh makes them for a ghost: 0.45 x 0.3 x 0.55.
    const dots = createDiscMaterial(SHARD_DOTS, GHOST_OPACITY * 0.3 * 0.55)
    breatheMaterial(dots, 0.7)
    expect(dots.uniforms.uOpacity.value).toBeCloseTo(0.7 * 0.3 * 0.55)
  })
})
