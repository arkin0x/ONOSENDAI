/**
 * deployHints.test.ts - the bag's public settings through the store (arkinox,
 * 2026-10-01): the deploy writes `h`, the sector hint and the riddle as the
 * deploy bar set them; a second deploy into the same region starts from and
 * keeps the first bag's settings; a riddle written from another device is
 * carried forward; rewrites by broadcast and delete keep them; the sector hint
 * goes off above height 30; and a bag without `h` is still read at its height.
 * The three hint switches (height, sector, contents) are ON for a player who
 * never touched them and stay what they set them after that, on every later
 * hide, into a new bag or one already out, an edit or a move alike
 * (arkinox, 2026-11-15; store/deployHintPrefs.ts). The sector hint is off
 * where the height is too large for it and back on below, which never
 * changes the saved choice. Money is said only with its own switch on,
 * OFF for a player who never touched it and shown whenever cashu is inside
 * (arkinox, 2026-11-15: "money off by default").
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
/** The canonical relay's trouble on the reads that tell a refusal from nothing; the others still answer. */
let canonTrouble: 'auth' | 'unreachable' | null = null
vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async (_relays: string[], ev: { kind: number; tags: string[][]; id: string; content: string }) => {
    sent.push(ev)
    return { ok: true }
  }),
  query: vi.fn(async () => relayBags),
  queryEach: vi.fn(async () => [{ url: 'wss://relay.test', outcome: 'answered', events: relayBags }]),
  queryAny: vi.fn(async () => []),
  // The read that tells a refusal from nothing (rescan, TEST DISCOVERY).
  queryChecked: vi.fn(async () => ({ events: relayBags, trouble: canonTrouble })),
  relaySet: () => ['wss://relay.test'],
}))

import { useCyberspace } from '../useCyberspace'
import { moneyAsSaved, moneyRowShown, ownBagIn, regionOf, useShards } from '../useShards'
import { HIDDEN_KIND, bagTemplate, newBagSettings, type BagSettings } from '../../lib/hidden'
import { SECTOR_HINT, hintTags, isHintTag } from '../../lib/hint'
import { HINT_PREFS_KEY, loadHintPrefs } from '../deployHintPrefs'
import { deployPoint } from '../../lib/space'
import { hexToBytes, type NostrEvent } from '../../lib/events'

const HEIGHT = 6
const TOKEN = 'cashuBo2FteBtodHRwczovL21pbnQubWluaWJpdHMuY2FzaC9CaXRjb2luYXVjc2F0YXSBomFpSABQBVDwSUFGYXCBpGFhAmFzeEAzZjNlYTU2YTk3ZjE3MDAxMjZkZjVlZDNlNDNmYjU2NjAzMmQ0YWQyNTNkNmNiODEyZGI0N2E1OTA0MjZmNDVjYWNYIQKr8zhNlxrJ0lMVMXKkXy9Ww7GjPU2LaH3sz5Y1HlgLv2Fko2FlWCCa5DHXKlbV8GLuXtnZsc2vJ8fsoTHpp6W3t3q0B2-ZomFzWCCTJGYFX4d0fwWhP6rgrgIX1xZpCCr0K0jj4Z3vKYIhR2FyWCBqvA'
const CEILING = useShards.getState().deployCeiling
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
  canonTrouble = null
  localStorage.clear()
  useShards.setState({ mine: [], deleted: {}, discovered: {}, pending: null, deployHeight: 0, deployStatus: 'idle', deployError: null, deployCeiling: CEILING, deployHintHeld: null, deployBagFrom: null, deployRoomSnap: null })
  useCyberspace.setState({ live: true })
})

describe('the deploy writes the bag settings', () => {
  it('defaults: H, the sector hint and the contents (arkinox, 2026-11-15), no riddle', async () => {
    await hide('one')
    const bag = lastBag()
    expect(tagNames(bag)).toEqual(['d', 'encrypted', 'version', 'H', 'hint', 'X', 'Y', 'Z', 'S', 'contents', 'client'])
    expect(bag.tags).toContainEqual(['contents', 'message', '1'])
    expect(bag.tags).toContainEqual(['H', String(HEIGHT)])
    expect(bag.tags.some((t) => t[0] === 'h')).toBe(false)
    expect(bag.content).toBe('')
  })

  it('h off, sector hint on, riddle: exactly those tags and that content', async () => {
    await hide('two', { heightTag: false, hint: SECTOR_HINT, riddle: 'under the black sun', contents: false, money: false })
    const bag = lastBag()
    const dep = useShards.getState().mine[0]
    const at = { x: BigInt(dep.at.x), y: BigInt(dep.at.y), z: BigInt(dep.at.z) }
    expect(tagNames(bag)).toEqual(['d', 'encrypted', 'version', 'hint', 'X', 'Y', 'Z', 'S', 'client'])
    expect(bag.tags.slice(3, -1)).toEqual(hintTags(at, dep.plane, SECTOR_HINT))
    expect(bag.content).toBe('under the black sun')
    expect(dep.bag).toEqual({ heightTag: false, hint: SECTOR_HINT, riddle: 'under the black sun', contents: false, money: false })
  })
})

