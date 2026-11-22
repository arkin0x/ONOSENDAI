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
import type { NostrEvent } from '../events'

const sent: string[] = []
/**
 * Who takes a publish: `acceptedBy`, when set, is the relays that took it
 * (as publish reports them); `canonicalFailsLeft` is how many more times the
 * canonical relay refuses a retry of its own; `toCanonical` logs each retry.
 */
const pub = vi.hoisted(() => ({ acceptedBy: null as string[] | null, canonicalFailsLeft: 0, toCanonical: [] as string[], hold: null as Promise<void> | null }))
vi.mock('../relay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../relay')>()),
  publish: async (e: NostrEvent) => { sent.push(e.id); if (pub.hold) await pub.hold; return pub.acceptedBy ? { ok: true as const, accepted: pub.acceptedBy } : { ok: true as const } },
  // The canonical relay's background check by id (publisher.ts
  // reconcileCanonical): it answers, holding none of them.
  countRelay: () => Promise.resolve(null),
  askRelay: (url: string) => Promise.resolve({ url, outcome: 'answered' as const, events: [] }),
  // And its re-send of what it lacks.
  publishOnceTo: (url: string, e: NostrEvent) => {
    pub.toCanonical.push(e.id)
    if (pub.canonicalFailsLeft > 0) { pub.canonicalFailsLeft--; return Promise.resolve({ ok: false as const, reason: 'timeout' }) }
    return Promise.resolve({ ok: true as const, accepted: [url] })
  },
}))

// Whether an action has landed on this device (lib/chainStore.ts): true unless a test says it lost.
const landing = vi.hoisted(() => ({ lost: new Set<string>(), asked: [] as string[] }))
vi.mock('../chainStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../chainStore')>()),
  chainLanded: async (_pubkey: string, id: string) => { landing.asked.push(id); return !landing.lost.has(id) },
}))

// The look at the relays before a backlog finds nothing here: no relay.
// `canonical.answers` says whether the canonical relay answers it.
const canonical = vi.hoisted(() => ({ answers: true, asked: 0 }))
vi.mock('../chains', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../chains')>()),
  fetchChainEvents: () => Promise.resolve([]),
  askChainEvents: async () => [{ url: (await import('../../store/useRelays')).DEFAULT_RELAY, outcome: 'answered' as const, events: [] }],
  confirmChainEvents: () => { canonical.asked++; return Promise.resolve(canonical.answers ? [] : null) },
}))

// What this page signed (useCyberspace signedOnThisPage, takeFreshHead): every
// fixture action stands for one signed on this page, except those a test says
// were read from storage (a reload, an identity switched back to); an
// appended one is an action just taken, and opens the gate the first time it
// becomes the head.
const storage = vi.hoisted(() => new Set<string>())
const fresh = vi.hoisted(() => new Set<string>())
// Moves signed while LIVE (useCyberspace meantToGoOut), as a test says.
const outbound = vi.hoisted(() => new Set<string>())
vi.mock('../../store/useCyberspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../store/useCyberspace')>()),
  signedOnThisPage: (id: string) => !storage.has(id),
  takeFreshHead: (id: string) => fresh.delete(id),
  meantToGoOut: (_pk: string, id: string) => outbound.has(id),
}))

// A retry needs window.setTimeout; nothing here fails, but a stub costs one
// line and turns a surprise ReferenceError into a visible assertion failure.
if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
  ;(globalThis as { window?: unknown }).window = { setTimeout: (f: () => void, ms: number) => setTimeout(f, ms) }
}

