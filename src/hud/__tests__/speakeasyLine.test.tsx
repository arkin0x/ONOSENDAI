/**
 * speakeasyLine.test.tsx: the speakeasy under the Position panel's coordinate
 * (speakeasy step 7). ADD RELAY adds the speakeasy to your relays exactly as
 * the Relays panel's ADD does; once it is there the line says JOINED. The
 * lookup is a fake that answers what each test says: nothing is fetched.
 *
 * Only while LIVE, and only the head of the published part of the chain is
 * ever handed to the lookup: a move still on this device is never sent.
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

const HEAD = '0fe6b3deeb67e952f852e8c1df15' + 'a'.repeat(36)
/** A move made here and not yet on the relays, somewhere else entirely. */
const UNSENT = 'f'.repeat(64)
// Your chain, as the store gives it: spawn and one move at HEAD on the relays, then a move at UNSENT.
const cs = vi.hoisted(() => ({
  live: true,
  published: {} as Record<string, string>,
  actions: [] as Array<{ id: string; coordHex: string } & Record<string, unknown>>,
}))
// The 5.13 list: the real one, behind a gate a test can hold shut or fail.
const v1 = vi.hoisted(() => ({ gate: Promise.resolve() as Promise<void>, fail: false }))
vi.mock('../../lib/v1HopList', () => ({
  loadV1HopList: async () => {
    await v1.gate
    if (v1.fail) throw new Error('chunk failed to load')
    return (await import('../../../node_modules/cyberspace-core/dist/grandfathered_v1_hops.js')).GRANDFATHERED_V1_HOPS
  },
}))
vi.mock('../../store/useCyberspace', () => {
  const state = (): { live: boolean; published: Record<string, string>; actions: () => unknown[]; coordHex: () => string } =>
    ({ live: cs.live, published: cs.published, actions: () => cs.actions, coordHex: () => cs.actions[cs.actions.length - 1]?.coordHex ?? '' })
  return { useCyberspace: Object.assign((sel: (s: ReturnType<typeof state>) => unknown) => sel(state()), { getState: state }) }
})

import { mount, type Host } from '../../test/elementRoot'
import { mountHook, settle } from '../../test/hookRoot'
import { createSpeakeasyLookup, type Speakeasy, type SpeakeasyLookup } from '../../lib/speakeasy'
import { useSpeakeasies } from '../../hooks/useSpeakeasies'
import { useRelays } from '../../store/useRelays'
import { SpeakeasyLine, addSpeakeasy, joined, stoppedWords } from '../SpeakeasyLine'
import { buildChain, type NostrEvent } from '../../lib/events'
import { usePanelLayout } from '../../store/usePanelLayout'
import { useChainUi } from '../../store/useChainUi'
import owner from '../../lib/__tests__/vectors/owner-chain-e8ed3798-through-2026-09-04.json'

// The relay lists a named speakeasy at its region path too (public_url/C/<region>, the owner, 2026-11-09).
const NAMED: Speakeasy = { region: '0fe6b3deeb67e952f852e8c1df15', name: 'fiatjafs-speakeasy', url: 'wss://relay.onosendai.tech/C/0fe6b3deeb67e952f852e8c1df15', created_at: 1762300000 }
const PLAIN: Speakeasy = { region: '0fe6', name: null, url: 'wss://relay.onosendai.tech/C/0fe6', created_at: 1762300000 }

function fakeLookup(list: Speakeasy[]): SpeakeasyLookup & { asked: Array<string | null>; watched: () => number } {
  const asked: Array<string | null> = []
  let watching = 0
  return {
    asked,
    watched: () => watching,
    update: (c) => { asked.push(c) },
    current: () => list,
    subscribe: () => () => undefined,
    watch: () => { watching++; return () => { watching-- } },
  }
}

function chainWithUnsentMove(): void {
  cs.live = true
  cs.actions = [{ id: 'spawn', coordHex: HEAD }, { id: 'hop', coordHex: HEAD }, { id: 'unsent', coordHex: UNSENT }]
  cs.published = { spawn: 'ok', hop: 'ok', unsent: 'sending' }
}

const links = (all: Host[]): Host[] => all.filter((h) => h.type === 'a')

