/**
 * viewAtPanel.test.ts - the View panel (arkinox, 2026-11-02) and the VIEWING
 * chip's name (ruled 2026-11-03).
 *
 * - A new panel, View: Position's twin whose figures are the view cursor's.
 *   It rises to the first place in the menu while a free view is up and
 *   goes back to its own place after.
 * - Position's /C/ link was the view's place: the View panel has that link
 *   now, and Position's always points at your chain head.
 * - VIEW A COORDINATE, RECENT and STARRED PLACES moved from Position to View.
 * - VIEWING says a free view's name when it has one (a starred place, a
 *   person), and A COORD otherwise.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'

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

// As in hudBuildOrder.test.ts: every store hook reads the live state, so a
// server render shows what the store holds now.
vi.mock('zustand', async (importOriginal) => {
  const real = await importOriginal<typeof import('zustand')>()
  const live = (init: Parameters<typeof real.create>[0]) => {
    const hook = real.create(init)
    return Object.assign((sel: (s: unknown) => unknown = (x) => x) => sel(hook.getState()), hook)
  }
  return { ...real, create: (init?: Parameters<typeof real.create>[0]) => (init === undefined ? live : live(init)) }
})

vi.mock('../../lib/geocode', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../lib/geocode')>()), geocode: vi.fn(async () => null) }))

import { Hud, PositionPanel, ViewAtPanel, useViewDraft, viewedPlace } from '../Hud'
import { geocode } from '../../lib/geocode'
import { useCoordRoute } from '../../store/useCoordRoute'
import { PanelSlot } from '../PanelSlot'
import { FREE_VIEW_LABEL, viewingLabel } from '../FocusBar'
import { viewStarred } from '../StarredPlaceCard'
import { useCyberspace } from '../../store/useCyberspace'
import { useBuilder } from '../../store/useBuilder'
import { useStarred } from '../../store/useStarred'
import { placeHex } from '../../lib/coordRoute'
import { RECENT_VIEWS_KEY } from '../../lib/viewAt'
import { placeInput } from '../../lib/starred'
import { formatLatLonDeg } from '../../lib/earthSurface'

function nameOf(k: ReactElement): string {
  const inner = k.type === PanelSlot ? (k as ReactElement<{ children: ReactElement }>).props.children : k
  return (inner.type as { name: string }).name
}

function columns(): { left: string[]; right: string[] } {
  let tree: ReactElement | null = null
  renderToString(createElement(() => { tree = Hud({}); return null }))
  const names = (col: ReactNode): string[] => {
    const kids = (col as ReactElement<{ children: ReactNode[] }>).props.children
    return (Array.isArray(kids) ? kids.flat() : [kids])
      .filter((k): k is ReactElement => isValidElement(k) && typeof k.type === 'function')
      .map(nameOf)
  }
  const [left, right] = (tree! as ReactElement<{ children: ReactNode[] }>).props.children
  return { left: names(left), right: names(right) }
}

/** Every element in a tree whose props pass the test, function components rendered through. */
function findAll(node: ReactNode, test: (props: Record<string, unknown>) => boolean, out: ReactElement<Record<string, unknown>>[] = []): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) { for (const n of node) findAll(n, test, out); return out }
  if (!isValidElement(node)) return out
  const props = node.props as Record<string, unknown>
  if (test(props)) out.push(node as ReactElement<Record<string, unknown>>)
  findAll(props.children as ReactNode, test, out)
  return out
}

/** A panel's tree, rendered once so its hooks run. */
function tree(Panel: () => JSX.Element): ReactNode {
  let t: ReactNode = null
  renderToString(createElement(() => { t = Panel(); return null }))
  return t
}

/** The /C/ link a panel shows, as the text after /C/. */
function linkOf(Panel: () => JSX.Element): string {
  const html = renderToString(createElement(Panel))
  const m = html.match(/<code>\/C\/<!-- -->([0-9a-f]{64})<\/code>/) ?? html.match(/<code>\/C\/([0-9a-f]{64})<\/code>/)
  if (!m) throw new Error('no link in the panel')
  return m[1]
}

const cs = () => useCyberspace.getState()

afterEach(() => {
  useBuilder.getState().exit()
  cs().clearFocus()
  cs().clearPin()
})