import { MARK_WINDOW_MS, flushPublishMarks, startPublisher } from '../publisher'
import { mayMove, movementBlocked, resetVersionGateForTests, useVersionGate } from '../versionGate'
import { CHAIN_RULES_EPOCH, versionFileOf } from '../chainRulesEpoch'
import { adoptMayReadMarks, useCyberspace, type PublishStatus } from '../../store/useCyberspace'

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
  fresh.add(e.id)
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
    useCyberspace.setState({ live: false, held: false, chainConflict: null })
    await idle()
    // The last test's marks, written before this one reuses its ids.
    flushPublishMarks()
    sent.length = 0
    storage.clear()
    fresh.clear()
    outbound.clear()
  })

  it('marks nothing and sends nothing more inside the relay\'s OK; the marks reach the store together, within the window (owner\'s phone diag, 2026-11-21)', async () => {
    setChain(['a1'], { [ev('a1').id]: 'ok' })
    useCyberspace.setState({ live: true })
    await idle()
    let release: () => void = () => {}
    pub.hold = new Promise<void>((r) => { release = r })
    const changes: string[] = []
    const stop = useCyberspace.subscribe((st, prev) => { if (st.published !== prev.published) changes.push('published') })
    try {
      append('b2')
      append('c3')
      await until(() => sent.includes(ev('b2').id))
      changes.length = 0
      // The OK arrives, and every promise it settles runs, as within one socket message.
      pub.hold = null
      release()
      for (let i = 0; i < 20; i++) await Promise.resolve()
      expect(changes).toEqual([])
      expect(sent).not.toContain(ev('c3').id)
      // The next one goes out in a task of its own, and the marks land within the window, together.
      await until(() => sent.includes(ev('c3').id))
      await until(() => useCyberspace.getState().published[ev('b2').id] === 'ok' && useCyberspace.getState().published[ev('c3').id] === 'ok')
      expect(changes.length).toBeLessThanOrEqual(2)
    } finally {
      stop()
      pub.hold = null
    }
  })

  it('a kept ack is written before a fold that may read the marks, never for an echo of a move in hand, and a late \'sending\' never takes an \'ok\' back', async () => {
    setChain(['a1'], { [ev('a1').id]: 'ok' })
    useCyberspace.setState({ live: true })
    await idle()
    append('b2')
    await until(() => sent.includes(ev('b2').id))
    // Within the window: a relay pushing back a move already in hand decides nothing with the marks, and leaves them kept.
    const me = useCyberspace.getState().identity.pubkey
    const echo = { ...ev('b2'), pubkey: me }
    const s0 = { chainConflict: null, held: false, identity: { pubkey: me }, events: [...useCyberspace.getState().events, echo] }
    expect(adoptMayReadMarks(s0, [echo])).toBe(false)
    // Something new of this identity's, or a choice waiting, may read them: they are written first.
    expect(adoptMayReadMarks(s0, [{ ...ev('n9'), pubkey: me }])).toBe(true)
    expect(adoptMayReadMarks({ ...s0, chainConflict: { kind: 'branch' } }, [echo])).toBe(true)
    // Another identity's events decide nothing here.
    expect(adoptMayReadMarks(s0, [ev('n9')])).toBe(me === ev('n9').pubkey)
    // A fold that may read them writes them first.
    flushPublishMarks()
    expect(useCyberspace.getState().published[ev('b2').id]).toBe('ok')
    useCyberspace.getState().setPublishStatuses([[ev('b2').id, 'sending']])
    expect(useCyberspace.getState().published[ev('b2').id]).toBe('ok')
  })

  it('sends nothing when the switch goes Live with a backlog waiting', async () => {
    setChain(['a1', 'b2', 'c3'])
    useCyberspace.setState({ live: true })
    await idle()
    expect(sent).toEqual([])
    expect(useCyberspace.getState().published[ev('a1').id]).toBe('queued')
  })

  it('an action another tab beat to the head is never sent, and asks nothing of a relay', async () => {
    setChain(['a1'])
    useCyberspace.setState({ live: true })
    await idle()
    const lost = ev('b2').id
    landing.lost.add(lost)
    append('b2')
    await idle()
    expect(landing.asked).toContain(lost)
    expect(sent).not.toContain(lost)
    expect(useCyberspace.getState().published[lost]).not.toBe('sending')
    landing.lost.delete(lost)
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
    // Marked published within the window after the last relay's OK, never before it.
    await until(() => ['a1', 'b2', 'c3', 'd4'].every((id) => useCyberspace.getState().published[ev(id).id] === 'ok'))
  })

  it('sends no backlog when the look did not count: no relay answered that holds the chain (review of #236, item 9; option B)', async () => {
    canonical.answers = false
    try {
      setChain(['a1', 'b2', 'c3'])
      useCyberspace.setState({ live: true })
      await idle()
      append('d4')
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(sent).toEqual([])
    } finally {
      canonical.answers = true
      useCyberspace.setState({ live: false })
      await idle()
    }
  })

  it('one waiting move this page did not sign (read from storage: a reload, an identity switched back to) gets the look first, and no answer sends nothing (review of the per-identity LIVE switch, 2026-11-21)', async () => {
    canonical.answers = false
    try {
      storage.add(ev('b2').id)
      setChain(['a1', 'b2'])
      useCyberspace.setState({ live: true, published: { [ev('a1').id]: 'ok', [ev('b2').id]: 'queued' } })
      await idle()
      useCyberspace.getState().publishNow()
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(sent).toEqual([])
    } finally {
      canonical.answers = true
      useCyberspace.setState({ live: false })
      await idle()
    }
  })

  it('LIVE, moves kept from before (read from storage) wait for an action here: their arrival opens nothing, and the next action sends them all, oldest first (owner, 2026-11-21)', async () => {
    setChain(['k0'], { [ev('k0').id]: 'ok' })
    useCyberspace.setState({ live: true })
    await idle()
    // The saved chain arrives, a load or a switch back: two moves kept while LOCAL, as a new head.
    for (const id of ['k1', 'k2']) storage.add(ev(id).id)
    setChain(['k0', 'k1', 'k2'], { [ev('k0').id]: 'ok' })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(sent).toEqual([])
    // An action taken here: the gate opens, and the backlog goes with it.
    append('k3')
    await until(() => sent.length === 3)
    expect(sent).toEqual([ev('k1').id, ev('k2').id, ev('k3').id])
  })

  it('a move this page signed while LOCAL, read back after a switch away and back on LIVE, waits too: an action opens the gate once (review, 2026-11-21)', async () => {
    const me = useCyberspace.getState().identity
    try {
      setChain(['m0'], { [ev('m0').id]: 'ok' })
      await idle()
      // LOCAL: the move is taken here, and becomes the head.
      append('m1')
      await idle()
      useCyberspace.setState({ live: true })
      await idle()
      expect(sent).toEqual([])
      // Away to X and back: the chain arrives after the switch, in a later update.
      useCyberspace.setState({ identity: { pubkey: 'c'.repeat(64), npub: 'npub-x' } })
      useCyberspace.setState({ identity: me, events: [], prevEventId: '', published: {} })
      setChain(['m0', 'm1'], { [ev('m0').id]: 'ok' })
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(sent).toEqual([])
    } finally {
      useCyberspace.setState({ live: false, identity: me })
      await idle()
    }
  })

  it('LIVE, a move signed while LIVE whose send never landed, read back after a reload, goes out again by itself after the look (owner, 2026-11-22)', async () => {
    setChain(['r0'], { [ev('r0').id]: 'ok' })
    useCyberspace.setState({ live: true })
    await idle()
    // A LOCAL move kept behind it, and the LIVE move on top that hit a blip.
    for (const id of ['r1', 'r2']) storage.add(ev(id).id)
    outbound.add(ev('r2').id)
    setChain(['r0', 'r1', 'r2'], { [ev('r0').id]: 'ok' })
    await until(() => sent.length === 2)
    expect(sent).toEqual([ev('r1').id, ev('r2').id])
  })

  it('the same with the relays silent: nothing goes out until they answer', async () => {
    canonical.answers = false
    try {
      setChain(['s0'], { [ev('s0').id]: 'ok' })
      useCyberspace.setState({ live: true })
      await idle()
      storage.add(ev('s1').id)
      outbound.add(ev('s1').id)
      canonical.asked = 0
      setChain(['s0', 's1'], { [ev('s0').id]: 'ok' })
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(sent).toEqual([])
      // It was released, and held back only by the look that got no answer.
      expect(canonical.asked).toBeGreaterThan(0)
    } finally {
      canonical.answers = true
      useCyberspace.setState({ live: false })
      await idle()
    }
  })

  it('a LIVE move this page signed, whose send failed, read back after a switch away and back, still gets the look first: no answer, nothing sent (review, 2026-11-22)', async () => {
    const me = useCyberspace.getState().identity
    canonical.answers = false
    try {
      setChain(['v0'], { [ev('v0').id]: 'ok' })
      useCyberspace.setState({ live: true })
      await idle()
      // Signed on this page while LIVE (not from storage), meant to go out, never landed.
      outbound.add(ev('v1').id)
      useCyberspace.setState({ identity: { pubkey: 'd'.repeat(64), npub: 'npub-x' } })
      useCyberspace.setState({ identity: me, events: [], prevEventId: '', published: {} })
      setChain(['v0', 'v1'], { [ev('v0').id]: 'ok' })
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(sent).toEqual([])
    } finally {
      canonical.answers = true
      useCyberspace.setState({ live: false, identity: me })
      await idle()
    }
  })

  it('LIVE, moves kept from before go out on PUBLISH, with no move', async () => {
    setChain(['p0'], { [ev('p0').id]: 'ok' })
    useCyberspace.setState({ live: true })
    await idle()
    storage.add(ev('p1').id)
    setChain(['p0', 'p1'], { [ev('p0').id]: 'ok' })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(sent).toEqual([])
    useCyberspace.getState().publishNow()
    await until(() => sent.length === 1)
    expect(sent).toEqual([ev('p1').id])
  })

  it('a look at one identity\'s backlog does not count for the next: Y mid-drain, a switch to X, X\'s one kept move waits for its own look (review, 2026-11-21)', async () => {
    const me = useCyberspace.getState().identity
    let release!: () => void
    pub.hold = new Promise((r) => { release = r })
    try {
      // Y: a backlog, released by an action, looked at, and its first send in flight.
      setChain(['a1', 'b2', 'c3'])
      useCyberspace.setState({ live: true })
      await idle()
      append('d4')
      await until(() => sent.length === 1)
      // The switch to X, LIVE, then X's saved chain arriving with one kept move, then PUBLISH.
      const x = 'b'.repeat(64)
      useCyberspace.setState({ identity: { pubkey: x, npub: 'npub-x' } })
      storage.add(ev('x2').id)
      setChain(['x1', 'x2'], { [ev('x1').id]: 'ok' })
      canonical.answers = false
      useCyberspace.getState().publishNow()
      pub.hold = null
      release()
      await new Promise((resolve) => setTimeout(resolve, 60))
      expect(sent).not.toContain(ev('x2').id)
    } finally {
      pub.hold = null
      release?.()
      canonical.answers = true
      useCyberspace.setState({ live: false, identity: me })
      await idle()
    }
  })

  it('a move only one of the player\'s relays took counts as published, and the canonical relay is asked again in the background until it takes it (option B)', async () => {
    pub.acceptedBy = ['wss://mine.example/']
    pub.canonicalFailsLeft = 1
    pub.toCanonical = []
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      setChain(['a1'], { [ev('a1').id]: 'ok' })
      useCyberspace.setState({ live: true })
      await vi.advanceTimersByTimeAsync(10)
      append('b2')
      // Marked published within the window after the OK (publisher.ts MARK_WINDOW_MS).
      await vi.advanceTimersByTimeAsync(MARK_WINDOW_MS + 10)
      expect(useCyberspace.getState().published[ev('b2').id]).toBe('ok')
      expect(pub.toCanonical).toEqual([])
      // First background try: the canonical relay still refuses.
      await vi.advanceTimersByTimeAsync(5_000)
      expect(pub.toCanonical).toEqual([ev('b2').id])
      // The next one, after the backoff, lands.
      await vi.advanceTimersByTimeAsync(10_000)
      expect(pub.toCanonical).toEqual([ev('b2').id, ev('b2').id])
      await vi.advanceTimersByTimeAsync(60_000)
      expect(pub.toCanonical).toHaveLength(2)
      // It never stayed pending long, so nothing was shown.
      expect(useCyberspace.getState().canonicalLate).toBe(0)
    } finally {
      vi.useRealTimers()
      pub.acceptedBy = null
      pub.canonicalFailsLeft = 0
      useCyberspace.setState({ live: false })
      await idle()
    }
  })

  it('a move the canonical relay keeps refusing for over a minute is counted for the compact status, and cleared when it lands', async () => {
    pub.acceptedBy = ['wss://mine.example/']
    pub.canonicalFailsLeft = 4
    pub.toCanonical = []
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      setChain(['a1'], { [ev('a1').id]: 'ok' })
      useCyberspace.setState({ live: true })
      await vi.advanceTimersByTimeAsync(10)
      append('c3')
      await vi.advanceTimersByTimeAsync(10)
      // Tries at 5, 15, 35 and 75 s fail; the one at 75 s is past a minute.
      await vi.advanceTimersByTimeAsync(75_000)
      expect(useCyberspace.getState().canonicalLate).toBe(1)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(useCyberspace.getState().canonicalLate).toBe(0)
    } finally {
      vi.useRealTimers()
      pub.acceptedBy = null
      pub.canonicalFailsLeft = 0
      useCyberspace.setState({ live: false })
      await idle()
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

  it('sends nothing from a held chain, even with an action taken while Live', async () => {
    // A held chain was started before the relays could say whether this
    // identity had one (chainHold.ts): it stays here whatever LIVE says.
    useCyberspace.setState({ held: true })
    setChain(['a1'])
    useCyberspace.setState({ live: true })
    append('b2')
    await idle()
    expect(sent).toEqual([])
    expect(useCyberspace.getState().published[ev('b2').id]).toBe('queued')

    // The relays answered "none": the hold lifts and the gate the action
    // opened is still open, so the chain goes out as if never held.
    useCyberspace.setState({ held: false })
    await until(() => sent.length === 2)
    expect(sent).toEqual([ev('a1').id, ev('b2').id])
  })

  it('stays quiet when a hold lifts on a gate nothing opened', async () => {
    // A reload: the gate starts shut, the chain is held, nothing is acted on.
    useCyberspace.setState({ held: true })
    setChain(['a1'])
    useCyberspace.setState({ live: true })
    await idle()
    useCyberspace.setState({ held: false })
    await idle()
    expect(sent).toEqual([])
  })

  it('sends at once on a deliberate publish request (Keep the local chain)', async () => {
    useCyberspace.setState({ held: true })
    setChain(['a1', 'b2'])
    useCyberspace.setState({ live: true })
    await idle()
    // resolveHeldConflict('local'): the hold lifts and the answer opens the gate.
    useCyberspace.setState({ held: false, publishRequest: useCyberspace.getState().publishRequest + 1 })
    await until(() => sent.length === 2)
    expect(sent).toEqual([ev('a1').id, ev('b2').id])
  })

  it('sends nothing while a newer deploy requires newer chain rules, and what waited goes out if that lifts (lib/versionGate.ts)', async () => {
    useVersionGate.setState({ verdict: 'blocked' })
    try {
      setChain(['a1'])
      useCyberspace.setState({ live: true })
      // An action that would open the gate, signed before the tab learned of the deploy.
      append('b2')
      await idle()
      expect(sent).toEqual([])
      expect(useCyberspace.getState().published[ev('b2').id]).toBe('queued')
    } finally {
      // A later answer with this build's epoch (a revert): the hold lifts.
      useVersionGate.setState({ verdict: 'ok' })
    }
    await until(() => sent.length === 2)
    expect(sent).toEqual([ev('a1').id, ev('b2').id])
  })

  it('a slow version file (3 s): the move in the window goes, the late answer holds everything queued after it (review of #530)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.stubGlobal('fetch', () => new Promise<Response>((resolve) => setTimeout(() => resolve(new Response(JSON.stringify(versionFileOf('cutover-build', CHAIN_RULES_EPOCH + 1)), { status: 200 })), 3_000)))
    resetVersionGateForTests(true)
    try {
      setChain(['a1'], { [ev('a1').id]: 'ok' })
      useCyberspace.setState({ live: true })
      await vi.advanceTimersByTimeAsync(10)
      // The look before the move gives up waiting at 1.5 s, and the move goes.
      let allowed: boolean | undefined
      void mayMove().then((r) => { allowed = r })
      await vi.advanceTimersByTimeAsync(1_500)
      expect(allowed).toBe(true)
      append('b2')
      await vi.advanceTimersByTimeAsync(10)
      expect(sent).toEqual([ev('b2').id])
      // The answer lands at 3 s: blocked, and what is queued now is held.
      await vi.advanceTimersByTimeAsync(1_500)
      expect(movementBlocked()).toBe(true)
      expect(await mayMove()).toBe(false)
      append('c3')
      await vi.advanceTimersByTimeAsync(60_000)
      expect(sent).toEqual([ev('b2').id])
      expect(useCyberspace.getState().published[ev('c3').id]).toBe('queued')
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
      resetVersionGateForTests(false)
      useCyberspace.setState({ live: false })
      await idle()
    }
  })
})
