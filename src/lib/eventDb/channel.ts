/**
 * channel.ts - the short note every committed write posts, so another tab
 * re-reads only what changed. Posted after the commit, by the thread that
 * committed, so a note never runs ahead of the rows it names.
 */

export const EVENT_DB_CHANNEL = 'onosendai:events'

export type EventDbNote =
  /** Rows arrived, or a deletion took some away. `by` is the tab that wrote them. */
  | { kind: 'events'; by: string; ids: string[]; struck: string[] }
  /** An identity's chain changed. */
  | { kind: 'chain'; by: string; pubkey: string; headId: string; generation: number; length: number }

let channel: BroadcastChannel | null = null

function open(): BroadcastChannel | null {
  if (channel) return channel
  if (typeof BroadcastChannel === 'undefined') return null
  try {
    channel = new BroadcastChannel(EVENT_DB_CHANNEL)
    // Node's channel would otherwise hold a test process open; a browser's has no such thing.
    ;(channel as unknown as { unref?: () => void }).unref?.()
    return channel
  } catch { return null }
}

/** Tell the other tabs. Never fails a write: a tab that misses a note reads the chain record before its next move anyway. */
export function postNote(note: EventDbNote): void {
  try { open()?.postMessage(note) } catch { /* the channel is closed */ }
}

/** Hear the notes of every tab, this one's own included (`by` says whose). The returned function stops listening. */
export function onNote(listen: (note: EventDbNote) => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {}
  try {
    const own = new BroadcastChannel(EVENT_DB_CHANNEL)
    ;(own as unknown as { unref?: () => void }).unref?.()
    own.onmessage = (m: MessageEvent<EventDbNote>) => listen(m.data)
    return () => own.close()
  } catch { return () => {} }
}

/** For tests: close the channel, as a reload does. */
export function closeNotes(): void {
  try { channel?.close() } catch { /* already closed */ }
  channel = null
}
