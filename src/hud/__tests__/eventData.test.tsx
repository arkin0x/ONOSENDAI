/**
 * The event behind a card, under its actions (arkinox, 2026-10-20): event
 * ID, d tag, pubkey and created_at, each a tap to copy, then the whole
 * event in its own field, selectable but with no COPY of its own.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { EventData, eventJson, HIDDEN_SECRET, shownEvent } from '../EventData'

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

  it('shows the whole event as JSON, with no COPY for it (copied by hand if wanted)', () => {
    const html = renderToStaticMarkup(<EventData event={ev} />)
    expect(html).toContain('&quot;sig&quot;: &quot;' + ev.sig + '&quot;')
    expect(html).not.toContain('eventdata__copy')
    expect(html).not.toContain('>COPY<')
  })
})

describe('a key item never shows its secret (review of #399)', () => {
  const secret = 'f'.repeat(64)
  const key = { ...ev, kind: 3340, tags: [['C', 'x'], ['title', 'Vapor Key'], ['item', 'd'.repeat(64)], ['secret', secret], ['-']], content: 'opens the vault' }

  it('hides the secret tag in the field, and says so', () => {
    const html = renderToStaticMarkup(<EventData event={key} />)
    expect(html).not.toContain(secret)
    expect(eventJson(shownEvent(key).event)).not.toContain(secret)
    expect(shownEvent(key).event.tags.find((t) => t[0] === 'secret')?.[1]).toBe(HIDDEN_SECRET)
    expect(html).toContain('will not verify')
  })

  it('hides a key forged before 2026-10-09, whose secret is the content', () => {
    const legacy = { ...key, tags: [['C', 'x'], ['about', 'old key']], content: secret }
    expect(renderToStaticMarkup(<EventData event={legacy} />)).not.toContain(secret)
    expect(shownEvent(legacy).hidden).toBe(true)
  })

  it('leaves every other kind as it is', () => {
    expect(shownEvent(ev)).toEqual({ event: ev, hidden: false })
    expect(renderToStaticMarkup(<EventData event={ev} />)).not.toContain('will not verify')
  })
})

describe('the event as JSON', () => {
  it('is valid JSON, in NIP-01 field order, one tag to a line', () => {
    const json = eventJson(ev)
    expect(JSON.parse(json)).toEqual(ev)
    expect(Object.keys(JSON.parse(json))).toEqual(['id', 'pubkey', 'created_at', 'kind', 'tags', 'content', 'sig'])
    expect(json).toContain('\n    ["d","my-shard"],\n    ["client","ONOSENDAI"]\n  ]')
    expect(JSON.parse(eventJson({ ...ev, tags: [] })).tags).toEqual([])
  })

  it('shows no sig for a rumor (a hidden message, 2026-10-20), never "undefined"', () => {
    const { sig: _sig, ...rumor } = ev
    const json = eventJson({ ...rumor, kind: 1 })
    expect(json).not.toContain('sig')
    expect(json).not.toContain('undefined')
    expect(Object.keys(JSON.parse(json))).toEqual(['id', 'pubkey', 'created_at', 'kind', 'tags', 'content'])
    expect(eventJson({ ...ev, sig: '' })).not.toContain('sig')
  })
})
