/**
 * workshopRoute.test.ts: onosendai.tech/workshop opens the workshop the
 * menu opens, a first visit with no models included; closing it puts the
 * address back to the root and keeps the query; Back and Forward follow the
 * address; and Vercel serves the route its own page.
 */
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { newShard, type ShardModel } from 'sno-core/shards'
import { EMPTY_TREE } from '../shardFolders'
import { useShardFolders } from '../../store/useShardFolders'
import { useWorkshop } from '../../store/useWorkshop'
import { isWorkshopPath, startWorkshopRoute } from '../workshopRoute'

const w = () => useWorkshop.getState()

/** A stand-in for window: a location the test moves, a history that records, and popstate. */
function page(pathname: string, search = '', hash = '') {
  const loc = { pathname, search, hash }
  const replaceState = vi.fn((_s: unknown, _t: string, url: string) => {
    const u = new URL(url, 'https://onosendai.tech')
    loc.pathname = u.pathname; loc.search = u.search; loc.hash = u.hash
  })
  const target = new EventTarget()
  const events = {
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
  } as unknown as Pick<Window, 'addEventListener' | 'removeEventListener'>
  const stop = startWorkshopRoute(loc, { replaceState }, events)
  const pop = (to: string): void => { loc.pathname = to; target.dispatchEvent(new Event('popstate')) }
  return { loc, replaceState, stop, pop }
}

beforeEach(() => {
  useShardFolders.setState({ tree: EMPTY_TREE, storage: 'loading' })
  useWorkshop.setState({ shards: [], currentId: null, open: false, selection: [], partSel: [], selectedFace: null, facePick: [], past: [], future: [], aim: null, notice: null })
})

describe('isWorkshopPath', () => {
  it('is /workshop, with or without the slash, in any case, and nothing else', () => {
    for (const p of ['/workshop', '/workshop/', '/WORKSHOP', '/Workshop']) expect(isWorkshopPath(p)).toBe(true)
    for (const p of ['/', '/workshops', '/workshop/x', '/tv', '/demo', '/c/workshop', '/workshop//']) expect(isWorkshopPath(p)).toBe(false)
  })
})

describe('the model a link opens, deploys counted (useWorkshop newestId)', () => {
  const at = (id: string, updatedAt: number): ShardModel => ({ ...newShard(id), id, updatedAt })
  const read = (used: Record<string, number>): void => useShardFolders.setState({ tree: { ...EMPTY_TREE, used }, storage: 'indexeddb' })

  it('is the newest by deploy once the deploy times are read, when they already are', () => {
    useWorkshop.setState({ shards: [at('lamp', 3_000), at('chair', 1_000)] })
    read({ chair: 5_000 })
    const { stop } = page('/workshop')
    expect(w().currentId).toBe('chair')
    stop()
  })

  it('opens at once by edit time while they are read, then moves to the newest by deploy', () => {
    useWorkshop.setState({ shards: [at('lamp', 3_000), at('chair', 1_000)] })
    const { stop } = page('/workshop')
    expect(w().open).toBe(true)
    expect(w().currentId).toBe('lamp')
    read({ chair: 5_000 })
    expect(w().currentId).toBe('chair')
    stop()
  })

  it('stays where it is when something was done meanwhile: an edit, or the workshop closed', () => {
    useWorkshop.setState({ shards: [at('lamp', 3_000), at('chair', 1_000)] })
    const edited = page('/workshop')
    useWorkshop.setState({ past: [at('lamp', 3_000)] })
    read({ chair: 5_000 })
    expect(w().currentId).toBe('lamp')
    edited.stop()

    useShardFolders.setState({ tree: EMPTY_TREE, storage: 'loading' })
    useWorkshop.setState({ currentId: null, open: false, past: [] })
    const closed = page('/workshop')
    w().closeWorkshop()
    read({ chair: 5_000 })
    expect(w().currentId).toBe('lamp')
    closed.stop()
  })

  it('stays on another model chosen meanwhile', () => {
    useWorkshop.setState({ shards: [at('lamp', 3_000), at('chair', 1_000), at('pot', 500)] })
    const { stop } = page('/workshop')
    expect(w().currentId).toBe('lamp')
    w().select('pot')
    read({ chair: 5_000 })
    expect(w().currentId).toBe('pot')
    stop()
  })
})