describe('a second deploy into the same region', () => {
  it('starts from the first bag\'s settings and keeps them', async () => {
    await hide('first', { heightTag: false, hint: SECTOR_HINT, riddle: 'cold', contents: false, money: false })
    const first = lastBag()
    useShards.getState().startDeployMessage('second')
    useShards.getState().setDeployHeight(HEIGHT)
    const cs = useCyberspace.getState()
    const own = ownBagIn(useShards.getState().mine, regionOf(deployPoint(cs.cursor, cs.scaleExp, HEIGHT), cs.plane, HEIGHT))
    expect(own).toMatchObject({ count: 1, settings: { heightTag: false, hint: SECTOR_HINT, riddle: 'cold', contents: false, money: false } })
    useShards.getState().seedDeployBag(own)
    expect(useShards.getState().deployBag).toEqual({ heightTag: false, hint: SECTOR_HINT, riddle: 'cold', contents: false, money: false })

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
    await hide('first', { riddle: 'mine', contents: false, money: false })
    const dep = useShards.getState().mine[0]
    // The relay's newest copy of this bag was rewritten elsewhere with a new riddle and a hint.
    const elsewhere = await useCyberspace.getState().signEvent(await bagTemplate([dep.inner], hexToBytes(dep.keyHex), dep.lookupId, HEIGHT, Math.floor(Date.now() / 1000) + 50, HIDDEN_KIND, { heightTag: true, hint: SECTOR_HINT, riddle: 'theirs', contents: false, money: false }, { at: { x: BigInt(dep.at.x), y: BigInt(dep.at.y), z: BigInt(dep.at.z) }, plane: dep.plane }))
    relayBags = [elsewhere]
    await hide('second')
    expect(lastBag().content).toBe('theirs')
    expect(tagNames(lastBag())).toContain('hint')
  })

  it('a riddle you cleared stays cleared', async () => {
    await hide('first', { riddle: 'gone soon', contents: false, money: false })
    relayBags = [lastBag()]
    await hide('second', { riddle: '', contents: false, money: false })
    expect(lastBag().content).toBe('')
  })
})

describe('rewrites that are not deploys keep the settings', () => {
  it('delete rewrites the bag with its riddle and hint', async () => {
    await hide('a', { hint: SECTOR_HINT, riddle: 'stay', contents: false, money: false })
    relayBags = [lastBag()]
    await hide('b')
    relayBags = [lastBag()]
    sent.length = 0
    await useShards.getState().deleteInstance(useShards.getState().mine[0].eventId)
    expect(lastBag().content).toBe('stay')
    expect(tagNames(lastBag())).toEqual(['d', 'encrypted', 'version', 'H', 'hint', 'X', 'Y', 'Z', 'S', 'client'])
  })

  it('broadcast from LOCAL publishes the settings it was hidden with', async () => {
    useCyberspace.setState({ live: false })
    await hide('quiet', { heightTag: false, hint: null, riddle: 'later', contents: false, money: false })
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
    s.setDeployBag({ riddle: 'typed', contents: false, money: false })
    s.seedDeployBag(null)
    expect(useShards.getState().deployBag.riddle).toBe('typed')
    s.seedDeployBag({ region: 'r1', settings: { heightTag: false, hint: null, riddle: 'bag riddle', contents: false, money: false }, count: 2, cashu: false })
    expect(useShards.getState().deployBag.riddle).toBe('bag riddle')
    s.seedDeployBag(null)
    expect(useShards.getState().deployBag).toEqual(newBagSettings(0))
  })
})

