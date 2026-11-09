/**
 * commentsHeldKey.test.ts: a card's comments open with the key that opened
 * the bag, and nothing is derived during render (2026-11-09: a bag above
 * height 20 crashed its card, since cyberspace-core refuses a key there and
 * the comment section derived one in a useMemo; between 13 and 20 the same
 * synchronous key froze the page).
 *
 * - A bag at height 25 with its key held reads and writes comments under that
 *   key, and no region key is ever computed.
 * - Above this machine's limit with no key held: COMMENTS UNAVAILABLE, no
 *   throw, nothing asked of the relays, nothing posted.
 * - Within the limit with no key held (13 to 20): the key is asked of the
 *   region worker from an effect, never computed while rendering.
 *
 * The hook runs under a small stand-in for React (as discoveryTv.test.ts):
 * effects run after the render that queued them, and a state change renders
 * again, so "during render" is the hook call itself.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent } from 'nostr-tools/pure'

interface Slot { deps?: unknown[]; value?: unknown; cleanup?: () => void }
let slots: Slot[] = []
let si = 0
let pending: Array<() => void> = []
let dirty = false
const flags = vi.hoisted(() => ({ inRender: false }))
const same = (a?: unknown[], b?: unknown[]): boolean => !!a && !!b && a.length === b.length && a.every((d, n) => d === b[n])
vi.mock('react', () => ({
  useState: (init: unknown) => {
    const k = si++
    slots[k] ??= { value: typeof init === 'function' ? (init as () => unknown)() : init }
    const slot = slots[k]
    return [slot.value, (v: unknown) => { slot.value = typeof v === 'function' ? (v as (p: unknown) => unknown)(slot.value) : v; dirty = true }]
  },
  useMemo: (fn: () => unknown, deps: unknown[]) => {
    const k = si++
    if (slots[k] && same(slots[k].deps, deps)) return slots[k].value
    slots[k] = { deps, value: fn() }
    return slots[k].value
  },
  useCallback: (fn: unknown) => { si++; return fn },
  useEffect: (fn: () => void | (() => void), deps?: unknown[]) => {
    const k = si++
    const prev = slots[k]
    if (prev && same(prev.deps, deps)) return
    slots[k] = { deps, cleanup: prev?.cleanup }
    pending.push(() => { prev?.cleanup?.(); slots[k] = { deps, cleanup: fn() || undefined } })
  },
}))

const relay = vi.hoisted(() => ({ events: [] as unknown[], published: [] as Array<{ content: string }> }))
vi.mock('../../lib/relay', () => ({
  queryChecked: vi.fn(async () => ({ events: relay.events, trouble: null })),
  publish: vi.fn(async (ev: { content: string }) => { relay.published.push(ev); return { ok: true } }),
  onCanonicalSignIn: () => () => {},
}))
// The real crypto, with the key derivation watched: it must never run in
// render, and above 20 it refuses exactly as cyberspace-core does.
vi.mock('../../lib/shardCrypto', async (orig) => {
  const real = await orig<typeof import('../../lib/shardCrypto')>()
  return {
    ...real,
    regionKeyAt: vi.fn((_at: unknown, height: number, max: number) => {
      if (flags.inRender) throw new Error('regionKeyAt called during render')
      if (height > max) throw new Error(`height ${height} exceeds maxComputeHeight ${max}`)
      return { key: new Uint8Array(32).fill(7), lookupId: 'l'.repeat(64) }
    }),
  }
})
const worker = vi.hoisted(() => ({ resolve: null as null | ((k: { key: Uint8Array; lookupId: string }) => void) }))
vi.mock('../../lib/regionKeyOffThread', () => ({
  regionKeyOffThread: vi.fn(() => {
    if (flags.inRender) throw new Error('regionKeyOffThread called during render')
    return new Promise((resolve) => { worker.resolve = resolve })
  }),
}))
const limit = vi.hoisted(() => ({ ceiling: 20 }))
vi.mock('../../lib/deployPlan', () => ({ localKeyCeiling: () => limit.ceiling }))

const SK = new Uint8Array(32).fill(3)
const cs = {
  identity: { pubkey: '' },
  signEvent: async (t: Parameters<typeof finalizeEvent>[0]) => finalizeEvent(t, SK),
}
vi.mock('../../store/useCyberspace', () => ({
  MAX_COMPUTE_HEIGHT: 20,
  useCyberspace: Object.assign((sel: (s: typeof cs) => unknown) => sel(cs), { getState: () => cs }),
}))
const mutes = { muted: { pubkeys: new Set<string>(), items: new Set<string>() } }
vi.mock('../../store/useMutes', () => ({ useMutes: (sel: (s: typeof mutes) => unknown) => sel(mutes) }))

const { useComments } = await import('../useComments')
const { regionKeyAt } = await import('../../lib/shardCrypto')
const { regionKeyOffThread } = await import('../../lib/regionKeyOffThread')
const { queryChecked } = await import('../../lib/relay')
const { sealedComment, itemParent, openComments } = await import('../../lib/comments')
const { bytesToHex } = await import('../../lib/events')
type Subject = import('../../lib/comments').CommentSubject

/** Render, run the effects it queued, and render again while state changed. */
function render(subject: Subject | null): ReturnType<typeof useComments> {
  let out!: ReturnType<typeof useComments>
  for (let n = 0; n < 10; n++) {
    si = 0
    pending = []
    dirty = false
    flags.inRender = true
    try { out = useComments(subject) } finally { flags.inRender = false }
    for (const run of pending) run()
    if (!dirty) return out
  }
  return out
}

