/**
 * cyberspaceStats.test.ts: the CYBERSPACE STATS break (lib/tv/cyberspaceStats).
 * Each board is a shared counting rule ranked; the ticker's chain length and
 * LONGEST CHAIN are one number; arkinox is ranked like anyone, with no row
 * of his own; agents are counted apart and never ranked among humans; a board
 * holds keys and counts and never a place; and a break keeps clear of every
 * spot and explainer.
 */
import { describe, expect, it, vi } from 'vitest'

// No network: nothing here may reach a relay (lib/relay is never called; this makes sure).
vi.mock('../../relay', () => ({
  query: vi.fn(async () => { throw new Error('no network in tests') }),
  queryEach: vi.fn(async () => { throw new Error('no network in tests') }),
  queryAny: vi.fn(async () => { throw new Error('no network in tests') }),
  publish: vi.fn(async () => { throw new Error('nothing is published') }),
  publishMany: vi.fn(async () => { throw new Error('nothing is published') }),
  relaySet: () => [],
}))

import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { coordToXyz, hexToCoord } from 'cyberspace-core'
import { positionHex, spawnTemplate, type NostrEvent } from '../../events'
import { hopEvent, nextId } from '../../__tests__/chainFixtures'
import { DAY_S, WEEK_S, arrivalTimes, type BagRecord } from '../../countingRules'
import { READ_OVERLAP_S, READ_WHOLE_S, bagsHiddenAt, chainLengthAt, loadCensus } from '../stats'
import { V2_EPOCH } from '../tape'
import {
  AGENTS_FUN_FACT, BEATS, BOARD_ORDER, STATS_GAP_MS, STATS_MIN_ROWS, STATS_TAG, asOfHour, asOfWords, boardFor, breakMayStart, countStats, forcedBoard,
  PROFILE_HOLD_MS, STATS_ON_SITE, isAgentProfile, loadStatsReads, nextBoard, profilesSettled, rankRows, readActions, statsOn, statNumber, statsEveryMs, statsFirstMs, statsLength, type StatsBoard, type StatsFilter, type StatsSnapshot,
} from '../cyberspaceStats'
import { AD_EVERY_MS, BROADCAST_AD_EVERY_MS, AD_IN_MS } from '../hosakaAd'
import { EXPLAINER_AD_GAP_MS } from '../explainer'

const ARKINOX = 'e8ed3798c6ffebffa08501ac39e271662bfd160f688f94c45d692d8767dd345a'
const AS_OF = asOfHour(1_790_000_000)

/** A key's spawn at `t` and `n` hops after it, a minute apart. */
function walk(pk: string, t: number, n: number): NostrEvent[] {
  const home = coordToXyz(hexToCoord(pk))
  const at = (dx: number) => ({ x: home.x + BigInt(dx), y: home.y, z: home.z })
  const spawn: NostrEvent = { ...spawnTemplate(pk, t), id: nextId(), pubkey: pk, sig: '' }
  const out = [spawn]
  for (let i = 1; i <= n; i++) out.push(hopEvent({ pubkey: pk, createdAt: t + 60 * i, genesisId: spawn.id, previousId: out[i - 1].id, c: i === 1 ? pk : positionHex(at(i - 1), home.plane), to: at(i), plane: home.plane }))
  return out
}
const key = (): string => getPublicKey(generateSecretKey())
const nobody: StatsFilter = { isAgent: () => false }

