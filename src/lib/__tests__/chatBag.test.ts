import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { bagTemplate, chatInnerTemplate, chatInners, chatRumor, ciphertextOf, unbag, CHAT_BAG_KIND, CHAT_KIND, HIDDEN_KIND } from '../hidden'

const key = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff)
const at = { x: 1n << 40n, y: 5n, z: 9n }

async function said(text: string, sk = generateSecretKey()) {
  const inner = chatRumor(chatInnerTemplate(text, at, 0, 1_700_000_000, 'aa'.repeat(32)), getPublicKey(sk))
  const outer = finalizeEvent(await bagTemplate([inner], key, 'aa'.repeat(32), 12, 1_700_000_000, CHAT_BAG_KIND), sk)
  return { inner, outer, sk }
}

describe('the ephemeral envelope', () => {
  it('is a 33330 in everything but the kind', async () => {
    const { outer } = await said('hello')
    expect(outer.kind).toBe(CHAT_BAG_KIND)
    expect(outer.tags.find((t) => t[0] === 'd')?.[1]).toBe('aa'.repeat(32))
    expect(outer.tags.find((t) => t[0] === 'H')?.[1]).toBe('12')
    expect(outer.tags.some((t) => t[0] === 'h')).toBe(false)
    expect(outer.tags.find((t) => t[0] === 'encrypted')?.[1]).toBeTruthy()
    expect(ciphertextOf(outer)).not.toBeNull()
  })

  it('opens with the region key and gives back the line', async () => {
    const { inner, outer } = await said('is anyone here')
    const lines = await chatInners(outer, key)
    expect(lines).toHaveLength(1)
    expect(lines[0].id).toBe(inner.id)
    expect(lines[0].kind).toBe(CHAT_KIND)
    expect(lines[0].content).toBe('is anyone here')
  })

  it('stays shut to the wrong key', async () => {
    const { outer } = await said('secret')
    const wrong = new Uint8Array(32).map((_, i) => (i * 11 + 1) & 0xff)
    expect(await chatInners(outer, wrong)).toHaveLength(0)
  })

  it('refuses a line wrapped by someone who did not sign it', async () => {
    const speaker = generateSecretKey()
    const wrapper = generateSecretKey()
    const inner = chatRumor(chatInnerTemplate('not mine to carry', at, 0, 1, 'bb'.repeat(32)), getPublicKey(speaker))
    const outer = finalizeEvent(await bagTemplate([inner], key, 'bb'.repeat(32), 12, 1, CHAT_BAG_KIND), wrapper)
    expect(getPublicKey(speaker)).not.toBe(outer.pubkey)
    expect(await chatInners(outer, key)).toHaveLength(0)
  })

  it('is not mistaken for a hiding place, and a hiding place is not chat', async () => {
    const { outer } = await said('talk')
    // The hidden-thing reader sees no items: a chat line has no coordinate item shape it accepts.
    expect(await unbag(outer, key)).toHaveLength(0)
    const sk = generateSecretKey()
    const stored = finalizeEvent(await bagTemplate([], key, 'cc'.repeat(32), 12, 1, HIDDEN_KIND), sk)
    expect(await chatInners(stored, key)).toHaveLength(0)
  })

  it('names its room on the inner event, the way other clients file a room', async () => {
    const { inner } = await said('where am i')
    expect(inner.tags.find((t) => t[0] === 'd')?.[1]).toBe('aa'.repeat(32))
  })

  it('a line said one cube over opens with that cube\'s key', async () => {
    const { outer } = await said('across the wall')
    expect(await chatInners(outer, key)).toHaveLength(1)
  })

  it('caps a line at the chat length', () => {
    const t = chatInnerTemplate('x'.repeat(2000), at, 0, 1, 'aa'.repeat(32))
    expect(t.content).toHaveLength(500)
  })

  it('seals the line as a rumor: an id, no signature (arkinox, 2026-10-13)', async () => {
    const { inner } = await said('no proof of me')
    expect('sig' in inner).toBe(false)
    expect(inner.id).toMatch(/^[0-9a-f]{64}$/)
  })

  it('refuses a rumor whose id is not its own hash', async () => {
    const sk = generateSecretKey()
    const inner = { ...chatRumor(chatInnerTemplate('forged id', at, 0, 1, 'aa'.repeat(32)), getPublicKey(sk)), id: 'ff'.repeat(32) }
    const outer = finalizeEvent(await bagTemplate([inner], key, 'aa'.repeat(32), 12, 1, CHAT_BAG_KIND), sk)
    expect(await chatInners(outer, key)).toHaveLength(0)
  })

  it('still reads a signed line from an older client, when its signature holds', async () => {
    const sk = generateSecretKey()
    const inner = finalizeEvent(chatInnerTemplate('from before', at, 0, 1, 'aa'.repeat(32)), sk)
    const outer = finalizeEvent(await bagTemplate([inner], key, 'aa'.repeat(32), 12, 1, CHAT_BAG_KIND), sk)
    const lines = await chatInners(outer, key)
    expect(lines).toHaveLength(1)
    expect(lines[0].id).toBe(inner.id)
  })

  it('reads a line whose sig is the empty string as a rumor (DECK-0005 §3.2 rule 5)', async () => {
    const sk = generateSecretKey()
    const inner = { ...chatRumor(chatInnerTemplate('empty is none', at, 0, 1, 'aa'.repeat(32)), getPublicKey(sk)), sig: '' }
    const outer = finalizeEvent(await bagTemplate([inner], key, 'aa'.repeat(32), 12, 1, CHAT_BAG_KIND), sk)
    const lines = await chatInners(outer, key)
    expect(lines).toHaveLength(1)
    expect(lines[0].id).toBe(inner.id)
    expect(lines[0].pubkey).toBe(outer.pubkey)
  })

  it('still refuses an empty-sig line whose id is not its own hash', async () => {
    const sk = generateSecretKey()
    const inner = { ...chatRumor(chatInnerTemplate('forged', at, 0, 1, 'aa'.repeat(32)), getPublicKey(sk)), id: 'ff'.repeat(32), sig: '' }
    const outer = finalizeEvent(await bagTemplate([inner], key, 'aa'.repeat(32), 12, 1, CHAT_BAG_KIND), sk)
    expect(await chatInners(outer, key)).toHaveLength(0)
  })

  it('still refuses an empty-sig line wrapped by someone who did not say it', async () => {
    const speaker = generateSecretKey()
    const inner = { ...chatRumor(chatInnerTemplate('not mine', at, 0, 1, 'aa'.repeat(32)), getPublicKey(speaker)), sig: '' }
    const outer = finalizeEvent(await bagTemplate([inner], key, 'aa'.repeat(32), 12, 1, CHAT_BAG_KIND), generateSecretKey())
    expect(await chatInners(outer, key)).toHaveLength(0)
  })

  it('refuses a line whose sig is present but not a string', async () => {
    const sk = generateSecretKey()
    for (const sig of [null, 0, false]) {
      const inner = { ...chatRumor(chatInnerTemplate('odd sig', at, 0, 1, 'aa'.repeat(32)), getPublicKey(sk)), sig }
      const outer = finalizeEvent(await bagTemplate([inner as never], key, 'aa'.repeat(32), 12, 1, CHAT_BAG_KIND), sk)
      expect(await chatInners(outer, key)).toHaveLength(0)
    }
  })

  it('refuses a signed line whose signature does not hold', async () => {
    const sk = generateSecretKey()
    const signed = finalizeEvent(chatInnerTemplate('tampered', at, 0, 1, 'aa'.repeat(32)), sk)
    const inner = { ...signed, sig: '00'.repeat(64) }
    const outer = finalizeEvent(await bagTemplate([inner], key, 'aa'.repeat(32), 12, 1, CHAT_BAG_KIND), sk)
    expect(await chatInners(outer, key)).toHaveLength(0)
  })
})
