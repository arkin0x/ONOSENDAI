/**
 * dm.test.ts: operator and agent DMs follow NIP-17 exactly (the contract of
 * arkinox, 2026-10-10), because the agent's side is written separately
 * against the same contract. The layers are checked one by one (rumor, seal,
 * wrap, self-copy), the unwrap refuses what it must, and interop runs both
 * ways against nostr-tools' own nip59 and nip17. No relay is touched.
 */

import { describe, expect, it } from 'vitest'
// The store first: signers -> relay -> useCyberspace -> signers is a cycle (client.test.ts).
import '../../store/useCyberspace'
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { v2 as nip44 } from 'nostr-tools/nip44'
import * as nip17 from 'nostr-tools/nip17'
import * as nip59 from 'nostr-tools/nip59'
import { localSigner, type Signer } from '../signers'
import { CLIENT_TAG } from '../client'
import type { NostrEvent } from '../events'
import {
  DM_KIND, MAX_BACKDATE_S, SEAL_KIND, STRATEGY_TAG, WRAP_KIND,
  counterpartOf, createRumor, currentStrategy, isStrategy, mergeMessages, randomPast, sealRumor, toMessage, unwrapMessage, wrapMessage, wrapSeal,
  type DmMessage, type DmReader, type DmSender,
} from '../dm'

/** A signer from signers.ts, with its NIP-44 pair present (a local key always has both). */
function who(sk: Uint8Array = generateSecretKey()): Signer & DmSender & DmReader & { sk: Uint8Array } {
  const s = localSigner(sk)
  return { ...s, nip44Encrypt: s.nip44Encrypt!, nip44Decrypt: s.nip44Decrypt!, sk }
}
const fresh = (): DmSender => who()

/** Open one NIP-44 layer by hand, as a relay-side reader with the key would. */
function open<T>(sk: Uint8Array, from: string, payload: string): T {
  return JSON.parse(nip44.decrypt(payload, nip44.utils.getConversationKey(sk, from))) as T
}

describe('the wire format', () => {
  it('the rumor is kind 14, unsigned, from the sender, with one p tag and the text', () => {
    const op = who()
    const agent = who()
    const r = createRumor(op.pubkey, agent.pubkey, 'hello', { now: 1_700_000_000 })
    expect(r).toMatchObject({ kind: DM_KIND, pubkey: op.pubkey, tags: [['p', agent.pubkey]], content: 'hello', created_at: 1_700_000_000 })
    expect(r).not.toHaveProperty('sig')
    expect(r.id).toMatch(/^[0-9a-f]{64}$/)
    expect(isStrategy(r)).toBe(false)
  })

  it('a STRATEGY rumor carries ["agent", "strategy"] after the p tag', () => {
    const r = createRumor('ab'.repeat(32), 'cd'.repeat(32), 'hold the line', { strategy: true })
    expect(r.tags).toEqual([['p', 'cd'.repeat(32)], ['agent', 'strategy']])
    expect([...STRATEGY_TAG]).toEqual(['agent', 'strategy'])
    expect(isStrategy(r)).toBe(true)
  })

  it('the seal is kind 13, signed by the sender, with no tags at all (no client tag), and holds the rumor', async () => {
    const op = who()
    const agent = who()
    const r = createRumor(op.pubkey, agent.pubkey, 'sealed')
    const seal = await sealRumor(r, op, agent.pubkey)
    expect(seal.kind).toBe(SEAL_KIND)
    expect(seal.pubkey).toBe(op.pubkey)
    expect(seal.tags).toEqual([])
    expect(seal.tags).not.toContainEqual(CLIENT_TAG)
    expect(verifyEvent(seal as Parameters<typeof verifyEvent>[0])).toBe(true)
    expect(open(agent.sk, op.pubkey, seal.content)).toEqual(r)
  })

  it('the wrap is kind 1059, signed by a fresh key, with only the p tag, and holds the seal', async () => {
    const op = who()
    const agent = who()
    const seal = await sealRumor(createRumor(op.pubkey, agent.pubkey, 'x'), op, agent.pubkey)
    const key = who()
    const wrap = await wrapSeal(seal, agent.pubkey, key)
    expect(wrap.kind).toBe(WRAP_KIND)
    expect(wrap.pubkey).toBe(key.pubkey)
    expect(wrap.pubkey).not.toBe(op.pubkey)
    expect(wrap.tags).toEqual([['p', agent.pubkey]])
    expect(open(agent.sk, key.pubkey, wrap.content)).toEqual(JSON.parse(JSON.stringify(seal)))
  })

  it('seal and wrap times are moved up to two days into the past, never forward', async () => {
    expect(randomPast(1_000_000, () => 0)).toBe(1_000_000)
    expect(randomPast(1_000_000, () => 0.999999)).toBe(1_000_000 - MAX_BACKDATE_S + 1)
    const op = who()
    const agent = who()
    const now = Math.floor(Date.now() / 1000)
    for (let i = 0; i < 10; i++) {
      const { rumor, toRecipient, toSelf } = await wrapMessage(op, agent.pubkey, `m${i}`, fresh)
      for (const ev of [toRecipient, toSelf]) {
        expect(ev.created_at).toBeLessThanOrEqual(now + 1)
        expect(ev.created_at).toBeGreaterThan(now - MAX_BACKDATE_S - 2)
      }
      // The rumor keeps the real time.
      expect(Math.abs(rumor.created_at - now)).toBeLessThan(5)
    }
  })

  it('wraps twice, to the recipient and to the sender, with distinct fresh keys, the same rumor in both', async () => {
    const op = who()
    const agent = who()
    const { rumor, toRecipient, toSelf } = await wrapMessage(op, agent.pubkey, 'twice', fresh)
    expect(toRecipient.tags).toEqual([['p', agent.pubkey]])
    expect(toSelf.tags).toEqual([['p', op.pubkey]])
    expect(new Set([toRecipient.pubkey, toSelf.pubkey, op.pubkey]).size).toBe(3)
    expect(await unwrapMessage(toRecipient, agent)).toEqual(rumor)
    expect(await unwrapMessage(toSelf, op)).toEqual(rumor)
    // Neither side opens the other's copy.
    expect(await unwrapMessage(toSelf, agent)).toBeNull()
    expect(await unwrapMessage(toRecipient, op)).toBeNull()
  })

  it('refuses an empty message and a recipient that is not a pubkey', async () => {
    await expect(wrapMessage(who(), who().pubkey, '   ', fresh)).rejects.toThrow()
    await expect(wrapMessage(who(), 'npub1nope', 'hi', fresh)).rejects.toThrow()
  })

  it('refuses to send a seal the signer came back with a tag on', async () => {
    const op = who()
    const tagging: DmSender = { ...op, signEvent: (t) => op.signEvent({ ...t, kind: 1 }).then((e) => ({ ...e, kind: SEAL_KIND, tags: [[...CLIENT_TAG]] })) }
    await expect(sealRumor(createRumor(op.pubkey, who().pubkey, 'x'), tagging, who().pubkey)).rejects.toThrow(/not sent/)
  })
})