/** A little cyberspace: arkinox far ahead, an agent close behind, people, a fork, a gap, a respawner, a newcomer. */
function world() {
  const agent = key()
  const [p1, p2, p3, forker, gapper, phoenix, fresh] = Array.from({ length: 7 }, key)
  const forked = walk(forker, AS_OF - 20 * DAY_S, 30)
  const fork = hopEvent({ pubkey: forker, createdAt: AS_OF - 3 * DAY_S, genesisId: forked[0].id, previousId: forked[5].id, c: forked[6].tags.find((t) => t[0] === 'c')![1], to: { x: 1n, y: 2n, z: 3n } })
  const gapped = walk(gapper, AS_OF - 20 * DAY_S, 12)
  const actions = [
    ...walk(ARKINOX, AS_OF - 40 * DAY_S, 40),
    ...walk(agent, AS_OF - 30 * DAY_S, 25),
    ...walk(p1, AS_OF - 2 * DAY_S, 9),
    ...walk(p2, AS_OF - 9 * DAY_S, 6),
    ...walk(p3, AS_OF - 12 * DAY_S, 6),
    ...forked, fork,
    ...gapped.filter((_, i) => i !== 4),
    ...walk(phoenix, AS_OF - 25 * DAY_S, 1), ...walk(phoenix, AS_OF - 15 * DAY_S, 2), ...walk(phoenix, AS_OF - 5 * DAY_S, 1),
    ...walk(fresh, AS_OF - DAY_S, 0),
    // Signed after AS_OF: not on any board yet.
    ...walk(key(), AS_OF + 60, 50),
  ]
  const bag = (pk: string, d: string, t: number): BagRecord => ({ id: nextId(), kind: 33330, pubkey: pk, d, createdAt: t, sealed: true })
  const bags = [
    ...Array.from({ length: 4 }, (_, i) => bag(ARKINOX, `a${i}`, AS_OF - (i + 1) * DAY_S)),
    ...Array.from({ length: 3 }, (_, i) => bag(agent, `g${i}`, AS_OF - (i + 1) * DAY_S)),
    bag(p1, 'x', AS_OF - DAY_S), bag(p1, 'y', AS_OF - 2 * DAY_S), bag(p2, 'z', AS_OF - DAY_S),
  ]
  return { agent, p1, p2, p3, forker, gapper, phoenix, fresh, input: { actions, bags, objects: [], deletions: [], arrivals: arrivalTimes(actions) } }
}

const agentFilter = (agent: string): StatsFilter => ({ isAgent: (pk) => pk === agent })

describe('the counts (countStats), as of the hour', () => {
  it('ranks each shared rule; nothing signed after AS OF counts', async () => {
    const w = world()
    const snap = await countStats(w.input, AS_OF, 0)
    expect(snap.asOf).toBe(AS_OF)
    expect(snap.chain.get(ARKINOX)).toBe(41)
    expect(snap.chain.get(w.p1)).toBe(10)
    expect(snap.chain.get(w.forker)).toBeUndefined()
    expect(snap.chain.get(w.gapper)).toBe(4)
    expect(snap.respawns.get(w.phoenix)).toBe(2)
    expect(snap.bags.get(ARKINOX)).toBe(4)
    expect(Math.max(...snap.chain.values())).toBe(41)
  })

  it('LONGEST CHAIN and the ticker\'s CHAIN OF n ACTIONS are one number, fork, gap and respawn alike', async () => {
    const w = world()
    const snap = await countStats(w.input, AS_OF, 0)
    for (const pk of [ARKINOX, w.agent, w.p1, w.p2, w.p3, w.forker, w.gapper, w.phoenix, w.fresh]) {
      // The ticker reads a key's own actions (lib/tv/stats loadChainHistory) and counts as of the tape's moment.
      const history = { pubkey: pk, events: w.input.actions.filter((e) => e.pubkey === pk) }
      expect(chainLengthAt(history, AS_OF), pk.slice(0, 8)).toBe(snap.chain.get(pk) ?? 0)
    }
    const board = boardFor('longest-chain', snap, nobody)!
    expect(board.kind).toBe('ranking')
    if (board.kind === 'ranking') for (const r of board.rows) expect(chainLengthAt({ pubkey: r.pubkey, events: w.input.actions.filter((e) => e.pubkey === r.pubkey) }, AS_OF)).toBe(r.value)
  })
})

