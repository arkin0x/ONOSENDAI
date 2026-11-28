/**
 * quarryHoming.ts - the Quarry Charge's drops fly to you (owner, 2026-11-28:
 * "we need the floating collectible blocks to heat seek the player within 7
 * gibsons. it takes forever to collect these!"; lib/terrain/quarry.ts has
 * the numbers).
 *
 * Every frame TERRAIN draws its drops (scene/QuarryFx.tsx calls tickHoming):
 *
 * - A drop whose middle comes within HOME_RADIUS of your body's middle sets
 *   off toward you after a short wait of its own (homeDelay: the nearer
 *   first, with a little chance), so a cloud streams in rather than moving as
 *   one. Once set off it follows you wherever you go and always arrives:
 *   it speeds up smoothly to a top speed on a slight arc (the shader in
 *   scene/quarryDrops.ts draws it from the same numbers), passing through
 *   blocks, since it is loot and not a body.
 * - It is carried when it arrives (useQuarry collectDrops), by the drop
 *   itself and not by its cell. Whatever takes it first, the flight's arrival
 *   or the walk passing over it, takes it from the drops in one step, so it
 *   is carried exactly once: the other finds it gone.
 * - Drops further than HOME_RADIUS float as they always did, and set off once
 *   you come within it.
 * - With reduced motion a drop does not fly: it fades where it is for
 *   HOME_REDUCED_MS, then is carried.
 *
 * Only the drops' owner collects them: the drops are this device's alone, and
 * none sets off while the identity, the plane or the field's saved inventory
 * says otherwise (as useQuarry collect). Any gravity and any WALK (fluid or a
 * step at a time): the body's middle is read from where the walk draws you.
 *
 * Nothing is made in a frame where no drop changes: the drops' places in the
 * field are worked out again only when the drops or the field change.
 */

import { fieldLoaded, headNow, terrainSession, type TerrainSession } from './useTerrain'
import { useCyberspace } from './useCyberspace'
import { useQuarry } from './useQuarry'
import { walkFall, walkFallUp, walkGlide } from '../lib/walkEye'
import { dropChance, flightMs, homeDelay, homeDistance, homesFrom, type Drop } from '../lib/terrain/quarry'

/** One drop's flight: when it sets off and arrives (Date.now() ms), how far it had to go, and its arc's lean (-1 to 1). */
export interface Flight {
  start: number
  arrive: number
  len: number
  side: number
  reduced: boolean
}

/** The drops flying now, by the drop itself. */
export const flights = new Map<Drop, Flight>()
/** Bumped whenever a drop sets off, so the scene writes the flights into its instances (and only then). */
export const homing = { version: 0 }
/** The body's middle as the last tick saw it, in the field's cells (cs offsets, continuous): the shader's target. */
export const bodyPoint = { x: 0, y: 0, z: 0, valid: false }

/** The drops' middles in the field, three numbers each, for the drops and the field they were worked out for. */
let places = new Float64Array(0)
let seen: { drops: readonly Drop[] | null; field: TerrainSession | null } = { drops: null, field: null }
/** The drops due this tick, kept between ticks so a tick makes nothing. */
const due: Drop[] = []

let motionQuery: MediaQueryList | null | undefined
/** Whether the person asked for less motion, from one query kept for the page (a frame asks it). */
export function reducedNow(): boolean {
  if (motionQuery === undefined) {
    try { motionQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null } catch { motionQuery = null }
  }
  return motionQuery?.matches ?? false
}

const feetAt: { p: unknown; field: TerrainSession | null; x: number; y: number; z: number } = { p: null, field: null, x: 0, y: 0, z: 0 }

/**
 * Where the body's middle is in a field, in its cells: the feet's cell and
 * the one over it (lib/terrain/quarry.ts bodyAt), at the height between them,
 * moved by fluid WALK's glide and by a fall as the walk draws them.
 */
