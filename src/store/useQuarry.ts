/**
 * useQuarry.ts - the Quarry Charge in play (DECK-0010 §8.6; owner,
 * 2026-11-27; lib/terrain/quarry.ts has the rules):
 *
 * - ARMED. PLACE with the charges chosen arms one in the cell PLACE names
 *   (store/useTerrain.ts place, through quarryHooks), on a face or in the air
 *   at the ghost, and takes one from the count. It burns FUSE_MS, blinking
 *   and beeping faster (scene/QuarryFx.tsx draws it and the countdown).
 * - THE BLAST. Then its box is cleared as mining would (useTerrain blast:
 *   your own layer, reach and chunks respected, published like mining), with
 *   the smash's shatter and sound, scaled up. A charge whose identity or
 *   plane is no longer on screen fizzles: it never clears another
 *   identity's layer.
 * - DROPS. Every block the blast took that mining would have carried floats
 *   in its own cell as a small copy of itself for ten minutes, then
 *   evaporates. Walking into its cell (the walk's gibson and the cell over
 *   it, along the whole step) collects it, with a soft sound. Drops are this
 *   device's alone: never published, never seen by anyone else. They are kept
 *   per npub in IndexedDB (lib/terrain/terrainDb.ts readDrops), so a reload
 *   within the ten minutes finds them with the time they had left; a switch
 *   of identity reads that identity's own and deletes nothing.
 *
 * MINING counts charges placed and blocks quarried (store/miningStats.ts,
 * never during a tutorial run); `tally` keeps this page's own.
 */

import { create } from 'zustand'
import { headNow, offsetOf, terrainSession, useTerrain, type TerrainSession } from './useTerrain'
import { quarryHooks } from './quarryHooks'
import { useCyberspace } from './useCyberspace'
import { useSmashFx } from './useSmashFx'
import { readDrops, writeDrops } from '../lib/terrain/terrainDb'
import { BLAST_HALF, FUSE_BEEPS, FUSE_MS, bodyAt, blastCells, cellKey, makeDrop, stepCells, tidyDrops, type Drop } from '../lib/terrain/quarry'
import { blastSound, fuseBeeps, pickupSound } from '../lib/blueprint/smashSound'
import { noteMining } from './miningStats'

/** One charge burning: where it stands in cyberspace, whose it is, and when it was placed. */
export interface ArmedCharge {
  id: number
  owner: string
  plane: number
  x: bigint
  y: bigint
  z: bigint
  /** performance.now() when it was placed. */
  armedAt: number
}

/** The words when a charge's identity or place is gone by its blast. */
export const FIZZLED = 'The charge fizzled: you changed identity or place.'

export interface QuarryState {
  charges: ArmedCharge[]
  /** Whose drops these are (the identity on screen when they were read or made). */
  owner: string
  drops: Drop[]
  /** Bumped whenever the drops change, so the scene builds its instances again (and only then). */
  version: number
  /** Charges placed and blocks quarried on this page. */
  tally: { placed: number; quarried: number }
  /** Arm a charge in a cell of the field (cs offsets). True when it was armed. */
  arm: (cell: readonly [number, number, number]) => boolean
  /** The blast of a charge, by id (its fuse calls it). */
  detonate: (id: number) => void
  /** Collect the drops in these cells (cyberspace cells, `x,y,z,plane` keys): carried, and gone. Returns how many. */
  collect: (keys: ReadonlySet<string>) => number
  /** Evaporate the drops past their time. */
  prune: (now?: number) => void
}

let nextId = 0
/** Each burning charge's fuse and beeps. */
const fuses = new Map<number, { timer: ReturnType<typeof setTimeout>; stop: () => void }>()
let pruneTimer: ReturnType<typeof setTimeout> | undefined

/** Keep the drops: one row per identity (never published). A failed write keeps them in memory for this page. */
function persist(owner: string, drops: readonly Drop[]): void {
  const db = terrainSession?.owner === owner ? terrainSession.db : null
  if (!db) return
  void writeDrops(db, owner, drops).catch(() => { /* kept in memory */ })
}

