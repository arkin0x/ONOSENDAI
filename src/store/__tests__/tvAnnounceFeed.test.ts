/**
 * tvAnnounceFeed.test.ts: what carries the UPGRADE ANNOUNCEMENT (owner
 * rulings, 2026-11-12). Only the pinned announcer's signed kind 33338 events
 * play (a forged one never reaches the screen); each version plays once a
 * set, kept on the device from the moment it is handed to the screen, across
 * TV going off, a reload and a new build; only within 24 h of publishing,
 * while the week counts for N UPDATES THIS WEEK and lifts the marquee's
 * version; of the stored ones gathered at start only the newest plays, the
 * older kept as played (owner, 2026-11-13), live ones as they come; nothing
 * listens before TV's first shot; and nothing reloads the page after.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

if (typeof sessionStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { sessionStorage?: unknown }).sessionStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

vi.mock('../../lib/relay', () => ({
  publish: vi.fn(async () => ({ ok: true })),
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  queryEach: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
  subscribe: vi.fn(() => () => {}),
}))

/** The song-end listeners TV registers, so a test can end a song (there is no Audio here). */
const songEnd = new Set<() => void>()
vi.mock('../useTvMusic', async (importOriginal) => {
  const real = await importOriginal<typeof import('../useTvMusic')>()
  return { ...real, onSongEnd: (fn: () => void) => { songEnd.add(fn); return () => { songEnd.delete(fn) } } }
})
const endSong = (): void => { for (const fn of [...songEnd]) fn() }

const reloads: string[] = []
vi.mock('../../lib/tv/broadcast', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/tv/broadcast')>()
  return { ...real, reloadBroadcast: () => { reloads.push('reload') } }
})

import type { Filter } from 'nostr-tools'
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { decode } from 'nostr-tools/nip19'
import type { RelayAnswer } from '../../lib/relayOutcome'
import { positionHex, type NostrEvent } from '../../lib/events'
import { V2_EPOCH } from '../../lib/tv/tape'
import { setTvAsk, useTv } from '../useTv'
import { announceBusy, announceWaitingForTest, listenForAnnouncements, maybeSelfUpdate, playUpgradeAnnouncement, setAnnounceFeedForTest, useTvAnnounce, ANNOUNCE_GATHER_MS, ANNOUNCE_RECOUNT_MS, ANNOUNCE_SETTLE_MS } from '../useTvAnnounce'
import { useTvExplainer } from '../useTvExplainer'
import { HOSAKA_1 } from '../../lib/tv/hosakaAd'
import { setBroadcastForTest } from '../../lib/tv/broadcast'
import { announceMs, announcePlan, appVersion, releaseTicker } from '../../lib/tv/upgradeAnnounce'
import {
  ANNOUNCE_KIND, ANNOUNCE_TAG, ANNOUNCE_WEEK_S, ANNOUNCER_PUBKEY, AnnounceBook, PLAYED_KEY, SELF_UPDATE_EVERY_S, SELF_UPDATE_KEY, announceFilter, forgetPlayedForTest, readAnnouncement, rememberPlayed, selfUpdateWanted, wasPlayed,
} from '../../lib/tv/announceFeed'
import { compareVersions, higherVersion, simpleVersion } from '../../lib/version'

/** Tests cannot sign as the pinned announcer: this key stands in for it where the feed is told so. */
const SK = generateSecretKey()
const PK = getPublicKey(SK)
const OTHER = generateSecretKey()

const NOW = 1_800_000_000
const H = 3600

function announcement(version: string, text: string, at: number, opts: { sk?: Uint8Array; tags?: string[][]; created?: number } = {}): NostrEvent {
  const tags = opts.tags ?? [['d', version], ['t', ANNOUNCE_TAG], ['published_at', String(at)], ['alt', `ONOSENDAI ${version}`]]
  return finalizeEvent({ kind: ANNOUNCE_KIND, created_at: opts.created ?? at, tags, content: text }, opts.sk ?? SK) as unknown as NostrEvent
}

