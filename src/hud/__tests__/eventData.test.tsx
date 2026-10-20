/**
 * The event behind a card, under its actions (arkinox, 2026-10-20): event
 * ID, d tag, pubkey and created_at, each a tap to copy, then the whole
 * event in its own field with COPY in the corner.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { EventData } from '../EventData'

const ev = {
  id: 'a'.repeat(64),
  pubkey: 'b'.repeat(64),
  created_at: 1792400000,
  kind: 33331,
  tags: [['d', 'my-shard'], ['client', 'ONOSENDAI']],
  content: '',
  sig: 'c'.repeat(128),
}

describe('EventData', () => {
  it('lists event ID, d tag, pubkey and created_at, in that order, each a copy button', () => {
    const html = renderToStaticMarkup(<EventData event={ev} />)
    const at = ['event ID', 'd tag', 'pubkey', 'created_at'].map((l) => html.indexOf(`<dt>${l}</dt>`))
    expect(at.every((i) => i >= 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    for (const v of [ev.id, 'my-shard', ev.pubkey, '1792400000']) expect(html).toMatch(new RegExp(`<button class="eventdata__value"[^>]*>${v}</button>`))
  })

  it('says none for an event with no d tag', () => {
    const html = renderToStaticMarkup(<EventData event={{ ...ev, kind: 11333, tags: [] }} />)
    expect(html).toContain('<span class="eventdata__none">none</span>')
  })

  it('shows the whole event as JSON, with COPY above it', () => {
    const html = renderToStaticMarkup(<EventData event={ev} />)
    const copy = html.indexOf('eventdata__copy')
    const pre = html.indexOf('<pre>')
    expect(copy).toBeGreaterThan(-1)
    expect(pre).toBeGreaterThan(copy)
    expect(html).toContain('&quot;sig&quot;: &quot;' + ev.sig + '&quot;')
  })
})