/** The next evaporation, timed: one timer for the soonest drop. */
function schedulePrune(): void {
  clearTimeout(pruneTimer)
  const drops = useQuarry.getState().drops
  if (!drops.length) return
  let soonest = Infinity
  for (const d of drops) soonest = Math.min(soonest, d.expires)
  pruneTimer = setTimeout(() => useQuarry.getState().prune(), Math.max(50, soonest - Date.now() + 20))
}

export const useQuarry = create<QuarryState>((set, get) => ({
  charges: [],
  owner: '',
  drops: [],
  version: 0,
  tally: { placed: 0, quarried: 0 },

  arm: (cell) => {
    const s = terrainSession
    if (!s) return false
    const o = s.world.origin
    const charge: ArmedCharge = { id: ++nextId, owner: s.owner, plane: s.plane, x: o.x + BigInt(cell[0]), y: o.y + BigInt(cell[1]), z: o.z + BigInt(cell[2]), armedAt: performance.now() }
    set({ charges: [...get().charges, charge], tally: { ...get().tally, placed: get().tally.placed + 1 } })
    // MINING (store/miningStats.ts; never during a tutorial run), for the identity that placed it.
    noteMining({ type: 'charge' }, s.owner)
    fuses.set(charge.id, { timer: setTimeout(() => get().detonate(charge.id), FUSE_MS), stop: fuseBeeps(FUSE_BEEPS) })
    return true
  },

  detonate: (id) => {
    const charge = get().charges.find((c) => c.id === id)
    const fuse = fuses.get(id)
    fuses.delete(id)
    if (fuse) clearTimeout(fuse.timer)
    if (!charge) return
    set({ charges: get().charges.filter((c) => c.id !== id) })
    const s = terrainSession
    if (!s || s.owner !== charge.owner || s.plane !== charge.plane) {
      fuse?.stop()
      useTerrain.getState().say(FIZZLED)
      return
    }
    const o = s.world.origin
    const centre: [number, number, number] = [Number(charge.x - o.x), Number(charge.y - o.y), Number(charge.z - o.z)]
    const taken = useTerrain.getState().blast(blastCells(centre))
    // The smash's shatter and sound, scaled to the whole box (store/useSmashFx.ts minRadius).
    const fx = useSmashFx.getState()
    const show = fx.start({ blocks: taken.map((t) => ({ at: t.at, id: t.id })), centre: [centre[0] + 0.5, centre[1] + 0.5, centre[2] + 0.5], struck: performance.now(), minRadius: BLAST_HALF + 1 })
    fx.resolve(show, 'match')
    blastSound(taken.length)
    try { navigator.vibrate?.([40, 30, 80]) } catch { /* no buzz here */ }
    // What mining would have carried floats where it was, for the walk to collect.
    const now = Date.now()
    const made: Drop[] = []
    for (const t of taken) if (t.carry > 0) made.push(makeDrop(o.x + BigInt(t.at[0]), o.y + BigInt(t.at[1]), o.z + BigInt(t.at[2]), s.plane, t.carry, now))
    const st = get()
    const drops = st.owner === s.owner ? [...st.drops, ...made] : made
    set({ owner: s.owner, drops, version: st.version + 1, tally: { ...st.tally, quarried: st.tally.quarried + taken.length } })
    // As a smash counts the blocks it cleared: the blocks this blast took, for the identity whose layer it wrote.
    if (taken.length) noteMining({ type: 'blast', blocks: taken.length }, s.owner)
    persist(s.owner, drops)
    schedulePrune()
    // Standing in the blast: what is round you now is collected at once.
    collectWhereYouAre(null)
  },

  collect: (keys) => {
    const st = get()
    const s = terrainSession
    if (!keys.size || !st.drops.length || !s || s.owner !== st.owner) return 0
    const now = Date.now()
    const got = new Map<number, number>()
    const left: Drop[] = []
    for (const d of st.drops) {
      if (d.expires > now && keys.has(d.key)) got.set(d.id, (got.get(d.id) ?? 0) + 1)
      else left.push(d)
    }
    if (!got.size) return 0
    let n = 0
    for (const [id, count] of got) { useTerrain.getState().carry(id, count); n += count }
    set({ drops: left, version: st.version + 1 })
    persist(st.owner, left)
    pickupSound()
    schedulePrune()
    return n
  },

  prune: (now = Date.now()) => {
    const st = get()
    const left = st.drops.filter((d) => d.expires > now)
    if (left.length !== st.drops.length) {
      set({ drops: left, version: st.version + 1 })
      persist(st.owner, left)
    }
    schedulePrune()
  },
}))

