/**
 * fullnessBar.test.tsx: the bar under BYTES ON THE WIRE (owner, 2026-11-23):
 * a meter with the number beside it, its colour calm until close to full,
 * a hatched run for what a stamp would add, and a note when the shard places
 * objects that go out on their own, in a line kept whether it shows or not.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FullnessBar } from '../FullnessBar'
import { wholePayloadLimit } from '../../lib/shardFullness'

describe('FullnessBar', () => {
  it('shows a meter and the number, calm while there is room', () => {
    const html = renderToStaticMarkup(<FullnessBar payload={41_816} />)
    expect(html).toContain('role="meter"')
    expect(html).toContain('fullbar--calm')
    expect(html).toMatch(/data-testid="fullbar-pct">\d+%/)
    expect(html).toContain('41,816 of ')
    expect(html).not.toContain('fullbar-next')
  })

  it('turns amber close to full and red past it', () => {
    expect(renderToStaticMarkup(<FullnessBar payload={Math.ceil(wholePayloadLimit() * 0.95)} />)).toContain('fullbar--near')
    const over = renderToStaticMarkup(<FullnessBar payload={wholePayloadLimit() + 10} />)
    expect(over).toContain('fullbar--over')
    expect(over).toContain('Too big to hide in one piece')
  })

  it('shows what a stamp would add, in the colour the result would be', () => {
    const html = renderToStaticMarkup(<FullnessBar payload={1000} next={wholePayloadLimit() + 10} />)
    expect(html).toContain('data-testid="fullbar-next"')
    expect(html).toContain('fullbar--over')
    expect(html).toMatch(/fullbar-pct">1% <span class="fullbar__arrow">to<\/span> \d+%/)
  })

  it('says it counts the shard itself when it places objects that go out on their own, in a line always kept', () => {
    expect(renderToStaticMarkup(<FullnessBar payload={1000} apart={3} />)).toContain('Counts this shard itself. The 3 objects it places go out on their own.')
    expect(renderToStaticMarkup(<FullnessBar payload={1000} apart={1} />)).toContain('The object it places goes out on its own.')
    // The line is there, empty, without placed objects: nothing moves when the first one is placed.
    expect(renderToStaticMarkup(<FullnessBar payload={1000} />)).toContain('<span class="fullbar__note"></span>')
  })

  it('is in the SHARD sheet under BYTES ON THE WIRE', () => {
    const src = readFileSync(join(__dirname, '..', 'sheets', 'ShardSheet.tsx'), 'utf8')
    expect(src.indexOf('<FullnessBar payload={wireBytes}')).toBeGreaterThan(src.indexOf('BYTES ON THE WIRE'))
  })
})
