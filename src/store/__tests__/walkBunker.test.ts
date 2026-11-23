/**
 * walkBunker.test.ts - fluid WALK signed by a remote signer (arkinox,
 * 2026-11-18: "When roaming in walk mode with fluid on, I can't explore for
 * more than a few seconds until I have to wait for my chain to catch up ...
 * I'm using bunker").
 *
 * A NIP-46 bunker answers each signature over a relay, often 0.3 to 2 s
 * later. The walk here is signed by a simulated bunker (lib/signers.ts
 * nip46Signer mocked: a real key that answers after a set latency, with
 * jitter, so concurrent requests come back out of order), the relays' head
 * confirmation takes a relay round trip, and the proofs take a phone's time.
 *
 * - the events ahead stay well under the slowdown (FLUID_EASE_FROM) on a
 *   straight, turning or zigzag walk at full speed with an 800 ms bunker;
 * - several signatures are out at once, and replies that come back out of
 *   order are put on the chain, and sent to the relays, in chain order;
 * - every event names the one before it, the chain reads whole, and every
 *   hop is proved from where the one before it landed;
 * - a declined signature stops the walk with what was signed before it kept,
 *   and nothing after it on the chain or the relays; a signer that hands back
 *   a different event than the one asked for stops it too.
 */
import { provedFor } from '../fixtures/provedHop'
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

type Req = { id: number; mode: string; from: { x: bigint; y: bigint; z: bigint }; to: { x: bigint; y: bigint; z: bigint }; plane: 0 | 1; prevEventId: string }
const posted = vi.hoisted(() => [] as Req[])
vi.mock('../../lib/workers', async (orig) => ({
  ...(await orig() as object),
  postProof: vi.fn((req: Req) => { posted.push(req) }),
  cancelProof: vi.fn(),
  setProofHandler: vi.fn(),
}))
vi.mock('../../lib/calibration', async (orig) => {
  const mod = await orig<typeof import('../../lib/calibration')>()
  return { ...mod, recommendedHopHeight: () => 40 }
})
/** Every event sent to the relays, in the order sent. */
const sent = vi.hoisted(() => [] as string[])
vi.mock('../../lib/relay', async (orig) => {
  const mod = await orig<typeof import('../../lib/relay')>()
  const { offlineRelay } = await import('../../test/offlineRelay')
  return {
    ...mod,
    ...offlineRelay,
    publishMany: vi.fn(async (relays: string[], ev: { id: string }) => { sent.push(ev.id); return { ok: true, accepted: relays } }),
    publish: vi.fn(async (ev: { id: string }) => { sent.push(ev.id); return { ok: true } }),
    query: vi.fn(async () => []),
    queryAny: vi.fn(async () => []),
  }
})
/** The relays' head confirmation: a round trip of `ms`, answering that nothing is newer. */
const relay = vi.hoisted(() => ({ ms: 0, asked: 0, out: 0, mostOut: 0 }))
vi.mock('../../lib/chains', async (orig) => ({
  ...(await orig() as object),
  fetchChainEvents: vi.fn(async () => []),
  confirmChainEvents: vi.fn(async (_pk: string, _spawn: string | undefined, _have: unknown[], opts: { reconnect?: boolean } = {}) => {
    // A move's head confirmation (confirmHead) says whether it reconnects; the publisher's own look does not, and is not counted.
    const move = 'reconnect' in opts
    if (move) { relay.asked++; relay.out++; relay.mostOut = Math.max(relay.mostOut, relay.out) }
    try {
      if (relay.ms > 0) await new Promise((r) => setTimeout(r, relay.ms))
    } finally { if (move) relay.out-- }
    return []
  }),
}))
/**
 * The simulated bunker: a real key that answers each signature `ms` later,
 * give or take `jitter` of it (a seeded draw, so a run is repeatable), or
 * declines the `declineAt`th request. Counts what is out at once.
 */