describe('unwrapping refuses what is not sound', () => {
  /** A seal signed by `signerSk` around a rumor claiming `claimed` as its author, wrapped to `to`. */
  function forged(signerSk: Uint8Array, claimed: string, to: string): NostrEvent {
    const rumor = createRumor(claimed, to, 'I am your operator')
    const sealContent = nip44.encrypt(JSON.stringify(rumor), nip44.utils.getConversationKey(signerSk, to))
    const seal = finalizeEvent({ kind: SEAL_KIND, created_at: rumor.created_at, tags: [], content: sealContent }, signerSk)
    const wk = generateSecretKey()
    return finalizeEvent({ kind: WRAP_KIND, created_at: rumor.created_at, tags: [['p', to]], content: nip44.encrypt(JSON.stringify(seal), nip44.utils.getConversationKey(wk, to)) }, wk) as unknown as NostrEvent
  }

  it('drops a rumor whose pubkey is not the seal signer', async () => {
    const agent = who()
    const operator = who()
    const impostor = generateSecretKey()
    expect(await unwrapMessage(forged(impostor, operator.pubkey, agent.pubkey), agent)).toBeNull()
    // The same construction, honest, opens.
    expect(await unwrapMessage(forged(operator.sk, operator.pubkey, agent.pubkey), agent)).not.toBeNull()
  })

  it('drops a seal whose signature does not verify', async () => {
    const agent = who()
    const op = who()
    const seal = await sealRumor(createRumor(op.pubkey, agent.pubkey, 'x'), op, agent.pubkey)
    const broken = { ...seal, sig: seal.sig.replace(/^./, (c) => (c === '0' ? '1' : '0')) }
    expect(await unwrapMessage(await wrapSeal(broken as NostrEvent, agent.pubkey, fresh()), agent)).toBeNull()
  })

  it('drops a rumor whose id is not its own hash, and anything that is not a wrap', async () => {
    const agent = who()
    const op = who()
    const rumor = { ...createRumor(op.pubkey, agent.pubkey, 'x'), id: 'ff'.repeat(32) }
    expect(await unwrapMessage(await wrapSeal(await sealRumor(rumor, op, agent.pubkey), agent.pubkey, fresh()), agent)).toBeNull()
    const { toRecipient } = await wrapMessage(op, agent.pubkey, 'x', fresh)
    expect(await unwrapMessage({ ...toRecipient, kind: 1 }, agent)).toBeNull()
  })
})