/** Let the hook's promises settle and render again, a few rounds (a key, then the read it starts). */
async function settle(subject: Subject | null): Promise<ReturnType<typeof useComments>> {
  let out = render(subject)
  for (let round = 0; round < 4; round++) {
    for (let n = 0; n < 5; n++) await new Promise((r) => setTimeout(r, 0))
    out = render(subject)
  }
  return out
}

const AUTHOR = 'a'.repeat(64)
const BAG_KEY = new Uint8Array(32).fill(9)
const subjectAt = (height: number, bagKeyHex?: string): Subject => ({
  author: AUTHOR, lookupId: 'd'.repeat(64), itemId: 'e'.repeat(64), type: 'message',
  at: { x: 1n << 40n, y: 5n, z: 7n }, height, ...(bagKeyHex ? { bagKeyHex } : {}),
})

beforeEach(() => {
  slots = []
  relay.events = []
  relay.published = []
  worker.resolve = null
  limit.ceiling = 20
  cs.identity.pubkey = ''
  vi.mocked(regionKeyAt).mockClear()
  vi.mocked(regionKeyOffThread).mockClear()
  vi.mocked(queryChecked).mockClear()
})

describe('comments on a bag above height 20, its key held', () => {
  it('reads and writes under the held key, and never computes one', async () => {
    const subject = subjectAt(25, bytesToHex(BAG_KEY))
    // Someone's comment, sealed under the bag's key.
    const theirs = finalizeEvent(await sealedComment(subject, itemParent(subject), 'seen it', 1_800_000_000, BAG_KEY), new Uint8Array(32).fill(4))
    relay.events = [theirs]
    expect(() => render(subject)).not.toThrow()
    const state = await settle(subject)
    expect(state.unavailable).toBe(false)
    expect(state.comments.map((c) => c.text)).toEqual(['seen it'])
    expect(state.comments[0].sealed).toBe(false)

    expect(await state.post('mine too')).toBe(true)
    expect(relay.published).toHaveLength(1)
    // Sealed under the bag's key, as DECK-0006 has it (the same sealing as
    // before, only the key's source changed): it opens with that key alone.
    const posted = relay.published[0] as never
    expect([...(await openComments([posted], BAG_KEY)).values()]).toEqual(['mine too'])
    expect([...(await openComments([posted], new Uint8Array(32).fill(1))).values()]).toEqual([])

    expect(regionKeyAt).not.toHaveBeenCalled()
    expect(regionKeyOffThread).not.toHaveBeenCalled()
  })
})

describe('comments with no key held', () => {
  it('above the limit: unavailable, no throw, nothing read or posted', async () => {
    const subject = subjectAt(25)
    let state!: ReturnType<typeof useComments>
    expect(() => { state = render(subject) }).not.toThrow()
    expect(state.unavailable).toBe(true)
    expect(state.loading).toBe(false)
    state = await settle(subject)
    expect(await state.post('hello')).toBe(false)
    expect(queryChecked).not.toHaveBeenCalled()
    expect(relay.published).toHaveLength(0)
    expect(regionKeyAt).not.toHaveBeenCalled()
    expect(regionKeyOffThread).not.toHaveBeenCalled()
  })

  it("above this machine's own limit, though under 20: unavailable too", async () => {
    limit.ceiling = 16
    const state = render(subjectAt(18))
    expect(state.unavailable).toBe(true)
    expect(regionKeyOffThread).not.toHaveBeenCalled()
  })

  it.each([13, 17, 20])('at height %i: asked of the region worker from an effect, never in render', async (height) => {
    const subject = subjectAt(height)
    // Not computed in render (the mocks throw if they are), asked once, after it.
    expect(() => render(subject)).not.toThrow()
    let state = await settle(subject)
    expect(regionKeyOffThread).toHaveBeenCalledTimes(1)
    expect(vi.mocked(regionKeyOffThread).mock.calls[0][1]).toBe(height)
    expect(state.loading).toBe(true)
    expect(state.unavailable).toBe(false)
    // The worker answers: the comments are read under its key.
    const key = new Uint8Array(32).fill(5)
    const theirs = finalizeEvent(await sealedComment(subject, itemParent(subject), 'derived', 1_800_000_000, key), new Uint8Array(32).fill(4))
    relay.events = [theirs]
    worker.resolve!({ key, lookupId: 'l'.repeat(64) })
    state = await settle(subject)
    expect(state.comments.map((c) => c.text)).toEqual(['derived'])
    expect(regionKeyAt).not.toHaveBeenCalled()
    expect(regionKeyOffThread).toHaveBeenCalledTimes(1)
  })
})