const bunker = vi.hoisted(() => ({ ms: 0, jitter: 0, seed: 1, out: 0, mostOut: 0, asked: 0, declineAt: 0, alterAt: 0, altered: '', answered: [] as string[] }))
vi.mock('../../lib/signers', async (orig) => {
  const mod = await orig<typeof import('../../lib/signers')>()
  const { finalizeEvent, generateSecretKey, getPublicKey } = await import('nostr-tools/pure')
  const { attributed } = await import('../../lib/client')
  const sk = generateSecretKey()
  const draw = (): number => { bunker.seed = (bunker.seed * 1103515245 + 12345) % 2147483648; return bunker.seed / 2147483648 }
  return {
    ...mod,
    nip46Signer: vi.fn(async (bunkerUri: string) => ({
      kind: 'nip46' as const,
      pubkey: getPublicKey(sk),
      bunkerUri,
      clientSecretKey: generateSecretKey(),
      signEvent: async (t: Parameters<typeof finalizeEvent>[0]) => {
        const n = ++bunker.asked
        bunker.out++
        bunker.mostOut = Math.max(bunker.mostOut, bunker.out)
        try {
          const ms = bunker.ms * (1 + bunker.jitter * (2 * draw() - 1))
          if (ms > 0) await new Promise((r) => setTimeout(r, ms))
          if (n === bunker.declineAt) throw new Error('rejected by user')
          // A signer that changes what it signs (here its created_at): a valid event, but not the one asked for.
          const ev = finalizeEvent(n === bunker.alterAt ? { ...attributed(t), created_at: t.created_at + 1 } : attributed(t), sk)
          if (n === bunker.alterAt) bunker.altered = ev.id
          bunker.answered.push(ev.id)
          return ev
        } finally { bunker.out-- }
      },
    })),
  }
})

import { newShard, type ShardModel } from 'sno-core/shards'
import { estimateHopCost } from 'cyberspace-core'
import { WALK_SIGNED_OTHER_MESSAGE, WALK_SIGNS_OUT, useCyberspace } from '../useCyberspace'
import { tickFall, useWalk } from '../useWalk'
import { useShards, type WorldItem } from '../useShards'
import { useWorkshop } from '../useWorkshop'
import { clearWalls, wallsBuilt } from '../walkWalls'
import { resetFluid, tickFluid } from '../walkFluid'
import { useFluidWalk } from '../fluidSwitch'
import { walkFacing } from '../../lib/walkEye'
import { projectCantorMs, useCalibration } from '../../lib/calibration'
import { withConstrain, type Constrain } from '../../lib/walkConstrain'
import { FLUID_EASE_FROM, FLUID_HOLD_AT } from '../../lib/fluidWalk'
import { eventsAhead } from '../walkAhead'
import { canonicalQuaternion, type Position, type ViewAxes } from '../../lib/space'
import { walkKeyDown, walkKeyUp, walkKeysReleased } from '../../hooks/useKeyboard'
import { buildChain, positionHex, type NostrEvent } from '../../lib/events'
import { placeSpawn } from '../fixtures/placeSpawn'
import { startPublisher } from '../../lib/publisher'

const S = () => useCyberspace.getState()
const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } }
const worldItemsOriginal = useShards.getState().worldItems

type V3 = [number, number, number]
function boxes(name: string, c: Constrain, list: Array<[V3, V3]>): ShardModel {
  const vertices: ShardModel['vertices'] = []
  const faces: Array<[number, number, number]> = []
  for (const [lo, hi] of list) {
    const base = vertices.length
    for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) vertices.push({ p: [x, y, z], c: [1, 1, 1] })
    for (const [a, b, cc, d] of [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]) {
      faces.push([base + a, base + b, base + cc], [base + a, base + cc, base + d])
    }
  }
  return withConstrain({ ...newShard(name), mode: 'solid', vertices, faces }, c)
}
function floorUnder(start: Position): void {
  const shard = boxes('Floor', 'all', [[[-400, -1, -400], [400, 0, 400]]])
  const item: WorldItem = { key: `floor-${shard.id}`, type: 'shard', at: { x: start.x, y: start.y - 1n, z: start.z }, plane: S().plane as WorldItem['plane'], height: 84, mine: false, shard }
  useShards.setState({ worldItems: () => [item] })
}

/** A phone's proof times by Cantor height (as walkFluid.test.ts has them), and the worker's own overhead. */
const PHONE = { 14: 300, 15: 700, 16: 1600, 17: 3800 }
const WORKER_MS = 30
function proofMs(req: Req): number {
  const est = estimateHopCost(req.from.x, req.from.y, req.from.z, req.to.x, req.to.y, req.to.z, req.plane ?? 0, 20)
  const lca = { x: est.lcaX, y: est.lcaY, z: est.lcaZ }
  return WORKER_MS + (['x', 'y', 'z'] as const).filter((a) => req.from[a] !== req.to[a]).reduce((ms, a) => ms + projectCantorMs(PHONE, lca[a]), 0)
}
const done = (req: Req) => ({ type: 'done' as const, id: req.id, mode: req.mode as 'hop', elapsedMs: 5, ...provedFor(req), terrainK: 3, lca: { x: 1, y: 0, z: 0 }, totalOps: 4, prevEventId: req.prevEventId })

