/**
 * workshopHelp.test.tsx - the workshop's help says what the workshop does
 * (workshop redesign, phase 0, 2026-11-14). The first-run card said one
 * finger draws a box in FACE (it orbits there) and pointed at a TOOLS chip
 * that no longer says TOOLS; MENU's EXPLAIN said "1 2 3 4 tools" (there are
 * five) and named a CONNECT and a DELETE FACE that are gone. And one icon,
 * Waypoints, stood for both "select all" and "color the connected piece".
 * Phase 1 split the workshop by place: the help lives where its controls do.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

const { Intro } = await import('../Notices')
const { DOCK } = await import('../shell/Dock')

const read = (...p: string[]): string => readFileSync(join(__dirname, '..', ...p), 'utf8')
const MENU = read('sheets', 'MenuSheet.tsx')
const STRIP = read('shell', 'Strip.tsx')
const VIEWBALL = read('shell', 'ViewBall.tsx')
/** Where the held rows and the color column draw their keys. */
const SOURCE = read('HeldRows.tsx') + read('ColorActs.tsx')
const BENCH = read('Bench.tsx')

/** Markup to plain words. */
const text = (html: string): string => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

/** MENU's EXPLAIN, as one line of words. */
function menuExplain(): string {
  const start = MENU.indexOf('<Explanation>')
  const end = MENU.indexOf('</Explanation>', start)
  expect(start).toBeGreaterThan(-1)
  return MENU.slice(start + '<Explanation>'.length, end).replace(/\s+/g, ' ').trim()
}

/** The lucide icon drawn inside the button with this aria-label. */
function iconOf(label: string): string {
  const at = SOURCE.indexOf(`aria-label="${label}"`)
  expect(at, label).toBeGreaterThan(-1)
  const close = SOURCE.indexOf('</button>', at)
  const icon = /<([A-Z][A-Za-z0-9]+) size=/.exec(SOURCE.slice(at, close))
  expect(icon, label).not.toBeNull()
  return icon![1]
}

describe('the first-run card', () => {
  const card = text(renderToStaticMarkup(<Intro />))

  it('says one finger draws a box in SELECT only, since it orbits in FACE', () => {
    expect(card).toContain('in SELECT one finger draws a box')
    expect(card).not.toMatch(/FACE[^.;]*draws a box/)
  })

  it('points at STAMP in the dock, not a TOOLS chip or an ORBIT ball that are no longer there', () => {
    expect(card).toContain('tap STAMP at the bottom')
    expect(card).not.toMatch(/\bTOOLS\b/)
    expect(card).not.toContain('ORBIT')
  })
})

describe('the LOOK help line', () => {
  it('says the view ball tips or rolls the grid, which is what its menu does', () => {
    const view = /^\s*view: '([^']*)',$/m.exec(STRIP)
    expect(view).not.toBeNull()
    expect(view![1]).toContain('Tap the view ball for views, or to tip or roll the grid a quarter')
    expect(view![1]).not.toContain('compass')
    expect(VIEWBALL).toContain('aria-label="Tip the grid up"')
    expect(VIEWBALL).toContain('aria-label="Roll the grid left"')
  })
})

describe("MENU's EXPLAIN", () => {
  const explain = menuExplain()

  it('names every tool key, 1 to 5, as Bench.tsx binds them and the dock titles them', () => {
    const byKey = [...DOCK].sort((a, b) => Number(a.key) - Number(b.key))
    expect(byKey.map((d) => d.key)).toEqual(['1', '2', '3', '4', '5'])
    for (const d of byKey) expect(BENCH).toContain(`if (e.code === 'Digit${d.key}') w.setTool('${d.tool}')`)
    expect(BENCH).not.toContain(`e.code === 'Digit${byKey.length + 1}'`)
    expect(explain).toContain(`Keys: ${byKey.map((d) => `${d.key} ${d.label}`).join(', ')},`)
    expect(explain).not.toContain('1 2 3 4')
  })

  it('names JOINED, the key that is there, and not CONNECT or DELETE FACE', () => {
    expect(SOURCE).toContain('<span className="touchpad__sub">JOINED</span>')
    expect(explain).toContain('JOINED takes everything faces join to them')
    expect(explain).not.toContain('CONNECT')
    expect(explain).not.toContain('DELETE FACE')
  })
})

describe('icons', () => {
  it('gives "select all" and "color the connected piece" different icons', () => {
    expect(iconOf('Select everything')).toBe('Waypoints')
    expect(iconOf('Color the connected piece')).toBe('Puzzle')
  })

  it('draws each color button with an icon of its own, used by no action key', () => {
    const color = ['Take the selected color', 'Color everything', 'Color the connected piece', 'Color the selected points'].map(iconOf)
    expect(new Set(color).size).toBe(color.length)
    const actions = ['Select everything', 'Select connected', 'Subdivide the selection', 'Turn every face outward', 'Flip', 'Cut the selection', 'Copy the selection'].map(iconOf)
    for (const icon of color) expect(actions).not.toContain(icon)
  })
})
