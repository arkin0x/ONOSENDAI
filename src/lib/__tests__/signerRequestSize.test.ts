import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// signers imports the relay layer, which imports the store, which reads
// localStorage as it loads; the test runs where there is none.
if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { generateSecretKey, getPublicKey, nip19, verifyEvent, type EventTemplate } from 'nostr-tools'
import { attributed } from '../client'
import { DEFAULT_SIGNER_RELAY } from '../loginCredentials'
import { NIP44_MAX_PLAINTEXT_BYTES, nip46PlaintextBytes, signerRequestTooBigMessage } from '../signerRequestSize'

/** signers, loaded the way the app loads it: the store first (see signers.test.ts). */
async function signers(): Promise<typeof import('../signers')> {
  await import('../../store/useCyberspace')
  return import('../signers')
}

/**
 * A restored Nostr Connect session on the real nostr-tools BunkerSigner, its
 * pool's sockets faked: every request it publishes is counted, and nothing
 * touches the network. Its answers never come; these tests only ask whether
 * a request went out.
 */
async function sessionSigner() {
  const { signerFromPref } = await signers()
  const { getSignerPool } = await import('../relay')
  const pool = getSignerPool()
  const published: unknown[] = []
  vi.spyOn(pool, 'subscribe').mockImplementation(((_relays: string[], _filter: unknown, params: { oneose?: () => void }) => {
    params?.oneose?.()
    return { close: () => {} }
  }) as never)
  vi.spyOn(pool, 'publish').mockImplementation(((_relays: string[], event: unknown) => {
    published.push(event)
    return [Promise.resolve('ok')]
  }) as never)
  const signer = await signerFromPref({
    kind: 'nip46',
    pubkey: getPublicKey(generateSecretKey()),
    bunkerUri: `bunker://${getPublicKey(generateSecretKey())}?relay=${encodeURIComponent(DEFAULT_SIGNER_RELAY)}`,
    clientNsec: nip19.nsecEncode(generateSecretKey()),
    nostrConnectSession: true,
  })
  return { signer, published }
}

/** Long enough for a request that does go out to be published (answersFirst waits on the subscription first). */
const settle = () => new Promise((r) => setTimeout(r, 20))

/**
 * A kind 33331 template whose sign_event request needs `target` bytes of
 * NIP-44 plaintext, give or take the request id (a few bytes, random in
 * length: nostr-tools' idPrefix). Its content is plain letters, which JSON
 * leaves as they are, so content length moves the size one for one.
 */
function sized(target: number): EventTemplate {
  const at = (n: number): EventTemplate => ({ kind: 33331, created_at: 1_700_000_000, tags: [['d', 'big-shard']], content: 'a'.repeat(n) })
  const bytes = (n: number) => nip46PlaintextBytes('sign_event', [JSON.stringify(attributed(at(n)))], 'abcdef-1')
  return at(target - bytes(0))
}

// The store's first import is slow under a full parallel run; taken once here, so no test spends its own time on it.
beforeAll(async () => { await signers() }, 60_000)

afterEach(() => { vi.restoreAllMocks() })

/** The big-request question open now, once it has had a moment to open. */
async function question() {
  const { useBigRequestQuestion } = await import('../signerRequestSize')
  await settle()
  return useBigRequestQuestion.getState().question
}

