/**
 * useCyberspace.ts - the single source of truth for who you are, where you
 * are, where your uncommitted cursor is, and what the movement chain has cost.
 *
 * Movement is two-phase: WASD noodles a free cursor, Space commits the hop.
 * Only a commit computes a proof, and position advances only when that proof
 * lands, so the chain stays contiguous: every position the avatar has ever
 * occupied is covered by a completed proof.
 *
 * The chain is real. Every committed action is signed into a kind:3333 event
 * (spec §8) the moment its proof lands, and the NEXT proof's temporal work is
 * bound to that event's id, exactly as a verifier will recompute it. Local or
 * Live only decides whether those events leave the device; the chain itself
 * is identical either way, so switching to Live later publishes the same
 * history you would have had from the start.
 */

import { create } from 'zustand'
import { Quaternion } from 'three'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import {
  coordToXyz,
  estimateHopCost,
  findLcaHeight,
  hexToCoord,
  sectorTag,
  sidestepLanding,
  xyzToSectorId,
  type Plane,
} from 'cyberspace-core'
import {
  MAX_SCALE_EXP,
  alignTo,
  canonicalQuaternion,
  cellDelta,
  clampAxis,
  rotateView,
  stepFor,
  topDownQuaternion,
  viewAxes,
  type AxisDirection,
  type Position,
  type RotateDirection,
  type ViewAxes,
} from '../lib/space'
import {
  buildChain,
  hopTemplate,
  sidestepTemplate,
  spawnTemplate,
  type ActionEvent,
  type EventTemplate,
  type NostrEvent,
} from '../lib/events'
import { cancelProof, postProof, type ProofMode, type ProofResponse } from '../lib/workers'
import { targetColor, type CyberTarget } from '../lib/targets'

/**
 * The explored chain, parsed once per events change rather than on every
 * read. Every explorer selector goes through this.
 */
let actionsFor: { events: NostrEvent[]; actions: ActionEvent[] } | null = null
function parsedChain(events: NostrEvent[]): ActionEvent[] {
  if (!actionsFor || actionsFor.events !== events) actionsFor = { events, actions: buildChain(events) }
  return actionsFor.actions
}

/** Matches cyberspace-core's DEFAULT_MAX_COMPUTE_HEIGHT. */
export const MAX_COMPUTE_HEIGHT = 20

/**
 * Another avatar, followed. Their chain is the focus chain while this is set:
 * the scene anchors on it, the explorer walks it, and the controls stand down
 * because nothing here is yours to move.
 */
export interface SpectateState {
  pubkey: string
  npub: string
  /** Raw, so new events from the relay can be merged and the chain rebuilt. */
  events: NostrEvent[]
  actions: ActionEvent[]
  /** created_at of their newest action; null when the relay has none. */
  lastActive: number | null
  status: 'loading' | 'live' | 'empty' | 'error'
}

export type ProofStatus = 'idle' | 'computing' | 'done' | 'infeasible'

export interface ProofState {
  status: ProofStatus
  /** Which primitive the last/current commit used. */
  mode: ProofMode
  /** 0..1 while computing. */
  progress: number
  elapsedMs: number
  proofHash: string | null
  regionN: string | null
  terrainK: number | null
  lca: { x: number; y: number; z: number } | null
  /** Cantor pairings for hops; SHA-256 evaluations for sidesteps. */
  totalOps: number | null
  message: string | null
}

const IDLE_PROOF: ProofState = {
  status: 'idle',
  mode: 'hop',
  progress: 0,
  elapsedMs: 0,
  proofHash: null,
  regionN: null,
  terrainK: null,
  lca: null,
  totalOps: null,
  message: null,
}

export interface ChainStats {
  /** Completed hops. The chain is contiguous by construction. */
  hops: number
  /** Completed Merkle sidesteps. */
  sidesteps: number
  /** Cumulative Cantor pairings across all completed hops. */
  totalOps: number
  /** Cumulative SHA-256 evaluations across all completed sidesteps. */
  totalHashes: number
  /** Cumulative proof compute time. */
  totalMs: number
}

const EMPTY_STATS: ChainStats = { hops: 0, sidesteps: 0, totalOps: 0, totalHashes: 0, totalMs: 0 }

