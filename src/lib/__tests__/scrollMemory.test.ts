/**
 * scrollMemory.test.ts: a long list comes back where it was left (arkinox,
 * 2026-11-09: "preserving the scroll position in the workshop menu would be
 * very helpful"). Driven with a stand-in element: scrollTop clamps to what the
 * content reaches, as a browser's does, and a scroll event fires only when the
 * test fires it.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachScrollMemory, forgetScrollMemory, recallScroll, rememberScroll, scrollKey } from '../scrollMemory'

class Box {
  private top = 0
  clientHeight = 300
  constructor(public scrollHeight: number) {}
  get scrollTop(): number { return this.top }
  set scrollTop(v: number) { this.top = Math.max(0, Math.min(v, this.scrollHeight - this.clientHeight)) }
  private on = new Map<string, Set<() => void>>()
  addEventListener(type: string, fn: () => void): void { if (!this.on.has(type)) this.on.set(type, new Set()); this.on.get(type)!.add(fn) }
  removeEventListener(type: string, fn: () => void): void { this.on.get(type)?.delete(fn) }
  fire(type: string): void { for (const fn of this.on.get(type) ?? []) fn() }
  /** The user scrolls to `top`. */
  scrollTo(top: number): void { this.scrollTop = top; this.fire('scroll') }
  listening(): number { let n = 0; for (const s of this.on.values()) n += s.size; return n }
}

const ME = 'aa'.repeat(32)
const THEM = 'bb'.repeat(32)
const MENU = scrollKey('workshop-menu', ME)

afterEach(() => { forgetScrollMemory(); vi.unstubAllGlobals() })

