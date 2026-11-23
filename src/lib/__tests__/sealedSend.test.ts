/**
 * sealedSend.test.ts: the relay sequences around a bag that names sealed
 * entries (kind 33335, spec §7.6 Writing and Retracting), from the review of
 * #645. Two mock relays that keep what they are sent; each can refuse an
 * event, or store it and report a failure (a timeout after storing). No
 * network.
 *
 * - A sealed entry the new bag stops naming is retracted only on the relays
 *   that took the new bag: a relay that refused a new entry keeps the old bag,
 *   which still names it (should-fix 1).
 * - A bag reported failed that a relay may have stored (a timeout) leaves its
 *   fresh entries in place; only a bag every relay refused outright takes them
 *   back (B3).
 * - What a rewrite carries is decided against the relays' newest bag, by
 *   address, never against the rewrite's own list (B2, and the nit on
 *   comparing by address).
 * - The plaintext of sealed items is bounded by bytes (should-fix 4), and an
 *   `e` reference read as a sealed entry counts by its item (§7.7).
 * - A deletion of a sealed entry carries no `client` tag.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { SEALED_KIND, forgetSealedItems, rememberSealed, retractSealed, sealedChanges, sealedDeletionTemplate, sealedItemOf, sealedItemsKept, sendBagWithSealed, utf8Bytes, type SealedItem } from '../sealed'
import { bagContents, MESSAGE_KIND } from '../hidden'
import { attributed } from '../client'
import type { NostrEvent } from '../events'

type Ev = NostrEvent
const PK = 'a'.repeat(64)
let n = 0
const id = (): string => (++n).toString(16).padStart(64, '0')
const ev = (kind: number, d: string, extra: string[][] = [], created_at = 1000): Ev => ({ id: id(), kind, pubkey: PK, created_at, tags: [['d', d], ...extra], content: '', sig: 'x' }) as Ev
const ENC = ['encrypted', 'aes-256-gcm', 'CT', 'cyberspace:region']
const A = 'wss://a/'
const B = 'wss://b/'

/** Two relays that keep what they take. `refuse` turns an event away outright; `lie` stores it and says nothing back (a timeout). */
function relays(refuse: (u: string, e: Ev) => boolean, lie: (u: string, e: Ev) => boolean = () => false) {
  const held = new Map<string, Ev[]>([[A, []], [B, []]])
  const publish = async (urls: string[], e: Ev): Promise<{ ok: boolean; accepted?: string[]; refused?: boolean }> => {
    const accepted: string[] = []
    let definite = true
    for (const u0 of urls) {
      const u = u0.endsWith('/') ? u0 : `${u0}/`
      if (refuse(u, e)) continue
      held.get(u)!.push(e)
      if (lie(u, e)) definite = false
      else accepted.push(u)
    }
    return accepted.length > 0 ? { ok: true, accepted } : { ok: false, refused: definite }
  }
  return { held, publish }
}

const sign = async (t: { kind: number; created_at: number; tags: string[][]; content: string }): Promise<Ev> => ({ ...t, id: id(), pubkey: PK, sig: 'x' }) as Ev
const emptiedOn = (held: Ev[], d: string): boolean => held.some((e) => e.kind === SEALED_KIND && e.tags.length === 1 && e.tags[0][1] === d)

beforeEach(() => { forgetSealedItems() })