let clock = 1_000_000
const key = (code: string) => ({ code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, preventDefault: () => {} })
function face(deg: number): void {
  const r = (deg * Math.PI) / 180
  walkFacing.forward = { x: Math.sin(r), y: 0, z: -Math.cos(r) }
  walkFacing.right = { x: Math.cos(r), y: 0, z: Math.sin(r) }
  walkFacing.valid = true
}

/** The proof worker: one proof at a time, the newest asked replacing any still running (lib/workers.ts postProof). */
const worker = { seen: 0, running: null as null | { req: Req; at: number } }

/** One frame of `ms`: timers (the bunker's and the relays' answers among them), the worker, fluid WALK, the fall. */
async function frame(ms = 16): Promise<void> {
  clock += ms
  await vi.advanceTimersByTimeAsync(ms)
  if (posted.length > worker.seen) { worker.running = { req: posted[posted.length - 1], at: clock }; worker.seen = posted.length }
  const run = worker.running
  if (run && clock >= run.at + proofMs(run.req)) {
    worker.running = null
    void S().applyProofMessage(done(run.req))
  }
  tickFluid(clock)
  tickFall(clock)
  for (let i = 0; i < 4; i++) await Promise.resolve()
}

/** The id an action names as the one before it. */
const previousOf = (e: NostrEvent): string | undefined => e.tags.find((t) => t[0] === 'e' && t[3] === 'previous')?.[1]

interface Run { most: number; at15: number | null; at20: number | null; landed: number }

/**
 * Walk `ms` holding W on a wide floor under gravity while `drive` steers, a
 * phone proving, the relays confirming in `relayMs`, the bunker signing in
 * `signMs` give or take `jitter`. Then let go and let everything land.
 */
async function walkWith(signMs: number, jitter: number, drive: (ms: number) => void, ms = 8000, relayMs = 150): Promise<Run> {
  bunker.ms = signMs
  bunker.jitter = jitter
  relay.ms = relayMs
  useCalibration.setState({ cantorMsByHeight: PHONE })
  floorUnder(S().position)
  useWalk.getState().setGravity(true)
  useWalk.getState().enter()
  useCyberspace.setState({ screenAxes: AXES })
  await frame()
  await wallsBuilt()
  face(0)
  walkKeyDown(key('KeyW'))
  const t0 = clock
  const run: Run = { most: 0, at15: null, at20: null, landed: 0 }
  const events0 = S().events.length
  while (clock - t0 < ms) {
    drive(clock - t0)
    await frame()
    const n = eventsAhead()
    run.most = Math.max(run.most, n)
    if (n > FLUID_EASE_FROM && run.at15 === null) run.at15 = clock - t0
    if (n >= FLUID_HOLD_AT && run.at20 === null) run.at20 = clock - t0
  }
  walkKeyUp('KeyW')
  for (let t = 0; t < 60_000; t += 16) {
    await frame()
    const w = useWalk.getState()
    if (w.queue.length === 0 && w.open === null && w.running === null && S().proof.status !== 'computing') break
  }
  run.landed = S().events.length - events0
  return run
}

/** The chain reads whole, each event names the one before it, and the relays got them in order. */
function chainHolds(): void {
  const events = S().events
  for (let i = 1; i < events.length; i++) expect(previousOf(events[i]), `event ${i}`).toBe(events[i - 1].id)
  expect(buildChain(events).length).toBe(events.length)
  expect(S().prevEventId).toBe(events[events.length - 1].id)
  // Each hop's C is where the walk stands after it, and the next one's c.
  for (let i = 2; i < events.length; i++) {
    const C = events[i - 1].tags.find((t) => t[0] === 'C')?.[1]
    expect(events[i].tags.find((t) => t[0] === 'c')?.[1]).toBe(C)
  }
  expect(events[events.length - 1].tags.find((t) => t[0] === 'C')?.[1]).toBe(positionHex(S().position, S().headPlane))
  // Sent in chain order: nothing reaches the relays before the event it names.
  const order = new Map(sent.map((id, n) => [id, n]))
  for (let i = 1; i < events.length; i++) {
    const a = order.get(events[i - 1].id)
    const b = order.get(events[i].id)
    if (a !== undefined && b !== undefined) expect(a, `sent ${i}`).toBeLessThan(b)
  }
}

