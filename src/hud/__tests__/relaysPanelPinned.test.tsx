/**
 * relaysPanelPinned.test.tsx: RELAYS after the canonical relay switch
 * (the owner, 2026-11-05). relay.onosendai.tech first, marked DEFAULT;
 * cyberspace.nostr1.com second, marked BACKUP; neither can be removed; a
 * relay of the player's own can. Rendered to a string; a server render reads
 * a zustand store's first state, so the saved list is set before it loads.
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

describe('RELAYS with two pinned relays', () => {
  it('lists the new canonical relay first as DEFAULT, nostr1 second as BACKUP, and only the player\'s own can be removed', async () => {
    localStorage.setItem('onosendai:relays', JSON.stringify(['wss://mine.example']))
    vi.resetModules()
    const { RelaysPanel } = await import('../RelaysPanel')
    const html = renderToStaticMarkup(<RelaysPanel />)
    const rows = html.split('relays__row').slice(1)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toContain('relay.onosendai.tech')
    expect(rows[0]).toContain('>DEFAULT<')
    expect(rows[0]).not.toContain('Remove relay')
    expect(rows[1]).toContain('cyberspace.nostr1.com')
    expect(rows[1]).toContain('>BACKUP<')
    expect(rows[1]).not.toContain('Remove relay')
    expect(rows[2]).toContain('mine.example')
    expect(rows[2]).toContain('Remove relay')
  })
})
