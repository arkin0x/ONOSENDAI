/**
 * smashRun.ts - the smash wired to the app: TERRAIN's hold, the field's
 * blocks, your layer, the shatter on screen, the blueprints you hold and the
 * prizes that appear (lib/blueprint/smash.ts has the rules, without the app).
 *
 * The hold (terrain/smashHold.ts) fixes the block hit; when it completes the
 * held Compiler swings (SWING_MS), and at the impact the group is cleared in
 * your layer and the shatter starts. The key is made during the shatter, and
 * the outcome shows no sooner than RESOLVE_AFTER_MS after the impact: toys
 * where the build stood (store/useBlueprints.ts, scene/PrizeToys.tsx), or
 * grey dust and one line.
 */

import { sha256 } from '@noble/hashes/sha2.js'
import { useTerrain, terrainSession, cellInReach, OUT_OF_REACH } from '../../store/useTerrain'
import { useSmashFx } from '../../store/useSmashFx'
import { useBlueprints } from '../../store/useBlueprints'
import { useCyberspace } from '../../store/useCyberspace'
import { useInventory } from '../../store/useInventory'
import { useMutes } from '../../store/useMutes'
import { followsKnown } from '../../store/terrainShare'
import { cancelSmashHold as cancelHold, startSmashHold, useSmashHold } from '../../terrain/smashHold'
import { humStart, humStop, impact, whoosh } from './smashSound'
import { terrainCursor } from '../../scene/TerrainLayer'
import { isCompiler } from '../terrain/terrainDb'
import { query } from '../relay'
import { regionKeyAt } from '../shardCrypto'
import { bytesToHex, type NostrEvent } from '../events'
import { readItem, SHARD_KIND } from '../hidden'
import { heldFromEntry } from '../inventory'
import { BARE_HOLD_MS, COMPILER_HOLD_MS, MISS_LINE, RESOLVE_AFTER_MS, SWING_MS, compile, dropStep, relayAsker, smashGroup, type Found, type SmashDeps } from './smash'
import { readRecord, type Prize, type RecordEvent } from './format'
import type { ToyRow } from './blueprintDb'

/** Whether the Compiler is the chosen slot (otherwise the hand is bare). */
export function compilerInHand(): boolean {
  const inv = useTerrain.getState().inventory
  return isCompiler(inv.hotbar[inv.slot])
}

/** Start the smash hold at the block under the cross: 3 seconds with the Compiler, 20 bare. */
export function holdSmash(): void {
  const s = terrainSession
  const hit = terrainCursor.hit
  if (!s || !hit) { useTerrain.getState().say('Aim at a block to smash it.'); return }
  if (!cellInReach(s, hit.cell)) { useTerrain.getState().say(OUT_OF_REACH); return }
  if (useSmashHold.getState().since !== null) return
  const bare = !compilerInHand()
  const ms = bare ? BARE_HOLD_MS : COMPILER_HOLD_MS
  humStart(ms)
  startSmashHold(hit.cell, ms, bare, (target, b) => {
    humStop()
    whoosh()
    setTimeout(() => { void strike(target, b) }, SWING_MS)
  })
}

/** Let go before the end: nothing is spent. */
export function cancelSmashHold(): void {
  if (useSmashHold.getState().since === null) return
  humStop()
  cancelHold()
}

/** The app's side of a smash (lib/blueprint/smash.ts SmashDeps), for the box at `lo` (cyberspace coordinates) of size `size`. */
function depsFor(lo: { x: bigint; y: bigint; z: bigint }, size: readonly [number, number, number]): SmashDeps {
  const cs = useCyberspace.getState()
  const me = cs.identity.pubkey
  return {
    known: (lookup) => useBlueprints.getState().recordsFor(lookup),
    relay: relayAsker((f) => query(f), () => useCyberspace.getState().live),
    remember: (records) => useBlueprints.getState().remember(records as NostrEvent[]),
    me: () => me,
    follows: () => followsKnown(me),
    muted: () => useMutes.getState().muted.pubkeys,
    // The heights of location-locked blueprints you hold (DECK-0010 §3.5).
    lockHeights: () => {
      const out: number[] = []
      for (const c of useBlueprints.getState().cards) {
        const v = readRecord(c.record)
        if (v?.sheet.lock === 'location' && v.sheet.height) out.push(v.sheet.height)
      }
      return out
    },
    regionKey: (h) => {
      const hi = { x: lo.x + BigInt(size[0] - 1), y: lo.y + BigInt(size[1] - 1), z: lo.z + BigInt(size[2] - 1) }
      const H = BigInt(h)
      const same = (a: bigint, b: bigint): boolean => a >> H === b >> H
      if (!same(lo.x, hi.x) || !same(lo.y, hi.y) || !same(lo.z, hi.z)) return null
      // Heights a device can compute in a moment only: a location lock is for small regions (lib/blueprint/smash.ts tries at most four).
      if (h > LOCK_HEIGHT_MAX) return null
      try { return regionKeyAt({ x: lo.x, y: lo.y, z: lo.z }, h, LOCK_HEIGHT_MAX).key } catch { return null }
    },
  }
}

/** The highest location lock this client makes or tries: its region key costs about 2^h steps. */
export const LOCK_HEIGHT_MAX = 12

let toyCount = 0

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, Math.max(0, ms)))

