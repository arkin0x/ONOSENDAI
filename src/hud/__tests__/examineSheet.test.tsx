/**
 * examineSheet.test.tsx: EXAMINE's drafting sheet (hud/blueprint/ExamineSheet)
 * says only what a finder may know. PRIZE names the prize only when its
 * maker chose to show the name, never with the blueprint's title; an outline
 * or pictures that did not come say so in plain words instead of "0 views";
 * and a maker examining their own gets FINDER and MAKER, FINDER first, the
 * sheet redrawn in place. Mounted with no DOM: the canvases have no context
 * and are left blank.
 */
import { describe, expect, it } from 'vitest'

;(globalThis as { window?: unknown }).window ??= globalThis

import { createElement } from 'react'
import { fullView, type FinderView, type PrizeReveal } from '../../lib/blueprint/format'
import { mount, textOf, type Host } from '../../test/elementRoot'
import { GAME_AIR_LINE, GAME_CONSTRUCTION, GAME_CONSTRUCTION_SHORT, GAME_NO_DEPLOY, QUARRY_NO_DEPLOY } from '../../lib/blueprint/gameCard'
import { ExamineSheet, MYSTERY_PRIZE, NAME_HIDDEN, NO_PICTURES, constructionShort, constructionWords, materialsWords, prizeShort, prizeWords, type ExamineBlueprint, type ExamineMaker } from '../blueprint/ExamineSheet'

/** Two blocks side by side, a Gridstone and a Glowcore; a finder is shown the Glowcore alone. */
const FULL: FinderView = fullView({ size: [2, 1, 1], cells: Uint16Array.from([1, 42]) })
const FINDER: FinderView = { size: [2, 1, 1], occupied: [true, true], revealed: new Map([[1, 42]]) }

function blueprint(reveal: PrizeReveal, extra: Partial<ExamineBlueprint['prize']> = {}): ExamineBlueprint {
  return { name: 'Sky Shrine', maker: 'you', description: '', view: FINDER, prize: { reveal, views: {}, ...extra }, lock: 'standard', drawnAt: 1_800_000_000 }
}

const noop = (): void => {}
function under(h: Host, pick: (n: Host) => boolean): Host[] {
  const out: Host[] = []
  const walk = (n: Host | string): void => { if (typeof n === 'string') return; if (pick(n)) out.push(n); n.children.forEach(walk) }
  walk(h)
  return out
}
const sheetOf = (m: { all: () => Host[] }): Host => m.all().find((h) => h.props.role === 'dialog')!
const prizeBox = (m: { all: () => Host[] }): string => {
  const box = m.all().find((h) => h.props.className === 'bp-ex__box' && textOf(h).startsWith('PRIZE'))
  return box ? textOf(box) : ''
}

describe('PRIZE on the sheet', () => {
  it('never names the prize unless its maker chose to: no shard name, and the blueprint title does not stand in', async () => {
    for (const reveal of ['description', 'silhouette', 'render'] as const) {
      const m = await mount(createElement(ExamineSheet, { bp: blueprint(reveal, { text: 'Something small and bright.' }), onClose: noop }))
      const box = prizeBox(m)
      // "Mystery" only when the prize is kept secret; a prize that shows says its name is hidden.
      expect(box).toContain(NAME_HIDDEN)
      expect(box.toLowerCase()).not.toContain('mystery')
      expect(box).not.toContain('Sky Shrine')
      expect(m.all().filter((h) => String(h.props.className).startsWith('bp-ex__ptitle')).map(textOf)).toEqual([NAME_HIDDEN])
      await m.unmount()
    }
    // Kept secret: a mystery, the redaction, and no name.
    const m = await mount(createElement(ExamineSheet, { bp: blueprint('hidden'), onClose: noop }))
    expect(m.all().filter((h) => h.props.className === 'bp-ex__ptitle').map(textOf)).toEqual([MYSTERY_PRIZE])
    expect(prizeBox(m)).not.toContain('Sky Shrine')
    expect(prizeBox(m)).toContain('Nothing more is shown. Build it and see.')
    await m.unmount()
  })

  it('the PRIZE tag on the panel equals the summary value, and the mapping holds: outline is hints, pictures or a shown name are public', async () => {
    const cases = [
      ['hidden', undefined, 'A mystery'],
      ['description', undefined, 'Hints only'],
      ['silhouette', undefined, 'Hints only'],
      ['render', undefined, 'Public information'],
      ['silhouette', 'Lantern of Chiba', 'Public information'],
    ] as const
    for (const [reveal, name, word] of cases) {
      const m = await mount(createElement(ExamineSheet, { bp: blueprint(reveal, name ? { name } : {}), onClose: noop }))
      const tag = m.all().find((h) => h.props.className === 'bp-ex__bh' && textOf(h).startsWith('PRIZE'))
      const row = m.all().find((h) => h.type === 'dt' && textOf(h) === 'PRIZE')
      expect(tag && textOf(tag)).toBe(`PRIZE${word}`)
      expect(prizeShort(reveal, !!name)).toBe(word)
      expect(row).toBeTruthy()
      await m.unmount()
    }
  })

  it('shows the prize\'s own name when its maker chose to show it', async () => {
    const m = await mount(createElement(ExamineSheet, { bp: blueprint('description', { name: 'Lantern of Chiba' }), onClose: noop }))
    expect(m.all().filter((h) => h.props.className === 'bp-ex__ptitle').map(textOf)).toEqual(['Lantern of Chiba'])
    await m.unmount()
  })

  it('an outline with no pictures says the pictures did not come, and nothing counts 0 views', async () => {
    const m = await mount(createElement(ExamineSheet, { bp: blueprint('silhouette'), onClose: noop }))
    expect(prizeBox(m)).toContain(NO_PICTURES)
    expect(m.says('0 views')).toBe(false)
    await m.unmount()
    expect(prizeWords('silhouette', 0)).toBe('shown as an outline')
    expect(prizeWords('render', 2)).toBe('shown as pictures in 2 views')
    expect(prizeWords('silhouette', 1)).toBe('shown as an outline in 1 view')
  })
})

