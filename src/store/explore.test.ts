/**
 * explore.test.ts - the anchor follows the explored action, and only that.
 *
 * What would fail silently: the anchor staying on the live position while the
 * index moves (the scene would not change), the camera offset still tracking a
 * cursor that is not drawn, or a commit landing while you are in history and
 * dragging the anchor to the new head.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { SPAWN, useCyberspace } from './useCyberspace'

function land(dx: bigint): void {
  const s = useCyberspace.getState()
  useCyberspace.setState({ pendingTarget: { ...s.position, x: s.position.x + dx } })
  s.applyProofMessage({
    type: 'done', id: 0, mode: 'hop', elapsedMs: 1, proofHash: 'ab'.repeat(32),
    regionN: '1', terrainK: 8, lca: { x: 1, y: 0, z: 0 }, totalOps: 1,
  })
}

describe('explore', () => {
  beforeAll(() => {
    // Three hops: the chain is spawn, +1, +2, +3.
    land(1n); land(1n); land(1n)
  })

  it('starts at the head, anchored on the live position', () => {
    const s = useCyberspace.getState()
    expect(s.actions()).toHaveLength(4)
    expect(s.exploreIndex).toBeNull()
    expect(s.anchor).toEqual(s.position)
    expect(s.atHead()).toBe(true)
  })

  it('anchors on the explored action and stops framing the cursor', () => {
    useCyberspace.setState({ cursor: { ...SPAWN, x: SPAWN.x + 40n } })
    useCyberspace.getState().explore(1)
    const s = useCyberspace.getState()
    expect(s.exploreIndex).toBe(1)
    expect(s.anchor).toEqual({ ...SPAWN, x: SPAWN.x + 1n })
    expect(s.position).toEqual({ ...SPAWN, x: SPAWN.x + 3n })
    expect(s.atHead()).toBe(false)
    expect(s.cursorOffset()).toEqual([0, 0, 0])
  })

  it('reads the hop into the explored action for the XOR readout', () => {
    const [from, to] = useCyberspace.getState().readoutPair()
    expect(from).toEqual(SPAWN)
    expect(to).toEqual({ ...SPAWN, x: SPAWN.x + 1n })
  })

  it('steps and clamps at both ends', () => {
    const s = useCyberspace.getState()
    s.exploreStep(-5)
    expect(useCyberspace.getState().exploreIndex).toBe(0)
    expect(useCyberspace.getState().anchor).toEqual(SPAWN)
    s.exploreStep(2)
    expect(useCyberspace.getState().exploreIndex).toBe(2)
    s.exploreStep(50)
    expect(useCyberspace.getState().exploreIndex).toBeNull()
    expect(useCyberspace.getState().atHead()).toBe(true)
  })

  it('refuses to move the cursor or commit from history', () => {
    const s = useCyberspace.getState()
    s.explore(0)
    const cursor = useCyberspace.getState().cursor
    s.moveCursor({ axis: 'x', dir: 1 })
    expect(useCyberspace.getState().cursor).toEqual(cursor)
    s.commit()
    expect(useCyberspace.getState().proof.status).not.toBe('computing')
  })

  it('leaves the anchor in history when a commit lands, and follows once back at the head', () => {
    useCyberspace.getState().explore(0)
    land(1n)
    let s = useCyberspace.getState()
    expect(s.actions()).toHaveLength(5)
    expect(s.exploreIndex).toBe(0)
    expect(s.anchor).toEqual(SPAWN)
    s.explore(null)
    s = useCyberspace.getState()
    expect(s.anchor).toEqual(s.position)
    expect(s.position).toEqual({ ...SPAWN, x: SPAWN.x + 4n })
  })

  it('comes back to the head on a respawn', () => {
    useCyberspace.getState().explore(2)
    useCyberspace.getState().respawn()
    const s = useCyberspace.getState()
    expect(s.exploreIndex).toBeNull()
    expect(s.anchor).toEqual(SPAWN)
  })
})
