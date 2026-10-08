/**
 * useThumbs.ts - small pictures of objects, drawn once each and kept.
 *
 * The Shard Feed is a list of other people's objects, and a list of names is
 * not how anyone chooses one. But a live 3D view per tile is a WebGL context
 * per tile, and a browser keeps only a handful (snocrash measured eight on a
 * phone: past that it drops the oldest, which is the newest object, at the
 * top). So one hidden canvas (scene/ThumbStage.tsx) draws each object once, as
 * a tile scrolls into view, and keeps the picture as an image. A tile costs
 * an <img>, whatever the length of the list.
 *
 * This store is the queue and the pictures. The newest few hundred are kept;
 * an older one is drawn again if it is scrolled back to.
 */

import { create } from 'zustand'
import type { ShardModel } from 'sno-core/shards'

/** How many pictures are kept before the oldest is let go. */
export const MAX_THUMBS = 200

export interface ThumbJob {
  key: string
  shard: ShardModel
}

export interface ThumbStore {
  /** Pictures as data URLs, by key (an event id). */
  urls: Record<string, string>
  /** What is waiting to be drawn, first first. */
  queue: ThumbJob[]
  /** Kept keys, oldest first, for letting the oldest go. */
  order: string[]
  /** Ask for a picture; nothing happens if it is drawn or already waiting. */
  request: (key: string, shard: ShardModel) => void
  /** The stage drew the first job in the queue. */
  done: (key: string, url: string) => void
  /** The stage could not draw it: drop it from the queue, keep no picture. */
  fail: (key: string) => void
}

export const useThumbs = create<ThumbStore>((set, get) => ({
  urls: {},
  queue: [],
  order: [],

  request: (key, shard) => {
    const { urls, queue } = get()
    if (urls[key] || queue.some((j) => j.key === key)) return
    set({ queue: [...queue, { key, shard }] })
  },

  done: (key, url) => {
    const { urls, order, queue } = get()
    const next = { ...urls, [key]: url }
    const kept = [...order.filter((k) => k !== key), key]
    while (kept.length > MAX_THUMBS) delete next[kept.shift() as string]
    set({ urls: next, order: kept, queue: queue.filter((j) => j.key !== key) })
  },

  fail: (key) => set({ queue: get().queue.filter((j) => j.key !== key) }),
}))
