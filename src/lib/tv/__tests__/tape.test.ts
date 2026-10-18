/**
 * tape.test.ts: the tape is read forward in windows that halve when full and
 * double when quiet, skips v1 and game actions, and starts on a random event.
 */
import { describe, expect, it } from 'vitest'
import type { Filter } from 'nostr-tools'
import type { NostrEvent } from '../../events'
import type { RelayAnswer } from '../../relayOutcome'
import { CAP_SUSPECT, FIRST_WINDOW_S, TapeReader, TapeUnanswered, askAll, beatOf, randomStart } from '../tape'

const PK = 'e8ed3798c6ffebffa08501ac39e271662bfd160f688f94c45d692d8767dd345a'

let n = 0
function spawn(at: number, extra: string[][] = []): NostrEvent {
  return { id: (n++).toString(16).padStart(64, '0'), pubkey: PK, created_at: at, kind: 3333, tags: [['A', 'spawn'], ['C', PK], ...extra], content: '', sig: '' }
}

/**
 * A relay over a fixed list: honours since, until and limit, newest first,
 * as relays answer, and cuts every answer at `cap` without saying so, as
 * strfry does at 500. `down` answers nothing for that many questions first.
 */
function relay(events: NostrEvent[], { cap = Infinity, down = 0 } = {}): { ask: (f: Filter) => Promise<RelayAnswer[]>; asked: Filter[] } {
  const asked: Filter[] = []
  let failing = down
  return {
    asked,
    ask: async (f) => {
      asked.push(f)
      if (failing > 0) { failing--; return [{ url: 'wss://relay.test', outcome: 'unreachable', reason: 'down', events: [] }] }
      const got = events
        .filter((e) => (f.since === undefined || e.created_at >= f.since) && (f.until === undefined || e.created_at <= f.until))
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, Math.min(cap, f.limit ?? Infinity))
      return [{ url: 'wss://relay.test', outcome: 'answered', events: got }]
    },
  }
}

describe('beatOf', () => {
  it('reads a v2 spawn and skips a v1 event', () => {
    expect(beatOf(spawn(10))?.action.type).toBe('spawn')
    expect(beatOf(spawn(10, [['version', '1']]))).toBeNull()
  })
})

describe('TapeReader', () => {
  it('reads every event once, oldest first, across windows', async () => {
    const events = [spawn(100), spawn(5000), spawn(90_000)]
    const r = relay(events)
    const reader = new TapeReader(0, r.ask, () => 100_000)
    const seen: number[] = []
    while (!reader.caughtUp) for (const b of await reader.next()) seen.push(b.at)
    expect(seen).toEqual([100, 5000, 90_000])
    // Quiet windows doubled: far fewer questions than 100 000 s / 30 min.
    expect(r.asked.length).toBeLessThan(100_000 / FIRST_WINDOW_S)
  })

  it('loses nothing to a relay that caps its answers without saying so', async () => {
    const events: NostrEvent[] = []
    for (let i = 0; i < 1200; i++) events.push(spawn(1000 + Math.floor(i / 2)))
    const reader = new TapeReader(1000, relay(events, { cap: 500 }).ask, () => 10_000)
    let got = 0
    while (!reader.caughtUp) got += (await reader.next()).length
    expect(got).toBe(events.length)
  })

  it('never takes an unanswered window for an empty one', async () => {
    const r = relay([spawn(100), spawn(200)], { down: 1 })
    const reader = new TapeReader(0, r.ask, () => 1000)
    await expect(reader.next()).rejects.toBeInstanceOf(TapeUnanswered)
    expect(reader.readTo).toBe(0)
    const seen: number[] = []
    while (!reader.caughtUp) for (const b of await reader.next()) seen.push(b.at)
    expect(seen).toEqual([100, 200])
  })

  it('stops at the present instead of polling it', async () => {
    let now = 1000
    const r = relay([spawn(100)])
    const reader = new TapeReader(0, r.ask, () => now)
    while (!reader.caughtUp) await reader.next()
    const asked = r.asked.length
    now = 5000
    expect(await reader.next()).toEqual([])
    expect(r.asked.length).toBe(asked)
  })
})

describe('askAll', () => {
  it('pages back through a capped relay until it has everything', async () => {
    const events: NostrEvent[] = []
    for (let i = 0; i < 3 * CAP_SUSPECT + 7; i++) events.push(spawn(i))
    expect((await askAll(relay(events, { cap: CAP_SUSPECT }).ask, { kinds: [3333] })).length).toBe(events.length)
  })
})

describe('randomStart', () => {
  it('starts on one of the events after a random moment', async () => {
    const events = [spawn(500), spawn(600), spawn(700)]
    const at = await randomStart(0, relay(events).ask, 1000, () => 0.45)
    expect([500, 600, 700]).toContain(at)
  })

  it('gives up on an empty tape', async () => {
    expect(await randomStart(0, relay([]).ask, 1000, () => 0.5)).toBeNull()
  })
})
