/**
 * liveSub.ts — a subscription that outlives its socket.
 *
 * A relay socket dies for reasons the page never sees: a phone suspends the
 * tab for a thirty-minute hyperjump, a NAT forgets an idle connection, the
 * browser reclaims everything while a wallet is up. The pool underneath us
 * then closes every open subscription for good, and nothing reissued them:
 * publishing recovered on its own (it drops dead sockets and retries), but
 * the feeds that watch other people, the loot, the anchors and the chat went
 * quiet until a reload. That is why a friend who had just ridden hyperspace
 * could not see anyone: their feeds had been dead for half an hour.
 *
 * This keeps each live subscription as a record and reopens it whenever the
 * pool reports it closed, with backoff, and on demand when the tab comes back
 * from the background. Authentication happens before the request is sent,
 * because the relay auth-gates reads and answers an unauthed REQ with CLOSED.
 * `since` is moved forward to just before the last event seen, with a minute
 * of overlap: a repeat is cheaper than a gap, and every consumer merges by id.
 *
 * The transport is injected so the loop can be tested with a fake pool.
 */

import type { Filter } from 'nostr-tools/filter'
import type { NostrEvent } from './events'

export interface Handlers {
  onEvent: (ev: NostrEvent) => void
  onEose?: () => void
}

/** What the transport must do: open one subscription and tell us when it closes. */
export interface Transport {
  /** Authenticate and open; resolves to a closer. `onClose` fires when the relay ended it. */
  open: (filter: Filter, handlers: Handlers, onClose: (reason: string) => void) => Promise<() => void>
}

/** Seconds of overlap when a subscription is reissued. */
export const RESUME_OVERLAP_S = 60
/** How long a reopen waits after each successive close, in milliseconds. */
export const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000]

export interface Live {
  id: number
  filter: Filter
  handlers: Handlers
  /** created_at of the newest event delivered, or null before any. */
  lastSeen: number | null
  /** Events delivered over the record's whole life, reopens included. */
  events: number
  /** Times the subscription has been reissued. */
  reopens: number
  /** Consecutive closes without an event between them; drives the backoff. */
  attempts: number
  closed: boolean
  closer: (() => void) | null
  timer: ReturnType<typeof setTimeout> | null
  opening: boolean
}

/** The filter to reissue with: `since` moved up to just before the last event seen. */
export function resumedFilter(filter: Filter, lastSeen: number | null): Filter {
  if (lastSeen === null) return filter
  const since = Math.max(filter.since ?? 0, lastSeen - RESUME_OVERLAP_S)
  return { ...filter, since }
}

export function backoffFor(attempts: number): number {
  return BACKOFF_MS[Math.min(Math.max(0, attempts - 1), BACKOFF_MS.length - 1)]
}

export class LiveRegistry {
  private records = new Map<number, Live>()
  private nextId = 1

  constructor(private transport: Transport) {}

  /** Open a subscription that will be kept open. Returns its closer. */
  subscribe(filter: Filter, handlers: Handlers): () => void {
    const live: Live = {
      id: this.nextId++, filter, handlers, lastSeen: null, events: 0, reopens: 0,
      attempts: 0, closed: false, closer: null, timer: null, opening: false,
    }
    this.records.set(live.id, live)
    void this.open(live)
    return () => this.close(live)
  }

  /** Every record still wanted. */
  list(): Live[] {
    return [...this.records.values()]
  }

  /**
   * Reissue everything now, without waiting out a backoff. For when the tab
   * comes back from the background: the sockets it holds may be half-open,
   * which looks connected and delivers nothing, so waiting for a close would
   * wait forever. `dropSockets` runs once first, so every record then opens
   * over a fresh connection.
   */
  resumeAll(dropSockets: () => void): void {
    dropSockets()
    for (const live of this.records.values()) {
      if (live.closed) continue
      if (live.timer) { clearTimeout(live.timer); live.timer = null }
      // The pool has already closed these; a closer that still exists is stale,
      // and the open that follows is a new generation, so a late close from
      // the socket being replaced is not mistaken for the new one dying.
      live.closer = null
      live.attempts = 0
      live.reopens++
      void this.open(live)
    }
  }

  private async open(live: Live): Promise<void> {
    if (live.closed || live.opening) return
    live.opening = true
    const generation = live.reopens
    try {
      const closer = await this.transport.open(
        resumedFilter(live.filter, live.lastSeen),
        {
          onEvent: (ev) => {
            if (live.closed) return
            live.events++
            live.attempts = 0
            if (live.lastSeen === null || ev.created_at > live.lastSeen) live.lastSeen = ev.created_at
            live.handlers.onEvent(ev)
          },
          onEose: live.handlers.onEose,
        },
        () => {
          // A close from an earlier generation is the one we replaced: ignore it.
          if (live.closed || live.reopens !== generation) return
          live.closer = null
          this.scheduleReopen(live)
        },
      )
      if (live.closed) { closer(); return }
      live.closer = closer
    } catch {
      this.scheduleReopen(live)
    } finally {
      live.opening = false
    }
  }

  private scheduleReopen(live: Live): void {
    if (live.closed || live.timer) return
    live.attempts++
    live.timer = setTimeout(() => {
      live.timer = null
      live.reopens++
      void this.open(live)
    }, backoffFor(live.attempts))
  }

  private close(live: Live): void {
    live.closed = true
    if (live.timer) { clearTimeout(live.timer); live.timer = null }
    live.closer?.()
    live.closer = null
    this.records.delete(live.id)
  }
}
