/**
 * commentsSwitch.test.ts - a comment written as one identity is never signed
 * by another (identity-switch audit, 2026-11-19).
 *
 * A comment is sealed under its bag's key before it is signed, and sealing
 * is async. A switch of identity in that moment had the identity signed in
 * since sign and publish what was written as the one before. The hook runs
 * under the small stand-in for React of commentsHeldKey.test.ts, and the
 * seal switches identity while it works. No relay is touched.
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

const relay = vi.hoisted(() => ({ events: [] as unknown[], published: [] as Array<{ content: string; pubkey: string }> }))
vi.mock('../../lib/relay', () => ({
  queryChecked: vi.fn(async () => ({ events: relay.events, trouble: null })),
  publish: vi.fn(async (ev: { content: string; pubkey: string }) => { relay.published.push(ev); return { ok: true } }),
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
/** Runs while a comment is sealed, before it is handed back to be signed. */
const seal = vi.hoisted(() => ({ during: null as null | (() => void) }))
vi.mock('../../lib/comments', async (orig) => {
  const real = await orig<typeof import('../../lib/comments')>()
  return { ...real, sealedComment: async (...args: Parameters<typeof real.sealedComment>) => { const t = await real.sealedComment(...args); seal.during?.(); return t } }
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
const signed: string[] = []
const cs = {
  identity: { pubkey: '' },
  signEvent: async (t: Parameters<typeof finalizeEvent>[0]) => { signed.push(cs.identity.pubkey); return finalizeEvent(t, SK) },
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
  cs.identity.pubkey = 'a1'.repeat(32)
  signed.length = 0
  seal.during = null
  vi.mocked(regionKeyAt).mockClear()
  vi.mocked(regionKeyOffThread).mockClear()
  vi.mocked(queryChecked).mockClear()
})

describe('a switch of identity while a comment is sealed', () => {
  it('signs and publishes nothing, and says why', async () => {
    const subject = subjectAt(25, bytesToHex(BAG_KEY))
    const state = await settle(subject)
    seal.during = () => { cs.identity.pubkey = 'b2'.repeat(32) }
    expect(await state.post('written as A')).toBe(false)
    expect(signed).toEqual([])
    expect(relay.published).toHaveLength(0)
    expect((await settle(subject)).error).toMatch(/switched identity/)
  })

  it('with no switch, the comment goes out', async () => {
    const subject = subjectAt(25, bytesToHex(BAG_KEY))
    const state = await settle(subject)
    expect(await state.post('written as A')).toBe(true)
    expect(signed).toEqual(['a1'.repeat(32)])
    expect(relay.published).toHaveLength(1)
  })
})
