/**
 * published.ts - publishing a shard as a PUBLIC object, and which of your
 * shards have been published, and whether the one on the bench is still the
 * one that went out.
 *
 * Until now ONOSENDAI only HID shards: sealed in a bag at a place, or as a
 * sealed kind 33331 by reference (lib/hidden.ts objectTemplate). A public
 * object is a kind 33331 with no `encrypted` tag and the SNO payload as its
 * content (DECK-0003 §3.1), which the Shard Feed lists and other apps (Blobbi,
 * Realms, snocrash) read. snocrash.art has published exactly that since it
 * existed; this is that behavior, ported tag for tag (arkinox, 2026-10-10:
 * "I want to make steps, rivers, walls, and other pieces that should show up
 * in the shard feed instantly ... publish button should be in the menu like
 * it is on snocrash.art").
 *
 * The event (publicObjectTemplate) is snocrash's `objectTemplate` to the tag:
 * `d` is the shard's own id, so the same shard edited in either app is one
 * address; `name`, `alt`, and one `a`/`e` tag per object it places (§1.10,
 * sno-core refTags). The `client` tag is added by the signer (lib/client.ts),
 * as snocrash's signers add theirs; it is the one tag where the two apps
 * differ, and it is meant to. One addition snocrash does not write yet: a
 * REMIX of someone else's object carries the credit tags, `q` and `p`
 * (sno-core creditTags, ruled 2026-10-08: a public remix tells the author).
 *
 * The ledger is snocrash's lib/published.ts. Nothing on a relay tells you
 * whether you published a thing. An addressable event (kind 33331, keyed by
 * `d`) can be replaced any number of times and carries no memory of what it
 * replaced, so "have I published this, and have I changed it since" is a
 * question only this browser can answer, and only if it wrote the answer
 * down at the time. That is all the ledger is: a small record in
 * localStorage, written when a publish is accepted by at least one relay.
 *
 * Four states, because the honest answer is not two:
 *
 *   never      - no relay has ever been handed this object
 *   published  - it went out, and it matches what went out
 *   edited     - it went out, and it has been changed here since
 *   other-key  - it went out under a key that is not the one signing now,
 *                so publishing it again writes a *different* object rather
 *                than replacing that one (an address is kind + pubkey + d,
 *                and the pubkey is half of it)
 *
 * On the fingerprint: it is taken from the payload this app would publish,
 * never from the bytes a relay returns. A payload that goes out and comes
 * back has been through `fromPayload` and `toPayload` again, and the two need
 * only agree on meaning, not on byte order, so comparing against wire text
 * would report edits that never happened. An object learned from a relay
 * rather than published from here therefore gets an empty fingerprint, which
 * reads as "published, and this browser cannot tell you whether it changed":
 * unknown, and never a guess. The fingerprint is the same function in both
 * apps over the same sno-core payload, so a record carried between them
 * would agree; the ledgers themselves are per browser.
 *
 * Pure: signing and sending live in store/usePublished.ts.
 */

import { toPayload, type ShardModel } from 'sno-core/shards'
import { refTags } from 'sno-core/parts'
import { SNO_KIND, creditOf, creditTags, objectAddress } from 'sno-core/feed'
import type { EventTemplate } from './events'

const STORAGE = 'onosendai:published'

export type PublishState = 'never' | 'published' | 'edited' | 'other-key'

export interface PublishRecord {
  /** When the relays took it, in seconds, as nostr counts time. */
  at: number
  /** The payload as it went out, or '' when this browser did not send it. */
  fp: string
  /** Who signed it. Half of the object's address, so a change of key matters. */
  pubkey: string
  /**
   * The event id of the version that went out, or was seen, when known: what
   * a retraction names in its `e` tag beside the address. Optional, because
   * a record written before this field existed has none, and a retraction by
   * address alone is still a retraction (NIP-09).
   */
  id?: string
}

export type Ledger = Record<string, PublishRecord>

/**
 * The event a shard goes out as, a public object (DECK-0003 §3.1). Pure, so
 * the shape is testable without a relay. The same tags snocrash writes, in
 * the same order, so the Shard Feed and every other reader see one kind of
 * object whichever app made it:
 *
 * - `d`: the shard's own id, stable across edits. Addressable means the
 *   author can fix it in place, and a shard that moves between the two apps
 *   under its id (REMIX of your own object, snocrash's adopt) stays one
 *   address.
 * - `name`: what the author called it, for a row.
 * - `alt`: what a client that cannot draw it should say instead (NIP-31).
 * - one tag per object it places, as the payload names it (§1.10), so a
 *   relay can answer "what places this object". Readers take the placements
 *   from the payload, never from these.
 * - for a REMIX (sno-core withCredit): the `q` naming the original and the
 *   `p` telling its author, since this one is public (sno-core creditTags).
 *
 * The `client` tag is the signer's (lib/client.ts attributed), not written
 * here, so a template never carries it twice.
 */
export function publicObjectTemplate(shard: ShardModel, createdAt: number): EventTemplate {
  const credit = creditOf(shard)
  return {
    kind: SNO_KIND,
    created_at: createdAt,
    tags: [
      ['d', shard.id],
      ['name', shard.name],
      ['alt', `a 3D object: ${shard.name}, ${shard.vertices.length} vertices${shard.parts?.length ? `, ${shard.parts.length} placed objects` : ''}`],
      ...refTags(shard),
      ...(credit ? creditTags(credit, { notify: true }) : []),
    ],
    content: JSON.stringify(toPayload(shard)),
  }
}

