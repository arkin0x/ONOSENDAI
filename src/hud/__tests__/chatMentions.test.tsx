/**
 * A chat line shows a NIP-27 reference as @Name, the profile's label
 * (arkinox, 2026-10-11).
 */
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

import { renderToStaticMarkup } from 'react-dom/server'
import { nip19 } from 'nostr-tools'

const xor = 'a'.repeat(64)
const stranger = 'b'.repeat(64)
// A server render reads a store's initial state, so the profile is in the
// cache before the store is loaded (useProfiles loadCache).
localStorage.setItem('onosendai:profiles', JSON.stringify({ [xor]: { pubkey: xor, name: 'XOR', picture: null, about: null, nip05: null, at: 1, bot: true } }))
const { LineText } = await import('../ChatDock')

describe('a line with a mention', () => {
  it('renders nostr:npub as @Name, and a short npub when the name is unknown', () => {
    const html = renderToStaticMarkup(<LineText text={`hey nostr:${nip19.npubEncode(xor)} and nostr:${nip19.npubEncode(stranger)}`} me={stranger} />)
    expect(html).toContain('>@XOR</span>')
    expect(html).not.toContain('nostr:npub')
    expect(html).toContain(`@${nip19.npubEncode(stranger).slice(0, 12)}`)
    expect(html).toContain('chat__mention is-me')
  })
})
