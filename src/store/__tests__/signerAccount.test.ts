/**
 * signerAccount.test.ts - a remote signer on another account is refused, on
 * every path that signs, and is never taken for a payload that does not open
 * (found porting the store to snocrash, review of snocrash #37).
 *
 * What went wrong: a remote signer signs as whichever account it holds now.
 * An extension or a bunker switched to account B mid-visit, or a Nostr
 * Connect session restored on reload (never asked which account it holds),
 * answered identity A's requests as B. B's signature checks out against B's
 * own pubkey, so the store took it: hops went onto A's chain signed by B, a
 * relay's NIP-42 AUTH told the relay this visit was B, and a private message
 * sealed to A failed to open and was kept as unopenable for good.
 *
 * No network: the extension is a fake, and a WebSocket opened by mistake
 * throws.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { storage } = vi.hoisted(() => {
  const m = new Map<string, string>()
  const storage: Storage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
  }
  ;(globalThis as { localStorage?: Storage }).localStorage = storage
  // Nothing here may reach a relay: a socket opened by mistake fails the test.
  ;(globalThis as { WebSocket?: unknown }).WebSocket = class {
    constructor() { throw new Error('a unit test opened a WebSocket') }
  }
  return { storage }
})

vi.mock('../../lib/workers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/workers')>()
  return { ...actual, postProof: vi.fn(), cancelProof: vi.fn() }
})

vi.mock('../../lib/chains', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/chains')>()
  return { ...actual, fetchChainEvents: vi.fn(async () => []), confirmChainEvents: vi.fn(async () => []) }
})

/**
 * The extension: logged in here as account A, and holding whichever account
 * `holding` names now, as a real one does once switched. It signs and
 * decrypts as that account and, asked, names it; `silent` makes it refuse to
 * say. Fixed keys, so they survive the module resets each boot does.
 */
const ext = vi.hoisted(() => ({
  holding: 'a' as 'a' | 'b',
  silent: false,
  keys: {
    a: Uint8Array.from({ length: 32 }, (_, i) => i + 1),
    b: Uint8Array.from({ length: 32 }, (_, i) => 64 - i),
  },
}))

vi.mock('../../lib/signers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/signers')>()
  const { finalizeEvent, getPublicKey } = await import('nostr-tools/pure')
  const { v2: nip44 } = await import('nostr-tools/nip44')
  const held = (): Uint8Array => ext.keys[ext.holding]
  const fake = {
    kind: 'nip07' as const,
    pubkey: getPublicKey(ext.keys.a),
    // A real extension answers with plain JSON.
    signEvent: async (t: Parameters<typeof finalizeEvent>[0]) => JSON.parse(JSON.stringify(finalizeEvent(t, held()))) as ReturnType<typeof finalizeEvent>,
    nip44Decrypt: async (pk: string, ct: string) => nip44.decrypt(ct, nip44.utils.getConversationKey(held(), pk)),
    nip44Encrypt: async (pk: string, pt: string) => nip44.encrypt(pt, nip44.utils.getConversationKey(held(), pk)),
    heldPubkey: async () => {
      if (ext.silent) throw new Error('the extension would not say')
      return getPublicKey(held())
    },
  }
  return {
    ...actual,
    nip07Signer: async () => fake,
    signerFromPref: async () => fake,
    deferredReconnect: (pref: { kind: 'nip07'; pubkey: string }) => ({ ...fake, kind: pref.kind, pubkey: pref.pubkey, reconnect: async () => fake }),
  }
})

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { v2 as nip44 } from 'nostr-tools/nip44'
import { spawnTemplate, type EventTemplate, type NostrEvent } from '../../lib/events'

const pkA = getPublicKey(ext.keys.a)
const spawnA = JSON.parse(JSON.stringify(finalizeEvent(spawnTemplate(pkA, 1_000), ext.keys.a))) as NostrEvent

/**
 * A page load with the extension remembered as account A and A's chain
 * saved. Storage is seeded before the store is imported, which reads it as
 * it loads, and the store is imported before anything that reaches signers.
 */
async function boot(): Promise<{
  S: typeof import('../useCyberspace')['useCyberspace']['getState']
  toast: typeof import('../useToast')['useToast']['getState']
  getPool: typeof import('../../lib/relay')['getPool']
}> {
  storage.clear()
  storage.setItem('onosendai:signer', JSON.stringify({ kind: 'nip07', pubkey: pkA }))
  storage.setItem(`onosendai:chain:${pkA}`, JSON.stringify({ version: 2, events: [spawnA], published: [spawnA.id], stats: {} }))
  vi.resetModules()
  const { useCyberspace } = await import('../useCyberspace')
  const { useToast } = await import('../useToast')
  const { getPool } = await import('../../lib/relay')
  return { S: useCyberspace.getState, toast: useToast.getState, getPool }
}

