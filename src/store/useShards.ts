/**
 * useShards.ts — hiding things at a location, and everything visible in the world.
 *
 * A hidden thing is a shard or a text message: a signed inner event, kept in a
 * region BAG — one location-encrypted kind:33330 envelope per (author, region,
 * height), holding every item that author hid there. Deploying reads the bag,
 * appends the new item, and rewrites it (spec §8.6: keyed by d=lookup_id, and
 * addressable, so the newer bag replaces the old). One envelope, many items, no
 * per-item tags. Height is the discovery radius (spec §7.3): 0 is a single
 * gibson; higher hides it across a wider aligned cube that costs more to find.
 *
 * `mine` is what this identity deployed, placed from this device or found by a
 * scan after another device placed it, kept with each item's signed inner
 * event so a bag can be rebuilt without the relay; `discovered` is what a scan
 * turned up near you and could decrypt and verify.
 */

import { clampUnit, normalizeStored } from 'sno-core/shards'
import { snapOffered, wrapSpin } from '../lib/pose'
import { create } from 'zustand'
import { MAX_COMPUTE_HEIGHT, useCyberspace } from './useCyberspace'
import { publishMany, query, relaySet } from '../lib/relay'
import { bytesToHex, hexToBytes, type NostrEvent } from '../lib/events'
import { regionKeyAt } from '../lib/shardCrypto'
import { regionKeyOffThread } from '../lib/regionKeyOffThread'
import { cloudKeyQuote, deployCeiling, deployRoute, localKeyCeiling, needsAsk } from '../lib/deployPlan'
import { useSecrets } from './useSecrets'
import {
  HIDDEN_KIND,
  bagInners,
  bagTemplate,
  messageInnerTemplate,
  shardInnerTemplate,
  shardRefusal,
  unbag,
  type Hidden,
  type HiddenType,
} from '../lib/hidden'
import { useWorkshop } from './useWorkshop'
import { useCeremony } from './useCeremony'
import type { ShardModel } from 'sno-core/shards'
import type { Plane } from 'cyberspace-core'
import type { Position } from '../lib/space'
import type { NearbyReturn } from '../lib/nearbyReturn'

/** One item this device hid. Its identity is its inner event id. */
export interface MyDeployment {
  /** The item's stable identity: its signed inner event id. */
  eventId: string
  /** The signed inner event, so the region bag can be rebuilt from here. */
  inner: NostrEvent
  /** The envelope currently holding it; changes when the bag is rewritten. */
  bagId: string
  type: HiddenType
  shard?: ShardModel
  text?: string
  at: { x: string; y: string; z: string }
  plane: Plane
  height: number
  lookupId: string
  keyHex: string
  relays: string[]
  createdAt: number
  published: boolean
}

/** Something placed in the world, ready to draw. */
export interface WorldItem {
  key: string
  type: HiddenType
  at: Position
  plane: Plane
  height: number
  mine: boolean
  author?: string
  shard?: ShardModel
  text?: string
  createdAt?: number
  /** The bag's lookup id, for anything addressed to the bag (comments). */
  lookupId?: string
}

/** What a deploy is placing, before it lands. */
export type DeployPending =
  | { type: 'shard'; shardId: string }
  | { type: 'message'; text: string }

/** The realistic ceiling for interactive scanning (spec §7.3 says 0..16). */
export const SCAN_MAX_HEIGHT = 12

export type DeployStatus = 'idle' | 'working' | 'done' | 'error'

