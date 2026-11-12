/**
 * coordRoute.test.ts - opening /C/<hex>: a full coordinate becomes a free
 * view of the place, a prefix becomes the yellow region and a view framing
 * it, nonsense becomes a toast, and ending the view puts the address back.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const m = new Map<string, string>()
  ;(globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
  }
})

import { useCyberspace } from '../useCyberspace'
import { openCoordLink, startCoordRoute, useCoordRoute, watchCoordRouteHistory } from '../useCoordRoute'
import { useToast } from '../useToast'
import { useRegion } from '../useRegion'
import { recall } from '../padMode'
import { coordPlace, prefixRegion } from '../../lib/coordRoute'
import { FREE_VIEW_LABEL, viewingLabel } from '../../hud/FocusBar'

const FULL = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9f'
/** The same place in dataspace: the low bit, the plane bit, is 0. */
const FULL_DATA = FULL.slice(0, 63) + 'e'
/** arkinox's midwest region (2026-11-12): 24 hex, so no plane bit. */
const MIDWEST = '56db6db6db6db6db6db6dbad'

/**
 * A browser's session history for one tab: entries with their state, Back
 * and Forward firing popstate, and watchCoordRouteHistory listening to it.
 */
function fakeBrowser(start: string) {
  const entries: Array<{ path: string; state: unknown }> = [{ path: start, state: null }]
  let i = 0
  const loc = { pathname: start, search: '', hash: '' }
  const listeners = new Set<() => void>()
  const go = (to: number): void => { i = to; loc.pathname = entries[i].path; for (const l of [...listeners]) l() }
  const history = {
    get state() { return entries[i].state },
    pushState: vi.fn((state: unknown, _t: string, url: string) => { entries.splice(i + 1); entries.push({ path: url, state }); i++; loc.pathname = url }),
    replaceState: vi.fn((state: unknown, _t: string, url: string) => { entries[i] = { path: url, state }; loc.pathname = url }),
    back: vi.fn(() => { if (i > 0) go(i - 1) }),
    forward: () => { if (i < entries.length - 1) go(i + 1) },
  }
  const events = {
    addEventListener: (_t: string, l: () => void) => { listeners.add(l) },
    removeEventListener: (_t: string, l: () => void) => { listeners.delete(l) },
  }
  const unwatch = watchCoordRouteHistory(events as never, loc, history)
  return { loc, history, unwatch, entries: () => entries.map((e) => e.path), index: () => i }
}

/** Stand in ideaspace at your head, as a visitor might before opening a link. */
function standInIdeaspace(): void {
  useCyberspace.setState({ plane: 1, anchorPlane: 1 })
}

function open(pathname: string) {
  const replaceState = vi.fn()
  const stop = startCoordRoute({ pathname, search: '', hash: '' }, { replaceState })
  return { replaceState, stop }
}

beforeEach(() => {
  useRegion.getState().exit()
  useCyberspace.getState().clearFocus()
  useCyberspace.setState({ plane: 0, anchorPlane: 0 })
  useCoordRoute.setState({ region: null, label: null })
  useToast.getState().dismiss()
})