describe('the announcer and its events', () => {
  it('pins one key: the hex is the npub written beside it', () => {
    const d = decode('npub1sawgaw2k750pgkpkd2tqderxxtj37h4xvhzlc9vrvzsgjftpvlesmh030p')
    expect(d.type).toBe('npub')
    expect(d.data).toBe(ANNOUNCER_PUBKEY)
    expect(announceFilter(NOW)).toEqual({ kinds: [ANNOUNCE_KIND], authors: [ANNOUNCER_PUBKEY], since: NOW - ANNOUNCE_WEEK_S })
  })

  it('believes the announcer signed it, and nothing else', () => {
    const good = announcement('2.1', 'New things.', NOW - H)
    expect(readAnnouncement(good, PK)).toEqual({ version: '2.1', text: 'New things.', at: NOW - H, created: NOW - H })
    // The real pinned key: an event signed by anyone else is never it, whatever it says its author is.
    expect(readAnnouncement(good)).toBeNull()
    const claimed = { ...announcement('2.1', 'Forged.', NOW - H, { sk: OTHER }), pubkey: ANNOUNCER_PUBKEY }
    expect(readAnnouncement(claimed)).toBeNull()
    // Another author, well signed: not the announcer.
    expect(readAnnouncement(announcement('2.1', 'Other.', NOW - H, { sk: OTHER }), PK)).toBeNull()
    // The announcer's own, edited after it was signed: words, version, or the signature itself.
    expect(readAnnouncement({ ...good, content: 'Edited.' }, PK)).toBeNull()
    expect(readAnnouncement({ ...good, tags: [['d', '9.9'], ...good.tags.slice(1)] }, PK)).toBeNull()
    expect(readAnnouncement({ ...good, sig: good.sig.replace(/^./, (c) => (c === '0' ? '1' : '0')) }, PK)).toBeNull()
  })

  it('does not take a signature check remembered on the object for one over the edited fields', () => {
    const ev = announcement('2.1', 'Original.', NOW - H)
    expect(verifyEvent(ev as Parameters<typeof verifyEvent>[0])).toBe(true)
    // nostr-tools marks a verified object under a symbol an edit in place keeps.
    ev.content = 'Swapped after a check.'
    expect(readAnnouncement(ev, PK)).toBeNull()
  })

  it('wants its kind, its t and a simple version for d', () => {
    expect(readAnnouncement(announcement('2.1', 'x', NOW, { tags: [['d', '2.1']] }), PK)).toBeNull()
    expect(readAnnouncement(announcement('TEST', 'x', NOW, { tags: [['d', 'TEST'], ['t', ANNOUNCE_TAG]] }), PK)).toBeNull()
    const k1 = finalizeEvent({ kind: 1, created_at: NOW, tags: [['d', '2.1'], ['t', ANNOUNCE_TAG]], content: 'x' }, SK) as unknown as NostrEvent
    expect(readAnnouncement(k1, PK)).toBeNull()
    // published_at after created_at is not believed: created_at is.
    const late = announcement('2.1', 'x', NOW - 2 * H, { tags: [['d', '2.1'], ['t', ANNOUNCE_TAG], ['published_at', String(NOW)]] })
    expect(readAnnouncement(late, PK)?.at).toBe(NOW - 2 * H)
  })
})

