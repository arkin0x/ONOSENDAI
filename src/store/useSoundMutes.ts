/**
 * useSoundMutes.ts: NOW PLAYING's mutes (arkinox, 2026-11-03).
 *
 * Two switches, both this device's own (lib/soundMuteDb, IndexedDB):
 *   - one per track, kept by the item's lineage id, so a track muted here is
 *     still muted when you leave its area and come back, and after its hider
 *     moves or edits it;
 *   - MUTE ALL, over every hidden audio track, which leaves each track's own
 *     switch as it was: unmuting it gives back the tracks muted one by one.
 * Neither touches Cyberspace TV's music (RULED 2026-11-03), which keeps its
 * own mute (store/useTvMusic).
 *
 * A mute only silences. Not the mute list (store/useMutes), which hides an
 * author or an item and stops what plays: a muted track still plays, so it
 * still raises NOW PLAYING and stays listed there, and unmuting it is heard
 * from where it now is (store/useHiddenAudio applies it to the gain).
 *
 * Until the stored switches are read, every track is held silent, so a track
 * muted last time is not heard for the moment the read takes. Where the
 * database cannot be used, the switches last the session.
 */

import { create } from 'zustand'
import { openSoundMuteDb, putMasterMute, putTrackMute, readSoundMutes } from '../lib/soundMuteDb'

interface SoundMuteState {
  /** The tracks muted one by one, by lineage id. */
  tracks: ReadonlySet<string>
  /** MUTE ALL: every hidden audio track, not TV. */
  master: boolean
  /** The stored switches have been read (or cannot be). */
  ready: boolean
}

export const useSoundMutes = create<SoundMuteState>(() => ({ tracks: new Set(), master: false, ready: false }))

let db: Promise<IDBDatabase> | null = null

/**
 * The open connection, or null where there is none to be had. Kept only
 * while it lives, as lib/chainDb.ts keeps its own: an open that failed or
 * timed out is tried again next time, and a connection the browser drops
 * (iOS, after a while in the background) or a newer build in another tab
 * upgrades is let go, and opened again on the next read or write.
 */
function database(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  if (!db) {
    const opening = openSoundMuteDb().then((d) => {
      d.onversionchange = () => { d.close(); if (db === opening) db = null }
      d.onclose = () => { if (db === opening) db = null }
      return d
    })
    opening.catch(() => { if (db === opening) db = null })
    db = opening
  }
  return db.catch(() => null)
}

/** `run` on the open database; on a failure, once more on a fresh connection, since the cached one may be dead. Throws when there is none. */
async function withDb(run: (d: IDBDatabase) => Promise<void>): Promise<void> {
  const d = await database()
  if (!d) throw new Error('No IndexedDB')
  try {
    await run(d)
  } catch {
    // That connection is let go, closed so it blocks nothing, and a fresh one opened.
    try { d.close() } catch { /* already closed */ }
    db = null
    const again = await database()
    if (!again) throw new Error('No IndexedDB')
    await run(again)
  }
}

/** Switches flipped before the read landed: they win over what it read. */
const flipped = new Map<string, boolean>()
let masterFlipped: boolean | null = null

/** Read what this device keeps, once at start (and again in tests). */
export async function loadSoundMutes(): Promise<void> {
  let stored: { tracks: string[]; master: boolean } = { tracks: [], master: false }
  try {
    const d = await database()
    if (d) stored = await readSoundMutes(d)
  } catch { /* the session keeps them in memory */ }
  const tracks = new Set(stored.tracks)
  for (const [id, on] of flipped) { if (on) tracks.add(id); else tracks.delete(id) }
  useSoundMutes.setState({ tracks, master: masterFlipped ?? stored.master, ready: true })
}

/**
 * Flips not yet on disk. A write that fails leaves them here, and the next
 * flip writes them all, so a lost connection loses nothing it can get back.
 */
const unsavedTracks = new Map<string, boolean>()
let unsavedMaster: boolean | null = null

/** The writes, one after another, so two quick flips land in the order made. */
let writes: Promise<void> = Promise.resolve()

async function writeUnsaved(): Promise<void> {
  if (unsavedTracks.size === 0 && unsavedMaster === null) return
  const tracks = [...unsavedTracks]
  const master = unsavedMaster
  await withDb(async (d) => {
    for (const [id, on] of tracks) await putTrackMute(d, id, on)
    if (master !== null) await putMasterMute(d, master)
  })
  // Only what was written and not flipped again since.
  for (const [id, on] of tracks) if (unsavedTracks.get(id) === on) unsavedTracks.delete(id)
  if (master !== null && unsavedMaster === master) unsavedMaster = null
}

function persist(): void {
  writes = writes.then(writeUnsaved).catch(() => { /* kept for the session, and tried again with the next flip */ })
}

/** The connection as it is now cached, if any (tests). */
export function soundMuteConnectionForTests(): Promise<IDBDatabase> | null {
  return db
}

/** Resolves once every flip so far is written (tests). */
export function soundMutesSaved(): Promise<void> {
  return writes
}

/** Whether a track is muted on its own switch. */
export function trackMuted(id: string | undefined): boolean {
  return !!id && useSoundMutes.getState().tracks.has(id)
}

/** Whether a hidden audio track is silent here: its own switch, MUTE ALL, or the switches not read yet. */
export function trackSilenced(id: string | undefined, s: SoundMuteState = useSoundMutes.getState()): boolean {
  return !s.ready || s.master || (!!id && s.tracks.has(id))
}

/** Flip one track's own switch. */
export function toggleTrackMute(id: string): void {
  if (!id) return
  const tracks = new Set(useSoundMutes.getState().tracks)
  const on = !tracks.has(id)
  if (on) tracks.add(id)
  else tracks.delete(id)
  if (!useSoundMutes.getState().ready) flipped.set(id, on)
  useSoundMutes.setState({ tracks })
  unsavedTracks.set(id, on)
  persist()
}

/** Flip MUTE ALL; each track's own switch stays as it is. */
export function toggleMasterMute(): void {
  const master = !useSoundMutes.getState().master
  if (!useSoundMutes.getState().ready) masterFlipped = master
  useSoundMutes.setState({ master })
  unsavedMaster = master
  persist()
}

/** Forget the connection and the early flips (tests). */
export function resetSoundMutesForTests(): void {
  db = null
  writes = Promise.resolve()
  unsavedTracks.clear()
  unsavedMaster = null
  flipped.clear()
  masterFlipped = null
  useSoundMutes.setState({ tracks: new Set(), master: false, ready: false })
}

// Read at once; where there is no IndexedDB (tests, an old browser) that is at once too.
void loadSoundMutes()
