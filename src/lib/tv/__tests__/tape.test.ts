/**
 * tape.test.ts: the tape is read forward in windows that halve when full and
 * double when quiet, skips v1 and game actions, and starts on a random event.
 */
import { describe, expect, it } from 'vitest'
import type { Filter } from 'nostr-tools'
import type { NostrEvent } from '../../events'
import type { RelayAnswer } from '../../relayOutcome'
import { CAP_SUSPECT, FIRST_WINDOW_S, TapeReader, TapeUnanswered, askAll, beatOf, itemOf, randomStart } from '../tape'
import { PLACEHOLDER } from '../../comments'
import { avatarTemplate } from '../../avatar'
import { newShard, toPayload } from 'sno-core/shards'

/** A real avatar payload, as the app writes it. */
const AVATAR_PAYLOAD = (() => {
  const s = newShard('me')
  s.vertices = [{ p: [0, 0, 0], c: [0, 0.9, 1] }, { p: [1, 0, 0], c: [0, 0.9, 1] }, { p: [0, 1, 0], c: [0, 0.9, 1] }]
  s.faces = [[0, 1, 2]]
  return avatarTemplate(s, 1).content
})()

/** A real object payload, as the workshop publishes it. */
const OBJECT_PAYLOAD = (() => {
  const s = newShard('tower')
  s.vertices = [{ p: [0, 0, 0], c: [0, 0.9, 1] }, { p: [1, 0, 0], c: [0, 0.9, 1] }, { p: [0, 1, 0], c: [0, 0.9, 1] }]
  s.faces = [[0, 1, 2]]
  return JSON.stringify(toPayload(s))
})()

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
      const ks = (f as { '#K'?: string[] })['#K']
      const got = events
        .filter((e) => (!f.kinds || f.kinds.includes(e.kind)) && (!ks || e.tags.some((t) => t[0] === 'K' && ks.includes(t[1]))))
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

function ev(kind: number, at: number, tags: string[][], content = ''): NostrEvent {
  return { id: (n++).toString(16).padStart(64, '0'), pubkey: PK, created_at: at, kind, tags, content, sig: '' }
}

describe('itemOf', () => {
  it('carries a bag\'s published nft count to the TV, as its cashu', () => {
    const item = itemOf(ev(33330, 5, [['d', 'a'.repeat(64)], ['contents', 'message', '1'], ['contents', 'nft', '1']]))
    expect(item).toMatchObject({ kind: 'bag', money: false, nft: true, counts: { message: '1', nft: '1' } })
    expect(itemOf(ev(33330, 5, [['d', 'a'.repeat(64)], ['contents', 'cashu']]))).toMatchObject({ money: true, nft: false })
  })
  // Spec 7.7 "Reading contents": CASHU INSIDE! and NFT INSIDE! only from rows a reader keeps.
  it('shows no money or NFT on TV for a row whose count is not a count, and any size of count', () => {
    const bag = (...rows: string[][]) => itemOf(ev(33330, 5, [['d', 'a'.repeat(64)], ...rows]))
    expect(bag(['contents', 'cashu', '0'])).toMatchObject({ money: false, nft: false, counts: null })
    expect(bag(['contents', 'cashu', 'lots'])).toMatchObject({ money: false, counts: null })
    expect(bag(['contents', 'nft', '+1'])).toMatchObject({ nft: false, counts: null })
    expect(bag(['contents', 'cashu', '1000000'], ['contents', 'nft', '2000000'])).toMatchObject({ money: true, nft: true, counts: { cashu: '1000000', nft: '2000000' } })
  })
  it('reads a bag, with its hint box only when it has one', () => {
    const hinted = itemOf(ev(33330, 5, [['d', 'a'.repeat(64)], ['h', '7'], ['hint', '3129509e23d3a6125e1451a5912dbe01099e1517200000000000000000000000', '30', '30', '30']]))
    expect(hinted?.kind).toBe('bag')
    expect(hinted?.kind === 'bag' && hinted.hint?.heights).toEqual([30, 30, 30])
    const bare = itemOf(ev(33330, 5, [['d', 'a'.repeat(64)]]))
    expect(bare?.kind === 'bag' && bare.hint).toBeNull()
  })

  it('reads a public object and skips a sealed one and an avatar', () => {
    expect(itemOf(ev(33331, 5, [['d', 'x']], OBJECT_PAYLOAD))?.kind).toBe('object')
    // One that does not read as a shard would be a product shot of nothing.
    expect(itemOf(ev(33331, 5, [['d', 'x']], '{}'))).toBeNull()
    expect(itemOf(ev(33331, 5, [['d', 'x'], ['encrypted', 'aes-256-gcm', 'zz']]))).toBeNull()
    expect(itemOf(ev(33331, 5, [['d', 'avatar']], '{}'))).toBeNull()
  })

  it('reads comments on moves and bags only, words public or sealed', () => {
    const onMove = itemOf(ev(1111, 5, [['E', 'b'.repeat(64)], ['K', '3333'], ['e', 'b'.repeat(64)], ['k', '3333'], ['P', 'c'.repeat(64)]], 'nice hop'))
    expect(onMove).toMatchObject({ kind: 'comment', on: 'move', text: 'nice hop', about: 'c'.repeat(64) })
    const onBag = itemOf(ev(1111, 5, [['A', `33330:${PK}:x`], ['K', '33330'], ['e', 'b'.repeat(64)], ['k', '3330'], ['encrypted', 'aes-256-gcm', 'zz']], PLACEHOLDER))
    expect(onBag).toMatchObject({ kind: 'comment', on: 'bag', text: null })
    expect(itemOf(ev(1111, 5, [['A', '34550:x:y'], ['K', '34550'], ['e', 'b'.repeat(64)], ['k', '1']], 'not ours'))).toBeNull()
  })

  it('reads a new avatar, and reactions to shards and moves only', () => {
    // A real avatar payload, as the app writes it.
    expect(itemOf(ev(11333, 5, [], AVATAR_PAYLOAD))?.kind).toBe('avatar')
    expect(itemOf(ev(11333, 5, [], ''))).toBeNull()
    expect(itemOf(ev(7, 5, [['e', 'b'.repeat(64)], ['k', '3330']], '👍'))).toMatchObject({ kind: 'reaction', content: '👍', on: 'shard' })
    expect(itemOf(ev(7, 5, [['e', 'b'.repeat(64)], ['k', '3333']], '+'))).toMatchObject({ kind: 'reaction', content: '♥', on: 'move' })
    expect(itemOf(ev(7, 5, [['e', 'b'.repeat(64)], ['k', '1']], '+'))).toBeNull()
  })

  it('a window gives its items beside its beats', async () => {
    const r = relay([spawn(100), ev(33330, 150, [['d', 'a'.repeat(64)]]), ev(1111, 160, [['E', 'b'.repeat(64)], ['K', '3333'], ['e', 'b'.repeat(64)], ['k', '3333']], 'hi')])
    const reader = new TapeReader(0, r.ask, () => 1000)
    const got = await reader.read()
    expect(got.beats.map((b) => b.at)).toEqual([100])
    expect(got.items.map((i) => i.kind)).toEqual(['bag', 'comment'])
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
