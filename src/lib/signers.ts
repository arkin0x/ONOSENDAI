/**
 * signers.ts — who holds the key.
 *
 * Cyberspace signs a lot: every hop, every hidden thing, every relay auth. The
 * key doing it can be a local secret (a random one, or an nsec/ncryptsec you
 * bring), a browser extension (NIP-07), or a remote bunker (NIP-46). They only
 * differ in how signEvent works and whether the pubkey is known at once, so
 * the rest of the app talks to this one shape and awaits every signature.
 *
 * Local signing is synchronous under the hood, wrapped in a resolved promise,
 * so the common path costs nothing; extension and bunker are genuinely async.
 */

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import * as nip46 from 'nostr-tools/nip46'
import * as nip49 from 'nostr-tools/nip49'
import { getPool } from './relay'
import type { EventTemplate, NostrEvent } from './events'
import { DEFAULT_SIGNER_RELAY, normalizeSignerRelay, signerRelays } from './loginCredentials'
export { BACKUP_SIGNER_RELAY, DEFAULT_SIGNER_RELAY, loginCredentialKind, normalizeSignerRelay, signerRelays } from './loginCredentials'

export type SignerKind = 'local' | 'nip07' | 'nip46'
export { SIGN_PATIENCE_MS, SignerTimeout, signWithin } from './signWithin'

export interface Signer {
  kind: SignerKind
  pubkey: string
  signEvent: (template: EventTemplate) => Promise<NostrEvent>
  /** Present only for local signers, so the key can be persisted. */
  secretKey?: Uint8Array
  /** For a bunker: what to persist to reconnect it. */
  bunkerUri?: string
  clientSecretKey?: Uint8Array
  /** A client-initiated Nostr Connect session does not repeat the bunker connect handshake. */
  nostrConnectSession?: boolean
  close?: () => Promise<void>
  /** For a deferred signer: force the reconnection and return the real one. */
  reconnect?: () => Promise<Signer>
}

/** The browser extension, if one is installed. */
interface WindowNostr {
  getPublicKey(): Promise<string>
  signEvent(event: EventTemplate): Promise<NostrEvent>
}
function windowNostr(): WindowNostr | null {
  return (window as unknown as { nostr?: WindowNostr }).nostr ?? null
}
export function hasNip07(): boolean {
  return typeof window !== 'undefined' && !!windowNostr()
}

/** A local key: the default random one, or one you brought. */
export function localSigner(secretKey: Uint8Array): Signer {
  const pubkey = getPublicKey(secretKey)
  return {
    kind: 'local',
    pubkey,
    secretKey,
    signEvent: (template) => Promise.resolve(finalizeEvent(template, secretKey) as unknown as NostrEvent),
  }
}

/** A fresh random local key. */
export function randomSigner(): Signer {
  return localSigner(generateSecretKey())
}

/** An nsec you paste. Throws a readable error if it is not a valid nsec. */
export function signerFromNsec(nsec: string): Signer {
  let decoded
  try {
    decoded = nip19.decode(nsec.trim())
  } catch {
    throw new Error('That is not a valid nsec. Check you copied the whole key.')
  }
  if (decoded.type !== 'nsec') throw new Error(`Expected an nsec, got ${decoded.type}.`)
  return localSigner(decoded.data)
}

/** An ncryptsec (NIP-49) plus its password. Throws a readable error if either is wrong. */
export function signerFromNcryptsec(ncryptsec: string, password: string): Signer {
  let sk
  try {
    sk = nip49.decrypt(ncryptsec.trim(), password)
  } catch {
    throw new Error('Could not decrypt. Wrong password, or not a valid ncryptsec.')
  }
  return localSigner(sk)
}

/** The browser extension. Throws if none is present or it refuses. */
export async function nip07Signer(): Promise<Signer> {
  const ext = windowNostr()
  if (!ext) throw new Error('No NIP-07 extension found')
  const pubkey = await ext.getPublicKey()
  return {
    kind: 'nip07',
    pubkey,
    signEvent: (template) => ext.signEvent(template),
  }
}

/**
 * A remote bunker (NIP-46). Takes a `bunker://…` URI (or a nostrconnect one),
 * and an optional client secret key so a reconnect keeps the same client
 * identity. Connects, learns the remote pubkey, and signs through it.
 */