const WALKS: Array<[string, (ms: number) => void]> = [
  ['straight', () => {}],
  ['turning', (ms) => face((ms / 1000) * 120)],
  ['zigzag', (ms) => face(Math.floor(ms / 400) % 2 ? 45 : -45)],
]

beforeEach(async () => {
  posted.length = 0
  sent.length = 0
  worker.seen = 0
  worker.running = null
  Object.assign(bunker, { ms: 0, jitter: 0, seed: 1, out: 0, mostOut: 0, asked: 0, declineAt: 0, alterAt: 0, altered: '', answered: [] })
  relay.ms = 0
  relay.asked = 0
  relay.out = 0
  relay.mostOut = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  walkKeysReleased()
  useWalk.getState().exit()
  useFluidWalk.setState({ on: true })
  useShards.setState({ worldItems: worldItemsOriginal })
  useWorkshop.setState({ open: false })
  clearWalls()
  if (S().signerKind !== 'nip46') await S().useBunker('bunker://simulated')
  expect(S().signerKind).toBe('nip46')
  useCyberspace.setState({ cloudPrefs: { ...S().cloudPrefs, mode: 'off' }, scaleExp: 0, view: canonicalQuaternion(), live: true })
  await placeSpawn()
  // The publisher drains your chain to the relays as the app does (App.tsx).
  startPublisher()
  S().cancel()
  useCalibration.setState({ cantorMsByHeight: undefined })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  resetFluid()
  face(0)
})

