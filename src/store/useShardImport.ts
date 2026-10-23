/**
 * useShardImport.ts - bulk import: one .zip dropped on the workshop, every
 * shard file in it one of your shards, published one at a time.
 *
 * arkinox, 2026-10-23: "i need to import every maze kit piece to the
 * workshop ... upload a zip of shards/PLY?" Each file comes in by the door
 * one object comes in by, never a new one: a .json SNO payload as PASTE reads
 * it (shardFromText, DECK-0003 §1), a 3D file as IMPORT reads it
 * (lib/meshImport's worker, its size cap and its clock, fitted to a new
 * shard's grid). Each shard is published as PUBLISH publishes one
 * (usePublished.send: the same kind 33331, the same ledger), so a kit is
 * nothing but a lot of single publishes.
 *
 * The steps, each the user's to stop: open (the zip's directory, checked
 * against lib/shardZip's limits before a byte is inflated), read (each file
 * into a shard, in order, so the list fills in), review (untick, choose what
 * a taken name means), run (add each shard to yours, put it in its folder,
 * publish it, a short gap between, a relay's rate limit waited out), and
 * retry (only what failed, on the shard already made: a retry never adds a
 * second shard, and publishes to the same address, so a send that timed out
 * but landed is replaced, never doubled; one the ledger already shows as
 * sent is not sent again).
 *
 * A signer that does not answer cannot hold the run: each send has a
 * deadline past the signer's own patience, STOP stops waiting at once, and
 * two sends in a row with no answer pause the run with the rest left for
 * RETRY.
 */

import { create } from 'zustand'
import { GRID_HALF, neededExtent, uuid, type ShardModel } from 'sno-core/shards'
import { importFitFor } from 'sno-core/meshToShard'
import { BUILT_IN } from 'sno-core/snoPalette'
import { listZip, readEntry, ZipError, type ZipEntry } from '../lib/zipRead'
import {
  ZIP_MAX_BYTES, ZIP_MAX_ENTRIES, ZIP_MAX_ENTRY_BYTES, copyName, dupAction, findDups, planZip,
  type Dup, type DupMode, type PlannedRow, type SkippedFile,
} from '../lib/shardZip'
import { folderApi, placeInFolders } from '../lib/importFolders'
import { importBytes } from '../lib/meshImport'
import { shardRefusal } from '../lib/hidden'
import { publishState, shardFingerprint } from '../lib/published'
import { shardFromText, useWorkshop } from './useWorkshop'
import { refreshFeed, usePublished, type SendOutcome } from './usePublished'
import { useCyberspace } from './useCyberspace'

/** The run's pace, in one object so a test can shorten it. */
export const timing = {
  /** Between one publish and the next: a kit of fifty is not a burst. */
  gapMs: 300,
  /** One send, sign and relays together: past the signer's patience (15 s, and once more after a reconnect) and two relay waits. */
  sendDeadlineMs: 90_000,
  /** A relay that said rate-limited is asked again after this, times the attempt. */
  rateBackoffMs: 3000,
}
/** Sends of one shard while a relay says rate-limited. */
export const RATE_TRIES = 3
/** Sends in a row with no answer before the run pauses. */
export const STALL_AFTER = 2

export type ReadState = 'waiting' | 'reading' | 'ok' | 'error'
export type RunState = 'idle' | 'working' | 'done' | 'failed' | 'skipped'
export type Phase = 'opening' | 'reading' | 'review' | 'running' | 'done'

export interface ImportRow extends PlannedRow {
  read: ReadState
  /** The shard the file became, before it is one of yours. */
  shard: ShardModel | null
  /** IMPORT's line for a 3D file: "Imported 12 faces". */
  note: string | null
  picked: boolean
  run: RunState
  /** Your shard made or updated from this row: set once, so a retry reuses it. */
  shardId: string | null
  /** What the run did with it. */
  outcome: 'new' | 'copy' | 'update' | null
  /** Why it failed or was skipped, short. */
  failure: string | null
}

