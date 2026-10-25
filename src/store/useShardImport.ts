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
 * deadline past the signer's own patience, STOP stops waiting at once (a
 * rate limit's wait too), and two sends in a row with no answer pause the
 * run with the rest left for RETRY. Storage that refuses a shard stops the
 * run before anything is published that would be gone on a reload: each
 * shard is published only once its write has committed.
 * A second zip waits until a run is over.
 */

import { create } from 'zustand'
import { GRID_HALF, neededExtent, uuid, type ShardModel } from 'sno-core/shards'
import { importFitFor } from 'sno-core/meshToShard'
import { mtlNames } from 'sno-core/obj'
import { BUILT_IN } from 'sno-core/snoPalette'
import { listZip, readEntry, ZipError, type ZipEntry } from '../lib/zipRead'
import {
  ZIP_MAX_BYTES, ZIP_MAX_ENTRIES, ZIP_MAX_ENTRY_BYTES, ZIP_MAX_TOTAL_BYTES, companionsFor, copyName, dupAction, findDups, planZip,
  blockedRows, hasPlaceholders, offlinePicture, refTargets, resolveRefs, withoutPlaceholderHints,
  type Companion, type Dup, type DupMode, type PlannedRow, type SkippedFile,
} from '../lib/shardZip'
import { folderApi, placeInFolders } from '../lib/importFolders'
import { importBytes } from '../lib/meshImport'
import { shardRefusal } from '../lib/hidden'
import { publishState, shardFingerprint } from '../lib/published'
import { queryEach } from '../lib/relay'
import { SNO_KIND } from 'sno-core/feed'
import { shardFromText, useWorkshop } from './useWorkshop'
import { saveFailure } from './workshopStorage'
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
  /** What its picture is drawn from: the shard without kit-internal parts, so drawing it reaches no relay about the kit (shardZip offlinePicture). */
  picture: ShardModel | null
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
  /** Whether the workshop has folders to put shards in (lib/importFolders). */
  foldersOn: boolean
  /** The kit every id here is under (lib/shardZip kitIds). */
  kit: string
  /** Ids of this zip that your relays already hold an object of yours at. */
  published: string[]
  /**
   * Whether your relays were asked about those addresses: 'checked' when at
   * least one answered every question, 'unknown' when none could (or you are
   * not logged in). Nothing new is published over an unchecked address.
   */
  remote: 'idle' | 'checking' | 'checked' | 'unknown'
  /** The key `remote` was checked for: another key's addresses were never asked about. */
  checkedFor: string
  /** Whether a run has happened on this zip: the list then holds what it did. */
  ran: boolean
  stopAsked: boolean
  /** Why the run paused by itself. */
  stall: string | null
  /** Start on a zip picked or dropped; refused while a run is going. */
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
/** The open zip's bytes, directory and companions, until every file has been read. */
let zip: { bytes: Uint8Array; entries: Map<string, ZipEntry>; companions: Record<string, Companion[]>; budget: number } | null = null
/** The run going now, with what ends its waits when STOP is pressed. */
let current: { stopped: Promise<void>; stop: () => void } | null = null

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
/** UTF-8, a leading BOM dropped (TextDecoder's default). */
const text = new TextDecoder('utf-8')
const baseName = (path: string): string => path.split('/').pop() ?? path

const blank = { open: false, fileName: '', phase: 'opening' as Phase, error: null, rows: [], skipped: [], dups: {}, dupMode: 'skip' as DupMode, publish: false, foldersOn: false, kit: '', published: [] as string[], remote: 'idle' as const, checkedFor: '', ran: false, stopAsked: false, stall: null }

/** The ids of your shards, for what exists already (lib/shardZip blockedRows). */
export function mineIds(): string[] {
  return useWorkshop.getState().shards.map((x) => x.id)
}

/** Your shards as duplicate matching sees them. */
function mine(): Array<{ id: string; name: string; folder: string[] | null }> {
  const api = folderApi()
  return useWorkshop.getState().shards.map((s) => ({ id: s.id, name: s.name, folder: api?.folderPathOf ? api.folderPathOf(s.id) : null }))
}

function dupsFor(rows: readonly ImportRow[], kit: string, published: readonly string[]): Record<string, Dup> {
  const api = folderApi()
  return Object.fromEntries(findDups(rows.filter((r) => r.read !== 'error'), mine(), !!api?.folderPathOf, kit, new Set(published)))
}

/**
 * The rows that would not come in under these picks and this answer to a
 * taken name, because a piece they place would not exist; each with that
 * piece. The run leaves them out, and the list says so before it starts.
 */
