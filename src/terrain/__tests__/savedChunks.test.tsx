/**
 * savedChunks.test.tsx - starring a chunk and SAVED CHUNKS on screen (owner,
 * 2026-11-28: "you can star a survey card and keep it in the mining panel in a
 * button that triggers a modal that shows all your saved chunks and then you
 * can view the chunk and it'll show you where it's at and then you can
 * navigate to it or set it as a waypoint or set it as a heads-up display
 * target"):
 *
 * - the survey card's star: the rare-find prompt, star and unstar with UNDO,
 *   one fixed line whatever it says, its card kept with the star;
 * - MINING's SAVED CHUNKS button and the list: name, finds, date, distance;
 * - a chunk's view: where it is (left-handed, facing the sun), NAVIGATE
 *   planning GOAL, SET WAYPOINT and HUD TARGET on and off, RENAME, REMOVE with
 *   UNDO in its place;
 * - the HUD TARGET in the target list, in gold, in its own plane only.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

;(globalThis as { window?: unknown }).window ??= globalThis
;(globalThis as { addEventListener?: unknown }).addEventListener ??= () => {}
;(globalThis as { removeEventListener?: unknown }).removeEventListener ??= () => {}
if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
    key: () => null,
    get length() { return mem.size },
  }
}

import { createElement } from 'react'
import { mount, textOf, type Host, type Mounted } from '../../test/elementRoot'
import { mountHook } from '../../test/hookRoot'
import { SNAPSHOT_EVERY_MS, SurveyCard } from '../SurveyCard'
import { SavedChunks } from '../SavedChunks'
import { MiningPanel } from '../../hud/MiningPanel'
import { openSavedChunks, closeSavedChunks, useSavedChunksUi } from '../savedChunksUi'
import { CARD_WATCH_MS, closeSurveyCard, openSurveyCard, resetSurveyCards } from '../surveyCard'
import { setTerrainSession, terrainSession, useTerrain, type TerrainSession } from '../../store/useTerrain'
import { useCyberspace } from '../../store/useCyberspace'
import { useGoal } from '../../store/useGoal'
import { emptyInventory } from '../../lib/terrain/terrainDb'
import { TerrainWorld } from '../../lib/terrain/world'
import { CELLS, chunkKey, idx, type ChunkBase } from '../../lib/terrain/coords'
import { forgetAssays } from '../../lib/terrain/assay'
import { STAR_GOLD } from '../../lib/terrain/starredChunk'
import { resetStarredChunks, setStarredDeps, starChunk, renameChunk, useStarredChunks, localFor } from '../../store/starredChunks'
import { useTargets } from '../../hooks/useTargets'
import type { ChunkSnapshot } from '../../lib/starredChunksRecord'

const ME = 'a'.repeat(64)
const BASE: ChunkBase = { x: 0x1234567890abcdef12340n, y: 0xfedcba0987654321fed80n, z: 0x0f0f0f0f0f0f0f0f0f0e0n, plane: 0 }
const at = (dx: number, dy: number, dz: number, plane = 0): string => chunkKey({ x: BASE.x + BigInt(dx * 32), y: BASE.y + BigInt(dy * 32), z: BASE.z + BigInt(dz * 32), plane })
const snap = (glow = 2): ChunkSnapshot => ({ g: 'volcanic', k: 14, m: 11, r: [[42, glow, 0, 1], [7, 40, 3, 0], [1, 9000, 12, 1]], d: '07'.repeat(24) + '00'.repeat(8), v: 1795799000 })
const cls = (h: Host): string => String(h.props.className ?? '')
const find = (m: Mounted, c: string): Host[] => m.all().filter((h) => cls(h).split(' ').includes(c))

/** A field with one chunk: Gridstone, a buried Glowcore (when `glow`), an open layer on top. */
function field(glow = true): string {
  const world = new TerrainWorld(BASE, { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } })
  const slot = world.slotAt(0, 0, 0, true)!
  const b = new Uint8Array(CELLS).fill(1)
  for (let o = 31 * 1024; o < CELLS; o++) b[o] = 0
  if (glow) { b[idx(10, 10, 10)] = 42; b[idx(12, 10, 10)] = 42 }
  world.setBlocks(slot.key, b, b.slice())
  slot.ground = { family: 'volcanic', maxK: 11, meanK: 7.6, top: 7 }
  const revisions = new Map([[slot.key, { revision: 2, surveyed: 1795799000 }]])
  setTerrainSession({ world, revisions, surveyedKeys: new Set([slot.key]), building: new Set() } as unknown as TerrainSession)
  return slot.key
}