describe('the three hint switches: ON for a new player, then what they set (arkinox, 2026-11-15)', () => {
  const S = () => useShards.getState()
  const starts: [string, () => void][] = [
    ['a shard', () => S().startDeployShard('some-shard')],
    ['a copy of a public shard', () => S().startDeployObject({ address: '33331:aa:bb', shard: { unit: 0 } } as never)],
    ['a message', () => S().startDeployMessage('x')],
    ['a key', () => S().startDeployKey({ name: 'k' } as never)],
    ['audio', () => S().startDeployAudio({ title: 'a' } as never)],
    ['a seed', () => S().startDeploySeed({ text: '' } as never)],
    ['a chest', () => S().startDeployChest({ name: 'c', lock: null, requires: '', contents: [] } as never)],
    ['a door', () => S().startPlaceDoor()],
  ]
  const shown = () => ({ height: S().deployBag.heightTag, sector: S().deployBag.hint !== null, contents: S().deployBag.contents })

  it.each(starts)('%s starts with all three on for a player who never touched them', (_, start) => {
    expect(localStorage.getItem(HINT_PREFS_KEY)).toBeNull()
    start()
    expect(shown()).toEqual({ height: true, sector: true, contents: true })
    expect(S().deployBag.hint).toEqual(SECTOR_HINT)
    expect(S().deployBagFrom).toBeNull()
  })

  it.each(starts)('%s starts with what the player last set', (_, start) => {
    S().startDeployMessage('set')
    S().setDeployBag({ heightTag: false })
    S().setDeployBag({ hint: null })
    S().setDeployBag({ contents: false })
    S().cancelDeploy()
    start()
    expect(shown()).toEqual({ height: false, sector: false, contents: false })
  })

  it('one switch changed keeps the other two as they were', () => {
    S().startDeployMessage('x')
    S().setDeployBag({ contents: false })
    S().startDeployKey({ name: 'k' } as never)
    expect(shown()).toEqual({ height: true, sector: true, contents: false })
  })

  it('a riddle typed is not a switch: it saves nothing', () => {
    S().startDeployMessage('x')
    S().setDeployBag({ riddle: 'a clue' })
    expect(localStorage.getItem(HINT_PREFS_KEY)).toBeNull()
  })

  it('turned off, the bag goes out with no hint or sector tag, and so does the next, in a new region or the same', async () => {
    await hide('off', { hint: null })
    expect(lastBag().tags.some(isHintTag)).toBe(false)
    expect(useShards.getState().mine[0].bag?.hint).toBeNull()
    S().startDeployMessage('next')
    expect(S().deployBag.hint).toBeNull()
    const cs = useCyberspace.getState()
    S().seedDeployBag(ownBagIn(S().mine, regionOf(deployPoint(cs.cursor, cs.scaleExp, HEIGHT), cs.plane, HEIGHT)))
    expect(S().deployBag.hint).toBeNull()
  })

  it('your bag already out with all three off: the bar shows your switches, ON, and the bag goes out with them', async () => {
    await hide('first', { heightTag: false, hint: null, contents: false, riddle: 'kept' })
    relayBags = [lastBag()]
    // Back on by hand on some other hide: the switches are the player's, not the bag's.
    S().startDeployMessage('elsewhere')
    S().setDeployBag({ heightTag: true, hint: SECTOR_HINT, contents: true })
    S().cancelDeploy()
    S().startDeployMessage('second')
    S().setDeployHeight(HEIGHT)
    const cs = useCyberspace.getState()
    S().seedDeployBag(ownBagIn(S().mine, regionOf(deployPoint(cs.cursor, cs.scaleExp, HEIGHT), cs.plane, HEIGHT)))
    expect(S().deployBag).toEqual({ heightTag: true, hint: SECTOR_HINT, riddle: 'kept', contents: true, money: false })
    await S().deploy()
    expect(tagNames(lastBag())).toEqual(['d', 'encrypted', 'version', 'H', 'hint', 'X', 'Y', 'Z', 'S', 'contents', 'client'])
    expect(lastBag().content).toBe('kept')
  })

  it('a bag this device does not know goes out as the bar shows: on puts the hint on, off takes it off', async () => {
    await hide('first', { hint: null })
    const first = lastBag()
    // Another device's bag: this one does not know it, so the controls start from the saved switches.
    useShards.setState({ mine: [] })
    relayBags = [first]
    S().startDeployMessage('on again')
    S().setDeployBag({ hint: SECTOR_HINT })
    S().cancelDeploy()
    await hide('second')
    expect(lastBag().tags.some(isHintTag)).toBe(true)
    useShards.setState({ mine: [] })
    relayBags = [lastBag()]
    await hide('third', { hint: null })
    expect(lastBag().tags.some(isHintTag)).toBe(false)
  })

  it('a new bag above height 30 starts off, and it comes back on at 30 or lower', () => {
    // Raised by hand: a new deploy never starts above SCAN_MAX_HEIGHT on a carried height (carriedHeight.test.ts).
    useShards.setState({ deployCeiling: () => 40 })
    S().startDeployMessage('high')
    S().setDeployHeight(35)
    expect(S().deployBag.hint).toBeNull()
    S().setDeployHeight(30)
    expect(S().deployBag.hint).toEqual(SECTOR_HINT)
    S().setDeployHeight(31)
    expect(S().deployBag.hint).toBeNull()
    S().setDeployHeight(12)
    expect(S().deployBag.hint).toEqual(SECTOR_HINT)
  })

  it('one turned off by hand stays off down the heights', () => {
    useShards.setState({ deployCeiling: () => 40 })
    S().startDeployMessage('x')
    S().setDeployHeight(20)
    S().setDeployBag({ hint: null })
    S().setDeployHeight(35)
    S().setDeployHeight(20)
    expect(S().deployBag.hint).toBeNull()
  })

  it('leaving your bag\'s region for an empty one above height 30: off and held, never a hint too small', () => {
    useShards.setState({ deployCeiling: () => 40, deployHeight: 35 })
    S().seedDeployBag({ region: 'r', settings: { heightTag: true, hint: null, riddle: '', contents: false, money: false }, count: 1, cashu: false })
    S().seedDeployBag(null)
    expect(S().deployBag.hint).toBeNull()
    expect(S().deployHintHeld).toEqual(SECTOR_HINT)
  })

  it('a move shows the switches as last set, off or on', async () => {
    await hide('kept off', { hint: null })
    relayBags = [lastBag()]
    S().startMoveItem(S().mine[0].eventId)
    expect(S().deployBag.hint).toBeNull()
    sent.length = 0
    await S().deploy()
    expect(S().deployError).toBeNull()
    expect(lastBag().tags.some(isHintTag)).toBe(false)
    S().cancelDeploy()
    relayBags = [lastBag()]
    await hide('on', { hint: SECTOR_HINT })
    const on = S().mine.find((d) => d.text === 'on')!
    S().startMoveItem(on.eventId)
    expect(S().deployBag.hint).toEqual(SECTOR_HINT)
  })

  it('a move of an item whose bag is off, with the switch since turned on: on, and the bag goes out with the hint', async () => {
    await hide('was off', { hint: null })
    relayBags = [lastBag()]
    S().startDeployMessage('elsewhere')
    S().setDeployBag({ hint: SECTOR_HINT })
    S().cancelDeploy()
    S().startMoveItem(S().mine[0].eventId)
    expect(S().deployBag.hint).toEqual(SECTOR_HINT)
    sent.length = 0
    await S().deploy()
    expect(S().deployError).toBeNull()
    expect(lastBag().tags.some(isHintTag)).toBe(true)
  })

  it('after a deploy, the next placement lined up keeps the saved switches, and the sector hint goes off above 30 and comes back', async () => {
    // Above 30 a deploy needs cloud compute, which this test has not got; the held hint after one is withHintPrefs (deployHintPrefs.test.ts).
    await hide('first', { contents: false })
    expect(S().pending).not.toBeNull()
    expect(S().deployBag).toMatchObject({ heightTag: true, hint: SECTOR_HINT, contents: false })
    expect(S().deployHintHeld).toBeNull()
    useShards.setState({ deployCeiling: () => 40 })
    S().setDeployHeight(35)
    expect(S().deployBag.hint).toBeNull()
    S().setDeployHeight(20)
    expect(S().deployBag.hint).toEqual(SECTOR_HINT)
    expect(loadHintPrefs()).toEqual({ height: true, sector: true, contents: false, money: false })
  })
})

