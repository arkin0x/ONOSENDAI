/**
 * publishObject.test.ts - PUBLISH and RETRACT from the workshop's MENU
 * (store/usePublished.ts), against a fake relay.
 *
 * What these prove: a publish signs the shard as a public kind 33331 (the
 * signer adds ONOSENDAI's client tag), sends it to the relay set, writes the
 * ledger and says so through the workshop's notice; a refusal is repeated in
 * the relay's own words and leaves the ledger alone; an edit reads as EDITED
 * and a second publish is strictly newer than the first; a retraction is a
 * NIP-09 deletion by address and forgets the record; and what a relay hands
 * back under this key is learned without a fingerprint, so a shard published
 * from snocrash under the same id reads as PUBLISHED here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The stores keep their records in localStorage; the test runs where there is none.
if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true, accepted: ['wss://relay.test'] })),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test', 'wss://second.test'],
  connectRelay: vi.fn(async () => true),
  authForRead: vi.fn(async () => {}),
  subscribeOne: vi.fn(() => ({ close: () => {} })),
}))

import { newShard, type ShardModel } from 'sno-core/shards'
import { withCredit } from 'sno-core/feed'
import { publishMany } from '../../lib/relay'
import { publishState, shardFingerprint } from '../../lib/published'
import { useCyberspace } from '../useCyberspace'
import { useWorkshop } from '../useWorkshop'
import { useFeed } from '../useFeed'
import { usePublished } from '../usePublished'

const OTHER = 'b'.repeat(64)

function step(id = 'step-1'): ShardModel {
  const s = newShard('Step')
  s.id = id
  s.mode = 'solid'
  s.vertices = [
    { p: [0, 0, 0], c: [1, 1, 1] }, { p: [1, 0, 0], c: [1, 1, 1] }, { p: [1, 0, 1], c: [1, 1, 1] }, { p: [0, 0, 1], c: [1, 1, 1] },
  ]
  s.faces = [[0, 1, 2], [0, 2, 3]]
  return s
}

const me = (): string => useCyberspace.getState().identity.pubkey
const notice = (): string | null => useWorkshop.getState().notice
const stateOf = (s: ShardModel): string => publishState(usePublished.getState().ledger[s.id], shardFingerprint(s), me())
const sent = (): { kind: number; tags: string[][]; content: string; created_at: number; pubkey: string; id: string } =>
  vi.mocked(publishMany).mock.calls.at(-1)![1] as never

describe('PUBLISH', () => {
  beforeEach(() => {
    vi.mocked(publishMany).mockClear()
    vi.mocked(publishMany).mockImplementation(async () => ({ ok: true, accepted: ['wss://relay.test'] }))
    usePublished.setState({ ledger: {}, publishing: false, retracting: false })
    useWorkshop.setState({ notice: null })
    localStorage.removeItem('onosendai:published')
  })

  it('signs the shard as a public kind 33331 with the client tag, sends it to the relay set, and records it', async () => {
    const s = step()
    expect(stateOf(s)).toBe('never')
    expect(await usePublished.getState().publish(s)).toBe(true)
    expect(vi.mocked(publishMany)).toHaveBeenCalledTimes(1)
    const [relays, ev] = vi.mocked(publishMany).mock.calls[0]
    expect(relays).toEqual(['wss://relay.test', 'wss://second.test'])
    expect(ev.kind).toBe(33331)
    expect(ev.pubkey).toBe(me())
    expect(ev.tags.find((t) => t[0] === 'd')?.[1]).toBe('step-1')
    expect(ev.tags.find((t) => t[0] === 'name')?.[1]).toBe('Step')
    expect(ev.tags.some((t) => t[0] === 'encrypted')).toBe(false)
    // The signer's attribution (lib/client.ts), once.
    expect(ev.tags.filter((t) => t[0] === 'client')).toEqual([['client', 'ONOSENDAI']])
    expect(JSON.parse(ev.content).v).toBe(2)
    // The ledger knows the send, the key and the event, on disk too.
    const rec = usePublished.getState().ledger['step-1']
    expect(rec.pubkey).toBe(me())
    expect(rec.fp).toBe(shardFingerprint(s))
    expect(rec.id).toBe(ev.id)
    expect(JSON.parse(localStorage.getItem('onosendai:published') ?? '{}')['step-1']).toEqual(rec)
    expect(stateOf(s)).toBe('published')
    expect(notice()).toBe('"Step" is published to 1 of 2 relays.')
  })

  it('reads as EDITED once the shard changes, and PUBLISH AGAIN is strictly newer than the first send', async () => {
    const s = step()
    await usePublished.getState().publish(s)
    const first = sent().created_at
    const edited: ShardModel = { ...s, vertices: [...s.vertices, { p: [2, 0, 0], c: [1, 0, 0] }] }
    expect(stateOf(edited)).toBe('edited')
    await usePublished.getState().publish(edited)
    expect(sent().created_at).toBeGreaterThan(first)
    expect(sent().tags.find((t) => t[0] === 'd')?.[1]).toBe('step-1')
    expect(stateOf(edited)).toBe('published')
    expect(stateOf(s)).toBe('edited')
  })

  it('refuses an empty shard before signing anything', async () => {
    const s = newShard('Nothing')
    expect(await usePublished.getState().publish(s)).toBe(false)
    expect(vi.mocked(publishMany)).not.toHaveBeenCalled()
    expect(notice()).toBe('This shard has no vertices and places nothing.')
    expect(stateOf(s)).toBe('never')
  })

  it('repeats a refusal in the relay\'s own words and leaves the ledger alone', async () => {
    vi.mocked(publishMany).mockImplementation(async () => ({ ok: false, reason: 'blocked: not on the allowlist' }))
    const s = step()
    expect(await usePublished.getState().publish(s)).toBe(false)
    expect(notice()).toBe('No relay took "Step": blocked: not on the allowlist')
    expect(stateOf(s)).toBe('never')
    expect(localStorage.getItem('onosendai:published')).toBeNull()
  })

  it('carries the credit of a REMIX, q and p, since this object is public', async () => {
    const s = withCredit(step('remix-1'), { address: `33331:${OTHER}:lamp` })
    await usePublished.getState().publish(s)
    expect(sent().tags.filter((t) => t[0] === 'q')).toEqual([['q', `33331:${OTHER}:lamp`, '']])
    expect(sent().tags.filter((t) => t[0] === 'p')).toEqual([['p', OTHER]])
  })

  it('reads the Shard Feed again when it has been opened, so the object is there on its next look', async () => {
    const refresh = vi.fn()
    useFeed.setState({ started: true, refresh })
    await usePublished.getState().publish(step())
    expect(refresh).toHaveBeenCalledTimes(1)
    // Not opened yet this session: nothing to re-read, it reads fresh when opened.
    useFeed.setState({ started: false })
    await usePublished.getState().publish(step('step-2'))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('publishes one at a time', async () => {
    usePublished.setState({ publishing: true })
    expect(await usePublished.getState().publish(step())).toBe(false)
    expect(vi.mocked(publishMany)).not.toHaveBeenCalled()
  })
})

describe('RETRACT', () => {
  beforeEach(() => {
    vi.mocked(publishMany).mockClear()
    vi.mocked(publishMany).mockImplementation(async () => ({ ok: true, accepted: ['wss://relay.test'] }))
    usePublished.setState({ ledger: {}, publishing: false, retracting: false })
    useWorkshop.setState({ notice: null })
    useFeed.setState({ started: false })
  })

  it('sends a NIP-09 deletion by address and event, forgets the record, and PUBLISH after it is newer than the deletion', async () => {
    const s = step()
    await usePublished.getState().publish(s)
    const published = sent()
    expect(await usePublished.getState().retract(s)).toBe(true)
    const del = sent()
    expect(del.kind).toBe(5)
    expect(del.content).toBe('object retracted')
    expect(del.tags).toEqual(expect.arrayContaining([
      ['a', `33331:${me()}:step-1`],
      ['e', published.id],
      ['k', '33331'],
      ['client', 'ONOSENDAI'],
    ]))
    expect(del.created_at).toBeGreaterThan(published.created_at)
    expect(stateOf(s)).toBe('never')
    expect(notice()).toContain('"Step" is retracted')
    // A deletion by address covers every version up to its own second, so
    // the next publish must be later than it or the feed would hide it.
    await usePublished.getState().publish(s)
    expect(sent().created_at).toBeGreaterThan(del.created_at)
    expect(stateOf(s)).toBe('published')
  })

  it('stands on the address alone for an object learned from a relay without an id', async () => {
    usePublished.setState({ ledger: { 'step-1': { at: 100, fp: '', pubkey: me() } } })
    await usePublished.getState().retract(step())
    expect(sent().tags.some((t) => t[0] === 'e')).toBe(false)
    expect(sent().tags).toEqual(expect.arrayContaining([['a', `33331:${me()}:step-1`], ['k', '33331']]))
  })

  it('refuses to retract what another key published, since only the author\'s deletion deletes', async () => {
    usePublished.setState({ ledger: { 'step-1': { at: 100, fp: 'x', pubkey: OTHER } } })
    expect(await usePublished.getState().retract(step())).toBe(false)
    expect(vi.mocked(publishMany)).not.toHaveBeenCalled()
    expect(notice()).toContain('another key')
  })

  it('keeps the record when no relay took the deletion, and says what the relay said', async () => {
    const s = step()
    await usePublished.getState().publish(s)
    vi.mocked(publishMany).mockImplementation(async () => ({ ok: false, reason: 'rate-limited: slow down' }))
    expect(await usePublished.getState().retract(s)).toBe(false)
    expect(stateOf(s)).toBe('published')
    expect(notice()).toBe('No relay took the retraction of "Step": rate-limited: slow down')
  })
})

describe('learning from the relays', () => {
  beforeEach(() => {
    vi.mocked(publishMany).mockClear()
    vi.mocked(publishMany).mockImplementation(async () => ({ ok: true, accepted: ['wss://relay.test'] }))
    usePublished.setState({ ledger: {}, publishing: false, retracting: false })
    localStorage.removeItem('onosendai:published')
  })

  const object = (pubkey: string, d: string, at: number, extra: string[][] = []): { id: string; kind: number; pubkey: string; tags: string[][]; created_at: number } =>
    ({ id: d.padEnd(64, '0'), kind: 33331, pubkey, tags: [['d', d], ['name', d], ...extra], created_at: at })

  it('notes your public objects as PUBLISHED without a fingerprint, so a shard published from snocrash under the same id reads as published here', () => {
    const s = step()
    usePublished.getState().learn([object(me(), 'step-1', 500)])
    const rec = usePublished.getState().ledger['step-1']
    expect(rec).toEqual({ at: 500, fp: '', pubkey: me(), id: 'step-1'.padEnd(64, '0') })
    expect(stateOf(s)).toBe('published')
    // Unknown fingerprint: an edit here cannot be told from the version out there, and is not claimed.
    expect(stateOf({ ...s, vertices: [] })).toBe('published')
    expect(JSON.parse(localStorage.getItem('onosendai:published') ?? '{}')['step-1']).toEqual(rec)
  })

  it('passes over other keys\' objects, sealed objects, other kinds and events without a d', () => {
    usePublished.getState().learn([
      object(OTHER, 'theirs', 500),
      object(me(), 'sealed', 500, [['encrypted', 'aes-256-gcm', 'ct', 'cyberspace:region']]),
      { ...object(me(), 'bag', 500), kind: 33330 },
      { ...object(me(), 'no-d', 500), tags: [['name', 'x']] },
    ])
    expect(usePublished.getState().ledger).toEqual({})
    expect(localStorage.getItem('onosendai:published')).toBeNull()
  })

  it('never lets a sighting outrank a send, and keeps the newest sighting', async () => {
    const s = step()
    await usePublished.getState().publish(s)
    const before = usePublished.getState().ledger['step-1']
    usePublished.getState().learn([object(me(), 'step-1', before.at + 1000)])
    expect(usePublished.getState().ledger['step-1']).toBe(before)
    usePublished.getState().learn([object(me(), 'other-1', 100)])
    usePublished.getState().learn([object(me(), 'other-1', 300), object(me(), 'other-1', 200)])
    expect(usePublished.getState().ledger['other-1'].at).toBe(300)
  })

  it('learns from the Shard Feed as it arrives', () => {
    const ev = object(me(), 'from-feed', 700)
    useFeed.setState({ objects: [{ id: ev.id, pubkey: me(), createdAt: 700, d: 'from-feed', address: `33331:${me()}:from-feed`, shard: step('from-feed'), event: { ...ev, content: '{}' } }] })
    expect(usePublished.getState().ledger['from-feed']).toEqual({ at: 700, fp: '', pubkey: me(), id: ev.id })
  })
})
