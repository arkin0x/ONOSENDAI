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

const menu = vi.hoisted(() => ({ calls: [] as boolean[] }))
vi.mock('../../hooks/useMenuOpen', async (orig) => {
  const real = await orig<typeof import('../../hooks/useMenuOpen')>()
  return { ...real, setMenuOpen: vi.fn((open: boolean) => { menu.calls.push(open) }) }
})

import { useCyberspace } from '../../store/useCyberspace'
import { runTutorialEffect, useTutorial } from '../../store/useTutorial'
import { usePanelLayout } from '../../store/usePanelLayout'
import { useShards } from '../../store/useShards'
import { useOpenedChests, openedKey } from '../../store/useOpenedChests'
import { useInventory } from '../../store/useInventory'
import { FINER_KEY, cursorOnTarget, useTutorialStage } from '../director'
import { guideBagsFor, passesTaps } from '../guideBags'
import { GUIDE_KEY } from '../guide'
import { COMMIT, PAD_ARROWS, TUTORIAL_SCRIPT } from '../script'
import { PLOT_STAND, START_STAND, TARGET, courseToWorld, targetAt } from '../course'
import { arrivalCell, chestCell, toWorld } from '../layout'
import { TUTORIAL_DNA_EVENT } from '../dna'
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

/**
 * The moon blossom's DNA in ITEMS, as TAKE files it out of the welcome chest
 * (item 8). PLANT THE SEED presses the owner's id, and this file's relays hold
 * nothing (query is mocked to answer []): the press gets past the DNA only
 * because the director notes the copy held here first.
 */
function holdDna(): void {
  useInventory.setState({ items: { ...useInventory.getState().items, [TUTORIAL_DNA_EVENT.id]: { id: TUTORIAL_DNA_EVENT.id, type: 'dna', event: TUTORIAL_DNA_EVENT } as never } })
}

async function expectShippedTree(): Promise<void> {
  const { tutorialDnaId, TUTORIAL_DNA_EVENT } = await import('../dna')
  expect(TUTORIAL_DNA_EVENT.id).toBe(tutorialDnaId())
}