interface ShardsState {
  pending: DeployPending | null
  deployHeight: number
  /**
   * The size this deployment goes out at: one model unit is 2^deployUnit
   * gibsons, exactly as `unit` means on the shard itself. Seeded from the
   * shard's own unit when the deploy starts, so a deploy that never touches
   * the control places the shard at the size the workshop built it.
   * Meaningless for a message, which has no size.
   */
  deployUnit: number
  /**
   * Stand this deployment on the Earth: its bottom to the ground at the place
   * it is hidden, its +Z facing `deploySpin` (lib/pose.ts). Offered in
   * dataspace at SNAP_MIN_HEIGHT and above, and written into the payload only
   * when it is offered, so a shard can never claim to stand where there is no
   * ground under it.
   */
  deployUp: boolean
  /** The compass bearing the standing shard's +Z faces: whole degrees 0..359, clockwise from north. */
  deploySpin: number
  /**
   * The camera owns the spin: while this is on, orbiting turns the shard so
   * its +Z faces the way you are looking, which is how the bench presents it.
   * A preview control, never written to the wire; what lands is `deploySpin`
   * wherever it was left.
   */
  deployFollow: boolean
  deployStatus: DeployStatus
  /** What the deploy is doing right now, for the button: computing, buying, publishing. */
  deployNote: string | null
  /** A HOSAKA purchase waiting for a yes: the price and the wait. Null when not asking. */
  deployAsk: { sats: number | null; seconds: number | null } | null
  deployError: string | null
  mine: MyDeployment[]
  discovered: Record<string, Hidden>
  deleted: Record<string, true>
  /** Bags taken down from here, by `author:lookupId`: what the public LOOT list matches on. */
  deletedBags: Record<string, true>
  inspecting: string | null
  scanning: boolean
  /** The region whose bag is being sent to the relays right now, by lookup id. */
  broadcasting: string | null
  /** Why the last broadcast failed, for the row that asked for it. */
  broadcastError: string | null
  /** A world item clicked open, by its inner event id. */
  selectedSecret: string | null
  /** Whether the Nearby Loot list is on screen: what is decrypted where you stand. */
  nearbyOpen: boolean
  setNearbyOpen: (open: boolean) => void
  /** What VIEW on a Nearby Loot row will return to (lib/nearbyReturn.ts); null when nothing is pending. */
  nearbyReturn: NearbyReturn | null
  setNearbyReturn: (r: NearbyReturn | null) => void

  startDeployShard: (shardId: string) => void
  startDeployMessage: (text: string) => void
  setDeployHeight: (h: number) => void
  /** Set the size this deployment goes out at, inside the same bounds the workshop uses. */
  setDeployUnit: (unit: number) => void
  /** Stand it up, or lay it back on cyberspace axes as it was built. */
  setDeployUp: (up: boolean) => void
  /** Aim the standing shard: a compass bearing, wrapped into 0..359. */
  setDeploySpin: (spin: number) => void
  /** Hand the spin to the camera, or take it back. */
  setDeployFollow: (follow: boolean) => void
  /** The highest height the deploy bar offers: this machine's, or HOSAKA's when cloud compute is on. */
  deployCeiling: () => number
  /** Answer the ask: yes goes to HOSAKA, no keeps the shard pending. */
  confirmDeploy: () => void
  declineDeploy: () => void
  cancelDeploy: () => void
  /** Hide the pending thing at the cursor. `confirmed` is the yes to a HOSAKA ask. */
  deploy: (confirmed?: boolean) => Promise<void>
  deleteInstance: (eventId: string) => Promise<void>
  /** Send a region's bag to the relays now: what LOCAL deferred. */
  broadcast: (lookupId: string) => Promise<boolean>
  /** Ask the relay what is hidden in one region you hold the key to, and open it. */
  rescan: (lookupId: string, keyHex: string) => Promise<number>
  inspect: (eventId: string | null) => void
  selectSecret: (eventId: string | null) => void
  /** File what a scan opened. A find this identity wrote joins `mine` as well, whichever device placed it. */
  addDiscovered: (items: Hidden[]) => void
  /**
   * The items among these that earn the reveal and the toast: never opened on
   * this device before, not this identity's own, not deleted. The scan and a
   * rescan both ask here, so "new" means one thing everywhere.
   */
  freshOf: (items: Hidden[]) => Hidden[]
  setScanning: (scanning: boolean) => void
  /**
   * Prove the round trip a stranger would make: derive the key from the
   * coordinate, ask the relays, open what comes back. `refused` means the bag
   * came back and this item is in it, but the format refuses it, so no client
   * can show it; the fix is in the workshop, not on the relay.
   */
  testDiscovery: (eventId: string) => Promise<'found' | 'missing' | 'refused'>
  pendingShard: () => ShardModel | null
  worldItems: () => WorldItem[]
  /** The clicked item, mine or discovered, as one shape. */
  secretByEvent: (eventId: string) => WorldItem | null
}

