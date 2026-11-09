/**
 * buildDimOwnCell.test.tsx - your own avatar is not dimmed while the build
 * cursor is on its cell (arkinox, 2026-11-09). Entering BUILD from your head
 * puts the cursor on your own cell (useBuilder enter), and #621's avatar
 * dimming then dimmed your avatar every time BUILD opened. Everyone else's
 * avatar dims as before.
 *
 * BuildOccluders runs in a real R3F root (test/r3fRoot.ts), its frames
 * through R3F's own loop, casting against real meshes: your avatar and
 * someone else's, both on the line of sight from the camera to the cursor's
 * cell. Only where your avatar stands changes between the cases.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { BoxGeometry, Mesh, MeshBasicMaterial } from 'three'
import { r3fRoot, type R3fRoot } from '../../test/r3fRoot'
import { BuildOccluders, OWN_AVATAR_KEY, cursorOnOwnAvatar } from '../BuildOccluders'
import { registerOccluder, setDimmed, useBuildDim } from '../../store/useBuildDim'
import { useBuilder } from '../../store/useBuilder'
import { alignedOrigin, useCyberspace } from '../../store/useCyberspace'
import { aimCentres, type Position, type ViewAxes } from '../../lib/space'

const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: -1 } }
const P: Position = { x: 1000n, y: 2000n, z: 3000n }
const THEM = 'avatar:them'

let clock = 0
let r: R3fRoot | null = null
const off: Array<() => void> = []

beforeEach(() => {
  clock = 1000
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
})

afterEach(async () => {
  await r?.unmount()
  r = null
  for (const f of off.splice(0)) f()
  useBuilder.setState({ active: false, scrub: null })
  setDimmed(new Set())
  vi.restoreAllMocks()
})

/**
 * The scene at scale 0 with the cursor (and anchor) at P and your avatar at
 * `you`, both avatars standing between the camera and the cursor's cell, the
 * Builder on; then frames until the picker has cast. The dimmed set after.
 */
async function dimmedWith(you: Position, plane = 0): Promise<ReadonlySet<string>> {
  // The cyberspace store first: a change to it can stand the Builder down.
  useCyberspace.setState({ walking: false, spectate: null, focus: null, position: you, cursor: P, anchor: P, scaleExp: 0, plane: 0, headPlane: plane as never, anchorPlane: 0 })
  useBuilder.setState({ active: true, scrub: null })
  const [cx, cy, cz] = aimCentres(P, alignedOrigin(P, 0), 0, AXES).cell
  const box = (z: number): Mesh => {
    const m = new Mesh(new BoxGeometry(1.5, 1.5, 1.5), new MeshBasicMaterial())
    m.position.set(cx, cy, cz + z)
    return m
  }
  const mine = box(4)
  const theirs = box(6)
  r = await r3fRoot()
  await r.render(createElement('group', null,
    createElement(BuildOccluders, { axes: AXES }),
    createElement('primitive', { object: mine }),
    createElement('primitive', { object: theirs })))
  r.state().camera.position.set(cx, cy, cz + 10)
  r.state().camera.lookAt(cx, cy, cz)
  off.push(registerOccluder(OWN_AVATAR_KEY, mine, true), registerOccluder(THEM, theirs, true))
  for (let i = 0; i < 4; i++) { await r.frame(); clock += 100 }
  expect(useBuilder.getState().active).toBe(true)
  return useBuildDim.getState().dimmed
}

describe('your own avatar on the cursor cell', () => {
  it('entering BUILD from your head (the cursor on your cell): yours is not dimmed, theirs is', async () => {
    const dimmed = await dimmedWith(P)
    expect(dimmed.has(OWN_AVATAR_KEY)).toBe(false)
    expect(dimmed.has(THEM)).toBe(true)
  })

  it('the cursor on another cell: yours dims when it blocks, as before', async () => {
    const dimmed = await dimmedWith({ ...P, x: P.x + 5n })
    expect(dimmed.has(OWN_AVATAR_KEY)).toBe(true)
    expect(dimmed.has(THEM)).toBe(true)
  })
})

describe('cursorOnOwnAvatar', () => {
  const s = (over: object = {}) => ({ position: P, headPlane: 0 as never, spectate: null, focusChain: () => [], cursor: P, plane: 0 as never, anchorPlane: 0 as never, focus: null, scaleExp: 0, ...over })

  it('the same cell at the zoom on show, anywhere inside it', () => {
    expect(cursorOnOwnAvatar(s(), P, null)).toBe(true)
    // At 2^4 a cell is 16 wide: 1000 and 1007 share one, 1000 and 1008 do not (1000 = 62 x 16 + 8).
    expect(cursorOnOwnAvatar(s({ scaleExp: 4 }), { ...P, x: 1007n }, null)).toBe(true)
    expect(cursorOnOwnAvatar(s({ scaleExp: 4 }), { ...P, x: 992n }, null)).toBe(true)
    expect(cursorOnOwnAvatar(s({ scaleExp: 4 }), { ...P, x: 1008n }, null)).toBe(false)
    expect(cursorOnOwnAvatar(s(), { ...P, z: P.z + 1n }, null)).toBe(false)
  })

  it('another plane is another cell', () => {
    expect(cursorOnOwnAvatar(s({ headPlane: 1 }), P, null)).toBe(false)
  })

  it('spectating, the avatar on show is the one at the aimed action', () => {
    const Q = { x: 50n, y: 60n, z: 70n }
    const chain = [{ position: P, plane: 0 }, { position: Q, plane: 0 }]
    const spectating = s({ spectate: {}, focusChain: () => chain })
    expect(cursorOnOwnAvatar(spectating, Q, null)).toBe(true)
    expect(cursorOnOwnAvatar(spectating, P, null)).toBe(false)
    expect(cursorOnOwnAvatar(spectating, P, 0)).toBe(true)
  })
})
