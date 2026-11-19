import { describe, expect, it, vi } from 'vitest'

/**
 * The bunker a restored session talks to, as a fake: what it was asked is
 * recorded, and it opens no socket, so no unit test touches the network
 * (this test used to open one to 127.0.0.1:9).
 */
const bunker = vi.hoisted(() => ({ built: 0, asked: [] as string[], holds: '', relays: [] as string[], pool: null as unknown }))

vi.mock('nostr-tools/nip46', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nostr-tools/nip46')>()
  const fake = {
    connect: async () => { bunker.asked.push('connect') },
    getPublicKey: async () => { bunker.asked.push('getPublicKey'); return bunker.holds },
    sendRequest: async (method: string) => { bunker.asked.push(method); return method === 'get_public_key' ? bunker.holds : '' },
    signEvent: async () => { bunker.asked.push('sign_event'); throw new Error('not in this test') },
    nip44Decrypt: async () => { bunker.asked.push('nip44_decrypt'); return '' },
    nip44Encrypt: async () => { bunker.asked.push('nip44_encrypt'); return '' },
    close: async () => undefined,
  }
  return {
    ...actual,
    BunkerSigner: {
      ...actual.BunkerSigner,
      fromBunker: (_sk: Uint8Array, bp: { relays: string[] }, params?: { pool?: unknown }) => { bunker.built++; bunker.relays = [...bp.relays]; bunker.pool = params?.pool; return fake },
      fromURI: actual.BunkerSigner.fromURI,
    },
  }
})

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

import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'
import {
  BACKUP_SIGNER_RELAY,
  DEFAULT_SIGNER_RELAY,
  loginCredentialKind,
  normalizeSignerRelay,
  signerRelays,
  withoutRetiredSignerRelays,
} from '../loginCredentials'

/**
 * signers, loaded the way the app loads it: the store first. signers imports
 * the relay layer, which imports the store, which imports signers; entered
 * from signers, that cycle reaches the store before signers has finished.
 */
async function signers(): Promise<typeof import('../signers')> {
  await import('../../store/useCyberspace')
  return import('../signers')
}

describe('login credential classification', () => {
  it('accepts every credential supported by the shared login field', () => {
    expect(loginCredentialKind('  nsec1secret ')).toBe('nsec')
    expect(loginCredentialKind('ncryptsec1encrypted')).toBe('ncryptsec')
    expect(loginCredentialKind('bunker://abc')).toBe('bunker')
  })

  it('does not guess for unsupported input', () => {
    expect(loginCredentialKind('npub1public')).toBeNull()
    expect(loginCredentialKind('')).toBeNull()
  })
})