/**
 * Where an event is on its way to the relay. `queued` is the resting state in
 * Local mode: nothing is wrong, nothing has been sent.
 */
export type PublishStatus = 'queued' | 'sending' | 'ok' | 'failed'

/**
 * A pubkey you are pointing at. Its position is its chain head on the relay,
 * or its spawn coordinate until the chain arrives or when there is none.
 */
export interface TrackedTarget {
  pubkey: string
  npub: string
  /** A petname, when it came from a contact list. */
  name: string | null
  position: Position
  plane: Plane
  lastActive: number | null
  status: 'resolving' | 'live' | 'spawn' | 'error'
}

export interface CyberspaceState {
  identity: { pubkey: string; npub: string }
  position: Position
  /** Where the next hop would land. Free to noodle; costs nothing until committed. */
  cursor: Position
  /** Destination of the in-flight proof; null when nothing is computing. */
  pendingTarget: Position | null
  /**
   * The plane the next commit lands in. Part of the lined-up action, like the
   * cursor: toggling it costs nothing until committed, and a commit with the
   * cursor parked but the plane flipped is a valid hop in its own right.
   */
  plane: Plane
  /** The plane the chain head is actually in. */
  headPlane: Plane
  scaleExp: number
  /** Current view quaternion (camera snaps instantly to this). */
  view: Quaternion
  viewHistory: Quaternion[]
  proof: ProofState
  /**
   * The chain, as signed events, spawn first. This is what gets published and
   * what everything else here is derived from.
   */
  events: NostrEvent[]
  /** Id of the spawn event: the `genesis` every hop names. */
  genesisId: string
  /** Id of the chain head: what the next proof's temporal work binds to. */
  prevEventId: string
  /** Per event id. Only `ok` survives a reload; the rest is in flight. */
  published: Record<string, PublishStatus>
  /** The relay's last refusal, for the panel. */
  publishError: string | null
  /** Live publishes the chain as it grows; Local keeps it here. */
  live: boolean
  chain: ChainStats
  /** History of all committed positions for rendering the path trail. */
  positionHistory: Position[]
  /**
   * Which action of the chain the scene is anchored on, or null for the head.
   * Exploring history moves the anchor, not the avatar: nothing about the
   * chain changes, only where you are looking from.
   */
  exploreIndex: number | null
  spectate: SpectateState | null
  /** Pubkeys being pointed at, keyed by pubkey. Persisted. */
  targets: Record<string, TrackedTarget>
  /**
   * The scene's render origin, materialised: the position of the action being
   * looked at. Equal to `position` at the head. Every origin-relative thing in
   * the scene reads this rather than `position`, which is what lets the same
   * scene show you your own past and, later, someone else's present.
   */
  anchor: Position
  anchorPlane: Plane

  moveCursor: (dir: AxisDirection) => void
  setCursorAtCell: (row: number, col: number) => void
  commit: () => void
  cancel: () => void
  adjustScale: (delta: number) => void
  rotate: (dir: RotateDirection) => void
  popView: () => void
  resetView: () => void
  canonicalView: () => void
  togglePlane: () => void
  applyProofMessage: (msg: ProofResponse) => void
  setLive: (live: boolean) => void
  setPublishStatus: (id: string, status: PublishStatus, reason?: string) => void
  /**
   * §3.2: a new spawn event, which by being newer retires every prior action.
   * The avatar is back at its pubkey with nothing behind it. Cannot be undone,
   * because the old chain's events still exist on relays but no longer lead
   * anywhere.
   */
  respawn: () => void
  /** Anchor the scene on action `index` of the chain; null or past the end is the head. */
  explore: (index: number | null) => void
  /** Step the explored index; clamps at both ends. */
  exploreStep: (delta: number) => void
  /** Start following a pubkey: anchors on its spawn coordinate until its chain arrives. */
  beginSpectate: (pubkey: string) => void
  /** The spectated chain, fetched or updated. Keeps the explored index when it still fits. */
  setSpectateChain: (pubkey: string, events: NostrEvent[], status?: 'live' | 'empty' | 'error') => void
  /** Back to your own head. */
  endSpectate: () => void
  addTarget: (pubkey: string, name?: string | null) => void
  removeTarget: (pubkey: string) => void
  toggleTarget: (pubkey: string, name?: string | null) => void
  /** A target's chain, fetched or updated: its head becomes the position. */
  setTargetChain: (pubkey: string, events: NostrEvent[], status?: 'error') => void
  /** The tracked targets as things the HUD can point at. */
  targetList: () => CyberTarget[]