export interface ShardImportState {
  open: boolean
  fileName: string
  phase: Phase
  /** Why the zip as a whole cannot be read. */
  error: string | null
  rows: ImportRow[]
  skipped: SkippedFile[]
  dups: Record<string, Dup>
  dupMode: DupMode
  publish: boolean
  /** Whether the workshop has folders to put shards in (lib/shardFolders). */
  foldersOn: boolean
  stopAsked: boolean
  /** Why the run paused by itself. */
  stall: string | null
  /** Start on a zip picked or dropped. */
  openZip: (file: File) => Promise<void>
  toggle: (key: string) => void
  pickAll: (on: boolean) => void
  setDupMode: (mode: DupMode) => void
  setPublish: (on: boolean) => void
  /** Add, and publish, every picked row not yet done. */
  start: () => Promise<void>
  stop: () => void
  /** Run again, over what failed. */
  retry: () => Promise<void>
  close: () => void
}

/** Each open or close: a loop from an earlier one sees a newer number and stops. */
let generation = 0
/** The open zip's bytes and directory, until every file has been read. */
let zip: { bytes: Uint8Array; entries: Map<string, ZipEntry> } | null = null
/** Resolves the wait on the send in flight when STOP is pressed. */
let stopWaiting: (() => void) | null = null

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const text = new TextDecoder('utf-8')
const baseName = (key: string): string => key.replace(/\\/g, '/').split('/').pop() ?? key

const blank = { open: false, fileName: '', phase: 'opening' as Phase, error: null, rows: [], skipped: [], dups: {}, dupMode: 'skip' as DupMode, publish: true, foldersOn: false, stopAsked: false, stall: null }

/** Your shards as duplicate matching sees them. */
function mine(): Array<{ id: string; name: string; folder: string[] | null }> {
  const api = folderApi()
  return useWorkshop.getState().shards.map((s) => ({ id: s.id, name: s.name, folder: api?.folderPathOf ? api.folderPathOf(s.id) : null }))
}

function dupsFor(rows: readonly ImportRow[]): Record<string, Dup> {
  const api = folderApi()
  return Object.fromEntries(findDups(rows.filter((r) => r.read !== 'error'), mine(), !!api?.folderPathOf))
}

/** One file of the zip as a shard named after it, through PASTE's or IMPORT's door. */
async function readRow(row: ImportRow): Promise<{ shard: ShardModel; note: string | null } | { error: string }> {
  if (!zip) return { error: 'The zip is closed.' }
  const entry = zip.entries.get(row.key)
  if (!entry) return { error: 'Missing from the zip.' }
  let bytes: Uint8Array
  try {
    bytes = readEntry(zip.bytes, entry, ZIP_MAX_ENTRY_BYTES)
  } catch (e) {
    return { error: e instanceof ZipError ? e.message : 'It could not be read.' }
  }
  let shard: ShardModel
  let note: string | null = null
  if (row.kind === 'sno') {
    const s = shardFromText(text.decode(bytes).replace(/^﻿/, ''), uuid())
    if (!s) return { error: 'Not an SNO object.' }
    shard = s
  } else {
    const files = [{ name: baseName(row.key), bytes }]
    for (const key of row.companions) {
      const c = zip.entries.get(key)
      if (!c) continue
      try { files.push({ name: baseName(key), bytes: readEntry(zip.bytes, c, ZIP_MAX_ENTRY_BYTES) }) } catch { /* a model without its MTL still comes in */ }
    }
    // A new shard's grid, as IMPORT fits a file into a new, empty shard.
    const res = await importBytes(files, { fit: importFitFor(GRID_HALF), unit: 0, palette: BUILT_IN, color: useWorkshop.getState().color })
    if (!res.ok) return { error: res.error }
    shard = { ...res.shard, extent: Math.max(GRID_HALF, neededExtent(res.shard)) }
    note = res.report.summary
  }
  shard = { ...shard, name: row.name }
  // What PUBLISH would refuse is refused now, where it can be read.
  const refusal = shardRefusal(shard)
  if (refusal) return { error: refusal }
  return { shard, note }
}