describe('startWorkshopRoute', () => {
  it('does nothing away from /workshop', () => {
    const { replaceState, stop } = page('/')
    expect(w().open).toBe(false)
    expect(replaceState).not.toHaveBeenCalled()
    stop()
  })

  it('a first visit with no models opens the workshop on a new one, as OPEN WORKSHOP does', () => {
    const { replaceState, stop } = page('/workshop')
    expect(w().open).toBe(true)
    expect(w().shards).toHaveLength(1)
    expect(w().current()?.id).toBe(w().shards[0].id)
    expect(w().tool).toBe('view')
    // The address stays shareable while it is open.
    expect(replaceState).not.toHaveBeenCalled()
    stop()
  })

  it('opens on the newest model when there are some, and makes no new one', () => {
    const a = w().create('a')
    const b = w().create('b')
    // a made first but edited last: newest is the last edited, as the menu's.
    useWorkshop.setState({ currentId: null, shards: w().shards.map((s) => ({ ...s, updatedAt: s.id === a ? 2_000 : 1_000 })) })
    const { stop } = page('/workshop/')
    expect(w().open).toBe(true)
    expect(w().shards.map((s) => s.id)).toEqual([a, b])
    expect(w().currentId).toBe(a)
    stop()
  })

  it('closing it puts the address back to the root and keeps the query and the fragment', () => {
    const { loc, replaceState, stop } = page('/workshop', '?from=stream', '#x')
    w().closeWorkshop()
    expect(replaceState).toHaveBeenCalledTimes(1)
    expect(replaceState).toHaveBeenLastCalledWith(null, '', '/?from=stream#x')
    expect(loc.pathname).toBe('/')
    // Opened again from the menu, the address is not the workshop's to change.
    w().openWorkshop()
    w().closeWorkshop()
    expect(replaceState).toHaveBeenCalledTimes(1)
    stop()
  })

  it('a workshop opened from the menu leaves the address alone', () => {
    const { replaceState, stop } = page('/', '?a=1')
    w().openWorkshop()
    w().closeWorkshop()
    expect(replaceState).not.toHaveBeenCalled()
    stop()
  })

  it('Back off /workshop closes it, Forward onto /workshop opens it', () => {
    const { pop, replaceState, stop } = page('/workshop')
    pop('/')
    expect(w().open).toBe(false)
    // Already off the route: nothing to put back.
    expect(replaceState).not.toHaveBeenCalled()
    pop('/workshop')
    expect(w().open).toBe(true)
    stop()
  })

  it('Back between other addresses never closes a workshop the menu opened', () => {
    const { pop, stop } = page('/')
    w().openWorkshop()
    pop('/demo')
    expect(w().open).toBe(true)
    stop()
  })

  it('closed from the link, a workshop the menu opens later is not Back\'s to close (review of #445)', () => {
    const { loc, pop, stop } = page('/workshop', '?from=stream')
    w().closeWorkshop()
    // The tour pushes /demo (a push fires no popstate); the workshop is opened from the menu there.
    loc.pathname = '/demo'
    w().openWorkshop()
    pop('/')
    expect(w().open).toBe(true)
    stop()
  })

  it('stops following the address once stopped', () => {
    const { pop, replaceState, stop } = page('/workshop')
    stop()
    pop('/')
    expect(w().open).toBe(true)
    w().closeWorkshop()
    expect(replaceState).not.toHaveBeenCalled()
  })
})

describe('vercel.json', () => {
  it('serves /workshop its own page, the one the build writes (vite.config.ts routeCards)', () => {
    const { rewrites } = JSON.parse(readFileSync(new URL('../../../vercel.json', import.meta.url), 'utf8')) as { rewrites: Array<{ source: string; destination: string }> }
    for (const source of ['/workshop', '/workshop/', '/WORKSHOP', '/Workshop']) {
      expect(rewrites.find((r) => r.source === source)?.destination).toBe('/workshop.html')
    }
  })
})