describe('the View panel in the menu', () => {
  it('sits right under Position, in the right column, with no view up', () => {
    const { left, right } = columns()
    expect(left).not.toContain('ViewAtPanel')
    expect(right.slice(0, 3)).toEqual(['ScalePanel', 'PositionPanel', 'ViewAtPanel'])
  })

  it('rises to the first place while the pad VIEW is on, and goes back when it ends', () => {
    cs().viewHere()
    expect(cs().viewing()).toBe(true)
    let { left, right } = columns()
    expect(left.slice(0, 2)).toEqual(['Brand', 'ViewAtPanel'])
    expect(right).not.toContain('ViewAtPanel')
    // Position stays where it is.
    expect(right).toContain('PositionPanel')
    cs().clearFocus()
    ;({ left, right } = columns())
    expect(left).not.toContain('ViewAtPanel')
    expect(right.slice(1, 3)).toEqual(['PositionPanel', 'ViewAtPanel'])
  })

  it('leads for every free view, a typed place or a star too, and not for a fixed look at a block', () => {
    cs().focusOn({ x: 5n, y: 6n, z: 7n }, 0, 'BLOCK 1', undefined, false)
    expect(columns().left).not.toContain('ViewAtPanel')
    cs().focusOn({ x: 5n, y: 6n, z: 7n }, 0, '5, 6, 7', undefined, true)
    expect(columns().left.slice(0, 2)).toEqual(['Brand', 'ViewAtPanel'])
  })

  it('outranks a move under way', () => {
    useCyberspace.setState({ proof: { ...cs().proof, status: 'computing' } })
    try {
      cs().viewHere()
      expect(columns().left.slice(0, 3)).toEqual(['Brand', 'ViewAtPanel', 'ProofPanel'])
    } finally {
      useCyberspace.setState({ proof: { ...cs().proof, status: 'idle' } })
    }
  })
})

describe('the figures and the links', () => {
  it('at your head, both panels read your place, and both links are your chain head', () => {
    expect(linkOf(PositionPanel)).toBe(cs().coordHex())
    expect(linkOf(ViewAtPanel)).toBe(cs().coordHex())
  })

  it('in a view, View reads the view cursor and links to it; Position keeps your place and links to your chain head', () => {
    cs().viewHere()
    cs().moveCursor({ axis: 'x', dir: 1 })
    cs().moveCursor({ axis: 'y', dir: 1 })
    const { cursor, position, anchorPlane } = cs()
    expect(cursor).not.toEqual(position)
    const viewHex = placeHex(cursor, anchorPlane)
    expect(viewHex).not.toBe(cs().coordHex())
    expect(linkOf(ViewAtPanel)).toBe(viewHex)
    expect(linkOf(PositionPanel)).toBe(cs().coordHex())
    // The figures follow: View's X is the cursor's, Position's is yours.
    expect(viewedPlace(cs()).position).toBe(cs().cursor)
    expect(renderToString(createElement(ViewAtPanel))).toContain(viewHex)
    expect(renderToString(createElement(PositionPanel))).not.toContain(viewHex)
  })

  it('in BUILD mode View reads the build cursor', () => {
    useBuilder.getState().enter('build')
    cs().moveCursor({ axis: 'z', dir: 1 })
    expect(linkOf(ViewAtPanel)).toBe(placeHex(cs().cursor, cs().anchorPlane))
    expect(linkOf(PositionPanel)).toBe(cs().coordHex())
  })

  it('in a fixed look, View reads what is looked at', () => {
    cs().focusOn({ x: 9n, y: 10n, z: 11n }, 1, 'BLOCK 2')
    expect(linkOf(ViewAtPanel)).toBe(placeHex({ x: 9n, y: 10n, z: 11n }, 1))
  })
})

describe('VIEW A COORDINATE, RECENT and STARRED PLACES moved to View', () => {
  beforeEach(() => {
    localStorage.setItem(RECENT_VIEWS_KEY, JSON.stringify([{ input: '1, 2, 3', label: '1, 2, 3', plane: 0 }]))
    useStarred.setState({ places: [{ input: placeInput({ x: 4n, y: 5n, z: 6n }), label: '4, 5, 6', plane: 0, at: 1, nickname: 'ROOFTOP' }] })
  })
  afterEach(() => {
    localStorage.removeItem(RECENT_VIEWS_KEY)
    useStarred.setState({ places: [] })
  })

  it('View has them', () => {
    const html = renderToString(createElement(ViewAtPanel))
    expect(html).toContain('View a coordinate')
    expect(html).toContain('aria-label="A place to view"')
    expect(html).toContain('RECENT')
    expect(html).toContain('STARRED PLACES')
    expect(html).toContain('ROOFTOP')
  })

  it('Position does not', () => {
    const html = renderToString(createElement(PositionPanel))
    expect(html).not.toContain('View a coordinate')
    expect(html).not.toContain('A place to view')
    expect(html).not.toContain('RECENT')
    expect(html).not.toContain('STARRED PLACES')
    expect(html).not.toContain('ROOFTOP')
  })

  it("View's VIEW goes there with the cursor, named only when the place has a name", () => {
    const go = (nickname?: string): void => {
      const starred = findAll(tree(ViewAtPanel), (p) => typeof p.onGo === 'function')[0]
      expect(starred).toBeDefined()
      const place = { input: placeInput({ x: 4n, y: 5n, z: 6n }), label: '4, 5, 6', plane: 0 as const, at: 1, nickname }
      const onGo = starred.props.onGo as (p: typeof place, t: { position: { x: bigint; y: bigint; z: bigint }; plane: 0; label: string }) => void
      onGo(place, { position: { x: 4n, y: 5n, z: 6n }, plane: 0, label: nickname ?? '4, 5, 6' })
    }
    go('ROOFTOP')
    expect(cs().focus).toMatchObject({ drive: true, label: 'ROOFTOP', named: { position: { x: 4n, y: 5n, z: 6n }, plane: 0 } })
    expect(cs().cursor).toEqual({ x: 4n, y: 5n, z: 6n })
    expect(viewingLabel(cs().focus, cs().cursor, cs().anchorPlane)).toBe('ROOFTOP')
    go()
    expect(cs().focus?.named).toBeUndefined()
    expect(viewingLabel(cs().focus, cs().cursor, cs().anchorPlane)).toBe(FREE_VIEW_LABEL)
  })
})

