/**
 * signLater.ts - chain actions taken offline with a remote signer: computed
 * and chained now, signed when the signer is back.
 *
 * A remote signer (NIP-46: a bunker, Amber, nsec.app) cannot sign with no
 * network, and arkinox flies with no signer at all. An action names the one
 * before it by id, and a Nostr id is the hash of everything but the
 * signature, so an action can be built in full now, with its real id, and
 * signed later. The signature then covers the same id and nothing that
 * follows it changes.
 *
 * Such an action is kept with `sig` UNSIGNED. It lives only in this
 * device's saved chain: the saved-chain check accepts it when its id is the
 * hash of its contents and it is this identity's (useCyberspace loadChain),
 * nothing read from a relay is ever accepted unsigned, and the publisher
 * signs it, in chain order, before it sends it (publisher.ts). A signer that
 * hands back a different id (it changed the time or the tags) would break
 * every action after it, so that signature is refused and the chain stays
 * here, unsent, with the reason said.
 *
 * The client tag a signer adds (client.ts attributed) is added here first;
 * attributed() leaves a template that has one alone, so the signer's copy
 * hashes to the same id.
 */

import { getEventHash } from 'nostr-tools/pure'
import { attributed } from './client'
import type { EventTemplate, NostrEvent } from './events'
import type { SignerKind } from './signers'

/**
 * The `sig` of an action that waits for its signature: not hex, so it can
 * never pass for one, and not empty, which other code and fixtures use for
 * events that were never meant to be signed (inventory.ts).
 */
export const UNSIGNED = 'sign-later'

export function isUnsigned(e: Pick<NostrEvent, 'sig'>): boolean {
  return e.sig === UNSIGNED
}

/** The action, complete but for its signature, as `pubkey` would sign it. */
export function unsignedEvent(template: EventTemplate, pubkey: string): NostrEvent {
  const t = attributed(template)
  const draft = { kind: t.kind, created_at: t.created_at, tags: t.tags, content: t.content, pubkey }
  return { ...draft, id: getEventHash(draft), sig: UNSIGNED }
}

/** What a signer is asked to sign for an action kept unsigned: the same contents, so the same id. */
export function templateOf(e: NostrEvent): EventTemplate {
  return { kind: e.kind, created_at: e.created_at, tags: e.tags, content: e.content }
}

/** An action kept unsigned on this device: its id is the hash of its contents, and it is `pubkey`'s. */
export function soundUnsigned(e: NostrEvent, pubkey: string): boolean {
  return isUnsigned(e) && e.pubkey === pubkey && getEventHash(e) === e.id
}

/**
 * Whether a chain action is kept unsigned instead of signed now: only a
 * remote signer, only with no network. A local key and a browser extension
 * sign offline, so they always sign.
 */
export function signsLater(kind: SignerKind, online: boolean): boolean {
  return kind === 'nip46' && !online
}

/** Said when a signer's answer for an action kept unsigned has another id. */
export const SIGNED_ID_CHANGED = 'Your signer changed an action signed later (its id differs), so your offline actions were not sent. They stay on this device.'