/** One send, or why not, never longer than timing.sendDeadlineMs, and over the moment STOP is pressed. */
async function sendWithin(shard: ShardModel): Promise<SendOutcome & { late?: boolean }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<SendOutcome & { late: true }>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, message: 'No answer in time.', detail: 'No answer in time', late: true }), timing.sendDeadlineMs)
  })
  const stopped = new Promise<SendOutcome>((resolve) => { stopWaiting = () => resolve({ ok: false, message: 'Stopped.', detail: 'Stopped' }) })
  try {
    return await Promise.race([usePublished.getState().send(shard), late, stopped])
  } finally {
    clearTimeout(timer)
    stopWaiting = null
  }
}

export const useShardImport = create<ShardImportState>((set, get) => {
  const patch = (key: string, change: Partial<ImportRow>): void =>
    set({ rows: get().rows.map((r) => (r.key === key ? { ...r, ...change } : r)) })
  const row = (key: string): ImportRow | undefined => get().rows.find((r) => r.key === key)

  const run = async (): Promise<void> => {
    const g = generation
    const me = useCyberspace.getState().identity.pubkey
    const publish = get().publish && !!me
    const mode = get().dupMode
    // Matched again now: what is yours may have changed since the list was read.
    const dups = dupsFor(get().rows)
    set({ phase: 'running', stopAsked: false, stall: null, dups })
    const folders = folderApi()
    const made = new Map<string, string | null>()
    let silent = 0
    let sent = 0
    for (const { key } of get().rows) {
      if (g !== generation || get().stopAsked) break
      const r = row(key)
      if (!r || !r.picked || r.read !== 'ok' || !r.shard || r.run === 'done' || r.run === 'skipped') continue
      patch(key, { run: 'working', failure: null })
      const ws = useWorkshop.getState()
      // Made once: a retry publishes the shard the first try made.
      let id = r.shardId && ws.shards.some((s) => s.id === r.shardId) ? r.shardId : null
      if (!id) {
        const action = dupAction(dups[key] ?? null, mode)
        if (action.act === 'skip') { patch(key, { run: 'skipped', failure: dups[key]?.in === 'zip' ? 'Same name in this zip' : 'In your shards' }); continue }
        if (action.act === 'update') {
          if (!ws.replaceShard(action.id, r.shard)) { patch(key, { run: 'failed', failure: 'Its namesake is gone' }); continue }
          id = action.id
        } else {
          id = ws.addShard(r.shard, action.act === 'copy' ? copyName(r.name) : r.name)
          // An update keeps the folder it is in; a new shard goes in its own.
          placeInFolders(folders, [{ shardId: id, folder: r.folder }], made)
        }
        patch(key, { shardId: id, outcome: action.act })
      }
      if (!publish) { patch(key, { run: 'done' }); continue }
      const shard = useWorkshop.getState().shards.find((s) => s.id === id)
      if (!shard) { patch(key, { run: 'failed', failure: 'Gone from your shards' }); continue }
      // Sent already, this very version (a send that timed out here and landed anyway).
      if (publishState(usePublished.getState().ledger[shard.id], shardFingerprint(shard), me) === 'published') { patch(key, { run: 'done' }); continue }
      let outcome = await sendWithin(shard)
      for (let tries = 1; !outcome.ok && /^rate-limited\b/i.test(outcome.detail) && tries < RATE_TRIES; tries++) {
        if (g !== generation || get().stopAsked) break
        await sleep(timing.rateBackoffMs * tries)
        if (g !== generation || get().stopAsked) break
        outcome = await sendWithin(shard)
      }
      if (g !== generation) return
      if (outcome.ok) { sent++; silent = 0; patch(key, { run: 'done' }) } else {
        patch(key, { run: 'failed', failure: outcome.detail })
        silent = 'late' in outcome && outcome.late ? silent + 1 : 0
        if (silent >= STALL_AFTER) { set({ stall: 'Your signer is not answering.' }); break }
      }
      await sleep(timing.gapMs)
    }
    if (g !== generation) return
    if (sent > 0) refreshFeed()
    set({ phase: 'done', stopAsked: false })
  }

  return {
    ...blank,

    openZip: async (file) => {
      const g = ++generation
      zip = null
      set({ ...blank, open: true, fileName: file.name, publish: get().publish, dupMode: 'skip', foldersOn: !!folderApi() })
      if (file.size > ZIP_MAX_BYTES) { set({ error: `That zip is ${Math.round(file.size / 1048576)} MB. Import reads zips of up to ${ZIP_MAX_BYTES / 1048576} MB.`, phase: 'review' }); return }
      let bytes: Uint8Array
      try { bytes = new Uint8Array(await file.arrayBuffer()) } catch { if (g === generation) set({ error: 'That zip could not be opened.', phase: 'review' }); return }
      if (g !== generation) return
      let entries: ZipEntry[]
      try { entries = listZip(bytes, ZIP_MAX_ENTRIES) } catch (e) {
        set({ error: e instanceof ZipError ? e.message : 'That zip could not be read.', phase: 'review' })
        return
      }
      const plan = planZip(entries)
      zip = { bytes, entries: new Map(entries.map((e) => [e.name, e])) }
      const rows: ImportRow[] = plan.rows.map((p) => ({
        ...p, read: p.error ? 'error' : 'waiting', shard: null, note: null, picked: !p.error, run: 'idle', shardId: null, outcome: null, failure: null,
      }))
      if (rows.length === 0) set({ error: 'No shard files in that zip.' })
      set({ rows, skipped: plan.skipped, phase: 'reading' })
      for (const { key } of rows) {
        if (g !== generation) return
        const r = row(key)
        if (!r || r.read !== 'waiting') continue
        patch(key, { read: 'reading' })
        const res = await readRow(r)
        if (g !== generation) return
        if ('error' in res) patch(key, { read: 'error', error: res.error, picked: false })
        else patch(key, { read: 'ok', shard: res.shard, note: res.note })
        // A breath between files, so the list paints as it fills.
        await sleep(0)
      }
      if (g !== generation) return
      zip = null
      set({ phase: 'review', dups: dupsFor(get().rows) })
    },

    toggle: (key) => {
      const { phase } = get()
      if (phase === 'running') return
      const r = row(key)
      if (r && r.read !== 'error' && r.run !== 'done') patch(key, { picked: !r.picked })
    },

    pickAll: (on) => {
      if (get().phase === 'running') return
      set({ rows: get().rows.map((r) => (r.read === 'error' || r.run === 'done' ? r : { ...r, picked: on })) })
    },

    setDupMode: (mode) => { if (get().phase !== 'running') set({ dupMode: mode }) },
    setPublish: (on) => { if (get().phase !== 'running') set({ publish: on }) },

    start: async () => {
      const { phase } = get()
      if (phase !== 'review' && phase !== 'done') return
      await run()
    },

    stop: () => {
      if (get().phase !== 'running') return
      set({ stopAsked: true })
      stopWaiting?.()
    },

    retry: async () => {
      if (get().phase !== 'done') return
      // Only what failed, and anything the stop left untouched.
      set({ rows: get().rows.map((r) => (r.run === 'failed' ? { ...r, run: 'idle', failure: null } : r)) })
      await run()
    },

    close: () => {
      if (get().phase === 'running') return
      generation++
      zip = null
      set({ ...blank, publish: get().publish })
    },
  }
})