describe('scroll memory', () => {
  it('puts a list back where the user left it when it is drawn again', () => {
    const first = new Box(5000)
    const m = attachScrollMemory(first, MENU)
    first.scrollTo(1840)
    m.detach()
    const again = new Box(5000)
    attachScrollMemory(again, MENU)
    expect(again.scrollTop).toBe(1840)
  })

  it('remembers nothing until there is something to put back, and a fresh list starts at the top', () => {
    const box = new Box(5000)
    attachScrollMemory(box, MENU)
    expect(box.scrollTop).toBe(0)
    expect(recallScroll(MENU)).toBe(0)
  })

  it('waits for a progressively loading list to reach the place, then puts it back once, without jumping later', () => {
    rememberScroll(MENU, 1200)
    const box = new Box(600)
    let ready = false
    const m = attachScrollMemory(box, MENU, () => ready)
    expect(box.scrollTop).toBe(0)
    box.scrollHeight = 1000
    m.settle()
    // Not part way: room for 700 is not room for 1200.
    expect(box.scrollTop).toBe(0)
    box.scrollHeight = 2000
    m.settle()
    expect(box.scrollTop).toBe(1200)
    // The restore's own scroll event is not the user's, and keeps the place.
    box.fire('scroll')
    expect(recallScroll(MENU)).toBe(1200)
    box.scrollHeight = 4000
    ready = true
    m.settle()
    expect(box.scrollTop).toBe(1200)
  })

  it('once the list is complete, goes as near as it now reaches', () => {
    rememberScroll(MENU, 1200)
    const box = new Box(800)
    let ready = false
    const m = attachScrollMemory(box, MENU, () => ready)
    expect(box.scrollTop).toBe(0)
    ready = true
    m.settle()
    expect(box.scrollTop).toBe(500)
  })

  it('lets the user win: a wheel before the restore ends it, and their scroll is what is kept', () => {
    rememberScroll(MENU, 1200)
    const box = new Box(600)
    const m = attachScrollMemory(box, MENU, () => false)
    box.fire('wheel')
    box.scrollTo(80)
    box.scrollHeight = 3000
    m.settle()
    expect(box.scrollTop).toBe(80)
    expect(recallScroll(MENU)).toBe(80)
  })

  it('lets the user win on a scroll the restore did not make (a scrollbar dragged)', () => {
    rememberScroll(MENU, 1200)
    const box = new Box(600)
    const m = attachScrollMemory(box, MENU, () => false)
    box.scrollTo(150)
    box.scrollHeight = 3000
    m.settle()
    expect(box.scrollTop).toBe(150)
    expect(recallScroll(MENU)).toBe(150)
  })

  it('a touch or a press on the list before the restore ends it too', () => {
    for (const type of ['touchstart', 'pointerdown', 'keydown']) {
      rememberScroll(MENU, 900)
      const box = new Box(600)
      const m = attachScrollMemory(box, MENU, () => false)
      box.fire(type)
      box.scrollHeight = 3000
      m.settle()
      expect(box.scrollTop, type).toBe(0)
      m.detach()
    }
  })

  it('keeps each list its own place', () => {
    const stamp = scrollKey('workshop-stamp-objects', ME)
    const a = new Box(5000)
    const b = new Box(5000)
    attachScrollMemory(a, MENU)
    attachScrollMemory(b, stamp)
    a.scrollTo(700)
    b.scrollTo(2100)
    const a2 = new Box(5000)
    const b2 = new Box(5000)
    attachScrollMemory(a2, MENU)
    attachScrollMemory(b2, stamp)
    expect(a2.scrollTop).toBe(700)
    expect(b2.scrollTop).toBe(2100)
  })

  it('keeps each identity its own place in the same list', () => {
    expect(scrollKey('workshop-menu', ME)).not.toBe(scrollKey('workshop-menu', THEM))
    const mine = new Box(5000)
    attachScrollMemory(mine, MENU)
    mine.scrollTo(1600)
    const theirs = new Box(5000)
    attachScrollMemory(theirs, scrollKey('workshop-menu', THEM))
    expect(theirs.scrollTop).toBe(0)
    const mineAgain = new Box(5000)
    attachScrollMemory(mineAgain, MENU)
    expect(mineAgain.scrollTop).toBe(1600)
  })

  it('stops listening when detached', () => {
    const box = new Box(5000)
    const m = attachScrollMemory(box, MENU)
    box.scrollTo(400)
    m.detach()
    expect(box.listening()).toBe(0)
    box.scrollTo(900)
    expect(recallScroll(MENU)).toBe(400)
  })

  it('survives a reload through sessionStorage', () => {
    const kept = new Map<string, string>()
    vi.stubGlobal('window', { sessionStorage: { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => { kept.set(k, v) } } })
    const box = new Box(5000)
    attachScrollMemory(box, MENU)
    box.scrollTo(1333)
    forgetScrollMemory()
    const reloaded = new Box(5000)
    attachScrollMemory(reloaded, MENU)
    expect(reloaded.scrollTop).toBe(1333)
  })

  it('works from memory alone where sessionStorage refuses', () => {
    const refuse = (): never => { throw new Error('SecurityError') }
    vi.stubGlobal('window', { sessionStorage: { getItem: refuse, setItem: refuse } })
    const box = new Box(5000)
    attachScrollMemory(box, MENU)
    box.scrollTo(250)
    const again = new Box(5000)
    attachScrollMemory(again, MENU)
    expect(again.scrollTop).toBe(250)
  })
})

describe('the lists that remember', () => {
  const src = (p: string): string => readFileSync(join(__dirname, '..', '..', p), 'utf8')
  it.each([
    ['workshop/Workshop.tsx', 'workshop-menu', 'aria-label="Menu" ref={menuScroll}'],
    ['workshop/ObjectPicker.tsx', 'workshop-stamp-objects', '<ul className="objpick__list" ref={listScroll}>'],
    ['hud/PlaceObjectPicker.tsx', 'place-object-mine', '<ul className="objpick__list" ref={listScroll}>'],
  ])('%s keeps its own list, %s, on the element that scrolls', (file, list, attached) => {
    const text = src(file)
    expect(text).toContain(`useScrollMemory('${list}'`)
    expect(text).toContain(attached)
  })
})