describe('a remote signer request past 65,535 bytes (arkinox, 2026-11-22: "what if we\'re wrong?")', () => {
  it('is asked about first, and TRY ANYWAY sends it as before', async () => {
    const { signer, published } = await sessionSigner()
    try {
      // The owner's big shard, hidden by reference: about 71,800 bytes of object.
      void signer.signEvent(sized(71_800)).catch(() => undefined)
      const asked = await question()
      expect(published).toHaveLength(0)
      expect(asked).not.toBeNull()
      expect(asked!.words).toMatch(/^This is bigger than some signer apps can read \(about 65 KB, this needs 7\d KB\)\. TRY ANYWAY, or make the shard smaller\.$/)
      expect(asked!.words).not.toContain('\u2014')
      asked!.answer(true)
      await settle()
      expect(published).toHaveLength(1)
      expect(await question()).toBeNull()
    } finally {
      await signer.close?.()
    }
  })

  it("DON'T SEND sends nothing, and fails in words that name the sizes and what to do", async () => {
    const { signingFailed } = await import('../signWithin')
    const { signer, published } = await sessionSigner()
    try {
      const failing = signer.signEvent(sized(71_800)).then(() => null, (e: unknown) => e)
      ;(await question())!.answer(false)
      const err = await failing
      await settle()
      expect(published).toHaveLength(0)
      expect((err as Error).name).toBe('SignerRequestTooBig')
      expect((err as { reason?: unknown }).reason).toBe('declined')
      expect((err as Error).message).toMatch(/^Not sent: this is bigger than some signer apps can read \(about 65 KB, this needs 7\d KB\)\. Make the shard smaller, or sign in with a key on this device\.$/)
      expect(signingFailed(err, 'nip46')).toBe((err as Error).message)
    } finally {
      await signer.close?.()
    }
  })

  it('goes out without a question when it is just under 65,535 bytes', async () => {
    const { signer, published } = await sessionSigner()
    try {
      // The answer is unasked for here: the signature is left waiting, and only its request counted.
      void signer.signEvent(sized(NIP44_MAX_PLAINTEXT_BYTES - 40)).catch(() => undefined)
      expect(await question()).toBeNull()
      expect(published).toHaveLength(1)
    } finally {
      await signer.close?.()
    }
  })

  it('covers a seal and an open too: every NIP-46 method goes through the one guard', async () => {
    const { signer, published } = await sessionSigner()
    const them = getPublicKey(generateSecretKey())
    try {
      void signer.nip44Encrypt!(them, 'a'.repeat(60_000)).catch(() => undefined)
      const sealing = await question()
      expect(sealing!.words).toMatch(/^This is bigger than some signer apps can read .*TRY ANYWAY, or make it smaller\.$/)
      sealing!.answer(false)
      void signer.nip44Decrypt!(them, 'A'.repeat(70_000)).catch(() => undefined)
      const opening = await question()
      expect(opening!.words).toMatch(/^This is bigger than some signer apps can read .*TRY ANYWAY, or sign in with a key on this device to open it\.$/)
      opening!.answer(true)
      await settle()
      expect(published).toHaveLength(1)
    } finally {
      await signer.close?.()
    }
  })
})

describe('a timeout and a big request', () => {
  it('is said to be about the size only for the signer session the big request went to', async () => {
    const { signWithin, noteBigAsk, bigSilence } = await import('../signWithin')
    const never = () => new Promise<never>(() => {})
    const settledA = noteBigAsk('session-a', 'the shard')
    try {
      // A big request to session A went out before this began: not this signature's.
      await new Promise((r) => setTimeout(r, 5))
      const late = await signWithin({ signEvent: never, session: 'session-a' }, { kind: 1, created_at: 1, tags: [], content: '' }, 30).catch((e: unknown) => e)
      expect(bigSilence(late)).toBeNull()
      const sigA = signWithin({ signEvent: never, session: 'session-a' }, { kind: 1, created_at: 1, tags: [], content: '' }, 30).catch((e: unknown) => e)
      const sigB = signWithin({ signEvent: never, session: 'session-b' }, { kind: 1, created_at: 1, tags: [], content: '' }, 30).catch((e: unknown) => e)
      const settledA2 = noteBigAsk('session-a', 'the shard')
      expect(bigSilence(await sigA)).toBe('the shard')
      expect(bigSilence(await sigB)).toBeNull()
      settledA2()
    } finally {
      settledA()
    }
  })
})