describe('the speakeasy line', () => {
  beforeEach(() => { useRelays.getState().reset(); chainWithUnsentMove() })

  it('shows nothing when the head is in no speakeasy', async () => {
    const m = await mount(<SpeakeasyLine lookup={fakeLookup([])} />)
    expect(m.all()).toHaveLength(0)
    await m.unmount()
  })

  it('asks about the head of the published part of your chain, never a move still on this device', async () => {
    const lookup = fakeLookup([])
    const m = await mount(<SpeakeasyLine lookup={lookup} />)
    expect(lookup.asked).toEqual([HEAD])
    expect(lookup.asked).not.toContain(UNSENT)
    await m.unmount()
  })

  it('LOCAL: asks nothing, shows nothing, and watches nothing', async () => {
    cs.live = false
    cs.published = { spawn: 'ok', hop: 'ok', unsent: 'ok' }
    const lookup = fakeLookup([PLAIN])
    const m = await mount(<SpeakeasyLine lookup={lookup} />)
    expect(lookup.asked.filter(Boolean)).toEqual([])
    expect(lookup.watched()).toBe(0)
    expect(m.all()).toHaveLength(0)
    await m.unmount()
  })

  it('LIVE with nothing on the relays yet (held, queued, offline): asks nothing', async () => {
    cs.published = { spawn: 'queued', hop: 'sending' }
    const lookup = fakeLookup([PLAIN])
    const m = await mount(<SpeakeasyLine lookup={lookup} />)
    expect(lookup.asked.filter(Boolean)).toEqual([])
    expect(m.all()).toHaveLength(0)
    await m.unmount()
  })

  it('watches while the panel is open, and lets go when it unmounts', async () => {
    const lookup = fakeLookup([])
    const m = await mount(<SpeakeasyLine lookup={lookup} />)
    expect(lookup.watched()).toBe(1)
    await m.unmount()
    expect(lookup.watched()).toBe(0)
  })

  it('names each speakeasy, links its region page, and offers ADD RELAY', async () => {
    const m = await mount(<SpeakeasyLine lookup={fakeLookup([NAMED, PLAIN])} />)
    expect(m.says('fiatjafs-speakeasy')).toBe(true)
    expect(m.says('0fe6')).toBe(true)
    expect(m.buttons('ADD RELAY')).toHaveLength(2)
    expect(m.says('JOINED')).toBe(false)
    const hrefs = links(m.all()).map((a) => a.props.href)
    expect(hrefs).toEqual(['https://relay.onosendai.tech/C/0fe6b3deeb67e952f852e8c1df15', 'https://relay.onosendai.tech/C/0fe6'])
    for (const a of links(m.all())) expect(a.props.target).toBe('_blank')
    await m.unmount()
  })

  it('says JOINED for a speakeasy already in your relays, ADD RELAY for the other', async () => {
    useRelays.getState().add(NAMED.url)
    const m = await mount(<SpeakeasyLine lookup={fakeLookup([NAMED, PLAIN])} />)
    expect(m.says('JOINED')).toBe(true)
    expect(m.buttons('ADD RELAY')).toHaveLength(1)
    await m.unmount()
  })

  it('ADD RELAY puts it in your relays, saved like any other, and the line turns to JOINED', async () => {
    const m = await mount(<SpeakeasyLine lookup={fakeLookup([PLAIN])} />)
    await m.press('ADD RELAY')
    expect(useRelays.getState().relays).toContain('wss://relay.onosendai.tech/C/0fe6')
    expect(JSON.parse(localStorage.getItem('onosendai:relays') ?? '[]')).toContain('wss://relay.onosendai.tech/C/0fe6')
    expect(m.says('JOINED')).toBe(true)
    expect(m.buttons('ADD RELAY')).toHaveLength(0)
    await m.unmount()
  })
})

