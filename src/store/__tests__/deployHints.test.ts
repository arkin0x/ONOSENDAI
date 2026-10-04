/**
 * deployHints.test.ts - the bag's public settings through the store (arkinox,
 * 2026-10-01): the deploy writes `h`, the sector hint and the riddle as the
 * deploy bar set them; a second deploy into the same region starts from and
 * keeps the first bag's settings; a riddle written from another device is
 * carried forward; rewrites by broadcast and delete keep them; the sector hint
 * goes off above height 30; and a bag without `h` is still read at its height.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

const sent: { kind: number; tags: string[][]; id: string; content: string }[] = []
/** What the relay holds, answered to every query. */
let relayBags: unknown[] = []
vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async (_relays: string[], ev: { kind: number; tags: string[][]; id: string; content: string }) => {
    sent.push(ev)
    return { ok: true }
  }),
  query: vi.fn(async () => relayBags),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { useCyberspace } from '../useCyberspace'
import { ownBagIn, regionOf, useShards } from '../useShards'
import { DEFAULT_BAG_SETTINGS, HIDDEN_KIND, bagTemplate, type BagSettings } from '../../lib/hidden'
import { SECTOR_HINT, hintTags } from '../../lib/hint'
import { deployPoint } from '../../lib/space'
import { hexToBytes, type NostrEvent } from '../../lib/events'

const HEIGHT = 6
const lastBag = () => [...sent].reverse().find((e) => e.kind === HIDDEN_KIND) as unknown as NostrEvent
const tagNames = (ev: NostrEvent): string[] => ev.tags.map((t) => t[0])

/** Start a message deploy, seed the controls as the deploy bar does, change them, deploy. */
async function hide(text: string, patch: Partial<BagSettings> = {}): Promise<void> {
  const s = useShards.getState()
  s.startDeployMessage(text)
  s.setDeployHeight(HEIGHT)
  const cs = useCyberspace.getState()
  const region = regionOf(deployPoint(cs.cursor, cs.scaleExp, HEIGHT), cs.plane, HEIGHT)
  s.seedDeployBag(ownBagIn(useShards.getState().mine, region))
  s.setDeployBag(patch)
  await s.deploy()
  expect(useShards.getState().deployError).toBeNull()
  expect(useShards.getState().deployStatus).toBe('done')
}

beforeEach(() => {
  sent.length = 0
  relayBags = []
  localStorage.clear()
  useShards.setState({ mine: [], deleted: {}, discovered: {}, pending: null, deployHeight: 0, deployStatus: 'idle', deployError: null })
  useCyberspace.setState({ live: true })
})

describe('the deploy writes the bag settings', () => {
  it('defaults: h, no hint, no riddle, as every bag before', async () => {
    await hide('one')
    const bag = lastBag()
    expect(tagNames(bag)).toEqual(['d', 'encrypted', 'version', 'h', 'client'])
    expect(bag.tags).toContainEqual(['h', String(HEIGHT)])
    expect(bag.content).toBe('')
  })

  it('h off, sector hint on, riddle: exactly those tags and that content', async () => {
    await hide('two', { heightTag: false, hint: SECTOR_HINT, riddle: 'under the black sun' })
    const bag = lastBag()
    const dep = useShards.getState().mine[0]
    const at = { x: BigInt(dep.at.x), y: BigInt(dep.at.y), z: BigInt(dep.at.z) }
    expect(tagNames(bag)).toEqual(['d', 'encrypted', 'version', 'hint', 'X', 'Y', 'Z', 'S', 'client'])
    expect(bag.tags.slice(3, -1)).toEqual(hintTags(at, dep.plane, SECTOR_HINT))
    expect(bag.content).toBe('under the black sun')
    expect(dep.bag).toEqual({ heightTag: false, hint: SECTOR_HINT, riddle: 'under the black sun' })
  })
})