afterEach(() => {
  walkKeysReleased()
  useWalk.getState().exit()
  useFluidWalk.setState({ on: false })
  walkFacing.valid = false
  resetFluid()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Back to standing still at the head, for the next walk of a test. */
function reset(): void {
  walkKeysReleased()
  useWalk.getState().exit()
  bunker.mostOut = 0
  resetFluid()
  face(0)
}

describe('fluid WALK with a bunker (arkinox, 2026-11-18: "I can\'t explore for more than a few seconds")', () => {
  it('at 800 ms a signature, a straight, turning or zigzag walk stays well under the slowdown for 20 s, with several signatures out at once', async () => {
    // Before the lanes, one signature at a time: at 800 ms the turning walk
    // reached 15 ahead at 8.6 s and the stop (20) at 14.1 s, the zigzag at 7.9
    // and 11.0 s. With them, measured 1, 5 and 6 (straight, turning, zigzag),
    // up to 4 signatures out.
    const table: string[] = []
    for (const [signMs, jitter, most] of [[300, 0.3, 6], [800, 0.3, 8], [1500, 0.3, FLUID_EASE_FROM - 1], [2000, 0.3, FLUID_EASE_FROM - 1]] as const) {
      for (const [name, drive] of WALKS) {
        const r = await walkWith(signMs, jitter, drive, 20_000)
        table.push(`| ${signMs} ms | ${name} | ${r.most} | ${r.at15 ?? '-'} | ${r.at20 ?? '-'} | ${bunker.mostOut} |`)
        expect(r.most, `${signMs} ms ${name}`).toBeLessThanOrEqual(most)
        expect(r.at15, `${signMs} ms ${name}`).toBeNull()
        if (name !== 'straight') expect(bunker.mostOut, `${signMs} ms ${name}`).toBeGreaterThan(1)
        expect(bunker.mostOut).toBeLessThanOrEqual(WALK_SIGNS_OUT)
        // One head confirmation at a time: a reconnect never cuts another's short.
        expect(relay.mostOut).toBe(1)
        chainHolds()
        reset()
      }
    }
    if (process.env.WALK_BUNKER_TABLE) (await import('node:fs')).writeFileSync(process.env.WALK_BUNKER_TABLE, table.join('\n') + '\n')
  }, 120_000)

  it('a slow relay (400 ms a head confirmation) with an 800 ms bunker still stays under the slowdown', async () => {
    const r = await walkWith(800, 0.3, (ms) => face(Math.floor(ms / 400) % 2 ? 45 : -45), 20_000, 400)
    if (process.env.WALK_BUNKER_TABLE) (await import('node:fs')).appendFileSync(process.env.WALK_BUNKER_TABLE, `| 800 ms, relay 400 ms | zigzag | ${r.most} | ${r.at15 ?? '-'} | ${r.at20 ?? '-'} | ${bunker.mostOut} |\n`)
    expect(r.at15).toBeNull()
    expect(r.most).toBeLessThan(FLUID_EASE_FROM)
    chainHolds()
  }, 60_000)

  it('an X (cancel) while steps are on their way stops the walk cleanly: nothing stuck, and it walks on after', async () => {
    bunker.ms = 800
    relay.ms = 150
    useCalibration.setState({ cantorMsByHeight: PHONE })
    floorUnder(S().position)
    useWalk.getState().setGravity(true)
    useWalk.getState().enter()
    useCyberspace.setState({ screenAxes: AXES })
    await frame()
    await wallsBuilt()
    walkKeyDown(key('KeyW'))
    for (let t = 0; t < 3000; t += 16) { face(Math.floor(t / 400) % 2 ? 45 : -45); await frame() }
    expect(useWalk.getState().handed).toBeGreaterThan(0)
    S().cancel()
    for (let t = 0; t < 3000; t += 16) await frame()
    walkKeyUp('KeyW')
    expect(useWalk.getState()).toMatchObject({ queue: [], handed: 0, running: null })
    expect(S().proof.status).not.toBe('computing')
    chainHolds()
    reset()
    const r = await walkWith(800, 0.3, (ms) => face(Math.floor(ms / 400) % 2 ? 45 : -45), 3000)
    expect(r.landed).toBeGreaterThan(0)
    chainHolds()
  }, 60_000)

  it('replies that come back out of order go on the chain, and to the relays, in chain order', async () => {
    // 800 ms give or take 90%: a later request often answers first.
    const events0 = S().events.length
    await walkWith(800, 0.9, (ms) => face(Math.floor(ms / 400) % 2 ? 45 : -45), 6000)
    const events = S().events.slice(events0)
    expect(events.length).toBeGreaterThan(8)
    const answered = bunker.answered.filter((id) => events.some((e) => e.id === id))
    expect(answered).not.toEqual(events.map((e) => e.id))
    chainHolds()
    // Everything signed was sent, once each, in chain order.
    expect(sent.filter((id) => events.some((e) => e.id === id))).toEqual(events.map((e) => e.id))
  }, 60_000)

  it('a declined signature stops the walk: what was signed before it stays, nothing after it is kept or sent', async () => {
    bunker.declineAt = bunker.asked + 5
    const events0 = S().events.length
    await walkWith(800, 0.3, (ms) => face(Math.floor(ms / 400) % 2 ? 45 : -45), 6000)
    expect(useWalk.getState().queue).toEqual([])
    expect(S().proof.status).toBe('infeasible')
    expect(S().proof.message).toContain('rejected by user')
    // At most the four asked before it; requests go out in chain order.
    expect(S().events.length - events0).toBeLessThanOrEqual(4)
    chainHolds()
    const kept = new Set(S().events.map((e) => e.id))
    expect(sent.every((id) => kept.has(id))).toBe(true)
    // It walks on from the head after a fresh press.
    bunker.declineAt = 0
    reset()
    const r = await walkWith(800, 0.3, () => {}, 2000)
    expect(r.landed).toBeGreaterThan(0)
    chainHolds()
  }, 60_000)

  it('a signer that hands back a different event than the one asked for stops the walk, and that event is never kept', async () => {
    bunker.alterAt = bunker.asked + 3
    await walkWith(300, 0, (ms) => face(Math.floor(ms / 400) % 2 ? 45 : -45), 4000)
    expect(S().proof.message).toBe(WALK_SIGNED_OTHER_MESSAGE)
    expect(S().events.some((e) => e.id === bunker.altered)).toBe(false)
    expect(sent).not.toContain(bunker.altered)
    chainHolds()
  }, 60_000)
})

describe('a remote signer\'s answer and the landing (owner, 2026-11-21: "smooth until I\'m getting movements back from the signer")', () => {
  it('the hop\'s own check and the landing run in a task of their own after a remote signer answers, not inside its message', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const text = fs.readFileSync(path.resolve(__dirname, '../useCyberspace.ts'), 'utf8')
    const at = text.indexOf('event = await get().signEvent(lane.template!)')
    expect(at).toBeGreaterThan(0)
    const after = text.slice(at, at + 1_200)
    expect(after).toMatch(/if \(currentSigner\.kind !== 'local'\) await yieldTask\('land'\)\n\s*if \(!live\(\)\) return/)
    expect(after.indexOf("yieldTask('land')")).toBeGreaterThan(0)
    expect(after.indexOf("yieldTask('land')")).toBeLessThan(after.indexOf('localHopFailures('))
  })
})
