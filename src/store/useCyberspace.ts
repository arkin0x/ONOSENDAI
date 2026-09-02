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
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import {
  deferredReconnect,
  localSigner,
  randomSigner,
  signerFromNcryptsec,
  signerFromNsec,
  signerFromPref,
  nip07Signer,
  nip46Signer,
  prefOf,
  loadSignerPref,
  saveSignerPref,
  type Signer,
  type SignerKind,
} from '../lib/signers'
import {
  coordToXyz,
  estimateHopCost,
  findLcaHeight,
  hexToCoord,
  sectorTag,
  sidestepLanding,
  xyzToCoord,
  xyzToSectorId,
  type Plane,
} from 'cyberspace-core'
import { OCCUPANCY_SCALE_MAX,
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
  parseAction,
  positionHex,
  sidestepTemplate,
  spawnTemplate,
  type ActionEvent,
  type EventTemplate,
  type NostrEvent,
  enterHyperspaceTemplate,
  hyperjumpTemplate,
} from '../lib/events'
import { cancelProof, postProof, type ProofMode, type ProofResponse } from '../lib/workers'
import { recommendedHopHeight } from '../lib/calibration'
import { computeEnterProof } from '../lib/hyperspace/enter'
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

/** Hyperspace transit (DECK-0001 v3): the identity has boarded and not yet arrived. */
export interface TransitState {
  stage: 'boarded'
  enterEventId: string
  enterCoordHex: string
}

/** A finished ride, as the worker pool hands it back (§5.4 and §5.5). */
export interface CompletedRide {
  toCoordHex: string
  fromHeight: number
  toHeight: number
  /** The station set bound declared in the event (as_of tag). */
  asOf?: number
  rootHex: string
  mp: string
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
  /**
   * A fixed coordinate the scene is looking at, with nothing to walk: used to
   * fly to a deployed shard. Like spectating, it is read-only, since the point
   * is somewhere you are not. Exclusive with spectating in practice, because
   * the panel it is reached from is hidden while spectating.
   */
  focus: { position: Position; plane: Plane; label: string } | null
  /** The zoom before the standing focus began, restored by clearFocus. */
  focusReturnScale: number | null
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
  commit: () => Promise<void>
  cancel: () => void
  adjustScale: (delta: number) => void
  rotate: (dir: RotateDirection) => void
  popView: () => void
  resetView: () => void
  canonicalView: () => void
  togglePlane: () => void
  /** Line up a plane for the next commit; the scene switches to it at once. */
  setPlane: (plane: Plane) => void
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
  /** Look at a fixed coordinate (a deployed shard), optionally jumping the scale. */
  focusOn: (position: Position, plane: Plane, label: string, scaleExp?: number) => void
  /** Stop looking; the scene returns to your avatar. */
  clearFocus: () => void
  /** Hyperspace transit: non-null from boarding until arrival (DECK-0001 v3). */
  transit: TransitState | null
  /** §3: sign and queue an enter-hyperspace event from the current position. */
  boardHyperspace: () => Promise<void>
  /** §5: sign and queue the hyperjump for a computed ride, arriving at the stop. */
  completeRide: (ride: CompletedRide) => Promise<void>
  /** Forget the boarding locally; the next hop cancels it on the wire (§3.3). */
  cancelTransit: () => void
  addTarget: (pubkey: string, name?: string | null) => void
  removeTarget: (pubkey: string) => void
  toggleTarget: (pubkey: string, name?: string | null) => void
  /** A target's chain, fetched or updated: its head becomes the position. */
  setTargetChain: (pubkey: string, events: NostrEvent[], status?: 'error') => void
  /** Fold relay events for THIS identity into the live chain, adopting a newer
   * one from another machine. The self-sync loop and login both feed this. */
  adoptChain: (events: NostrEvent[]) => void
  /** The tracked targets as things the HUD can point at. */
  targetList: () => CyberTarget[]
  /** Sign a template with this identity's active signer. Async because an
   * extension or a bunker is genuinely remote. The only door to it outside this module. */
  signEvent: (template: EventTemplate) => Promise<NostrEvent>

