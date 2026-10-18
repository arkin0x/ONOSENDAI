/**
 * tape.test.ts: the tape is read forward in windows that halve when full and
 * double when quiet, skips v1 and game actions, and starts on a random event.
 */
import { describe, expect, it } from 'vitest'
import type { Filter } from 'nostr-tools'
import type { NostrEvent } from '../../events'
import { FIRST_WINDOW_S, TapeReader, WINDOW_LIMIT, beatOf, randomStart } from '../tape'

const PK = 'e8ed3798c6ffebffa08501ac39e271662bfd160f688f94c45d692d8767dd345a'

let n = 0
function spawn(at: number, extra: string[][] = []): NostrEvent {
  return { id: (n++).toString(16).padStart(64, '0'), pubkey: PK, created_at: at, kind: 3333, tags: [['A', 'spawn'], ['C', PK], ...extra], content: '', sig: '' }
}

/** A relay over a fixed list: honours since, until and limit, newest first, as relays answer. */
function relay(events: NostrEvent[]): { ask: (f: Filter) => Promise<NostrEvent[]>; asked: Filter[] } {
  const asked: Filter[] = []
  return {
    asked,
    ask: async (f) => {
      asked.push(f)
      return events
        .filter((e) => (f.since === undefined || e.created_at >= f.since) && (f.until === undefined || e.created_at <= f.until))
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, f.limit ?? Infinity)
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

  it('halves a window that came back full and loses nothing', async () => {
    const events: NostrEvent[] = []
    for (let i = 0; i < WINDOW_LIMIT + 50; i++) events.push(spawn(1000 + Math.floor(i / 4)))
    const reader = new TapeReader(1000, relay(events).ask, () => 10_000)
    let got = 0
    while (!reader.caughtUp) got += (await reader.next()).length
    expect(got).toBe(events.length)
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