export function plannedBlocks(rows: readonly ImportRow[], dups: Record<string, Dup>, mode: DupMode, published: readonly string[], mineIds: readonly string[]): Map<string, string> {
  const base = new Set([...mineIds, ...published])
  const live = rows.filter((r) => r.picked && r.read === 'ok' && r.run !== 'skipped')
  const act = (r: ImportRow) => dupAction(dups[r.key] ?? null, mode).act
  const coming = new Set(live.filter((r) => r.run === 'done' || act(r) === 'new' || act(r) === 'update').map((r) => r.id))
  // Every row that will come in is checked, a COPY under its fresh id too; one SKIP leaves out is not.
  const entering = live.filter((r) => r.run !== 'done' && (r.shardId !== null || act(r) !== 'skip'))
  return blockedRows(entering.map((r) => ({ key: r.key, id: r.id, refs: r.shard?.refs })), refTargets(rows), base, coming)
}

/** Addresses asked about per relay question. */
const CHECK_CHUNK = 100

/**
 * Which of these ids your relays hold an object of yours at (kind 33331, any
 * version, sealed ones too), or null when no relay answered a question: then
 * nothing is known, and nothing new may go out over those addresses.
 */
async function publishedAt(me: string, ids: readonly string[]): Promise<Set<string> | null> {
  const found = new Set<string>()
  for (let i = 0; i < ids.length; i += CHECK_CHUNK) {
    const answers = await queryEach({ kinds: [SNO_KIND], authors: [me], '#d': ids.slice(i, i + CHECK_CHUNK) })
    if (!answers.some((a) => a.outcome === 'answered')) return null
    for (const a of answers) for (const ev of a.events) {
      if (ev.pubkey !== me || ev.kind !== SNO_KIND) continue
      const d = ev.tags.find((t) => t[0] === 'd')?.[1]
      if (d !== undefined) found.add(d)
    }
  }
  return found
}

/** The files a model names beside it: an OBJ's mtllib, a .gltf's buffer URIs (not data: ones). */
function namedFiles(file: string, bytes: Uint8Array): string[] {
  if (/\.obj$/i.test(file)) return mtlNames(text.decode(bytes.subarray(0, Math.min(bytes.length, 1 << 20))))
  if (/\.gltf$/i.test(file)) {
    try {
      const json = JSON.parse(text.decode(bytes)) as { buffers?: Array<{ uri?: unknown }> }
      return (json.buffers ?? []).map((b) => b?.uri).filter((u): u is string => typeof u === 'string' && !u.startsWith('data:'))
    } catch { return [] }
  }
  return []
}

/** One file of the zip as a shard named after it, through PASTE's or IMPORT's door. */
async function readRow(row: ImportRow): Promise<{ shard: ShardModel; picture: ShardModel; note: string | null } | { error: string }> {
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
    const s = shardFromText(text.decode(bytes), uuid())
    if (!s) return { error: 'Not an SNO object.' }
    shard = s
  } else {
    const file = baseName(row.path)
    const files = [{ name: file, bytes }]
    // Only what the model names, within one file's ceiling and what is left of the zip's.
    let used = bytes.length
    for (const c of companionsFor(file, namedFiles(file, bytes), zip.companions[row.folder.join('/')] ?? [])) {
      const e = zip.entries.get(c.key)
      if (!e) continue
      if (used + e.size > ZIP_MAX_ENTRY_BYTES) return { error: `Over ${ZIP_MAX_ENTRY_BYTES / 1048576} MB with ${c.file}` }
      if (e.size > zip.budget) return { error: `Past ${ZIP_MAX_TOTAL_BYTES / 1048576} MB for the zip` }
      zip.budget -= e.size
      try { files.push({ name: c.file, bytes: readEntry(zip.bytes, e, ZIP_MAX_ENTRY_BYTES - used) }) } catch { continue /* a model without its MTL still comes in */ }
      used += e.size
    }
    // A new shard's grid, as IMPORT fits a file into a new, empty shard.
    const res = await importBytes(files, { fit: importFitFor(GRID_HALF), unit: 0, palette: BUILT_IN, color: useWorkshop.getState().color })
    if (!res.ok) return { error: res.error }
    shard = { ...res.shard, extent: Math.max(GRID_HALF, neededExtent(res.shard)) }
    note = res.report.summary
  }
  // A kit's relay hint is never asked: not in review, not on import (resolveRefs drops it too).
  shard = { ...shard, name: row.name, ...(shard.refs ? { refs: withoutPlaceholderHints(shard.refs) } : {}) }
  // What PUBLISH would refuse is refused now, where it can be read.
  const refusal = shardRefusal(shard)
  if (refusal) return { error: refusal }
  return { shard, picture: offlinePicture(shard), note }
}