export async function nip46Signer(bunkerUri: string, clientSecretKey?: Uint8Array): Promise<Signer> {
  const clientSk = clientSecretKey ?? generateSecretKey()
  const bp = await nip46.parseBunkerInput(bunkerUri.trim())
  if (!bp) throw new Error('Not a valid bunker URI')
  const bunker = nip46.BunkerSigner.fromBunker(clientSk, bp, { pool: getPool() as never })
  await bunker.connect()
  const pubkey = await bunker.getPublicKey()
  const signer: Signer = {
    kind: 'nip46',
    pubkey,
    bunkerUri,
    clientSecretKey: clientSk,
    signEvent: (template) => bunker.signEvent(template) as unknown as Promise<NostrEvent>,
    close: () => bunker.close(),
    // A phone that suspends the tab leaves its relay sockets half-open: the
    // browser still calls them connected, so the pool reuses them and a
    // request goes into the void, to be answered never or to fail with
    // "All promises were rejected". Closing the bunker's relays in the pool
    // drops those sockets; the same signer opens fresh ones on its next
    // request (nostr-tools re-subscribes when its subscription is gone), so
    // nothing is rebuilt and the bunker sees no new connect handshake.
    reconnect: async () => {
      getPool().close([...bp.relays])
      return signer
    },
  }
  return signer
}

function randomHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const PUBLIC_KEY_WAIT_MS = 30_000

async function waitForPublicKey(bunker: nip46.BunkerSigner, signal?: AbortSignal): Promise<string> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  let abort: (() => void) | undefined
  const stopped = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error('Signer connected but did not return its public key. Try the QR flow again.')), PUBLIC_KEY_WAIT_MS)
    if (signal) {
      abort = (): void => reject(new DOMException('Nostr Connect login cancelled.', 'AbortError'))
      signal.addEventListener('abort', abort, { once: true })
    }
  })
  try {
    return await Promise.race([bunker.getPublicKey(), stopped])
  } finally {
    if (timeout) clearTimeout(timeout)
    if (signal && abort) signal.removeEventListener('abort', abort)
  }
}

function wrapBunkerSigner(
  bunker: nip46.BunkerSigner,
  clientSecretKey: Uint8Array,
  pubkey: string,
  bunkerUri: string,
  nostrConnectSession = false,
): Signer {
  const signer: Signer = {
    kind: 'nip46',
    pubkey,
    bunkerUri,
    clientSecretKey,
    nostrConnectSession,
    signEvent: (template) => bunker.signEvent(template) as unknown as Promise<NostrEvent>,
    close: () => bunker.close(),
    reconnect: async () => {
      const bp = await nip46.parseBunkerInput(bunkerUri)
      if (bp) getPool().close([...bp.relays])
      return signer
    },
  }
  return signer
}

/** A QR login is created synchronously so its URI can be painted while connection waits. */
export interface NostrConnectSession {
  uri: string
  relay: string
  connect: (signal?: AbortSignal, onConnected?: () => void) => Promise<Signer>
}

export function createNostrConnectSession(relayInput = DEFAULT_SIGNER_RELAY): NostrConnectSession {
  const relay = normalizeSignerRelay(relayInput)
  const clientSecretKey = generateSecretKey()
  const uri = nip46.createNostrConnectURI({
    clientPubkey: getPublicKey(clientSecretKey),
    relays: signerRelays(relay),
    secret: randomHex(generateSecretKey()),
    perms: ['get_public_key', 'sign_event'],
    name: 'ONOSENDAI',
    ...(typeof location !== 'undefined' ? { url: location.origin } : {}),
  })

  return {
    uri,
    relay,
    connect: async (signal, onConnected) => {
      const bunker = await nip46.BunkerSigner.fromURI(
        clientSecretKey,
        uri,
        // Keep the whole login handshake on the relays encoded in the QR.
        // Automatic switch_relays interoperability varies between signers and
        // can strand the get_public_key response on a relay we never selected;
        // the QR names two relays by default so neither is a single point.
        { pool: getPool() as never, skipSwitchRelays: true },
        signal ?? 300_000,
      )
      onConnected?.()
      let pubkey: string
      try { pubkey = await waitForPublicKey(bunker, signal) }
      catch (err) {
        await bunker.close()
        throw err
      }
      // The approved client key is the durable session identity. Rebuild from
      // the remote key and relay on reload; do not replay the one-time QR secret.
      const sessionUri = nip46.toBunkerURL({ ...bunker.bp, secret: null })
      return wrapBunkerSigner(bunker, clientSecretKey, pubkey, sessionUri, true)
    },
  }
}