  axes: () => ViewAxes
  /** Axes as they appear on screen right now, including free orbit. */
  screenAxes: ViewAxes | null
  setScreenAxes: (a: ViewAxes) => void
  /** The chain head's coordinate, exactly as its event carries it. */
  coordHex: () => string
  sector: () => string
  /** The chain, parsed. */
  actions: () => ActionEvent[]
  /** True when the scene is anchored on YOUR live head, where the controls apply. */
  atHead: () => boolean
  /** The chain the scene is anchored on: the spectated avatar's, else yours. */
  focusChain: () => ActionEvent[]
  /** Whose chain that is. */
  focusPubkey: () => string
  /**
   * The two positions the XOR readout compares: at the head, where you stand
   * and where the cursor is; in history, the action before the one shown and
   * the one shown, so the readout explains what that hop cost.
   */
  readoutPair: () => [Position, Position]
  /** Which position the view centers on: cursor when active, avatar otherwise. */
  viewCenter: () => Position
  /**
   * Cursor's render-space position relative to the avatar's aligned cell.
   * Used as the camera pan offset so the cursor stays at screen centre.
   */
  cursorOffset: () => [number, number, number]
}

/**
 * Spawn identity: persist a keypair in localStorage so refreshing the page
 * keeps the same location and identity. The 256-bit pubkey decodes directly
 * to x/y/z/plane, so identity IS position (spec section 8.3).
 */
const STORAGE_KEY = 'onosendai:nsec'
const CHAIN_KEY = 'onosendai:chain'
const LIVE_KEY = 'onosendai:live'
const TARGETS_KEY = 'onosendai:targets'

/**
 * The chain on disk is the events themselves. Position, history, plane and the
 * previous-event link are all read back out of them, so there is exactly one
 * thing that can be wrong and it is the thing that gets published.
 *
 * Version 1 stored positions with proof hashes standing in for event ids and
 * no events at all, which nothing could verify or publish. It is not migrated:
 * a chain that never existed on the wire restarts at spawn.
 */
interface PersistedChain {
  version: 2
  events: NostrEvent[]
  /** Ids the relay has acknowledged. */
  published: string[]
  stats: ChainStats
}

function loadOrGenerateKey(): Uint8Array {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const { data } = nip19.decode(stored)
      if (data instanceof Uint8Array && data.length === 32) return data
    }
  } catch { /* corrupt or missing; fall through to generate */ }
  const fresh = generateSecretKey()
  const nsec = nip19.nsecEncode(fresh)
  try { localStorage.setItem(STORAGE_KEY, nsec) } catch { /* private mode */ }
  return fresh
}