describe('the summary', () => {
  const rows = (m: { all: () => Host[] }): string[] => {
    const dl = m.all().find((h) => h.props.className === 'bp-ex__settings')!
    return dl.children.map((c) => textOf(c))
  }

  it('reads MATERIALS, CONSTRUCTION, PRIZE in that order, with no numbers in front', async () => {
    const m = await mount(createElement(ExamineSheet, { bp: blueprint('silhouette'), onClose: noop }))
    expect(rows(m)).toEqual(['MATERIALS1 known / 1 unknown', 'CONSTRUCTIONMay be built anywhere', 'PRIZEHints only'])
    expect(m.says('RECIPE')).toBe(false)
    expect(m.all().filter((h) => h.type === 'dt').map(textOf)).toEqual(['MATERIALS', 'CONSTRUCTION', 'PRIZE'])
    expect(m.all().filter((h) => h.type === 'span' && textOf(h) === 'LOCK')).toHaveLength(0)
    await m.unmount()
  })

  it('a location lock names its height, here and in the title block', async () => {
    const m = await mount(createElement(ExamineSheet, { bp: { ...blueprint('hidden'), lock: 'location', height: 5 }, onClose: noop }))
    expect(rows(m)[1]).toBe('CONSTRUCTIONMust be built in a specific h5 region')
    const tb = m.all().find((h) => h.props.className === 'bp-ex__tbgrid')!
    expect(textOf(tb)).toContain('CONSTRUCTIONh5 region')
    expect(textOf(tb)).toContain('VOLUME2 × 1 × 1')
    expect(textOf(tb)).not.toContain('BOX')
    expect(textOf(tb)).not.toContain('LOCK')
    expect(rows(m)[2]).toBe('PRIZEA mystery')
    await m.unmount()
  })

  it('drops the old captions: no Y0 line and no paragraph by the compass; the views are named for the sun', async () => {
    const m = await mount(createElement(ExamineSheet, { bp: blueprint('render'), onClose: noop }))
    expect(m.says('Y0 at the bottom')).toBe(false)
    expect(m.says('1 block = 1 gibson · volume 2 × 1 × 1')).toBe(true)
    expect(m.says('Every view on this sheet')).toBe(false)
    expect(m.says('box')).toBe(false)
    expect(m.says('BOX')).toBe(false)
    expect(m.says('FACING THE SUN')).toBe(true)
    expect(m.says('FROM THE SUN')).toBe(false)
    expect(m.says('+Z up · the sun at the top edge')).toBe(true)
    expect(m.says('+Z on the right')).toBe(true)
    await m.unmount()
  })

  it('the boxes say KNOWN MATERIALS and PRIZE, PRIZE tagged with the summary\'s value', async () => {
    const m = await mount(createElement(ExamineSheet, { bp: blueprint('silhouette'), onClose: noop }))
    const heads = m.all().filter((h) => h.props.className === 'bp-ex__bh').map(textOf)
    expect(heads).toEqual(['KNOWN MATERIALS1 OF 2', 'PRIZEHints only'])
    expect(m.says('BLOCKS SHOWN')).toBe(false)
    expect(m.says('THE PRIZE')).toBe(false)
    expect(m.says('OUTLINE')).toBe(false)
    await m.unmount()
    const named = await mount(createElement(ExamineSheet, { bp: blueprint('hidden', { name: 'Lantern' }), onClose: noop }))
    expect(named.all().filter((h) => h.props.className === 'bp-ex__bh').map(textOf)[1]).toBe('PRIZEPublic information')
    await named.unmount()
  })

  it('the sheet opens with the ONOSENDAI wordmark and BLUEPRINT, and keeps no big compass in the summary', async () => {
    const m = await mount(createElement(ExamineSheet, { bp: blueprint('silhouette'), onClose: noop }))
    const kicker = m.all().find((h) => h.props.className === 'bp-ex__kicker')!
    expect(under(kicker, (h) => h.type === 'img').map((h) => [h.props.src, h.props.alt])).toEqual([['/logo.png', 'ONOSENDAI']])
    expect(textOf(kicker)).toBe('BLUEPRINT')
    expect(m.says('ONOSENDAI · BLUEPRINT')).toBe(false)
    const title = m.all().find((h) => h.type === 'section' && String(h.props.className).includes('bp-ex__panel--title'))!
    expect(under(title, (h) => h.type === 'canvas')).toHaveLength(0)
    expect(m.says('ISOMETRIC VIEW')).toBe(true)
    await m.unmount()
  })

  it('the known materials box shows only while something is unknown, with UNKNOWN and what an incorrect block costs', async () => {
    const m = await mount(createElement(ExamineSheet, { bp: blueprint('silhouette'), onClose: noop }))
    const meter = m.all().find((h) => h.props.className === 'bp-ex__meter')!
    expect(textOf(meter)).toContain('UNKNOWN 1')
    expect(textOf(meter)).toContain('ANY INCORRECT BLOCK BURNS ALL 2 ON COMPILE')
    expect(textOf(meter)).not.toContain('STILL HIDDEN')
    expect(textOf(meter)).not.toContain('A MISS')
    await m.unmount()
    const all = await mount(createElement(ExamineSheet, { bp: { ...blueprint('silhouette'), view: FULL }, onClose: noop }))
    expect(all.all().filter((h) => h.props.className === 'bp-ex__meter')).toHaveLength(0)
    await all.unmount()
  })

  it('an item blueprint wears an orange ITEM chip beside its name; others do not', async () => {
    const m = await mount(createElement(ExamineSheet, { bp: { ...blueprint('render'), item: true }, onClose: noop }))
    const row = m.all().find((h) => h.props.className === 'bp-ex__titlerow')!
    expect(textOf(row)).toBe('Sky ShrineITEM')
    await m.unmount()
    const plain = await mount(createElement(ExamineSheet, { bp: blueprint('render'), onClose: noop }))
    expect(plain.all().filter((h) => h.props.className === 'bp-item-chip')).toHaveLength(0)
    await plain.unmount()
  })

  it('PRIZE takes one of three values', () => {
    expect(prizeShort('hidden', false)).toBe('A mystery')
    expect(prizeShort('description', false)).toBe('Hints only')
    expect(prizeShort('silhouette', false)).toBe('Hints only')
    expect(prizeShort('render', false)).toBe('Public information')
    // A shown name makes it public whatever else is kept back.
    expect(prizeShort('hidden', true)).toBe('Public information')
    expect(prizeShort('description', true)).toBe('Public information')
    expect(materialsWords(5, 0)).toBe('5 known / 0 unknown')
    expect(constructionWords('standard')).toBe('May be built anywhere')
    expect(constructionWords('location', 5)).toBe('Must be built in a specific h5 region')
    expect(constructionShort('standard')).toBe('Anywhere')
    expect(constructionShort('location', 5)).toBe('h5 region')
    expect(constructionShort('location')).toBe('region')
  })
})