/** The impact: clear the group, start the shatter, compile, then show what it made. */
export async function strike(target: readonly [number, number, number], bare: boolean): Promise<void> {
  const s = terrainSession
  if (!s) return
  const read = (x: number, y: number, z: number): number => s.world.blockCs(x, y, z)
  const g = smashGroup(read, target)
  if (!g.cells.length) { useTerrain.getState().say('Nothing there to smash.'); return }
  // The blocks are spent whether or not they compile (DECK-0010 §4.3).
  const refused = useTerrain.getState().clear(g.cells)
  if (refused) { useTerrain.getState().say(refused); return }
  const centre: [number, number, number] = [0, 0, 0]
  for (const c of g.cells) for (let a = 0; a < 3; a++) centre[a] += c[a] + 0.5
  for (let a = 0; a < 3; a++) centre[a] /= g.cells.length
  const struck = performance.now()
  const id = useSmashFx.getState().start({ blocks: g.blocks, centre, struck })
  impact()
  try { navigator.vibrate?.([24, 30, 40]) } catch { /* no buzz here */ }
  // Later: an upgraded Compiler's drops (lib/blueprint/smash.ts dropStep).
  dropStep(g.blocks)
  const o = s.world.origin
  const at = { x: o.x + BigInt(Math.floor(centre[0])), y: o.y + BigInt(Math.floor(centre[1])), z: o.z + BigInt(Math.floor(centre[2])) }
  let found: Found[] = []
  let offline = false
  let unknown = 0
  if (g.isolated && g.arrangement) {
    const lo = { x: o.x + BigInt(g.lo[0]), y: o.y + BigInt(g.lo[1]), z: o.z + BigInt(g.lo[2]) }
    try { ({ found, offline, unknown } = await compile(g.arrangement, bare, depsFor(lo, g.size))) } catch { found = [] }
  }
  await wait(struck + RESOLVE_AFTER_MS - performance.now())
  if (!found.length) {
    useSmashFx.getState().resolve(id, 'miss')
    useTerrain.getState().say(offline ? 'Compiled offline. Checking when you reconnect.' : unknown ? 'It compiled into something this version cannot show yet. It is kept.' : MISS_LINE)
    return
  }
  useSmashFx.getState().resolve(id, 'match')
  const owner = useBlueprints.getState().owner || useCyberspace.getState().identity.pubkey
  const now = Math.floor(Date.now() / 1000)
  const toys: ToyRow[] = found.map((f, i) => ({
    rowKey: `${owner}/${f.lookup}/${f.record?.id ?? f.maker}/${Date.now()}-${toyCount++}/${i}`,
    owner, prize: f.prize, name: f.name, maker: f.maker, lookup: f.lookup,
    record: f.record ?? undefined,
    at: { x: at.x.toString(), y: at.y.toString(), z: at.z.toString(), plane: s.plane },
    made: now,
  }))
  useBlueprints.getState().addToys(toys)
  for (const l of new Set(found.map((f) => f.lookup))) useBlueprints.getState().noteBuilt(l)
}

/** The ITEMS row of a SNO prize: the shard as its creator made it, from this blueprint (DECK-0010 §6.3). */
function prizeEvent(prize: Extract<Prize, { type: 'sno' }>, record: RecordEvent | undefined, maker: string): NostrEvent {
  const content = JSON.stringify(prize.payload)
  const id = bytesToHex(sha256(new TextEncoder().encode(`${record?.id ?? maker}:${content}`)))
  return { id, pubkey: record?.pubkey ?? maker, created_at: record?.created_at ?? Math.floor(Date.now() / 1000), kind: SHARD_KIND, tags: [], content, sig: '' }
}

/** Take a waiting prize: the Compiler joins the bar, a shard joins ITEMS › OTHER LOOT. True when taken. */
export function takeToy(rowKey: string): boolean {
  const bp = useBlueprints.getState()
  const toy = bp.toys.find((t) => t.rowKey === rowKey)
  if (!toy) return false
  if (toy.prize.type === 'tool') {
    const had = useTerrain.getState().inventory.compiler === 'made'
    useTerrain.getState().gainCompiler()
    useTerrain.getState().say(had ? 'You already have the Compiler.' : 'The Compiler is yours: slot 1.')
  } else {
    const event = prizeEvent(toy.prize, toy.record, toy.maker)
    const body = readItem(event, event.pubkey)
    if (!body) { useTerrain.getState().say('This prize could not be read.'); return false }
    const owner = useInventory.getState().owner || useCyberspace.getState().identity.pubkey
    // The record's signature covers the sealed prize, so who made it is a fact once the record was checked.
    useInventory.getState().add([heldFromEntry(owner, { id: event.id, event, verified: true, body }, { chestId: `blueprint:${toy.lookup}`, chestName: toy.name }, null, Math.floor(Date.now() / 1000))])
  }
  bp.dropToy(rowKey)
  return true
}

// A hold is for the hand it started with: choosing another slot lets go (a Compiler hold never finishes bare, or the other way round).
useTerrain.subscribe((t, prev) => { if (t.inventory.slot !== prev.inventory.slot || t.active !== prev.active) cancelSmashHold() })

/** Whether a smash hold is under way. */
export const smashHolding = (): boolean => useSmashHold.getState().since !== null
