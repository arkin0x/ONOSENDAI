/**
 * useThumbs.ts - small pictures of objects, drawn once each and kept.
 *
 * Wherever shards are listed (the workshop's SHARDS, PLACE OBJECT, the Shard
 * Feed, bag and chest contents), a list of names is not how anyone tells them
 * apart (arkinox, 2026-10-23: "wherever there is a list of shards we need the
 * 3D preview, otherwise its so hard to remember them by name esp when there
 * are so many"). But a live 3D view per row is a WebGL context per row, and a
 * browser keeps only a handful (snocrash measured eight on a phone: past that
 * it drops the oldest, which is the newest object, at the top). So one hidden
 * canvas (scene/ThumbStage.tsx) draws each object once, as its row scrolls
 * into view, and keeps the picture as an image. A row costs an <img>,
 * whatever the length of the list.
 *
 * This store is the queue and the pictures. A row in view WANTS its picture
 * (hud/ShardThumb.tsx): one already drawn shows at once; else one kept on the
 * device (lib/thumbDb) is read; else it joins the queue. A row that leaves
 * view before its turn takes it out again, if nothing else wants it, so a
 * fast scroll down a long list draws what is on screen and not everything it
 * passed. The newest few hundred pictures stay in memory; the device keeps
 * more.
 *
 * `request` is the older ask, for a picture drawn now and not kept on the
 * device (the item composer's ICON FROM MODEL, under a key of its own).
 */

import { create } from 'zustand'
import type { ShardModel } from 'sno-core/shards'
import { readThumb, writeThumb } from '../lib/thumbDb'
import { isComposite } from '../lib/thumbKey'

/** How many pictures are kept in memory before the oldest is let go. */
export const MAX_THUMBS = 200

export interface ThumbJob {
  key: string
  shard: ShardModel
  /** Kept on the device once drawn (lib/thumbDb). */
  keep?: boolean
  /** How many times the stage stalled on it (`stall`). */
  tries?: number
  /** Drawn with your own pieces from your workshop (lib/parts.ts fetchOwnFirst): a picture in an authoring view. */
  own?: boolean
}

export interface ThumbStore {
  /** Pictures as data URLs, by key. */
  urls: Record<string, string>
  /** What is waiting to be drawn, first first. The first is the one being drawn. */
  queue: ThumbJob[]
  /** Kept keys, oldest first, for letting the oldest go. */
  order: string[]
  /** Keys the stage could not draw: their rows show the kind's icon. */
  failed: Record<string, true>
  /** No WebGL here (or the stage keeps failing): every row shows the icon, and nothing is drawn. */
  disabled: boolean
  /** Ask for a picture now; nothing happens if it is drawn or already waiting. Not kept on the device. */
  request: (key: string, shard: ShardModel) => void
  /** A row in view wants its picture: from memory, else the device, else the queue. Counted; undo with `unwant`. */
  want: (key: string, shard: ShardModel, own?: boolean) => void
  /** A row left view or went away: out of the queue if nothing else wants it and it is not being drawn. */
  unwant: (key: string) => void
  /** The stage drew it. */
  done: (key: string, url: string) => void
  /** The stage could not draw it: drop it from the queue, keep no picture. */
  fail: (key: string) => void
  /**
   * The stage took too long over the first job (a lost context, say): it goes
   * to the back of the queue, once, then fails. MAX_STALLS different jobs
   * stalled or crashed with nothing drawn between mean the stage cannot draw
   * here, and it stops.
   */
  stall: (key: string) => void
  /** The stage threw while drawing it: it fails. Crashes count with stalls toward MAX_STALLS. */
  crash: (key: string) => void
  /** Draw nothing more this session. */
  disable: () => void
}

/** Jobs stalled or crashed on, with nothing drawn between, before the stage stops for the session. */
export const MAX_STALLS = 3
/** Times one job may stall before it fails. */
export const MAX_TRIES = 2

/** How many rows want each key. Not state: a count changing should redraw nothing. */
const wants = new Map<string, number>()
/** Keys being read from the device. */
const reading = new Set<string>()
/**
 * The jobs the stage stalled or crashed on since the last picture drawn. Jobs,
 * not stalls: one slow job stalling twice says nothing about the stage.
 */
const troubled = new Set<string>()

/** For tests: forget every want and read in flight. */
export function resetThumbWants(): void {
  wants.clear()
  reading.clear()
  troubled.clear()
}

/** How many rows want `key` (tests, and the stage's measurements). */
export function wantsOf(key: string): number {
  return wants.get(key) ?? 0
}

export const useThumbs = create<ThumbStore>((set, get) => {
  const remember = (key: string, url: string): void => {
    const { urls, order } = get()
    const next = { ...urls, [key]: url }
    const kept = [...order.filter((k) => k !== key), key]
    while (kept.length > MAX_THUMBS) delete next[kept.shift() as string]
    set({ urls: next, order: kept })
  }
  const enqueue = (job: ThumbJob): void => {
    const { urls, queue, disabled } = get()
    if (disabled || urls[job.key] || queue.some((j) => j.key === job.key)) return
    set({ queue: [...queue, job] })
  }
  return {
    urls: {},
    queue: [],
    order: [],
    failed: {},
    disabled: false,

    request: (key, shard) => enqueue({ key, shard }),

    want: (key, shard, own) => {
      wants.set(key, (wants.get(key) ?? 0) + 1)
      const { urls, queue, failed, disabled } = get()
      if (disabled || urls[key] || failed[key] || reading.has(key) || queue.some((j) => j.key === key)) return
      reading.add(key)
      void readThumb(key).then((url) => {
        reading.delete(key)
        if (url) { remember(key, url); return }
        // Scrolled past while it was read: nothing to draw.
        if ((wants.get(key) ?? 0) > 0) enqueue({ key, shard, keep: true, ...(own ? { own } : {}) })
      })
    },

    unwant: (key) => {
      const n = (wants.get(key) ?? 0) - 1
      if (n > 0) { wants.set(key, n); return }
      wants.delete(key)
      const { queue } = get()
      const i = queue.findIndex((j) => j.key === key)
      // The first is on the stage already; it finishes and is kept.
      if (i > 0) set({ queue: queue.filter((_, k) => k !== i) })
    },

    done: (key, url) => {
      troubled.clear()
      const job = get().queue.find((j) => j.key === key)
      remember(key, url)
      set({ queue: get().queue.filter((j) => j.key !== key) })
      if (job?.keep) void writeThumb(key, url, isComposite(job.shard))
    },

    fail: (key) => set({ queue: get().queue.filter((j) => j.key !== key), failed: { ...get().failed, [key]: true } }),

    stall: (key) => {
      troubled.add(key)
      if (troubled.size >= MAX_STALLS) { get().disable(); return }
      const { queue } = get()
      const job = queue.find((j) => j.key === key)
      if (!job) return
      const tries = (job.tries ?? 0) + 1
      if (tries >= MAX_TRIES) { get().fail(key); return }
      set({ queue: [...queue.filter((j) => j.key !== key), { ...job, tries }] })
    },

    crash: (key) => {
      troubled.add(key)
      if (troubled.size >= MAX_STALLS) { get().disable(); return }
      get().fail(key)
    },

    disable: () => set({ disabled: true, queue: [] }),
  }
})