describe('the director', () => {
  it('stages under a guide key of its own on start, hands the bags to discovery, and takes them back on stop', async () => {
    useTutorial.getState().start({ restart: true })
    await staged()
    const stage = useTutorialStage.getState().stage!
    // Taps pass through the green box and the hop target (review, 2026-11-13).
    expect(passesTaps(stage.ids.blueBox)).toBe(true)
    expect(passesTaps(stage.ids.target)).toBe(true)
    expect(passesTaps(stage.ids.chest)).toBe(false)
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
    // A RESTART then drops the old run's kept find before staging a new chest, so none is orphaned.
    useTutorial.getState().start({ restart: true })
    await staged()
    expect(Object.keys(useShards.getState().discovered)).not.toContain(stage.ids.chest)
    useTutorial.getState().end('skipped')
    useShards.setState({ discovered: {} })
  })

  it('lines the first move up level with the chest, two gibsons in front of it, one empty gibson between (feedback 2026-11-12, item 1)', async () => {
    useTutorial.getState().start({ restart: true })
    await staged()
    const layout = useTutorialStage.getState().layout!
    useTutorial.getState().start({ at: 'box' })
    await staged()
    const cursor = useCyberspace.getState().cursor
    const a = arrivalCell(layout)
    expect(cursor).toEqual(toWorld(layout.frame, a.f, a.r, a.u))
    // Same height as the chest, and two apart along exactly one axis.
    const c = chestCell(layout)
    const chest = toWorld(layout.frame, c.f, c.r, c.u)
    expect(cursor.y).toBe(chest.y)
    const off = [cursor.x - chest.x, cursor.y - chest.y, cursor.z - chest.z].map((d) => (d < 0n ? -d : d))
    expect(off.filter((d) => d !== 0n)).toEqual([2n])
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
    // Something else taken is not enough: the step waits for the moon blossom's DNA (feedback 2026-11-12, item 8).
    useInventory.setState({ items: { [stage.ids.chestContents[1]]: { id: stage.ids.chestContents[1] } as never } })
    expect(useTutorial.getState().done).toBe(false)
    expect(stage.ids.chestContents).toContain(TUTORIAL_DNA_EVENT.id)
    holdDna()
    expect(useTutorial.getState().done).toBe(true)
    useInventory.setState({ items: {} })
  })

  it('counts the course: the target reached, WALK and GRAVITY on, the finish chest found and taken from', async () => {
    useTutorial.getState().start({ restart: true })
    await staged()
    const { stage, layout } = useTutorialStage.getState()
    const go = (id: string): void => useTutorial.getState().start({ at: id })
    go('to-course')
    await staged()
    expect(useTutorial.getState().done).toBe(false)
    const want = targetAt(layout!.frame)
    // Standing somewhere else on the chain: not yet; on the start square below the target: not yet; on the target: done.
    const head = (at: { x: bigint; y: bigint; z: bigint }): void => useCyberspace.setState({ events: [{ id: 'e', tags: [] } as never], position: at, headPlane: layout!.plane })
    head({ ...want, z: want.z + 40n })
    expect(useTutorial.getState().done).toBe(false)
    head(courseToWorld(layout!.frame, START_STAND))
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

  it('the course step never aims the cursor: the player moves it onto the target, the arrows glow until it is there, then COMMIT (owner, 2026-11-13)', async () => {
    useTutorial.getState().start({ restart: true })
    await staged()
    const layout = useTutorialStage.getState().layout!
    // A head of their own, inside the cover, at a coarser zoom than 2^0.
    const at = toWorld(layout.frame, PLOT_STAND.f, PLOT_STAND.r, PLOT_STAND.u)
    useCyberspace.setState({ events: [{ id: 'e', tags: [] } as never], position: at, cursor: { ...at, x: at.x + 3n }, headPlane: layout.plane, plane: layout.plane, walking: false })
    useCyberspace.getState().adjustScale(2 - useCyberspace.getState().scaleExp)
    useTutorial.getState().start({ at: 'to-course' })
    await staged()
    const t = (): ReturnType<typeof useTutorial.getState> => useTutorial.getState()
    expect(t().script.steps[t().index].id).toBe('to-course')
    // Not aimed: the cursor is home on the player (the scene's 'self'), not on the target or the start square; at 2^0.
    const target = targetAt(layout.frame)
    expect(useCyberspace.getState().cursor).toEqual(at)
    expect(useCyberspace.getState().cursor).not.toEqual(courseToWorld(layout.frame, START_STAND))
    expect(useCyberspace.getState().scaleExp).toBe(0)
    expect(cursorOnTarget()).toBe(false)
    // The arrows glow (the step's own highlight), not COMMIT.
    expect(t().stepHighlight).toBe(null)
    expect(t().script.steps[t().index].scene?.highlight).toBe(PAD_ARROWS)
    // Near the target is not on it: one under, one beside.
    for (const near of [{ ...target, y: target.y - 1n }, { ...target, x: target.x + 1n }, courseToWorld(layout.frame, START_STAND)]) {
      useCyberspace.setState({ cursor: near })
      expect(cursorOnTarget()).toBe(false)
      expect(t().stepHighlight).toBe(null)
    }
    // On it: COMMIT glows. The step is not done by the cursor alone; it waits for the HOP to land.
    useCyberspace.setState({ cursor: { ...target } })
    expect(cursorOnTarget()).toBe(true)
    expect(t().stepHighlight).toBe(COMMIT)
    expect(t().done).toBe(false)
    // At a coarser scale the arrows move 2 or more a press: the finer-scale key glows, the way back to 2^0.
    useCyberspace.getState().adjustScale(1)
    expect(cursorOnTarget()).toBe(false)
    expect(t().stepHighlight).toBe(FINER_KEY)
    useCyberspace.getState().adjustScale(-1)
    useCyberspace.setState({ cursor: { ...target } })
    expect(t().stepHighlight).toBe(COMMIT)
    // Off it again: back to the arrows.
    useCyberspace.setState({ cursor: { ...target, z: target.z + 2n } })
    expect(t().stepHighlight).toBe(null)
    useCyberspace.setState({ cursor: { ...target } })
    // Landed on it: done, and the next step points where its own scene says.
    useCyberspace.setState({ position: { ...target } })
    expect(t().done).toBe(true)
    t().next()
    expect(t().script.steps[t().index].id).toBe('walk')
    expect(t().stepHighlight).toBe(null)
    expect(TARGET[1]).toBe(START_STAND[1] + 2)
    useCyberspace.setState({ events: [] })
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

  it('copies the shards found into the workshop on the tutorial\'s workshop step, once, filed under Tutorial, and opens it on a course piece with its MENU up (feedback 2026-11-12, item 10)', async () => {
    const { useWorkshop } = await import('../../store/useWorkshop')
    const { useShardFolders } = await import('../../store/useShardFolders')
    const { copyTutorialShards, TUTORIAL_SHARD_ID, TUTORIAL_FOLDER } = await import('../director')
    const { fromPayload } = await import('sno-core/shards')
    const trampoline = fromPayload((await import('../pieces/trampoline-4.json')).default, 't')!
    const platform = fromPayload((await import('../pieces/plat-square-6.json')).default, 'p')!
    const trophy = fromPayload((await import('../pieces/trophy.json')).default, 'w')!
    useWorkshop.setState({ open: false, shards: [], currentId: null, openPanel: null })
    useTutorial.getState().start({ restart: true })
    await staged()
    useTutorial.getState().start({ at: 'workshop' })
    await staged()
    const stage = useTutorialStage.getState().stage!
    const mine = (): string[] => useWorkshop.getState().shards.map((m) => m.id).filter((id) => id.startsWith(TUTORIAL_SHARD_ID)).sort()
    expect(mine()).toEqual([])
    // Found: two course pieces in the world (one twice), a shard someone else hid, and the trophy taken from the welcome chest.
    useShards.setState({ discovered: {
      a: { author: stage.guide, type: 'shard', shard: trampoline } as never,
      b: { author: stage.guide, type: 'shard', shard: platform } as never,
      c: { author: stage.guide, type: 'shard', shard: platform } as never,
      d: { author: 'f'.repeat(64), type: 'shard', shard: { ...platform, name: 'Not ours' } } as never,
      // The hop target, found from the spawn: a marker, never copied (review, 2026-11-13).
      [stage.ids.target]: { eventId: stage.ids.target, author: stage.guide, type: 'shard', shard: { ...platform, name: 'Target' } } as never,
    } })
    useInventory.setState({ items: { w: { id: 'w', type: 'shard', shard: trophy, from: { chestId: stage.ids.chest, chestName: 'x' } } as never } })
    // Nothing is copied until the workshop step asks: OPEN WORKSHOP copies them, and opens on the trampoline with the MENU asked for.
    expect(mine()).toEqual([])
    runTutorialEffect('open-workshop')
    expect(mine()).toEqual([`${TUTORIAL_SHARD_ID}platform-6`, `${TUTORIAL_SHARD_ID}trampoline`, `${TUTORIAL_SHARD_ID}trophy`])
    expect(useWorkshop.getState().open).toBe(true)
    expect(useWorkshop.getState().currentId).toBe(`${TUTORIAL_SHARD_ID}trampoline`)
    expect(useWorkshop.getState().openPanel).toBe('menu')
    // Once: running it again adds nothing.
    expect(copyTutorialShards()).toBe(`${TUTORIAL_SHARD_ID}trampoline`)
    expect(mine()).toHaveLength(3)
    // Filed in the Tutorial folder.
    const tree = useShardFolders.getState().tree
    const folder = Object.entries(tree.folders).find(([, f]) => f.name === TUTORIAL_FOLDER)?.[0]
    expect(folder).toBeDefined()
    for (const id of mine()) expect(tree.assign[id]).toBe(folder)
    // Only the first opening is set up: back from a DEPLOY's CANCEL, or a REMIX, keeps the shard it names.
    useWorkshop.setState({ open: false, openPanel: null })
    useWorkshop.getState().openWorkshop(`${TUTORIAL_SHARD_ID}trophy`)
    expect(useWorkshop.getState().currentId).toBe(`${TUTORIAL_SHARD_ID}trophy`)
    expect(useWorkshop.getState().openPanel).toBe(null)
    useWorkshop.setState({ open: false, openPanel: null })
    // A fresh workshop step: its first opening by another way (the menu's button) is set up the same.
    useTutorial.getState().start({ at: 'workshop' })
    await staged()
    useWorkshop.setState({ open: false, openPanel: null, currentId: `${TUTORIAL_SHARD_ID}trophy` })
    useWorkshop.getState().openWorkshop()
    expect(useWorkshop.getState().currentId).toBe(`${TUTORIAL_SHARD_ID}trampoline`)
    expect(useWorkshop.getState().openPanel).toBe('menu')
    useWorkshop.setState({ open: false, openPanel: null })
    useShards.setState({ discovered: {} })
    useInventory.setState({ items: {} })
  })

  it('NEXT on the ITEMS step closes the menu it opened; BACK does not (feedback 2026-11-12, item 15)', async () => {
    useTutorial.getState().start({ restart: true })
    menu.calls.length = 0
    useTutorial.getState().start({ at: 'inventory' })
    expect(menu.calls).toEqual([true])
    useTutorial.getState().back()
    expect(menu.calls).toEqual([true])
    useTutorial.getState().next()
    expect(useTutorial.getState().script.steps[useTutorial.getState().index].id).toBe('inventory')
    expect(menu.calls).toEqual([true, true])
    useTutorial.getState().next()
    expect(menu.calls).toEqual([true, true, false])
    expect(useTutorial.getState().script.steps[useTutorial.getState().index].id).toBe('to-course')
  })

  it('counts the plot reached and a seed of the player\'s own planted, lining the cursor up on the dirt', async () => {
    useTutorial.getState().start({ restart: true })
    await staged()
    const { layout } = useTutorialStage.getState()
    useTutorial.getState().start({ at: 'to-plot' })
    await staged()
    const stand = toWorld(layout!.frame, PLOT_STAND.f, PLOT_STAND.r, PLOT_STAND.u)
    expect(useCyberspace.getState().cursor).toEqual(stand)
    expect(useTutorial.getState().done).toBe(false)
    useCyberspace.setState({ events: [{ id: 'e', tags: [] } as never], position: stand, headPlane: layout!.plane })
    expect(useTutorial.getState().done).toBe(true)
    // Planted: a seed of the player's own, on the dirt, growing the tutorial DNA, out unless LOCAL.
    const { dnaResolver } = await import('../../lib/seeds/seedSources')
    const { TUTORIAL_DNA } = await import('../dna')
    const { seedTemplate, dnaTemplate } = await import('../../lib/seeds/plant')
    const { ORIGINAL_DNAS } = await import('../../lib/seeds/originalDnas')
    const { finalizeEvent, generateSecretKey, getPublicKey } = await import('nostr-tools/pure')
    const { minePow } = await import('nostr-tools/nip13')
    const me = generateSecretKey()
    const dnaOf = (text: string, caps = TUTORIAL_DNA.caps) => { const ev = finalizeEvent(dnaTemplate(text, caps, 1_800_000_000), me); dnaResolver.note(ev as never); return ev }
    const tree = dnaOf(TUTORIAL_DNA.text)
    const fern = dnaOf(ORIGINAL_DNAS[0].text, ORIGINAL_DNAS[0].caps)
    const seedRow = (dnaId: string, at: { x: bigint; y: bigint; z: bigint }, published = true) => {
      // With the work a seed owes at the base price (DECK-0008 §8.2), or no reader reads it.
      const t = seedTemplate({ dnaId, relayHint: '', planted: 900_000, scale: 0, at, plane: layout!.plane, title: '', createdAt: 1_800_000_000 })
      const inner = finalizeEvent(minePow({ ...t, pubkey: getPublicKey(me) }, 16), me)
      return { eventId: inner.id, type: 'seed', inner, at: { x: String(at.x), y: String(at.y), z: String(at.z) }, plane: layout!.plane, published } as never
    }
    useTutorial.getState().start({ at: 'plant' })
    expect(useTutorial.getState().done).toBe(false)
    useCyberspace.getState().setLive(true)
    // Past the tutorial's covering region, along X: the far side of it from the dirt.
    const out = { ...stand, x: layout!.cover.base.x + (1n << BigInt(layout!.cover.height)) + 4n }
    // Another tree on the dirt; the tree outside the tutorial's region; the tree on the dirt but no relay took it (LIVE): none count.
    useShards.setState({ mine: [seedRow(fern.id, stand)] })
    await new Promise((r) => setTimeout(r, 20))
    expect(useTutorial.getState().done).toBe(false)
    useShards.setState({ mine: [seedRow(tree.id, out)] })
    expect(useTutorial.getState().done).toBe(false)
    useShards.setState({ mine: [seedRow(tree.id, stand, false)] })
    expect(useTutorial.getState().done).toBe(false)
    useShards.setState({ mine: [seedRow(tree.id, stand)] })
    // Its DNA is resolved (asynchronously), then it counts.
    await vi.waitFor(() => { expect(useTutorial.getState().done).toBe(true) })
    // A reload after planting finds it planted.
    useTutorial.getState().start({ at: 'plant' })
    await vi.waitFor(() => { expect(useTutorial.getState().done).toBe(true) })
    // A seed naming the owner's event counts at once, in the tutorial's region; outside it, not.
    const { tutorialTreePlanted } = await import('../director')
    const ownerId = 'c'.repeat(64)
    useShards.setState({ mine: [seedRow(ownerId, stand)] })
    expect(tutorialTreePlanted(undefined, ownerId)).toBe(true)
    expect(tutorialTreePlanted(undefined, null)).toBe(false)
    useShards.setState({ mine: [seedRow(ownerId, out)] })
    expect(tutorialTreePlanted(undefined, ownerId)).toBe(false)
    // The bud leaves BUILD, so the course step can line its COMMIT up.
    const { useBuilder } = await import('../../store/useBuilder')
    useBuilder.setState({ active: true } as never)
    useTutorial.getState().start({ at: 'bud' })
    expect(useBuilder.getState().active).toBe(false)
    useShards.setState({ mine: [] })
    useCyberspace.setState({ events: [] })
  }, 60_000)

  /**
   * The owner, 2026-11-13: "after I hid the seed, I shouldnt have to exit the
   * hide overlay, exit build, return to avatar, and then... the tutorial
   * window still says plant the seed, so im stuck / oh im stuck because i
   * moved the build cursor". The tutorial seed counts wherever in the
   * tutorial's region it is hidden, and then the tutorial backs out for them.
   */
  describe('the plant step after HIDE (owner, 2026-11-13)', () => {
    async function onThePlot() {
      const { finalizeEvent, generateSecretKey, getPublicKey } = await import('nostr-tools/pure')
      const { minePow } = await import('nostr-tools/nip13')
      const { seedTemplate, dnaTemplate } = await import('../../lib/seeds/plant')
      const { dnaResolver } = await import('../../lib/seeds/seedSources')
      const { ORIGINAL_DNAS } = await import('../../lib/seeds/originalDnas')
      const { plantCell } = await import('../course')
      useTutorial.getState().start({ restart: true })
      await staged()
      const { layout } = useTutorialStage.getState()
      const stand = toWorld(layout!.frame, PLOT_STAND.f, PLOT_STAND.r, PLOT_STAND.u)
      const aimed = plantCell(layout!.frame, stand)!
      const me = generateSecretKey()
      const fern = finalizeEvent(dnaTemplate(ORIGINAL_DNAS[0].text, ORIGINAL_DNAS[0].caps, 1_800_000_000), me)
      dnaResolver.note(fern as never)
      const seedRow = (dnaId: string, at: { x: bigint; y: bigint; z: bigint }, plane = layout!.plane) => {
        const t = seedTemplate({ dnaId, relayHint: '', planted: 900_000, scale: 0, at, plane, title: '', createdAt: 1_800_000_000 })
        const inner = finalizeEvent(minePow({ ...t, pubkey: getPublicKey(me) }, 16), me)
        return { eventId: inner.id, type: 'seed', inner, at: { x: String(at.x), y: String(at.y), z: String(at.z) }, plane, published: false } as never
      }
      useCyberspace.getState().setLive(false)
      useCyberspace.setState({ events: [{ id: 'e', tags: [] } as never], position: stand, cursor: stand, headPlane: layout!.plane })
      if (useCyberspace.getState().scaleExp !== 0) useCyberspace.getState().adjustScale(-useCyberspace.getState().scaleExp)
      return { layout: layout!, stand, aimed, fern, seedRow }
    }

    it('counts the tutorial seed hidden off the aimed cell (a cell or two over, a gibson down or up, anywhere in the tutorial\'s region); never another DNA, the other plane or outside the region', async () => {
      const { tutorialTreePlanted } = await import('../director')
      const { layout, stand, aimed, fern, seedRow } = await onThePlot()
      const { fwd, side } = layout.frame
      const tree = TUTORIAL_DNA_EVENT.id
      // Cells off the aimed one in the box's frame: across the dirt, down into it, up off it, to its corner.
      const off = (df: number, dr: number, du: number) => ({ x: aimed.x + BigInt(dr * side), y: aimed.y + BigInt(du), z: aimed.z + BigInt(df * fwd) })
      const counted = [aimed, off(0, 1, 0), off(2, 0, 0), off(-2, -1, 0), off(0, 0, -1), off(0, 0, 1), off(0, 0, 2), off(2, 1, 1),
        // Off the dirt, but still in the tutorial's region: beside the plot, at the course's start, back by the green box.
        off(0, 0, 5), courseToWorld(layout.frame, START_STAND), toWorld(layout.frame, 2, 2, 2)]
      for (const at of counted) {
        useShards.setState({ mine: [seedRow(tree, at)] })
        expect(tutorialTreePlanted(), `tree at ${at.x},${at.y},${at.z}`).toBe(true)
        useShards.setState({ mine: [seedRow(fern.id, at)] })
        expect(tutorialTreePlanted(), `fern at ${at.x},${at.y},${at.z}`).toBe(false)
      }
      // The other plane, and outside the region (each axis): not the tutorial's.
      useShards.setState({ mine: [seedRow(tree, aimed, (1 - layout.plane) as 0 | 1)] })
      expect(tutorialTreePlanted()).toBe(false)
      const size = 1n << BigInt(layout.cover.height)
      for (const k of ['x', 'y', 'z'] as const) {
        useShards.setState({ mine: [seedRow(tree, { ...stand, [k]: layout.cover.base[k] + size })] })
        expect(tutorialTreePlanted(), `past the region along ${k}`).toBe(false)
        useShards.setState({ mine: [seedRow(tree, { ...stand, [k]: layout.cover.base[k] - 1n })] })
        expect(tutorialTreePlanted(), `before the region along ${k}`).toBe(false)
      }
      // Through the engine: a tree hidden one gibson under the aimed cell (the owner's move) completes the plant wait.
      useShards.setState({ mine: [] })
      useTutorial.getState().start({ at: 'plant' })
      await staged()
      expect(useTutorial.getState().done).toBe(false)
      useShards.setState({ mine: [seedRow(tree, off(0, 0, -1))] })
      expect(useTutorial.getState().done).toBe(true)
      useShards.setState({ mine: [] })
      useCyberspace.setState({ events: [] })
    }, 60_000)

    it('PLANT THE SEED again after a HIDE that did not count (outside the tutorial\'s region) lines a fresh seed up, never taking the copy HIDE left for the tree', async () => {
      const { lineUpTutorialSeed } = await import('../director')
      const { useBuilder } = await import('../../store/useBuilder')
      const { TUTORIAL_DNA } = await import('../dna')
      const { stand, aimed } = await onThePlot()
      holdDna()
      useBuilder.setState({ active: false } as never)
      // As HIDE leaves the tree: its clone lined up again (useShards againOf), BUILD on.
      useBuilder.getState().enter('build')
      const copy = { type: 'seed', seed: { text: TUTORIAL_DNA.text, caps: TUTORIAL_DNA.caps, scale: 0 } } as never
      useShards.setState({ pending: copy, placedLast: { pending: copy } as never, deployStatus: 'done' } as never)
      useCyberspace.setState({ position: stand })
      expect(await lineUpTutorialSeed(null, async () => 3)).toBe(null)
      const now = useShards.getState().pending
      expect(now).not.toBe(copy)
      expect(now).toMatchObject({ type: 'seed', seed: { text: TUTORIAL_DNA.text } })
      expect(useCyberspace.getState().cursor).toEqual(aimed)
      useShards.setState({ pending: null, placedLast: null, deployStatus: 'idle' } as never)
      useBuilder.getState().exit()
      useCyberspace.setState({ events: [] })
    }, 60_000)

    it('once the plant counts, the tutorial goes on by itself and closes the hide bar, BUILD and the build view: the player is back on their avatar', async () => {
      const { useBuilder, BUILD_FOCUS_LABEL } = await import('../../store/useBuilder')
      const { ADVANCE_MS } = await import('../../store/useTutorial')
      const { stand, aimed, seedRow } = await onThePlot()
      // As HIDE leaves it: BUILD on, its view driven to the cursor in the dirt
      // beside the avatar, and a copy of the seed lined up again (useShards
      // placedLast), which is the hide bar still up.
      useBuilder.getState().enter('build')
      useCyberspace.setState({ cursor: { ...aimed } })
      const copy = { type: 'seed', seed: { text: 'x' } } as never
      useTutorial.getState().start({ at: 'plant' })
      await staged()
      // In the deploy's own order (useShards): the seed's row first, while the
      // hide is still working with the seed itself lined up, which counts;
      // then, done, the copy lined up again.
      const seed = { type: 'seed', seed: { text: 'x' } } as never
      useShards.setState({ pending: seed, placedLast: null, deployStatus: 'working' } as never)
      useShards.setState({ mine: [seedRow(TUTORIAL_DNA_EVENT.id, aimed)] })
      expect(useTutorial.getState().done).toBe(true)
      useShards.setState({ pending: copy, placedLast: { pending: copy } as never, deployStatus: 'done' } as never)
      expect(useBuilder.getState().active).toBe(true)
      await vi.waitFor(() => { expect(useTutorial.getState().script.steps[useTutorial.getState().index].id).toBe('bud') }, { timeout: ADVANCE_MS + 2_000 })
      expect(useShards.getState().pending).toBe(null)
      expect(useBuilder.getState().active).toBe(false)
      expect(useCyberspace.getState().focus).toBe(null)
      expect(useCyberspace.getState().cursor).toEqual(stand)
      expect(useCyberspace.getState().scaleExp).toBe(0)

      // Still hiding as the bud comes up: it waits for the hide to end, then backs out the same.
      useBuilder.getState().enter('build')
      useCyberspace.setState({ cursor: { ...aimed } })
      const hiding = { type: 'seed', seed: { text: 'y' } } as never
      useShards.setState({ pending: hiding, placedLast: null, deployStatus: 'working' } as never)
      useTutorial.getState().start({ at: 'bud' })
      expect(useBuilder.getState().active).toBe(true)
      expect(useCyberspace.getState().focus?.label).toBe(BUILD_FOCUS_LABEL)
      useShards.setState({ pending: copy, placedLast: { pending: copy } as never, deployStatus: 'done' } as never)
      await Promise.resolve()
      expect(useShards.getState().pending).toBe(null)
      expect(useBuilder.getState().active).toBe(false)
      expect(useCyberspace.getState().focus).toBe(null)

      // BUILD left by hand before the bud: the view it left behind still goes.
      useBuilder.getState().enter('build')
      useCyberspace.setState({ cursor: { ...aimed } })
      useBuilder.getState().exit()
      expect(useCyberspace.getState().focus?.label).toBe(BUILD_FOCUS_LABEL)
      useTutorial.getState().start({ at: 'bud' })
      expect(useCyberspace.getState().focus).toBe(null)

      // Something of the player's own lined up is never dropped: BUILD stays for it.
      useBuilder.getState().enter('build')
      useShards.setState({ pending: { type: 'message', text: 'hi' } as never, placedLast: null, deployStatus: 'idle' } as never)
      useTutorial.getState().start({ at: 'bud' })
      expect(useShards.getState().pending).toMatchObject({ type: 'message' })
      expect(useBuilder.getState().active).toBe(true)
      useShards.setState({ pending: null, mine: [] } as never)
      useBuilder.getState().exit()
      useCyberspace.setState({ events: [] })
    }, 60_000)
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

  it('PLANT THE SEED lines the tutorial tree up in BUILD on the dirt; with the owner\'s event set it names that event; it waits, refuses and never replaces', async () => {
    const { lineUpTutorialSeed } = await import('../director')
    const { TUTORIAL_DNA } = await import('../dna')
    const { useBuilder } = await import('../../store/useBuilder')
    const { dnaResolver } = await import('../../lib/seeds/seedSources')
    const { inPlot } = await import('../course')
    const { finalizeEvent, generateSecretKey } = await import('nostr-tools/pure')
    const template = (await import('../moon-blossom-v2-event.json')).default
    useTutorial.getState().start({ restart: true })
    await staged()
    const { layout } = useTutorialStage.getState()
    const stand = toWorld(layout!.frame, PLOT_STAND.f, PLOT_STAND.r, PLOT_STAND.u)
    useBuilder.setState({ active: false } as never)
    useShards.setState({ pending: null, deployStatus: 'idle' } as never)
    // Off the dirt: refused, nothing lined up.
    useCyberspace.setState({ events: [{ id: 'e', tags: [] } as never], position: { ...stand, x: stand.x + 40n }, cursor: { ...stand, x: stand.x + 40n }, headPlane: layout!.plane })
    expect(await lineUpTutorialSeed(null)).toMatch(/Stand on the dirt/)
    expect(useShards.getState().pending).toBe(null)
    // On the dirt, at another zoom with the cursor elsewhere: BUILD on the avatar at 2^0, the seed lands on the dirt.
    useCyberspace.setState({ position: stand, cursor: { ...stand, z: stand.z + 30n }, anchorPlane: (1 - layout!.plane) as 0 | 1 })
    useCyberspace.getState().adjustScale(3)
    const r0 = await lineUpTutorialSeed(null)
    expect(r0).toBe(null)
    expect(useBuilder.getState().active).toBe(true)
    expect(useCyberspace.getState().scaleExp).toBe(0)
    expect(inPlot(layout!.frame, useCyberspace.getState().cursor)).toBe(true)
    // In the dirt beside the avatar, never on it (feedback 2026-11-12, item 6): one gibson below
    // where the avatar stands, so the seed sits in the dirt (owner, 2026-11-13: "the cursor needs to
    // be 1g lower so the seed is in the dirt").
    const planted = useCyberspace.getState().cursor
    expect(planted).not.toEqual(stand)
    expect(planted.y).toBe(stand.y - 1n)
    // To one side (the world's X here), so it is not right behind the avatar down the view's forward axis.
    expect(planted.z).toBe(stand.z)
    expect(planted.x - stand.x === 1n || planted.x - stand.x === -1n).toBe(true)
    // Built in the plane the player stands in, whatever plane a view had.
    const { buildPlane } = await import('../../lib/buildCursor')
    expect(buildPlane(useCyberspace.getState())).toBe(layout!.plane)
    expect(useShards.getState().pending).toMatchObject({ type: 'seed', seed: { text: TUTORIAL_DNA.text, caps: TUTORIAL_DNA.caps, scale: 0 } })
    expect((useShards.getState().pending as { seed: { dnaId?: string } }).seed.dnaId).toBeUndefined()
    // Its hide height is the one SEED's seedHideFor picks for this tree at this spot, with the bloom measured
    // from the same Seeds pieces SEED's useSeedFit uses (its last day, where it lands). This holds the wiring
    // (cursor, plane, step, ceiling, the deploy's rule); if lib/seeds/bloomReach bloomReachAt changes, change seedReach here.
    const { seedHideFor, previewRequest, bloomReachGibsons, previewLastDay } = await import('../../lib/seeds/plant')
    const { growInWorker } = await import('../../lib/seeds/growClient')
    const { headerBook, trustedTip } = await import('../../lib/seeds/seedSources')
    const { getStopByHeight, useHyperspace } = await import('../../store/useHyperspace')
    const { positionHex } = await import('../../lib/events')
    const { MAX_COMPUTE_HEIGHT } = await import('../../store/useCyberspace')
    const now = trustedTip() ?? useHyperspace.getState().tipHeight ?? 975_300
    const seedReach = async (p: { x: bigint; y: bigint; z: bigint }): Promise<number | undefined> => {
      const req = previewRequest({ text: TUTORIAL_DNA.text, caps: TUTORIAL_DNA.caps, coord: positionHex(p, layout!.plane), scale: 0, tip: now, day: previewLastDay(TUTORIAL_DNA.caps), hashOf: (h) => headerBook.hash(h) ?? getStopByHeight(h)?.blockHash })
      const answer = await growInWorker({ ...req, key: 'preview-reach' })
      return answer.type === 'bloom' ? bloomReachGibsons(answer.buffers.positions, 0) : undefined
    }
    const cursor = useCyberspace.getState().cursor
    const seedPicks = await seedHideFor(cursor, layout!.plane, 0, MAX_COMPUTE_HEIGHT, seedReach)
    const fit = (useShards.getState().pending as { seed: { fit?: { height: number; reach: number; cursor: string; step: number } } }).seed.fit
    expect(fit).toEqual({ height: seedPicks.height, reach: seedPicks.reach, cursor: positionHex(cursor, layout!.plane), step: 0 })
    // Low, as the owner ruled it should be where the bloom fits: never the fallback 12 for this small tree.
    expect(fit!.height).toBeGreaterThanOrEqual(3)
    expect(fit!.height).toBeLessThan(12)
    // ... and the deploy hides it there (DeployBar's own rule, seedDraftHeight).
    const { seedDraftHeight } = await import('../../lib/seeds/plant')
    expect(seedDraftHeight(fit, cursor, layout!.plane, 0, MAX_COMPUTE_HEIGHT)).toBe(seedPicks.height)
    // A second tap while it mines changes nothing.
    const lined = useShards.getState().pending
    useShards.setState({ deployStatus: 'working' } as never)
    expect(await lineUpTutorialSeed(null)).toBe(null)
    expect(useShards.getState().pending).toBe(lined)
    // Something else lined up: the player's to finish first.
    useShards.setState({ pending: { type: 'message', text: 'hi' } as never, deployStatus: 'idle' } as never)
    expect(await lineUpTutorialSeed(null)).toMatch(/Finish or cancel/)
    expect(useShards.getState().pending).toMatchObject({ type: 'message' })
    useShards.setState({ pending: null })
    useBuilder.setState({ active: false } as never)
    // Published but not on this device's relays; or not this tree: refused, each in its own words.
    const missing = 'b'.repeat(64)
    vi.spyOn(dnaResolver, 'resolve').mockResolvedValueOnce({ state: 'missing', id: missing })
    expect(await lineUpTutorialSeed(missing)).toMatch(/not on your relays yet/)
    const other = finalizeEvent({ kind: 3350, created_at: 1_800_000_000, tags: template.tags, content: template.content.replace('moon blossom', 'sun blossom') }, generateSecretKey())
    dnaResolver.note(other as never)
    await dnaResolver.resolve(other.id)
    expect(await lineUpTutorialSeed(other.id)).toMatch(/not this one/)
    expect(useShards.getState().pending).toBe(null)
    // Published and found: the seed names the owner's event, at its size limit.
    const owner = finalizeEvent({ kind: template.kind, created_at: 1_800_000_000, tags: template.tags, content: template.content }, generateSecretKey())
    dnaResolver.note(owner as never)
    await dnaResolver.resolve(owner.id)
    expect(await lineUpTutorialSeed(owner.id)).toBe(null)
    expect(useShards.getState().pending).toMatchObject({ type: 'seed', seed: { dnaId: owner.id, text: TUTORIAL_DNA.text } })
    useShards.setState({ pending: null })
    useBuilder.setState({ active: false } as never)
  }, 120_000)

  it('the plant step\'s note is its own: shown while it is up, gone on the next step', async () => {
    const { runTutorialEffect } = await import('../../store/useTutorial')
    await expectShippedTree()
    useTutorial.getState().start({ restart: true })
    await staged()
    useTutorial.getState().start({ at: 'plant' })
    await staged()
    useCyberspace.setState({ events: [{ id: 'e', tags: [] } as never], position: { x: 0n, y: 0n, z: 0n } })
    // The moon blossom not taken from the welcome chest: the note says to take it (feedback 2026-11-12, item 8).
    useInventory.setState({ items: {} })
    const { TAKE_DNA_FIRST } = await import('../director')
    runTutorialEffect('plant-tutorial-seed')
    await vi.waitFor(() => { expect(useTutorial.getState().stepNote).toBe(TAKE_DNA_FIRST) })
    expect(TAKE_DNA_FIRST).toBe('Take the MOON BLOSSOM DNA from the welcome chest first.')
    // Taken: planted from the DNA held, which gets it past the DNA to where the player stands.
    holdDna()
    runTutorialEffect('plant-tutorial-seed')
    await vi.waitFor(() => { expect(useTutorial.getState().stepNote).toMatch(/Stand on the dirt/) })
    useTutorial.getState().next()
    expect(useTutorial.getState().stepNote).toBe(null)
    expect(useTutorialStage.getState().error).toBe(null)
    useCyberspace.setState({ events: [] })
  })

  it('PLANT THE SEED, after its measure: lines nothing up if the cursor, step or plane moved, BUILD was left, something else was lined up, or the tutorial moved on', async () => {
    const { lineUpTutorialSeed } = await import('../director')
    const { useBuilder } = await import('../../store/useBuilder')
    useTutorial.getState().start({ restart: true })
    await staged()
    const { layout } = useTutorialStage.getState()
    const stand = toWorld(layout!.frame, PLOT_STAND.f, PLOT_STAND.r, PLOT_STAND.u)
    /** A measure that waits until `go()`, while the test changes something. */
    const held = () => { let go: () => void = () => {}; const p = new Promise<void>((r) => { go = r }); return { go: () => go(), reachAt: async () => { await p; return 4 } } }
    const fresh = () => {
      useBuilder.setState({ active: false } as never)
      useShards.setState({ pending: null, deployStatus: 'idle' } as never)
      useCyberspace.setState({ events: [{ id: 'e', tags: [] } as never], position: stand, cursor: stand, headPlane: layout!.plane })
    }
    const meanwhile: Array<[string, () => void, RegExp | null]> = [
      ['the cursor moved', () => useCyberspace.setState({ cursor: { ...stand, x: stand.x + 3n } }), /cursor moved/],
      ['the step changed', () => useCyberspace.getState().adjustScale(2), /cursor moved/],
      ['the plane changed', () => useCyberspace.getState().setPlane((1 - layout!.plane) as 0 | 1), /cursor moved/],
      ['BUILD was left', () => useBuilder.getState().exit(), /BUILD was left/],
      ['something else was lined up', () => useShards.setState({ pending: { type: 'message', text: 'hi' } as never }), /Finish or cancel/],
    ]
    for (const [what, change, want] of meanwhile) {
      fresh()
      const m = held()
      const run = lineUpTutorialSeed(null, m.reachAt)
      await new Promise((r) => setTimeout(r, 0))
      change()
      m.go()
      const why = await run
      expect(why, what).toMatch(want!)
      expect(useShards.getState().pending?.type === 'seed', what).toBe(false)
    }
    // The tutorial moved on: nothing lined up, nothing said, and BUILD closed again.
    fresh()
    const m = held()
    let here = true
    const run = lineUpTutorialSeed(null, m.reachAt, () => here)
    await new Promise((r) => setTimeout(r, 0))
    here = false
    m.go()
    expect(await run).toBe(null)
    expect(useShards.getState().pending).toBe(null)
    expect(useBuilder.getState().active).toBe(false)
    useCyberspace.setState({ events: [] })
  })

  it('a second PLANT THE SEED tap while it measures does nothing', async () => {
    const { runTutorialEffect } = await import('../../store/useTutorial')
    const director = await import('../director')
    await expectShippedTree()
    useTutorial.getState().start({ restart: true })
    await staged()
    useTutorial.getState().start({ at: 'plant' })
    await staged()
    useCyberspace.setState({ events: [{ id: 'e', tags: [] } as never], position: { x: 0n, y: 0n, z: 0n } })
    holdDna()
    runTutorialEffect('plant-tutorial-seed')
    expect(director.tutorialSeedMeasuring()).toBe(true)
    expect(useTutorial.getState().stepNote).toBe('One moment.')
    // A second tap meanwhile is ignored: the first run's answer is the one shown, and then taps work again.
    runTutorialEffect('plant-tutorial-seed')
    await vi.waitFor(() => { expect(useTutorial.getState().stepNote).toMatch(/Stand on the dirt/) })
    expect(director.tutorialSeedMeasuring()).toBe(false)
    useCyberspace.setState({ events: [] })
  })
})

describe('the inventory step puts ITEMS at the top of the menu, whatever the order (feedback item 2)', () => {
  it('under the default order, and under one with other panels first (#677\'s), ITEMS comes first', () => {
    const was = usePanelLayout.getState().order
    for (const left of [
      ['identity', 'agents', 'hidden', 'discovered', 'items', 'create', 'avatars', 'targets', 'links'],
      ['identity', 'agents', 'avatars', 'items', 'create', 'hidden', 'discovered', 'targets', 'links'],
    ] as const) {
      usePanelLayout.setState({ order: { left: [...left], right: [...was.right] } })
      runTutorialEffect('teach-inventory')
      expect(usePanelLayout.getState().order.left[0]).toBe('items')
    }
    usePanelLayout.setState({ order: was })
  })
})
