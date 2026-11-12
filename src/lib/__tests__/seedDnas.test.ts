/**
 * seedDnas.test.ts: every DNA SEED lists (lib/seeds/seedDnas). The original
 * DNAs first, then the designed ones in the Seed Garden's groups; names
 * unique; each text valid SEEDO of revision 1 under 8,192 bytes, at caps
 * that price (§7) and are the ones its text declares; every id 64 hex, the
 * owner's published event (2026-11-12), whose recorded copy
 * (__fixtures__/seed-dnas-published.json, as the relay gave it) verifies and
 * carries this text and these caps, so a text edited here can never drift
 * from its id unseen; the events the app ships (SEED_DNA_EVENTS) are those
 * copies, and the page's resolver plants them with no relay; and every DNA
 * grows from day 0 to its last generation within its caps, which never cut
 * a designed DNA short. No worker, no network.
 */

import { describe, expect, it } from 'vitest'
import { BLOCKS_PER_GENERATION, capsPrice, growBloom, parseDna, sha256Hex, tryParseDna, type Caps } from 'sno-core/seeds'
import { ORIGINAL_DNAS } from '../seeds/originalDnas'
import { DNA_GROUPS, SEED_DNAS, SEED_DNA_AUTHOR, SEED_DNA_EVENTS, SEED_DNA_IDS, seedDnaId } from '../seeds/seedDnas'
import { checkDna, DnaResolver } from '../seeds/dnaStore'
import type { NostrEvent } from '../events'
import published from '../seeds/__fixtures__/seed-dnas-published.json'

/** Each DNA's price in bits a seed, as designed (the Seed Garden v6.1 and the designers' READMEs). */
const PRICES: Record<string, number> = {
  'fiddlehead': 21, 'sword fern': 21, 'oak': 21, 'willow': 21, 'coral': 21, 'crystal': 21,
  'winter star': 20, 'trefoil frost': 19, 'penta frost': 20, 'twelve-armed flake': 20,
  'amethyst tetrapod': 16, 'citrine compass': 16, 'rose quartz star': 18, 'aquamarine geode': 18,
  'winter star v3': 18, 'rose frost v3': 20, 'amethyst cluster v3': 18, 'aquamarine spire v3': 18, 'citrine cross v3': 18,
  'fiddlehead (ferns)': 20, 'sword fern (ferns)': 21,
  'juniper': 16, 'cascade pine': 16, 'japanese maple': 18, 'cherry': 20,
  'italian cypress': 20, 'amur maple': 20, 'coconut palm': 20, 'silver birch': 20, 'giant sequoia': 20,
}

const designed = SEED_DNAS.filter((d) => d.group !== 'Originals')