beforeEach(() => {
  forgetAssays()
  resetSurveyCards()
  resetStarredChunks()
  setStarredDeps({ self: () => ME, live: () => false, storage: null, prefs: null })
  // You stand in the middle of the base chunk, facing the sun, in dataspace.
  const head = { x: BASE.x + 16n, y: BASE.y + 16n, z: BASE.z + 16n }
  useCyberspace.setState({ walking: false, position: head, cursor: head, headPlane: 0, plane: 0, anchorPlane: 0 })
  useTerrain.setState({ active: true, loading: false, sheet: false, surveying: [], inventory: emptyInventory() })
  useGoal.setState({ goal: null })
})
afterEach(() => {
  closeSavedChunks()
  setTerrainSession(null)
  useTerrain.setState({ active: false, inventory: emptyInventory() })
  resetStarredChunks()
  setStarredDeps(null)
})

describe('the survey card\'s star', () => {
  it('a rare find asks to be starred; the star saves it with its card; again takes it off, with UNDO; one fixed line throughout', async () => {
    const key = field(true)
    openSurveyCard(key)
    const m = await mount(createElement(SurveyCard))
    try {
      const star = (): Host => find(m, 'survey-card__star')[0]
      const line = (): Host => find(m, 'survey-star')[0]
      expect(textOf(line())).toBe('Glowcore here. Star this chunk to find it again.')
      expect(cls(star())).toContain('is-asking')
      expect(star().props['aria-pressed']).toBe(false)
      ;(star().props.onClick as () => void)()
      await new Promise((r) => setTimeout(r, 10))
      expect(useStarredChunks.getState().keys.has(key)).toBe(true)
      expect(star().props['aria-pressed']).toBe(true)
      expect(cls(star())).not.toContain('is-asking')
      expect(textOf(line())).toBe('Glowcore here. Saved: SAVED CHUNKS')
      // Its card went with it: two Glowcore, the ground, the hardness.
      const e = localFor(ME).rec.e[key]
      expect(e.s?.r[0]).toEqual([42, 2, 0, 0])
      expect(e.s?.g).toBe('volcanic')
      expect(e.s?.k).toBe(11)
      // The Saved line opens SAVED CHUNKS at this chunk.
      await m.press('SAVED CHUNKS')
      expect(useSavedChunksUi.getState()).toEqual({ open: true, view: key })
      closeSavedChunks()
      // Again: off, with UNDO in the same line.
      ;(star().props.onClick as () => void)()
      await new Promise((r) => setTimeout(r, 10))
      expect(useStarredChunks.getState().keys.has(key)).toBe(false)
      expect(textOf(line())).toBe('Taken off your saved chunks.UNDO')
      await m.press('UNDO')
      expect(useStarredChunks.getState().keys.has(key)).toBe(true)
      // Always the one line element, one class: nothing on the card moves.
      expect(find(m, 'survey-star')).toHaveLength(1)
    } finally {
      await m.unmount()
    }
  })

  it('while you mine with a saved chunk\'s card open, its kept card is updated at most every ten seconds, and as the card closes', async () => {
    const key = field(true)
    starChunk(key, undefined)
    openSurveyCard(key)
    const m = await mount(createElement(SurveyCard))
    let unmounted = false
    try {
      await new Promise((r) => setTimeout(r, 20))
      // Kept as the card first counts.
      const first = localFor(ME).rec.e[key].s
      expect(first?.r[0][1]).toBe(2)
      // You mine both Glowcore: the card counts again (four times a second at most), the kept card waits.
      const slot = terrainSession!.world.slotByKey(key)!
      slot.blocks![idx(10, 10, 10)] = 0; slot.blocks![idx(12, 10, 10)] = 0; slot.version++
      await new Promise((r) => setTimeout(r, CARD_WATCH_MS + 120))
      expect(m.all().filter((h) => cls(h).split(' ').includes('survey-row')).map(textOf)[0]).toMatch(/^Glowcore/)
      expect(localFor(ME).rec.e[key].s?.r[0][1]).toBe(2)
      expect(SNAPSHOT_EVERY_MS).toBe(10_000)
      // Closing the card keeps its last count.
      closeSurveyCard()
      await m.unmount()
      unmounted = true
      expect(localFor(ME).rec.e[key].s?.r[0][1]).toBe(0)
    } finally {
      if (!unmounted) await m.unmount()
    }
  })

  it('a card with nothing rare offers the star quietly', async () => {
    const key = field(false)
    openSurveyCard(key)
    const m = await mount(createElement(SurveyCard))
    try {
      expect(textOf(find(m, 'survey-star')[0])).toBe('Star this chunk to find it again.')
      expect(cls(find(m, 'survey-card__star')[0])).not.toContain('is-asking')
    } finally {
      await m.unmount()
    }
  })
})