describe('the hard caps, unchanged', () => {
  it('a request past what the signer relay carries in one kind 24133 event (512 KB) is refused at once, never asked about', async () => {
    const { signer, published } = await sessionSigner()
    try {
      const err = await signer.signEvent(sized(400_000)).then(() => null, (e: unknown) => e)
      expect(await question()).toBeNull()
      expect(published).toHaveLength(0)
      expect((err as Error).name).toBe('SignerRequestTooBig')
      expect((err as { reason?: unknown }).reason).toBe('relay')
      expect((err as Error).message).toMatch(/^This is too big to send to a signer app \(its relay takes up to 512 KB, this needs \d+ KB\)\. Make the shard smaller, or sign in with a key on this device\.$/)
    } finally {
      await signer.close?.()
    }
  })

  it('the relay cap is 524,288 bytes, and a request to sign the largest bag (240,000 B) fits under it', async () => {
    const { SIGNER_RELAY_EVENT_BYTES, nip46EventBytes } = await import('../signerRequestSize')
    const { BAG_SAFE_BYTES, bagSizeRefusal, signedBytes } = await import('../bagSize')
    expect(SIGNER_RELAY_EVENT_BYTES).toBe(524_288)
    expect(BAG_SAFE_BYTES).toBe(240_000)
    expect(bagSizeRefusal(240_000)).toBeNull()
    expect(bagSizeRefusal(240_001)).toMatch(/^Too large for one bag: 240,001 of 240,000 bytes\. Nothing was sent\.$/)
    // The largest bag, as a sign_event request and its answer.
    const bag = { kind: 33333, created_at: 1, tags: [['d', 'bag']], content: '' }
    bag.content = 'a'.repeat(BAG_SAFE_BYTES - signedBytes(bag))
    const bytes = nip46PlaintextBytes('sign_event', [JSON.stringify(attributed(bag))], 'abcdef-1')
    expect(bytes).toBeGreaterThan(NIP44_MAX_PLAINTEXT_BYTES)
    expect(nip46EventBytes(bytes)).toBeLessThanOrEqual(SIGNER_RELAY_EVENT_BYTES)
  })

  it('an event past 65,535 bytes is measured with the extended prefix nostr-tools writes', async () => {
    const { nip46EventBytes } = await import('../signerRequestSize')
    const { v2: nip44 } = await import('nostr-tools/nip44')
    const key = nip44.utils.getConversationKey(generateSecretKey(), getPublicKey(generateSecretKey()))
    for (const n of [100, 65_535, 65_536, 200_000]) {
      const payload = nip44.encrypt('a'.repeat(n), key)
      expect(nip46EventBytes(n) - payload.length).toBe(512)
    }
  })
})

describe('the size a request needs', () => {
  it('is its own JSON when that is the longer', () => {
    const params = ['ab', 'cd']
    expect(nip46PlaintextBytes('nip44_decrypt', params, 'x-1')).toBe(JSON.stringify({ id: 'x-1', method: 'nip44_decrypt', params }).length)
  })

  it('is the answer when that is the longer: a signed event carries id, pubkey and sig on top', () => {
    const event = JSON.stringify({ kind: 1, created_at: 1, tags: [], content: 'a'.repeat(1000) })
    const request = JSON.stringify({ id: 'x-1', method: 'sign_event', params: [event] }).length
    expect(nip46PlaintextBytes('sign_event', [event], 'x-1')).toBeGreaterThan(request + 200)
  })

  it('counts bytes, not characters', () => {
    const ascii = nip46PlaintextBytes('nip44_decrypt', ['', 'a'], 'x-1')
    expect(nip46PlaintextBytes('nip44_decrypt', ['', 'é'], 'x-1')).toBe(ascii + 1)
  })

  it('names the noun only for a shard', () => {
    const note = JSON.stringify({ kind: 30078, created_at: 1, tags: [], content: '' })
    expect(signerRequestTooBigMessage('sign_event', [note], 80_000, 'declined')).toContain('Make it smaller')
    const shard = JSON.stringify({ kind: 33331, created_at: 1, tags: [], content: '' })
    expect(signerRequestTooBigMessage('sign_event', [shard], 80_000, 'declined')).toContain('Make the shard smaller')
  })
})

describe('a key on this device', () => {
  it('signs an event far past the limit, as before, and is never asked about it', async () => {
    const { localSigner } = await signers()
    const sk = generateSecretKey()
    const signed = await localSigner(sk).signEvent({ kind: 33331, created_at: 1, tags: [], content: 'a'.repeat(200_000) })
    expect(verifyEvent(signed)).toBe(true)
    expect(signed.pubkey).toBe(getPublicKey(sk))
    expect(await question()).toBeNull()
  })
})
