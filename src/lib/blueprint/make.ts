/**
 * make.ts - sealing a blueprint (design page 4.8 step 4; DECK-0010 §5): the
 * key and the lookup from the arrangement (and the region's key for a
 * location lock), the prize sealed with the key, the sheet with only the
 * shape and the revealed blocks, the record signed by the maker's identity,
 * and the card kept in BLUEPRINTS › MINE. Making and placing are separate
 * steps (owner, 2026-11-27): a made blueprint waits in the list until it is
 * placed.
 *
 * The record is kept on this device, where a smash finds it, and travels
 * inside every card placed. LIVE, it is also published (publishRecord), so a
 * smash anywhere finds it; the relay takes kind 33343 since cyberspace-relay
 * #52 (lib/blueprint/format.ts BLUEPRINT_RELAY_READY). LOCAL keeps it here.
 */

import { keyOf } from './keyClient'
import {
  RECORD_MAX_BYTES, plainText, recordRefusal, recordTemplate, serializedLength, sealPrize, sheetShape, toBase64, bytesFromCells,
  type Arrangement, type LockKind, type Prize, type PrizeReveal, type PrizeView, type RecordEvent, type Sheet,
} from './format'
import { connected } from './arrangement'
import { bytesToHex, type NostrEvent } from '../events'
import { BLUEPRINT_RELAY_READY } from './format'
import { publishMany, relaySet } from '../relay'

/** A sealed record to the relays when blueprints are live and the app is LIVE: 'sent', 'kept' (LOCAL, or not live) or 'failed'. */
export async function publishRecord(record: RecordEvent, live: boolean, send: (ev: NostrEvent) => Promise<{ ok: boolean }> = (ev) => publishMany(relaySet(), ev)): Promise<'sent' | 'kept' | 'failed'> {
  if (!BLUEPRINT_RELAY_READY || !live) return 'kept'
  try { return (await send(record as unknown as NostrEvent)).ok ? 'sent' : 'failed' } catch { return 'failed' }
}

/** What the toast says after sealing, for each way the record went. */
export const SEALED_WORDS: Record<'sent' | 'kept' | 'failed', string> = {
  sent: 'Sealed and published. It waits in ITEMS, BLUEPRINTS.',
  kept: 'Sealed and kept on this device (LOCAL). It waits in ITEMS, BLUEPRINTS.',
  failed: 'Sealed. No relay took it yet; it still travels in every card you place. It waits in ITEMS, BLUEPRINTS.',
}

export interface MakeInput {
  arrangement: Arrangement
  /** Which occupied cells finders see (scan index). Everything starts revealed. */
  shown: (index: number) => boolean
  title: string
  prize: Prize
  reveal: PrizeReveal
  /** The maker's words about the prize (required for 'description'). */
  text?: string
  /** The prize's pictures, for 'silhouette' and 'render'. */
  views?: Partial<Record<PrizeView, string>>
  lock: LockKind
  /** A location lock's height and the key of the region of that height holding the box. */
  height?: number
  regionKey?: Uint8Array | null
  /** Ask feeds not to list it. */
  noBroadcast?: boolean
  /** The prize's own name, written only when the maker chose to show it. */
  prizeName?: string | null
}

/** Why a blueprint cannot be sealed as it is, in plain words, or null. */
export function makeRefusal(m: Pick<MakeInput, 'arrangement' | 'reveal' | 'text' | 'views' | 'lock' | 'height' | 'regionKey'>): string | null {
  if (!m.arrangement.cells.some((id) => id > 0)) return 'Add at least one block.'
  if (!connected(m.arrangement)) return 'Every block must touch the rest, at a face, an edge or a corner, or a smash would not take it all.'
  if (m.reveal === 'description' && !m.text?.trim()) return 'Write a few words about the prize.'
  if ((m.reveal === 'silhouette' || m.reveal === 'render') && !Object.keys(m.views ?? {}).length) return 'Pick at least one view of the prize.'
  if (m.lock === 'location' && (!m.height || !m.regionKey)) return 'The build must stand inside one region of the chosen size for a location lock.'
  return null
}

/** Seal it: returns the signed record and the maker's secret, or a refusal. `sign` is the identity's signer. */
export async function makeBlueprint(m: MakeInput, sign: (t: ReturnType<typeof recordTemplate>) => Promise<RecordEvent>): Promise<{ record: RecordEvent; lookup: string; key: Uint8Array } | { refused: string }> {
  const why = makeRefusal(m)
  if (why) return { refused: why }
  const { key, lookup } = await keyOf(m.arrangement, m.lock === 'location' ? m.regionKey : null)
  const sealed = await sealPrize(key, m.prize)
  const prize: Sheet['prize'] = { reveal: m.reveal }
  // Free text goes in plain (no control characters, §5.3); a prize name empty once trimmed is never written (§5.4 fails it).
  const text = m.text ? [...plainText(m.text)].slice(0, 280).join('').trim() : ''
  if (m.reveal !== 'hidden' && text) prize.text = text
  if (m.reveal === 'silhouette' || m.reveal === 'render') prize.views = m.views
  const name = m.prizeName ? [...plainText(m.prizeName)].slice(0, 64).join('').trim() : ''
  if (name) prize.name = name
  const sheet: Sheet = { ...sheetShape(m.arrangement, m.shown), lock: m.lock, ...(m.lock === 'location' ? { height: m.height } : {}), prize }
  const template = recordTemplate({ lookup, sheet, sealed, title: m.title, createdAt: Math.floor(Date.now() / 1000), noBroadcast: m.noBroadcast })
  // The size limit (§5.2), measured before asking the signer: pictures are what usually push it over.
  if (serializedLength({ ...template, id: '0'.repeat(64), pubkey: '0'.repeat(64), sig: '0'.repeat(128) }) > RECORD_MAX_BYTES) return { refused: 'Too big to seal: choose fewer prize pictures, or a smaller prize.' }
  const record = await sign(template)
  const bad = recordRefusal(record)
  if (bad) return { refused: `This blueprint could not be sealed (${bad}).` }
  return { record, lookup, key }
}

/** The maker's secret for MINE: the whole arrangement and the key, kept on this device. */
export function makerSecret(a: Arrangement, key: Uint8Array): { cells: string; key: string; size: [number, number, number] } {
  return { cells: toBase64(bytesFromCells(a.cells)), key: bytesToHex(key), size: [a.size[0], a.size[1], a.size[2]] }
}
