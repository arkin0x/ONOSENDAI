/**
 * arrivalMode.test.ts - ?mode=view and ?mode=region on arrival
 * (store/arrivalMode.ts, arkinox 2026-11-13):
 *
 * - the flag is read once and taken off the address; an unknown value is
 *   ignored and stays;
 * - a brand-new visitor lands in VIEW at their avatar, or in region mode;
 * - it waits for the identity to be judged, as the tutorial does;
 * - on a /C/ prefix link, region mode starts on that link's region;
 * - the first-arrival tutorial wins: when it starts, the mode is dropped;
 * - applied once per load, and never under TV.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('../../lib/relay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/relay')>()),
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

// Whether the key on screen was made on this page load (a brand-new visitor): the test says.
const minted = vi.hoisted(() => ({ onLoad: true }))
vi.mock('../useCyberspace', async (orig) => {
  const real = await orig<typeof import('../useCyberspace')>()
  return { ...real, keyMintedOnLoad: () => (minted.onLoad ? real.useCyberspace.getState().identity.pubkey : null) }
})

import { MINTED_KEY, samePosition, useCyberspace } from '../useCyberspace'
import { applyArrivalMode, takeArrivalMode, watchArrivalMode } from '../arrivalMode'
import { startCoordRoute, useCoordRoute } from '../useCoordRoute'
import { useRegion } from '../useRegion'
import { useTutorial, watchFirstArrival } from '../useTutorial'
import { useTv } from '../useTv'
import { PROGRESS_PREFIX, TUTORIAL_SWITCH_KEY, noteLanding, setTutorialSwitch, useTutorialSwitch, writeProgress } from '../../tutorial/gate'
import { coveringRegion, prefixRegion } from '../../lib/coordRoute'

const cs = () => useCyberspace.getState()
const region = () => useRegion.getState()
const pubkey = (): string => cs().identity.pubkey
/** The apply waits for the saved chain's read (savedChainLoaded): let it land. */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
/** arkinox's midwest region (2026-11-12): 24 hex. */
const MIDWEST = '56db6db6db6db6db6db6dbad'

function history() {
  const replaced: string[] = []
  return { replaced, h: { state: null, replaceState: (_s: unknown, _t: string, url?: string | URL | null) => { replaced.push(String(url)) } } }
}
/** Land on `pathname` with `search`, as main.tsx does before the first render. */
function land(pathname: string, search: string): string[] {
  noteLanding(pathname)
  const { replaced, h } = history()
  takeArrivalMode({ pathname, search, hash: '' }, h)
  return replaced
}

beforeEach(() => {
  takeArrivalMode({ pathname: '/', search: '', hash: '' }, history().h)
  minted.onLoad = true
  region().exit()
  cs().clearFocus()
  useCyberspace.setState({ scaleExp: 4, plane: 0, anchorPlane: 0, events: [], signerKind: 'local', selfCheck: { pubkey: pubkey(), status: 'none' } })
  useCoordRoute.setState({ region: null, label: null })
  if (useTutorial.getState().active) useTutorial.getState().pause()
  localStorage.removeItem(TUTORIAL_SWITCH_KEY)
  useTutorialSwitch.setState({ value: null })
  localStorage.removeItem(PROGRESS_PREFIX + pubkey())
  localStorage.setItem(MINTED_KEY, pubkey())
  useTv.setState({ on: false })
})
afterEach(() => {
  if (useTutorial.getState().active) useTutorial.getState().pause()
  region().exit()
  cs().clearFocus()
  useTv.setState({ on: false })
})

describe('the flag on the address', () => {
  it('reads view and region, any case, and takes the flag off the address, keeping the rest', () => {
    const { replaced, h } = history()
    expect(takeArrivalMode({ pathname: '/', search: '?mode=view', hash: '' }, h)).toBe('view')
    expect(replaced.pop()).toBe('/')
    expect(takeArrivalMode({ pathname: '/C/abc', search: '?x=1&mode=REGION', hash: '#h' }, h)).toBe('region')
    expect(replaced.pop()).toBe('/C/abc?x=1#h')
  })

  it('ignores an unknown value or no flag, and leaves the address alone', () => {
    const { replaced, h } = history()
    expect(takeArrivalMode({ pathname: '/', search: '?mode=build', hash: '' }, h)).toBe(null)
    expect(takeArrivalMode({ pathname: '/', search: '?mode=', hash: '' }, h)).toBe(null)
    expect(takeArrivalMode({ pathname: '/', search: '?x=1', hash: '' }, h)).toBe(null)
    expect(replaced).toEqual([])
  })

  it('an unknown value applies nothing', async () => {
    land('/', '?mode=walk')
    const stop = watchArrivalMode()
    await flush()
    expect(cs().viewing()).toBe(false)
    stop()
  })
})

