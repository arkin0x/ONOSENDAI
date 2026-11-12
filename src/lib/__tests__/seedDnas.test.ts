/**
 * seedDnas.test.ts: every DNA SEED lists (lib/seeds/seedDnas). The original
 * DNAs first, then the designed ones in the Seed Garden's groups; names
 * unique; each text valid SEEDO of revision 1 under 8,192 bytes, at caps
 * that price (§7) and are the ones its text declares; every id empty or 64
 * hex; and every DNA grows from day 0 to its last generation within its caps,
 * which never cut a designed DNA short. No worker, no network.
 */

import { describe, expect, it } from 'vitest'
import { BLOCKS_PER_GENERATION, capsPrice, growBloom, parseDna, sha256Hex, tryParseDna, type Caps } from 'sno-core/seeds'
import { ORIGINAL_DNAS } from '../seeds/originalDnas'
import { DNA_GROUPS, SEED_DNAS, SEED_DNA_IDS, seedDnaId } from '../seeds/seedDnas'

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

  it('every DNA has an id slot, empty until the owner publishes it, and an id is used only when it is 64 hex', () => {
    expect(Object.keys(SEED_DNA_IDS).sort()).toEqual(SEED_DNAS.map((d) => d.name).sort())
    for (const [name, id] of Object.entries(SEED_DNA_IDS)) {
      expect(id === '' || /^[0-9a-f]{64}$/.test(id), name).toBe(true)
      expect(seedDnaId(name)).toBe(id === '' ? null : id)
    }
    expect(seedDnaId('juniper', { juniper: 'ab'.repeat(32) })).toBe('ab'.repeat(32))
    expect(seedDnaId('juniper', { juniper: 'AB'.repeat(32) })).toBeNull()
    expect(seedDnaId('no such DNA')).toBeNull()
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