describe('the boards', () => {
  it('arkinox is ranked like anyone: first because he is first, no row of his own, no HOUSE', async () => {
    const w = world()
    const snap = await countStats(w.input, AS_OF, 0)
    for (const id of BOARD_ORDER) {
      const b = boardFor(id, snap, agentFilter(w.agent))
      if (!b) continue
      expect(JSON.stringify(b)).not.toMatch(/HOUSE/i)
      if (b.kind === 'ranking') {
        // Each rank is one more than how many rows have more (equal numbers share it).
        expect(b.rows.map((r) => r.rank)).toEqual(b.rows.map((r) => b.rows.filter((o) => o.value > r.value).length + 1))
        expect(b.rows.filter((r) => r.pubkey === ARKINOX).length).toBeLessThanOrEqual(1)
      }
    }
    const chain = boardFor('longest-chain', snap, agentFilter(w.agent))!
    expect(chain.kind === 'ranking' && chain.rows[0]).toEqual({ rank: 1, pubkey: ARKINOX, value: 41 })
  })

  it('agents are never ranked among humans, and ACTIVE USERS counts them apart', async () => {
    const w = world()
    const snap = await countStats(w.input, AS_OF, 0)
    const chain = boardFor('longest-chain', snap, agentFilter(w.agent))!
    expect(chain.kind === 'ranking' && chain.rows.some((r) => r.pubkey === w.agent)).toBe(false)
    const mixed = boardFor('longest-chain', snap, nobody)!
    expect(mixed.kind === 'ranking' && mixed.rows[1].pubkey).toBe(w.agent)
    const active = boardFor('active-users', snap, agentFilter(w.agent))!
    expect(active.kind).toBe('split')
    if (active.kind === 'split') {
      // In (AS_OF - 7 days, AS_OF]: arkinox's, p1's, the phoenix's, the newcomer's actions. The agent's walk ended 30 days less 25 minutes ago.
      expect(active.humans.now).toBe(snap.active.length)
      expect(active.agents.now).toBe(0)
      expect(active.note).toBe(AGENTS_FUN_FACT)
    }
    const allAgents = boardFor('active-users', snap, { isAgent: () => true })!
    expect(allAgents.kind === 'split' && allAgents.humans.now).toBe(0)
  })

  it('ACTIVE USERS: keys with a valid action in the rolling week to AS OF, and the week before', async () => {
    const a = key()
    const b = key()
    const actions = [...walk(a, AS_OF - DAY_S, 1), ...walk(b, AS_OF - 10 * DAY_S, 1), ...walk(b, AS_OF - 3 * DAY_S, 0)]
    const snap = await countStats({ actions, bags: [], objects: [], deletions: [], arrivals: arrivalTimes(actions) }, AS_OF, 0)
    expect(new Set(snap.active)).toEqual(new Set([a, b]))
    expect(snap.activeBefore).toEqual([b])
    const board = boardFor('active-users', snap, agentFilter(b))!
    expect(board.kind === 'split' && [board.humans, board.agents]).toEqual([{ now: 1, before: 0 }, { now: 1, before: 1 }])
  })

  it('NEW ARRIVALS: first spawns this week, and the week before', async () => {
    const w = world()
    const snap = await countStats(w.input, AS_OF, 0)
    const b = boardFor('new-arrivals', snap, nobody)!
    // p1 two days ago, the newcomer one day ago; p2 nine days ago, p3 twelve.
    expect(b.kind === 'count' && b.count).toEqual({ now: 2, before: 2 })
  })

  it('a ranking with fewer than three rows is skipped; the rotation goes on to the next with something to show', async () => {
    const w = world()
    const snap = await countStats(w.input, AS_OF, 0)
    // Bags: arkinox, p1, p2 and the agent; with the agent and p2 left out, two rows.
    const f: StatsFilter = { isAgent: (pk) => pk === w.agent, hidden: (pk) => pk === w.p2 }
    expect(boardFor('most-bags', snap, f)).toBeNull()
    expect(boardFor('most-bags', snap, agentFilter(w.agent))?.kind).toBe('ranking')
    expect(nextBoard(snap, f, 'active-users')!.id).toBe('new-arrivals')
    expect(STATS_MIN_ROWS).toBe(3)
  })

  it('takes the boards in turn, round the rotation, and one the address names first', async () => {
    const snap = await countStats(world().input, AS_OF, 0)
    const seen: string[] = []
    let last: StatsBoard['id'] | null = null
    for (let i = 0; i < 2 * BOARD_ORDER.length; i++) {
      const b = nextBoard(snap, nobody, last)
      if (!b) break
      seen.push(b.id)
      last = b.id
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1])
    expect(seen[0]).toBe(BOARD_ORDER[0])
    expect(nextBoard(snap, nobody, null, 'new-arrivals')!.id).toBe('new-arrivals')
    expect(forcedBoard('?broadcast=1&stats=most-bags')).toBe('most-bags')
    expect(forcedBoard('?stats=the-house')).toBeNull()
  })

  it('ties: the higher number, then the earlier arrival, then the pubkey; equal numbers share a rank', () => {
    const values = new Map([['c'.repeat(64), 5], ['a'.repeat(64), 5], ['b'.repeat(64), 5], ['d'.repeat(64), 9], ['f'.repeat(64), 2], ['e'.repeat(64), 0]])
    const arrivals = new Map([['b'.repeat(64), 10], ['a'.repeat(64), 20], ['c'.repeat(64), 20]])
    const rows = rankRows(values, arrivals, nobody)
    expect(rows.map((r) => r.pubkey[0])).toEqual(['d', 'b', 'a', 'c', 'f'])
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 2, 2, 5])
  })

  it('a key whose profile is not known is off every ranking and in neither HUMANS nor AGENTS (review of #537)', async () => {
    const w = world()
    const snap = await countStats(w.input, AS_OF, 0)
    // The agent's kind 0 has not come: never ranked as a human, never counted as one.
    const unknownAgent: StatsFilter = { isAgent: () => false, isKnown: (pk) => pk !== w.agent }
    const chain = boardFor('longest-chain', snap, unknownAgent)!
    expect(chain.kind === 'ranking' && chain.rows.some((r) => r.pubkey === w.agent)).toBe(false)
    expect(chain.kind === 'ranking' && chain.rows[1].value).toBe(10)
    const actions = [...walk(w.agent, AS_OF - DAY_S, 2), ...walk(w.p1, AS_OF - DAY_S, 1)]
    const s2 = await countStats({ actions, bags: [], objects: [], deletions: [], arrivals: arrivalTimes(actions) }, AS_OF, 0)
    const split = boardFor('active-users', s2, unknownAgent)!
    expect(split.kind === 'split' && [split.humans.now, split.agents.now]).toEqual([1, 0])
    // Known, it is an agent.
    const known = boardFor('active-users', s2, agentFilter(w.agent))!
    expect(known.kind === 'split' && [known.humans.now, known.agents.now]).toEqual([1, 1])
  })

  it('a break holds for the profiles until they are known or PROFILE_HOLD_MS is over', () => {
    const keys = ['a', 'b']
    expect(profilesSettled(keys, (k) => k === 'a', 1000, 1000 + PROFILE_HOLD_MS - 1)).toBe(false)
    expect(profilesSettled(keys, () => true, 1000, 1001)).toBe(true)
    expect(profilesSettled(keys, () => false, 1000, 1000 + PROFILE_HOLD_MS)).toBe(true)
  })

  it('the site counts by one flag, ON for now; the stream always counts', () => {
    expect(STATS_ON_SITE).toBe(true)
    expect(statsOn(false)).toBe(true)
    expect(statsOn(false, false)).toBe(false)
    expect(statsOn(true, false)).toBe(true)
  })
})

