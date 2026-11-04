/**
 * rescanVersions.test.ts: a scan opens one version of a bag, the newest, and
 * none its author deleted (lib/bagVersions.ts; arkinox, 2026-11-03: a chest
 * deleted and hidden again showed twice). Relays disagree about a bag: one
 * holds the version a DELETE rewrote, another the older one that still names
 * the chest, a third kept a bag whose deletion it never took. Opening every
 * version drew their union.
 */
import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import type { NostrEvent } from '../../events'
import type { RelayAnswer } from '../../relayOutcome'

const mem = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, String(v)) },
  removeItem: (k: string) => { mem.delete(k) },
  clear: () => { mem.clear() },
}

vi.mock('../../relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  publish: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  queryEach: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

const { askAndOpen } = await import('../rescan')

const sk = generateSecretKey()
const author = getPublicKey(sk)
const LOOKUP = 'a'.repeat(64)

function bag(createdAt: number, note: string): NostrEvent {
  return finalizeEvent({ kind: 33330, created_at: createdAt, content: note, tags: [['d', LOOKUP]] }, sk) as NostrEvent
}
function retraction(createdAt: number, tags: string[][]): NostrEvent {
  return finalizeEvent({ kind: 5, created_at: createdAt, content: 'hidden content removed', tags }, sk) as NostrEvent
}
const answered = (url: string, events: NostrEvent[]): RelayAnswer => ({ url, outcome: 'answered', events } as RelayAnswer)

async function* one(): AsyncGenerator<Array<{ lookupId: string; keyHex: string }>> { yield [{ lookupId: LOOKUP, keyHex: 'b'.repeat(64) }] }

async function opened(answers: RelayAnswer[], deletions: NostrEvent[] = []): Promise<string[]> {
  const seen: string[] = []
  await askAndOpen(one(), async () => answers, async (ev) => { seen.push(ev.content); return [{ eventId: ev.id } as never] }, undefined, 1, async () => deletions)
  return seen
}

describe('a rescan opens the bags as they stand', () => {
  it('opens only the newest version when relays hold different ones', async () => {
    const older = bag(1_000, 'with the old chest')
    const newer = bag(2_000, 'after DELETE took it out')
    expect(await opened([answered('wss://a', [older]), answered('wss://b', [newer])])).toEqual(['after DELETE took it out'])
  })

  it('opens nothing of a bag its author retracted, whichever relay still holds it', async () => {
    const kept = bag(1_000, 'retracted, but this relay kept it')
    const del = retraction(1_500, [['a', `33330:${author}:${LOOKUP}`], ['k', '33330']])
    expect(await opened([answered('wss://a', [kept])], [del])).toEqual([])
  })

  it('a deletion older than the bag removes nothing: the bag was written after it', async () => {
    const rewritten = bag(2_000, 'hidden here again')
    const del = retraction(1_500, [['a', `33330:${author}:${LOOKUP}`]])
    expect(await opened([answered('wss://a', [rewritten])], [del])).toEqual(['hidden here again'])
  })

  it('ignores a deletion someone else signed', async () => {
    const other = generateSecretKey()
    const b = bag(1_000, 'still here')
    const forged = finalizeEvent({ kind: 5, created_at: 2_000, content: '', tags: [['a', `33330:${author}:${LOOKUP}`], ['e', b.id]] }, other) as NostrEvent
    expect(await opened([answered('wss://a', [b])], [forged])).toEqual(['still here'])
  })
})
