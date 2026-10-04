/**
 * client.ts: the name ONOSENDAI signs its events with.
 *
 * NIP-89 lets an event say which app published it with a `client` tag:
 * `["client", "<name>"]`, optionally followed by the address of the app's
 * kind 31990 handler event and a relay hint. ONOSENDAI has no app pubkey and
 * so no handler event yet, which leaves the name alone; that is a valid tag,
 * and every client that shows attribution reads it.
 *
 * Every event the app signs carries it (arkinox, 2026-10-04: "I want all
 * events published by it to carry the proper client tag"), added by the
 * signers themselves so no publishing path can forget it. Two exceptions:
 *
 * - A template that already names a client is left as it is. An avatar is
 *   mined over its own tags (spec 8.10: NIP-13 work on the event id), so it
 *   carries the tag from the template and the work is done over it; adding
 *   it again at signing would change the id and void the work.
 * - Auth events are not attributed. They are proofs handed to one server
 *   (a relay's NIP-42 challenge, a Blossom upload, a HOSAKA request) and are
 *   never published, so there is no reader to tell.
 */

import type { EventTemplate } from './events'

export const CLIENT_NAME = 'ONOSENDAI'

/** NIP-89 client attribution, by name only until the app has a handler event. */
export const CLIENT_TAG: [string, string] = ['client', CLIENT_NAME]

/** Auth events: NIP-42 relay auth, Blossom upload auth, NIP-98 HTTP auth. */
const UNATTRIBUTED_KINDS = new Set([22242, 24242, 27235])

/** The template with ONOSENDAI's client tag, unless it is an auth event or already names a client. */
export function attributed<T extends EventTemplate>(template: T): T {
  if (UNATTRIBUTED_KINDS.has(template.kind)) return template
  if (template.tags.some((t) => t[0] === 'client')) return template
  return { ...template, tags: [...template.tags, [...CLIENT_TAG]] }
}
