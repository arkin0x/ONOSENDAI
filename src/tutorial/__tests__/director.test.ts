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
import { PLOT_STAND, START_STAND, courseToWorld } from '../course'
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
    // Another tree on the dirt; the tree far off; the tree on the dirt but no relay took it (LIVE): none count.
    useShards.setState({ mine: [seedRow(fern.id, stand)] })
    await new Promise((r) => setTimeout(r, 20))
    expect(useTutorial.getState().done).toBe(false)
    useShards.setState({ mine: [seedRow(tree.id, { ...stand, x: stand.x + 40n })] })
    expect(useTutorial.getState().done).toBe(false)
    useShards.setState({ mine: [seedRow(tree.id, stand, false)] })
    expect(useTutorial.getState().done).toBe(false)
    useShards.setState({ mine: [seedRow(tree.id, stand)] })
    // Its DNA is resolved (asynchronously), then it counts.
    await vi.waitFor(() => { expect(useTutorial.getState().done).toBe(true) })
    // A reload after planting finds it planted.
    useTutorial.getState().start({ at: 'plant' })
    await vi.waitFor(() => { expect(useTutorial.getState().done).toBe(true) })
    // Once the owner's event is set, a seed naming it counts at once, on the dirt; off it, not.
    const { tutorialTreePlanted } = await import('../director')
    const ownerId = 'c'.repeat(64)
    useShards.setState({ mine: [seedRow(ownerId, stand)] })
    expect(tutorialTreePlanted(undefined, ownerId)).toBe(true)
    expect(tutorialTreePlanted(undefined, null)).toBe(false)
    useShards.setState({ mine: [seedRow(ownerId, { ...stand, x: stand.x + 40n })] })
    expect(tutorialTreePlanted(undefined, ownerId)).toBe(false)
    // The bud leaves BUILD, so the course step can line its COMMIT up.
    const { useBuilder } = await import('../../store/useBuilder')
    useBuilder.setState({ active: true } as never)
    useTutorial.getState().start({ at: 'bud' })
    expect(useBuilder.getState().active).toBe(false)
    useShards.setState({ mine: [] })
    useCyberspace.setState({ events: [] })
  }, 60_000)

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
    const { onPlot } = await import('../course')
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
    expect(onPlot(layout!.frame, useCyberspace.getState().cursor)).toBe(true)
    // Built in the plane the player stands in, whatever plane a view had.
    const { buildPlane } = await import('../../lib/buildCursor')
    expect(buildPlane(useCyberspace.getState())).toBe(layout!.plane)
    expect(useShards.getState().pending).toMatchObject({ type: 'seed', seed: { text: TUTORIAL_DNA.text, caps: TUTORIAL_DNA.caps, scale: 0 } })
    expect((useShards.getState().pending as { seed: { dnaId?: string } }).seed.dnaId).toBeUndefined()
    // Its hide height is the one SEED picks for this tree at this spot: SEED's seedHideFor, with the bloom
    // measured exactly as SEED measures it (hud/SeedCompose useSeedFit), at day 31 where it lands.
    const { seedHideFor, previewRequest, bloomReachGibsons, PREVIEW_DAYS } = await import('../../lib/seeds/plant')
    const { growInWorker } = await import('../../lib/seeds/growClient')
    const { headerBook, trustedTip } = await import('../../lib/seeds/seedSources')
    const { getStopByHeight, useHyperspace } = await import('../../store/useHyperspace')
    const { positionHex } = await import('../../lib/events')
    const { MAX_COMPUTE_HEIGHT } = await import('../../store/useCyberspace')
    const now = trustedTip() ?? useHyperspace.getState().tipHeight ?? 975_300
    const seedReach = async (p: { x: bigint; y: bigint; z: bigint }): Promise<number | undefined> => {
      const req = previewRequest({ text: TUTORIAL_DNA.text, caps: TUTORIAL_DNA.caps, coord: positionHex(p, layout!.plane), scale: 0, tip: now, day: PREVIEW_DAYS, hashOf: (h) => headerBook.hash(h) ?? getStopByHeight(h)?.blockHash })
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
    useTutorial.getState().start({ restart: true })
    await staged()
    useTutorial.getState().start({ at: 'plant' })
    await staged()
    useCyberspace.setState({ events: [{ id: 'e', tags: [] } as never], position: { x: 0n, y: 0n, z: 0n } })
    runTutorialEffect('plant-tutorial-seed')
    await vi.waitFor(() => { expect(useTutorial.getState().stepNote).toMatch(/Stand on the dirt/) })
    useTutorial.getState().next()
    expect(useTutorial.getState().stepNote).toBe(null)
    expect(useTutorialStage.getState().error).toBe(null)
    useCyberspace.setState({ events: [] })
  })
})
