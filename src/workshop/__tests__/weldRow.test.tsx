/**
 * The weld row (arkinox, 2026-10-12): a row of its own at the top of the
 * bottom-left column, standing on the tool chip when nothing else is up, and
 * nowhere near the orbit ball, which it used to cover from the color corner.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WeldRow } from '../Workshop'

const SOURCE = readFileSync(join(__dirname, '..', 'Workshop.tsx'), 'utf8')

/** The JSX between an opening `<div className="X"` and the next sibling block at the same indent. */
function block(cls: string): string {
  const start = SOURCE.indexOf(`<div className="${cls}"`)
  expect(start).toBeGreaterThan(-1)
  const indent = SOURCE.lastIndexOf('\n', start)
  const pad = SOURCE.slice(indent + 1, start)
  const end = SOURCE.indexOf(`\n${pad}</div>`, start)
  return SOURCE.slice(start, end)
}

describe('WeldRow', () => {
  it('is a row with the count and WELD while points are stacked, and nothing otherwise', () => {
    const html = renderToStaticMarkup(<WeldRow stacked={2} selected={4} />)
    expect(html).toContain('benchclip')
    expect(html).toContain('2 STACKED')
    expect(html).toContain('WELD')
    expect(renderToStaticMarkup(<WeldRow stacked={0} selected={4} />)).toBe('')
  })

  it('stands first in the bottom-left column, so the chip is the next thing under it when no row is up', () => {
    const tools = block('ws__tools')
    const weld = tools.indexOf('<WeldRow')
    expect(weld).toBeGreaterThan(-1)
    for (const row of ['<SelectRow', '<ActionRow', '<TurnRow', '<ControlsPad', 'ws__toolchips']) {
      expect(tools.indexOf(row)).toBeGreaterThan(weld)
    }
  })

  it('is gone from the color corner beside the orbit ball', () => {
    expect(block('ws__corner')).not.toMatch(/WeldRow|weld\(\)|STACKED/i)
    expect(SOURCE).not.toContain('benchops')
  })
})
