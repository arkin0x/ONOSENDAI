/**
 * builderKey.ts - this device's builder key for an identity (DECK-0009 §4).
 *
 * A builder key is a keypair this device makes the first time an identity
 * opens TERRAIN, and keeps in IndexedDB under that identity (the terrain
 * database's meta store, as all local data is per npub: arkinox,
 * 2026-11-19; a switch of identity never deletes it). Its signature goes on
 * this device's block layers and nothing else, so building never asks the
 * player's signer for anything (owner, 2026-11-24). Its secret never leaves
 * the device; like the key this app makes for a new visitor it is kept as
 * it is, with nothing to ask.
 *
 * The player names it with a `builder` tag on the next movement action they
 * sign anyway (lib/terrain/builderTags.ts). Until an action carrying the tag
 * is found on the canonical relay, the tag rides on every movement action,
 * which is harmless (§4.2), and no layer is published. Every named key
 * stays valid until a `builder-retire` tag retires it, and a retired key
 * voids every layer it ever signed (the owner's Blocks design, 2026-11-25).
 *
 * Retiring this device's key (the bag's RETIRE) owes a `builder-retire`
 * on the next action and makes a new key at once, named on that same action;
 * once named, this device publishes its blocks again under it
 * (store/terrainShare.ts). Beside the retirement rides `["R", "<hex>"]`,
 * the single-letter tag relays index, so a reader finds every retirement of
 * a key with one filter.
 */

import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { putMany, request } from '../idb'
import { META } from './terrainDb'
import { BUILDER_RETIRE_TAG, BUILDER_TAG, RETIRE_INDEX_TAG, onActionSigned, owedBuilderTagsFrom } from './builderTags'

/** How many signed actions carrying a tag are remembered while waiting for one to reach the relay. */
export const CANDIDATES_KEPT = 32

export interface BuilderKeyRow {
  pub: string
  sec: string
  created: number
  /** The movement action, found on the canonical relay, that names this key; null until one is. */
  named: string | null
  /** Actions signed carrying its `builder` tag, newest last, not yet found on the relay. */
  naming: string[]
  /** Retired, or being retired: owed on the next action until an action carrying it is found on the relay. */
  retire?: { signed: string[]; confirmed: string | null }
}

export interface BuilderRecord {
  owner: string
  /** The key this device builds with now. */
  current: string | null
  keys: BuilderKeyRow[]
}

const records = new Map<string, BuilderRecord>()
const dbs = new Map<string, IDBDatabase>()
const listeners = new Set<(owner: string) => void>()

const metaKey = (owner: string): string => `${owner}|builder`
const HEX64 = /^[0-9a-f]{64}$/