describe('the DNAs SEED lists', () => {
  it('are the six original DNAs first, then the designed ones, group by group in the Seed Garden\'s order; names unique', () => {
    expect(SEED_DNAS).toHaveLength(30)
    expect(SEED_DNAS.slice(0, 6).map((d) => d.text)).toEqual(ORIGINAL_DNAS.map((d) => d.text))
    expect(SEED_DNAS.slice(0, 6).every((d) => d.group === 'Originals')).toBe(true)
    // Each group's DNAs sit together, and the groups come in DNA_GROUPS's order.
    const order = SEED_DNAS.map((d) => DNA_GROUPS.indexOf(d.group))
    expect(order.every((g, i) => g >= 0 && (i === 0 || g >= order[i - 1]))).toBe(true)
    expect(new Set(order).size).toBe(DNA_GROUPS.length)
    expect(new Set(SEED_DNAS.map((d) => d.name)).size).toBe(SEED_DNAS.length)
    expect(Object.keys(PRICES).sort()).toEqual(SEED_DNAS.map((d) => d.name).sort())
  })

  it('each text is valid SEEDO of revision 1, starts `seedo   1`, is under 8,192 bytes, and names its DNA', () => {
    for (const d of SEED_DNAS) {
      expect(d.text.startsWith('seedo   1\n'), d.name).toBe(true)
      expect(new TextEncoder().encode(d.text).length, d.name).toBeLessThanOrEqual(8192)
      const read = tryParseDna(d.text)
      expect(read.ok, `${d.name}: ${read.ok ? '' : read.error}`).toBe(true)
      if (!read.ok) continue
      expect(read.dna.revision, d.name).toBe(1)
      // The name is the `dna` line, or (the designed ferns) the `dna` line and its group.
      expect([read.dna.name, `${read.dna.name} (${d.group.toLowerCase()})`], d.name).toContain(d.name)
    }
  })

  it('each designed DNA is at the caps its text declares (its `# caps` line), and every DNA prices as designed', () => {
    for (const d of designed) {
      const line = d.text.split('\n').find((l) => l.startsWith('# caps '))
      expect(line, d.name).toBe(`# caps ${d.caps.vertices} ${d.caps.symbols} ${d.caps.generations}`)
    }
    for (const d of SEED_DNAS) expect(capsPrice(d.caps), d.name).toBe(PRICES[d.name])
  })

  it('the designed ferns are other species than the original fiddlehead and sword fern, not copies of them', () => {
    for (const [mine, theirs] of [['fiddlehead (ferns)', 'fiddlehead'], ['sword fern (ferns)', 'sword fern']]) {
      const a = SEED_DNAS.find((d) => d.name === mine)!, b = SEED_DNAS.find((d) => d.name === theirs)!
      expect(a.text).not.toBe(b.text)
      expect(parseDna(a.text).speciesKey).not.toBe(parseDna(b.text).speciesKey)
    }
  })

  it('every DNA has its id, the owner\'s published event, 64 hex, each a different one; an id is used only when it is 64 hex', () => {
    expect(Object.keys(SEED_DNA_IDS).sort()).toEqual(SEED_DNAS.map((d) => d.name).sort())
    for (const [name, id] of Object.entries(SEED_DNA_IDS)) {
      expect(id, name).toMatch(/^[0-9a-f]{64}$/)
      expect(seedDnaId(name)).toBe(id)
    }
    expect(new Set(Object.values(SEED_DNA_IDS)).size).toBe(SEED_DNAS.length)
    expect(seedDnaId('juniper', { juniper: 'ab'.repeat(32) })).toBe('ab'.repeat(32))
    expect(seedDnaId('juniper', { juniper: 'AB'.repeat(32) })).toBeNull()
    expect(seedDnaId('no such DNA')).toBeNull()
  })
})