describe('startCoordRoute', () => {
  it('does nothing away from /C/', () => {
    const { replaceState } = open('/')
    expect(useCyberspace.getState().focus).toBeNull()
    expect(replaceState).not.toHaveBeenCalled()
  })

  it('a full coordinate opens a free view there, in its own plane, and the scan follows the anchor', () => {
    const { stop } = open(`/C/${FULL}`)
    const s = useCyberspace.getState()
    const want = coordPlace(FULL)
    expect(s.focus?.position).toEqual(want.position)
    expect(s.focus?.plane).toBe(1)
    expect(s.focus?.drive).toBe(true)
    // useDiscovery scans wherever the anchor is.
    expect(s.anchor).toEqual(want.position)
    expect(s.anchorPlane).toBe(1)
    expect(s.atHead()).toBe(false)
    stop()
  })

  it('a prefix draws its region and frames the middle of it', () => {
    const { stop } = open('/C/f0')
    const r = useCoordRoute.getState().region
    expect(r?.prefix).toBe('f0')
    const want = prefixRegion('f0')
    expect(useCyberspace.getState().focus?.position).toEqual(want.center)
    expect(useCyberspace.getState().scaleExp).toBe(want.maxHeight - 3)
    stop()
  })

  it('a prefix opens in dataspace, whatever plane you were in: it never reaches the plane bit', () => {
    standInIdeaspace()
    const { stop, replaceState } = open(`/C/${MIDWEST}`)
    const s = useCyberspace.getState()
    expect(s.focus?.plane).toBe(0)
    expect(s.anchorPlane).toBe(0)
    expect(s.viewing()).toBe(true)
    expect(s.focus?.position).toEqual(prefixRegion(MIDWEST).center)
    expect(useCoordRoute.getState().region?.prefix).toBe(MIDWEST)
    expect(replaceState).not.toHaveBeenCalled()
    stop()
  })

  it('a full coordinate keeps its own plane, dataspace or ideaspace, wherever you stand', () => {
    standInIdeaspace()
    let r = open(`/C/${FULL_DATA}`)
    expect(useCyberspace.getState().focus?.plane).toBe(0)
    r.stop()
    useCyberspace.getState().clearFocus()
    useCyberspace.setState({ plane: 0, anchorPlane: 0 })
    r = open(`/C/${FULL}`)
    expect(useCyberspace.getState().focus?.plane).toBe(1)
    r.stop()
  })

  it('a plane switch keeps the region, the link and the address, re-framed on the other plane', () => {
    const { stop, replaceState } = open(`/C/${MIDWEST}`)
    const label = useCoordRoute.getState().label
    const before = useCyberspace.getState().focus!
    useCyberspace.getState().togglePlane()
    let s = useCyberspace.getState()
    expect(s.anchorPlane).toBe(1)
    expect(s.focus?.plane).toBe(1)
    expect(s.focus?.label).toBe(label)
    expect(s.focus?.position).toEqual(before.position)
    expect(s.viewing()).toBe(true)
    expect(useCoordRoute.getState().label).toBe(label)
    expect(useCoordRoute.getState().region?.prefix).toBe(MIDWEST)
    expect(replaceState).not.toHaveBeenCalled()
    // The VIEWING chip keeps the link's name: the prefix names both planes.
    expect(viewingLabel(s.focus, s.cursor, s.anchorPlane)).toBe(label)
    // And back again.
    useCyberspace.getState().togglePlane()
    s = useCyberspace.getState()
    expect(s.anchorPlane).toBe(0)
    expect(useCoordRoute.getState().region?.prefix).toBe(MIDWEST)
    expect(replaceState).not.toHaveBeenCalled()
    stop()
  })

  it('a full coordinate is one place in one plane: turned to the other, VIEWING reads A COORD (2026-11-03 rule)', () => {
    const { stop } = open(`/C/${FULL}`)
    let s = useCyberspace.getState()
    expect(viewingLabel(s.focus, s.cursor, s.anchorPlane)).toBe(useCoordRoute.getState().label)
    s.togglePlane()
    s = useCyberspace.getState()
    expect(viewingLabel(s.focus, s.cursor, s.anchorPlane)).toBe(FREE_VIEW_LABEL)
    stop()
  })

  it('region mode entered on a link lasts through a plane switch with the link', () => {
    const { stop, replaceState } = open(`/C/${MIDWEST}`)
    useRegion.getState().enter()
    const prefix = useRegion.getState().prefix
    expect(useRegion.getState().active).toBe(true)
    useCyberspace.getState().togglePlane()
    expect(useRegion.getState().active).toBe(true)
    expect(useRegion.getState().prefix).toBe(prefix)
    expect(useCoordRoute.getState().region?.prefix).toBe(MIDWEST)
    expect(replaceState).not.toHaveBeenCalled()
    stop()
  })

  it('RECALL after a plane switch still ends the link, its region and the address', () => {
    const { replaceState } = open(`/C/${MIDWEST}`)
    useCyberspace.getState().togglePlane()
    recall()
    expect(useCoordRoute.getState().region).toBeNull()
    expect(useCoordRoute.getState().label).toBeNull()
    expect(replaceState).toHaveBeenCalledWith(null, '', '/')
  })

  it('another view replacing the link after a plane switch still ends it', () => {
    const { replaceState } = open(`/C/${MIDWEST}`)
    useCyberspace.getState().togglePlane()
    useCyberspace.getState().viewAt({ x: 1n, y: 2n, z: 3n }, 0, 'ELSEWHERE')
    expect(useCoordRoute.getState().region).toBeNull()
    expect(replaceState).toHaveBeenCalledWith(null, '', '/')
  })

  it('openCoordLink (the View box): the address becomes the link on a marked entry, no reload, the region in dataspace', () => {
    standInIdeaspace()
    const b = fakeBrowser('/')
    openCoordLink(MIDWEST, b.loc, b.history)
    expect(b.history.pushState).toHaveBeenCalledTimes(1)
    expect(b.entries()).toEqual(['/', `/C/${MIDWEST}`])
    expect(b.history.state).toEqual({ onosendaiCoord: 1 })
    expect(useCoordRoute.getState().region?.prefix).toBe(MIDWEST)
    expect(useCyberspace.getState().focus?.label).toBe(`C/${MIDWEST}`)
    expect(useCyberspace.getState().anchorPlane).toBe(0)
    b.unwatch()
  })

  it('a link typed over a link takes its entry; ending the view steps Back off it, leaving no dead entry', () => {
    const b = fakeBrowser('/')
    openCoordLink(MIDWEST, b.loc, b.history)
    openCoordLink('f0', b.loc, b.history)
    openCoordLink('f0', b.loc, b.history)
    expect(b.entries()).toEqual(['/', '/C/f0'])
    expect(useCoordRoute.getState().region?.prefix).toBe('f0')
    // RECALL home: the view ends, the address steps Back to /.
    recall()
    expect(useCoordRoute.getState().region).toBeNull()
    expect(b.history.back).toHaveBeenCalledTimes(1)
    expect(b.loc.pathname).toBe('/')
    expect(b.index()).toBe(0)
    b.unwatch()
  })

  it('a link typed over the address the page loaded on keeps it unmarked, so its end puts back the root and never leaves the site', () => {
    const b = fakeBrowser(`/C/${MIDWEST}`)
    startCoordRoute(b.loc, b.history)
    openCoordLink('f0', b.loc, b.history)
    expect(b.entries()).toEqual(['/C/f0'])
    useCyberspace.getState().clearFocus()
    expect(b.history.back).not.toHaveBeenCalled()
    expect(b.entries()).toEqual(['/'])
    expect(useCoordRoute.getState().region).toBeNull()
    b.unwatch()
  })

  it('Back off a typed link closes its view; Forward onto it opens it again', () => {
    const b = fakeBrowser('/')
    openCoordLink(MIDWEST, b.loc, b.history)
    b.history.back()
    expect(b.loc.pathname).toBe('/')
    expect(useCoordRoute.getState().region).toBeNull()
    expect(useCyberspace.getState().focus).toBeNull()
    b.history.forward()
    expect(b.loc.pathname).toBe(`/C/${MIDWEST}`)
    expect(useCoordRoute.getState().region?.prefix).toBe(MIDWEST)
    expect(useCyberspace.getState().focus?.label).toBe(`C/${MIDWEST}`)
    b.unwatch()
  })

  it('nonsense says so and puts the address back', () => {
    const { replaceState } = open('/C/nothex')
    expect(useToast.getState().toast?.label).toBe('Not a coordinate')
    expect(replaceState).toHaveBeenCalledWith(null, '', '/')
    expect(useCyberspace.getState().focus).toBeNull()
  })

  it('ending the view clears the region and the address', () => {
    const { replaceState } = open('/C/f0')
    useCyberspace.getState().clearFocus()
    expect(useCoordRoute.getState().region).toBeNull()
    expect(replaceState).toHaveBeenCalledWith(null, '', '/')
  })
})