describe('money off by default (arkinox, 2026-11-15)', () => {
  const S = () => useShards.getState()
  const contentsRows = (ev: NostrEvent): string[][] => ev.tags.filter((t) => t[0] === 'contents')
  /** Every public word of the bag: its tags and its riddle. */
  const saysCashu = (ev: NostrEvent): boolean => /cashu/i.test(JSON.stringify(ev.tags.filter((t) => t[0] !== 'encrypted'))) || /cashu/i.test(ev.content)

  it('a fresh player hiding cashu: the money switch is off and the bag says nothing of money', async () => {
    S().startDeployMessage(`for you ${TOKEN}`)
    expect(S().deployBag).toMatchObject({ contents: true, money: false })
    await hide(`for you ${TOKEN}`)
    const bag = lastBag()
    expect(contentsRows(bag)).toEqual([['contents', 'message', '1']])
    expect(saysCashu(bag)).toBe(false)
    expect(S().mine[0].bag).toMatchObject({ contents: true, money: false })
  })

  it('the same bag says exactly what it would with no token in it: no count or total gives money away', async () => {
    await hide(`for you ${TOKEN}`)
    const rich = contentsRows(lastBag())
    useShards.setState({ mine: [] })
    sent.length = 0
    await hide('for you')
    expect(contentsRows(lastBag())).toEqual(rich)
  })

  it('turned on, the bag counts the cashu, and the choice is kept for the next hide', async () => {
    await hide(`for you ${TOKEN}`, { money: true })
    expect(contentsRows(lastBag())).toEqual([['contents', 'message', '1'], ['contents', 'cashu', '1']])
    expect(loadHintPrefs()).toMatchObject({ money: true })
    S().startDeployMessage(`more ${TOKEN}`)
    expect(S().deployBag.money).toBe(true)
  })

  it('contents off and money on: only that money is inside, with no count', async () => {
    await hide(`for you ${TOKEN}`, { contents: false, money: true })
    expect(contentsRows(lastBag())).toEqual([['contents', 'cashu']])
  })

  it('contents off and money off: nothing at all', async () => {
    await hide(`for you ${TOKEN}`, { contents: false })
    expect(contentsRows(lastBag())).toEqual([])
    expect(saysCashu(lastBag())).toBe(false)
  })

  it('a bag that said money before keeps saying it until you hide into it again, then follows the switch', async () => {
    await hide(`for you ${TOKEN}`, { money: true })
    expect(contentsRows(lastBag())).toContainEqual(['contents', 'cashu', '1'])
    relayBags = [lastBag()]
    await hide('b')
    relayBags = [lastBag()]
    // The second hide went out as the bar showed it: money still on for this player.
    expect(contentsRows(lastBag())).toContainEqual(['contents', 'cashu', '1'])
    // A fresh device: the switch is off, and nothing is rewritten until a hide.
    // A rewrite that is not a hide (a DELETE of another item) keeps what the bag said.
    localStorage.clear()
    sent.length = 0
    await useShards.getState().deleteInstance(S().mine.find((d) => d.text === 'b')!.eventId)
    expect(contentsRows(lastBag())).toEqual([['contents', 'message', '1'], ['contents', 'cashu', '1']])
    relayBags = [lastBag()]
    await hide('c')
    expect(contentsRows(lastBag())).toEqual([['contents', 'message', '2']])
    expect(saysCashu(lastBag())).toBe(false)
  })

  it('a bag this device does not know, which said money, stops when hidden into with the switch off', async () => {
    await hide(`for you ${TOKEN}`, { money: true })
    const first = lastBag()
    useShards.setState({ mine: [] })
    localStorage.clear()
    relayBags = [first]
    await hide('second')
    // It still holds the token: two messages, and nothing said of money.
    expect(contentsRows(lastBag())).toEqual([['contents', 'message', '2']])
    expect(saysCashu(lastBag())).toBe(false)
  })

  it('a switch saved ON never speaks for a bag whose cashu this device does not list: no row, no money', async () => {
    await hide(`for you ${TOKEN}`, { money: true })
    const first = lastBag()
    expect(loadHintPrefs().money).toBe(true)
    // Another device's view: the bag holds the token, this device lists none of it.
    useShards.setState({ mine: [] })
    relayBags = [first]
    S().startDeployMessage('plain')
    const cs = useCyberspace.getState()
    expect(moneyRowShown(S().pending, ownBagIn(S().mine, regionOf(deployPoint(cs.cursor, cs.scaleExp, HEIGHT), cs.plane, HEIGHT)))).toBe(false)
    expect(S().deployBag.money).toBe(true)
    S().cancelDeploy()
    await hide('plain')
    expect(contentsRows(lastBag())).toEqual([['contents', 'message', '2']])
    expect(saysCashu(lastBag())).toBe(false)
    // The saved switch is untouched: the next cashu hide, with the row shown, says it.
    expect(loadHintPrefs().money).toBe(true)
  })

  it('the row shows for a cashu message being hidden, or your bag listing one; not otherwise', () => {
    expect(moneyRowShown({ type: 'message', text: `x ${TOKEN}` }, null)).toBe(true)
    expect(moneyRowShown({ type: 'message', text: 'x' }, null)).toBe(false)
    expect(moneyRowShown({ type: 'message', text: 'x' }, { cashu: true })).toBe(true)
    expect(moneyRowShown({ type: 'key' }, { cashu: false })).toBe(false)
    expect(moneyRowShown(null, null)).toBe(false)
  })

  it('a write that adds cashu without the bar (HIDE AGAIN, a room moving out) keeps money only with the saved switch ON, and never turns it on', () => {
    const said = { ...newBagSettings(HEIGHT), contents: true, money: true }
    expect(moneyAsSaved(said, true).money).toBe(false)
    expect(moneyAsSaved(said, false).money).toBe(true)
    expect(moneyAsSaved({ ...said, money: false }, true).money).toBe(false)
    S().startDeployMessage(`x ${TOKEN}`)
    S().setDeployBag({ money: true })
    expect(moneyAsSaved(said, true).money).toBe(true)
    expect(moneyAsSaved({ ...said, money: false }, true).money).toBe(false)
  })
})

