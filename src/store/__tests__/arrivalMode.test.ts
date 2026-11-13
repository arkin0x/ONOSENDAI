/**
 * arrivalMode.test.ts - ?mode=view and ?mode=region on arrival
 * (store/arrivalMode.ts, arkinox 2026-11-13):
 *
 * - the flag is read once and taken off the address; an unknown value is
 *   ignored and stays;
 * - a brand-new visitor lands in VIEW at their avatar, or in region mode;
 * - it waits for the identity to be judged only when /tutorial also asked;
 * - on a /C/ prefix link, region mode starts on that link's region;
 * - the mode wins over the first-arrival tutorial (owner, 2026-11-13): the
 *   tutorial neither starts nor resumes on that load, and its progress is
 *   left as it was; a run already going, or /tutorial, still wins;
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
import { isNewArrival, useTutorial, watchFirstArrival } from '../useTutorial'
import { useTv } from '../useTv'
import { PROGRESS_PREFIX, TUTORIAL_SWITCH_KEY, applyTutorialRoute, arrivalModeAsked, noteLanding, readProgress, setTutorialSwitch, takeTutorialAsk, useTutorialSwitch, writeProgress } from '../../tutorial/gate'
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
  takeTutorialAsk()
  minted.onLoad = true
  region().exit()
  cs().clearFocus()
  useCyberspace.setState({ scaleExp: 4, plane: 0, anchorPlane: 0, events: [], signerKind: 'local', selfCheck: { pubkey: pubkey(), status: 'none' } })
  useCoordRoute.setState({ region: null, label: null })
  if (useTutorial.getState().active) useTutorial.getState().pause()
  // Off unless a test turns it on (setTutorialSwitch(true)): these are about
  // the mode. The default since 2026-11-13 is on, covered below.
  localStorage.setItem(TUTORIAL_SWITCH_KEY, 'off')
  useTutorialSwitch.setState({ value: false })
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
  it('with no tutorial switch set (on by default, 2026-11-13), the mode wins: region mode, no tutorial, its progress untouched (owner, 2026-11-13)', async () => {
    localStorage.removeItem(TUTORIAL_SWITCH_KEY)
    useTutorialSwitch.setState({ value: null })
    expect(isNewArrival()).toBe(true)
    land('/', '?mode=region')
    expect(arrivalModeAsked()).toBe(true)
    const stopTutorial = watchFirstArrival()
    const stop = watchArrivalMode()
    await flush()
    expect(useTutorial.getState().active).toBe(false)
    expect(cs().viewing()).toBe(true)
    expect(region().active).toBe(true)
    // Nothing marked skipped or ended: no progress at all.
    expect(readProgress(pubkey())).toBe(null)
    stop()
    stopTutorial()
  })

  it('a later plain load still starts the tutorial for a visitor who is still new', async () => {
    localStorage.removeItem(TUTORIAL_SWITCH_KEY)
    useTutorialSwitch.setState({ value: null })
    land('/', '?mode=view')
    let stopTutorial = watchFirstArrival()
    let stop = watchArrivalMode()
    await flush()
    expect(useTutorial.getState().active).toBe(false)
    stop(); stopTutorial()
    // A reload on the bare address, with no mode.
    region().exit()
    cs().clearFocus()
    land('/', '')
    expect(arrivalModeAsked()).toBe(false)
    stopTutorial = watchFirstArrival()
    stop = watchArrivalMode()
    await flush()
    expect(useTutorial.getState().active).toBe(true)
    stop(); stopTutorial()
  })

  it('a run left unfinished does not resume over the mode, and stays as it was for the next load', async () => {
    setTutorialSwitch(true)
    writeProgress(pubkey(), { step: 'box' })
    land('/', '?mode=view')
    const stopTutorial = watchFirstArrival()
    const stop = watchArrivalMode()
    await flush()
    expect(useTutorial.getState().active).toBe(false)
    expect(cs().viewing()).toBe(true)
    expect(readProgress(pubkey())).toEqual({ step: 'box' })
    stop(); stopTutorial()
  })

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

  it('with the tutorial on, does not wait on the relays: the tutorial will not start by itself on this load', async () => {
    setTutorialSwitch(true)
    writeProgress(pubkey(), { step: 'welcome', ended: 'skipped' })
    minted.onLoad = false
    useCyberspace.setState({ selfCheck: { pubkey: pubkey(), status: 'checking' } })
    land('/', '?mode=view')
    const stop = watchArrivalMode()
    await flush()
    expect(cs().viewing()).toBe(true)
    stop()
  })

  it('with the tutorial switch off, never waits on the relays (a key from an earlier load, offline)', async () => {
    minted.onLoad = false
    useCyberspace.setState({ selfCheck: { pubkey: pubkey(), status: 'unknown', cause: { kind: 'offline' } } })
    land('/', '?mode=view')
    const stop = watchArrivalMode()
    await flush()
    expect(cs().viewing()).toBe(true)
    stop()
  })

  it('is dropped when the visitor has already moved the cursor off their avatar', async () => {
    land('/', '?mode=view')
    const stop = watchArrivalMode()
    const right = cs().axes().right
    cs().moveCursor({ axis: right.axis, dir: right.dir as 1 | -1 })
    const aimed = { ...cs().cursor }
    await flush()
    expect(cs().viewing()).toBe(false)
    expect(samePosition(cs().cursor, aimed)).toBe(true)
    // Dropped, not postponed.
    cs().cancel()
    const again = watchArrivalMode()
    await flush()
    expect(cs().viewing()).toBe(false)
    stop(); again()
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
    // Zoom out: coarser cells, a coarser region; back in, the link's again; RESET too.
    const scale = cs().scaleExp
    useCyberspace.setState({ scaleExp: scale + 12 })
    expect(region().prefix!.length).toBeLessThan(MIDWEST.length)
    expect(MIDWEST.startsWith(region().prefix!)).toBe(true)
    useCyberspace.setState({ scaleExp: scale })
    expect(region().prefix).toBe(MIDWEST)
    useCyberspace.setState({ scaleExp: scale + 12 })
    region().resetSize()
    expect(region().prefix).toBe(MIDWEST)
    stop()
    route()
  })

  it('?mode=region on a full coordinate link: region mode round that place\'s cell', async () => {
    const FULL = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9f'
    land(`/C/${FULL}`, '?mode=region')
    const route = startCoordRoute({ pathname: `/C/${FULL}`, search: '', hash: '' }, { replaceState: vi.fn() })
    const label = cs().focus?.label
    const stop = watchArrivalMode()
    await flush()
    expect(region().active).toBe(true)
    expect(cs().focus?.label).toBe(label)
    expect(region().prefix).toBe(coveringRegion([cs().cursor], cs().scaleExp, cs().anchorPlane)!.prefix)
    stop()
    route()
  })

  it('?mode=region on a link that is not a coordinate: VIEW and region mode at the avatar', async () => {
    land('/C/nothex', '?mode=region')
    const replaceState = vi.fn()
    startCoordRoute({ pathname: '/C/nothex', search: '', hash: '' }, { replaceState })
    expect(replaceState).toHaveBeenCalled()
    expect(cs().viewing()).toBe(false)
    const stop = watchArrivalMode()
    await flush()
    expect(cs().viewing()).toBe(true)
    expect(region().active).toBe(true)
    expect(samePosition(cs().cursor, cs().position)).toBe(true)
    stop()
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

describe('the mode and the tutorial (owner, 2026-11-13: the mode wins over a first arrival)', () => {
  it('a brand-new visitor on /?mode=region gets region mode and no tutorial, whichever watch decides first', async () => {
    setTutorialSwitch(true)
    land('/', '?mode=region')
    const stopMode = watchArrivalMode()
    const stopTutorial = watchFirstArrival()
    await flush()
    expect(useTutorial.getState().active).toBe(false)
    expect(cs().viewing()).toBe(true)
    expect(region().active).toBe(true)
    expect(readProgress(pubkey())).toBe(null)
    stopMode(); stopTutorial()
  })

  it('the same with the tutorial\'s watch made first', async () => {
    setTutorialSwitch(true)
    land('/', '?mode=view')
    const stopTutorial = watchFirstArrival()
    const stopMode = watchArrivalMode()
    await flush()
    expect(useTutorial.getState().active).toBe(false)
    expect(cs().viewing()).toBe(true)
    stopMode(); stopTutorial()
  })

  it('a run already going still wins: the mode is dropped, never applied after', async () => {
    setTutorialSwitch(true)
    land('/', '?mode=view')
    useTutorial.getState().start()
    expect(useTutorial.getState().active).toBe(true)
    const stopMode = watchArrivalMode()
    await flush()
    expect(useTutorial.getState().active).toBe(true)
    expect(cs().viewing()).toBe(false)
    stopMode()
  })

  it('/tutorial wins over a mode on the same address: once the identity is judged the run starts and the mode is dropped', async () => {
    minted.onLoad = false
    useCyberspace.setState({ selfCheck: { pubkey: pubkey(), status: 'checking' } })
    noteLanding('/tutorial')
    applyTutorialRoute({ pathname: '/tutorial', search: '?mode=region', hash: '' }, history().h)
    const { h } = history()
    takeArrivalMode({ pathname: '/', search: '?mode=region', hash: '' }, h)
    const stopMode = watchArrivalMode()
    const stopTutorial = watchFirstArrival()
    await flush()
    expect(cs().viewing()).toBe(false)
    useCyberspace.setState({ selfCheck: { pubkey: pubkey(), status: 'none' } })
    await flush()
    expect(useTutorial.getState().active).toBe(true)
    expect(cs().viewing()).toBe(false)
    expect(region().active).toBe(false)
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