describe('a board holds keys and counts, never a place', () => {
  /** Every key of every object in `v`, at any depth. */
  const keysOf = (v: unknown, out = new Set<string>()): Set<string> => {
    if (Array.isArray(v)) v.forEach((x) => keysOf(x, out))
    else if (v instanceof Map) [...v.values()].forEach((x) => keysOf(x, out))
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); keysOf(x, out) }
    return out
  }
  const PLACE = /^(c|C|S|X|Y|Z|coord|coordHex|position|sector|height|hint|plane|region|lookup|lookupId|place|location|x|y|z)$/

  it('no field of any board, or of the counts, names a place', async () => {
    const w = world()
    const snap: StatsSnapshot = await countStats(w.input, AS_OF, 0)
    expect([...keysOf(snap)].filter((k) => PLACE.test(k))).toEqual([])
    for (const id of BOARD_ORDER) {
      const b = boardFor(id, snap, agentFilter(w.agent))
      if (!b) continue
      expect([...keysOf(b)].filter((k) => PLACE.test(k)), id).toEqual([])
      if (b.kind === 'ranking') for (const r of b.rows) expect(Object.keys(r).sort()).toEqual(['pubkey', 'rank', 'value'])
    }
    expect(Object.keys(snap).sort()).toEqual(['active', 'activeBefore', 'arrivals', 'asOf', 'bags', 'chain', 'objects', 'respawns'])
  })
})