const note = (): EventTemplate => ({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'hello' })
const OTHER = /different account/

/** The pool's NIP-42 AUTH signer for `url`, exactly as the pool asks for it when a relay challenges. */
function authSignerOf(pool: unknown, url: string): (t: EventTemplate) => Promise<NostrEvent> {
  const hook = (pool as { automaticallyAuth?: (relay: string) => (t: EventTemplate) => Promise<NostrEvent> }).automaticallyAuth
  if (!hook) throw new Error('the pool answers no AUTH challenge')
  return hook(url)
}

const authTemplate = (url: string): EventTemplate => ({ kind: 22242, created_at: Math.floor(Date.now() / 1000), tags: [['relay', url], ['challenge', 'c1']], content: '' })

beforeEach(() => {
  ext.holding = 'a'
  ext.silent = false
})

describe('a remote signer on another account is refused', () => {
  it('signs as this identity while it holds this identity', async () => {
    const { S } = await boot()
    expect(S().identity.pubkey).toBe(pkA)
    const signed = await S().signEvent(note())
    expect(signed.pubkey).toBe(pkA)
  })

  it('refuses an event to publish signed by another account, though its signature checks out', async () => {
    const { S } = await boot()
    ext.holding = 'b'
    await expect(S().signEvent(note())).rejects.toThrow(OTHER)
  })

  it('refuses a relay\'s NIP-42 AUTH signed by another account, so the relay is never told this visit is someone else', async () => {
    const { S, getPool } = await boot()
    const url = 'wss://relay.example'
    const sign = authSignerOf(getPool(), url)
    const ok = await sign(authTemplate(url))
    expect(ok.pubkey).toBe(S().identity.pubkey)
    ext.holding = 'b'
    await expect(sign(authTemplate(url))).rejects.toThrow(OTHER)
  })

  it('says so once, in a toast, however many signatures are refused, and again after the signer came back and left', async () => {
    const { S, toast } = await boot()
    ext.holding = 'b'
    await expect(S().signEvent(note())).rejects.toThrow(OTHER)
    expect(toast().toast).toMatchObject({ mark: 'signer', label: 'SIGNER ON ANOTHER ACCOUNT' })
    toast().dismiss()
    await expect(S().signEvent(note())).rejects.toThrow(OTHER)
    expect(toast().toast).toBeNull()
    // Switched back: it signs, and the next switch away is said again.
    ext.holding = 'a'
    await S().signEvent(note())
    ext.holding = 'b'
    await expect(S().signEvent(note())).rejects.toThrow(OTHER)
    expect(toast().toast?.mark).toBe('signer')
  })
})

describe('a decrypt under another account is not taken for a payload that does not open', () => {
  /** A payload sealed to A by a one-time key, as a chest or a gift wrap is. */
  function sealedToA(text: string): { sender: string; payload: string } {
    const sk = generateSecretKey()
    return { sender: getPublicKey(sk), payload: nip44.encrypt(text, nip44.utils.getConversationKey(sk, pkA)) }
  }

  it('opens while the signer holds this identity', async () => {
    const { S } = await boot()
    const { sender, payload } = sealedToA('inside')
    expect(await S().decryptSealed(sender, payload)).toBe('inside')
  })

  it('says the signer is on another account when it is, rather than that the payload does not open', async () => {
    const { S, toast } = await boot()
    const { signerCannotJudge } = await import('../../lib/signers')
    const { sender, payload } = sealedToA('inside')
    ext.holding = 'b'
    const err = await S().decryptSealed(sender, payload).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(OTHER)
    expect(signerCannotJudge(err)).toBe(true)
    expect(toast().toast?.mark).toBe('signer')
  })

  it('leaves it undecided when the signer will not say which account it holds', async () => {
    const { S } = await boot()
    const { signerCannotJudge, SignerUnconfirmed } = await import('../../lib/signers')
    const { sender, payload } = sealedToA('inside')
    ext.holding = 'b'
    ext.silent = true
    const err = await S().decryptSealed(sender, payload).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SignerUnconfirmed)
    expect(signerCannotJudge(err)).toBe(true)
  })

  it('still calls a payload that truly does not open just that, when the signer holds this identity', async () => {
    const { S } = await boot()
    const { signerCannotJudge } = await import('../../lib/signers')
    const { sender } = sealedToA('inside')
    const { payload: notForA } = sealedToA('other')
    // Sealed to A, but opened as from the wrong sender: it does not open for anyone.
    const err = await S().decryptSealed(sender, notForA).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(signerCannotJudge(err)).toBe(false)
  })

  it('once the signer is back, a payload that truly does not open is not blamed on it, though "another account" was its answer moments ago', async () => {
    const { S, toast } = await boot()
    const { signerCannotJudge } = await import('../../lib/signers')
    const { sender, payload } = sealedToA('inside')
    ext.holding = 'b'
    expect(signerCannotJudge(await S().decryptSealed(sender, payload).catch((e: unknown) => e))).toBe(true)
    // Switched back within the window that answer is kept for: a payload
    // sealed to A opens, which proves it, and the notice goes.
    ext.holding = 'a'
    expect(await S().decryptSealed(sender, payload)).toBe('inside')
    expect(toast().toast).toBeNull()
    const { payload: notForA } = sealedToA('other')
    const err = await S().decryptSealed(sender, notForA).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(signerCannotJudge(err)).toBe(false)
    expect(toast().toast).toBeNull()
  })
})

