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
import { START_STAND, courseToWorld } from '../course'
import { toWorld } from '../layout'
import { useWalk } from '../../store/useWalk'

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
    expect(guideBagsFor(lookups)).toHaveLength(3)
    useTutorial.getState().pause()
    expect(guideBagsFor(lookups)).toEqual([])
    expect(useTutorialStage.getState().stage).toBe(null)
  })

  it('takes what the guide sealed off the screen when the tutorial goes away', async () => {
    useTutorial.getState().start({ restart: true })
    await staged()
    const stage = useTutorialStage.getState().stage!
    const theirs = { eventId: stage.ids.chest, author: stage.guide } as never
    const other = { eventId: 'x'.repeat(64), author: 'y'.repeat(64) } as never
    useShards.setState({ discovered: { [stage.ids.chest]: theirs, ['x'.repeat(64)]: other } })
    useTutorial.getState().pause()
    expect(Object.keys(useShards.getState().discovered)).toEqual(['x'.repeat(64)])
  })

  it('keeps what the guide sealed on screen when the tutorial finishes, local only (feedback item 9)', async () => {
    useTutorial.getState().start({ restart: true })
    await staged()
    const stage = useTutorialStage.getState().stage!
    const theirs = { eventId: stage.ids.chest, author: stage.guide } as never
    useShards.setState({ discovered: { [stage.ids.chest]: theirs } })
    const lookups = stage.bags.map((b) => b.tags.find((t) => t[0] === 'd')![1])
    // FINISH keeps the finds and the bags; nothing was ever published.
    useTutorial.getState().end('finished')
    expect(Object.keys(useShards.getState().discovered)).toContain(stage.ids.chest)
    expect(guideBagsFor(lookups)).toHaveLength(3)
    expect(log.published).toEqual([])
    // Clean up for the next test: a skip takes it all away again.
    useTutorial.getState().start({ restart: true })
    useTutorial.getState().end('skipped')
    useShards.setState({ discovered: {} })
  })

  it('lines the first move up one gibson in front of the chest, facing it (feedback item 4)', async () => {
    useTutorial.getState().start({ restart: true })
    await staged()
    const layout = useTutorialStage.getState().layout!
    useTutorial.getState().start({ at: 'box' })
    await staged()
    // The chest sits at the frame's (3, 3, 3); the cursor lands a gibson nearer the way in.
    expect(useCyberspace.getState().cursor).toEqual(toWorld(layout.frame, 2, 3, 3))
  })

  it('never lets a staging a RESTART overtook overwrite the kept stage', async () => {
    useTutorial.getState().start({ restart: true })
    useTutorial.getState().start({ restart: true })
    await staged()
    for (let i = 0; i < 50; i++) await new Promise((r) => setTimeout(r, 10))
    const shown = useTutorialStage.getState().stage!
    const kept = JSON.parse(localStorage.getItem(`onosendai:tutorial:stage:${pubkey()}`)!) as { ids: { chest: string } }
    expect(kept.ids.chest).toBe(shown.ids.chest)
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

  it('counts the course: the start reached, WALK and GRAVITY on, the finish chest found and taken from', async () => {
    useTutorial.getState().start({ restart: true })
    await staged()
    const { stage, layout } = useTutorialStage.getState()
    const go = (id: string): void => useTutorial.getState().start({ at: id })
    go('to-course')
    await staged()
    expect(useTutorial.getState().done).toBe(false)
    // The aim effect lined the cursor up on the start square, at 2^0.
    const want = courseToWorld(layout!.frame, START_STAND)
    expect(useCyberspace.getState().cursor).toEqual(want)
    // Standing somewhere else on the chain: not yet; on the start square: done.
    const head = (at: { x: bigint; y: bigint; z: bigint }): void => useCyberspace.setState({ events: [{ id: 'e', tags: [] } as never], position: at, headPlane: layout!.plane })
    head({ ...want, z: want.z + 40n })
    expect(useTutorial.getState().done).toBe(false)
    head(want)
    expect(useTutorial.getState().done).toBe(true)
    useWalk.setState({ gravity: false })
    useCyberspace.setState({ walking: true })
    go('gravity')
    await staged()
    expect(useTutorial.getState().done).toBe(false)
    useWalk.setState({ gravity: true })
    expect(useTutorial.getState().done).toBe(true)
    useCyberspace.setState({ walking: false })
    go('run')
    await staged()
    // RUN needs WALK: resumed without it, the tutorial goes back to the WALK step.
    expect(useTutorial.getState().script.steps[useTutorial.getState().index].id).toBe('walk')
    useCyberspace.setState({ walking: true })
    go('run')
    await staged()
    expect(useTutorial.getState().script.steps[useTutorial.getState().index].id).toBe('run')
    // Found but not standing on the deck (a bounce flew through its region): not yet.
    useShards.setState({ discovered: { ...useShards.getState().discovered, [stage!.ids.finishChest]: {} as never } })
    expect(useTutorial.getState().done).toBe(false)
    head(courseToWorld(layout!.frame, [0, 10, 31]))
    expect(useTutorial.getState().done).toBe(true)
    useCyberspace.setState({ walking: false })
    go('finish')
    await staged()
    expect(useTutorial.getState().done).toBe(false)
    useInventory.setState({ items: { [stage!.ids.finishContents[2]]: { id: stage!.ids.finishContents[2] } as never } })
    expect(useTutorial.getState().done).toBe(true)
    useCyberspace.setState({ events: [], position: useCyberspace.getState().position })
    useWalk.setState({ gravity: false })
  })

  it('counts the workshop once it was opened and closed again, and OPEN WORKSHOP opens it only when tapped', async () => {
    const { useWorkshop } = await import('../../store/useWorkshop')
    const { runTutorialEffect } = await import('../../store/useTutorial')
    useWorkshop.setState({ open: false })
    useTutorial.getState().start({ restart: true })
    useTutorial.getState().start({ at: 'workshop' })
    expect(useTutorial.getState().done).toBe(false)
    expect(useWorkshop.getState().open).toBe(false)
    runTutorialEffect('open-workshop')
    expect(useWorkshop.getState().open).toBe(true)
    expect(useTutorial.getState().done).toBe(false)
    useWorkshop.getState().closeWorkshop()
    expect(useTutorial.getState().done).toBe(true)
  })

  it('waits on a workshop already open, and on a shard DEPLOY lined up to place, before the next card comes', async () => {
    const { useWorkshop } = await import('../../store/useWorkshop')
    useWorkshop.setState({ open: true })
    useTutorial.getState().start({ restart: true })
    useTutorial.getState().start({ at: 'workshop' })
    expect(useTutorial.getState().done).toBe(false)
    // DEPLOY: the workshop closes and a placement is lined up.
    useShards.setState({ pending: { type: 'shard' } as never })
    useWorkshop.setState({ open: false })
    expect(useTutorial.getState().done).toBe(false)
    useShards.setState({ pending: null })
    expect(useTutorial.getState().done).toBe(true)
  })

  it('shows Earth without moving the player into another plane', async () => {
    const { runTutorialEffect } = await import('../../store/useTutorial')
    useCyberspace.setState({ plane: 1, headPlane: 1, anchorPlane: 1 } as never)
    runTutorialEffect('view-earth')
    expect(useCyberspace.getState().focus?.label).toBe('EARTH')
    expect(useCyberspace.getState().headPlane).toBe(1)
    useCyberspace.getState().clearFocus(true)
    expect(useCyberspace.getState().plane).toBe(1)
  })
})
