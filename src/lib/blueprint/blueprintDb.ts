/**
 * blueprintDb.ts - the blueprints this device keeps, per identity, in
 * IndexedDB (arkinox, 2026-11-19: all local data per npub; a switch never
 * deletes).
 *
 * - cards: one row per blueprint an identity holds: the ones it made (with
 *   the whole arrangement and the key, which only the maker has) and the
 *   ones it found (the maker's signed record, and who left it there).
 * - records: every blueprint record this device has seen, by lookup (its
 *   own, found cards', and later the relay's), so a smash finds prizes
 *   without asking anything (lib/blueprint/smash.ts).
 * - toys: prizes compiled and not yet collected: they wait where the build
 *   stood, on this device only (design page 4.4).
 *
 * Nothing here is published.
 */

import { openDatabase, putMany, request } from '../idb'
import type { NostrEvent } from '../events'
import type { Prize, RecordEvent } from './format'

export const BLUEPRINT_DB = 'onosendai:blueprints'
const DB_VERSION = 1
export const CARDS = 'cards'
export const RECORDS = 'records'
export const TOYS = 'toys'
const BY_OWNER = 'byOwner'
const BY_LOOKUP = 'byLookup'

/** One blueprint an identity holds. */
export interface BlueprintCard {
  /** `${owner}/${record id}`. */
  rowKey: string
  owner: string
  lookup: string
  /** The maker's signed record (lib/blueprint/format.ts recordTemplate). */
  record: NostrEvent
  /** Made here, or found (in the world, a chest or a door). */
  source: 'made' | 'found'
  /** Unix seconds when this identity came to hold it. */
  at: number
  /** Who left the card where it was found, when that was not its maker (a finder re-hiding it). */
  leftBy?: string
  /** The maker's own: the whole arrangement (its box, its block ids in scan order as base64 of 16-bit cells) and the key, hex. */
  secret?: { cells: string; key: string; size: [number, number, number] }
  /** Times this identity compiled it. */
  built?: number
  /** Archived out of the lists (never deleted by a tap). */
  archived?: number
}

/** A record seen on this device, by lookup. */
export interface RecordRow {
  /** The record's event id. */
  id: string
  lookup: string
  record: NostrEvent
  seen: number
}

/** A prize compiled and not yet collected. */
export interface ToyRow {
  rowKey: string
  owner: string
  /** The prize, opened. */
  prize: Prize
  /** The blueprint's name and maker, for the label and the ITEMS row. */
  name: string
  maker: string
  lookup: string
  /** The record it came from (none for a starter recipe). */
  record?: RecordEvent
  /** Where it waits: a cyberspace gibson (decimal strings) and its plane. */
  at: { x: string; y: string; z: string; plane: number }
  made: number
}

export function openBlueprintDb(): Promise<IDBDatabase> {
  return openDatabase(BLUEPRINT_DB, DB_VERSION, [
    [CARDS, 'rowKey', [{ name: BY_OWNER, keyPath: 'owner' }]],
    [RECORDS, 'id', [{ name: BY_LOOKUP, keyPath: 'lookup' }]],
    [TOYS, 'rowKey', [{ name: BY_OWNER, keyPath: 'owner' }]],
  ])
}

export async function readCards(db: IDBDatabase, owner: string): Promise<BlueprintCard[]> {
  const rows = await request(db.transaction(CARDS, 'readonly').objectStore(CARDS).index(BY_OWNER).getAll(owner)) as BlueprintCard[]
  return rows.filter((r) => r && typeof r.lookup === 'string' && r.record && typeof r.record.content === 'string')
}

export function writeCards(db: IDBDatabase, rows: BlueprintCard[]): Promise<void> {
  return rows.length ? putMany(db, CARDS, rows) : Promise.resolve()
}

export async function readRecords(db: IDBDatabase, lookup: string): Promise<RecordRow[]> {
  return await request(db.transaction(RECORDS, 'readonly').objectStore(RECORDS).index(BY_LOOKUP).getAll(lookup)) as RecordRow[]
}

export function writeRecords(db: IDBDatabase, rows: RecordRow[]): Promise<void> {
  return rows.length ? putMany(db, RECORDS, rows) : Promise.resolve()
}

export async function readToys(db: IDBDatabase, owner: string): Promise<ToyRow[]> {
  return await request(db.transaction(TOYS, 'readonly').objectStore(TOYS).index(BY_OWNER).getAll(owner)) as ToyRow[]
}

export function writeToys(db: IDBDatabase, rows: ToyRow[]): Promise<void> {
  return rows.length ? putMany(db, TOYS, rows) : Promise.resolve()
}

export function deleteToys(db: IDBDatabase, rowKeys: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TOYS, 'readwrite')
    for (const k of rowKeys) tx.objectStore(TOYS).delete(k)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'))
  })
}
