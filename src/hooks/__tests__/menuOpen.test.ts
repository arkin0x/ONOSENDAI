/**
 * The menu keeps open or closed across a refresh (arkinox, 2026-11-09:
 * "Settings menu panel reopens when I had it closed on refresh. it should
 * stay closed"). A page load is a fresh copy of the hook over the same
 * storage. The tests run without a DOM, so React's three hooks are stood in
 * for by a harness that renders once per call and runs an effect when its
 * dependency changed, the way React does; the hook's own logic is what runs.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mem = new Map<string, string>()
const working = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, String(v)) },
  removeItem: (k: string) => { mem.delete(k) },
  clear: () => { mem.clear() },
}
const broken = {
  getItem: () => { throw new Error('SecurityError: storage is disabled') },
  setItem: () => { throw new Error('QuotaExceededError') },
  removeItem: () => { throw new Error('SecurityError') },
  clear: () => { throw new Error('SecurityError') },
}
const g = globalThis as { localStorage?: unknown }

// One mounted component's hook slots, in call order.
let slots: unknown[] = []
let at = 0
vi.mock('react', () => ({
  useState: <T,>(init: T | (() => T)) => {
    const i = at++
    if (!(i in slots)) slots[i] = typeof init === 'function' ? (init as () => T)() : init
    const set = (v: T | ((p: T) => T)): void => { slots[i] = typeof v === 'function' ? (v as (p: T) => T)(slots[i] as T) : v }
    return [slots[i] as T, set]
  },
  useRef: <T,>(init: T) => {
    const i = at++
    if (!(i in slots)) slots[i] = { current: init }
    return slots[i]
  },
  useEffect: (fn: () => void, deps: unknown[]) => {
    const i = at++
    const prev = slots[i] as unknown[] | undefined
    if (!prev || deps.some((d, k) => !Object.is(d, prev[k]))) { slots[i] = deps; fn() }
  },
}))

const { MENU_OPEN_KEY, loadMenuOpen, useMenuOpen } = await import('../useMenuOpen')

/** A page load: a fresh mount, rendered once. */
function mount(defaultOpen: boolean): { open: () => boolean; set: (v: boolean) => void } {
  slots = []
  const render = (): [boolean, (v: boolean) => void] => { at = 0; return useMenuOpen(defaultOpen) as [boolean, (v: boolean) => void] }
  let [open, setOpen] = render()
  return {
    open: () => open,
    set: (v) => { setOpen(v); [open, setOpen] = render() },
  }
}

beforeEach(() => {
  mem.clear()
  g.localStorage = working
})

describe('the menu across a refresh', () => {
  it('closed on a desktop stays closed after a reload', () => {
    const page = mount(true)
    expect(page.open()).toBe(true)
    page.set(false)
    expect(page.open()).toBe(false)
    expect(mount(true).open()).toBe(false)
  })

  it('opened again stays open after a reload', () => {
    mount(true).set(false)
    const page = mount(true)
    page.set(true)
    expect(mount(true).open()).toBe(true)
  })

  it('opened on a phone stays open after a reload, closed stays closed', () => {
    mount(false).set(true)
    expect(mount(false).open()).toBe(true)
    mount(false).set(false)
    expect(mount(false).open()).toBe(false)
  })

  it('a first visit gets the old default, open on a desktop and closed on a phone, and writes nothing', () => {
    expect(mount(true).open()).toBe(true)
    expect(mount(false).open()).toBe(false)
    expect(mem.has(MENU_OPEN_KEY)).toBe(false)
  })

  it('junk in storage reads as the default', () => {
    mem.set(MENU_OPEN_KEY, 'maybe')
    expect(loadMenuOpen(true)).toBe(true)
    expect(loadMenuOpen(false)).toBe(false)
  })

  it('storage that throws is the default, and the menu still opens and closes for the page', () => {
    g.localStorage = broken
    const page = mount(true)
    expect(page.open()).toBe(true)
    page.set(false)
    expect(page.open()).toBe(false)
  })

  it('no storage at all is the default', () => {
    delete g.localStorage
    expect(mount(true).open()).toBe(true)
    expect(mount(false).open()).toBe(false)
  })
})