describe('a brand-new visitor on the bare address', () => {
  it('?mode=view opens VIEW at their avatar, as the mode button does', async () => {
    land('/', '?mode=view')
    const stop = watchArrivalMode()
    await flush()
    expect(cs().viewing()).toBe(true)
    expect(samePosition(cs().cursor, cs().position)).toBe(true)
    expect(region().active).toBe(false)
    stop()
  })

  it('?mode=region opens VIEW and region mode round the avatar\'s cell, as the Region button does', async () => {
    land('/', '?mode=region')
    const stop = watchArrivalMode()
    await flush()
    expect(cs().viewing()).toBe(true)
    expect(region().active).toBe(true)
    expect(region().prefix).toBe(coveringRegion([cs().position], cs().scaleExp, cs().anchorPlane)!.prefix)
    stop()
  })

  it('waits until the identity can be judged, then applies', async () => {
    minted.onLoad = false
    useCyberspace.setState({ selfCheck: { pubkey: pubkey(), status: 'checking' } })
    land('/', '?mode=view')
    const stop = watchArrivalMode()
    await flush()
    expect(cs().viewing()).toBe(false)
    useCyberspace.setState({ selfCheck: { pubkey: pubkey(), status: 'none' } })
    await flush()
    expect(cs().viewing()).toBe(true)
    stop()
  })

  it('applies once per load: a later watch (a remount) does nothing', async () => {
    land('/', '?mode=view')
    let stop = watchArrivalMode()
    await flush()
    expect(cs().viewing()).toBe(true)
    stop()
    cs().clearFocus()
    stop = watchArrivalMode()
    await flush()
    expect(cs().viewing()).toBe(false)
    stop()
  })

  it('a watch stopped before the apply leaves the mode for the next (StrictMode remount)', async () => {
    land('/', '?mode=view')
    watchArrivalMode()()
    const stop = watchArrivalMode()
    await flush()
    expect(cs().viewing()).toBe(true)
    stop()
  })

  it('nothing under Cyberspace TV', async () => {
    useTv.setState({ on: true })
    land('/', '?mode=region')
    const stop = watchArrivalMode()
    await flush()
    expect(cs().viewing()).toBe(false)
    expect(region().active).toBe(false)
    stop()
  })
})

describe('on a /C/ link', () => {
  it('?mode=region turns region mode on over the prefix link\'s own region, and it never shrinks inside it', async () => {
    land(`/C/${MIDWEST}`, '?mode=region')
    const route = startCoordRoute({ pathname: `/C/${MIDWEST}`, search: '', hash: '' }, { replaceState: vi.fn() })
    expect(cs().viewing()).toBe(true)
    const stop = watchArrivalMode()
    await flush()
    expect(region().active).toBe(true)
    expect(region().prefix).toBe(MIDWEST)
    // The link's view is still the one up.
    expect(cs().focus?.label).toBe(`C/${MIDWEST}`)
    // A step of the cursor inside the box keeps the link's region (or a coarser one), never a smaller one.
    const right = cs().axes().right
    cs().moveCursor({ axis: right.axis, dir: right.dir as 1 | -1 })
    expect(MIDWEST.startsWith(region().prefix!)).toBe(true)
    // X: back to the link's region.
    region().collapseToEntry()
    expect(region().prefix).toBe(MIDWEST)
    stop()
    route()
  })

  it('?mode=view keeps the link\'s view, which is already a VIEW', async () => {
    land(`/C/${MIDWEST}`, '?mode=view')
    const route = startCoordRoute({ pathname: `/C/${MIDWEST}`, search: '', hash: '' }, { replaceState: vi.fn() })
    const stop = watchArrivalMode()
    await flush()
    expect(cs().viewing()).toBe(true)
    expect(cs().focus?.label).toBe(`C/${MIDWEST}`)
    expect(region().active).toBe(false)
    stop()
    route()
  })

  it('seeds nothing from a link whose view is no longer the one up', () => {
    // The route still names the region, but the view on screen is your own VIEW.
    useCoordRoute.setState({ region: { ...prefixRegion(MIDWEST), prefix: MIDWEST }, label: `C/${MIDWEST}` })
    expect(applyArrivalMode('region')).toBe(true)
    expect(region().prefix).not.toBe(MIDWEST)
  })
})

describe('the first-arrival tutorial wins', () => {
  it('drops the mode when the tutorial starts on this load, whichever watch decides first', async () => {
    setTutorialSwitch(true)
    land('/', '?mode=region')
    const stopMode = watchArrivalMode()
    const stopTutorial = watchFirstArrival()
    await flush()
    expect(useTutorial.getState().active).toBe(true)
    expect(cs().viewing()).toBe(false)
    expect(region().active).toBe(false)
    stopMode(); stopTutorial()
  })

  it('drops it when the tutorial is already running', async () => {
    setTutorialSwitch(true)
    land('/', '?mode=view')
    const stopTutorial = watchFirstArrival()
    await flush()
    expect(useTutorial.getState().active).toBe(true)
    const stopMode = watchArrivalMode()
    await flush()
    expect(cs().viewing()).toBe(false)
    stopMode(); stopTutorial()
  })

  it('applies when the tutorial will not run (it ended for this player)', async () => {
    setTutorialSwitch(true)
    writeProgress(pubkey(), { step: 'welcome', ended: 'skipped' })
    land('/', '?mode=view')
    const stopTutorial = watchFirstArrival()
    const stopMode = watchArrivalMode()
    await flush()
    expect(useTutorial.getState().active).toBe(false)
    expect(cs().viewing()).toBe(true)
    stopMode(); stopTutorial()
  })
})