describe('FINDER and MAKER', () => {
  const maker: ExamineMaker = { view: FULL, prizeName: null }

  it('only a maker gets the switch', async () => {
    const m = await mount(createElement(ExamineSheet, { bp: blueprint('hidden'), onClose: noop }))
    expect(m.buttons(/^FINDER:/)).toHaveLength(0)
    expect(m.buttons(/^MAKER:/)).toHaveLength(0)
    expect(sheetOf(m).props['data-as']).toBe('finder')
    await m.unmount()
  })

  it('opens on FINDER, what others see; MAKER shows every block and is marked as the maker\'s, in place', async () => {
    const m = await mount(createElement(ExamineSheet, { bp: blueprint('hidden'), maker, onClose: noop }))
    const finderBtn = (): Host => m.buttons(/^FINDER:/)[0]!
    const makerBtn = (): Host => m.buttons(/^MAKER:/)[0]!
    expect(textOf(finderBtn())).toBe('FINDER: what others see')
    expect(textOf(makerBtn())).toBe('MAKER: everything')
    expect(finderBtn().props['aria-checked']).toBe(true)
    expect(sheetOf(m)).toMatchObject({ props: { 'data-as': 'finder', 'data-shown': 1 } })
    expect(m.says('Still hidden')).toBe(true)
    expect(m.says("MAKER'S VIEW")).toBe(false)
    const panels = m.all().filter((h) => h.type === 'section').length

    await m.press(/^MAKER:/)
    expect(makerBtn().props['aria-checked']).toBe(true)
    expect(sheetOf(m)).toMatchObject({ props: { 'data-as': 'maker', 'data-shown': 2 } })
    expect(textOf(m.all().find((h) => h.props.className === 'bp-ex__kicker')!)).toBe("MAKER'S VIEW")
    expect(m.says('EVERY BLOCK')).toBe(true)
    // Nothing comes or goes: the same panels, and the parts list keeps its slots.
    expect(m.all().filter((h) => h.type === 'section').length).toBe(panels)
    expect(m.all().filter((h) => /^bp-ex__part( |$)/.test(String(h.props.className ?? ''))).length).toBe(2)
    // The finder's meter stays what a finder sees.
    expect(m.says('FINDERS SEE 1 / 2')).toBe(true)

    await m.press(/^FINDER:/)
    expect(sheetOf(m)).toMatchObject({ props: { 'data-as': 'finder', 'data-shown': 1 } })
    await m.unmount()
  })
})