describe('SAVED CHUNKS', () => {
  it('MINING\'s button says how many and opens the list', async () => {
    starChunk(at(0, 0, 3), snap())
    starChunk(at(2, 0, 0), snap())
    const m = await mount(createElement(MiningPanel))
    try {
      expect(m.says('SAVED CHUNKS (2)')).toBe(true)
      await m.press('SAVED CHUNKS (2)')
      expect(useSavedChunksUi.getState()).toEqual({ open: true, view: null })
    } finally {
      await m.unmount()
    }
  })

  it('lists each saved chunk with its name, finds, date and distance; the arrow turns with the sun at the top', async () => {
    starChunk(at(0, 0, 3), snap())
    starChunk(at(2, 0, 0), snap(0))
    renameChunk(at(2, 0, 0), 'Cinder ridge')
    openSavedChunks()
    const m = await mount(createElement(SavedChunks))
    try {
      const rows = find(m, 'saved-row')
      expect(rows).toHaveLength(2)
      const texts = rows.map(textOf)
      expect(texts.some((t) => t.includes('Glowcore ×2, Cinderrock ×40') && t.includes('Volcanic ground · Hardness 14 / 16') && t.includes('3 chunks'))).toBe(true)
      expect(texts.some((t) => t.includes('Cinder ridge') && t.includes('Cinderrock ×40') && t.includes('2 chunks'))).toBe(true)
      expect(texts.every((t) => /Saved \d{1,2} [A-Z][a-z]{2} \d{4}/.test(t))).toBe(true)
      // Ahead (+Z) points up the compass; to the right (+X) points right.
      const arrows = find(m, 'saved-arrow').map((h) => (h.props.style as Record<string, string>)['--deg'])
      expect(arrows.sort()).toEqual(['0deg', '90deg'])
    } finally {
      await m.unmount()
    }
  })

  it('a chunk\'s view: where it is, NAVIGATE plans GOAL there, WAYPOINT and HUD TARGET each toggle, REMOVE leaves UNDO in its place', async () => {
    const key = at(1, 2, 3)
    starChunk(key, snap())
    starChunk(at(0, 0, 9), snap())
    openSavedChunks(key)
    const m = await mount(createElement(SavedChunks))
    try {
      expect(m.says('WHERE IT IS')).toBe(true)
      expect(m.says('3 chunks')).toBe(true)
      expect(m.says('96 gibsons')).toBe(true)
      expect(m.says('Ahead')).toBe(true)
      expect(m.says('64 gibsons above you')).toBe(true)
      expect(m.says('Facing the sun')).toBe(true)
      expect(m.all().some((h) => h.type === 'svg' && cls(h).includes('saved-locator'))).toBe(true)
      // The saved card, in the field card's parts.
      expect(m.says('STARRED')).toBe(true)
      expect(m.says('FINDS')).toBe(true)
      expect(find(m, 'survey-row')).toHaveLength(3)

      await m.press('SET WAYPOINT')
      expect(useStarredChunks.getState().guide).toEqual({ key, waypoint: true, hud: false })
      expect(m.says('WAYPOINT ON')).toBe(true)
      await m.press('HUD TARGET')
      expect(useStarredChunks.getState().guide).toEqual({ key, waypoint: true, hud: true })
      await m.press('WAYPOINT ON')
      expect(useStarredChunks.getState().guide).toEqual({ key, waypoint: false, hud: true })
      await m.press('HUD TARGET ON')
      expect(useStarredChunks.getState().guide).toBeNull()

      await m.press('RENAME')
      const input = m.all().find((h) => h.type === 'input')!
      ;(input.props.onChange as (e: unknown) => void)({ target: { value: 'Glowcore cave' } })
      await new Promise((r) => setTimeout(r, 5))
      const form = m.all().find((h) => h.type === 'form')!
      ;(form.props.onSubmit as (e: unknown) => void)({ preventDefault: () => {} })
      await new Promise((r) => setTimeout(r, 10))
      expect(localFor(ME).rec.e[key].n).toBe('Glowcore cave')
      expect(m.says('Glowcore cave')).toBe(true)

      await m.press('REMOVE')
      expect(useStarredChunks.getState().keys.has(key)).toBe(false)
      expect(useSavedChunksUi.getState().view).toBeNull()
      expect(m.says('Removed Glowcore cave')).toBe(true)
      // The UNDO row takes the removed row's place: two rows still.
      expect(find(m, 'saved-row')).toHaveLength(2)
      await m.press('UNDO')
      expect(useStarredChunks.getState().keys.has(key)).toBe(true)
      expect(localFor(ME).rec.e[key].n).toBe('Glowcore cave')
    } finally {
      await m.unmount()
    }
  })

  it('NAVIGATE plans the trip to the chunk\'s centre with GOAL, signing nothing, and leaves the modals', async () => {
    const key = at(1, 0, 2)
    starChunk(key, snap())
    openSavedChunks(key)
    const m = await mount(createElement(SavedChunks))
    try {
      await m.press('NAVIGATE')
      const goal = useGoal.getState().goal
      expect(goal?.target).toEqual({ x: BASE.x + 32n + 16n, y: BASE.y + 16n, z: BASE.z + 64n + 16n })
      expect(goal?.plane).toBe(0)
      expect(goal?.label).toBe('Glowcore ×2, Cinderrock ×40')
      expect(useSavedChunksUi.getState().open).toBe(false)
    } finally {
      await m.unmount()
    }
  })
})