function loadChain(pubkey: string): PersistedChain | null {
  try {
    const raw = localStorage.getItem(CHAIN_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as Partial<PersistedChain>
    if (data.version !== 2 || !Array.isArray(data.events) || data.events.length === 0) return null
    // Must reassemble to exactly what was stored, from our own key. Anything
    // else is a chain that cannot be continued, and pretending otherwise would
    // sign hops onto a history the relay will reject.
    const chain = buildChain(data.events)
    if (chain.length !== data.events.length || chain[0].pubkey !== pubkey) return null
    return {
      version: 2,
      events: data.events,
      published: Array.isArray(data.published) ? data.published : [],
      stats: { ...EMPTY_STATS, ...(data.stats ?? {}) },
    }
  } catch { /* corrupt or missing */ }
  return null
}

function saveChain(events: NostrEvent[], published: Record<string, PublishStatus>, stats: ChainStats): void {
  try {
    const data: PersistedChain = {
      version: 2,
      events,
      published: events.map((e) => e.id).filter((id) => published[id] === 'ok'),
      stats,
    }
    localStorage.setItem(CHAIN_KEY, JSON.stringify(data))
  } catch { /* quota exceeded or private mode */ }
}

/** Only who and what they are called survive a reload; positions are refetched. */
function loadTargets(): Record<string, TrackedTarget> {
  try {
    const raw = localStorage.getItem(TARGETS_KEY)
    if (!raw) return {}
    const list = JSON.parse(raw) as Array<{ pubkey: string; name?: string | null }>
    const out: Record<string, TrackedTarget> = {}
    for (const t of list) {
      if (!/^[0-9a-f]{64}$/.test(t.pubkey)) continue
      out[t.pubkey] = unresolvedTarget(t.pubkey, t.name ?? null)
    }
    return out
  } catch { return {} }
}

function saveTargets(targets: Record<string, TrackedTarget>): void {
  try {
    localStorage.setItem(TARGETS_KEY, JSON.stringify(Object.values(targets).map((t) => ({ pubkey: t.pubkey, name: t.name }))))
  } catch { /* private mode */ }
}

function unresolvedTarget(pubkey: string, name: string | null): TrackedTarget {
  const spawn = spawnOf(pubkey)
  return { pubkey, npub: nip19.npubEncode(pubkey), name, position: spawn.position, plane: spawn.plane, lastActive: null, status: 'resolving' }
}

function loadLive(): boolean {
  try {
    const raw = localStorage.getItem(LIVE_KEY)
    // Live is the default: the chain is meant to be seen.
    return raw === null ? true : raw === '1'
  } catch { return true }
}

function saveLive(live: boolean): void {
  try { localStorage.setItem(LIVE_KEY, live ? '1' : '0') } catch { /* private mode */ }
}

/** Seconds now, never earlier than the chain head, so the chain reads forward. */
function nextCreatedAt(head: NostrEvent | undefined): number {
  const now = Math.floor(Date.now() / 1000)
  return head ? Math.max(now, head.created_at) : now
}

const secretKey = loadOrGenerateKey()
const pubkeyHex = getPublicKey(secretKey)
const SPAWN_XYZ = coordToXyz(hexToCoord(pubkeyHex))
const SPAWN: Position = { x: SPAWN_XYZ.x, y: SPAWN_XYZ.y, z: SPAWN_XYZ.z }

/** Where any pubkey spawns: its own bits, read as a coordinate (spec §3.1). */
function spawnOf(pubkey: string): { position: Position; plane: Plane } {
  const { x, y, z, plane } = coordToXyz(hexToCoord(pubkey))
  return { position: { x, y, z }, plane }
}

/** The one place the key touches an event. */
function sign(template: EventTemplate): NostrEvent {
  return finalizeEvent(template, secretKey)
}

/**
 * A fresh chain: one spawn, signed now, unpublished.
 *
 * A respawn passes the chain it retires. §3.2 makes the new spawn win by being
 * newer, and "newer" has to be strictly so: a spawn signed in the same second
 * as the one before it is the same bytes, the same id, and so not a new spawn
 * at all. The timestamp therefore steps past the old head, not merely to now.
 */
function freshSpawn(retiring?: NostrEvent): PersistedChain {
  const now = Math.floor(Date.now() / 1000)
  const createdAt = retiring ? Math.max(now, retiring.created_at + 1) : now
  return { version: 2, events: [sign(spawnTemplate(pubkeyHex, createdAt))], published: [], stats: EMPTY_STATS }
}

/** Everything the store derives from a chain, so spawn and respawn agree. */
function derive(saved: PersistedChain): {
  events: NostrEvent[]
  genesisId: string
  prevEventId: string
  published: Record<string, PublishStatus>
  chain: ChainStats
  position: Position
  positionHistory: Position[]
  plane: Plane
  headPlane: Plane
  exploreIndex: null
  anchor: Position
  anchorPlane: Plane
} {
  const actions = buildChain(saved.events)
  const head = actions[actions.length - 1]
  const published: Record<string, PublishStatus> = {}
  for (const e of saved.events) published[e.id] = saved.published.includes(e.id) ? 'ok' : 'queued'
  return {
    events: saved.events,
    genesisId: actions[0].id,
    prevEventId: head.id,
    published,
    chain: saved.stats,
    position: head.position,
    positionHistory: actions.map((a) => a.position),
    plane: head.plane,
    headPlane: head.plane,
    exploreIndex: null,
    anchor: head.position,
    anchorPlane: head.plane,
  }
}

const initial = derive(loadChain(pubkeyHex) ?? freshSpawn())

let requestId = 0

export const useCyberspace = create<CyberspaceState>((set, get) => ({
  identity: { pubkey: pubkeyHex, npub: nip19.npubEncode(pubkeyHex) },
  ...initial,
  spectate: null,
  targets: loadTargets(),
  cursor: initial.position,
  pendingTarget: null,
  scaleExp: 0,
  view: topDownQuaternion(),
  viewHistory: [],
  proof: IDLE_PROOF,
  publishError: null,
  live: loadLive(),

  moveCursor: (dir) => {
    const { cursor, scaleExp } = get()
    if (!get().atHead()) return
    const step = stepFor(scaleExp) * BigInt(dir.dir)

    const next: Position = { ...cursor }
    next[dir.axis] = clampAxis(cursor[dir.axis] + step)

    // Clamped against the axis wall: nowhere to go.
    if (next[dir.axis] === cursor[dir.axis]) return
    set({ cursor: next })
  },

  setCursorAtCell: (row, col) => {
    const { position, scaleExp, view } = get()
    const axes = viewAxes(view)
    const origin = alignedOrigin(position, scaleExp)
    const step = stepFor(scaleExp)

    // Grid row/col are in screen space (row=0 is top, col=0 is left).
    // Convert to world position by applying offsets along the screen axes.
    const next: Position = { ...position }
    next[axes.right.axis] = clampAxis(
      origin[axes.right.axis] + BigInt(col) * step * BigInt(axes.right.dir)
    )
    next[axes.up.axis] = clampAxis(
      origin[axes.up.axis] + BigInt(row) * step * BigInt(axes.up.dir)
    )
    // Depth axis stays at avatar's position (clicking doesn't move into/out of screen).

    set({ cursor: next })
  },

  commit: () => {
    const { position, cursor, plane, headPlane, prevEventId, proof } = get()
    // One proof at a time. X cancels a commit you regret.
    if (proof.status === 'computing') return
    // Looking at history: nothing here is a place you can move from.
    if (!get().atHead()) return
    // Nothing lined up: same cell, same plane.
    if (samePosition(position, cursor) && plane === headPlane) return

    // Route by feasibility: a hop straight to the cursor when the Cantor tree
    // fits, otherwise a Merkle sidestep across the blocking wall(s). The
    // sidestep lands 1 gibson past the boundary, not at the cursor; the
    // cursor keeps the rest of the journey for the next commit.
    const estimate = estimateHopCost(
      position.x, position.y, position.z,
      cursor.x, cursor.y, cursor.z,
      plane,
      MAX_COMPUTE_HEIGHT,
    )
    const mode: ProofMode = estimate.exceedsLimit ? 'sidestep' : 'hop'
    const to = mode === 'sidestep' ? sidestepTarget(position, cursor) : { ...cursor }
    if (samePosition(position, to) && plane === headPlane) return

    const id = ++requestId
    set({
      pendingTarget: to,
      proof: { ...IDLE_PROOF, status: 'computing', mode },
    })

    postProof({
      id,
      mode,
      from: position,
      to,
      plane,
      prevEventId,
      maxComputeHeight: MAX_COMPUTE_HEIGHT,
    })
  },

  cancel: () => {
    const { proof, position, headPlane } = get()
    if (proof.status === 'computing') {
      // A Cantor proof is one synchronous computation, so cancelling means
      // killing the worker thread. Position never moved; the chain is intact.
      cancelProof()
      requestId++
      set({ pendingTarget: null, proof: IDLE_PROOF })
      return
    }
    // Not computing: recall the cursor, plane included, to where you stand.
    set({ cursor: { ...position }, plane: headPlane })
  },

  adjustScale: (delta) => {
    const next = Math.max(0, Math.min(MAX_SCALE_EXP, get().scaleExp + delta))
    if (next === get().scaleExp) return
    set({ scaleExp: next })
  },

  rotate: (dir) => {
    const { view, viewHistory } = get()
    set({
      view: rotateView(view, dir),
      viewHistory: [...viewHistory, view.clone()],
    })
  },

  popView: () => {
    const { viewHistory } = get()
    if (viewHistory.length === 0) return
    const previous = viewHistory[viewHistory.length - 1]
    set({ view: previous, viewHistory: viewHistory.slice(0, -1) })
  },

  resetView: () => {
    const { view, viewHistory } = get()
    set({ view: topDownQuaternion(), viewHistory: [...viewHistory, view.clone()] })
  },

  // Required preset per CYBERSPACE_V2.md section 11.3.
  canonicalView: () => {
    const { view, viewHistory } = get()
    set({ view: canonicalQuaternion(), viewHistory: [...viewHistory, view.clone()] })
  },

  togglePlane: () => {
    // A plane flip mid-proof would desync the in-flight terrain K.
    if (get().proof.status === 'computing') return
    // Someone else's plane is theirs; the terrain follows their chain.
    if (get().spectate) return
    set({ plane: get().plane === 0 ? 1 : 0, proof: IDLE_PROOF })
  },

  applyProofMessage: (msg) => {
    // Stale responses from a cancelled commit must not overwrite fresh state.
    if (msg.id !== requestId) return

    if (msg.type === 'progress') {
      set({
        proof: { ...get().proof, status: 'computing', progress: msg.fraction, elapsedMs: msg.elapsedMs },
      })
      return
    }

    if (msg.type === 'error') {
      set({
        pendingTarget: null,
        proof: {
          ...IDLE_PROOF,
          status: 'infeasible',
          elapsedMs: msg.elapsedMs,
          message: msg.message,
        },
      })
      return
    }

    const { pendingTarget, position, plane, chain, events, genesisId, prevEventId, published } = get()
    const newPosition = pendingTarget ?? position
    const head = events[events.length - 1]

    // The proof covers exactly position -> pendingTarget, and this event is
    // its receipt: the hop the next proof will bind to. Signed before the
    // position moves, so the chain and the avatar can never disagree.
    const link = {
      createdAt: nextCreatedAt(head),
      genesisId,
      previousId: prevEventId,
      prevCoordHex: head.tags.find((t) => t[0] === 'C')?.[1] ?? '',
      to: newPosition,
      plane,
      proofHash: msg.proofHash,
    }
    const event = sign(
      msg.mode === 'sidestep' && msg.sidestep
        ? sidestepTemplate({ ...link, ...msg.sidestep })
        : hopTemplate(link),
    )

    const stats: ChainStats = {
      hops: chain.hops + (msg.mode === 'hop' ? 1 : 0),
      sidesteps: chain.sidesteps + (msg.mode === 'sidestep' ? 1 : 0),
      totalOps: chain.totalOps + (msg.mode === 'hop' ? msg.totalOps : 0),
      totalHashes: chain.totalHashes + (msg.mode === 'sidestep' ? msg.totalOps : 0),
      totalMs: chain.totalMs + msg.elapsedMs,
    }
    const nextEvents = [...events, event]
    const nextPublished = { ...published, [event.id]: 'queued' as const }

    const following = get().atHead()
    set({
      position: newPosition,
      headPlane: plane,
      ...(following ? { anchor: newPosition, anchorPlane: plane } : {}),
      pendingTarget: null,
      proof: {
        status: 'done',
        mode: msg.mode,
        progress: 1,
        elapsedMs: msg.elapsedMs,
        proofHash: msg.proofHash,
        regionN: msg.regionN,
        terrainK: msg.terrainK,
        lca: msg.lca,
        totalOps: msg.totalOps,
        message: null,
      },
      events: nextEvents,
      prevEventId: event.id,
      published: nextPublished,
      chain: stats,
      positionHistory: [...get().positionHistory, newPosition],
    })

    saveChain(nextEvents, nextPublished, stats)
  },

  setLive: (live) => {
    if (live === get().live) return
    saveLive(live)
    set({ live, publishError: null })
  },

  respawn: () => {
    // A proof in flight was for a chain that is about to stop existing.
    if (get().proof.status === 'computing') {
      cancelProof()
      requestId++
    }
    const { events } = get()
    const fresh = derive(freshSpawn(events[events.length - 1]))
    set({
      ...fresh,
      cursor: fresh.position,
      pendingTarget: null,
      proof: IDLE_PROOF,
      publishError: null,
    })
    saveChain(fresh.events, fresh.published, fresh.chain)
  },

  explore: (index) => {
    const chain = get().focusChain()
    const last = chain.length - 1
    // Nothing to walk: a spectated pubkey with no chain on the relay. The
    // anchor stays on its spawn coordinate.
    if (last < 0) { set({ exploreIndex: null }); return }
    if (index === null || index >= last) {
      const a = chain[last]
      set({ exploreIndex: null, anchor: a.position, anchorPlane: a.plane })
      return
    }
    const i = Math.max(0, Math.floor(index))
    const a = chain[i]
    set({ exploreIndex: i, anchor: a.position, anchorPlane: a.plane })
  },

  exploreStep: (delta) => {
    const { exploreIndex } = get()
    const last = get().focusChain().length - 1
    const from = exploreIndex ?? last
    get().explore(Math.min(last, Math.max(0, from + delta)))
  },

  beginSpectate: (pubkey) => {
    const spawn = spawnOf(pubkey)
    set({
      spectate: { pubkey, npub: nip19.npubEncode(pubkey), events: [], actions: [], lastActive: null, status: 'loading' },
      exploreIndex: null,
      anchor: spawn.position,
      anchorPlane: spawn.plane,
    })
  },

  setSpectateChain: (pubkey, events, status) => {
    const prev = get().spectate
    if (!prev || prev.pubkey !== pubkey) return
    const actions = buildChain(events)
    const head = actions[actions.length - 1]
    // A chain that grew under an explorer parked in its history leaves the
    // explorer where it was; one that was replaced (a respawn) snaps to head.
    const keep = get().exploreIndex !== null
      && get().exploreIndex! < actions.length
      && actions[get().exploreIndex!]?.id === prev.actions[get().exploreIndex!]?.id
    const at = keep ? actions[get().exploreIndex!] : head
    const spawn = spawnOf(pubkey)
    set({
      spectate: {
        ...prev,
        events,
        actions,
        lastActive: head?.createdAt ?? null,
        status: status ?? (head ? 'live' : 'empty'),
      },
      exploreIndex: keep ? get().exploreIndex : null,
      anchor: at?.position ?? spawn.position,
      anchorPlane: at?.plane ?? spawn.plane,
    })
  },

  endSpectate: () => {
    const { position, headPlane } = get()
    set({ spectate: null, exploreIndex: null, anchor: position, anchorPlane: headPlane })
  },

  addTarget: (pubkey, name = null) => {
    const { targets } = get()
    if (targets[pubkey]) {
      // Already tracked: a name from a contact list is still worth keeping.
      if (name && !targets[pubkey].name) {
        const next = { ...targets, [pubkey]: { ...targets[pubkey], name } }
        set({ targets: next }); saveTargets(next)
      }
      return
    }
    const next = { ...targets, [pubkey]: unresolvedTarget(pubkey, name) }
    set({ targets: next })
    saveTargets(next)
  },

  removeTarget: (pubkey) => {
    const { targets } = get()
    if (!targets[pubkey]) return
    const next = { ...targets }
    delete next[pubkey]
    set({ targets: next })
    saveTargets(next)
  },

  toggleTarget: (pubkey, name = null) => {
    if (get().targets[pubkey]) get().removeTarget(pubkey)
    else get().addTarget(pubkey, name)
  },

  setTargetChain: (pubkey, events, status) => {
    const { targets } = get()
    const t = targets[pubkey]
    if (!t) return
    const head = buildChain(events)[buildChain(events).length - 1]
    const spawn = spawnOf(pubkey)
    set({
      targets: {
        ...targets,
        [pubkey]: {
          ...t,
          position: head?.position ?? spawn.position,
          plane: head?.plane ?? spawn.plane,
          lastActive: head?.createdAt ?? null,
          status: head ? 'live' : status ?? 'spawn',
        },
      },
    })
  },

  targetList: () =>
    Object.values(get().targets).map((t) => ({
      id: t.pubkey,
      label: (t.name ?? `${t.npub.slice(0, 12)}…${t.npub.slice(-4)}`).toUpperCase(),
      color: targetColor(t.pubkey),
      at: t.position,
    })),

  setPublishStatus: (id, status, reason) => {
    const { published, events, chain } = get()
    if (!(id in published)) return
    const next = { ...published, [id]: status }
    set({ published: next, publishError: status === 'failed' ? reason ?? 'relay refused' : null })
    if (status === 'ok') saveChain(events, next, chain)
  },

  screenAxes: null,

  setScreenAxes: (a) => {
    const cur = get().screenAxes
    // All three compared. Comparing only right and up let a stale `out` survive
    // any orbit that left those two unchanged, so R and F kept pushing along
    // whichever axis they had been bound to when the camera last passed here.
    const same = (x: AxisDirection, y: AxisDirection): boolean =>
      x.axis === y.axis && x.dir === y.dir
    if (cur && same(cur.right, a.right) && same(cur.up, a.up) && same(cur.out, a.out)) return
    set({ screenAxes: a })
  },

  axes: () => viewAxes(get().view),

  coordHex: () => {
    const { events } = get()
    return events[events.length - 1].tags.find((t) => t[0] === 'C')?.[1] ?? ''
  },

  sector: () => {
    const { position } = get()
    return sectorTag(xyzToSectorId(position.x, position.y, position.z))
  },

  actions: () => parsedChain(get().events),

  atHead: () => get().exploreIndex === null && get().spectate === null,

  focusChain: () => {
    const { spectate } = get()
    return spectate ? spectate.actions : parsedChain(get().events)
  },

  focusPubkey: () => get().spectate?.pubkey ?? get().identity.pubkey,

  readoutPair: () => {
    const { exploreIndex, position, cursor, anchor } = get()
    if (get().atHead()) return [position, cursor]
    const chain = get().focusChain()
    const i = exploreIndex ?? chain.length - 1
    const here = chain[i]?.position ?? anchor
    const before = chain[i - 1]?.position ?? here
    return [before, here]
  },

  /**
   * Which position the camera tracks: the cursor when it is away from the
   * avatar, the avatar's position otherwise. Centering on the cursor means
   * zooming keeps the cursor stable on screen, which is what you want when
   * inspecting terrain at a target.
   */
  viewCenter: () => {
    const { position, cursor } = get()
    return samePosition(position, cursor) ? position : cursor
  },

  /**
   * Cursor's render-space position relative to the avatar's aligned cell.
   * Negating this gives the world-group translation that puts the cursor at
   * screen centre, so zooming tracks the cursor instead of the avatar.
   */
  cursorOffset: (): [number, number, number] => {
    const { anchor, cursor, scaleExp, view } = get()
    // Off your own head there is no cursor to frame; the camera sits on the anchor.
    if (!get().atHead()) return [0, 0, 0]
    const axes = viewAxes(view)
    const origin = alignedOrigin(anchor, scaleExp)
    // Cell CENTRES, the same convention the cursor cube, the avatar and the path
    // trail draw with. This used to mix cellOffset on two axes with cellDelta on
    // the third, so the point field's focus, the camera target and the cursor
    // cube could sit up to half a cell apart above scaleExp 0: the terrain
    // magnified around a spot the cursor was not quite on.
    return [axes.right, axes.up, axes.out].map((a) =>
      cellDelta(alignTo(cursor[a.axis], scaleExp), origin[a.axis], scaleExp) * a.dir,
    ) as [number, number, number]
  },
}))

// DEV is also true under vitest, which runs in node, and importing this module
// for alignedOrigin must not blow up on a missing window. Same reason the
// localStorage calls above are wrapped.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  // Lets the browser harness read and drive real state instead of inferring it
  // from the HUD, the same way __terrain and __screenAxes work.
  ;(window as unknown as { __store?: unknown }).__store = useCyberspace
}

/** The spawn coordinate of this identity: where every chain of its starts. */
export { SPAWN }

/** Positions are equal when all three axes match. */
export function samePosition(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z
}

/**
 * Where a sidestep commit toward `cursor` actually lands: each axis whose
 * crossing is beyond the Cantor ceiling steps 1 gibson past its wall; every
 * other axis stays put, because a spec-valid sidestep only crosses walls.
 */
export function sidestepTarget(position: Position, cursor: Position): Position {
  const land = (p: bigint, c: bigint): bigint =>
    findLcaHeight(p, c) > MAX_COMPUTE_HEIGHT ? sidestepLanding(p, c) : p
  return {
    x: land(position.x, cursor.x),
    y: land(position.y, cursor.y),
    z: land(position.z, cursor.z),
  }
}

/**
 * The aligned origin of the cell the avatar occupies at the current scale.
 */
export function alignedOrigin(position: Position, scaleExp: number): Position {
  return {
    x: alignTo(position.x, scaleExp),
    y: alignTo(position.y, scaleExp),
    z: alignTo(position.z, scaleExp),
  }
}