describe('the owner\'s published DNAs (2026-11-12)', () => {
  const copies = published as NostrEvent[]
  const byId = new Map(copies.map((e) => [e.id, e]))

  it('each id\'s recorded copy, as the relay gave it, verifies, is the owner\'s kind 3350, and carries this text and these caps', () => {
    expect(copies).toHaveLength(SEED_DNAS.length)
    for (const d of SEED_DNAS) {
      const ev = byId.get(SEED_DNA_IDS[d.name])
      expect(ev, d.name).toBeDefined()
      if (!ev) continue
      // Its id is its hash and its signature verifies (the checks every DNA gets), under the owner's key.
      expect(checkDna(ev, ev.id).state, d.name).toBe('ok')
      expect(ev.pubkey, d.name).toBe(SEED_DNA_AUTHOR)
      expect(ev.kind, d.name).toBe(3350)
      // The text here, byte for byte: a text edited here no longer matches its published id.
      expect(ev.content, d.name).toBe(d.text)
      expect(ev.tags.find((t) => t[0] === 'caps'), d.name).toEqual(['caps', String(d.caps.vertices), String(d.caps.symbols), String(d.caps.generations)])
      expect(ev.tags.map((t) => t[0]), d.name).toEqual(['caps', 'alt'])
    }
  })

  it('the events the app ships are those copies exactly, rebuilt from this text and their signatures', () => {
    expect(SEED_DNA_EVENTS).toHaveLength(SEED_DNAS.length)
    // The seven fields of the event (a check leaves a mark of its own on an object, which is not the event).
    const fields = (e: NostrEvent | undefined) => e && { id: e.id, pubkey: e.pubkey, created_at: e.created_at, kind: e.kind, tags: e.tags, content: e.content, sig: e.sig }
    for (const ev of SEED_DNA_EVENTS) expect(fields(ev)).toEqual(fields(byId.get(ev.id)))
  })

  it('held by a resolver, each resolves to its DNA at its own size limit with no relay asked; a held event that drifted is refused', async () => {
    let asked = 0
    const resolver = new DnaResolver({ fetch: async () => { asked++; return [] }, load: async () => undefined, save: async () => {} })
    resolver.hold(SEED_DNA_EVENTS)
    for (const d of SEED_DNAS) {
      const v = await resolver.resolve(SEED_DNA_IDS[d.name])
      expect(v.state, d.name).toBe('ok')
      if (v.state === 'ok') expect(v.caps, d.name).toEqual(d.caps)
    }
    expect(asked).toBe(0)
    // A text changed after it was signed: its id is no longer its hash, so it is never planted under that id.
    const drifted = { ...SEED_DNA_EVENTS[0], content: SEED_DNA_EVENTS[0].content + ' ' }
    const other = new DnaResolver({ fetch: async () => [], load: async () => undefined, save: async () => {} })
    other.hold([drifted])
    expect((await other.resolve(drifted.id)).state).toBe('invalid')
  })

  it('the page\'s resolver holds them from the start (lib/seeds/seedSources)', async () => {
    const { dnaResolver } = await import('../seeds/seedSources')
    const id = SEED_DNA_IDS['giant sequoia']
    expect(dnaResolver.verdict(id)).toBeUndefined()
    const v = await dnaResolver.resolve(id)
    expect(v.state).toBe('ok')
  })
})

describe('every DNA SEED lists grows', () => {
  const N = BLOCKS_PER_GENERATION
  const planted = 970_000
  const hash = (h: number): string => sha256Hex(new TextEncoder().encode(`seedDnas test ${h}`))
  // The richest soil (K 16, every nibble 15), the designers' worst case for size, and an ordinary place.
  const coords = ['0000000000000000000000000000000000000000000224329b05b280400080ca', sha256Hex(new TextEncoder().encode('an ordinary place'))]
  const largest = (c: Caps): Caps => ({ vertices: 65536, symbols: 16384, generations: c.generations })

  it('from day 0 to its last generation, without error, within its caps; a designed DNA\'s caps never cut it short', () => {
    for (const d of SEED_DNAS) {
      const dna = parseDna(d.text)
      for (const coord of coords) {
        const seed = { coord, planted, scale: 0, caps: d.caps }
        const first = growBloom(dna, seed, planted + N - 1, hash)
        expect(first.generation, d.name).toBe(0)
        expect(first.sno.colors.length, d.name).toBeGreaterThan(0)
        const clock = planted + d.caps.generations * N + (N - 1)
        const last = growBloom(dna, seed, clock, hash)
        expect(last.behind, d.name).toBe(false)
        expect(last.generation, d.name).toBe(d.caps.generations)
        expect(last.symbols, d.name).toBeLessThanOrEqual(d.caps.symbols)
        expect(last.sno.colors.length, d.name).toBeLessThanOrEqual(d.caps.vertices)
        expect(last.sno.colors.length, d.name).toBeGreaterThan(first.sno.colors.length)
        // A designed DNA grown at the largest caps is the same bloom: its own caps stop nothing. (The
        // original DNAs keep the prototype's caps, where coral on the richest soil does stop at 6,000 symbols.)
        if (d.group !== 'Originals') expect(growBloom(dna, { ...seed, caps: largest(d.caps) }, clock, hash).sha256, d.name).toBe(last.sha256)
      }
    }
  }, 60_000)
})