export function readBody(s: TerrainSession, out: { x: number; y: number; z: number }): void {
  const cs = useCyberspace.getState()
  const p = headNow()
  // The feet's cell, worked out again only when the walk or the field moves it (bigints made only then).
  if (feetAt.p !== p || feetAt.field !== s) {
    const o = s.world.origin
    feetAt.p = p; feetAt.field = s
    feetAt.x = Number(p.x - o.x); feetAt.y = Number(p.y - o.y); feetAt.z = Number(p.z - o.z)
  }
  out.x = feetAt.x + 0.5
  out.y = feetAt.y + 1
  out.z = feetAt.z + 0.5
  if (cs.walking && walkGlide.active) {
    const step = 2 ** cs.scaleExp
    out.x += walkGlide.x * step
    out.y += walkGlide.y * step
    out.z += walkGlide.z * step
  }
  if (cs.walking && walkFall.active) out[walkFallUp.axis] += walkFall.offset * walkFallUp.dir
}

/** Forget every flight (a switch of identity or field: the drops they were for are gone). */
export function resetHoming(): void {
  flights.clear()
  seen = { drops: null, field: null }
  due.length = 0
  bodyPoint.valid = false
}

/**
 * One frame of the drops flying: set off those within reach, carry those
 * that arrived. Returns how many were carried. `now` is Date.now(); `body`,
 * the body's middle in the field's cells when the caller knows it, else read
 * from the walk (readBody).
 */
export function tickHoming(now: number = Date.now(), reduced: boolean = reducedNow(), body?: { x: number; y: number; z: number }): number {
  const s = terrainSession
  const q = useQuarry.getState()
  const cs = useCyberspace.getState()
  // The drops' owner on screen, in their field and plane, with its saved inventory read (as useQuarry detonate and collect).
  if (!s || q.owner !== s.owner || (cs.identity.pubkey || 'local') !== q.owner || s.plane !== cs.plane || !fieldLoaded(s)) {
    bodyPoint.valid = false
    return 0
  }
  const drops = q.drops
  // The drops' places, again only when the drops or the field changed; flights for drops gone are let go.
  if (seen.drops !== drops || seen.field !== s) {
    if (seen.field !== s) flights.clear()
    seen = { drops, field: s }
    if (places.length < drops.length * 3) places = new Float64Array(Math.max(48, drops.length * 6))
    const o = s.world.origin
    drops.forEach((d, i) => {
      places[i * 3] = Number(BigInt(d.x) - o.x) + 0.5
      places[i * 3 + 1] = Number(BigInt(d.y) - o.y) + 0.5
      places[i * 3 + 2] = Number(BigInt(d.z) - o.z) + 0.5
    })
    if (flights.size) {
      const kept = new Set(drops)
      for (const d of flights.keys()) if (!kept.has(d)) flights.delete(d)
    }
  }
  if (body) { bodyPoint.x = body.x; bodyPoint.y = body.y; bodyPoint.z = body.z }
  else readBody(s, bodyPoint)
  bodyPoint.valid = true
  let started = false
  due.length = 0
  for (let i = 0; i < drops.length; i++) {
    const d = drops[i]
    const f = flights.get(d)
    if (f) {
      if (now >= f.arrive) due.push(d)
      continue
    }
    if (d.plane !== s.plane || d.expires <= now) continue
    const dx = places[i * 3] - bodyPoint.x, dy = places[i * 3 + 1] - bodyPoint.y, dz = places[i * 3 + 2] - bodyPoint.z
    const dist = homeDistance(dx, dy, dz)
    if (!homesFrom(dist)) continue
    const chance = dropChance(places[i * 3], places[i * 3 + 1], places[i * 3 + 2])
    const start = now + homeDelay(dist, chance, reduced)
    flights.set(d, { start, arrive: start + flightMs(dist, reduced), len: dist, side: chance * 2 - 1, reduced })
    started = true
  }
  if (started) homing.version++
  if (!due.length) return 0
  const n = q.collectDrops(due, true)
  // Arrived: carried now, or already taken by the walk. Either way its flight is over.
  for (const d of due) flights.delete(d)
  due.length = 0
  return n
}

/** Whether any drop is flying now in the field on screen (the frame driver draws every frame while one does). */
export const dropsFlying = (): boolean => flights.size > 0 && terrainSession !== null && seen.field === terrainSession