/**
 * The deletion that takes a kind 33331 object down (NIP-09): by its address,
 * so every version up to this moment goes, by its event id when that is
 * known, and with the `k` that says what kind it was. `reason` is the
 * content, a word for a human reading the relay. Shared by RETRACT in the
 * workshop and by useShards, which takes down a sealed object the same way
 * once no bag names it.
 */
export function retractionTemplate(pubkey: string, d: string, eventId: string | undefined, createdAt: number, reason: string): EventTemplate {
  return {
    kind: 5,
    created_at: createdAt,
    content: reason,
    tags: [['a', objectAddress(pubkey, d)], ...(eventId ? [['e', eventId]] : []), ['k', String(SNO_KIND)]],
  }
}

/**
 * A short, stable hash of the payload: two FNV-1a passes from different
 * offsets, so the result is 64 bits rather than 32 and an accidental collision
 * (which would read as "unchanged" on a changed object) is not a practical
 * worry. It is not a cryptographic hash and nothing here needs one: it is
 * only ever compared against another fingerprint made the same way. The same
 * function as snocrash's, so the two agree on what "the same object" means.
 */
export function fingerprint(payload: unknown): string {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
  const pass = (offset: number): string => {
    let h = offset >>> 0
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
    return h.toString(16).padStart(8, '0')
  }
  return pass(0x811c9dc5) + pass(0x7fffffff)
}

export function loadLedger(): Ledger {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE) ?? '{}') as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const out: Ledger = {}
    for (const [id, rec] of Object.entries(raw as Record<string, unknown>)) {
      const r = rec as Partial<PublishRecord>
      if (typeof r?.at !== 'number' || typeof r?.pubkey !== 'string') continue
      out[id] = { at: r.at, fp: typeof r.fp === 'string' ? r.fp : '', pubkey: r.pubkey, ...(typeof r.id === 'string' ? { id: r.id } : {}) }
    }
    return out
  } catch { return {} }
}

export function saveLedger(ledger: Ledger): void {
  try { localStorage.setItem(STORAGE, JSON.stringify(ledger)) } catch { /* quota or private mode */ }
}

/**
 * Note a publish. Later word wins: republishing is exactly how an addressable
 * object is corrected, so the newest send is the one worth remembering.
 */
export function noteSent(ledger: Ledger, id: string, fp: string, pubkey: string, at: number, eventId?: string): Ledger {
  return { ...ledger, [id]: { at, fp, pubkey, ...(eventId ? { id: eventId } : {}) } }
}

/**
 * Note an object seen on a relay under this key, without claiming to know
 * whether it matches what is on the bench. A real send always outranks this:
 * it carries a fingerprint and this does not, and losing that would turn a
 * known "edited" into an unknowable "published".
 */
export function noteSeen(ledger: Ledger, id: string, pubkey: string, at: number, eventId?: string): Ledger {
  const prev = ledger[id]
  if (prev && (prev.fp !== '' || prev.at >= at)) return ledger
  return { ...ledger, [id]: { at, fp: '', pubkey, ...(eventId ? { id: eventId } : {}) } }
}

/**
 * Forget an object, after a retraction the relays took: it reads as never
 * published again, and PUBLISH puts it back. A relay that ignores deletions
 * may still hand it back, and a sighting then records it again, which is the
 * truth about that relay.
 */
export function forget(ledger: Ledger, id: string): Ledger {
  if (!(id in ledger)) return ledger
  const { [id]: _gone, ...rest } = ledger
  return rest
}

/** Where an object stands, given the ledger, its current payload and who signs. */
export function publishState(rec: PublishRecord | undefined, fp: string, pubkey: string | null): PublishState {
  if (!rec) return 'never'
  // A key is only compared when there is one to compare against: signed out,
  // what is known is that it went out, not who would send it next.
  if (pubkey && rec.pubkey !== pubkey) return 'other-key'
  if (rec.fp !== '' && rec.fp !== fp) return 'edited'
  return 'published'
}

/** The short label the tag wears, snocrash's words. */
export const STATE_LABEL: Record<PublishState, string> = {
  never: 'DRAFT',
  published: 'PUBLISHED',
  edited: 'EDITED',
  'other-key': 'OTHER KEY',
}

/** Which tag color a state wears: a draft is quiet, a drift is a warning. */
export const STATE_TAG: Record<PublishState, string> = {
  never: 'tag--local',
  published: 'tag--live',
  edited: 'tag--sending',
  'other-key': 'tag--danger',
}

/** What that label means, spelled out, for the tag's tooltip. */
export const STATE_HELP: Record<PublishState, string> = {
  never: 'Never published as a public object. The Shard Feed does not list it. Hiding it in a bag is a separate thing.',
  published: 'Published, and unchanged since. Relays hold this object and the Shard Feed lists it.',
  edited: 'Published, then edited here. Publish again to replace what is on the relays.',
  'other-key': 'Published under a different key. Publishing now writes a new object rather than replacing that one.',
}

/**
 * The fingerprint of an object as it would go out right now. One definition,
 * used both when a publish is recorded and when the tag asks whether it has
 * drifted, so the two can never disagree about what "the same object" means.
 */
export function shardFingerprint(shard: ShardModel): string {
  return fingerprint(JSON.stringify(toPayload(shard)))
}