describe('retracting what the new bag no longer names (should-fix 1)', () => {
  it('a relay that refused the new sealed entry keeps the old bag, and the entry that bag names is not emptied there', async () => {
    const r = relays((u, e) => u === B && e.kind === SEALED_KIND && e.tags.some((t) => t[0] === 'encrypted'))
    const oldSealed = ev(SEALED_KIND, 'old', [ENC], 900)
    r.held.get(B)!.push(oldSealed)
    r.held.get(A)!.push(oldSealed)
    const fresh = ev(SEALED_KIND, 'new', [ENC])
    const bag = ev(33330, 'lookup')
    const res = await sendBagWithSealed([A, B], bag, [{ event: fresh, hint: '', fresh: true }], [['a', `${SEALED_KIND}:${PK}:old`, '']], {
      publish: r.publish,
      retract: async (ref, on) => {
        await retractSealed(ref, { me: PK, sign, publish: r.publish, fetch: async () => [oldSealed], relays: on })
      },
    })
    expect(res.ok).toBe(true)
    // The bag went to A alone, which took the new entry; B keeps the old bag.
    expect(r.held.get(A)!.some((e) => e.id === bag.id)).toBe(true)
    expect(r.held.get(B)!.some((e) => e.id === bag.id)).toBe(false)
    // Emptied on A, which took the bag that stopped naming it; left on B, whose bag still names it.
    expect(emptiedOn(r.held.get(A)!, 'old')).toBe(true)
    expect(emptiedOn(r.held.get(B)!, 'old')).toBe(false)
  })
})

describe('a bag that may have been stored is not taken apart (B3)', () => {
  it('a timeout after storing: the fresh entries stay, and are said back as unsettled', async () => {
    const r = relays(() => false, (_u, e) => e.kind === 33330)
    const fresh = ev(SEALED_KIND, 'new', [ENC])
    const retracted: string[][] = []
    const res = await sendBagWithSealed([A, B], ev(33330, 'lookup'), [{ event: fresh, hint: '', fresh: true }], [], { publish: r.publish, retract: async (ref) => { retracted.push(ref) } })
    expect(res.ok).toBe(false)
    expect(r.held.get(A)!.some((e) => e.kind === 33330)).toBe(true)
    expect(retracted).toEqual([])
    expect(res.unsettled?.map((s) => s.event.id)).toEqual([fresh.id])
  })

  it('every relay refused the bag outright: the fresh entries are taken back, on the relays that took them', async () => {
    const r = relays((_u, e) => e.kind === 33330)
    const fresh = ev(SEALED_KIND, 'new', [ENC])
    const carried = ev(SEALED_KIND, 'kept', [ENC], 900)
    const retracted: { ref: string[]; on: string[] }[] = []
    const res = await sendBagWithSealed([A, B], ev(33330, 'lookup'), [{ event: fresh, hint: '', fresh: true }, { event: carried, hint: '' }], [], { publish: r.publish, retract: async (ref, on) => { retracted.push({ ref, on }) } })
    expect(res.ok).toBe(false)
    expect(res.unsettled).toBeUndefined()
    // Only the fresh one: a carried entry may be the one a row, or a bag on a relay, names.
    expect(retracted.map((x) => x.ref[1])).toEqual([`${SEALED_KIND}:${PK}:new`])
    expect(retracted[0].on.sort()).toEqual([A, B])
  })

  it('with no hint, a first relay that refuses sealed entries no longer stops the write: the bag goes where they went', async () => {
    const r = relays((u, e) => u === A && e.kind === SEALED_KIND)
    const fresh = ev(SEALED_KIND, 'new', [ENC])
    const bag = ev(33330, 'lookup')
    const res = await sendBagWithSealed([A, B], bag, [{ event: fresh, hint: '', fresh: true }], [], { publish: r.publish })
    expect(res.ok).toBe(true)
    expect(r.held.get(B)!.map((e) => e.id)).toEqual([fresh.id, bag.id])
    expect(r.held.get(A)!.some((e) => e.id === bag.id)).toBe(false)
  })
})