/**
 * Restore a previously approved client-initiated Nostr Connect session.
 *
 * The pubkey is the one saved at login, not asked for again: asking on every
 * reload needs the signer app awake before anything can sign, with no bound on
 * the wait, and an answer naming another account (the app switched accounts)
 * would put a different key behind the chain on screen.
 */
async function nostrConnectSessionSigner(bunkerUri: string, clientSecretKey: Uint8Array, pubkey: string): Promise<Signer> {
  const bp = await nip46.parseBunkerInput(bunkerUri)
  if (!bp) throw new Error('The saved Nostr Connect session is invalid.')
  const bunker = nip46.BunkerSigner.fromBunker(clientSecretKey, bp, { pool: getPool() as never })
  return wrapBunkerSigner(bunker, clientSecretKey, pubkey, bunkerUri, true)
}

/** What we persist to bring a signer back on reload. */
export interface SignerPref {
  kind: SignerKind
  pubkey: string
  /** local only. */
  nsec?: string
  /** nip46 only. */
  bunkerUri?: string
  clientNsec?: string
  nostrConnectSession?: boolean
}

export function prefOf(signer: Signer): SignerPref {
  const base: SignerPref = { kind: signer.kind, pubkey: signer.pubkey }
  if (signer.kind === 'local' && signer.secretKey) base.nsec = nip19.nsecEncode(signer.secretKey)
  if (signer.kind === 'nip46') {
    base.bunkerUri = signer.bunkerUri
    if (signer.clientSecretKey) base.clientNsec = nip19.nsecEncode(signer.clientSecretKey)
    if (signer.nostrConnectSession) base.nostrConnectSession = true
  }
  return base
}

/** Rebuild a signer from a persisted preference. Local is instant; the others reconnect. */
export async function signerFromPref(pref: SignerPref): Promise<Signer> {
  if (pref.kind === 'local' && pref.nsec) return signerFromNsec(pref.nsec)
  if (pref.kind === 'nip07') return nip07Signer()
  if (pref.kind === 'nip46' && pref.bunkerUri) {
    const clientSk = pref.clientNsec ? (nip19.decode(pref.clientNsec).data as Uint8Array) : undefined
    if (pref.nostrConnectSession && clientSk) return nostrConnectSessionSigner(pref.bunkerUri, clientSk, pref.pubkey)
    // A bunker still does its handshake, and answers with the account it holds
    // now. Refuse one that is not the account saved here: signing as it would
    // continue this pubkey's chain under another key.
    const signer = await nip46Signer(pref.bunkerUri, clientSk)
    if (signer.pubkey !== pref.pubkey) {
      await signer.close?.()
      throw new Error('Your signer is now on a different account than the one logged in here. Switch it back, or log in again.')
    }
    return signer
  }
  throw new Error('Unusable signer preference')
}

/** Where the signer preference lives across reloads. */
const PREF_KEY = 'onosendai:signer'

export function loadSignerPref(): SignerPref | null {
  try {
    const raw = localStorage.getItem(PREF_KEY)
    return raw ? (JSON.parse(raw) as SignerPref) : null
  } catch {
    return null
  }
}

export function saveSignerPref(pref: SignerPref): void {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(pref))
  } catch {
    /* private mode, quota: the session still works, it just will not persist. */
  }
}

/**
 * A signer for an extension/bunker identity we already know the pubkey of but
 * have not reconnected yet. Its pubkey is available at once so the chain loads;
 * the first signature (or an explicit reconnect()) does the real handshake,
 * memoised, and hands the live signer to onReady so the store can swap it in.
 */
export function deferredReconnect(pref: SignerPref, onReady: (s: Signer) => void): Signer {
  let pending: Promise<Signer> | null = null
  const ensure = (): Promise<Signer> => {
    if (!pending) pending = signerFromPref(pref).then((s) => { onReady(s); return s })
    return pending
  }
  return {
    kind: pref.kind,
    pubkey: pref.pubkey,
    signEvent: (template) => ensure().then((s) => s.signEvent(template)),
    reconnect: ensure,
  }
}