describe('the HUD TARGET', () => {
  it('is in the target list in gold at the chunk\'s centre while on, in its own plane only, and gone when off', async () => {
    const key = at(4, 0, 0)
    starChunk(key, snap())
    const h = mountHook(() => useTargets(), {})
    try {
      expect(h.current().some((t) => t.id === 'starred-chunk')).toBe(false)
      useStarredChunks.setState({ guide: { key, waypoint: false, hud: true } })
      await new Promise((r) => setTimeout(r, 10))
      const t = h.current().find((x) => x.id === 'starred-chunk')
      expect(t).toMatchObject({ color: STAR_GOLD, label: 'GLOWCORE ×2, CINDERROCK ×40', at: { x: BASE.x + 128n + 16n, y: BASE.y + 16n, z: BASE.z + 16n } })
      // The scene in ideaspace: a dataspace chunk is not a place there.
      useCyberspace.setState({ anchorPlane: 1 })
      await new Promise((r) => setTimeout(r, 10))
      expect(h.current().some((x) => x.id === 'starred-chunk')).toBe(false)
      useCyberspace.setState({ anchorPlane: 0 })
      useStarredChunks.setState({ guide: { key, waypoint: true, hud: false } })
      await new Promise((r) => setTimeout(r, 10))
      expect(h.current().some((x) => x.id === 'starred-chunk')).toBe(false)
    } finally {
      await h.unmount()
    }
  })
})