/** Be told when an identity's builder record changes (named, retired, a new key). */
export function onBuilderChange(fn: (owner: string) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

function changed(rec: BuilderRecord): void {
  const db = dbs.get(rec.owner)
  if (db) void putMany(db, META, [{ key: metaKey(rec.owner), value: rec }]).catch(() => { /* kept in memory for this visit */ })
  for (const fn of listeners) { try { fn(rec.owner) } catch { /* nothing */ } }
}

function isRow(v: unknown): v is BuilderKeyRow {
  const r = v as BuilderKeyRow | null
  return !!r && typeof r.pub === 'string' && HEX64.test(r.pub) && typeof r.sec === 'string' && HEX64.test(r.sec) && Array.isArray(r.naming)
}

/** The builder tags an identity's next movement action carries (§4.2, §4.3). */
export function owedTags(rec: BuilderRecord | undefined): string[][] {
  if (!rec) return []
  const out: string[][] = []
  const cur = rec.keys.find((k) => k.pub === rec.current)
  if (cur && cur.named === null && !cur.retire) out.push([BUILDER_TAG, cur.pub])
  for (const k of rec.keys) {
    if (!k.retire || k.retire.confirmed !== null) continue
    out.push([BUILDER_RETIRE_TAG, k.pub])
    // Beside every retirement, the single-letter R tag relays index, so readers find it on any chain (§4.3).
    out.push([RETIRE_INDEX_TAG, k.pub])
  }
  return out
}

// signEvent asks here which tags an action carries, and tells here what it signed.
owedBuilderTagsFrom((signer) => owedTags(records.get(signer)))
onActionSigned((ev) => noteSigned(ev))

/** The record held for an identity, if any. */
export function builderRecord(owner: string): BuilderRecord | undefined {
  return records.get(owner)
}

/** Read an identity's record from the terrain database into memory (once a field opens it). */
export async function loadBuilder(db: IDBDatabase, owner: string): Promise<BuilderRecord | undefined> {
  dbs.set(owner, db)
  const row = await request(db.transaction([META], 'readonly').objectStore(META).get(metaKey(owner))) as { value?: BuilderRecord } | undefined
  const v = row?.value
  if (v && v.owner === owner && Array.isArray(v.keys)) {
    const keys = v.keys.filter(isRow)
    const held = records.get(owner)
    // A key made in memory before the database answered is kept beside what was stored.
    for (const k of held?.keys ?? []) if (!keys.some((s) => s.pub === k.pub)) keys.push(k)
    const rec: BuilderRecord = { owner, current: held?.current ?? (keys.some((k) => k.pub === v.current) ? v.current : null), keys }
    records.set(owner, rec)
    if (held) changed(rec)
  }
  return records.get(owner)
}

/** Let go of an identity's database (its field closed). The record stays in memory. */
export function releaseBuilderDb(owner: string, db: IDBDatabase): void {
  if (dbs.get(owner) === db) dbs.delete(owner)
}

function newRow(now: number): BuilderKeyRow {
  const sk = generateSecretKey()
  const sec = Array.from(sk, (x) => x.toString(16).padStart(2, '0')).join('')
  return { pub: getPublicKey(sk), sec, created: now, named: null, naming: [] }
}

/** This device's key for an identity, made when there is none (TERRAIN's first use). */
export function ensureBuilderKey(owner: string, now: number = Date.now()): BuilderRecord {
  let rec = records.get(owner)
  if (rec && rec.current && rec.keys.some((k) => k.pub === rec!.current && !k.retire)) return rec
  const row = newRow(now)
  rec = { owner, current: row.pub, keys: [...(rec?.keys ?? []), row] }
  records.set(owner, rec)
  changed(rec)
  return rec
}

/** The key to sign layers with: the current one, once named on the relay; null before. */
export function namedKey(owner: string): BuilderKeyRow | null {
  const rec = records.get(owner)
  const k = rec?.keys.find((r) => r.pub === rec.current)
  return k && k.named && !k.retire ? k : null
}

/** Every key this device made for an identity (current, waiting and retired): their layers are this device's. */
export function deviceKeys(owner: string): BuilderKeyRow[] {
  return records.get(owner)?.keys ?? []
}

/** Learn, from an action just signed, which owed tags it carries. */
export function noteSigned(ev: { id: string; pubkey: string; tags: string[][] }): void {
  const rec = records.get(ev.pubkey)
  if (!rec) return
  let touched = false
  for (const t of ev.tags) {
    const k = rec.keys.find((r) => r.pub === t[1])
    if (!k) continue
    if (t[0] === BUILDER_TAG && k.named === null && !k.naming.includes(ev.id)) {
      k.naming = [...k.naming, ev.id].slice(-CANDIDATES_KEPT)
      touched = true
    }
    if (t[0] === BUILDER_RETIRE_TAG && k.retire && k.retire.confirmed === null && !k.retire.signed.includes(ev.id)) {
      k.retire = { ...k.retire, signed: [...k.retire.signed, ev.id].slice(-CANDIDATES_KEPT) }
      touched = true
    }
  }
  if (touched) changed(rec)
}

/** The actions signed with an owed tag that are not yet found on the relay. */
export function waitingIds(owner: string): string[] {
  const rec = records.get(owner)
  if (!rec) return []
  const out: string[] = []
  for (const k of rec.keys) {
    if (k.named === null && !k.retire) out.push(...k.naming)
    if (k.retire && k.retire.confirmed === null) out.push(...k.retire.signed)
  }
  return [...new Set(out)]
}

/**
 * Settle which owed tags reached the canonical relay: `found` is the ids,
 * of waitingIds, that the relay holds. A key's naming stops being owed once
 * one action naming it is there, and a retirement once one carrying it is.
 */
export function noteFound(owner: string, found: ReadonlySet<string>): boolean {
  const rec = records.get(owner)
  if (!rec || found.size === 0) return false
  let touched = false
  for (const k of rec.keys) {
    if (k.named === null && !k.retire) {
      const hit = [...k.naming].reverse().find((id) => found.has(id))
      if (hit) { k.named = hit; k.naming = []; touched = true }
    }
    if (k.retire && k.retire.confirmed === null) {
      const hit = k.retire.signed.find((id) => found.has(id))
      if (hit) { k.retire = { ...k.retire, confirmed: hit, signed: [] }; touched = true }
    }
  }
  if (touched) changed(rec)
  return touched
}

/** Retire this device's current key and make a new one, both carried by the next action. */
export function retireCurrent(owner: string, now: number = Date.now()): BuilderRecord | null {
  const rec = records.get(owner)
  const k = rec?.keys.find((r) => r.pub === rec.current)
  if (!rec || !k) return null
  k.retire = { signed: [], confirmed: null }
  const row = newRow(now)
  rec.keys = [...rec.keys, row]
  rec.current = row.pub
  changed(rec)
  return rec
}

/** For tests: forget every record. */
export function forgetBuilderRecords(): void {
  records.clear()
  dbs.clear()
}
