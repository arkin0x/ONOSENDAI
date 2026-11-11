/**
 * oneView.test.ts - one VIEW mode (arkinox, 2026-11-11): every way to look at
 * something lands in the standard VIEW, the cursor on the thing, with the
 * Region button, RECALL home, and the label it had.
 *
 * - viewAt is the one seam; EARTH, CYBERSPACE, a block, a starred place, an
 *   item are VIEW and keep their own words in the VIEWING chip.
 * - D1: RECALL always goes home, never back through earlier views.
 * - D2: a view frames the thing: EARTH's centre on screen, not half a cell off.
 * - D3: a block clicked in the scene is only viewed, never made the destination.
 * - X in a view ends it (it used to bring the cursor home and leave the view up).
 * - Region mode works at Earth's 2^52 and the cube's 2^82.
 * - VIEW HERE hands a spectation over to VIEW at the same spot.
 * - No cross marker from a starred place.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

vi.mock('../../lib/relay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/relay')>()),
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))
vi.mock('../../lib/chains', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/chains')>()),
  fetchChainEvents: vi.fn(async () => []),
  confirmChainEvents: vi.fn(async () => []),
  watchAuthor: vi.fn(() => () => {}),
}))

import { alignedOrigin, useCyberspace } from '../useCyberspace'
import { useHyperspace } from '../useHyperspace'
import { useRegion } from '../useRegion'
import { selectStopInScene, viewCyberspace, viewEarth } from '../../hud/HyperspacePanel'
import { viewStarred } from '../../hud/StarredPlaceCard'
import { viewingLabel } from '../../hud/FocusBar'
import { itemCentre, viewAxes } from '../../lib/space'
import { placeInput } from '../../lib/starred'
import { parseViewAt } from '../../lib/viewAt'
import { onEarthSurface } from '../../lib/hyperspace/interest'

const cs = () => useCyberspace.getState()
const PK = 'cd'.repeat(32)

beforeEach(() => {
  useRegion.getState().exit()
  cs().endSpectate()
  cs().clearFocus()
  useHyperspace.setState({ scrubHeight: null, viewOwned: false, viewedStop: null, destination: null })
  useCyberspace.setState({ scaleExp: 4, pin: null })
})
afterEach(() => {
  useRegion.getState().exit()
  cs().endSpectate()
  cs().clearFocus()
})

const right = () => { const r = cs().axes().right; cs().moveCursor({ axis: r.axis, dir: r.dir as 1 | -1 }) }

describe('one seam: every view is VIEW', () => {
  it('viewAt is VIEW, the cursor on the thing, and VIEWING keeps its label until the cursor leaves', () => {
    const at = { x: 1000n, y: 2000n, z: 3000n }
    cs().viewAt(at, 0, 'BLOCK 7 · PORT', 34)
    expect(cs().viewing()).toBe(true)
    expect(cs().cursor).toEqual(at)
    expect(cs().scaleExp).toBe(34)
    expect(viewingLabel(cs().focus, cs().cursor, cs().anchorPlane)).toBe('BLOCK 7 · PORT')
    right()
    expect(viewingLabel(cs().focus, cs().cursor, cs().anchorPlane)).toBe('A COORD')
  })

  it('EARTH from the compass and CYBERSPACE are VIEW, at their own zooms, owned by hyperspace', () => {
    viewEarth()
    expect(cs().viewing()).toBe(true)
    expect(cs().focus?.label).toBe('EARTH')
    expect(cs().scaleExp).toBe(52)
    expect(useHyperspace.getState().viewOwned).toBe(true)
    viewCyberspace()
    expect(cs().viewing()).toBe(true)
    expect(cs().focus?.label).toBe('CYBERSPACE')
    expect(cs().scaleExp).toBe(82)
  })

  it('a starred place on Earth is VIEW and drops no cross marker', () => {
    const ground = parseViewAt('44.97, -93.27', 0)!.position
    expect(onEarthSurface(ground)).toBe(true)
    viewStarred({ input: placeInput(ground), label: 'MINNEAPOLIS', plane: 0, at: 1, scaleExp: 20 })
    expect(cs().viewing()).toBe(true)
    expect(cs().pin).toBeNull()
  })

  it('an item view is VIEW and frames the item where it is drawn', () => {
    const at = { x: (1n << 40n) + 12345n, y: 77n, z: 99n }
    cs().viewAt(at, 0, 'SHARD', 20, { item: true })
    expect(cs().viewing()).toBe(true)
    const axes = viewAxes(cs().view)
    expect(cs().cursorOffset()).toEqual(itemCentre(at, alignedOrigin(cs().anchor, 20), 20, axes))
  })
})

describe('D2: a view frames the thing', () => {
  it('EARTH arrives with the planet centre at screen centre, as the plain look framed it', () => {
    const centre = { x: 1n << 84n, y: 1n << 84n, z: 1n << 84n }
    cs().focusOn(centre, 0, 'PLAIN', 52)
    const plain = cs().cursorOffset()
    cs().clearFocus()
    viewEarth()
    expect(cs().cursorOffset()).toEqual(plain)
    // Off the centre, the camera follows the cursor's cell as any VIEW does.
    right()
    expect(cs().cursorOffset()).not.toEqual(plain)
  })
})

describe('D1: RECALL always goes home', () => {
  it('from a view reached through another view, RECALL is your avatar at the zoom from before any look', () => {
    const home = { ...cs().position }
    cs().viewAt({ x: 5n, y: 6n, z: 7n }, 0, 'GRAND CANYON', 30)
    viewEarth()
    cs().cancel()
    expect(cs().focus).toBeNull()
    expect(cs().cursor).toEqual(home)
    expect(cs().scaleExp).toBe(4)
    expect(useHyperspace.getState().viewOwned).toBe(false)
  })
})

describe('X ends a view', () => {
  it('X in a view moved off its place ends the view; it no longer leaves the view up with the cursor at your head', () => {
    cs().viewAt({ x: 5000n, y: 6000n, z: 7000n }, 0, 'SOMEWHERE', 4)
    right()
    cs().cancel()
    expect(cs().focus).toBeNull()
    expect(cs().cursor).toEqual(cs().position)
  })

  it('X ends what BUILD leaves behind too', () => {
    cs().focusOn({ x: 5000n, y: 6000n, z: 7000n }, 0, 'BUILD', undefined, true)
    cs().cancel()
    expect(cs().focus).toBeNull()
  })
})

describe('D3: viewing a block only views it', () => {
  it('a block clicked in the scene sets no destination', () => {
    selectStopInScene(123)
    expect(useHyperspace.getState().destination).toBeNull()
  })
})

describe('region mode at the big zooms', () => {
  it('turns on from EARTH at 2^52 and from CYBERSPACE at 2^82 with a prefix that holds the cursor cell', () => {
    viewEarth()
    useRegion.getState().enter()
    expect(useRegion.getState().active).toBe(true)
    const earth = useRegion.getState().prefix
    expect(earth).not.toBeNull()
    right()
    expect(useRegion.getState().prefix).not.toBeNull()
    useRegion.getState().exit()
    viewCyberspace()
    useRegion.getState().enter()
    expect(useRegion.getState().prefix).not.toBeNull()
    expect(useRegion.getState().prefix!.length).toBeLessThan(earth!.length)
  })

  it('ends when another view takes the place of the one it started in', () => {
    viewEarth()
    useRegion.getState().enter()
    cs().viewAt({ x: 5n, y: 6n, z: 7n }, 0, 'GRAND CANYON', 30)
    expect(useRegion.getState().active).toBe(false)
  })
})

describe('VIEW HERE', () => {
  it('hands a spectation over to VIEW at the same spot; RECALL then goes home', () => {
    cs().beginSpectate(PK)
    const there = { ...cs().anchor }
    cs().viewHere()
    expect(cs().spectate).toBeNull()
    expect(cs().viewing()).toBe(true)
    expect(cs().cursor).toEqual(there)
    cs().cancel()
    expect(cs().focus).toBeNull()
    expect(cs().anchor).toEqual(cs().position)
  })

  it('does nothing over a view already up', () => {
    cs().viewAt({ x: 5n, y: 6n, z: 7n }, 0, 'A PLACE', 30)
    cs().viewHere()
    expect(cs().focus?.label).toBe('A PLACE')
  })
})
