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

export type SignerKind = 'local' | 'nip07' | 'nip46'

export interface Signer {
  kind: SignerKind
  pubkey: string
  signEvent: (template: EventTemplate) => Promise<NostrEvent>
  /** Present only for local signers, so the key can be persisted. */
  secretKey?: Uint8Array
  /** For a bunker: what to persist to reconnect it. */
  bunkerUri?: string
  clientSecretKey?: Uint8Array
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
  return {
    kind: 'nip46',
    pubkey,
    bunkerUri,
    clientSecretKey: clientSk,
    signEvent: (template) => bunker.signEvent(template) as unknown as Promise<NostrEvent>,
    close: () => bunker.close(),
  }
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
}

export function prefOf(signer: Signer): SignerPref {
  const base: SignerPref = { kind: signer.kind, pubkey: signer.pubkey }
  if (signer.kind === 'local' && signer.secretKey) base.nsec = nip19.nsecEncode(signer.secretKey)
  if (signer.kind === 'nip46') {
    base.bunkerUri = signer.bunkerUri
    if (signer.clientSecretKey) base.clientNsec = nip19.nsecEncode(signer.clientSecretKey)
  }
  return base
}

/** Rebuild a signer from a persisted preference. Local is instant; the others reconnect. */
export async function signerFromPref(pref: SignerPref): Promise<Signer> {
  if (pref.kind === 'local' && pref.nsec) return signerFromNsec(pref.nsec)
  if (pref.kind === 'nip07') return nip07Signer()
  if (pref.kind === 'nip46' && pref.bunkerUri) {
    const clientSk = pref.clientNsec ? (nip19.decode(pref.clientNsec).data as Uint8Array) : undefined
    return nip46Signer(pref.bunkerUri, clientSk)
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