  /** How the current identity signs: a local key, an extension, or a bunker. */
  signerKind: SignerKind
  /** The last login attempt's failure, shown in the identity panel; null when clear. */
  loginError: string | null
  /** Reconnect a stored extension/bunker signer on startup, if there is one. */
  initSigner: () => Promise<void>
  /** Replace the identity with a fresh random key, spawning anew. */
  useNewKey: () => Promise<void>
  /** Replace the identity from a pasted nsec. */
  useNsec: (nsec: string) => Promise<void>
  /** Replace the identity from an ncryptsec and its password. */
  useNcryptsec: (ncryptsec: string, password: string) => Promise<void>
  /** Switch to the browser extension (NIP-07). */
  useExtension: () => Promise<void>
  /** Switch to a remote bunker (NIP-46) from its bunker:// URI. */
  useBunker: (uri: string) => Promise<void>
  /** Clear a shown login error. */
  clearLoginError: () => void

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

/** Chains are stored per identity, so switching keys and back keeps each one's
 * local history. The bare CHAIN_KEY is the pre-multi-identity slot, migrated in
 * on first load for whichever identity it belonged to. */
function chainKeyFor(pubkey: string): string {
  return `${CHAIN_KEY}:${pubkey}`
}
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
    let raw = localStorage.getItem(chainKeyFor(pubkey))
    if (!raw) {
      // Migrate the single legacy chain, but only for the identity that wrote it.
      const legacy = localStorage.getItem(CHAIN_KEY)
      if (legacy) {
        const d = JSON.parse(legacy) as Partial<PersistedChain>
        if (Array.isArray(d.events) && d.events[0]?.pubkey === pubkey) raw = legacy
      }
    }
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
  const pubkey = events[0]?.pubkey
  if (!pubkey) return
  try {
    const data: PersistedChain = {
      version: 2,
      events,
      published: events.map((e) => e.id).filter((id) => published[id] === 'ok'),
      stats,
    }
    localStorage.setItem(chainKeyFor(pubkey), JSON.stringify(data))
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

/** Where any pubkey spawns: its own bits, read as a coordinate (spec §3.1). */
function spawnOf(pubkey: string): { position: Position; plane: Plane } {
  const { x, y, z, plane } = coordToXyz(hexToCoord(pubkey))
  return { position: { x, y, z }, plane }
}

/**
 * The signer in use. Mutable, because you can switch from the default random
 * key to an nsec, an extension, or a bunker. Everything signs through it and
 * awaits it: local keys resolve at once, the others are genuinely remote.
 */
let currentSigner: Signer = pickInitialSigner()

function pickInitialSigner(): Signer {
  const pref = loadSignerPref()
  // A stored extension/bunker identity whose chain we already hold: reconnect
  // lazily, keeping its pubkey so the chain loads now.
  if (pref && pref.kind !== 'local' && loadChain(pref.pubkey)) {
    return deferredReconnect(pref, (s) => { currentSigner = s })
  }
  if (pref?.nsec) { try { return signerFromNsec(pref.nsec) } catch { /* corrupt */ } }
  return localSigner(loadOrGenerateKey())
}

function signEvent(template: EventTemplate): Promise<NostrEvent> {
  return currentSigner.signEvent(template)
}

const pubkeyHex = currentSigner.pubkey
const SPAWN_XYZ = coordToXyz(hexToCoord(pubkeyHex))
const SPAWN: Position = { x: SPAWN_XYZ.x, y: SPAWN_XYZ.y, z: SPAWN_XYZ.z }

/** A fresh spawn signed synchronously: only possible with a local key, which is
 * the only case module init ever needs one (see pickInitialSigner). */
function freshSpawnSync(signer: Signer): PersistedChain {
  if (!signer.secretKey) throw new Error('cannot spawn without a local key at init')
  const createdAt = Math.floor(Date.now() / 1000)
  const spawn = finalizeEvent(spawnTemplate(signer.pubkey, createdAt), signer.secretKey) as unknown as NostrEvent
  return { version: 2, events: [spawn], published: [], stats: EMPTY_STATS }
}

/** A fresh spawn signed through whatever signer is active (may be remote). */
async function freshSpawnAsync(signer: Signer, retiring?: NostrEvent): Promise<PersistedChain> {
  const now = Math.floor(Date.now() / 1000)
  const createdAt = retiring ? Math.max(now, retiring.created_at + 1) : now
  const spawn = await signer.signEvent(spawnTemplate(signer.pubkey, createdAt))
  return { version: 2, events: [spawn], published: [], stats: EMPTY_STATS }
}

/**
 * A fresh chain: one spawn, signed now, unpublished.
 *
 * A respawn passes the chain it retires. §3.2 makes the new spawn win by being
 * newer, and "newer" has to be strictly so: a spawn signed in the same second
 * as the one before it is the same bytes, the same id, and so not a new spawn
 * at all. The timestamp therefore steps past the old head, not merely to now.
 */
/**
 * The chain state for an identity that has not been placed yet: it sits at its
 * own spawn coordinate (spec §3.1) with nothing signed. Switching to a bunker
 * or extension lands here, so login never signs a spawn; the self-sync loop
 * fills in the real chain from the relay if there is one, and otherwise the
 * first move signs the spawn (see commit).
 */
function provisionalChain(pubkey: string): ReturnType<typeof derive> {
  const { position, plane } = spawnOf(pubkey)
  return {
    events: [],
    genesisId: '',
    prevEventId: '',
    published: {},
    chain: EMPTY_STATS,
    position,
    positionHistory: [position],
    plane,
    headPlane: plane,
    exploreIndex: null,
    anchor: position,
    anchorPlane: plane,
  }
}

/** Hop and sidestep counts of an adopted chain; compute totals are this
 * device's own effort, so they carry over rather than reset to another
 * machine's unknown work. */
function statsFromChain(events: NostrEvent[], prev: ChainStats): ChainStats {
  let hops = 0
  let sidesteps = 0
  for (const e of events) {
    const a = parseAction(e)
    if (a?.type === 'hop') hops++
    else if (a?.type === 'sidestep') sidesteps++
  }
  return { ...prev, hops, sidesteps }
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

const initial = derive(loadChain(pubkeyHex) ?? freshSpawnSync(currentSigner))

let requestId = 0

export const useCyberspace = create<CyberspaceState>((set, get) => {
  /**
   * Replace the active identity. A known pubkey keeps its stored chain; a new
   * one spawns where its own bits land (spec §3.1). Either way the scene lets
   * go of whatever it was spectating and returns to the new head.
   */
  const switchTo = async (signer: Signer): Promise<void> => {
    currentSigner = signer
    saveSignerPref(prefOf(signer))
    // No spawn is signed here. A returning identity loads from local storage now
    // and from the relay a moment later (self-sync), and a brand-new one sits at
    // its spawn coordinate until its first move. So switching to a bunker or an
    // extension never makes it sign anything just to log in.
    const local = loadChain(signer.pubkey)
    const base = local ? derive(local) : provisionalChain(signer.pubkey)
    set({
      identity: { pubkey: signer.pubkey, npub: nip19.npubEncode(signer.pubkey) },
      signerKind: signer.kind,
      loginError: null,
      ...base,
      cursor: base.position,
      pendingTarget: null,
      proof: IDLE_PROOF,
      publishError: null,
      spectate: null,
      focus: null,
      transit: null,
    })
    if (local) saveChain(base.events, base.published, base.chain)
  }

  return {
  identity: { pubkey: pubkeyHex, npub: nip19.npubEncode(pubkeyHex) },
  ...initial,
  spectate: null,
  focus: null,
  focusReturnScale: null,
  transit: null,
  targets: loadTargets(),
  cursor: initial.position,
  pendingTarget: null,
  scaleExp: 0,
  // Facing the black sun, the section 11.3 canonical orientation, the same
  // one the SUN button restores. The spec's left/right/above/below language
  // is defined against it, so it is what a first look should agree with; the
  // map view is one TOP away and does not need to be where everyone starts.
  view: canonicalQuaternion(),
  viewHistory: [],
  proof: IDLE_PROOF,
  publishError: null,
  live: loadLive(),
  signerKind: currentSigner.kind,
  loginError: null,

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

  commit: async () => {
    // One proof at a time. X cancels a commit you regret.
    if (get().proof.status === 'computing') return
    // Looking at history: nothing here is a place you can move from.
    if (!get().atHead()) return

    // A provisional identity (logged in, never placed) has no genesis yet. Sign
    // its spawn now, on this first deliberate move, rather than at login. This
    // is the only spawn a switched-in identity ever signs.
    if (get().events.length === 0) {
      let spawn: NostrEvent
      try {
        spawn = await signEvent(spawnTemplate(get().identity.pubkey, Math.floor(Date.now() / 1000)))
      } catch (err) {
        set({ proof: { ...IDLE_PROOF, status: 'infeasible', message: `Signing failed: ${err instanceof Error ? err.message : String(err)}` } })
        return
      }
      // The relay chain may have landed while the signer was thinking; if so it
      // already placed us and this spawn is redundant.
      if (get().events.length === 0) {
        const d = derive({ version: 2, events: [spawn], published: [], stats: EMPTY_STATS })
        set({ ...d })
        saveChain(d.events, d.published, d.chain)
      }
    }

    const { position, cursor, plane, headPlane, prevEventId, proof } = get()
    if (proof.status === 'computing') return
    // Nothing lined up: same cell, same plane.
    if (samePosition(position, cursor) && plane === headPlane) return

    // Route by feasibility: a hop straight to the cursor when the Cantor tree
    // fits, otherwise a Merkle sidestep across the blocking wall(s). The
    // sidestep lands 1 gibson past the boundary, not at the cursor; the
    // cursor keeps the rest of the journey for the next commit.
    // The ceiling this commit will actually attempt: the protocol's hard cap,
    // lowered to what calibration measured THIS machine finishing in budget
    // (lib/calibration.ts). Routing, the sidestep landing and the worker all
    // use the same number, so a hop the machine cannot finish becomes a
    // sidestep at the real ceiling instead of a stalled tab.
    const ceiling = Math.min(MAX_COMPUTE_HEIGHT, recommendedHopHeight())
    const estimate = estimateHopCost(
      position.x, position.y, position.z,
      cursor.x, cursor.y, cursor.z,
      plane,
      ceiling,
    )
    const mode: ProofMode = estimate.exceedsLimit ? 'sidestep' : 'hop'
    const to = mode === 'sidestep' ? sidestepTarget(position, cursor, ceiling) : { ...cursor }
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
      maxComputeHeight: ceiling,
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
    // The view follows the lined-up plane, so at your own head it comes back too.
    const atHead = get().exploreIndex === null && get().focus === null && get().spectate === null
    set(atHead ? { cursor: { ...position }, plane: headPlane, anchorPlane: headPlane } : { cursor: { ...position }, plane: headPlane })
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

  setPlane: (plane) => {
    // A plane flip mid-proof would desync the in-flight terrain K.
    if (get().proof.status === 'computing') return
    // Someone else's plane is theirs; the terrain follows their chain.
    if (get().spectate) return
    if (get().plane === plane) return
    // The view follows the lined-up plane the way it follows the cursor: at
    // your own head, or in a focus view such as EARTH, the scene switches
    // planes now, so the planet, the landfalls, other avatars and everything
    // else of the other plane disappear at once. Only history keeps its own
    // plane, because each action there records the plane it was in.
    const next: Partial<CyberspaceState> = { plane, proof: IDLE_PROOF }
    if (get().exploreIndex === null) next.anchorPlane = plane
    set(next)
  },

  togglePlane: () => { get().setPlane(get().plane === 0 ? 1 : 0) },

  applyProofMessage: async (msg) => {
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

    // Capture the chain we are extending. A cancel or a respawn bumps requestId,
    // so for this id events/head stay valid across the await; only `published`
    // moves under us as the publisher drains, so that is re-read after signing.
    const { pendingTarget, position, plane, events, genesisId, prevEventId } = get()
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

    let event: NostrEvent
    try {
      event = await signEvent(
        msg.mode === 'sidestep' && msg.sidestep
          ? sidestepTemplate({ ...link, ...msg.sidestep })
          : hopTemplate(link),
      )
    } catch (err) {
      // The signer refused, or a bunker dropped mid-handshake: the move does not
      // commit, and the avatar stays where the last committed hop left it.
      if (msg.id !== requestId) return
      set({
        pendingTarget: null,
        proof: {
          ...IDLE_PROOF,
          status: 'infeasible',
          elapsedMs: msg.elapsedMs,
          message: `Signing failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      })
      return
    }

    // A remote signer can take seconds; a cancel or respawn may have landed
    // while it was thinking. If so this receipt is for a chain that is gone.
    if (msg.id !== requestId) return

    const now = get()
    const stats: ChainStats = {
      hops: now.chain.hops + (msg.mode === 'hop' ? 1 : 0),
      sidesteps: now.chain.sidesteps + (msg.mode === 'sidestep' ? 1 : 0),
      totalOps: now.chain.totalOps + (msg.mode === 'hop' ? msg.totalOps : 0),
      totalHashes: now.chain.totalHashes + (msg.mode === 'sidestep' ? msg.totalOps : 0),
      totalMs: now.chain.totalMs + msg.elapsedMs,
    }
    const nextEvents = [...now.events, event]
    const nextPublished = { ...now.published, [event.id]: 'queued' as const }

    const following = now.atHead()
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
      positionHistory: [...now.positionHistory, newPosition],
    })

    saveChain(nextEvents, nextPublished, stats)
  },

  setLive: (live) => {
    if (live === get().live) return
    saveLive(live)
    set({ live, publishError: null })
  },

  respawn: async () => {
    // A proof in flight was for a chain that is about to stop existing.
    if (get().proof.status === 'computing') {
      cancelProof()
      requestId++
    }
    const { events } = get()
    const fresh = derive(await freshSpawnAsync(currentSigner, events[events.length - 1]))
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
      // A standing focus (a shard, EARTH, a viewed stop) would hide the
      // avatar and keep the rig on the old point: spectating replaces it.
      focus: null,
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
    // Back to your own head, in the plane you have lined up there.
    const { position, plane } = get()
    set({ spectate: null, exploreIndex: null, anchor: position, anchorPlane: plane })
  },

  focusOn: (position, plane, label, scaleExp) => {
    const next: Partial<CyberspaceState> = {
      focus: { position: { ...position }, plane, label },
      // Remember the zoom once, at the first focus; later focus changes keep it.
      focusReturnScale: get().focus === null ? get().scaleExp : get().focusReturnScale,
      spectate: null,
      exploreIndex: null,
      anchor: { ...position },
      anchorPlane: plane,
    }
    if (scaleExp !== undefined) next.scaleExp = Math.max(0, Math.min(MAX_SCALE_EXP, Math.round(scaleExp)))
    set(next)
  },

  clearFocus: () => {
    // Home is your position in the plane you have lined up, which is what
    // the scene showed before the focus began.
    const { position, plane, focusReturnScale, scaleExp } = get()
    set({
      focus: null,
      anchor: position,
      anchorPlane: plane,
      // Back at the zoom the user left, not whatever the viewed thing chose.
      scaleExp: focusReturnScale ?? scaleExp,
      focusReturnScale: null,
    })
  },

  boardHyperspace: async () => {
    const { events, genesisId, prevEventId, position, plane, proof, transit } = get()
    if (transit !== null || proof.status === 'computing') return
    if (get().exploreIndex !== null || get().spectate !== null || get().focus !== null) return
    // A provisional identity has no chain to board from; move once first.
    if (events.length === 0 || !genesisId || !prevEventId) return
    const head = events[events.length - 1]
    const coord = xyzToCoord(position.x, position.y, position.z, plane)
    const proofHash = computeEnterProof(coord, prevEventId)
    const template = enterHyperspaceTemplate({
      createdAt: nextCreatedAt(head),
      genesisId,
      previousId: prevEventId,
      at: position,
      plane,
      proofHash,
    })
    let event: NostrEvent
    try {
      event = await get().signEvent(template)
    } catch {
      return
    }
    // The chain may have advanced while a remote signer thought about it.
    if (get().prevEventId !== prevEventId) return
    const published: Record<string, PublishStatus> = { ...get().published, [event.id]: 'queued' }
    const nextEvents = [...get().events, event]
    set({
      events: nextEvents,
      prevEventId: event.id,
      published,
      positionHistory: [...get().positionHistory, { ...position }],
      transit: { stage: 'boarded', enterEventId: event.id, enterCoordHex: positionHex(position, plane) },
    })
    saveChain(nextEvents, published, get().chain)
  },

  completeRide: async (ride) => {
    const { events, genesisId, prevEventId, transit } = get()
    if (!transit || !genesisId || !prevEventId) return
    const head = events[events.length - 1]
    if (!head) return
    // One ride per boarding for now; the spec allows chaining rides (§4.3) and
    // the builder supports it, but the client boards fresh each time.
    const prevCoordHex = head.tags.find((t) => t[0] === 'C')?.[1] ?? transit.enterCoordHex
    const template = hyperjumpTemplate({
      createdAt: nextCreatedAt(head),
      genesisId,
      previousId: prevEventId,
      prevCoordHex,
      toCoordHex: ride.toCoordHex,
      fromHeight: ride.fromHeight,
      toHeight: ride.toHeight,
      asOf: ride.asOf,
      rootHex: ride.rootHex,
      mp: ride.mp,
    })
    let event: NostrEvent
    try {
      event = await get().signEvent(template)
    } catch {
      return
    }
    if (get().prevEventId !== prevEventId) return
    const dest = coordToXyz(hexToCoord(ride.toCoordHex))
    const newPosition: Position = { x: dest.x, y: dest.y, z: dest.z }
    const published: Record<string, PublishStatus> = { ...get().published, [event.id]: 'queued' }
    const nextEvents = [...get().events, event]
    set({
      events: nextEvents,
      prevEventId: event.id,
      published,
      position: newPosition,
      cursor: { ...newPosition },
      plane: dest.plane,
      headPlane: dest.plane,
      positionHistory: [...get().positionHistory, newPosition],
      anchor: { ...newPosition },
      anchorPlane: dest.plane,
      transit: null,
    })
    saveChain(nextEvents, published, get().chain)
  },

  cancelTransit: () => set({ transit: null }),

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

  adoptChain: (incoming) => {
    const cur = get()
    // A local commit owns the head while it computes; a relay echo must not race it.
    if (cur.proof.status === 'computing') return
    const me = cur.identity.pubkey
    const mine = incoming.filter((e) => e.pubkey === me)
    if (mine.length === 0) return
    const seen = new Set(cur.events.map((e) => e.id))
    const merged = cur.events.concat(mine.filter((e) => !seen.has(e.id)))
    // buildChain is §3.2: the newest spawn wins, then follow the links. So a
    // newer chain from another machine supersedes ours; our own echoed events
    // fold in as a no-op. It returns parsed actions in order; map back to the
    // raw events the store actually holds.
    const order = buildChain(merged)
    if (order.length === 0) return
    const head = order[order.length - 1]
    if (head.id === cur.prevEventId && order.length === cur.events.length) return
    const byId = new Map(merged.map((e) => [e.id, e]))
    const chainEvents = order.map((a) => byId.get(a.id)).filter((e): e is NostrEvent => !!e)
    // Relay events are on the wire; keep whatever of ours was already published.
    const okIds = new Set<string>([
      ...mine.map((e) => e.id),
      ...cur.events.filter((e) => cur.published[e.id] === 'ok').map((e) => e.id),
    ])
    const saved: PersistedChain = {
      version: 2,
      events: chainEvents,
      published: chainEvents.filter((e) => okIds.has(e.id)).map((e) => e.id),
      stats: statsFromChain(chainEvents, cur.chain),
    }
    const d = derive(saved)
    const following = cur.atHead()
    set({
      events: d.events,
      genesisId: d.genesisId,
      prevEventId: d.prevEventId,
      published: d.published,
      chain: saved.stats,
      position: d.position,
      plane: d.plane,
      headPlane: d.headPlane,
      positionHistory: d.positionHistory,
      // Follow to the new head only if you were living at it; browsing history
      // or spectating keeps its view while the chain updates underneath.
      ...(following ? { anchor: d.position, anchorPlane: d.headPlane, cursor: d.position, exploreIndex: null } : {}),
    })
    saveChain(d.events, d.published, saved.stats)
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

  signEvent,

  initSigner: async () => {
    // Local identities are live from module load; an extension or bunker was
    // only deferred. Force its reconnection now, so the first move never waits.
    const pref = loadSignerPref()
    if (!pref || pref.kind === 'local') return
    try {
      if (currentSigner.pubkey === pref.pubkey && currentSigner.reconnect) {
        await currentSigner.reconnect()
      } else {
        await switchTo(await signerFromPref(pref))
      }
    } catch (err) {
      set({ loginError: `Could not reconnect ${pref.kind}: ${err instanceof Error ? err.message : String(err)}` })
    }
  },
  useNewKey: async () => { await switchTo(randomSigner()) },
  useNsec: async (nsec) => {
    try { await switchTo(signerFromNsec(nsec)) }
    catch (err) { set({ loginError: err instanceof Error ? err.message : String(err) }) }
  },
  useNcryptsec: async (ncryptsec, password) => {
    try { await switchTo(signerFromNcryptsec(ncryptsec, password)) }
    catch (err) { set({ loginError: err instanceof Error ? err.message : String(err) }) }
  },
  useExtension: async () => {
    try { await switchTo(await nip07Signer()) }
    catch (err) { set({ loginError: err instanceof Error ? err.message : String(err) }) }
  },
  useBunker: async (uri) => {
    try { await switchTo(await nip46Signer(uri)) }
    catch (err) { set({ loginError: err instanceof Error ? err.message : String(err) }) }
  },
  clearLoginError: () => set({ loginError: null }),

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
    const { events, position, plane } = get()
    const head = events[events.length - 1]
    // Provisional identity: no head event yet, so read the spawn coordinate.
    return head ? head.tags.find((t) => t[0] === 'C')?.[1] ?? '' : positionHex(position, plane)
  },

  sector: () => {
    const { position } = get()
    return sectorTag(xyzToSectorId(position.x, position.y, position.z))
  },

  actions: () => parsedChain(get().events),

  atHead: () =>
    get().exploreIndex === null &&
    get().spectate === null &&
    get().focus === null &&
    get().transit === null,

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
    const { anchor, cursor, scaleExp, view, focus } = get()
    const focusAxes = viewAxes(view)
    // A focus is a continuous point (a stop, Earth's centre), and everything
    // drawn at it uses pointCentre. Framing [0,0,0], the aligned CORNER of
    // its cell, put the viewed block up-and-right of screen centre by the
    // sub-cell fraction (always positive, so always the same corner). Frame
    // the point itself, with the same continuous math it is drawn with.
    if (focus !== null) {
      // Same policy as markerCentre: at occupancy zooms the marker snaps to
      // its cell, whose cube centre is the aligned origin itself.
      if (scaleExp <= OCCUPANCY_SCALE_MAX) return [0, 0, 0]
      const focusOrigin = alignedOrigin(anchor, scaleExp)
      return [focusAxes.right, focusAxes.up, focusAxes.out].map(
        (a) => (cellDelta(anchor[a.axis], focusOrigin[a.axis], scaleExp) - 0.5) * a.dir,
      ) as [number, number, number]
    }
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
  }
})

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
 * The ceiling defaults to the hard cap; commit passes the calibrated one so
 * the landing agrees with the routing decision that chose a sidestep.
 */
export function sidestepTarget(position: Position, cursor: Position, ceiling: number = MAX_COMPUTE_HEIGHT): Position {
  const land = (p: bigint, c: bigint): bigint =>
    findLcaHeight(p, c) > ceiling ? sidestepLanding(p, c) : p
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
