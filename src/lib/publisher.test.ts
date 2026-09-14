/**
 * publisher.test.ts — the drain, driven through the real store.
 *
 * What this proves is the whole point of the release gate: that Live on its
 * own sends nothing, that the first action taken while Live sends the entire
 * backlog behind it, oldest first, and that going back to Local shuts the
 * gate so the next visit to Live starts quiet again.
 *
 * The relay is a stub that records ids and always accepts, so the only thing
 * under test is when the publisher decides to send and in what order.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NostrEvent } from './events'

const sent: string[] = []
vi.mock('./relay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./relay')>()),
  publish: (e: NostrEvent) => { sent.push(e.id); return Promise.resolve({ ok: true as const }) },
}))

// A retry needs window.setTimeout; nothing here fails, but a stub costs one
// line and turns a surprise ReferenceError into a visible assertion failure.
if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
  ;(globalThis as { window?: unknown }).window = { setTimeout: (f: () => void, ms: number) => setTimeout(f, ms) }
}

import { startPublisher } from './publisher'
import { useCyberspace, type PublishStatus } from '../store/useCyberspace'

const PUBKEY = 'a'.repeat(64)
const ev = (id: string): NostrEvent =>
  ({ id: id.padEnd(64, '0'), pubkey: PUBKEY, created_at: 1, kind: 3333, tags: [], content: '', sig: 'f'.repeat(128) })

/** Replace the chain wholesale. Never changes `live` in the same update: the
 * gate reads the switch as it was before the change, so a flip and an append
 * folded into one set would be neither. */
function setChain(ids: string[], statuses: Record<string, PublishStatus> = {}): NostrEvent[] {
  const events = ids.map(ev)
  const published: Record<string, PublishStatus> = {}
  for (const e of events) published[e.id] = statuses[e.id] ?? 'queued'
  useCyberspace.setState({ events, genesisId: events[0].id, prevEventId: events[events.length - 1].id, published })
  return events
}

/** Append one action, the way a commit does. */
function append(id: string): void {
  const s = useCyberspace.getState()
  const e = ev(id)
  useCyberspace.setState({
    events: [...s.events, e],
    prevEventId: e.id,
    published: { ...s.published, [e.id]: 'queued' },
  })
}

const idle = (): Promise<void> => new Promise((r) => setTimeout(r, 5))

async function until(fn: () => boolean): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (fn()) return
    await new Promise((r) => setTimeout(r, 2))
  }
  throw new Error('the publisher never got there')
}

describe('the publisher and the release gate', () => {
  beforeAll(() => { startPublisher() })

  beforeEach(async () => {
    // Local first: that is what shuts the gate, whatever the last test left.
    useCyberspace.setState({ live: false })
    await idle()
    sent.length = 0
  })

  it('sends nothing when the switch goes Live with a backlog waiting', async () => {
    setChain(['a1', 'b2', 'c3'])
    useCyberspace.setState({ live: true })
    await idle()
    expect(sent).toEqual([])
    expect(useCyberspace.getState().published[ev('a1').id]).toBe('queued')
  })

  it('sends the whole backlog, oldest first, once an action is taken while Live', async () => {
    setChain(['a1', 'b2', 'c3'])
    useCyberspace.setState({ live: true })
    await idle()
    expect(sent).toEqual([])

    append('d4')
    await until(() => sent.length === 4)
    // Chain order, spawn first: the new action goes last, so every prefix the
    // relay holds is a chain that reads from the spawn.
    expect(sent).toEqual([ev('a1').id, ev('b2').id, ev('c3').id, ev('d4').id])
    for (const id of ['a1', 'b2', 'c3', 'd4']) {
      expect(useCyberspace.getState().published[ev(id).id]).toBe('ok')
    }
  })

  it('keeps sending each further action while the gate stays open', async () => {
    setChain(['a1'], { [ev('a1').id]: 'queued' })
    useCyberspace.setState({ live: true })
    append('b2')
    await until(() => sent.length === 2)
    append('c3')
    await until(() => sent.length === 3)
    expect(sent).toEqual([ev('a1').id, ev('b2').id, ev('c3').id])
  })

  it('shuts the gate again on Local, and the next trip to Live starts quiet', async () => {
    setChain(['a1'])
    useCyberspace.setState({ live: true })
    append('b2')
    await until(() => sent.length === 2)

    useCyberspace.setState({ live: false })
    await idle()
    sent.length = 0
    // Two actions taken privately.
    append('c3')
    append('d4')
    await idle()
    expect(sent).toEqual([])

    // Live again: still nothing, because the flip is not an action.
    useCyberspace.setState({ live: true })
    await idle()
    expect(sent).toEqual([])

    // And now one action carries both of them out with it.
    append('e5')
    await until(() => sent.length === 3)
    expect(sent).toEqual([ev('c3').id, ev('d4').id, ev('e5').id])
  })

  it('leaves nothing claiming to be in flight when the switch goes Local', async () => {
    setChain(['a1', 'b2', 'c3'], { [ev('a1').id]: 'ok', [ev('b2').id]: 'sending', [ev('c3').id]: 'failed' })
    useCyberspace.setState({ live: true })
    // The real switch, not setState: going Local stops every retry, so an
    // event still reading 'sending' or 'failed' would have the panel report
    // a publisher that is not going to try again.
    useCyberspace.getState().setLive(false)
    await idle()
    const s = useCyberspace.getState()
    expect(s.published[ev('a1').id]).toBe('ok')
    expect(s.published[ev('b2').id]).toBe('queued')
    expect(s.published[ev('c3').id]).toBe('queued')
    expect(s.publishError).toBeNull()
    expect(sent).toEqual([])
  })

  it('is not opened by a head that arrived from the relay already published', async () => {
    setChain(['a1'])
    useCyberspace.setState({ live: true })
    await idle()
    // adoptChain's shape: a longer chain whose new head is marked 'ok'
    // because the relay is where it came from.
    const events = [ev('a1'), ev('b2')]
    useCyberspace.setState({
      events,
      prevEventId: events[1].id,
      published: { [events[0].id]: 'queued', [events[1].id]: 'ok' },
    })
    await idle()
    expect(sent).toEqual([])
  })
})
