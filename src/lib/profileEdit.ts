/**
 * profileEdit.ts - the fields of a kind 0 this client edits, and how an edit
 * becomes the next kind 0 without losing the rest.
 *
 * A profile is one JSON object that every client shares, and most clients
 * write fields this one never shows: lud06, bot, a client's own keys. An
 * editor that wrote only its own fields would erase theirs. So the newest
 * kind 0 is fetched, the edited fields are laid over it, and a field the person
 * emptied is removed rather than left as "": absent is what other clients read
 * as unset. Nothing here talks to a relay; the modal does.
 */

import type { EventTemplate, NostrEvent } from './events'

export const PROFILE_FIELDS = ['display_name', 'name', 'about', 'picture', 'banner', 'website', 'nip05', 'lud16'] as const
export type ProfileField = (typeof PROFILE_FIELDS)[number]
export type ProfileFields = Partial<Record<ProfileField, string>>

/** A kind 0's content as an object, or null when it is not one. */
export function parseContent(content: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(content)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** The editable fields of a profile object, as strings; anything else is left where it was. */
export function fieldsOf(content: Record<string, unknown> | null): ProfileFields {
  const out: ProfileFields = {}
  for (const f of PROFILE_FIELDS) {
    const v = content?.[f]
    if (typeof v === 'string') out[f] = v
  }
  return out
}

/** The existing object with the edits laid over it; an emptied field is removed. */
export function mergeProfile(existing: Record<string, unknown> | null, edits: ProfileFields): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(existing ?? {}) }
  for (const f of PROFILE_FIELDS) {
    if (!(f in edits)) continue
    const v = (edits[f] ?? '').trim()
    if (v) next[f] = v
    else delete next[f]
  }
  return next
}

/**
 * The kind 0 to sign. `createdAt` is pushed past the one it replaces: a
 * replaceable event older than the relay's copy is dropped without a word,
 * and a device clock a minute behind would otherwise lose the edit.
 */
export function profileTemplate(content: Record<string, unknown>, now: number, previous: NostrEvent | null): EventTemplate {
  return {
    kind: 0,
    created_at: Math.max(now, (previous?.created_at ?? 0) + 1),
    tags: previous?.tags ?? [],
    content: JSON.stringify(content),
  }
}

/** The newest event of one author among what the relays returned, or null. */
export function newest(events: NostrEvent[], pubkey: string, kind: number): NostrEvent | null {
  let best: NostrEvent | null = null
  for (const ev of events) {
    if (ev.pubkey !== pubkey || ev.kind !== kind) continue
    if (!best || ev.created_at > best.created_at || (ev.created_at === best.created_at && ev.id < best.id)) best = ev
  }
  return best
}

export function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

const ADDRESS = /^[a-z0-9._+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i

/** What a person can fix before signing; empty when the fields are fine. */
export function profileProblems(fields: ProfileFields): string[] {
  const out: string[] = []
  for (const f of ['picture', 'banner', 'website'] as const) {
    const v = (fields[f] ?? '').trim()
    if (v && !isHttpUrl(v)) out.push(`${f[0].toUpperCase() + f.slice(1)} must be a full URL, starting with https://.`)
  }
  const nip05 = (fields.nip05 ?? '').trim()
  if (nip05 && !ADDRESS.test(nip05)) out.push('A NIP-05 address looks like you@example.com (or _@example.com).')
  const lud16 = (fields.lud16 ?? '').trim()
  if (lud16 && !ADDRESS.test(lud16)) out.push('A lightning address looks like you@getalby.com.')
  return out
}