describe('interop with nostr-tools nip59 and nip17', () => {
  it('a message wrapped here unwraps with nostr-tools, marker and all', async () => {
    const op = who()
    const agent = who()
    const { rumor, toRecipient, toSelf } = await wrapMessage(op, agent.pubkey, 'ride to the stop', fresh, { strategy: true })
    const theirs = nip17.unwrapEvent(toRecipient as Parameters<typeof nip17.unwrapEvent>[0], agent.sk)
    expect(theirs).toMatchObject({ id: rumor.id, kind: 14, pubkey: op.pubkey, content: 'ride to the stop', tags: [['p', agent.pubkey], ['agent', 'strategy']] })
    expect(nip59.unwrapEvent(toSelf as Parameters<typeof nip59.unwrapEvent>[0], op.sk).id).toBe(rumor.id)
  })

  it('a message wrapped by nostr-tools nip17 unwraps here', async () => {
    const op = who()
    const agent = who()
    const wrap = nip17.wrapEvent(agent.sk, { publicKey: op.pubkey }, 'at the stop') as unknown as NostrEvent
    const got = await unwrapMessage(wrap, op)
    expect(got).toMatchObject({ kind: 14, pubkey: agent.pubkey, content: 'at the stop', tags: [['p', op.pubkey]] })
    expect(counterpartOf(got!, op.pubkey)).toBe(agent.pubkey)
  })

  it('a STRATEGY wrapped by nostr-tools nip59 with the marker unwraps here as a STRATEGY', async () => {
    const op = who()
    const agent = who()
    const wrap = nip59.wrapEvent({ kind: 14, content: 'hold', tags: [['p', agent.pubkey], ['agent', 'strategy']] }, op.sk, agent.pubkey) as unknown as NostrEvent
    const got = await unwrapMessage(wrap, agent)
    expect(got && isStrategy(got)).toBe(true)
  })

  it('both self-copies from nostr-tools nip17 wrapManyEvents open for their own reader', async () => {
    const op = who()
    const agent = who()
    const [self, toAgent] = nip17.wrapManyEvents(op.sk, [{ publicKey: agent.pubkey }], 'both') as unknown as NostrEvent[]
    expect((await unwrapMessage(self, op))?.content).toBe('both')
    expect((await unwrapMessage(toAgent, agent))?.content).toBe('both')
  })
})

describe('conversations', () => {
  const me = 'aa'.repeat(32)
  const agent = 'bb'.repeat(32)
  const other = 'cc'.repeat(32)
  const r = (pubkey: string, tags: string[][]) => ({ pubkey, tags })

  it('a rumor belongs to the conversation with the other person, and a group to none', () => {
    expect(counterpartOf(r(me, [['p', agent]]), me)).toBe(agent)
    expect(counterpartOf(r(agent, [['p', me]]), me)).toBe(agent)
    expect(counterpartOf(r(agent, [['p', me], ['p', other]]), me)).toBeNull()
    expect(counterpartOf(r(me, [['p', agent], ['p', other]]), me)).toBeNull()
    // Addressed to someone else entirely: not mine to show.
    expect(counterpartOf(r(agent, [['p', other]]), me)).toBeNull()
  })

  const m = (id: string, from: string, at: number, strategy = false): DmMessage => ({ id, from, text: id, at, strategy })

  it('merges oldest first, each id once', () => {
    const merged = mergeMessages([m('b', me, 2), m('a', agent, 1)], [m('b', me, 2), m('c', agent, 3)])
    expect(merged.map((x) => x.id)).toEqual(['a', 'b', 'c'])
  })

  it('the STRATEGY in force is the newest marked one the operator wrote', () => {
    const list = [m('1', me, 10, true), m('2', me, 30, true), m('3', agent, 40, true), m('4', me, 50)]
    expect(currentStrategy(list, me)?.id).toBe('2')
    expect(currentStrategy([m('4', me, 50)], me)).toBeNull()
  })

  it('a rumor becomes a message with its marker', () => {
    const rumor = createRumor(me, agent, 'go', { strategy: true, now: 5 })
    expect(toMessage(rumor)).toEqual({ id: rumor.id, from: me, text: 'go', at: 5, strategy: true })
  })
})

it('the fresh wrapping key comes from signers.ts and is a real key', () => {
  const k = fresh()
  expect(k.pubkey).toBe(getPublicKey((k as unknown as { sk: Uint8Array }).sk))
})
