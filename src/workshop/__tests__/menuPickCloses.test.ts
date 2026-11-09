/**
 * menuPickCloses.test.ts: tapping a shard in the workshop's MENU opens it and
 * closes MENU (arkinox, 2026-11-09: "in workshop, tapping a shard in MENU
 * should close the menu"); the row's other tools leave it open; and MENU,
 * opened again, is where it was scrolled to (lib/scrollMemory.ts).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { attachScrollMemory, forgetScrollMemory, scrollKey } from '../../lib/scrollMemory'

const workshop = readFileSync(join(__dirname, '..', 'Workshop.tsx'), 'utf8')
const list = workshop.slice(workshop.indexOf('const ShardList = memo('), workshop.indexOf('export function Workshop('))

/** The MENU panel's scrolling element, as a stand-in: scrollTop clamps as a browser's does. */
function panel(scrollHeight = 6000, clientHeight = 500) {
  let top = 0
  const on = new Map<string, Set<() => void>>()
  const box = {
    scrollHeight,
    clientHeight,
    get scrollTop() { return top },
    set scrollTop(v: number) { top = Math.max(0, Math.min(v, scrollHeight - clientHeight)) },
    addEventListener: (t: string, fn: () => void) => { if (!on.has(t)) on.set(t, new Set()); on.get(t)!.add(fn) },
    removeEventListener: (t: string, fn: () => void) => { on.get(t)?.delete(fn) },
    scrollTo: (v: number) => { box.scrollTop = v; for (const fn of on.get('scroll') ?? []) fn() },
  }
  return box
}

afterEach(() => forgetScrollMemory())

describe('tapping a shard in MENU', () => {
  it('opens the shard and closes MENU', () => {
    expect(list).toContain('<button className="workshop__pick" onClick={() => { w().select(s.id); onOpen() }}>')
    expect(workshop).toContain('<ShardList currentId={shard.id} onOpen={closeMenu} />')
    expect(workshop).toContain('const closeMenu = useCallback(() => setPanel(null), [])')
  })

  it('leaves MENU open for the row\'s other tools: duplicate, copy, move and delete', () => {
    // onOpen is called once in the list, by the pick, and by nothing else in the row.
    expect(list.split('onOpen()').length - 1).toBe(1)
    for (const tool of ['w().duplicate(s.id)', 'copy(s.id)', 'w().remove(s.id)', '{f.tool}']) expect(list).toContain(tool)
  })

  it('opens again where it was scrolled to', () => {
    const key = scrollKey('workshop-menu', 'cc'.repeat(32))
    const open = panel()
    const watching = attachScrollMemory(open, key)
    open.scrollTo(2750)
    // The tap: the shard opens and MENU unmounts, letting its element go.
    watching.detach()
    const reopened = panel()
    attachScrollMemory(reopened, key)
    expect(reopened.scrollTop).toBe(2750)
  })
})
