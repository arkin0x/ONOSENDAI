/**
 * relaysPanelPinned.test.tsx: RELAYS in stage 1 of retiring
 * cyberspace.nostr1.com (the owner, 2026-11-22). relay.onosendai.tech first,
 * marked DEFAULT, not removable; the player's own after it, removable;
 * cyberspace.nostr1.com last, marked READ ONLY, not removable (it is read,
 * never written to). Rendered to a string; a server render reads a zustand
 * store's first state, so the saved list is set before it loads.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

vi.mock('../../lib/relay', () => ({
  connected: () => false,
  getPool: () => ({ listConnectionStatus: () => new Map<string, boolean>() }),
}))

describe('RELAYS with the canonical relay pinned and the old one read only', () => {
  it('lists the canonical relay first as DEFAULT, the player\'s own next (removable), and nostr1 last as READ ONLY', async () => {
    localStorage.setItem('onosendai:relays', JSON.stringify(['wss://mine.example']))
    vi.resetModules()
    const { RelaysPanel } = await import('../RelaysPanel')
    const html = renderToStaticMarkup(<RelaysPanel />)
    const rows = html.split('relays__row').slice(1)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toContain('relay.onosendai.tech')
    expect(rows[0]).toContain('>DEFAULT<')
    expect(rows[0]).not.toContain('Remove relay')
    expect(rows[1]).toContain('mine.example')
    expect(rows[1]).toContain('Remove relay')
    expect(rows[2]).toContain('cyberspace.nostr1.com')
    expect(rows[2]).toContain('>READ ONLY<')
    expect(rows[2]).not.toContain('Remove relay')
    // The count is the relays published to: the old relay is not one.
    expect(html).toContain('<span class="tag">2</span>')
  })
})