describe('the week, what is due, and the versions', () => {
  const heard = (version: string, at: number, created = at) => ({ version, text: version, at, created })

  it('counts and plays one dated ahead only once this clock is near its time (a slow clock catches up)', () => {
    const b = new AnnounceBook()
    const ahead = readAnnouncement(announcement('2.7', 'From a clock ahead.', NOW + 2 * H), PK)!
    expect(ahead).not.toBeNull()
    b.add(ahead)
    expect(b.count(NOW)).toBe(0)
    expect(b.due(NOW, () => false)).toEqual([])
    expect(b.count(NOW + 2 * H)).toBe(1)
    expect(b.due(NOW + 2 * H, () => false).map((a) => a.version)).toEqual(['2.7'])
  })

  it('counts the versions of the week, the newest by number, and plays only those under a day old', () => {
    const b = new AnnounceBook()
    b.add(heard('2.9', NOW - 3 * 24 * H))
    b.add(heard('2.10', NOW - 2 * H))
    b.add(heard('2.8', NOW - 8 * 24 * H))
    expect(b.count(NOW)).toBe(2)
    expect(b.newest(NOW)).toBe('2.10')
    expect(b.due(NOW, () => false).map((a) => a.version)).toEqual(['2.10'])
    expect(b.due(NOW, (v) => v === '2.10')).toEqual([])
    // An edit of a version keeps one, the newer; an older copy changes nothing.
    expect(b.add(heard('2.10', NOW - 2 * H, NOW - H))).toBe(true)
    expect(b.add(heard('2.10', NOW - 2 * H, NOW - 3 * H))).toBe(false)
    expect(b.count(NOW)).toBe(2)
  })

  it('reads package.json versions as simple ones, compares them as numbers, and picks the higher', () => {
    expect(simpleVersion('2.1.0')).toBe('2.1')
    expect(simpleVersion('2.1.1')).toBe('2.1.1')
    expect(simpleVersion('2.0.0-mvp.0')).toBeNull()
    expect(compareVersions('2.10', '2.9')).toBeGreaterThan(0)
    expect(compareVersions('2.1', '2.1.0')).toBe(0)
    expect(higherVersion('2.1', '2.2')).toBe('2.2')
    expect(higherVersion('2.10', '2.9')).toBe('2.10')
    expect(higherVersion('2.1', null)).toBe('2.1')
    expect(higherVersion(null, '2.3')).toBe('2.3')
    expect(higherVersion('2.1', 'unversioned build')).toBe('2.1')
    expect(releaseTicker(higherVersion(appVersion(), '99.1'), 1)).toEqual(['ONOSENDAI VERSION 99.1', '1 UPDATE THIS WEEK'])
  })

  it('this build has a simple version, from package.json', () => {
    expect(appVersion()).toMatch(/^\d+\.\d+(\.\d+)?$/)
  })

  it('remembers what played on the device, across a reload, and in memory where storage fails', async () => {
    forgetPlayedForTest()
    rememberPlayed('2.1', NOW)
    expect(JSON.parse(localStorage.getItem(PLAYED_KEY)!)).toEqual({ '2.1': NOW })
    vi.resetModules()
    const fresh = await import('../../lib/tv/announceFeed')
    expect(fresh.wasPlayed('2.1', NOW)).toBe(true)
    expect(fresh.wasPlayed('2.1', NOW + 9 * 24 * H)).toBe(false)
    const spy = vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    const set = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    rememberPlayed('2.2', NOW)
    expect(wasPlayed('2.2', NOW)).toBe(true)
    spy.mockRestore()
    set.mockRestore()
    forgetPlayedForTest()
  })
})

// ---- The feed on a running TV ----

const A = '1'.repeat(64)
const B = '2'.repeat(64)
let n = 0
const id = (): string => (n++).toString(16).padStart(64, 'f')
const at = (x: bigint) => positionHex({ x, y: 5n, z: 7n }, 0)
function spawnOf(pubkey: string, t: number): NostrEvent {
  return { id: id(), pubkey, created_at: t, kind: 3333, tags: [['A', 'spawn'], ['C', pubkey]], content: '', sig: '' }
}
function hop(pubkey: string, t: number, from: bigint, to: bigint): NostrEvent {
  return { id: id(), pubkey, created_at: t, kind: 3333, tags: [['A', 'hop'], ['e', '0'.repeat(64), '', 'genesis'], ['e', '0'.repeat(64), '', 'previous'], ['c', at(from)], ['C', at(to)], ['proof', 'a'.repeat(64)]], content: '', sig: '' }
}
const T0 = V2_EPOCH + 1000
const tape: NostrEvent[] = [spawnOf(A, T0), hop(B, T0 + 100, 1000n, 1001n), hop(B, T0 + 102, 1001n, 1002n), hop(B, T0 + 104, 1002n, 1003n), hop(B, T0 + 106, 1003n, 1004n)]
async function ask(f: Filter): Promise<RelayAnswer[]> {
  return [{ url: 'wss://relay.test', outcome: 'answered', events: tape
    .filter((e) => (!f.kinds || f.kinds.includes(e.kind)) && (f.since === undefined || e.created_at >= f.since) && (f.until === undefined || e.created_at <= f.until) && (!f.authors || f.authors.includes(e.pubkey)))
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, f.limit ?? Infinity) }]
}
async function run(ms: number): Promise<void> {
  for (let t = 0; t < ms; t += 100) await vi.advanceTimersByTimeAsync(100)
}

