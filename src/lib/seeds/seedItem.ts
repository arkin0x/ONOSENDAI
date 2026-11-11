/**
 * seedItem.ts - Seeds (DECK-0008): the kinds, and a seed read out of a bag.
 *
 * A seed is an item, kind 3351, carried in a bag or a chest like a shard: it
 * names a DNA (kind 3350) by id, a planted height, a scale and its `C`, and
 * carries NIP-13 work priced by its DNA's caps (§8.2). Its bloom is never
 * published; every reader grows it (lib/seeds/blooms.ts).
 *
 * Reading a seed runs every check a reader makes BEFORE it resolves the DNA,
 * the NIP-13 precheck included (sno-core readSeed): a seed that paid less
 * than the base price never makes this client fetch anything (§8.2, "Free
 * DNAs then cannot be used to make a reader fetch on behalf of seeds that
 * paid nothing"). The price check against the DNA's own caps comes after the
 * DNA is resolved (lib/seeds/dnaStore.ts).
 */

import { readSeed, type SeedTags } from 'sno-core/seeds'
import type { Plane } from 'cyberspace-core'

/** A DNA, written or mixed (§8.1). Regular: its id is its identity. */
export const DNA_KIND = 3350
/** A seed: one planting of a DNA, an item inside a bag or a chest (§8.2). */
export const SEED_KIND = 3351
/** A tend (§8.3). Not read yet. */
export const TEND_KIND = 3352

/** How one seed's bloom stands: its turns as the tag writes them (payload frame), standing on Earth, and its spin. */
export interface SeedStand {
  turn: [number, number, number]
  up: boolean
  spin: number
}

/** A seed without orientation tags: +Y up on Cyberspace's axes. */
export const UPRIGHT: SeedStand = { turn: [0, 0, 0], up: false, spin: 0 }

const DECIMAL = /^(0|[1-9][0-9]*)$/

/**
 * A seed's orientation tags read (§5.7), or null when one is malformed and
 * the reader skips the seed: a `turn` that is not exactly three decimals from
 * 0 to 3, or a `spin` that is not a decimal from 0 to 359, with or without
 * `up`. The first tag of each name is read; `spin` counts only with `up`.
 */
export function standOf(tags: readonly (readonly string[])[]): SeedStand | null {
  const first = (n: string): readonly string[] | undefined => tags.find((t) => Array.isArray(t) && t[0] === n)
  const t = first('turn')
  const s = first('spin')
  let turn: [number, number, number] = [0, 0, 0]
  if (t) {
    if (t.length !== 4 || !t.slice(1).every((v) => typeof v === 'string' && DECIMAL.test(v) && Number(v) <= 3)) return null
    turn = [Number(t[1]), Number(t[2]), Number(t[3])]
  }
  let spin = 0
  if (s) {
    if (s.length !== 2 || typeof s[1] !== 'string' || !DECIMAL.test(s[1]) || Number(s[1]) > 359) return null
    spin = Number(s[1])
  }
  const up = first('up') !== undefined
  return { turn, up, spin: up ? spin : 0 }
}

/** A seed as this client holds it: its tags, read, and who planted it when. */
export interface SeedItem extends SeedTags {
  /** The seed event's own id: what its work is on, and what its bloom is cached by. */
  id: string
  /** Its signer: the planter. */
  planter: string
  /** Its `created_at`, which the planted-height clamp reads (§4.2). */
  createdAt: number
  /** Its tags as read, for the work check once the DNA's price is known (sno-core workOk). */
  tags: string[][]
  /** How its bloom stands (§5.7): +Y up on Cyberspace's axes unless its tags say otherwise. */
  stand: SeedStand
}

/** The fields of an event a seed is read from. */
export interface SeedEventLike {
  id: string
  kind: number
  pubkey: string
  created_at: number
  tags: string[][]
  content?: string
}

/**
 * A seed out of its event, or null when a reader skips it (§8.2): not a
 * seed, a malformed `dna`, `planted`, `scale` or `C`, or no work at the base
 * price on its id. Nothing here fetches.
 */
export function seedItemOf(ev: SeedEventLike): SeedItem | null {
  if (!ev || ev.kind !== SEED_KIND || !Array.isArray(ev.tags) || typeof ev.id !== 'string') return null
  // readSeed reads the first of each tag and checks tags it reads; a tag that is not an array of strings is not one.
  const tags = ev.tags.filter((t) => Array.isArray(t) && t.every((v) => typeof v === 'string'))
  const read = readSeed({ id: ev.id, tags, pubkey: ev.pubkey, created_at: ev.created_at, kind: ev.kind, content: ev.content })
  if (!read.ok) return null
  // A malformed turn or spin makes it a seed this client cannot read (§5.7), skipped like any other malformed tag.
  // Read from the event's own tags: a turn or spin holding anything but a decimal string is malformed, not absent.
  const stand = standOf(ev.tags)
  if (!stand) return null
  return { ...read.seed, id: ev.id, planter: ev.pubkey, createdAt: ev.created_at, tags, stand }
}

/**
 * The seeds a view in `plane` shows: those whose `C` names that plane. One bag
 * holds a region and its twin in the other plane (spec §7.6 Planes), and a
 * seed stands only in the plane of its own coordinate, as every item does.
 */
export function seedsInPlane<T extends { type: string; plane: Plane }>(items: readonly T[], plane: Plane): T[] {
  return items.filter((w) => w.type === 'seed' && w.plane === plane)
}

/**
 * Where a DNA found inside a bag goes (§8.2: the bag that holds a seed is
 * looked in first): the page's DNA resolver, once lib/seeds/seedSources.ts
 * is loaded. Kept as a sink so the bag reader (lib/hidden.ts) stays pure and
 * imports nothing that reaches the network.
 */
let bagDnaSink: ((ev: SeedEventLike & { sig?: string; content: string }) => void) | null = null

export function setBagDnaSink(sink: typeof bagDnaSink): void {
  bagDnaSink = sink
}

/** A DNA item read out of a bag: handed to the resolver, never shown as an item of its own. */
export function noteBagDna(ev: SeedEventLike & { sig?: string; content: string }): void {
  if (ev && ev.kind === DNA_KIND) bagDnaSink?.(ev)
}
