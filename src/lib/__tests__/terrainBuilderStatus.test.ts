/**
 * terrainBuilderStatus.test.ts - a builder key's status asked of a relay
 * that matches tag filters the way the canonical relay does (lib/terrain/
 * builderStatus.ts): a 64-hex tag value is kept as 32 bytes and a short word
 * as text, so one filter mixing the two is refused when a key comes first,
 * and misses the keys when `all` does. Throwaway keys only; no network.
 */

import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import type { Filter } from 'nostr-tools/filter'
import { keyStatusOn, type AskRelay } from '../terrain/builderStatus'
import type { NostrEvent } from '../events'

const HEX = /^[0-9a-f]{64}$/

/** A relay holding `held`, matching tag filters as the canonical relay does. */
function canonicalLike(held: NostrEvent[], asked: Filter[] = []): AskRelay {
  return async (f) => {
    asked.push(f)
    for (const [k, v] of Object.entries(f)) {
      if (!/^#[a-zA-Z]$/.test(k)) continue
      const vs = v as string[]
      if (vs.length > 1 && HEX.test(vs[0]) && vs.some((x) => !HEX.test(x))) return { events: [], trouble: 'closed: error: could not query events' }
    }
    const events = held.filter((e) => {
      if (f.kinds && !f.kinds.includes(e.kind)) return false
      if (f.authors && !f.authors.includes(e.pubkey)) return false
      if (f.until !== undefined && e.created_at > f.until) return false
      for (const [k, v] of Object.entries(f)) {
        if (!/^#[a-zA-Z]$/.test(k)) continue
        const vs = v as string[]
        // Text first: the 64-hex values are read as text too, and match nothing kept as bytes.
        const want = HEX.test(vs[0]) ? vs : vs.filter((x) => !HEX.test(x))
        if (!e.tags.some((t) => t[0] === k[1] && want.includes(t[1]))) return false
      }
      return true
    }).sort((a, b) => b.created_at - a.created_at)
    return { events: f.limit ? events.slice(0, f.limit) : events, trouble: null }
  }
}

const verify = (e: NostrEvent): boolean => verifyEvent(e as never)

function move(sk: Uint8Array, at: number, tags: string[][]): NostrEvent {
  return finalizeEvent({ kind: 3333, created_at: at, tags: [['A', 'hop'], ...tags], content: '' }, sk) as unknown as NostrEvent
}

describe('builder key status against the canonical relay', () => {
  it('a named key is valid, and no filter mixes a key with `all` (the relay refused that, so every key stayed unknown)', async () => {
    const sk = generateSecretKey()
    const author = getPublicKey(sk)
    const k = getPublicKey(generateSecretKey())
    const held = [move(sk, 1_790_000_000, [['builder', k]]), move(sk, 1_790_000_010, [])]
    const asked: Filter[] = []
    const got = await keyStatusOn(canonicalLike(held, asked), author, [k], verify)
    expect(got.get(k)).toBe('valid')
    for (const f of asked) {
      const r = (f as Record<string, unknown>)['#R'] as string[] | undefined
      if (r) expect(r.every((x) => HEX.test(x)) || r.every((x) => !HEX.test(x))).toBe(true)
    }
    // The one filter §4.3 writes is what the relay refused.
    const once = await canonicalLike(held)({ kinds: [3333], authors: [author], '#R': [k, 'all'] })
    expect(once.trouble).not.toBeNull()
  })

  it('a key retired by name is void, and so is one named before a later `all`', async () => {
    const sk = generateSecretKey()
    const author = getPublicKey(sk)
    const k1 = getPublicKey(generateSecretKey())
    const k2 = getPublicKey(generateSecretKey())
    const held = [
      move(sk, 1_790_000_000, [['builder', k1]]),
      move(sk, 1_790_000_005, [['builder', k2]]),
      move(sk, 1_790_000_010, [['builder-retire', k1], ['R', k1]]),
    ]
    let got = await keyStatusOn(canonicalLike(held), author, [k1, k2], verify)
    expect(got.get(k1)).toBe('void')
    expect(got.get(k2)).toBe('valid')
    held.push(move(sk, 1_790_000_020, [['builder-retire', 'all'], ['R', 'all']]))
    got = await keyStatusOn(canonicalLike(held), author, [k2], verify)
    expect(got.get(k2)).toBe('void')
  })

  it('a naming found once is kept: the next check asks only for retirements, and a later `all` still voids the key', async () => {
    const sk = generateSecretKey()
    const author = getPublicKey(sk)
    const k = getPublicKey(generateSecretKey())
    const held = [move(sk, 1_790_000_000, [['builder', k]]), move(sk, 1_790_000_010, [])]
    const named = new Map<string, number>()
    expect((await keyStatusOn(canonicalLike(held), author, [k], verify, named)).get(k)).toBe('valid')
    expect(named.get(`${author}|${k}`)).toBe(1_790_000_000)
    const asked: Filter[] = []
    expect((await keyStatusOn(canonicalLike(held, asked), author, [k], verify, named)).get(k)).toBe('valid')
    expect(asked.every((f) => (f as Record<string, unknown>)['#R'] !== undefined)).toBe(true)
    held.push(move(sk, 1_790_000_020, [['builder-retire', 'all'], ['R', 'all']]))
    expect((await keyStatusOn(canonicalLike(held), author, [k], verify, named)).get(k)).toBe('void')
  })

  it('a relay that cannot answer leaves the key unknown', async () => {
    const k = getPublicKey(generateSecretKey())
    const got = await keyStatusOn(async () => ({ events: [], trouble: 'unreachable' }), getPublicKey(generateSecretKey()), [k], verify)
    expect(got.get(k)).toBeUndefined()
  })
})