const MINE_KEY = 'onosendai:deployments'
/**
 * Event ids this device has ever opened, newest last. `discovered` is memory
 * only and starts empty on every load, so without this the first scan after a
 * reload revealed everything it opened again, with the decode and the toast,
 * as if it had never been found (arkinox, 2026-09-25). Ids only: the items
 * themselves are refetched from the relay as they always were.
 */
const SEEN_KEY = 'onosendai:seen'
/** Enough for years of finds; the oldest fall off past it. */
const SEEN_MAX = 5000

function loadSeen(): Set<string> {
  try {
    const list = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]')
    return new Set(Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [])
  } catch { return new Set() }
}
const seen = loadSeen()

function remember(ids: string[]): void {
  let added = false
  for (const id of ids) if (!seen.has(id)) { seen.add(id); added = true }
  if (!added) return
  const list = [...seen].slice(-SEEN_MAX)
  if (list.length < seen.size) { seen.clear(); for (const id of list) seen.add(id) }
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(list)) } catch { /* quota or private mode */ }
}
const DELETED_KEY = 'onosendai:deployments-deleted'
/** Bags this identity has taken down, by `author:lookupId`, which is a loot row's own key. */
const DELETED_BAGS_KEY = 'onosendai:bags-deleted'

function loadMine(): MyDeployment[] {
  try {
    const raw = localStorage.getItem(MINE_KEY)
    if (!raw) return []
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list.filter((d) => d && d.eventId && d.inner && (d.shard || d.text)).map((d) => (d.shard ? { ...d, shard: normalizeStored(d.shard) } : d)) : []
  } catch { return [] }
}

function saveMine(mine: MyDeployment[]): void {
  try { localStorage.setItem(MINE_KEY, JSON.stringify(mine)) } catch { /* quota or private mode */ }
}

function loadDeleted(): Record<string, true> {
  try {
    const raw = localStorage.getItem(DELETED_KEY)
    if (!raw) return {}
    const list = JSON.parse(raw)
    const out: Record<string, true> = {}
    if (Array.isArray(list)) for (const id of list) if (typeof id === 'string') out[id] = true
    return out
  } catch { return {} }
}

function saveDeleted(deleted: Record<string, true>): void {
  try { localStorage.setItem(DELETED_KEY, JSON.stringify(Object.keys(deleted))) } catch { /* quota or private mode */ }
}

/**
 * The bags this identity has taken down.
 *
 * `deleted` above is keyed by the event id of the thing inside a bag, which
 * is the right key for the Stash and for a scan. The public LOOT list is a
 * list of bags, keyed by author and lookup id, and it never asked the Stash
 * anything, so a bag taken down still appeared there. This is the key that
 * list can match, and it lives on disk because that list survives a reload.
 */
export function loadDeletedBags(): Record<string, true> {
  try {
    const raw = localStorage.getItem(DELETED_BAGS_KEY)
    const list = raw ? (JSON.parse(raw) as unknown) : []
    const out: Record<string, true> = {}
    if (Array.isArray(list)) for (const k of list) if (typeof k === 'string') out[k] = true
    return out
  } catch {
    return {}
  }
}

function saveDeletedBags(bags: Record<string, true>): void {
  try { localStorage.setItem(DELETED_BAGS_KEY, JSON.stringify(Object.keys(bags))) } catch { /* quota or private mode */ }
}

export function positionOf(d: { at: { x: string; y: string; z: string } }): Position {
  return { x: BigInt(d.at.x), y: BigInt(d.at.y), z: BigInt(d.at.z) }
}

/** The reverse: a position as the decimal strings a deployment keeps. */
function storedAt(p: Position): { x: string; y: string; z: string } {
  return { x: p.x.toString(), y: p.y.toString(), z: p.z.toString() }
}

