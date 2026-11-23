/**
 * prefixRegionBoxPlane.test.tsx - a /C/ prefix link's yellow box lasts through
 * a plane switch (arkinox, 2026-11-12). A prefix shorter than 64 hex never
 * reaches the plane bit (CYBERSPACE_V2.md §2.5), so the box is the same in
 * dataspace and ideaspace and is drawn in whichever the view shows. It used
 * to carry the plane it was opened in and vanish on P.
 *
 * PrefixRegionBox runs in a real R3F root (test/r3fRoot.ts); the box is its
 * one lineSegments.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import type { Object3D } from 'three'
import { r3fRoot, type R3fRoot } from '../../test/r3fRoot'
import { PrefixRegionBox } from '../PrefixRegionBox'
import { useCyberspace } from '../../store/useCyberspace'
import { startCoordRoute } from '../../store/useCoordRoute'
import type { ViewAxes } from '../../lib/space'

vi.mock('../WorldLabel', async (real) => ({ ...(await real<object>()), WorldLabel: () => null }))

const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: -1 } }
/** arkinox's midwest region. */
const MIDWEST = '56db6db6db6db6db6db6dbad'

let r: R3fRoot | null = null
let stop: (() => void) | null = null

afterEach(async () => {
  await r?.unmount()
  r = null
  stop?.()
  stop = null
  useCyberspace.getState().clearFocus()
})

function boxes(root: Object3D): number {
  let n = 0
  root.traverse((o) => { if ((o as { isLineSegments?: boolean }).isLineSegments) n++ })
  return n
}

describe('the /C/ prefix box and the plane', () => {
  it('is drawn in dataspace on open and still drawn after switching to ideaspace and back', async () => {
    useCyberspace.setState({ plane: 1, anchorPlane: 1 })
    stop = startCoordRoute({ pathname: `/C/${MIDWEST}`, search: '', hash: '' }, { replaceState: () => {} })
    expect(useCyberspace.getState().anchorPlane).toBe(0)
    r = await r3fRoot()
    await r.render(createElement(PrefixRegionBox, { axes: AXES }))
    expect(boxes(r.state().scene)).toBe(1)

    useCyberspace.getState().togglePlane()
    await r.frame()
    expect(useCyberspace.getState().anchorPlane).toBe(1)
    expect(boxes(r.state().scene)).toBe(1)

    useCyberspace.getState().togglePlane()
    await r.frame()
    expect(boxes(r.state().scene)).toBe(1)
  })
})
