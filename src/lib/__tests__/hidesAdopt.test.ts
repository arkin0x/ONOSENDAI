/**
 * hidesAdopt.test.ts: a second device opens a bag of yours with nothing but
 * what the record of your hides carries (owner ruling, 2026-11-15). Real
 * bags, sealed and signed with generated test keys.
 */

import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { bagTemplate, messageInnerTemplate, rumorOf } from '../hidden'
import { bytesToHex, type NostrEvent } from '../events'
import { adoptEntries } from '../hidesAdopt'
import type { HideEntry } from '../hidesRecord'

const sk = generateSecretKey()
const me = getPublicKey(sk)
const T = 1_700_000_000
const key = new Uint8Array(32).map((_, i) => (i * 13 + 5) & 0xff)
const lookupId = 'ab'.repeat(32)
const at = { x: (1n << 40n) + 7n, y: 4096n + 3n, z: 9n }

async function bagOf(texts: string[], signer = sk, k = key): Promise<NostrEvent> {
  const inners = texts.map((t) => rumorOf(messageInnerTemplate(t, at, 0, T), getPublicKey(signer)))
  return finalizeEvent(await bagTemplate(inners, k, lookupId, 12, T), signer) as unknown as NostrEvent
}

const entry: HideEntry = { l: lookupId, k: bytesToHex(key), h: 12, p: 0, x: String(at.x), y: String(at.y), z: String(at.z), n: 'hello', c: 2, t: T }
const ask = (events: NostrEvent[], trouble = false) => ({ checked: async () => ({ events, trouble }), any: async () => [] as NostrEvent[] })

describe('opening a bag of yours from another device', () => {
  it('opens with the record\'s key, at the record\'s place, and gives back every item with what a row needs', async () => {
    const bag = await bagOf(['hello', 'second'])
    const { found, state } = await adoptEntries([entry], me, ask([bag]))
    expect(state[lookupId]).toBe('holds')
    expect(found.map((h) => h.text).sort()).toEqual(['hello', 'second'])
    for (const h of found) {
      expect(h.author).toBe(me)
      expect(h.keyHex).toBe(bytesToHex(key))
      expect(h.lookupId).toBe(lookupId)
      expect(h.height).toBe(12)
      expect(h.inner).toBeDefined()
      expect(h.at).toEqual(at)
    }
  })

  it('a key that is not the bag\'s opens nothing', async () => {
    const bag = await bagOf(['hello'])
    expect(await adoptEntries([{ ...entry, k: 'cd'.repeat(32) }], me, ask([bag]))).toEqual({ found: [], state: { [lookupId]: 'unknown' } })
  })

  it('a bag under the same d signed by someone else is never yours', async () => {
    const theirs = await bagOf(['not mine'], generateSecretKey())
    expect(await adoptEntries([entry], me, ask([theirs]))).toEqual({ found: [], state: { [lookupId]: 'gone' } })
  })

  it('no bag on the relay: gone when the canonical relay answered, unknown when it did not', async () => {
    expect(await adoptEntries([entry], me, ask([]))).toEqual({ found: [], state: { [lookupId]: 'gone' } })
    expect(await adoptEntries([entry], me, ask([], true))).toEqual({ found: [], state: { [lookupId]: 'unknown' } })
  })
})