describe('what a rewrite carries and drops (B2, by address)', () => {
  const ref = (d: string, coord = '', hint = ''): string[] => ['a', `${SEALED_KIND}:${PK}:${d}`, hint, coord]
  const item = { id: 'i'.repeat(64), kind: MESSAGE_KIND, pubkey: PK, created_at: 1, tags: [], content: 'x' }

  it('an entry the rows name but the relays\' newest bag does not (sealed while LOCAL) is carried, though `before` already names it', () => {
    const before = [item, ref('local')]
    const entries = [item, ref('local'), { ...item, id: 'j'.repeat(64) }]
    const { carry, dropped } = sealedChanges(entries, before, [item], PK)
    expect(carry.map((e) => e[1])).toEqual([`${SEALED_KIND}:${PK}:local`])
    expect(dropped).toEqual([])
  })

  it('an entry the relays\' bag names is not carried; with no relay read, every one is', () => {
    expect(sealedChanges([ref('x')], [ref('x')], [ref('x')], PK).carry).toEqual([])
    expect(sealedChanges([ref('x')], [ref('x')], null, PK).carry.map((e) => e[1])).toEqual([`${SEALED_KIND}:${PK}:x`])
  })

  it('the same address under another hint or coordinate is the same sealed entry: never dropped, never carried', () => {
    const { carry, dropped } = sealedChanges([ref('x', 'c2', 'wss://b/')], [ref('x', 'c1', 'wss://a/')], [ref('x', 'c1', 'wss://a/')], PK)
    expect(carry).toEqual([])
    expect(dropped).toEqual([])
  })

  it('what `before` named and the new bag does not is dropped once; another author\'s never', () => {
    const other = ['a', `${SEALED_KIND}:${'b'.repeat(64)}:y`, '', '']
    const { dropped } = sealedChanges([], [ref('x', 'c1'), ref('x', 'c2'), other], [], PK)
    expect(dropped.map((e) => e[1])).toEqual([`${SEALED_KIND}:${PK}:x`])
  })
})

describe('the sealed items kept here (should-fix 4, §7.7)', () => {
  const big = (i: number, chars: number): SealedItem => ({ id: i.toString(16).padStart(64, '0'), pubkey: PK, created_at: 1, kind: MESSAGE_KIND, tags: [], content: 'm'.repeat(chars) })

  it('are bounded by bytes, oldest first out, and one larger than the budget is not kept', () => {
    forgetSealedItems(10_000)
    for (let i = 0; i < 10; i++) rememberSealed(`${SEALED_KIND}:${PK}:${i}`, big(i, 3_000))
    const kept = sealedItemsKept()
    expect(kept.bytes).toBeLessThanOrEqual(10_000)
    expect(kept.count).toBe(3)
    expect(sealedItemOf(['a', `${SEALED_KIND}:${PK}:0`])).toBeUndefined()
    expect(sealedItemOf(['a', `${SEALED_KIND}:${PK}:9`])?.id).toBe(big(9, 1).id)
    rememberSealed(`${SEALED_KIND}:${PK}:huge`, big(99, 20_000))
    expect(sealedItemOf(['a', `${SEALED_KIND}:${PK}:huge`])).toBeUndefined()
  })

  it('count in UTF-8 bytes: a multibyte item takes what a relay counts', () => {
    forgetSealedItems(1_000_000)
    const wide = { ...big(1, 0), content: '€'.repeat(1_000) }
    rememberSealed(`${SEALED_KIND}:${PK}:wide`, wide)
    expect(sealedItemsKept().bytes).toBe(utf8Bytes(JSON.stringify(wide)))
    expect(sealedItemsKept().bytes).toBeGreaterThan(JSON.stringify(wide).length)
  })

  it('an `e` reference to a sealed entry that was read counts by its item; one never read counts as nothing', () => {
    const entry = ev(SEALED_KIND, 'z', [ENC])
    rememberSealed(`${SEALED_KIND}:${PK}:z`, big(5, 10), entry)
    expect(bagContents([['e', entry.id, '', 'c']]).message).toBe(1)
    expect(bagContents([['e', 'f'.repeat(64), '', 'c']]).message).toBe(0)
  })
})

describe('the deletion of a sealed entry', () => {
  it('carries no `client` tag, which would tie the address it names to the app', () => {
    const t = sealedDeletionTemplate(PK, 'z', ['1'.repeat(64), '2'.repeat(64)], 1000)
    expect(attributed(t).tags.some((x) => x[0] === 'client')).toBe(false)
    expect(t.tags.filter((x) => x[0] === 'e')).toHaveLength(2)
    // Any other deletion is still attributed.
    expect(attributed({ kind: 5, created_at: 1, content: '', tags: [['k', '33330']] }).tags.some((x) => x[0] === 'client')).toBe(true)
  })
})