describe('a private message that arrives while the signer is on another account', () => {
  let dms: typeof import('../useAgentDms')
  let mem: Map<string, string>
  let saved: { transport: unknown; keys: unknown; storage: unknown }

  afterEach(() => {
    dms.resetAgentDms()
    Object.assign(dms.dmDeps, saved)
  })

  it('is not kept as unopenable: once the signer is switched back, the same message opens', async () => {
    const { S } = await boot()
    dms = await import('../useAgentDms')
    const { wrapMessage } = await import('../../lib/dm')
    const { localSigner } = await import('../../lib/signers')
    saved = { transport: dms.dmDeps.transport, keys: dms.dmDeps.keys, storage: dms.dmDeps.storage }

    const agentSigner = localSigner(generateSecretKey())
    const agent = { pubkey: agentSigner.pubkey, signEvent: agentSigner.signEvent, nip44Encrypt: agentSigner.nip44Encrypt! }
    const fresh = (): typeof agent => { const s = localSigner(generateSecretKey()); return { pubkey: s.pubkey, signEvent: s.signEvent, nip44Encrypt: s.nip44Encrypt! } }

    const subs: Array<{ since?: number; deliver: (ev: NostrEvent) => void; eose: () => void; closed: boolean }> = []
    mem = new Map()
    dms.dmDeps.transport = {
      inboxOf: async () => ({ relays: ['wss://inbox.example'], answered: true }),
      subscribe: (_relay, filter, onEvent, _onClose, onEose) => {
        const sub = { since: (filter as { since?: number }).since, deliver: onEvent, eose: () => onEose?.(), closed: false }
        subs.push(sub)
        return () => { sub.closed = true }
      },
      publish: async () => ({ ok: true }),
      onResume: () => () => undefined,
    }
    dms.dmDeps.storage = { get: (k) => mem.get(k) ?? null, set: (k, v) => { mem.set(k, v) } }
    // The real keys, so the message is opened through the store's signer;
    // only who my agents are is stood in.
    dms.dmDeps.keys = { ...dms.dmDeps.keys, agents: () => [agent.pubkey], promptFree: () => true }
    dms.resetAgentDms()

    const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 30))
    const stop = dms.watchAgentDms(S().identity.pubkey)
    await settle()
    const live = (): typeof subs => subs.filter((s) => !s.closed && s.since !== undefined)
    for (const sub of live()) sub.eose()
    expect(live()).toHaveLength(1)

    const wrap = (await wrapMessage(agent, pkA, 'Arrived at the stop.', fresh, { now: Math.floor(Date.now() / 1000) + 60 })).toRecipient

    ext.holding = 'b'
    live()[0].deliver(wrap)
    await settle()
    expect(dms.useAgentDms.getState().unread[agent.pubkey]).toBeUndefined()
    const record = JSON.parse(mem.get(dms.WATCH_KEY(pkA)) ?? '{"watched":{}}') as { watched: Record<string, number> }
    expect(record.watched[wrap.id]).toBeUndefined()

    // Switched back, the relay sends it again (the next session, or a resubscribe): it opens.
    ext.holding = 'a'
    live()[0].deliver(wrap)
    await settle()
    expect(dms.useAgentDms.getState().unread[agent.pubkey]?.ids).toHaveLength(1)
    stop()
  })
})
