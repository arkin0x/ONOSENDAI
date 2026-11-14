/**
 * exitKeepsPlayerData.test.ts - leaving the tutorial, every way, takes away
 * only what the guide staged, never what the player made (owner, 2026-11-14:
 * "a user built stuff during the tutorial and leaving the tutorial deleted
 * everything he built, not just the tutorial shards"; it turned out to be
 * shards hidden at height 13, which another device never scans, see
 * hud/__tests__/autoHeightMax.test.tsx, but the exits are held to it here).
 *
 * The player's own things stand in every store a run could touch: a row they
 * hid (useShards mine), its find on screen (discovered, by their own key), a
 * shard of their own in the workshop, an item in ITEMS. Each exit (SKIP or the
 * coach's X, FINISH, a pause or the panel's switch off, RESTART, a resume, a
 * kept stage made stale by a STAGE_VERSION bump, another identity) must leave
 * all of it, publish nothing (no deletion above all), and still take the
 * guide's finds away where the design says it does.
 *
 * The real store, director and stager run; the relay module only logs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const m = new Map<string, string>()
  ;(globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
  }
})

const log = vi.hoisted(() => ({ published: [] as Array<{ pubkey: string; kind: number }> }))
vi.mock('../../lib/relay', async (orig) => {
  const real = await orig<typeof import('../../lib/relay')>()
  return {
    ...real,
    publish: vi.fn(async (e: { pubkey: string; kind: number }) => { log.published.push(e); return { ok: true, accepted: [] } }),
    publishMany: vi.fn(async (_r: unknown, e: { pubkey: string; kind: number }) => { log.published.push(e); return { ok: true, accepted: [] } }),
    query: vi.fn(async () => []),
  }
})
vi.mock('../../hooks/useMenuOpen', async (orig) => {
  const real = await orig<typeof import('../../hooks/useMenuOpen')>()
  return { ...real, setMenuOpen: vi.fn() }
})

import { useCyberspace } from '../../store/useCyberspace'
import { useTutorial } from '../../store/useTutorial'
import { useShards, type MyDeployment } from '../../store/useShards'
import { useWorkshop } from '../../store/useWorkshop'
import { useInventory } from '../../store/useInventory'
import { useTutorialStage } from '../director'
import { TUTORIAL_SCRIPT } from '../script'
import { STAGE_PREFIX } from '../stage'

const me = (): string => useCyberspace.getState().identity.pubkey

async function staged(): Promise<void> {
  for (let i = 0; i < 200 && !useTutorialStage.getState().stage; i++) await new Promise((r) => setTimeout(r, 10))
  expect(useTutorialStage.getState().stage).not.toBe(null)
}

const OWN_ROW = 'a'.repeat(64)
const OWN_FIND = 'b'.repeat(64)
const OWN_SHARD = 'my-own-thing'
const OWN_ITEM = 'c'.repeat(64)

/** The player's own things, in every store a run could touch; and one find of the guide's. */
function playerMade(guide: string, guideFind: string): void {
  const row = { eventId: OWN_ROW, type: 'shard', lookupId: 'd'.repeat(64), keyHex: 'e'.repeat(64), height: 13, plane: 0, x: '1', y: '1', z: '1', createdAt: 1, published: true, inner: { id: OWN_ROW, pubkey: me(), kind: 3330, tags: [], content: '', created_at: 1 } } as unknown as MyDeployment
  useShards.setState({
    mine: [row],
    discovered: {
      [OWN_FIND]: { eventId: OWN_FIND, author: me() } as never,
      [guideFind]: { eventId: guideFind, author: guide } as never,
    },
  })
  useWorkshop.setState({ shards: [...useWorkshop.getState().shards.filter((s) => s.id !== OWN_SHARD), { id: OWN_SHARD, name: 'My Own Thing', vertices: [], faces: [], unit: 0 } as never] })
  useInventory.setState({ items: { ...useInventory.getState().items, [OWN_ITEM]: { id: OWN_ITEM, type: 'message', text: 'mine' } as never } })
}

function expectPlayerDataKept(): void {
  expect(useShards.getState().mine.map((d) => d.eventId)).toEqual([OWN_ROW])
  expect(useShards.getState().mine[0].goneFrom).toBeUndefined()
  expect(useShards.getState().discovered[OWN_FIND]).toBeDefined()
  expect(useWorkshop.getState().shards.some((s) => s.id === OWN_SHARD)).toBe(true)
  expect(useInventory.getState().items[OWN_ITEM]).toBeDefined()
  expect(Object.keys(useShards.getState().deletedBags ?? {})).toEqual([])
  expect(log.published).toEqual([])
}

/** A run started, staged, and the player's things in place, with the guide's chest found. */
async function runWithPlayerData(): Promise<{ guide: string; chest: string }> {
  useTutorial.getState().start({ restart: true })
  await staged()
  const stage = useTutorialStage.getState().stage!
  playerMade(stage.guide, stage.ids.chest)
  return { guide: stage.guide, chest: stage.ids.chest }
}

beforeEach(() => {
  log.published.length = 0
  useTutorial.setState({ script: TUTORIAL_SCRIPT })
})
afterEach(() => {
  if (useTutorial.getState().active) useTutorial.getState().pause()
  useShards.setState({ mine: [], discovered: {} })
})

describe('leaving the tutorial keeps everything the player made', () => {
  it('SKIP (and the coach’s X, which is the same end): the guide’s finds go, the player’s stay', async () => {
    const { chest } = await runWithPlayerData()
    useTutorial.getState().end('skipped')
    expect(useShards.getState().discovered[chest]).toBeUndefined()
    expectPlayerDataKept()
  })

  it('FINISH: the guide’s finds stay too, local only', async () => {
    const { chest } = await runWithPlayerData()
    useTutorial.getState().end('finished')
    expect(useShards.getState().discovered[chest]).toBeDefined()
    expectPlayerDataKept()
  })

  it('a pause (the panel’s switch off, the tour, TV): the guide’s finds go, the player’s stay', async () => {
    const { chest } = await runWithPlayerData()
    useTutorial.getState().pause()
    expect(useShards.getState().discovered[chest]).toBeUndefined()
    expectPlayerDataKept()
  })

  it('RESTART, from a running run and from a finished one: only the old run’s guide finds go', async () => {
    const { chest } = await runWithPlayerData()
    useTutorial.getState().start({ restart: true })
    await staged()
    expect(useShards.getState().discovered[chest]).toBeUndefined()
    expectPlayerDataKept()
    const second = useTutorialStage.getState().stage!
    playerMade(second.guide, second.ids.chest)
    useTutorial.getState().end('finished')
    useTutorial.getState().start({ restart: true })
    await staged()
    expect(useShards.getState().discovered[second.ids.chest]).toBeUndefined()
    expectPlayerDataKept()
  })

  it('RESUME, and a kept stage made stale by a STAGE_VERSION bump staged again: the player’s things stay', async () => {
    await runWithPlayerData()
    useTutorial.getState().pause()
    // A stage kept by an older build: not this version, so the resume stages a new one.
    const kept = JSON.parse(localStorage.getItem(STAGE_PREFIX + me())!) as { v: number }
    localStorage.setItem(STAGE_PREFIX + me(), JSON.stringify({ ...kept, v: kept.v - 1 }))
    useTutorial.getState().start({ at: TUTORIAL_SCRIPT.steps[1].id })
    await staged()
    expectPlayerDataKept()
    useTutorial.getState().end('skipped')
    expectPlayerDataKept()
  })
})