/** Union of inner events by id, order preserved. */
function mergeInners(a: NostrEvent[], b: NostrEvent[]): NostrEvent[] {
  const seen = new Set(a.map((e) => e.id))
  const out = a.slice()
  for (const e of b) if (!seen.has(e.id)) { seen.add(e.id); out.push(e) }
  return out
}

/**
 * A per-region clock so each rewrite of a bag is strictly newer than the last,
 * which is what makes the relay keep the new one (addressable replacement takes
 * the greatest created_at). Session-local; seeded from what is already on disk.
 */
const bagClock = new Map<string, number>()
function nextBagAt(lookupId: string): number {
  const now = Math.floor(Date.now() / 1000)
  const at = Math.max(now, (bagClock.get(lookupId) ?? 0) + 1)
  bagClock.set(lookupId, at)
  return at
}

export const useShards = create<ShardsState>((set, get) => {
  const cyber = () => useCyberspace.getState()

  /** Build and publish the region bag. */
  async function publishBag(inners: NostrEvent[], key: Uint8Array, lookupId: string, height: number, live: boolean): Promise<{ event: NostrEvent; published: boolean }> {
    const createdAt = nextBagAt(lookupId)
    const event = await cyber().signEvent(await bagTemplate(inners, key, lookupId, height, createdAt))
    const result = live ? await publishMany(relaySet(), event) : { ok: true as const }
    return { event, published: live && result.ok }
  }

  /** The author's current bag inners for a region: relay (authoritative) + local. */
  async function gatherInners(lookupId: string, key: Uint8Array, live: boolean): Promise<NostrEvent[]> {
    const local = get().mine.filter((d) => d.lookupId === lookupId).map((d) => d.inner)
    if (!live) return local
    try {
      const events = await query({ kinds: [HIDDEN_KIND], authors: [cyber().identity.pubkey], '#d': [lookupId] })
      const newest = events.sort((a, b) => b.created_at - a.created_at)[0]
      const relay = newest ? await bagInners(newest, key) : []
      return mergeInners(relay, local)
    } catch {
      return local
    }
  }

  /**
   * A find this identity wrote is a deployment, whichever device placed it.
   *
   * `mine` lives in this device's localStorage and was written only at deploy
   * time, so a bag hidden from the phone and opened by a scan on the desktop
   * went into `discovered` and no further: the Stash's DEPLOYED list stayed
   * empty there. The author is proven (unbag verified the inner signature
   * against the envelope's pubkey), and the find carries the inner event and
   * the key that opened it, which is everything a row needs to be rescanned,
   * broadcast or deleted from here. The relays are the set the scan asked.
   * What is already listed or deleted here stays as it is.
   */
  function claimOwn(items: Hidden[]): void {
    const me = cyber().identity.pubkey
    const { mine, deleted } = get()
    const have = new Set(mine.map((d) => d.eventId))
    const own: MyDeployment[] = []
    for (const h of items) {
      if (h.author !== me || !h.inner || !h.keyHex || have.has(h.eventId) || deleted[h.eventId]) continue
      have.add(h.eventId)
      own.push({
        eventId: h.eventId, inner: h.inner, bagId: h.bagId, type: h.type, shard: h.shard, text: h.text,
        at: storedAt(h.at), plane: h.plane, height: h.height, lookupId: h.lookupId, keyHex: h.keyHex,
        relays: relaySet(), createdAt: h.createdAt, published: true,
      })
    }
    if (own.length === 0) return
    const next = [...mine, ...own]
    set({ mine: next })
    saveMine(next)
  }

  return {
    pending: null,
    deployHeight: 0,
    deployUnit: 0,
    deployUp: false,
    deploySpin: 0,
    deployFollow: false,
    deployStatus: 'idle',
    deployNote: null,
    deployAsk: null,
    deployError: null,
    mine: loadMine(),
    discovered: {},
    deleted: loadDeleted(),
    deletedBags: loadDeletedBags(),
    inspecting: null,
    scanning: false,
    broadcasting: null,
    broadcastError: null,
    selectedSecret: null,
    nearbyOpen: false,
    nearbyReturn: null,
    setNearbyOpen: (open) => set({ nearbyOpen: open }),
    setNearbyReturn: (r) => set({ nearbyReturn: r }),

    // A new deploy starts at the shard's own size, so the last deploy's choice
    // never carries silently into this one.
    startDeployShard: (shardId) => set({
      pending: { type: 'shard', shardId },
      deployUnit: useWorkshop.getState().shards.find((s) => s.id === shardId)?.unit ?? 0,
      // Flat, aimed north, the camera not driving: the last deploy's pose no
      // more carries into this one than its size does.
      deployUp: false,
      deploySpin: 0,
      deployFollow: false,
      deployStatus: 'idle',
      deployError: null,
    }),
    startDeployMessage: (text) => set({ pending: { type: 'message', text }, deployUnit: 0, deployUp: false, deploySpin: 0, deployFollow: false, deployStatus: 'idle', deployError: null }),
    // Buryable up to the compute ceiling (past that the region derivation
    // throws); discovery only auto-scans to SCAN_MAX_HEIGHT, which the DeployBar
    // warns about.
    setDeployHeight: (h) => {
      const height = Math.max(0, Math.min(get().deployCeiling(), Math.round(h)))
      // Below the snap's height there is no snap: the control goes away, and
      // so does what it was set to, rather than lying in wait.
      const offered = snapOffered(cyber().plane, height)
      set({ deployHeight: height, deployAsk: null, ...(offered ? {} : { deployUp: false, deployFollow: false }) })
    },
    setDeployUnit: (unit) => set({ deployUnit: clampUnit(unit) }),
    setDeployUp: (up) => set({ deployUp: up, ...(up ? {} : { deployFollow: false }) }),
    setDeploySpin: (spin) => set({ deploySpin: wrapSpin(spin) }),
    setDeployFollow: (follow) => set({ deployFollow: follow }),
    deployCeiling: () => {
      const cs = cyber()
      return deployCeiling({ localMax: localKeyCeiling(), cloudMode: cs.cloudPrefs.mode, cloudCap: cs.cloud.limits?.max_hop_height ?? null })
    },
    cancelDeploy: () => set({ pending: null, deployStatus: 'idle', deployError: null, deployNote: null, deployAsk: null }),
    confirmDeploy: () => { set({ deployAsk: null }); void get().deploy(true) },
    declineDeploy: () => set({ deployAsk: null }),

    deploy: async (confirmed = false) => {
      const { pending, deployHeight, deployUnit, deployUp, deploySpin } = get()
      if (!pending) return
      const cs = cyber()
      const at: Position = { ...cs.cursor }
      const plane = cs.plane
      const createdAt = Math.floor(Date.now() / 1000)

      // Where the key comes from. Above this machine's ceiling it is HOSAKA's,
      // priced as a hop at that height, and the Cloud compute panel's mode says
      // whether to ask first.
      const inputs = { localMax: localKeyCeiling(), cloudMode: cs.cloudPrefs.mode, cloudCap: cs.cloud.limits?.max_hop_height ?? null }
      const route = deployRoute(deployHeight, inputs)
      if (route === 'cloud') {
        if (cs.cloudPrefs.mode === 'off' || deployHeight > deployCeiling(inputs)) {
          set({ deployStatus: 'error', deployError: `Height ${deployHeight} is past what this machine computes, and cloud compute is off.` })
          return
        }
        const quote = cloudKeyQuote(deployHeight, cs.cloud.provider?.pricing?.hop)
        if (!confirmed && needsAsk(cs.cloudPrefs.mode, quote?.sats ?? null, cs.cloudPrefs.autoMaxSats)) {
          set({ deployAsk: { sats: quote?.sats ?? null, seconds: quote?.seconds ?? null }, deployError: null })
          return
        }
      }

      let shard: ShardModel | undefined
      let text: string | undefined
      let innerTemplate
      if (pending.type === 'shard') {
        const model = useWorkshop.getState().shards.find((s) => s.id === pending.shardId)
        if (!model || model.vertices.length === 0) return
        // The deploy carries its own size. A unit the deploy bar changed makes
        // a copy rather than writing back to the bench, so the same shard can
        // be placed twice at two sizes and the workshop's model is untouched
        // either time; the payload `toPayload` builds takes the unit from here.
        // The pose goes out with the size, and only where there is ground to
        // stand on: dataspace, at SNAP_MIN_HEIGHT and above (lib/pose.ts).
        const up = deployUp && snapOffered(plane, deployHeight)
        const spin = up ? wrapSpin(deploySpin) : 0
        shard = model.unit === deployUnit && model.up === up && model.spin === spin
          ? model
          : { ...model, unit: deployUnit, up, spin }
        // The same round trip every reader makes, before the seal: an item the
        // format refuses would deploy, show for its author from this device,
        // and open as nothing for everyone else (a 516-vertex floor, 2026-09-24).
        const refusal = shardRefusal(shard)
        if (refusal) {
          set({ deployStatus: 'error', deployError: refusal })
          return
        }
        innerTemplate = shardInnerTemplate(shard, at, plane, createdAt)
      } else {
        text = pending.text.trim()
        if (!text) return
        innerTemplate = messageInnerTemplate(text, at, plane, createdAt)
      }

      set({ deployStatus: 'working', deployError: null, deployAsk: null })
      try {
        let rk: { key: Uint8Array; lookupId: string }
        if (route === 'cloud') {
          set({ deployNote: `HOSAKA has the 2^${deployHeight} key` })
          const held = await useSecrets.getState().buy(at, plane, deployHeight)
          if (!held) throw new Error(useSecrets.getState().buyError ?? 'HOSAKA could not compute the key.')
          rk = { key: hexToBytes(held.keyHex), lookupId: held.lookupId }
        } else {
          set({ deployNote: `Computing the 2^${deployHeight} key on this machine` })
          rk = await regionKeyOffThread(at, deployHeight, MAX_COMPUTE_HEIGHT)
        }
        set({ deployNote: 'Sealing and publishing' })
        const inner = await cs.signEvent(innerTemplate)
        const live = cs.live
        const existing = await gatherInners(rk.lookupId, rk.key, live)
        const allInners = mergeInners(existing, [inner])
        const { event, published } = await publishBag(allInners, rk.key, rk.lookupId, deployHeight, live)

        const item: MyDeployment = {
          eventId: inner.id,
          inner,
          bagId: event.id,
          type: pending.type,
          shard,
          text,
          at: storedAt(at),
          plane,
          height: deployHeight,
          lookupId: rk.lookupId,
          keyHex: bytesToHex(rk.key),
          relays: relaySet(),
          createdAt,
          published,
        }
        // Every item now in this region's bag shares its new envelope and status.
        const mine = [
          ...get().mine.map((d) => (d.lookupId === rk.lookupId ? { ...d, bagId: event.id, published } : d)),
          item,
        ]
        set({ mine, deployStatus: 'done', pending: null, deployNote: null })
        saveMine(mine)
      } catch (err) {
        set({ deployStatus: 'error', deployNote: null, deployError: err instanceof Error ? err.message : String(err) })
      }
    },

    /**
     * Send a region's bag to the relays, with everything this device has for it.
     *
     * A deploy made while LOCAL is signed and kept but never sent, and going
     * LIVE afterwards did nothing for it: the bag sat on the device with no way
     * out. This is that way out. It rebuilds the region's bag exactly as a
     * deploy does, from the relay's copy merged with every local item, so a
     * region half published from another device comes back whole rather than
     * being overwritten by this device's half.
     */
    /**
     * One bag, published now, whatever LOCAL says.
     *
     * LOCAL used to refuse this, which meant revealing one shard cost you the
     * privacy of everything else: you had to go LIVE, which drains the whole
     * movement chain onto the relay, and then remember to go back. A bag is
     * not part of that chain. It is a standalone envelope keyed to a region,
     * so sending one says nothing about where you have been, and asking for
     * it by name is a decision about that one thing.
     *
     * It only goes one way. A relay cannot unsee a bag, so there is no path
     * back from LIVE to LOCAL for something already sent.
     */
    broadcast: async (lookupId) => {
      if (get().broadcasting) return false
      const items = get().mine.filter((d) => d.lookupId === lookupId)
      if (items.length === 0) return false
      set({ broadcasting: lookupId, broadcastError: null })
      try {
        const key = hexToBytes(items[0].keyHex)
        const existing = await gatherInners(lookupId, key, true)
        const allInners = mergeInners(existing, items.map((d) => d.inner))
        const { event, published } = await publishBag(allInners, key, lookupId, items[0].height, true)
        if (!published) {
          set({ broadcasting: null, broadcastError: 'No relay took the bag. Try again when one is reachable.' })
          return false
        }
        const relays = relaySet()
        const mine = get().mine.map((d) => (d.lookupId === lookupId ? { ...d, bagId: event.id, published: true, relays } : d))
        set({ mine, broadcasting: null })
        saveMine(mine)
        return true
      } catch (err) {
        set({ broadcasting: null, broadcastError: err instanceof Error ? err.message : String(err) })
        return false
      }
    },

    /**
     * One region, asked for by name. The discovery scan sweeps the cubes you
     * stand in; this asks about a region you hold the key to but are nowhere
     * near, which is what the Secrets list is for.
     */
    rescan: async (lookupId, keyHex) => {
      set({ scanning: true })
      try {
        const events = await query({ kinds: [HIDDEN_KIND], '#d': [lookupId] })
        const found: Hidden[] = []
        for (const ev of events) found.push(...await unbag(ev, hexToBytes(keyHex)))
        // What this scan opened for the first time gets the ceremony: the
        // decode in the scene and the chip that says how many.
        const fresh = get().freshOf(found)
        if (found.length > 0) get().addDiscovered(found)
        if (fresh.length > 0) useCeremony.getState().mark(fresh)
        return found.length
      } catch {
        return 0
      } finally {
        set({ scanning: false })
      }
    },

    deleteInstance: async (eventId) => {
      const item = get().mine.find((d) => d.eventId === eventId)
      if (!item) return
      const cs = cyber()
      const key = hexToBytes(item.keyHex)
      // Taking something down reaches the relay whenever the bag is already
      // there, LOCAL or not. LOCAL used to silence this, which meant a
      // published bag deleted while LOCAL was deleted only on this device and
      // stayed on the relay for good, with nothing on screen saying so.
      // Deleting is an explicit act on one bag, exactly as publishing one is,
      // and it tells the relay nothing it does not already hold.
      const wasPublic = get().mine.some((d) => d.lookupId === item.lookupId && d.published)

      // What is really in this bag, gathered the way publishing gathers it:
      // from the relay as well as from here (gatherInners, which only ever
      // reads this identity's own envelopes, so a bag never holds anyone
      // else's work). This device's own list is not the bag. Something hidden
      // in the same region from another device is in the bag and not in the
      // list, and going by the list alone both dropped it from a rewrite and,
      // when it was the only other thing, deleted the whole envelope as if
      // the bag were empty.
      const gathered = await gatherInners(item.lookupId, key, wasPublic)
      const left = gathered.filter((e) => e.id !== eventId)

      let mine: MyDeployment[]
      if (left.length > 0) {
        // Rewrite the region bag without this item; the newer bag replaces it.
        const { event, published } = await publishBag(left, key, item.lookupId, item.height, wasPublic)
        mine = get().mine
          .filter((d) => d.eventId !== eventId)
          .map((d) => (d.lookupId === item.lookupId ? { ...d, bagId: event.id, published } : d))
      } else {
        // The last thing in the region: delete the envelope itself (NIP-09).
        if (wasPublic) {
          const del = await cs.signEvent({
            kind: 5,
            created_at: Math.floor(Date.now() / 1000),
            content: 'hidden content removed',
            // kind 33330 is addressable, so the address is what a relay
            // replaces and what NIP-09 asks for; the event id goes too, for
            // relays that only match that.
            tags: [['a', `${HIDDEN_KIND}:${item.inner.pubkey}:${item.lookupId}`], ['e', item.bagId], ['k', String(HIDDEN_KIND)]],
          })
          try { await publishMany(item.relays ?? relaySet(), del) } catch { /* best effort */ }
        }
        mine = get().mine.filter((d) => d.eventId !== eventId)
      }

      const deleted = { ...get().deleted, [eventId]: true as const }
      const discovered = { ...get().discovered }
      delete discovered[eventId]
      const wasInspecting = get().inspecting === eventId
      // The whole bag is gone only when nothing of ours is left in it. The
      // public list is a list of bags, so that is the grain it forgets at.
      const deletedBags = left.length > 0
        ? get().deletedBags
        : { ...get().deletedBags, [`${item.inner.pubkey}:${item.lookupId}`]: true as const }
      set({ mine, deleted, deletedBags, discovered, inspecting: wasInspecting ? null : get().inspecting })
      if (wasInspecting) cs.clearFocus()
      saveMine(mine); saveDeleted(deleted)
      if (left.length === 0) saveDeletedBags(deletedBags)
    },

    inspect: (eventId) => set({ inspecting: eventId }),

    selectSecret: (eventId) => set({ selectedSecret: eventId }),

    addDiscovered: (items) => {
      if (items.length === 0) return
      const { deleted } = get()
      const discovered = { ...get().discovered }
      let changed = false
      for (const h of items) if (!discovered[h.eventId] && !deleted[h.eventId]) { discovered[h.eventId] = h; changed = true }
      if (changed) set({ discovered })
      remember(items.map((h) => h.eventId))
      claimOwn(items)
    },

    freshOf: (items) => {
      const { discovered, deleted, mine } = get()
      const own = new Set(mine.map((d) => d.eventId))
      return items.filter((h) => !discovered[h.eventId] && !deleted[h.eventId] && !own.has(h.eventId) && !seen.has(h.eventId))
    },

    setScanning: (scanning) => set({ scanning }),

    testDiscovery: async (eventId) => {
      const item = get().mine.find((d) => d.eventId === eventId)
      if (!item || !item.published) return 'missing'
      // Region key derived fresh from the coordinate, as a stranger would.
      const rk = regionKeyAt(positionOf(item), item.height, MAX_COMPUTE_HEIGHT)
      const events = await query({ kinds: [HIDDEN_KIND], '#d': [rk.lookupId] })
      let refused = false
      for (const ev of events) {
        const items = await unbag(ev, rk.key)
        if (items.some((h) => h.eventId === eventId)) return 'found'
        // The bag opened and this item is in it, signed, yet unbag dropped it:
        // the format refused it, and every other client will too.
        if (!refused) refused = (await bagInners(ev, rk.key)).some((e) => e.id === eventId)
      }
      return refused ? 'refused' : 'missing'
    },

    pendingShard: () => {
      const { pending } = get()
      if (pending?.type !== 'shard') return null
      return useWorkshop.getState().shards.find((s) => s.id === pending.shardId) ?? null
    },

    worldItems: () => {
      const out: WorldItem[] = []
      const seen = new Set<string>()
      const me = useCyberspace.getState().identity.pubkey
      for (const d of get().mine) {
        seen.add(d.eventId)
        out.push({ key: d.eventId, type: d.type, at: positionOf(d), plane: d.plane, height: d.height, mine: true, author: me, shard: d.shard, text: d.text, createdAt: d.createdAt, lookupId: d.lookupId })
      }
      for (const h of Object.values(get().discovered)) {
        if (seen.has(h.eventId)) continue
        out.push({ key: h.eventId, type: h.type, at: h.at, plane: h.plane, height: h.height, mine: false, author: h.author, shard: h.shard, text: h.text, createdAt: h.createdAt, lookupId: h.lookupId })
      }
      return out
    },

    secretByEvent: (eventId) => get().worldItems().find((w) => w.key === eventId) ?? null,
  }
})

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __shards?: unknown }).__shards = useShards
}
