/**
 * workshopHelp.test.tsx - the workshop's help says what the workshop does
 * (workshop redesign, phase 0, 2026-11-14). The first-run card said one
 * finger draws a box in FACE (it orbits there) and pointed at a TOOLS chip
 * that no longer says TOOLS; MENU's EXPLAIN said "1 2 3 4 tools" (there are
 * five) and named a CONNECT and a DELETE FACE that are gone. And one icon,
 * Waypoints, stood for both "select all" and "color the connected piece".
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

const { Intro } = await import('../Workshop')

const SOURCE = readFileSync(join(__dirname, '..', 'Workshop.tsx'), 'utf8')
const BENCH = readFileSync(join(__dirname, '..', 'Bench.tsx'), 'utf8')

/** Markup to plain words. */
const text = (html: string): string => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

/** MENU's EXPLAIN, as one line of words. */
function menuExplain(): string {
  const menu = SOURCE.indexOf("{panel === 'menu' && shard && (")
  expect(menu).toBeGreaterThan(-1)
  const start = SOURCE.indexOf('<Explanation>', menu)
  const end = SOURCE.indexOf('</Explanation>', start)
  expect(start).toBeGreaterThan(menu)
  return SOURCE.slice(start + '<Explanation>'.length, end).replace(/\s+/g, ' ').trim()
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

  it('points at the tool chip, not a TOOLS chip that is no longer there', () => {
    expect(card).toContain('tool chip at the bottom left')
    expect(card).not.toMatch(/\bTOOLS\b/)
  })
})

describe("MENU's EXPLAIN", () => {
  const explain = menuExplain()

  it('counts the tools the keys choose: 1 to 5', () => {
    const tools = /const TOOLS: Tool\[\] = \[([^\]]*)\]/.exec(SOURCE)
    expect(tools).not.toBeNull()
    const count = tools![1].split(',').length
    expect(count).toBe(5)
    for (let n = 1; n <= count; n++) expect(BENCH).toContain(`e.code === 'Digit${n}'`)
    expect(BENCH).not.toContain(`e.code === 'Digit${count + 1}'`)
    expect(explain).toContain(`Keys: 1 to ${count} tools`)
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