describe('a second deploy into the same region', () => {
  it('starts from the first bag\'s settings and keeps them', async () => {
    await hide('first', { heightTag: false, hint: SECTOR_HINT, riddle: 'cold' })
    const first = lastBag()
    useShards.getState().startDeployMessage('second')
    useShards.getState().setDeployHeight(HEIGHT)
    const cs = useCyberspace.getState()
    const own = ownBagIn(useShards.getState().mine, regionOf(deployPoint(cs.cursor, cs.scaleExp, HEIGHT), cs.plane, HEIGHT))
    expect(own).toMatchObject({ count: 1, settings: { heightTag: false, hint: SECTOR_HINT, riddle: 'cold' } })
    useShards.getState().seedDeployBag(own)
    expect(useShards.getState().deployBag).toEqual({ heightTag: false, hint: SECTOR_HINT, riddle: 'cold' })

    relayBags = [first]
    await useShards.getState().deploy()
    const second = lastBag()
    expect(second.id).not.toBe(first.id)
    expect(tagNames(second)).toEqual(tagNames(first))
    expect(second.tags.slice(3)).toEqual(first.tags.slice(3))
    expect(second.content).toBe('cold')
    expect(useShards.getState().mine.every((d) => d.bag?.riddle === 'cold')).toBe(true)
  })

  it('carries forward a riddle another device wrote since, when you did not touch it', async () => {
    await hide('first', { riddle: 'mine' })
    const dep = useShards.getState().mine[0]
    // The relay's newest copy of this bag was rewritten elsewhere with a new riddle and a hint.
    const elsewhere = await useCyberspace.getState().signEvent(await bagTemplate([dep.inner], hexToBytes(dep.keyHex), dep.lookupId, HEIGHT, Math.floor(Date.now() / 1000) + 50, HIDDEN_KIND, { heightTag: true, hint: SECTOR_HINT, riddle: 'theirs' }, { at: { x: BigInt(dep.at.x), y: BigInt(dep.at.y), z: BigInt(dep.at.z) }, plane: dep.plane }))
    relayBags = [elsewhere]
    await hide('second')
    expect(lastBag().content).toBe('theirs')
    expect(tagNames(lastBag())).toContain('hint')
  })

  it('a riddle you cleared stays cleared', async () => {
    await hide('first', { riddle: 'gone soon' })
    relayBags = [lastBag()]
    await hide('second', { riddle: '' })
    expect(lastBag().content).toBe('')
  })
})

describe('rewrites that are not deploys keep the settings', () => {
  it('delete rewrites the bag with its riddle and hint', async () => {
    await hide('a', { hint: SECTOR_HINT, riddle: 'stay' })
    relayBags = [lastBag()]
    await hide('b')
    relayBags = [lastBag()]
    sent.length = 0
    await useShards.getState().deleteInstance(useShards.getState().mine[0].eventId)
    expect(lastBag().content).toBe('stay')
    expect(tagNames(lastBag())).toEqual(['d', 'encrypted', 'version', 'h', 'hint', 'X', 'Y', 'Z', 'S', 'client'])
  })

  it('broadcast from LOCAL publishes the settings it was hidden with', async () => {
    useCyberspace.setState({ live: false })
    await hide('quiet', { heightTag: false, riddle: 'later' })
    expect(sent).toHaveLength(0)
    const dep = useShards.getState().mine[0]
    expect(await useShards.getState().broadcast(dep.lookupId)).toBe(true)
    expect(tagNames(lastBag())).toEqual(['d', 'encrypted', 'version', 'client'])
    expect(lastBag().content).toBe('later')
  })
})

describe('the sector hint and the height', () => {
  it('goes off when the height rises above 30, the way the snap goes off below its own', () => {
    useShards.setState({ deployCeiling: () => 40 })
    useShards.getState().startDeployMessage('x')
    useShards.getState().setDeployBag({ hint: SECTOR_HINT })
    useShards.getState().setDeployHeight(30)
    expect(useShards.getState().deployBag.hint).toEqual(SECTOR_HINT)
    useShards.getState().setDeployHeight(31)
    expect(useShards.getState().deployBag.hint).toBeNull()
  })

  it('moving from your bag\'s region to an empty one resets the controls, between empty ones keeps them', () => {
    const s = useShards.getState()
    s.startDeployMessage('x')
    s.setDeployBag({ riddle: 'typed' })
    s.seedDeployBag(null)
    expect(useShards.getState().deployBag.riddle).toBe('typed')
    s.seedDeployBag({ region: 'r1', settings: { heightTag: false, hint: null, riddle: 'bag riddle' }, count: 2 })
    expect(useShards.getState().deployBag.riddle).toBe('bag riddle')
    s.seedDeployBag(null)
    expect(useShards.getState().deployBag).toEqual(DEFAULT_BAG_SETTINGS)
  })
})

describe('a bag without h', () => {
  it('rescan reads it at its true height and files it with its settings', async () => {
    await hide('found again', { heightTag: false })
    const bag = lastBag()
    const dep = useShards.getState().mine[0]
    // A fresh device: nothing local, the key held from a scan.
    useShards.setState({ mine: [], discovered: {} })
    const { useSecrets } = await import('../useSecrets')
    useSecrets.setState({ keys: { [dep.lookupId]: { lookupId: dep.lookupId, keyHex: dep.keyHex, height: HEIGHT, base: { x: '0', y: '0', z: '0' }, plane: dep.plane, source: 'scan', at: 1 } } })
    relayBags = [bag]
    expect(await useShards.getState().rescan(dep.lookupId, dep.keyHex)).toBe(1)
    const found = Object.values(useShards.getState().discovered)[0]
    expect(found.height).toBe(HEIGHT)
    expect(found.bag?.heightTag).toBe(false)
    // And it rejoins DEPLOYED at its height, so a later rewrite keys the same region.
    expect(useShards.getState().mine[0]).toMatchObject({ height: HEIGHT, bag: { heightTag: false } })
  })
})