describe('what the client forces never overwrites the saved switches', () => {
  const S = () => useShards.getState()

  it('the sector hint going off above height 30 and back on lower down', () => {
    useShards.setState({ deployCeiling: () => 40 })
    S().startDeployMessage('high')
    S().setDeployHeight(35)
    expect(S().deployBag.hint).toBeNull()
    expect(loadHintPrefs()).toEqual({ height: true, sector: true, contents: true, money: false })
    S().cancelDeploy()
    S().startDeployMessage('low')
    S().setDeployHeight(HEIGHT)
    expect(S().deployBag.hint).toEqual(SECTOR_HINT)
  })

  it('newBagSettings, which the game and tutorial dungeon bags take as they are, ignores the saved switches (worldDeploy.test.ts builds the dungeon itself)', () => {
    S().startDeployMessage('x')
    S().setDeployBag({ heightTag: false, hint: null, contents: false })
    expect(newBagSettings(HEIGHT)).toMatchObject({ heightTag: true, hint: SECTOR_HINT })
    expect(loadHintPrefs()).toEqual({ height: false, sector: false, contents: false, money: false })
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

/**
 * Review of #600, round 2: the canonical relay in trouble (no AUTH, not heard
 * from) while another relay sent the bag. What came is used, as v2 did; only
 * what is missing reads as trouble.
 */
describe('a bag another relay sent, with the canonical relay in trouble', () => {
  async function freshDevice(): Promise<{ bag: NostrEvent; dep: ReturnType<typeof useShards.getState>['mine'][number] }> {
    await hide('kept elsewhere')
    const bag = lastBag()
    const dep = useShards.getState().mine[0]
    useShards.setState({ mine: [], discovered: {} })
    const { useSecrets } = await import('../useSecrets')
    useSecrets.setState({ keys: { [dep.lookupId]: { lookupId: dep.lookupId, keyHex: dep.keyHex, height: HEIGHT, base: { x: '0', y: '0', z: '0' }, plane: dep.plane, source: 'scan', at: 1 } } })
    return { bag, dep }
  }

  it('rescan opens it, and reads FAILED only when nothing came', async () => {
    const { bag, dep } = await freshDevice()
    canonTrouble = 'auth'
    relayBags = [bag]
    expect(await useShards.getState().rescan(dep.lookupId, dep.keyHex)).toBe(1)
    expect(Object.keys(useShards.getState().discovered)).toHaveLength(1)
    relayBags = []
    expect(await useShards.getState().rescan(dep.lookupId, dep.keyHex)).toBe(-1)
    // A partial answer drops nothing it did not see.
    expect(Object.keys(useShards.getState().discovered)).toHaveLength(1)
  })

  it('TEST DISCOVERY finds it, and says unread only when it is not there', async () => {
    await hide('tested')
    const dep = useShards.getState().mine[0]
    const bag = lastBag()
    canonTrouble = 'unreachable'
    relayBags = [bag]
    expect((await useShards.getState().testDiscovery(dep.eventId)).outcome).toBe('found')
    relayBags = []
    expect((await useShards.getState().testDiscovery(dep.eventId)).outcome).toBe('unread')
    canonTrouble = null
    expect((await useShards.getState().testDiscovery(dep.eventId)).outcome).toBe('missing')
  })
})
