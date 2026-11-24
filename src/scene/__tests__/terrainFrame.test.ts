/**
 * terrainFrame.test.ts - the blocks stay put when a step settles (owner,
 * 2026-11-24: "Every time a move resolves ... the whole world of blocks just
 * shifted for a frame or two"). A settle moves the store's anchor a commit
 * before the scene, and the camera and the shards follow the committed one
 * (lib/renderFrame.ts). The blocks' frame (scene/TerrainLayer.tsx
 * fieldMatrix) must too: between the store's move and the commit a block's
 * place on screen does not move, and after the commit it moves by exactly
 * the origin shift the camera takes.
 */

import { describe, expect, it } from 'vitest'
import { Matrix4, Vector3 } from 'three'
import { fieldMatrix } from '../TerrainLayer'
import { useCyberspace, alignedOrigin } from '../../store/useCyberspace'
import { commitAnchor, commitScale } from '../../lib/renderFrame'
import type { ViewAxes } from '../../lib/space'

const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } } as ViewAxes
const ORIGIN = { x: 0x1000000n, y: 0x2000000n, z: 0x3000000n, plane: 0 }
const field = { world: { origin: ORIGIN } } as never

/** Where a block (a cs offset from the field's origin) lands in render space. */
function onScreen(cell: [number, number, number]): Vector3 {
  return new Vector3(cell[0] + 0.5, cell[1] + 0.5, cell[2] + 0.5).applyMatrix4(fieldMatrix(field, AXES, 0, new Matrix4()))
}

describe('the blocks across a settle', () => {
  it('do not move while the store\'s anchor runs a commit ahead, and move with the camera\'s origin after', () => {
    const before = { x: ORIGIN.x + 40n, y: ORIGIN.y + 10n, z: ORIGIN.z + 40n }
    const after = { x: before.x + 3n, y: before.y, z: before.z - 2n }
    useCyberspace.setState({ anchor: before, scaleExp: 0 })
    commitAnchor(before)
    commitScale(0)
    const cell: [number, number, number] = [44, 12, 37]
    const was = onScreen(cell)
    // The step settles: the store moves first. The frame drawn now still has every shard and the camera against `before`.
    useCyberspace.setState({ anchor: after })
    expect(onScreen(cell).distanceTo(was)).toBe(0)
    // The commit: everything moves to `after` together, the blocks by exactly the shift of the aligned origin.
    commitAnchor(after)
    const shift = alignedOrigin(after, 0)
    const from = alignedOrigin(before, 0)
    const moved = onScreen(cell).sub(was)
    expect(moved.x).toBeCloseTo(-Number(shift.x - from.x))
    expect(moved.y).toBeCloseTo(-Number(shift.y - from.y))
    expect(moved.z).toBeCloseTo(-Number(shift.z - from.z))
  })
})
