/**
 * The weld row (arkinox, 2026-10-12): a row of its own, never in the color
 * corner, which it used to cover. With the workshop split by place (workshop
 * redesign, phase 1) the held rows stand side by side in the strip, and WELD
 * comes last, so no other row moves when it comes and goes.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WeldRow } from '../HeldRows'

const HELD = readFileSync(join(__dirname, '..', 'HeldRows.tsx'), 'utf8')
const ACTS = readFileSync(join(__dirname, '..', 'ColorActs.tsx'), 'utf8')
const STRIP = readFileSync(join(__dirname, '..', 'shell', 'Strip.tsx'), 'utf8')

/** One exported component's source, from its `export function` to the next one. */
function fn(name: string): string {
  const start = HELD.indexOf(`export function ${name}(`)
  expect(start).toBeGreaterThan(-1)
  const next = HELD.indexOf('\nexport function ', start + 1)
  return HELD.slice(start, next === -1 ? undefined : next)
}

describe('WeldRow', () => {
  it('is a row with the count and WELD while points are stacked, and nothing otherwise', () => {
    // The stairs arkinox built: two boxes sharing an edge, 4 points on 2 spots (2026-10-12).
    const html = renderToStaticMarkup(<WeldRow stacked={{ spots: 2, points: 4 }} selected={4} />)
    expect(html).toContain('benchclip')
    expect(html).toContain('2 SPOTS STACKED')
    expect(html).toContain('4 points share 2 spots')
    expect(renderToStaticMarkup(<WeldRow stacked={{ spots: 1, points: 3 }} selected={0} />)).toContain('1 SPOT STACKED')
    expect(html).toContain('WELD')
    expect(renderToStaticMarkup(<WeldRow stacked={{ spots: 0, points: 0 }} selected={4} />)).toBe('')
  })

  it('stands in the strip, last of the held rows, so none of them moves when it comes and goes', () => {
    expect(STRIP).toContain('<HeldActions />')
    const held = fn('HeldActions')
    const weld = held.indexOf('<WeldRow')
    expect(weld).toBeGreaterThan(-1)
    for (const row of ['<SelectRow', '<TurnRow', '<ActionRow']) {
      const at = held.indexOf(row)
      expect(at).toBeGreaterThan(-1)
      expect(at).toBeLessThan(weld)
    }
  })

  it('is gone from the color corner and from the move pad beside it', () => {
    expect(ACTS).not.toMatch(/WeldRow|weld\(\)|STACKED/i)
    expect(fn('HeldPad')).not.toMatch(/WeldRow/)
  })
})