describe('the words', () => {
  it('stamps the hour in UTC, and writes numbers with commas', () => {
    expect(asOfWords(Date.UTC(2026, 9, 30, 2, 0) / 1000)).toBe('AS OF 30 OCT 02:00 UTC')
    expect(asOfHour(Date.UTC(2026, 9, 30, 2, 59, 59) / 1000)).toBe(Date.UTC(2026, 9, 30, 2) / 1000)
    expect(statNumber(1308)).toBe('1,308')
    expect(statNumber(691037)).toBe('691,037')
    expect(STATS_TAG).toBe('CYBERSPACE STATS')
  })

  it('his Fun Fact as he wrote it, and no em dash anywhere on a board', async () => {
    expect(AGENTS_FUN_FACT).toBe('Fun Fact: use cyberspace-mcp to bring your agent into cyberspace!')
    const snap = await countStats(world().input, AS_OF, 0)
    for (const id of BOARD_ORDER) {
      const b = boardFor(id, snap, nobody)
      if (b) expect(JSON.stringify(b)).not.toContain('\u2014')
    }
  })

  it('an agent is a bot with an operator, by its kind 0; a bot flag alone is not', () => {
    expect(isAgentProfile({ bot: true, operator: ARKINOX })).toBe(true)
    expect(isAgentProfile({ bot: true })).toBe(false)
    expect(isAgentProfile({ operator: ARKINOX })).toBe(false)
    expect(isAgentProfile(null)).toBe(false)
  })
})

describe('the break\'s clock (breakMayStart)', () => {
  const length = AD_IN_MS + BEATS.ranking.end * 1000
  const clear = { now: 1_000_000, due: 0, playing: true, busy: false, adDue: Infinity, adEndedAt: -Infinity, explainerDue: Infinity, explainerEndedAt: -Infinity, length }

  it('plays when due, the tape playing, nothing else on or near', () => {
    expect(breakMayStart(clear)).toBe(true)
    expect(breakMayStart({ ...clear, due: clear.now + 1 })).toBe(false)
    expect(breakMayStart({ ...clear, playing: false })).toBe(false)
    expect(breakMayStart({ ...clear, busy: true })).toBe(false)
  })

  it('keeps STATS_GAP_MS after a spot and after an explainer', () => {
    expect(STATS_GAP_MS).toBe(EXPLAINER_AD_GAP_MS)
    expect(breakMayStart({ ...clear, adEndedAt: clear.now - STATS_GAP_MS + 1 })).toBe(false)
    expect(breakMayStart({ ...clear, adEndedAt: clear.now - STATS_GAP_MS })).toBe(true)
    expect(breakMayStart({ ...clear, explainerEndedAt: clear.now - STATS_GAP_MS + 1 })).toBe(false)
  })

  it('and before the next spot or explainer: it waits rather than make either wait', () => {
    expect(breakMayStart({ ...clear, adDue: clear.now + length + STATS_GAP_MS - 1 })).toBe(false)
    expect(breakMayStart({ ...clear, adDue: clear.now + length + STATS_GAP_MS })).toBe(true)
    expect(breakMayStart({ ...clear, explainerDue: clear.now + length })).toBe(false)
    // A spot overdue (waiting on an explainer) holds it too.
    expect(breakMayStart({ ...clear, adDue: clear.now - 5 })).toBe(false)
  })

  it('every ten minutes on the site, fifteen on the stream, the first halfway between the first two spots', () => {
    expect(statsEveryMs(false)).toBe(2 * AD_EVERY_MS)
    expect(statsEveryMs(true)).toBe(BROADCAST_AD_EVERY_MS)
    expect(statsFirstMs(false)).toBe(1.5 * AD_EVERY_MS)
    expect(statsFirstMs(true)).toBe(BROADCAST_AD_EVERY_MS / 2)
  })

  it('a board runs its beats: a ranking about 17 s, the counts shorter', () => {
    const snapBoard = (kind: 'ranking' | 'count' | 'split') => statsLength({ kind } as StatsBoard)
    expect(snapBoard('ranking')).toBe(16.5)
    expect(snapBoard('count')).toBeLessThan(snapBoard('ranking'))
    expect(snapBoard('split')).toBeLessThan(snapBoard('ranking'))
  })
})