/** The relay, as the feed sees it: what it was asked, and a way to send it events and say it is done. */
interface FakeSub { filter: Filter; event: (ev: NostrEvent) => void; eose: () => void; closed: boolean }
let subs: FakeSub[] = []
function fakeSubscribe(filter: Filter, onEvent: (ev: NostrEvent) => void, onEose?: () => void): () => void {
  const s: FakeSub = { filter, event: onEvent, eose: () => onEose?.(), closed: false }
  subs.push(s)
  return () => { s.closed = true }
}
const showingVersion = (): string | null => useTvAnnounce.getState().showing?.plan.version ?? null

let clock = NOW

beforeEach(() => {
  subs = []
  reloads.length = 0
  clock = NOW
  forgetPlayedForTest()
  localStorage.removeItem(SELF_UPDATE_KEY)
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance'] })
  let calls = 0
  vi.spyOn(Math, 'random').mockImplementation(() => (calls++ % 2 === 0 ? 0 : 0.999))
  setTvAsk(ask)
  setAnnounceFeedForTest(fakeSubscribe, () => clock, PK)
})

afterEach(() => {
  useTv.getState().stop()
  useTvAnnounce.setState({ updatesThisWeek: null, announcedVersion: null })
  setAnnounceFeedForTest(null)
  setBroadcastForTest(null)
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the feed on TV', () => {
  it('asks nothing before the first shot, then once, for the announcer\'s week', async () => {
    useTv.getState().start()
    expect(subs).toHaveLength(0)
    await run(2500)
    expect(useTv.getState().shot).not.toBeNull()
    expect(subs).toHaveLength(1)
    expect(subs[0].filter).toEqual({ kinds: [ANNOUNCE_KIND], authors: [PK], since: NOW - ANNOUNCE_WEEK_S })
    listenForAnnouncements()
    await run(20_000)
    expect(subs).toHaveLength(1)
    useTv.getState().stop()
    expect(subs[0].closed).toBe(true)
  })

  it('plays the newest of what is stored once the relay is done, the older kept as played; a forged one never plays nor counts', async () => {
    useTv.getState().start()
    await run(2500)
    const s = subs[0]
    s.event(announcement('2.3', 'Third.', NOW - 2 * H))
    s.event(announcement('2.2', 'Second.', NOW - 3 * H))
    s.event({ ...announcement('9.9', 'Forged.', NOW - H, { sk: OTHER }), pubkey: PK })
    s.event(announcement('2.1', 'Old news.', NOW - 3 * 24 * H))
    expect(announceBusy()).toBe(false)
    expect(useTvAnnounce.getState().updatesThisWeek).toBeNull()
    s.eose()
    expect(showingVersion()).toBe('2.3')
    expect(announceWaitingForTest()).toBe(0)
    expect(useTvAnnounce.getState().updatesThisWeek).toBe(3)
    expect(useTvAnnounce.getState().announcedVersion).toBe('2.3')
    expect(wasPlayed('2.2', NOW)).toBe(true)
    expect(wasPlayed('2.1', NOW)).toBe(false)
    expect(wasPlayed('9.9', NOW)).toBe(false)
    await run(announceMs(announcePlan({ version: '2.3', text: 'Third.' })!) + 500)
    expect(announceBusy()).toBe(false)
  })

  it('plays what the relay holds after ANNOUNCE_GATHER_MS when it never says it is done', async () => {
    useTv.getState().start()
    await run(2500)
    subs[0].event(announcement('2.1', 'Hello.', NOW - H))
    expect(announceBusy()).toBe(false)
    await run(ANNOUNCE_GATHER_MS + 200)
    expect(showingVersion()).toBe('2.1')
  })

  it('plays one that arrives while TV runs, at once; a copy or an edit of it never again', async () => {
    useTv.getState().start()
    await run(2500)
    subs[0].eose()
    expect(useTvAnnounce.getState().updatesThisWeek).toBe(0)
    expect(announceBusy()).toBe(false)
    clock = NOW + 120
    const ev = announcement('2.4', 'Fresh off the press.', NOW + 60)
    subs[0].event(ev)
    expect(showingVersion()).toBe('2.4')
    expect(useTvAnnounce.getState().updatesThisWeek).toBe(1)
    await run(announceMs(announcePlan({ version: '2.4', text: ev.content })!) + 500)
    expect(announceBusy()).toBe(false)
    subs[0].event(ev)
    subs[0].event(announcement('2.4', 'Edited words.', NOW + 60, { created: NOW + 90 }))
    expect(announceBusy()).toBe(false)
    expect(useTvAnnounce.getState().updatesThisWeek).toBe(1)
  })

  it('does not play a version again when TV comes back on, or after a reload', async () => {
    useTv.getState().start()
    await run(2500)
    subs[0].event(announcement('2.5', 'Once.', NOW - H))
    subs[0].eose()
    expect(showingVersion()).toBe('2.5')
    useTv.getState().stop()
    useTv.getState().start()
    await run(2500)
    expect(subs).toHaveLength(2)
    subs[1].event(announcement('2.5', 'Once.', NOW - H))
    subs[1].eose()
    expect(announceBusy()).toBe(false)
    expect(useTvAnnounce.getState().updatesThisWeek).toBe(1)
    // A reload: the page's memory gone, the device's kept.
    vi.resetModules()
    const fresh = await import('../../lib/tv/announceFeed')
    expect(fresh.wasPlayed('2.5', NOW)).toBe(true)
  })

  it('does not reload the page straight after one plays, nor ever off the stream', async () => {
    // A version above this build's, so only the rules below keep the page from reloading.
    const next = bumped()
    useTv.getState().start()
    await run(2500)
    expect(songEnd.size).toBe(0)
    subs[0].event(announcement(next, 'Site.', NOW - H))
    subs[0].eose()
    await run(announceMs(announcePlan({ version: next, text: 'Site.' })!) + 5000)
    expect(announceBusy()).toBe(false)
    expect(maybeSelfUpdate()).toBe(false)
    expect(reloads).toEqual([])
  })

  it('keeps a version played the moment it is handed to the screen: one waiting when TV goes off, or pushed out of the queue, never plays again', async () => {
    useTv.getState().start()
    await run(2500)
    subs[0].eose()
    clock = NOW + 120
    for (const v of ['2.2', '2.3', '2.4', '2.5', '2.6']) subs[0].event(announcement(v, `Version ${v}.`, NOW + 60))
    // Live, one after another: 2.2 on screen, three wait (QUEUE_MAX), 2.3 pushed out.
    expect(showingVersion()).toBe('2.2')
    expect(announceWaitingForTest()).toBe(3)
    for (const v of ['2.2', '2.3', '2.4', '2.5', '2.6']) expect(wasPlayed(v, NOW)).toBe(true)
    // TV off with three waiting, and back on: none of them plays again, nor the one pushed out.
    useTv.getState().stop()
    useTv.getState().start()
    await run(2500)
    for (const v of ['2.2', '2.3', '2.4', '2.5', '2.6']) subs[1].event(announcement(v, `Version ${v}.`, NOW - H))
    subs[1].eose()
    expect(announceBusy()).toBe(false)
    await run(ANNOUNCE_RECOUNT_MS + 500)
    expect(announceBusy()).toBe(false)
  })

  it('plays nothing already handed over after a reload mid-queue, nor after a new build', async () => {
    useTv.getState().start()
    await run(2500)
    for (const v of ['2.4', '2.5']) subs[0].event(announcement(v, `Version ${v}.`, NOW - 2 * H))
    subs[0].eose()
    expect(showingVersion()).toBe('2.5')
    clock = NOW + 120
    subs[0].event(announcement('2.6', 'Version 2.6.', NOW + 60))
    subs[0].event(announcement('2.7', 'Version 2.7.', NOW + 60))
    expect(announceWaitingForTest()).toBe(2)
    // The page reloads mid-queue, onto a new build: the page's memory gone, the device's kept.
    const kept = localStorage.getItem(PLAYED_KEY)
    useTv.getState().stop()
    const newBuild = bumped(5)
    vi.resetModules()
    vi.doMock('../../lib/tv/upgradeAnnounce', async (importOriginal) => ({ ...await importOriginal<typeof import('../../lib/tv/upgradeAnnounce')>(), appVersion: () => newBuild }))
    const tv = await import('../useTv')
    const announce = await import('../useTvAnnounce')
    try {
      const announceFeed = await import('../../lib/tv/announceFeed')
      const upgrade = await import('../../lib/tv/upgradeAnnounce')
      expect(upgrade.appVersion()).toBe(newBuild)
      expect(localStorage.getItem(PLAYED_KEY)).toBe(kept)
      for (const v of ['2.4', '2.5', '2.6', '2.7']) expect(announceFeed.wasPlayed(v, NOW)).toBe(true)
      tv.setTvAsk(ask)
      announce.setAnnounceFeedForTest(fakeSubscribe, () => clock, PK)
      const before = subs.length
      tv.useTv.getState().start()
      await run(2500)
      expect(subs.length).toBe(before + 1)
      const s = subs[before]
      for (const v of ['2.4', '2.5', '2.6', '2.7']) s.event(announcement(v, `Version ${v}.`, NOW - H))
      s.eose()
      expect(announce.announceBusy()).toBe(false)
      expect(announce.useTvAnnounce.getState().updatesThisWeek).toBe(4)
      await run(ANNOUNCE_RECOUNT_MS + 500)
      expect(announce.announceBusy()).toBe(false)
    } finally {
      tv.useTv.getState().stop()
      announce.setAnnounceFeedForTest(null)
      vi.doUnmock('../../lib/tv/upgradeAnnounce')
    }
  })

  it('on a set that has never had TV on, plays only the newest fresh one at start; the older ones are kept as played and never play', async () => {
    useTv.getState().start()
    await run(2500)
    subs[0].event(announcement('2.4', 'Fourth.', NOW - 20 * H))
    subs[0].event(announcement('2.6', 'Sixth.', NOW - H))
    subs[0].event(announcement('2.5', 'Fifth.', NOW - 10 * H))
    subs[0].eose()
    expect(showingVersion()).toBe('2.6')
    expect(announceWaitingForTest()).toBe(0)
    for (const v of ['2.4', '2.5', '2.6']) expect(wasPlayed(v, NOW)).toBe(true)
    // The week and the marquee are as before.
    expect(useTvAnnounce.getState().updatesThisWeek).toBe(3)
    expect(useTvAnnounce.getState().announcedVersion).toBe('2.6')
    await run(announceMs(announcePlan({ version: '2.6', text: 'Sixth.' })!) + 500)
    expect(announceBusy()).toBe(false)
    // The next count plays none of the older ones.
    await run(ANNOUNCE_RECOUNT_MS + 500)
    expect(announceBusy()).toBe(false)
    // Nor does TV coming back on.
    useTv.getState().stop()
    useTv.getState().start()
    await run(2500)
    for (const v of ['2.4', '2.5', '2.6']) subs[1].event(announcement(v, `Version ${v}.`, NOW - H))
    subs[1].eose()
    expect(announceBusy()).toBe(false)
  })

  it('still plays one that arrives after the gather, as it comes, and queues several that arrive while one plays', async () => {
    useTv.getState().start()
    await run(2500)
    subs[0].event(announcement('2.4', 'Fourth.', NOW - 3 * H))
    subs[0].event(announcement('2.5', 'Fifth.', NOW - 2 * H))
    subs[0].eose()
    expect(showingVersion()).toBe('2.5')
    await run(announceMs(announcePlan({ version: '2.5', text: 'Fifth.' })!) + 500)
    expect(announceBusy()).toBe(false)
    clock = NOW + 120
    subs[0].event(announcement('2.6', 'Sixth.', NOW + 60))
    expect(showingVersion()).toBe('2.6')
    subs[0].event(announcement('2.7', 'Seventh.', NOW + 90))
    subs[0].event(announcement('2.8', 'Eighth.', NOW + 110))
    expect(showingVersion()).toBe('2.6')
    expect(announceWaitingForTest()).toBe(2)
    const each = announceMs(announcePlan({ version: '2.6', text: 'Sixth.' })!)
    await run(3 * each + 1000)
    expect(announceBusy()).toBe(false)
    for (const v of ['2.6', '2.7', '2.8']) expect(wasPlayed(v, NOW)).toBe(true)
  })

  it('holds stored ones a slow relay sends after the gather to the same rule: only the newest plays, oldest first or not', async () => {
    useTv.getState().start()
    await run(2500)
    // The relay says nothing within ANNOUNCE_GATHER_MS: the gather ends on an empty week.
    await run(ANNOUNCE_GATHER_MS + 200)
    expect(useTvAnnounce.getState().updatesThisWeek).toBe(0)
    for (const [v, ago] of [['2.4', 20], ['2.5', 10], ['2.6', 2]] as const) subs[0].event(announcement(v, `Version ${v}.`, NOW - ago * H))
    expect(announceBusy()).toBe(false)
    await run(ANNOUNCE_SETTLE_MS + 200)
    expect(showingVersion()).toBe('2.6')
    expect(announceWaitingForTest()).toBe(0)
    for (const v of ['2.4', '2.5', '2.6']) expect(wasPlayed(v, NOW)).toBe(true)
    await run(announceMs(announcePlan({ version: '2.6', text: 'Version 2.6.' })!) + 500)
    // An older one later still never plays.
    subs[0].event(announcement('2.3', 'Version 2.3.', NOW - 22 * H))
    await run(ANNOUNCE_SETTLE_MS + ANNOUNCE_RECOUNT_MS + 500)
    expect(announceBusy()).toBe(false)
    expect(wasPlayed('2.3', NOW)).toBe(true)
  })

  it('plays nothing at start when this set has already played the newest fresh one, and keeps the older ones as played', async () => {
    rememberPlayed('2.6', NOW - H)
    useTv.getState().start()
    await run(2500)
    for (const [v, ago] of [['2.4', 20], ['2.5', 10], ['2.6', 2]] as const) subs[0].event(announcement(v, `Version ${v}.`, NOW - ago * H))
    subs[0].eose()
    expect(announceBusy()).toBe(false)
    expect(useTvAnnounce.getState().updatesThisWeek).toBe(3)
    for (const v of ['2.4', '2.5']) expect(wasPlayed(v, NOW)).toBe(true)
    await run(ANNOUNCE_RECOUNT_MS + 500)
    expect(announceBusy()).toBe(false)
  })

  it('leaves the feed alone for /tv?announce=test, which plays the sample', async () => {
    useTv.getState().start()
    await run(2500)
    useTv.getState().stop()
    subs = []
    useTv.getState().start()
    listenForAnnouncements('?announce=test')
    expect(subs).toHaveLength(0)
  })
})

