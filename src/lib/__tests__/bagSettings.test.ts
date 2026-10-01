/**
 * bagSettings.test.ts - what a bag says in public (lib/hidden.ts BagSettings,
 * arkinox 2026-10-01): its optional `h` (spec §8.6), a sector hint with its
 * sector tags (§7.7, §10), and a riddle in `content` (§7.7). Every combination
 * writes exactly its tags, reads back as itself, and a bag without `h` still
 * opens at its true height when the reader knows the key's height.
 */

import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { regionKeyAt } from '../shardCrypto'
import {
  DEFAULT_BAG_SETTINGS,
  MAX_RIDDLE_LENGTH,
  bagSettingsOf,
  bagTemplate,
  messageInnerTemplate,
  resolveBagSettings,
  unbag,
  type BagSettings,
} from '../hidden'
import { SECTOR_HINT, hintTags } from '../hint'

const sk = generateSecretKey()
const at = { x: 90_000n + (7n << 40n), y: 4_000n + (3n << 50n), z: 71n }
const HEIGHT = 6
const rk = regionKeyAt(at, HEIGHT, 20)
const place = { at, plane: 0 as const }

async function bagWith(settings: BagSettings): Promise<ReturnType<typeof finalizeEvent>> {
  const inner = finalizeEvent(messageInnerTemplate('under the bridge', at, 0, 1), sk)
  return finalizeEvent(await bagTemplate([inner], rk.key, rk.lookupId, HEIGHT, 100, undefined, settings, place), sk)
}

const names = (tags: string[][]): string[] => tags.map((t) => t[0])

describe('bagTemplate writes exactly the tags each combination asks for', () => {
  const sector = hintTags(at, 0, SECTOR_HINT)
  const cases: [string, BagSettings, string[], string][] = [
    ['defaults: h, no hint, no riddle', DEFAULT_BAG_SETTINGS, ['d', 'encrypted', 'version', 'h'], ''],
    ['h off', { heightTag: false, hint: null, riddle: '' }, ['d', 'encrypted', 'version'], ''],
    ['sector hint', { heightTag: true, hint: SECTOR_HINT, riddle: '' }, ['d', 'encrypted', 'version', 'h', 'hint', 'X', 'Y', 'Z', 'S'], ''],
    ['sector hint, h off', { heightTag: false, hint: SECTOR_HINT, riddle: '' }, ['d', 'encrypted', 'version', 'hint', 'X', 'Y', 'Z', 'S'], ''],
    ['riddle only', { heightTag: true, hint: null, riddle: '  where the black sun sets ' }, ['d', 'encrypted', 'version', 'h'], 'where the black sun sets'],
    ['everything', { heightTag: true, hint: SECTOR_HINT, riddle: 'look up' }, ['d', 'encrypted', 'version', 'h', 'hint', 'X', 'Y', 'Z', 'S'], 'look up'],
  ]
  for (const [label, settings, tagNames, content] of cases) {
    it(label, async () => {
      const ev = await bagWith(settings)
      expect(names(ev.tags)).toEqual(tagNames)
      expect(ev.content).toBe(content)
      if (settings.heightTag) expect(ev.tags).toContainEqual(['h', String(HEIGHT)])
      if (settings.hint) for (const t of sector) expect(ev.tags).toContainEqual(t)
      expect(bagSettingsOf(ev, HEIGHT)).toEqual({ ...settings, riddle: content })
    })
  }

  it('caps the riddle', async () => {
    const ev = await bagWith({ ...DEFAULT_BAG_SETTINGS, riddle: 'x'.repeat(MAX_RIDDLE_LENGTH + 50) })
    expect(ev.content).toHaveLength(MAX_RIDDLE_LENGTH)
  })

  it('refuses a hint that cannot contain the region, and a hint with no place', async () => {
    const inner = finalizeEvent(messageInnerTemplate('x', at, 0, 1), sk)
    const high = regionKeyAt(at, 4, 20)
    await expect(bagTemplate([inner], high.key, high.lookupId, 31, 1, undefined, { ...DEFAULT_BAG_SETTINGS, hint: SECTOR_HINT }, place)).rejects.toThrow(/cannot contain/)
    await expect(bagTemplate([inner], rk.key, rk.lookupId, HEIGHT, 1, undefined, { ...DEFAULT_BAG_SETTINGS, hint: SECTOR_HINT })).rejects.toThrow(/place/)
  })
})

describe('a bag without h (spec §8.6: optional)', () => {
  it('opens at the height of the key that opened it, with its settings on every item', async () => {
    const ev = await bagWith({ heightTag: false, hint: SECTOR_HINT, riddle: 'cold' })
    const found = await unbag(ev, rk.key, undefined, undefined, HEIGHT)
    expect(found).toHaveLength(1)
    expect(found[0].height).toBe(HEIGHT)
    expect(found[0].text).toBe('under the bridge')
    expect(found[0].bag).toEqual({ heightTag: false, hint: SECTOR_HINT, riddle: 'cold' })
  })

  it('without a known height still opens, at 0, as before', async () => {
    const ev = await bagWith({ ...DEFAULT_BAG_SETTINGS, heightTag: false })
    const found = await unbag(ev, rk.key)
    expect(found).toHaveLength(1)
    expect(found[0].height).toBe(0)
  })

  it('a bag with h reads its h when no height is known', async () => {
    const found = await unbag(await bagWith(DEFAULT_BAG_SETTINGS), rk.key)
    expect(found[0].height).toBe(HEIGHT)
  })
})

describe('resolveBagSettings: what you changed wins, what you left takes the bag\'s current value', () => {
  const seed: BagSettings = { heightTag: true, hint: null, riddle: 'old riddle' }

  it('carries forward a riddle and hint written elsewhere since the controls were seeded', () => {
    const current: BagSettings = { heightTag: true, hint: SECTOR_HINT, riddle: 'newer riddle' }
    expect(resolveBagSettings(seed, seed, current, HEIGHT)).toEqual(current)
  })

  it('keeps a change you made, including clearing the riddle on purpose', () => {
    const chosen: BagSettings = { heightTag: false, hint: null, riddle: '' }
    expect(resolveBagSettings(chosen, seed, { ...seed, hint: SECTOR_HINT }, HEIGHT)).toEqual({ heightTag: false, hint: SECTOR_HINT, riddle: '' })
  })

  it('takes the choices as they are for a region with no bag yet', () => {
    const chosen: BagSettings = { heightTag: false, hint: SECTOR_HINT, riddle: 'new' }
    expect(resolveBagSettings(chosen, DEFAULT_BAG_SETTINGS, null, HEIGHT)).toEqual(chosen)
  })

  it('never lets defaults overwrite an existing bag the controls were not seeded from', () => {
    const current: BagSettings = { heightTag: false, hint: [11, 11, 11], riddle: 'kept' }
    expect(resolveBagSettings(DEFAULT_BAG_SETTINGS, DEFAULT_BAG_SETTINGS, current, HEIGHT)).toEqual(current)
  })

  it('drops a hint that cannot contain the region', () => {
    expect(resolveBagSettings({ ...DEFAULT_BAG_SETTINGS, hint: SECTOR_HINT }, DEFAULT_BAG_SETTINGS, null, 31).hint).toBeNull()
  })
})