describe('the VIEWING chip (arkinox, 2026-11-03, ruled)', () => {
  const label = (): string | null => viewingLabel(cs().focus, cs().cursor, cs().anchorPlane)

  it('the pad VIEW reads A COORD', () => {
    cs().viewHere()
    expect(label()).toBe(FREE_VIEW_LABEL)
  })

  it('a typed coordinate reads A COORD, not its axes', () => {
    cs().focusOn({ x: 1n, y: 2n, z: 3n }, 0, '1, 2, 3', undefined, true, false)
    expect(label()).toBe(FREE_VIEW_LABEL)
  })

  it('a starred place reads its name, and A COORD once the cursor leaves it', () => {
    viewStarred({ input: placeInput({ x: 4n, y: 5n, z: 6n }), label: '4, 5, 6', plane: 0, at: 1, nickname: 'ROOFTOP' })
    expect(label()).toBe('ROOFTOP')
    cs().moveCursor({ axis: 'x', dir: 1 })
    expect(label()).toBe(FREE_VIEW_LABEL)
  })

  it('a starred place with no name but its axes reads A COORD', () => {
    viewStarred({ input: placeInput({ x: 4n, y: 5n, z: 6n }), label: '4, 5, 6', plane: 0, at: 1 })
    expect(label()).toBe(FREE_VIEW_LABEL)
  })

  it('a person being viewed reads their name', () => {
    cs().focusOn({ x: 7n, y: 8n, z: 9n }, 0, 'ALICE', undefined, true, true)
    expect(label()).toBe('ALICE')
  })

  it('a pin for a place found by name reads the name; a pin for typed numbers reads A COORD', () => {
    cs().dropPin({ x: 7n, y: 8n, z: 9n }, 'PARIS', undefined, true)
    cs().viewPin()
    expect(label()).toBe('PARIS')
    cs().dropPin({ x: 7n, y: 8n, z: 9n }, '48.8566, 2.3522')
    cs().viewPin()
    expect(label()).toBe(FREE_VIEW_LABEL)
  })

  // Review of #591, P1 to P3: the name is the place's, not the view's.
  it('P1: driven 25 cells off a named place, past a re-anchor, the name does not come back', () => {
    viewStarred({ input: placeInput({ x: 4n, y: 5n, z: 6n }), label: '4, 5, 6', plane: 0, at: 1, nickname: 'ROOFTOP' })
    expect(label()).toBe('ROOFTOP')
    const seen: string[] = []
    for (let i = 0; i < 25; i++) { cs().moveCursor({ axis: 'x', dir: 1 }); seen.push(String(label())) }
    // The view re-anchored on the way (rideView moved focus.position to the cursor).
    expect(cs().focus?.position).toEqual(cs().cursor)
    expect(seen.every((l) => l === FREE_VIEW_LABEL)).toBe(true)
    // Back on the place, the name is back.
    for (let i = 0; i < 25; i++) cs().moveCursor({ axis: 'x', dir: -1 })
    expect(label()).toBe('ROOFTOP')
  })

  it('P1, flying: a long fly re-anchors many times and the name never flashes', () => {
    viewStarred({ input: placeInput({ x: 4n, y: 5n, z: 6n }), label: '4, 5, 6', plane: 0, at: 1, nickname: 'ROOFTOP' })
    const plane = cs().anchorPlane
    const seen = new Set<string | null>()
    for (let i = 1; i <= 200; i++) { cs().aimView({ x: 4n + BigInt(i), y: 5n, z: 6n }, plane); seen.add(label()) }
    expect([...seen]).toEqual([FREE_VIEW_LABEL])
  })

  it('P2: turned to the other plane on a named place, it reads A COORD', () => {
    viewStarred({ input: placeInput({ x: 4n, y: 5n, z: 6n }), label: '4, 5, 6', plane: 0, at: 1, nickname: 'ROOFTOP' })
    cs().setPlane(1)
    expect(cs().anchorPlane).toBe(1)
    expect(label()).toBe(FREE_VIEW_LABEL)
    cs().setPlane(0)
    expect(label()).toBe('ROOFTOP')
  })

  it('P3: a pin dropped by clicking Earth reads A COORD', () => {
    cs().dropPin({ x: 7n, y: 8n, z: 9n }, `EARTH · ${formatLatLonDeg(48.8566, 2.3522)}`)
    cs().viewPin()
    expect(label()).toBe(FREE_VIEW_LABEL)
  })

  it('a fixed look still says what it looks at', () => {
    cs().focusOn({ x: 7n, y: 8n, z: 9n }, 0, 'BLOCK 3')
    expect(label()).toBe('BLOCK 3')
  })
})