describe("the game's own blueprints say how to build them isolated (owner's lost Glowcore, 2026-11-28)", () => {
  const rows = (m: { all: () => Host[] }): string[] => {
    const dl = m.all().find((h) => h.props.className === 'bp-ex__settings')!
    return dl.children.map((c) => textOf(c))
  }

  it('CONSTRUCTION is the isolation line and how to place in open air, never "May be built anywhere"; a player\'s blueprint keeps its line', async () => {
    const m = await mount(createElement(ExamineSheet, { bp: { ...blueprint('description', { text: 'A tool.' }), game: true }, onClose: noop }))
    expect(rows(m)[1]).toBe(`CONSTRUCTION${GAME_CONSTRUCTION}${GAME_AIR_LINE}`)
    expect(m.says('May be built anywhere')).toBe(false)
    expect(m.says('Anywhere')).toBe(false)
    expect(m.says(GAME_CONSTRUCTION_SHORT)).toBe(true)
    await m.unmount()
    expect(GAME_CONSTRUCTION).toBe('Build it with a gap all round: no block may touch it, not even at an edge or corner.')
    expect(GAME_AIR_LINE).toMatch(/tapping the number under PLACE/)
    expect(constructionWords('standard', undefined, true)).toBe(GAME_CONSTRUCTION)
    expect(constructionShort('standard', undefined, true)).toBe(GAME_CONSTRUCTION_SHORT)
    expect(constructionWords('standard')).toBe('May be built anywhere')
  })

  it('the cards\' own lines say it too, and no blueprint copy uses the words for upright posture', () => {
    expect(GAME_NO_DEPLOY).toBe('Everyone gets this one. Build it in the air with a gap all round, then smash it to make your Compiler.')
    expect(QUARRY_NO_DEPLOY).toMatch(/in the air with a gap all round, then smash it for seven Quarry Charges\.$/)
    const forbidden = /stand-alone|standalone|stand alone|\bstands?\b|\bstanding\b|—|–/i
    for (const line of [GAME_NO_DEPLOY, QUARRY_NO_DEPLOY, GAME_CONSTRUCTION, GAME_CONSTRUCTION_SHORT, GAME_AIR_LINE]) expect(line).not.toMatch(forbidden)
  })
})