/** One send, or why not, never longer than timing.sendDeadlineMs, and over the moment this run's STOP is pressed. */
async function sendWithin(shard: ShardModel, stopped: Promise<void>): Promise<SendOutcome & { late?: boolean }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<SendOutcome & { late: true }>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, message: 'No answer in time.', detail: 'No answer in time', late: true }), timing.sendDeadlineMs)
  })
  const stop = stopped.then((): SendOutcome => ({ ok: false, message: 'Stopped.', detail: 'Stopped' }))
  try {
    return await Promise.race([usePublished.getState().send(shard), late, stop])
  } finally {
    clearTimeout(timer)
  }
}

export const useShardImport = create<ShardImportState>((set, get) => {
  const patch = (key: string, change: Partial<ImportRow>): void =>
    set({ rows: get().rows.map((r) => (r.key === key ? { ...r, ...change } : r)) })
  const row = (key: string): ImportRow | undefined => get().rows.find((r) => r.key === key)
  /** A row left out for a piece it places: a candidate again once the picks change. */
  const unskip = (): void => set({ rows: get().rows.map((r) => (r.run === 'skipped' && r.failure?.startsWith('Places ') ? { ...r, run: 'idle', failure: null } : r)) })

  /** Ask your relays about the zip's addresses not already in your workshop, for the key signed in now. */
  const checkRelays = async (): Promise<Pick<ShardImportState, 'published' | 'remote' | 'checkedFor'>> => {
    const me = useCyberspace.getState().identity.pubkey
    if (!me) return { published: [], remote: 'unknown', checkedFor: '' }
    const fresh = get().rows.filter((r) => r.read === 'ok' && !useWorkshop.getState().shards.some((x) => x.id === r.id)).map((r) => r.id)
    if (!fresh.length) return { published: [], remote: 'checked', checkedFor: me }
    set({ remote: 'checking' })
    const found = await publishedAt(me, fresh).catch(() => null)
    return found ? { published: [...found], remote: 'checked', checkedFor: me } : { published: [], remote: 'unknown', checkedFor: me }
  }

  /** Storage refused the shard in hand: it is not published, and the run stops. */
  const refused = (key: string): void => {
    const why = saveFailure() ?? 'Workshop storage is full'
    patch(key, { run: 'failed', failure: why })
    set({ stall: `${why}.` })
  }

  const run = async (): Promise<void> => {
    const g = generation
    // Checked for another key (an account switched while the list was open): ask again for this one.
    if (get().publish && useCyberspace.getState().identity.pubkey && get().checkedFor !== useCyberspace.getState().identity.pubkey) {
      set({ phase: 'running', ran: true, stall: null })
      const again = await checkRelays()
      if (g !== generation) return
      set(again)
      // STOP while asking: nothing has started, so the run ends here.
      if (get().stopAsked) { set({ phase: 'done', stopAsked: false }); return }
    }
    const me = useCyberspace.getState().identity.pubkey
    const publish = get().publish && !!me
    const mode = get().dupMode
    // This run's own STOP: a send from an earlier run that answers late can never take it away.
    let stop = (): void => {}
    const stopped = new Promise<void>((resolve) => { stop = resolve })
    const mineRun = { stopped, stop }
    current = mineRun
    // Matched again now: what is yours may have changed since the list was read.
    const dups = dupsFor(get().rows, get().kit, get().published)
    // Kit-internal references point at the importer's own pieces (lib/shardZip resolveRefs),
    // and only at pieces that will exist: yours, published by you, or coming in now at their own id.
    const targets = refTargets(get().rows)
    const blocked = plannedBlocks(get().rows, dups, mode, get().published, useWorkshop.getState().shards.map((x) => x.id))
    const remote = get().remote
    set({ phase: 'running', ran: true, stopAsked: false, stall: null, dups })
    const halted = (): boolean => g !== generation || get().stopAsked
    const pause = (ms: number): Promise<void> => Promise.race([sleep(ms), stopped])
    let inHand: string | null = null
    let sent = 0
    try {
      const folders = folderApi()
      const made = new Map<string, string | null>()
      let silent = 0
      for (const { key } of get().rows) {
        if (halted()) break
        const r = row(key)
        if (!r || !r.picked || r.read !== 'ok' || !r.shard || r.run === 'done' || r.run === 'skipped') continue
        inHand = key
        patch(key, { run: 'working', failure: null })
        // A key change mid-run would sign with one key what references name another.
        if (useCyberspace.getState().identity.pubkey !== me) { patch(key, { run: 'idle' }); set({ stall: 'Your key changed.' }); inHand = null; break }
        const ws = useWorkshop.getState()
        // Made once: a retry publishes the shard the first try made.
        let id = r.shardId && ws.shards.some((s) => s.id === r.shardId) ? r.shardId : null
        // Reused: it must be in storage before it goes out (a first try may have been refused).
        if (id && !(await ws.saveNow())) { refused(key); inHand = null; break }
        if (g !== generation) return
        if (!id) {
          const missing = blocked.get(key)
          // Left out, not failed: a retry cannot help, a change of picks or answer can (setDupMode, toggle).
          if (missing) { patch(key, { run: 'skipped', failure: `Places ${missing}, which is not coming in` }); inHand = null; continue }
          // Only a piece placing others needs your key, to name yours.
          if (!me && hasPlaceholders(r.shard.refs)) { patch(key, { run: 'failed', failure: 'Log in first' }); inHand = null; continue }
          const model: ShardModel = r.shard.refs && me ? { ...r.shard, refs: resolveRefs(r.shard.refs, targets, me) } : r.shard
          const action = dupAction(dups[key] ?? null, mode)
          if (action.act === 'skip') { patch(key, { run: 'skipped', failure: dups[key]?.in === 'zip' ? 'Same name in this zip' : 'In your shards' }); inHand = null; continue }
          let saved: boolean
          if (action.act === 'update') {
            const res = await ws.replaceShard(action.id, model)
            if (res === 'missing') { patch(key, { run: 'failed', failure: 'Its namesake is gone' }); inHand = null; continue }
            id = action.id
            saved = res === 'saved'
          } else {
            const fresh = action.act === 'copy'
            // A new address goes out only once your relays said nothing of yours is there.
            if (!fresh && publish && (remote !== 'checked' || get().checkedFor !== me)) { patch(key, { run: 'failed', failure: 'Could not check this address on your relays' }); inHand = null; continue }
            const added = ws.addShard(model, fresh || action.copyName ? copyName(r.name) : r.name, fresh ? undefined : r.id)
            if (!added) { patch(key, { run: 'failed', failure: 'Its id is taken' }); inHand = null; continue }
            id = added.id
            saved = await added.saved
            // An update keeps the folder it is in; a new shard goes in its own.
            placeInFolders(folders, [{ shardId: id, folder: r.folder }], made)
          }
          patch(key, { shardId: id, outcome: action.act === 'new' ? (action.copyName ? 'copy' : 'new') : action.act })
          // Nothing goes out that a reload would lose here: saved means committed (store/workshopStorage.ts).
          if (!saved) { refused(key); inHand = null; break }
          if (g !== generation) return
        }
        if (!publish) { patch(key, { run: 'done' }); inHand = null; continue }
        const shard = useWorkshop.getState().shards.find((s) => s.id === id)
        if (!shard) { patch(key, { run: 'failed', failure: 'Gone from your shards' }); inHand = null; continue }
        // Sent already, this very version (a send that timed out here and landed anyway).
        if (publishState(usePublished.getState().ledger[shard.id], shardFingerprint(shard), me) === 'published') { patch(key, { run: 'done' }); inHand = null; continue }
        let outcome = await sendWithin(shard, stopped)
        for (let tries = 1; !outcome.ok && /^rate-limited\b/i.test(outcome.detail) && tries < RATE_TRIES; tries++) {
          if (halted()) break
          await pause(timing.rateBackoffMs * tries)
          if (halted()) break
          outcome = await sendWithin(shard, stopped)
        }
        if (g !== generation) return
        inHand = null
        if (outcome.ok) { sent++; silent = 0; patch(key, { run: 'done' }) } else {
          patch(key, { run: 'failed', failure: outcome.detail })
          silent = 'late' in outcome && outcome.late ? silent + 1 : 0
          if (silent >= STALL_AFTER) { set({ stall: 'Your signer is not answering.' }); break }
        }
        await pause(timing.gapMs)
      }
    } catch (e) {
      // Whatever went wrong, the row in hand says so and the modal can be closed.
      if (inHand && g === generation) patch(inHand, { run: 'failed', failure: e instanceof Error ? e.message : String(e) })
    } finally {
      if (current === mineRun) current = null
      // The folders' filing, saved before DONE shows; never waited on past a few seconds.
      try {
        const flush = folderApi()?.flush
        if (flush) await Promise.race([flush().catch(() => undefined), sleep(5000)])
      } catch { /* the filing is the folders store's to report */ }
      if (g === generation) {
        if (sent > 0) refreshFeed()
        set({ phase: 'done', stopAsked: false })
      }
    }
  }

  return {
    ...blank,

    openZip: async (file) => {
      if (get().phase === 'running') return
      const g = ++generation
      zip = null
      // PUBLISH starts off on every import, whatever the last one used
      // (arkinox, 2026-10-24: "I accidentally published part of the maze kit
      // because the import has 'publish' ON by default").
      set({ ...blank, open: true, fileName: file.name, foldersOn: !!folderApi() })
      if (file.size > ZIP_MAX_BYTES) { set({ error: `That zip is ${Math.round(file.size / 1048576)} MB. Import reads zips of up to ${ZIP_MAX_BYTES / 1048576} MB.`, phase: 'review' }); return }
      let bytes: Uint8Array
      try { bytes = new Uint8Array(await file.arrayBuffer()) } catch { if (g === generation) set({ error: 'That zip could not be opened.', phase: 'review' }); return }
      if (g !== generation) return
      let entries: ZipEntry[]
      try { entries = listZip(bytes, ZIP_MAX_ENTRIES) } catch (e) {
        set({ error: e instanceof ZipError ? e.message : 'That zip could not be read.', phase: 'review' })
        return
      }
      const plan = planZip(entries, file.name)
      zip = { bytes, entries: new Map(entries.map((e) => [String(e.index), e])), companions: plan.companions, budget: Math.max(0, ZIP_MAX_TOTAL_BYTES - plan.total) }
      const rows: ImportRow[] = plan.rows.map((p) => ({
        ...p, read: p.error ? 'error' : 'waiting', shard: null, picture: null, note: null, picked: !p.error, run: 'idle', shardId: null, outcome: null, failure: null,
      }))
      if (rows.length === 0) set({ error: 'No shard files in that zip.' })
      set({ rows, skipped: plan.skipped, kit: plan.kit, phase: 'reading' })
      for (const { key } of rows) {
        if (g !== generation) return
        const r = row(key)
        if (!r || r.read !== 'waiting') continue
        patch(key, { read: 'reading' })
        const res = await readRow(r)
        if (g !== generation) return
        if ('error' in res) patch(key, { read: 'error', error: res.error, picked: false })
        else patch(key, { read: 'ok', shard: res.shard, picture: res.picture, note: res.note })
        // A breath between files, so the list paints as it fills.
        await sleep(0)
      }
      if (g !== generation) return
      zip = null
      // What your relays already hold at these addresses (another device, or another kit with this folder name).
      const { published, remote, checkedFor } = await checkRelays()
      if (g !== generation) return
      // A reference to a piece of the kit that will not exist would draw as a placeholder.
      const targets = refTargets(get().rows)
      const ok = get().rows.filter((r) => r.read === 'ok')
      const blocked = blockedRows(ok.map((r) => ({ key: r.key, id: r.id, refs: r.shard?.refs })), targets, new Set([...useWorkshop.getState().shards.map((x) => x.id), ...published]), new Set(ok.map((r) => r.id)))
      for (const [key, missing] of blocked) patch(key, { read: 'error', error: `Places ${missing}, not in this zip`, picked: false })
      set({ phase: 'review', published, remote, checkedFor, dups: dupsFor(get().rows, get().kit, published) })
    },

    toggle: (key) => {
      if (get().phase === 'running') return
      const r = row(key)
      if (r && r.read !== 'error' && r.run !== 'done') patch(key, { picked: !r.picked })
      unskip()
    },

    pickAll: (on) => {
      if (get().phase === 'running') return
      set({ rows: get().rows.map((r) => (r.read === 'error' || r.run === 'done' ? r : { ...r, picked: on })) })
      unskip()
    },

    setDupMode: (mode) => {
      if (get().phase === 'running' || mode === get().dupMode) return
      // A row a name left out is a candidate again under the new answer.
      set({ dupMode: mode, rows: get().rows.map((r) => (r.run === 'skipped' ? { ...r, run: 'idle', failure: null } : r)) })
    },
    setPublish: (on) => { if (get().phase !== 'running') set({ publish: on }) },

    start: async () => {
      const { phase } = get()
      if (phase !== 'review' && phase !== 'done') return
      await run()
    },

    stop: () => {
      if (get().phase !== 'running') return
      set({ stopAsked: true })
      current?.stop()
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
      set({ ...blank })
    },
  }
})