describe('the reads', () => {
  it('ask for the v2 movement events from V2_EPOCH, never v1 history, and not by A; the census asks for the deletions scoped by k', async () => {
    const asked: unknown[] = []
    const ask = async (f: unknown) => { asked.push(f); return [{ url: 'wss://relay.test', outcome: 'answered' as const, events: [] }] }
    expect(await loadStatsReads(ask as never)).toEqual({ actions: [] })
    expect(asked).toContainEqual(expect.objectContaining({ kinds: [3333], since: V2_EPOCH }))
    // Not scoped by A: a chain follows every event whatever its A (spec 8.9 rule 1); a game's own actions left out would cut it short.
    expect(asked.some((f) => (f as Record<string, unknown>)['#A'] !== undefined)).toBe(false)
    // A since before V2_EPOCH is V2_EPOCH.
    await loadStatsReads(ask as never, 5)
    expect(asked[asked.length - 1]).toEqual(expect.objectContaining({ since: V2_EPOCH }))
    await loadCensus(ask as never)
    expect(asked).toContainEqual(expect.objectContaining({ kinds: [5], '#k': ['33330', '33331'] }))
    // Never a bare kind 5 read.
    expect(asked.filter((f) => (f as { kinds: number[] }).kinds[0] === 5 && !(f as Record<string, unknown>)['#k'])).toEqual([])
    expect(WEEK_S).toBe(7 * DAY_S)
  })

  it('the ticker\'s "n BAGS HIDDEN" and MOST BAGS HIDDEN are one number', async () => {
    const w = world()
    // Six sealed on one UTC day: five count, on the marquee as on the board (the 37 against 36 seen in the local shots).
    const day = Math.floor((AS_OF - 3 * DAY_S) / DAY_S) * DAY_S
    const bags = [...w.input.bags, ...Array.from({ length: 6 }, (_, i): BagRecord => ({ id: nextId(), kind: 33330, pubkey: w.p3, d: `same${i}`, createdAt: day + i, sealed: true }))]
    const census = { arrivals: [], bags: [], objects: [], bagRecords: bags, objectRecords: [], deletions: [], firstSpawn: new Map(), readAt: 0, wholeAt: 0 }
    const snap = await countStats({ ...w.input, bags }, AS_OF, 0)
    expect(snap.bags.get(w.p3)).toBe(5)
    for (const pk of [ARKINOX, w.agent, w.p1, w.p2, w.p3]) expect(bagsHiddenAt(census, pk, AS_OF)).toBe(snap.bags.get(pk) ?? 0)
  })
})

describe('reading only what is new (review of #537)', () => {
  const answer = (events: NostrEvent[]) => [{ url: 'wss://relay.test', outcome: 'answered' as const, events }]

  it('the movement events: whole the first time, then since the last read less a day, merged; whole again after a day', async () => {
    const pk = key()
    const old = walk(pk, AS_OF - 3 * DAY_S, 2)
    const fresh = walk(pk, AS_OF + 600, 1)
    const asked: Array<Record<string, unknown>> = []
    let serve = old
    const ask = async (f: Record<string, unknown>) => { asked.push(f); return answer(serve.filter((e) => e.created_at >= (f.since as number))) }
    const first = await readActions(ask as never, null, AS_OF)
    expect(asked[0].since).toBe(V2_EPOCH)
    expect(first.byId.size).toBe(3)
    serve = [...old, ...fresh]
    const second = await readActions(ask as never, first, AS_OF + 3600)
    expect(asked[1].since).toBe(AS_OF - READ_OVERLAP_S)
    expect(second.byId.size).toBe(5)
    expect(second.wholeAt).toBe(AS_OF)
    await readActions(ask as never, second, AS_OF + READ_WHOLE_S)
    expect(asked[2].since).toBe(V2_EPOCH)
  })

  it('the census: whole the first time, then only what is new, merged by id', async () => {
    const pk = key()
    const spawn = walk(pk, AS_OF - DAY_S, 0)[0]
    const bag = (d: string, t: number): NostrEvent => ({ id: nextId(), pubkey: pk, created_at: t, kind: 33330, tags: [['d', d], ['encrypted', 'x']], content: '', sig: '' })
    const asked: Array<Record<string, unknown>> = []
    let serve: NostrEvent[] = [spawn, bag('one', AS_OF - DAY_S)]
    const ask = async (f: Record<string, unknown>) => {
      asked.push(f)
      const kinds = f.kinds as number[]
      return answer(serve.filter((e) => kinds.includes(e.kind) && (f.since === undefined || e.created_at >= (f.since as number))))
    }
    const c1 = await loadCensus(ask as never, null, AS_OF)
    expect(asked.filter((f) => f.since !== undefined && (f.kinds as number[])[0] !== 3333)).toEqual([])
    expect(c1.bags).toHaveLength(1)
    serve = [...serve, bag('two', AS_OF + 60)]
    asked.length = 0
    const c2 = await loadCensus(ask as never, c1, AS_OF + 3600)
    for (const f of asked) expect(f.since).toBe(AS_OF - READ_OVERLAP_S)
    expect(c2.bags).toHaveLength(2)
    expect(c2.firstSpawn.get(pk)).toBe(AS_OF - DAY_S)
    expect(bagsHiddenAt(c2, pk, AS_OF + 3600)).toBe(2)
  })
})