describe('mounted again after the head moved (the Hud unmounts when the menu closes)', () => {
  const REGION = '0fe6b3deeb67e952f852e8c1df15'
  const OUT = 'f'.repeat(64)

  it('the first render already leaves out a speakeasy the head has left: no flash', async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ speakeasies: [{ region: REGION, name: null, url: `wss://relay.onosendai.tech/C/${REGION}`, created_at: 1 }] }), { status: 200 })) as unknown as typeof fetch
    const lookup = createSpeakeasyLookup({ fetchFn, base: 'https://relay.onosendai.tech', debounceMs: 1 })
    const seen: string[][] = []
    const hook = (c: string | null): Speakeasy[] => { const r = useSpeakeasies(c, false, lookup); seen.push(r.map((s) => s.region)); return r }
    const a = mountHook(hook, HEAD)
    await new Promise((r) => setTimeout(r, 20))
    await settle()
    expect(a.current().map((s) => s.region)).toEqual([REGION])
    await a.unmount()
    seen.length = 0
    const b = mountHook(hook, OUT)
    await settle()
    expect(seen.length).toBeGreaterThan(0)
    for (const render of seen) expect(render).toEqual([])
    await b.unmount()
  })

  it('and keeps the very same list while nothing changes', async () => {
    const lookup = fakeLookup([PLAIN])
    const lists: Speakeasy[][] = []
    const h = mountHook((c: string | null) => { const r = useSpeakeasies(c, false, lookup); lists.push(r); return r }, HEAD)
    await settle()
    await h.render(HEAD)
    expect(lists.length).toBeGreaterThan(1)
    expect(new Set(lists).size).toBe(1)
    await h.unmount()
  })
})

describe('joined and the add path', () => {
  beforeEach(() => { useRelays.getState().reset() })

  it('a path speakeasy is not the canonical relay, whose host it shares', () => {
    expect(joined(PLAIN, useRelays.getState().relays)).toBe(false)
  })

  it('reads the relay list as the store normalizes it', () => {
    expect(joined({ ...PLAIN, url: 'wss://relay.onosendai.tech/C/0fe6/' }, ['wss://relay.onosendai.tech/C/0fe6'])).toBe(true)
  })

  it('adds through the relay store, once', () => {
    expect(addSpeakeasy(PLAIN)).toBe('wss://relay.onosendai.tech/C/0fe6')
    expect(addSpeakeasy(PLAIN)).toBe('wss://relay.onosendai.tech/C/0fe6')
    expect(useRelays.getState().relays.filter((r) => r === 'wss://relay.onosendai.tech/C/0fe6')).toHaveLength(1)
  })
})

