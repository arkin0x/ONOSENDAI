/**
 * seedComposeGroups.test.tsx: SEED lists every DNA in one grouped list
 * (lib/seeds/seedDnas), the original DNAs first and then the Seed Garden's
 * groups, with PASTE last, so thirty DNAs fit a phone's width.
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
  onAuthChange: () => () => {},
  signInFailed: () => false,
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { SeedCompose } from '../SeedCompose'
import { DNA_GROUPS, SEED_DNAS } from '../../lib/seeds/seedDnas'

describe('SEED\'s DNA list', () => {
  const html = renderToStaticMarkup(<SeedCompose onDone={() => {}} />)
  const select = html.slice(html.indexOf('<select'), html.indexOf('</select>'))

  it('is one list, its groups in the Seed Garden\'s order, the original DNAs first', () => {
    expect(html.match(/<select/g)).toHaveLength(1)
    const labels = [...select.matchAll(/<optgroup label="([^"]+)"/g)].map((m) => m[1])
    expect(labels).toEqual(DNA_GROUPS.map((g) => g.toUpperCase()))
    expect(labels[0]).toBe('ORIGINALS')
  })

  it('holds every DNA under its own group, and PASTE last', () => {
    const groups = select.split('<optgroup').slice(1)
    DNA_GROUPS.forEach((g, i) => {
      const names = [...groups[i].matchAll(/<option value="\d+"[^>]*>([^<]+)<\/option>/g)].map((m) => m[1].replace(/&#x27;/g, '\''))
      expect(names, g).toEqual(SEED_DNAS.filter((d) => d.group === g).map((d) => d.name.toUpperCase()))
    })
    expect(select.trimEnd().endsWith('<option value="paste">PASTE</option>')).toBe(true)
    // PASTE is a button beside the list too, as it was before the list.
    expect(html).toMatch(/<button aria-pressed="false" class="seedc__pick ">PASTE<\/button>/)
  })

  it('opens on the first original DNA, at the size limit the owner\'s published event sets (no SMALL or LARGE to pick)', () => {
    expect(select).toMatch(/<option value="0" selected="">FIDDLEHEAD<\/option>/)
    // Every listed DNA is published (seedDnas SEED_DNA_IDS): its event's caps decide, read as it resolves (this render is before).
    expect(html).toContain('FETCHING THIS DNA')
    expect(html).not.toContain('>SMALL<')
    expect(html).not.toContain('>LARGE<')
    expect(html).toContain('PRICE 21 BITS')
  })

  it('its preview runs to the DNA\'s last day, its generations cap plus one: day 41 for the original DNAs (owner ruling "A")', () => {
    expect(html).toMatch(/<input type="range" min="0" max="41"[^>]*value="41"\/>/)
  })
})
