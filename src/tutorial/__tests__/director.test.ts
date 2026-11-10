/**
 * director.test.ts - running the tutorial stages the guide's things and
 * sends none of them anywhere (first-arrival tutorial design, 2026-11-10,
 * D1; §8 "No guide-key event ever reaches a relay. Verify with a network log
 * in a test").
 *
 * The relay module is replaced so every publish and every query is logged:
 * the real store, the real director and the real stager run.
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

const log = vi.hoisted(() => ({ published: [] as Array<{ pubkey: string; kind: number }>, queried: [] as unknown[] }))
vi.mock('../../lib/relay', async (orig) => {
  const real = await orig<typeof import('../../lib/relay')>()
  return {
    ...real,
    publish: vi.fn(async (e: { pubkey: string; kind: number }) => { log.published.push(e); return { ok: true, accepted: [] } }),
    publishMany: vi.fn(async (_r: unknown, e: { pubkey: string; kind: number }) => { log.published.push(e); return { ok: true, accepted: [] } }),
    query: vi.fn(async (f: unknown) => { log.queried.push(f); return [] }),
  }
})

import { useCyberspace } from '../../store/useCyberspace'
import { useTutorial } from '../../store/useTutorial'
import { useShards } from '../../store/useShards'
import { useOpenedChests, openedKey } from '../../store/useOpenedChests'
import { useInventory } from '../../store/useInventory'
import { useTutorialStage } from '../director'
import { guideBagsFor } from '../guideBags'
import { GUIDE_KEY } from '../guide'
import { TUTORIAL_SCRIPT } from '../script'

const pubkey = (): string => useCyberspace.getState().identity.pubkey
/** Until the stage is in (staging computes two region keys and signs a few events). */
async function staged(): Promise<void> {
  for (let i = 0; i < 200 && !useTutorialStage.getState().stage; i++) await new Promise((r) => setTimeout(r, 10))
  expect(useTutorialStage.getState().stage).not.toBe(null)
}

beforeEach(() => {
  log.published.length = 0
  log.queried.length = 0
  useTutorial.setState({ script: TUTORIAL_SCRIPT })
})
afterEach(() => { useTutorial.getState().pause() })

describe('the director', () => {
  it('stages under a guide key of its own on start, hands the bags to discovery, and takes them back on stop', async () => {
    useTutorial.getState().start({ restart: true })
    await staged()
    const stage = useTutorialStage.getState().stage!
    expect(stage.player).toBe(pubkey())
    expect(stage.guide).not.toBe(pubkey())
    expect(localStorage.getItem(GUIDE_KEY)).toMatch(/^[0-9a-f]{64}$/)
    const lookups = stage.bags.map((b) => b.tags.find((t) => t[0] === 'd')![1])
    expect(guideBagsFor(lookups)).toHaveLength(2)
    useTutorial.getState().pause()
    expect(guideBagsFor(lookups)).toEqual([])
    expect(useTutorialStage.getState().stage).toBe(null)
  })

  it('reuses the kept stage on a resume, and stages a new chest on RESTART', async () => {
    useTutorial.getState().start({ restart: true })
    await staged()
    const first = useTutorialStage.getState().stage!
    useTutorial.getState().pause()
    useTutorial.getState().start({ at: 'box' })
    await staged()
    expect(useTutorialStage.getState().stage!.ids).toEqual(first.ids)
    useTutorial.getState().start({ restart: true })
    await staged()
    expect(useTutorialStage.getState().stage!.ids.chest).not.toBe(first.ids.chest)
  })

  it('never publishes anything, and never asks a relay about the guide', async () => {
    useTutorial.getState().start({ restart: true })
    await staged()
    const guide = useTutorialStage.getState().stage!.guide
    expect(log.published.filter((e) => e.pubkey === guide)).toEqual([])
    expect(log.published).toEqual([])
    expect(JSON.stringify(log.queried)).not.toContain(guide)
  })

  it('counts the chest found, opened by hand and taken from, and nothing before', async () => {
    useTutorial.getState().start({ restart: true })
    await staged()
    const stage = useTutorialStage.getState().stage!
    const at = (id: string): number => useTutorial.getState().script.steps.findIndex((s) => s.id === id)
    // The box step: done only once the scan has found the chest.
    expect(useTutorial.getState().index).toBe(0)
    useTutorial.getState().next()
    expect(useTutorial.getState().index).toBe(at('box'))
    expect(useTutorial.getState().done).toBe(false)
    useShards.setState({ discovered: { ...useShards.getState().discovered, [stage.ids.chest]: {} as never } })
    expect(useTutorial.getState().done).toBe(true)
    useTutorial.getState().next()
    expect(useTutorial.getState().index).toBe(at('open'))
    expect(useTutorial.getState().done).toBe(false)
    useOpenedChests.setState({ opened: { [openedKey(pubkey(), stage.ids.chest)]: [] } })
    expect(useTutorial.getState().done).toBe(true)
    useTutorial.getState().next()
    expect(useTutorial.getState().index).toBe(at('take'))
    expect(useTutorial.getState().done).toBe(false)
    useInventory.setState({ items: { [stage.ids.chestContents[1]]: { id: stage.ids.chestContents[1] } as never } })
    expect(useTutorial.getState().done).toBe(true)
  })
})