describe("View's box takes a /C/ region (arkinox, 2026-11-12)", () => {
  const MIDWEST = '56db6db6db6db6db6db6dbad'
  const loc = { pathname: '/', search: '', hash: '' }
  const history = {
    pushState: vi.fn((_d: unknown, _t: string, url: string) => { loc.pathname = url }),
    replaceState: vi.fn((_d: unknown, _t: string, url: string) => { loc.pathname = url }),
  }
  beforeEach(() => {
    cs().clearFocus()
    useCoordRoute.setState({ region: null, label: null })
    useCyberspace.setState({ plane: 0, anchorPlane: 0 })
    loc.pathname = '/'
    history.pushState.mockClear()
    history.replaceState.mockClear()
    vi.mocked(geocode).mockClear()
    ;(globalThis as { window?: unknown }).window = { location: loc, history }
  })
  afterEach(() => {
    cs().clearFocus()
    useCyberspace.setState({ plane: 0, anchorPlane: 0 })
    delete (globalThis as { window?: unknown }).window
  })

  /** Type into the box and press VIEW. */
  async function submit(text: string): Promise<void> {
    useViewDraft.getState().setText(text)
    const form = findAll(tree(ViewAtPanel), (p) => typeof p.onSubmit === 'function')[0]
    expect(form).toBeDefined()
    ;(form.props.onSubmit as (e: { preventDefault: () => void }) => void)({ preventDefault: () => {} })
    await new Promise((r) => setTimeout(r, 0))
  }

  it('the owner\'s prefix opens its region as the link does: the address, the box, dataspace; no place lookup, no reload', async () => {
    useCyberspace.setState({ plane: 1, anchorPlane: 1 })
    await submit(MIDWEST)
    expect(geocode).not.toHaveBeenCalled()
    expect(history.pushState).toHaveBeenCalledWith({ onosendaiCoord: 1 }, '', `/C/${MIDWEST}`)
    expect(useCoordRoute.getState().region?.prefix).toBe(MIDWEST)
    expect(cs().focus?.label).toBe(`C/${MIDWEST}`)
    expect(cs().anchorPlane).toBe(0)
  })

  it('takes C/, /C/ and a whole link too', async () => {
    for (const typed of [`C/${MIDWEST}`, `/C/${MIDWEST}`, `https://www.onosendai.tech/C/${MIDWEST}`]) {
      cs().clearFocus()
      history.pushState.mockClear()
      await submit(typed)
      expect(history.pushState, typed).toHaveBeenCalledWith({ onosendaiCoord: 1 }, '', `/C/${MIDWEST}`)
      expect(useCoordRoute.getState().region?.prefix, typed).toBe(MIDWEST)
    }
  })

  it('a full coordinate is still the point, with no link opened', async () => {
    const full = placeHex({ x: 4n, y: 5n, z: 6n }, 0)
    await submit(full)
    expect(history.pushState).not.toHaveBeenCalled()
    expect(useCoordRoute.getState().region).toBeNull()
    expect(cs().focus?.position).toEqual({ x: 4n, y: 5n, z: 6n })
  })

  it('a link that is not valid hex is refused (No place found) and never sent to the place lookup', async () => {
    for (const typed of ['C/56zz', 'https://www.onosendai.tech/C/zz']) {
      await submit(typed)
      expect(history.pushState, typed).not.toHaveBeenCalled()
      expect(useCoordRoute.getState().region, typed).toBeNull()
      expect(cs().focus, typed).toBeNull()
    }
    expect(geocode).not.toHaveBeenCalled()
  })

  it('a bare number is not a region', async () => {
    await submit('55401')
    expect(history.pushState).not.toHaveBeenCalled()
    expect(useCoordRoute.getState().region).toBeNull()
  })
})