/** A version above this build's own. */
function bumped(by = 1): string {
  const [major, minor] = (appVersion() ?? '2.0').split('.').map(Number)
  return `${major}.${minor + by}`
}

describe('the stream\'s gentle self-update (owner, 2026-11-12)', () => {
  it('wants a newer announced version, and at most one reload a day', () => {
    expect(selfUpdateWanted('2.1', '2.2', null, NOW)).toBe(true)
    expect(selfUpdateWanted('2.1', '2.1', null, NOW)).toBe(false)
    expect(selfUpdateWanted('2.10', '2.9', null, NOW)).toBe(false)
    expect(selfUpdateWanted(null, '2.2', null, NOW)).toBe(false)
    expect(selfUpdateWanted('2.1', null, null, NOW)).toBe(false)
    expect(selfUpdateWanted('2.1', '2.2', NOW - SELF_UPDATE_EVERY_S + 60, NOW)).toBe(false)
    expect(selfUpdateWanted('2.1', '2.2', NOW - SELF_UPDATE_EVERY_S, NOW)).toBe(true)
  })

  async function onTheStream(): Promise<FakeSub> {
    setBroadcastForTest(true)
    useTv.getState().start()
    await run(2500)
    return subs[0]
  }

  it('reloads at a song\'s end once the announcement of a newer version has played', async () => {
    const s = await onTheStream()
    const next = bumped()
    s.event(announcement(next, 'New build.', NOW - H))
    s.eose()
    expect(showingVersion()).toBe(next)
    // Not during the announcement.
    endSong()
    expect(reloads).toEqual([])
    await run(announceMs(announcePlan({ version: next, text: 'New build.' })!) + 500)
    expect(announceBusy()).toBe(false)
    // Not between songs only: it waits for one to end.
    await run(60_000)
    expect(reloads).toEqual([])
    endSong()
    expect(reloads).toEqual(['reload'])
    expect(Number(localStorage.getItem(SELF_UPDATE_KEY))).toBe(NOW)
  })

  it('does not reload for a version that is not newer than the build it runs', async () => {
    const s = await onTheStream()
    s.event(announcement(appVersion()!, 'Same build.', NOW - 2 * 24 * H))
    s.eose()
    endSong()
    expect(reloads).toEqual([])
  })

  it('reloads at most once a day, the day kept across the reload', async () => {
    const s = await onTheStream()
    s.event(announcement(bumped(), 'Old enough not to play.', NOW - 2 * 24 * H))
    s.eose()
    endSong()
    expect(reloads).toEqual(['reload'])
    // The reloaded page (the same build: the deploy was not live yet) and a newer one still: not before the day is up.
    // TV off on the stream reloads it too (store/useTv): not this rule's.
    useTv.getState().stop()
    reloads.length = 0
    setBroadcastForTest(true)
    clock = NOW + 6 * H
    useTv.getState().start()
    await run(2500)
    subs[1].event(announcement(bumped(2), 'Another.', NOW - 2 * 24 * H))
    subs[1].eose()
    endSong()
    expect(reloads).toEqual([])
    clock = NOW + SELF_UPDATE_EVERY_S
    endSong()
    expect(reloads).toEqual(['reload'])
  })

  it('waits while an explainer, a HOSAKA spot or a stats board is on, or an announcement waits to play', async () => {
    const s = await onTheStream()
    s.event(announcement(bumped(), 'Week old news.', NOW - 2 * 24 * H))
    s.eose()
    useTvExplainer.setState({ showing: { phase: 'in' } as never })
    endSong()
    useTvExplainer.setState({ showing: null })
    useTv.setState({ ad: { at: performance.now(), id: HOSAKA_1.id } })
    endSong()
    useTv.setState({ ad: null, stats: { at: performance.now(), board: 'census' as never } })
    endSong()
    useTv.setState({ stats: null })
    expect(playUpgradeAnnouncement({ version: '2.0', text: 'Playing.' })).toBe(true)
    endSong()
    expect(reloads).toEqual([])
    await run(announceMs(announcePlan({ version: '2.0', text: 'Playing.' })!) + 500)
    endSong()
    expect(reloads).toEqual(['reload'])
  })

  it('waits for those queued to play before it reloads; one pushed out of the queue does not hold it back', async () => {
    const s = await onTheStream()
    s.eose()
    clock = NOW + 120
    const versions = [1, 2, 3, 4, 5].map((k) => bumped(k))
    for (const v of versions) s.event(announcement(v, `Version ${v}.`, NOW + 60))
    const each = announceMs(announcePlan({ version: versions[0], text: `Version ${versions[0]}.` })!)
    // Not while one plays or three wait.
    endSong()
    await run(each + 500)
    endSong()
    expect(reloads).toEqual([])
    // Four play through; the one pushed out is kept as played, not due.
    await run(3 * each + 2000)
    expect(announceBusy()).toBe(false)
    expect(wasPlayed(versions[1], NOW)).toBe(true)
    endSong()
    expect(reloads).toEqual(['reload'])
  })

  it('does not reload while the stream is waiting out its reload backoff, nor spend the day on it', async () => {
    const s = await onTheStream()
    s.event(announcement(bumped(), 'Week old news.', NOW - 2 * 24 * H))
    s.eose()
    const t = Date.now()
    sessionStorage.setItem('onosendai:tvBroadcastReloads', JSON.stringify([t - 1000, t - 2000, t - 3000]))
    endSong()
    expect(reloads).toEqual([])
    expect(localStorage.getItem(SELF_UPDATE_KEY)).toBeNull()
    sessionStorage.removeItem('onosendai:tvBroadcastReloads')
    endSong()
    expect(reloads).toEqual(['reload'])
  })

  it('never reloads before the stored announcements have been gathered', async () => {
    const s = await onTheStream()
    s.event(announcement(bumped(), 'Not gathered yet.', NOW - 2 * 24 * H))
    endSong()
    expect(reloads).toEqual([])
  })
})