describe('Nostr Connect session setup', () => {
  it('normalizes WebSocket relay URLs and rejects web URLs', () => {
    expect(normalizeSignerRelay(' wss://relay.onosendai.tech/ ')).toBe(DEFAULT_SIGNER_RELAY)
    expect(normalizeSignerRelay(' wss://bucket.coracle.social/ ')).toBe(BACKUP_SIGNER_RELAY)
    expect(normalizeSignerRelay('ws://localhost:7777/path/')).toBe('ws://localhost:7777/path')
    expect(() => normalizeSignerRelay('https://bucket.coracle.social')).toThrow(/wss:\/\//)
  })
})

describe('Nostr Connect relays', () => {
  it('allows unencrypted ws:// only on this machine', () => {
    expect(normalizeSignerRelay('ws://127.0.0.1:7777')).toBe('ws://127.0.0.1:7777')
    expect(() => normalizeSignerRelay('ws://relay.example.com')).toThrow(/localhost/)
  })

  it('puts a backup relay in the default QR, and only the chosen one otherwise', async () => {
    // ONOSENDAI's own relay first, then bucket.coracle.social.
    expect(DEFAULT_SIGNER_RELAY).toBe('wss://relay.onosendai.tech')
    expect(BACKUP_SIGNER_RELAY).toBe('wss://bucket.coracle.social')
    expect(signerRelays(DEFAULT_SIGNER_RELAY)).toEqual([DEFAULT_SIGNER_RELAY, BACKUP_SIGNER_RELAY])
    expect(signerRelays('wss://my.relay')).toEqual(['wss://my.relay'])
    const { createNostrConnectSession } = await signers()
    const relays = new URL(createNostrConnectSession().uri).searchParams.getAll('relay')
    expect(relays).toEqual([DEFAULT_SIGNER_RELAY, BACKUP_SIGNER_RELAY])
  })
})

describe('restoring a Nostr Connect session', () => {
  it('uses the pubkey saved at login and asks the signer nothing', async () => {
    const saved = getPublicKey(generateSecretKey())
    const remote = getPublicKey(generateSecretKey())
    bunker.built = 0
    bunker.asked = []
    const { signerFromPref } = await signers()
    const signer = await signerFromPref({
      kind: 'nip46',
      pubkey: saved,
      bunkerUri: `bunker://${remote}?relay=wss://relay.example`,
      clientNsec: nip19.nsecEncode(generateSecretKey()),
      nostrConnectSession: true,
    })
    expect(signer.pubkey).toBe(saved)
    expect(bunker.built).toBe(1)
    expect(bunker.asked).toEqual([])
    await signer.close?.()
  })

  it('asks which account the signer holds only when asked, and afresh each time', async () => {
    const saved = getPublicKey(generateSecretKey())
    const other = getPublicKey(generateSecretKey())
    bunker.asked = []
    bunker.holds = saved
    const { signerFromPref } = await signers()
    const signer = await signerFromPref({
      kind: 'nip46',
      pubkey: saved,
      bunkerUri: `bunker://${getPublicKey(generateSecretKey())}?relay=wss://relay.example`,
      clientNsec: nip19.nsecEncode(generateSecretKey()),
      nostrConnectSession: true,
    })
    expect(await signer.heldPubkey?.()).toBe(saved)
    // Switched in the signer app: the answer follows, never a cached one.
    bunker.holds = other
    expect(await signer.heldPubkey?.()).toBe(other)
    expect(bunker.asked).toEqual(['get_public_key', 'get_public_key'])
  })
})

/** The relay the default QR named as its backup until 2026-11-19; it no longer answers. */
const RETIRED = 'wss://relay.nsec.app'
const OLD_QR = 'wss://bucket.coracle.social'

describe('a saved session that names a retired signer relay', () => {
  it('drops the retired relay and keeps the others, the key and the secret', () => {
    const remote = getPublicKey(generateSecretKey())
    const uri = `bunker://${remote}?relay=${encodeURIComponent(OLD_QR)}&relay=${encodeURIComponent(RETIRED)}&secret=abc`
    const cleaned = withoutRetiredSignerRelays(uri)
    const url = new URL(cleaned)
    expect(url.host).toBe(remote)
    expect(url.searchParams.getAll('relay')).toEqual([OLD_QR])
    expect(url.searchParams.get('secret')).toBe('abc')
    // Any spelling of it: a trailing slash, upper case, unencoded, a trailing dot.
    expect(new URL(withoutRetiredSignerRelays(`bunker://${remote}?relay=wss://relay.example&relay=WSS://Relay.NSEC.app/`)).searchParams.getAll('relay')).toEqual(['wss://relay.example'])
    expect(new URL(withoutRetiredSignerRelays(`bunker://${remote}?relay=wss://relay.nsec.app.&relay=wss://relay.example`)).searchParams.getAll('relay')).toEqual(['wss://relay.example'])
  })

  it('leaves a URI alone when it names nothing retired, or nothing else', () => {
    const remote = getPublicKey(generateSecretKey())
    const fine = `bunker://${remote}?relay=wss://relay.example&relay=${OLD_QR}`
    expect(withoutRetiredSignerRelays(fine)).toBe(fine)
    // The signer listens only where the URI says: moving it would end the session.
    const only = `bunker://${remote}?relay=${RETIRED}`
    expect(withoutRetiredSignerRelays(only)).toBe(only)
    expect(withoutRetiredSignerRelays('not a uri')).toBe('not a uri')
    // With a path, nostr-tools would read no relays from the rewritten URI: left alone.
    const slashed = `bunker://${remote}/?relay=${RETIRED}&relay=wss://relay.example`
    expect(withoutRetiredSignerRelays(slashed)).toBe(slashed)
  })

  it('mends the saved preference on load, on disk too, and the session still signs without a new pairing', async () => {
    const saved = getPublicKey(generateSecretKey())
    const remote = getPublicKey(generateSecretKey())
    const clientNsec = nip19.nsecEncode(generateSecretKey())
    // What a QR login saved before 2026-11-19 (toBunkerURL encodes the relays).
    const old = new URL(`bunker://${remote}`)
    old.searchParams.append('relay', OLD_QR)
    old.searchParams.append('relay', RETIRED)
    localStorage.setItem('onosendai:signer', JSON.stringify({
      kind: 'nip46', pubkey: saved, bunkerUri: old.toString(), clientNsec, nostrConnectSession: true,
    }))

    const { loadSignerPref, signerFromPref } = await signers()
    const pref = loadSignerPref()
    expect(pref?.pubkey).toBe(saved)
    expect(pref?.clientNsec).toBe(clientNsec)
    expect(pref?.nostrConnectSession).toBe(true)
    expect(new URL(pref!.bunkerUri!).searchParams.getAll('relay')).toEqual([OLD_QR])
    expect(new URL(pref!.bunkerUri!).host).toBe(remote)
    const { parseBunkerInput } = await import('nostr-tools/nip46')
    expect((await parseBunkerInput(pref!.bunkerUri!))?.relays).toEqual([OLD_QR])
    const onDisk = JSON.parse(localStorage.getItem('onosendai:signer')!)
    expect(onDisk.bunkerUri).toBe(pref!.bunkerUri)

    bunker.built = 0
    bunker.asked = []
    bunker.relays = []
    const signer = await signerFromPref(pref!)
    expect(signer.pubkey).toBe(saved)
    expect(bunker.built).toBe(1)
    expect(bunker.relays).toEqual([OLD_QR])
    // Restored, not paired again: the signer is asked nothing.
    expect(bunker.asked).toEqual([])
    await signer.close?.()
  })

  it('leaves other saved logins as they are', async () => {
    const { loadSignerPref } = await signers()
    const pubkey = getPublicKey(generateSecretKey())
    const ext = JSON.stringify({ kind: 'nip07', pubkey })
    localStorage.setItem('onosendai:signer', ext)
    expect(loadSignerPref()).toEqual({ kind: 'nip07', pubkey })
    expect(localStorage.getItem('onosendai:signer')).toBe(ext)
    const lone = JSON.stringify({ kind: 'nip46', pubkey, bunkerUri: `bunker://${pubkey}?relay=${RETIRED}`, clientNsec: nip19.nsecEncode(generateSecretKey()) })
    localStorage.setItem('onosendai:signer', lone)
    expect(loadSignerPref()?.bunkerUri).toBe(`bunker://${pubkey}?relay=${RETIRED}`)
    expect(localStorage.getItem('onosendai:signer')).toBe(lone)
    localStorage.removeItem('onosendai:signer')
  })
})

describe('a bunker\'s sockets', () => {
  it('are its own: dropping them closes every bunker relay in the signer pool and none of the app\'s', async () => {
    const { dropSignerSockets } = await signers()
    const { getPool, getSignerPool } = await import('../relay')
    expect(getSignerPool()).not.toBe(getPool())
    const appClose = vi.spyOn(getPool(), 'close').mockImplementation(() => {})
    const signerClose = vi.spyOn(getSignerPool(), 'close').mockImplementation(() => {})
    try {
      dropSignerSockets([DEFAULT_SIGNER_RELAY, BACKUP_SIGNER_RELAY])
      expect(signerClose).toHaveBeenCalledWith([DEFAULT_SIGNER_RELAY, BACKUP_SIGNER_RELAY])
      expect(appClose).not.toHaveBeenCalled()
    } finally {
      appClose.mockRestore()
      signerClose.mockRestore()
    }
  })

  it('carry a restored session\'s traffic, and its reconnect drops both relays, so nostr-tools subscribes again on both', async () => {
    const { signerFromPref, createNostrConnectSession } = await signers()
    const { getPool, getSignerPool } = await import('../relay')
    // The relays a default QR names, as its saved session keeps them.
    const qrRelays = new URL(createNostrConnectSession().uri).searchParams.getAll('relay')
    const saved = new URL(`bunker://${getPublicKey(generateSecretKey())}`)
    for (const r of qrRelays) saved.searchParams.append('relay', r)
    const signer = await signerFromPref({
      kind: 'nip46',
      pubkey: getPublicKey(generateSecretKey()),
      bunkerUri: saved.toString(),
      clientNsec: nip19.nsecEncode(generateSecretKey()),
      nostrConnectSession: true,
    })
    // Its requests and answers go over the signer pool, never the app's.
    const appSub = vi.spyOn(getPool(), 'subscribe')
    const signerSub = vi.spyOn(getSignerPool(), 'subscribe').mockImplementation(() => ({ close: () => {} }) as never)
    try {
      const pool = bunker.pool as { subscribe: (r: string[], f: object, p: object) => unknown }
      pool.subscribe([DEFAULT_SIGNER_RELAY], { kinds: [24133] }, {})
      expect(signerSub).toHaveBeenCalledTimes(1)
      expect(appSub).not.toHaveBeenCalled()
    } finally {
      appSub.mockRestore()
      signerSub.mockRestore()
    }
    const appClose = vi.spyOn(getPool(), 'close').mockImplementation(() => {})
    const signerClose = vi.spyOn(getSignerPool(), 'close').mockImplementation(() => {})
    try {
      await signer.reconnect?.()
      expect(signerClose).toHaveBeenCalledWith([DEFAULT_SIGNER_RELAY, BACKUP_SIGNER_RELAY])
      expect(appClose).not.toHaveBeenCalled()
    } finally {
      appClose.mockRestore()
      signerClose.mockRestore()
      await signer.close?.()
    }
  })
})