/** The walk's last cell (cs offsets in that field), so a step collects all it passed through. */
let lastFeet: { field: TerrainSession | null; at: [number, number, number] | null } = { field: null, at: null }

/** Collect what the body passes through, from where it was to where it is (`prev`: null to count only where it stands). */
function collectWhereYouAre(prev: readonly [number, number, number] | null): void {
  const s = terrainSession
  if (!s || s.plane !== useCyberspace.getState().plane) return
  const feet = offsetOf(s, headNow())
  const st = useQuarry.getState()
  if (!st.drops.length || st.owner !== s.owner) return
  const o = s.world.origin
  const keys = new Set<string>()
  for (const c of stepCells(prev, feet)) for (const b of bodyAt(c)) keys.add(cellKey(o.x + BigInt(b[0]), o.y + BigInt(b[1]), o.z + BigInt(b[2]), s.plane))
  st.collect(keys)
}

// Every step, in any mode: what the body passes through is collected.
useCyberspace.subscribe((c, prev) => {
  if (c.cursor === prev.cursor && c.position === prev.position && c.walking === prev.walking) return
  const s = terrainSession
  if (!s) { lastFeet = { field: null, at: null }; return }
  const feet = offsetOf(s, headNow())
  const from = lastFeet.field === s ? lastFeet.at : null
  lastFeet = { field: s, at: feet }
  if (useQuarry.getState().drops.length) collectWhereYouAre(from)
})

// Each field, once what it kept is read: its identity's drops, with the time they have left.
quarryHooks.fieldReady.push((s) => {
  const owner = s.owner
  const mine = useQuarry.getState().owner === owner ? useQuarry.getState().drops : []
  if (useQuarry.getState().owner !== owner) useQuarry.setState({ owner, drops: [], version: useQuarry.getState().version + 1 })
  if (!s.db) return
  void readDrops(s.db, owner).then((raw) => {
    if (terrainSession !== s || useQuarry.getState().owner !== owner) return
    const now = Date.now()
    const kept = tidyDrops(raw, now)
    // Drops made on this page before the read landed stay with what was kept.
    const fresh = useQuarry.getState().drops.filter((d) => !mine.includes(d))
    useQuarry.setState({ drops: [...kept, ...fresh], version: useQuarry.getState().version + 1 })
    schedulePrune()
    collectWhereYouAre(null)
  }, () => { /* none kept, or none readable: none */ })
})

quarryHooks.arm = (cell) => useQuarry.getState().arm(cell)
quarryHooks.chargeAt = (cell) => {
  const s = terrainSession
  if (!s) return false
  const o = s.world.origin
  const x = o.x + BigInt(cell[0]), y = o.y + BigInt(cell[1]), z = o.z + BigInt(cell[2])
  return useQuarry.getState().charges.some((c) => c.x === x && c.y === y && c.z === z && c.plane === s.plane)
}

/** Whether a fuse is burning (the frame driver draws every frame while one does). */
export const fuseBurning = (): boolean => useQuarry.getState().charges.length > 0

// Development only: the charges and drops, for browser probes (never in a production build).
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __quarry?: unknown }).__quarry = { state: () => useQuarry.getState(), terrain: () => useTerrain.getState() }
}
