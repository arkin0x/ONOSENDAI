/**
 * dmInboxTemplate.test.ts: the kind 10050 SET UP DM INBOX signs (arkinox,
 * 2026-10-13) is a list of relays and nothing else: kind 10050, one `relay`
 * tag per secure relay, empty content. Pure: nothing here signs or sends.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_DM_RELAYS, DM_RELAYS_KIND, dmInboxAnnounceRelays, dmInboxTemplate, dmRelaysOf } from '../inbox'
import { GENERAL_RELAYS } from '../contacts'

describe('the 10050 template', () => {
  it('is kind 10050 with one relay tag per default relay and no content', () => {
    const t = dmInboxTemplate(DEFAULT_DM_RELAYS, 1_700_000_000)
    expect(DM_RELAYS_KIND).toBe(10050)
    expect(t).toEqual({
      kind: 10050,
      created_at: 1_700_000_000,
      tags: [['relay', 'wss://auth.nostr1.com'], ['relay', 'wss://nip17.com']],
      content: '',
    })
    // What dmInboxOf reads back is what was offered.
    expect(dmRelaysOf(t)).toEqual([...DEFAULT_DM_RELAYS])
  })

  it('keeps only secure relays, normalized and once each, and refuses an empty list', () => {
    const t = dmInboxTemplate(['wss://a.example/', 'ws://plain.example', 'wss://a.example', 'https://web.example', ' wss://b.example '])
    expect(t.tags).toEqual([['relay', 'wss://a.example'], ['relay', 'wss://b.example']])
    expect(t.tags.every((tag) => tag.length === 2 && tag[0] === 'relay')).toBe(true)
    expect(() => dmInboxTemplate([])).toThrow(/at least one/)
    expect(() => dmInboxTemplate(['ws://plain.example'])).toThrow(/at least one/)
  })

  it('the defaults are two or three free wss relays', () => {
    expect(DEFAULT_DM_RELAYS.length).toBeGreaterThanOrEqual(2)
    expect(DEFAULT_DM_RELAYS.length).toBeLessThanOrEqual(3)
    for (const r of DEFAULT_DM_RELAYS) expect(r).toMatch(/^wss:\/\/[^\s/]+$/)
  })

  it('is announced where dmInboxOf looks (the general relays) and on the inbox relays themselves', () => {
    const where = dmInboxAnnounceRelays(DEFAULT_DM_RELAYS)
    for (const r of [...GENERAL_RELAYS, ...DEFAULT_DM_RELAYS]) expect(where).toContain(r)
    expect(new Set(where).size).toBe(where.length)
  })
})