describe('where the relay places you, not your head (a chain the relay stopped)', () => {
  const V2 = { mn: '0'.repeat(16), mp: 'ab' }
  /** Outside every region below. */
  const AWAY = '1'.repeat(64)
  const SEP_4 = Date.UTC(2026, 8, 4, 0, 22) / 1000
  const allSent = (): void => { cs.published = Object.fromEntries(cs.actions.map((a) => [a.id, 'ok'])) }

  beforeEach(() => { useRelays.getState().reset(); cs.live = true })

  // First in this block: once loaded, the list is kept for every later mount.
  it('while the 5.13 list loads, and when it fails: nothing, never ADD RELAY on a guess', async () => {
    let open = (): void => undefined
    v1.gate = new Promise<void>((r) => { open = r })
    cs.actions = [{ id: 'spawn', type: 'spawn', coordHex: AWAY }, { id: 'oldhop', type: 'hop', coordHex: HEAD }]
    allSent()
    const loading = await mount(<SpeakeasyLine lookup={fakeLookup([NAMED])} placedLookup={fakeLookup([])} />)
    expect(loading.all()).toHaveLength(0)
    v1.fail = true
    open()
    await settle()
    expect(loading.all()).toHaveLength(0)
    await loading.unmount()
    v1.fail = false
  })

  it('a valid chain with its head inside: ADD RELAY, as before', async () => {
    cs.actions = [{ id: 'spawn', type: 'spawn', coordHex: AWAY }, { id: 'hop', type: 'hop', coordHex: HEAD, ...V2 }]
    allSent()
    const m = await mount(<SpeakeasyLine lookup={fakeLookup([NAMED])} placedLookup={fakeLookup([])} />)
    expect(m.buttons('ADD RELAY')).toHaveLength(1)
    expect(m.says('Your chain stops')).toBe(false)
    await m.unmount()
  })

  it('a chain stopped outside, with its head inside: the warning and RESPAWN, no ADD RELAY', async () => {
    cs.actions = [
      { id: 'spawn', type: 'spawn', coordHex: AWAY, createdAt: SEP_4 - 60 },
      { id: 'hop1', type: 'hop', coordHex: AWAY, createdAt: SEP_4, ...V2 },
      { id: 'v1side', type: 'sidestep', coordHex: AWAY, createdAt: SEP_4 + 60 },
      { id: 'hop2', type: 'hop', coordHex: HEAD, createdAt: SEP_4 + 120, ...V2 },
    ]
    allSent()
    const m = await mount(<SpeakeasyLine lookup={fakeLookup([NAMED])} placedLookup={fakeLookup([])} />)
    expect(m.says('fiatjafs-speakeasy')).toBe(true)
    expect(m.buttons('ADD RELAY')).toHaveLength(0)
    expect(m.says('JOINED')).toBe(false)
    expect(m.says('Your chain stops at 2026-09-04, outside this region. Respawn to enter.')).toBe(true)
    expect(m.buttons('RESPAWN')).toHaveLength(1)
    await m.unmount()
  })

  it('RESPAWN opens the respawn there is: the Derezz panel when ONOSENDAI sees no break, unfolded', async () => {
    cs.actions = [{ id: 'spawn', type: 'spawn', coordHex: AWAY, createdAt: SEP_4 }, { id: 'v1side', type: 'sidestep', coordHex: HEAD, createdAt: SEP_4 }]
    allSent()
    if (usePanelLayout.getState().collapsed.derezz !== true) usePanelLayout.getState().toggle('derezz')
    const m = await mount(<SpeakeasyLine lookup={fakeLookup([NAMED])} placedLookup={fakeLookup([])} />)
    await m.press('RESPAWN')
    expect(usePanelLayout.getState().collapsed.derezz).not.toBe(true)
    expect(useChainUi.getState().brokenView).toBeNull()
    await m.unmount()
    usePanelLayout.setState({ collapsed: {} })
  })

  it('RESPAWN opens the broken-chain notice when ONOSENDAI sees the break too', async () => {
    cs.actions = [{ id: 'spawn', type: 'spawn', coordHex: AWAY, createdAt: SEP_4 }, { id: 'bad', type: 'hop', coordHex: HEAD, createdAt: SEP_4, breaks: 'starts elsewhere', ...V2 }]
    allSent()
    const m = await mount(<SpeakeasyLine lookup={fakeLookup([NAMED])} placedLookup={fakeLookup([])} />)
    await m.press('RESPAWN')
    expect(useChainUi.getState().brokenView).toBe('notice')
    useChainUi.getState().setBrokenView(null)
    await m.unmount()
  })

  it('a stop only in the part not yet on the relays: ADD RELAY, and no unpublished place is ever asked about', async () => {
    cs.actions = [{ id: 'spawn', type: 'spawn', coordHex: AWAY }, { id: 'hop', type: 'hop', coordHex: HEAD, ...V2 }, { id: 'v1side', type: 'sidestep', coordHex: UNSENT }]
    cs.published = { spawn: 'ok', hop: 'ok', v1side: 'sending' }
    const head = fakeLookup([NAMED])
    const placed = fakeLookup([])
    const m = await mount(<SpeakeasyLine lookup={head} placedLookup={placed} />)
    expect(m.buttons('ADD RELAY')).toHaveLength(1)
    expect([...head.asked, ...placed.asked]).not.toContain(UNSENT)
    expect(placed.asked.filter(Boolean)).toEqual([])
    await m.unmount()
  })

  it('a fork whose second branch never reached the relays: nothing, not a respawn the relay does not ask for', async () => {
    cs.actions = [
      { id: 'spawn', type: 'spawn', coordHex: AWAY, breaks: 'a fork', fork: { previousId: 'spawn', branchIds: ['b1', 'b2'] } },
      { id: 'b1', type: 'hop', coordHex: HEAD, ...V2 },
    ]
    cs.published = { spawn: 'ok', b1: 'ok', b2: 'held' }
    const m = await mount(<SpeakeasyLine lookup={fakeLookup([NAMED])} placedLookup={fakeLookup([])} />)
    expect(m.all()).toHaveLength(0)
    await m.unmount()
  })

  it('a folded Position panel walks nothing and shows nothing', async () => {
    if (usePanelLayout.getState().collapsed.position !== true) usePanelLayout.getState().toggle('position')
    cs.actions = [{ id: 'spawn', type: 'spawn', coordHex: AWAY }, { id: 'hop', type: 'hop', coordHex: HEAD, ...V2 }]
    allSent()
    const m = await mount(<SpeakeasyLine lookup={fakeLookup([NAMED])} placedLookup={fakeLookup([])} />)
    expect(m.all()).toHaveLength(0)
    usePanelLayout.getState().toggle('position')
    await m.unmount()
  })

  it('a hop above the relay ceiling: says so, and offers no RESPAWN, since a respawn would not help', async () => {
    cs.actions = [
      { id: 'spawn', type: 'spawn', coordHex: AWAY, createdAt: SEP_4, position: { x: 0n, y: 0n, z: 0n }, plane: 0 },
      { id: 'tall', type: 'hop', coordHex: HEAD, createdAt: SEP_4 + 60, position: { x: 1n << 30n, y: 0n, z: 0n }, plane: 0, ...V2 },
    ]
    allSent()
    const m = await mount(<SpeakeasyLine lookup={fakeLookup([NAMED])} placedLookup={fakeLookup([])} />)
    expect(m.says('This relay checks hops up to h24. Your chain stops at 2026-09-04, outside this region.')).toBe(true)
    expect(m.buttons('RESPAWN')).toHaveLength(0)
    expect(m.buttons('ADD RELAY')).toHaveLength(0)
    await m.unmount()
  })

  it('frozen inside a region, head moved out since: the relay still admits you there, so ADD RELAY', async () => {
    cs.actions = [{ id: 'spawn', type: 'spawn', coordHex: HEAD }, { id: 'v1side', type: 'sidestep', coordHex: AWAY }]
    allSent()
    const head = fakeLookup([])
    const placed = fakeLookup([NAMED])
    const m = await mount(<SpeakeasyLine lookup={head} placedLookup={placed} />)
    expect(head.asked).toContain(AWAY)
    expect(placed.asked).toContain(HEAD)
    expect(m.buttons('ADD RELAY')).toHaveLength(1)
    expect(m.says('Your chain stops')).toBe(false)
    await m.unmount()
  })

  it('placed at your head: the second lookup is asked nothing', async () => {
    cs.actions = [{ id: 'spawn', type: 'spawn', coordHex: AWAY }, { id: 'hop', type: 'hop', coordHex: HEAD, ...V2 }]
    allSent()
    const placed = fakeLookup([])
    const m = await mount(<SpeakeasyLine lookup={fakeLookup([NAMED])} placedLookup={placed} />)
    expect(placed.asked.filter(Boolean)).toEqual([])
    await m.unmount()
  })

  it("the owner's real chain: placed at 2026-09-04, so midwest, where he stands now, warns instead of ADD RELAY", async () => {
    const MIDWEST: Speakeasy = { region: '56db6db6db6db6db6db6dbad', name: 'midwest', url: 'wss://relay.onosendai.tech/C/56db6db6db6db6db6db6dbad', created_at: 1762900000 }
    const chain = buildChain(owner as NostrEvent[], 'e8ed3798c6ffebffa08501ac39e271662bfd160f688f94c45d692d8767dd345a')
    // His head inside midwest, one more hop on the chain ONOSENDAI still lets him extend.
    const last = chain[chain.length - 1]
    cs.actions = [...chain, { ...last, id: 'into-midwest', coordHex: MIDWEST.region + '0'.repeat(40), previousId: last.id, ...V2 }] as unknown as typeof cs.actions
    allSent()
    const m = await mount(<SpeakeasyLine lookup={fakeLookup([MIDWEST])} placedLookup={fakeLookup([])} />)
    await settle()
    expect(m.says('midwest')).toBe(true)
    expect(m.says('Your chain stops at 2026-09-04, outside this region. Respawn to enter.')).toBe(true)
    expect(m.buttons('ADD RELAY')).toHaveLength(0)
    expect(m.buttons('RESPAWN')).toHaveLength(1)
    await m.unmount()
  })

  it('a stop with no valid point at all says so', () => {
    expect(stoppedWords({ index: 0, action: {} as never, lastValid: null, kind: 'broken', reason: 'fork' })).toBe('Your chain stops at its spawn, outside this region. Respawn to enter.')
  })
})
