import { bigintBitLimit, movementCapabilityIssue } from '../lib/proofCapability'
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
import { destinationHeights, holdCloudDestinationKeys, holdDestinationCubes } from '../lib/destinationKeys'
import { localKeyCeiling, regionKeyQuote } from '../lib/deployPlan'
import { experienceRatio, recordJobExperience } from '../lib/experience'
import { lineStateOf, rideStatsOf, zeroLengthRideRefusal } from '../lib/hyperspace/ride'
import { verifyCloudRide } from '../lib/cloudRide'
import { Quaternion } from 'three'
import { generateSecretKey, getEventHash, verifiedSymbol, verifyEvent, type VerifiedEvent } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { exportNcryptsec } from '../lib/keyExport'
import {
  deferredReconnect,
  loginCredentialKind,
  localSigner,
  randomSigner,
  signerFromNcryptsec,
  signerFromNsec,
  signerFromPref,
  nip07Signer,
  nip46Signer,
  NIP44_UNAVAILABLE,
  NIP04_UNAVAILABLE,
  NIP44_ENCRYPT_UNAVAILABLE,
  SignerAccountMismatch,
  SignerUnconfirmed,
  prefOf,
  loadSignerPref,
  saveSignerPref,
  type Signer,
  type SignerKind,
  type NostrConnectSession,
  signWithin,
} from '../lib/signers'
import {
  coordToXyz,
  estimateHopCost,
  findLcaHeight,
  hexToCoord,
  sectorTag,
  sidestepLanding,
  xyzToSectorId,
  type Plane,
  verifyHopLevel1,
} from 'cyberspace-core'
import {
  GRID_RADIUS,
  MAX_SCALE_EXP,
  OCCUPANCY_SCALE_MAX,
  alignTo,
  anchorCentre,
  canonicalQuaternion,
  cellDelta,
  clampAxis,
  itemCentre,
  placeCentre,
  rotateView,
  stepFor,
  topDownQuaternion,
  viewAxes,
  type AxisDirection,
  type Position,
  type RotateDirection,
  type ViewAxes,
} from '../lib/space'
import { confirmChainEvents } from '../lib/chains'
import { chainDbAvailable, chainWritePause, readStoredChain, setAsideChains, setAsideStoredChain, writeStoredChain, type StoredChain } from '../lib/chainDb'
import { clearTail, committedHead, deployAllowsMove, inRows, markerValue, migrateToRows, noteCommitted, onChainLost, onChainRefused, readRows, readTail, rowsHead, rowsMarked, rowsWanted, saveRows, setAsideRows, setMarker, storeWorksHere, turnRowsOff, writeTail, type RowsRead } from '../lib/chainStore'
import { eventDbAvailable } from '../lib/eventDb/client'
import type { ChainRead, ChainSource } from '../lib/eventDb/chainRows'
import { checkSignatures } from '../lib/sigCheck'
import {
  firstMove,
  foldHeldConflict,
  localSupersedes,
  type CheckVerdict,
  type HeldConflict,
  type SelfCheck,
} from '../lib/chainHold'
import { findDivergence, foldBranchConflict, relayVersion, type BranchConflict } from '../lib/branchConflict'
import {
  ACTION_KIND,
  buildChain,
  chainHead,
  extendChain,
  firstBreak,
  openBracket,
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
import { lookBeforeMove, movementBlocked, VERSION_BLOCKED_MESSAGE } from '../lib/versionGate'
import { cancelProof, postProof, type ProofMode, type ProofResponse } from '../lib/workers'
import { staleFormatCut } from '../lib/staleFormat'
import { offloadFrom, cloudSeconds } from '../lib/crossover'
import { recommendedHopHeight, recommendedSidestepHeight, useCalibration } from '../lib/calibration'
import {
  createHosaka,
  createWaker,
  type CloudHopResult,
  type HosakaAction,
  type HosakaRegionKeyResult,
  type CloudRideResult,
  type HosakaClient,
  type HosakaJob,
  type HosakaLimits,
  type Waker, type HosakaProvider, type HopWants, keysPending,
  HosakaError,
  cloudHopPause,
  cloudHopsSold } from '../lib/hosaka'
import { cloudVerifyIssue } from '../lib/cloudVerify'
import {
  clearCloudJob,
  clearKeysTicket,
  loadKeysTicket,
  saveKeysTicket,
  cloudProofResponse,
  describeCloudError,
  hopPausedWords,
  straddlingV1Hop,
  driveCloudJob,
  hosakaCoord,
  invoiceOf,
  loadCloudJob,
  loadCloudPrefs,
  needsApproval,
  satsOf,
  positionFromWire,
  retainsRecord,
  saveCloudJob,
  saveCloudPrefs,
  saveCloudRegionKey,
  verifyCloudResult,
  wirePosition,
  type CloudInvoice,
  type CloudMode,
  type CloudPrefs,
  type PendingCloudJob,
  loadSpent,
  addSpent,
  loadCloudDeposit,
  saveCloudDeposit,
  clearCloudDeposit,
  loadBalance,
  saveBalance,
  type KnownBalance,
  formatWait,
} from '../lib/cloud'
import { nextStep, planSummary, type Ceilings, type PlanStep, type PlanSummary } from '../lib/movePlan'
import { computeEnterProof } from '../lib/hyperspace/enter'
import { addRecentView } from '../lib/viewAt'
import { endOfChainLabel } from '../lib/chainBreak'
import { buildStepOf } from '../lib/buildCursor'
import { targetColor, type CyberTarget } from '../lib/targets'
import { useSecrets } from './useSecrets'
import { useToast } from './useToast'
import { useChainUi } from './useChainUi'
import type { SelfCrypto } from '../lib/muteList'

/**
 * The explored chain, parsed once per events change rather than on every
 * read. Every explorer selector goes through this.
 */
let actionsFor: { events: NostrEvent[]; actions: ActionEvent[] } | null = null
function parsedChain(events: NostrEvent[]): ActionEvent[] {
  if (!actionsFor || actionsFor.events !== events) actionsFor = { events, actions: appendedTo(actionsFor, events) ?? buildChain(events) }
  return actionsFor.actions
}

/**
 * The chain of `events` from the one memoized, when `events` are its events
 * and one more (an action signed here, an event the feed brought): only the
 * new one is read (lib/events.ts extendChain). Null otherwise.
 */
function appendedTo(memo: { events: NostrEvent[]; actions: ActionEvent[] } | null, events: NostrEvent[]): ActionEvent[] | null {
  if (!memo || events.length !== memo.events.length + 1) return null
  for (let i = 0; i < memo.events.length; i++) if (events[i] !== memo.events[i]) return null
  return extendChain(memo.actions, memo.events, events[events.length - 1])
}

/**
 * Whether a fold of nothing new into `events` would leave them as they are
 * (adoptChain): the chain they build is all of them, ending at `prevEventId`,
 * or it is forked, which keeps every event. Exactly the two ways adoptChain
 * returns without a change once the merge adds nothing.
 */
function settledChain(events: NostrEvent[], prevEventId: string, pubkey: string): boolean {
  // parsedChain reads every author's spawns, adoptChain only `pubkey`'s: the same chain when all of them are its.
  if (!events.every((e) => e.pubkey === pubkey)) return false
  const order = parsedChain(events)
  if (order.length === 0) return true
  if (order[0].fork !== undefined) return true
  return order[order.length - 1].id === prevEventId && order.length === events.length
}

/**
 * Why nothing moves while a game holds the avatar. This client never
 * publishes inside a virtual bracket: every event there belongs to the game,
 * a hop, sidestep or ride there is invalid and ends the chain for every
 * verifier (spec §8.11.4 rule 3), and an exit is the game client's to make,
 * since only the game knows what leaving means to it (§8.11.7). So a chain
 * with a bracket open at its head refuses every move here, says why, and
 * shows the game in the Proof chain panel.
 */
export const GAME_HOLDS_MESSAGE =
  'A game holds your avatar. This identity entered a game from another client, and until that client publishes an exit, every action on your chain belongs to the game. A hop, sidestep or ride signed now would make your whole chain invalid from that point, so ONOSENDAI will not sign one. Leave the game in the client you entered it with, and you can move again from the place you entered it. If that client is gone, a respawn also leaves the game (spec §8.11.4): it starts a new chain at your spawn point, and what leaving without an exit means is up to the game. The Proof chain panel shows the game.'

/**
 * THE SWITCH for refusing moves on a broken chain (review of #224, S2), on
 * since arkinox's ruling of 2026-10-07 (Q3): an invalid chain stands at its
 * last valid position, frozen until a respawn.
 *
 * A chain with a broken event (events.ts firstBreak) is one every verifier
 * treats as invalid from that event, so a move signed onto it is a move no
 * verifier counts. Every move (commit, route step, BOARD, RIDE, signing a
 * finished proof) refuses with BROKEN_CHAIN_MESSAGE; whyNoMove is the one
 * place that reads this.
 */
export const REFUSE_MOVES_ON_BROKEN_CHAIN = true

export const BROKEN_CHAIN_MESSAGE =
  'Your chain is broken, so you are frozen where it was last valid. One of its actions breaks a chain rule, and every verifier treats your chain as invalid from that action on: you stand at the last valid position before it, and any move added now is a move nobody would count, so ONOSENDAI will not sign one. To move again, respawn: you start a new, valid chain at your spawn point. The red CHAIN BROKEN notice names the action, says why it broke the chain, and has the RESPAWN button.'

/**
 * Why this client will not sign a base action onto `chain` now, in words, or
 * null when it may. Every way to move asks this one question. A deploy that
 * requires newer chain rules than this build's comes first
 * (lib/versionGate.ts): nothing this tab signs would be in the format the
 * rules now ask for, a respawn included, so a RELOAD is the way on from
 * anything. Then a broken chain: nothing on it counts, a game included, and
 * a respawn is the only way on from either.
 */
/**
 * A forked chain refuses every move too, but it stands at the spawn
 * coordinate, not at a last valid position (spec §3.2, §8.7.3 rule 4).
 */
export const FORKED_CHAIN_MESSAGE =
  'Your chain forked, so it is dead and you stand at your spawn coordinate. Two actions name the same action as the one before them, and every verifier treats a forked chain as invalid from its spawn, so any move added now is a move nobody would count, and ONOSENDAI will not sign one. To move again, respawn. The red CHAIN FORKED notice names both actions and has the RESPAWN button.'

/** The refusal for a chain with a break: the fork's words for a fork, the broken chain's otherwise. */
export function brokenChainMessage(broken: NonNullable<ReturnType<typeof firstBreak>>): string {
  return broken.action.fork ? FORKED_CHAIN_MESSAGE : BROKEN_CHAIN_MESSAGE
}

export function whyNoMove(chain: ActionEvent[]): string | null {
  if (movementBlocked()) return VERSION_BLOCKED_MESSAGE
  const broken = REFUSE_MOVES_ON_BROKEN_CHAIN ? firstBreak(chain) : null
  if (broken) return brokenChainMessage(broken)
  if (openBracket(chain)) return GAME_HOLDS_MESSAGE
  return null
}

/** Why a finished proof is not signed while a choice between two chains is waiting. */
const CHOOSE_FIRST_MESSAGE = 'Another version of your chain arrived while this proof was computing. Choose which to keep first; the proof is kept, and RESUME signs it if your chain is still where it was.'
/** A commit whose wait ended with you no longer at your head (BUILD mode, a VIEW): nothing was sent. */
export const LEFT_HEAD_MESSAGE = 'This move was not sent: you left your avatar (BUILD mode or a VIEW) while it was being checked, and a move is only ever taken from where you stand to where you aimed it. Return to your avatar and commit again.'
/** A commit whose cursor or plane changed while it waited: nothing was sent. */
/** Why a WALK step stopped short: it needs HOSAKA, and a walk never pays on its own. */
export const WALK_NEEDS_HOSAKA_MESSAGE = 'WALK stopped: this step crosses a boundary only HOSAKA computes. Switch to HOP to see the offer.'
export const AIM_CHANGED_MESSAGE = 'This move was not sent: the cursor or the plane changed while it was being checked. Commit again to go where the cursor is now.'

/** A HOSAKA whose /limits does not say hop_proof_version 2 makes the old hop proof, which this client cannot sign: no hop is bought from it. */
const NO_V2_CLOUD_HOPS_MESSAGE = 'This HOSAKA still makes hops in the old proof format, which the chain rules no longer accept, so no cloud hop is bought from it. Nothing was charged.'
/** A finished proof with no move waiting for it (a cut or a cancel cleared the target): never signed. */
const NO_TARGET_MESSAGE = 'This proof was not signed: the move it was computed for is no longer lined up. Commit again.'
/** A signed cloud move whose c or C is not the move its job was bought for: never recorded or sent. */
const CLOUD_MOVE_MISMATCH_MESSAGE = 'This cloud move was not recorded or sent: the signed event does not name the move HOSAKA computed it for. The paid result is kept: RESUME signs it for its own move, from where the job started; moving first makes it worthless.'
/** A local hop whose proof failed Level 1 under its own signed id: never recorded or sent. */
const LOCAL_CHECK_FAILED_MESSAGE = 'This hop was not recorded or sent: its proof did not pass the check every reader will make of it'
/** A finished proof in the old hop format (no mn, no mp): never signed (hop proof version 2, spec 5.9 to 5.13). */
const OLD_FORMAT_PROOF_MESSAGE = 'This proof is in the old hop format, which the chain rules no longer accept, so it was not signed. Commit again to make the move with the new proof.'
/**
 * The message for a proof whose head moved before it was signed: the work is
 * seeded by the head it started from (spec §5.3), so signed onto any other
 * head every check of it fails.
 */
const HEAD_MOVED_MESSAGE = 'Your chain moved while this proof waited to be signed: another device or client of yours published from your head. A proof is bound to the head it was computed from, so this one cannot be signed onto the new head.'


/** Matches cyberspace-core's DEFAULT_MAX_COMPUTE_HEIGHT. */
export const MAX_COMPUTE_HEIGHT = 20

/**
 * Another avatar, followed. Their chain is the focus chain while this is set:
 * the scene anchors on it, the explorer walks it, and the controls stand down
 * because nothing here is yours to move.
 */
/** A place on Earth left marked in the scene. See `pin` on the store. */
export interface EarthPin {
  position: Position
  plane: Plane
  /** The zoom it was dropped at, which clicking it returns you to. */
  scaleExp: number
  /** What to call it: the same "EARTH · 37.8°N 122.4°W" the focus was given. */
  label: string
}

export interface SpectateState {
  pubkey: string
  npub: string
  /** Raw, so new events from the relay can be merged and the chain rebuilt. */
  events: NostrEvent[]
  actions: ActionEvent[]
  /** created_at of their newest action; null when the relay has none. */
  lastActive: number | null
  /**
   * `partial`: the relays hold this chain with a stretch missing (chains.ts
   * ChainGapError), so it is shown up to the hole, and its head may be later
   * than what is drawn.
   */
  status: 'loading' | 'live' | 'empty' | 'error' | 'partial'
  /** The view you had before spectating, put back when it ends. */
  returnView: Quaternion
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
  terrainK: number | null
  lca: { x: number; y: number; z: number } | null
  /** Cantor pairings for hops; SHA-256 evaluations for sidesteps. */
  totalOps: number | null
  message: string | null
  /** Where the proof was computed: this machine, or HOSAKA. */
  source: 'local' | 'cloud'
  /** What a cloud proof cost, in msats; null for a local one. */
  costMsats: number | null
  /** A cloud hop's region lookup id (spec 7.2). The region key itself is stored, not shown. */
  lookupId: string | null
}

const IDLE_PROOF: ProofState = {
  status: 'idle',
  mode: 'hop',
  progress: 0,
  elapsedMs: 0,
  proofHash: null,
  terrainK: null,
  lca: null,
  totalOps: null,
  message: null,
  source: 'local',
  costMsats: null,
  lookupId: null,
}

export type PlanStatus = 'funding' | 'running' | 'paused' | 'failed'

/**
 * A commit beyond the ceiling is a route, not one event: hops to the leaf
 * touching the wall, a sidestep of exactly 1 gibson across it, hops on, for
 * every wall between here and the cursor (spec 6.3, lib/movePlan.ts). The
 * route runs one step at a time, each step its own proof and its own
 * signature, and the next step is computed from wherever the last one
 * landed. A declined signature pauses it with the finished proof kept, so
 * RESUME asks for the signature again instead of recomputing.
 */
export interface MovePlan {
  /** Where the route ends: the cursor at commit time. */
  target: Position
  /** What each primitive can reach here and in the cloud; every step was sized to these. */
  ceilings: Ceilings
  /** Counts for the whole route, taken at commit time. */
  summary: PlanSummary
  /** Steps already signed and appended. */
  done: number
  /** The step in progress, or the one the route is paused on. */
  step: PlanStep
  status: PlanStatus
  /** Why the route paused or failed; null while it runs. */
  message: string | null
  /** A finished proof waiting for its signature across a pause. */
  awaiting: ProofResponse | null
  /**
   * Paused before it was paid for, because HOSAKA's cloud hops were paused
   * (hosaka-api hop_pause): RESUME asks for a quote again rather than
   * starting a step nobody has approved a price for.
   */
  requote?: boolean
  startedAt: number
  /** A WALK step's route (commitToward): a head that moves under it stops the walk instead of computing the step again (headMovedUnder). */
  walk?: true
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
  /** Completed hyperjumps (DECK-0001 rides), from the chain's own events. */
  hyperjumps: number
  /** Blocks those rides passed, summed; the ride proof's unit of work. */
  blocksRidden: number
}

const EMPTY_STATS: ChainStats = { hops: 0, sidesteps: 0, totalOps: 0, totalHashes: 0, totalMs: 0, hyperjumps: 0, blocksRidden: 0 }

/**
 * Respawns are a fact about the identity, not the chain: each one starts a
 * new chain and the old events leave the store, so the count lives beside
 * the identity in storage rather than in the chain's stats.
 */
const RESPAWNS_KEY = 'onosendai:respawns'

function respawnTable(): Record<string, number> {
  try {
    const raw = localStorage.getItem(RESPAWNS_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {}
  } catch {
    return {}
  }
}

export function loadRespawns(pubkey: string): number {
  const v = respawnTable()[pubkey]
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

export function addRespawn(pubkey: string): number {
  const table = respawnTable()
  const next = loadRespawns(pubkey) + 1
  table[pubkey] = next
  try { localStorage.setItem(RESPAWNS_KEY, JSON.stringify(table)) } catch { /* storage unavailable: the number is still in memory */ }
  return next
}

/**
 * The cloud flow's stations. `quoting` covers every exchange before there is
 * a job (the public quote, then the signed submit); `confirm` waits for PAY;
 * the payment stages mirror the persisted job's stage; `verifying` is this
 * client checking the result before it signs. `error` keeps its message until
 * X or the next commit.
 */
export type CloudStatus = 'idle' | 'quoting' | 'confirm' | 'funding' | 'awaiting_payment' | 'paid' | 'computing' | 'verifying' | 'error'

/** HOSAKA's price for the lined-up move, waiting for PAY or already approved. */
export interface CloudQuote {
  action: HosakaAction
  /** Where the paid move lands: the cursor for a hop, past the wall for a sidestep. */
  to: Position
  costMsats: number
  tier: string | null
  /** The whole route's wait: the steps' seconds added up when the server gives them. */
  estTime: string | null
  estSeconds: number | null
  maxHeight: number
  K: number
  /** A whole route's quote: the sum over its cloud steps, paid with one deposit. */
  route?: { steps: number; cloudSteps: number }
  /**
   * Work HOSAKA already holds, summed over the route's cloud steps: how many
   * axis trees it does not have to build, and what that takes off this price
   * and this wait. Absent when there is none, or when HOSAKA does not say.
   */
  reuse?: { axes: number; savedMsats: number; savedSeconds: number }
}

export interface CloudState {
  status: CloudStatus
  quote: CloudQuote | null
  invoice: CloudInvoice | null
  /** The invoice modal is up. A tap outside folds it; the Cloud panel reopens it. */
  invoiceOpen: boolean
  /** The pending job record, as persisted; kept after a cancel once it is paid. */
  job: PendingCloudJob | null
  /** HOSAKA's own progress estimate while computing, 0..1; null when it has none. */
  progress: number | null
  message: string | null
  /** GET /limits, fetched once per API URL; null until it answers, which means no cloud route. */
  limits: HosakaLimits | null
  /** GET /provider, fetched with the limits; null on a provider that does not serve it, when the built-in HOSAKA presentation stands in. */
  provider: HosakaProvider | null
  /** Date.now() when this flow began, for the elapsed line. */
  startedAt: number | null
  /** The last cloud proof that landed, for the panel. */
  last: { jobId: string; action: HosakaAction; costMsats: number; lookupId: string | null; at: number } | null
  /** CHECK PAYMENT was pressed and the node has not answered yet. */
  /** HOSAKA's prepaid balance for this identity as last reported, from a
   * balance check or from any response that carried one; null until known. */
  balance: KnownBalance | null
  balanceChecking: boolean
  balanceError: string | null
  checking: boolean
  /** The node's last word on the invoice, so a check shows something even when nothing changed. */
  lastCheck: { at: number; status: string } | null
  /** A route deposit paid while the tab was away and claimed at startup:
   * the sats now on the balance, announced once, then dismissed. */
  credited: { msats: number; at: number } | null
  /**
   * Why the last ride bought from HOSAKA did not land, for the Hyperspace
   * panel, where the ride was asked for (arkinox, 2026-10-11). Cleared when
   * the next one starts or lands.
   */
  rideError: string | null
}

const IDLE_CLOUD: CloudState = {
  status: 'idle',
  quote: null,
  invoice: null,
  invoiceOpen: false,
  job: null,
  progress: null,
  message: null,
  limits: null,
  provider: null,
  startedAt: null,
  last: null,
  checking: false,
  lastCheck: null,
  balance: null,
  balanceChecking: false,
  balanceError: null,
  credited: null,
  rideError: null,
}

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
  /** `partial`: placed from their chain up to a stretch the relays are missing, which may not be their head. */
  status: 'resolving' | 'live' | 'spawn' | 'error' | 'partial'
}

/** Hyperspace transit (DECK-0001 v3): the identity has boarded and not yet arrived. */
export interface TransitState {
  stage: 'boarded'
  enterEventId: string
  enterCoordHex: string
}

/** A finished ride, as the worker pool hands it back (§5.4 and §5.5). */
export interface CompletedRide {
  /** The chain head the ride was computed against: the seed of every leaf,
   * so it must be the `previous` the event is published under. */
  previousId: string
  toCoordHex: string
  fromHeight: number
  toHeight: number
  /** The station set bound declared in the event (as_of tag). */
  asOf?: number
  rootHex: string
  mp: string
  /** The re-roll nonce (§5.5), the `mn` tag. */
  mnHex: string
}

/**
 * A ride to buy from HOSAKA (arkinox, 2026-10-11): everything the hyperjump
 * needs except the proof, planned exactly as a local ride is (the Hyperspace
 * panel's prepareRide), plus HOSAKA's own estimate of the wait.
 */
export interface CloudRideAsk {
  previousId: string
  fromHeight: number
  toHeight: number
  asOf?: number
  toCoordHex: string
  /** HOSAKA's quoted seconds; how patiently the job is polled. */
  estSeconds: number | null
}

/** What the camera is looking at, when it is not looking at your own head. */
export interface CyberFocus {
  position: Position
  plane: Plane
  label: string
  /** The cursor came along (VIEW): the pad drives it here. */
  drive?: boolean
  /**
   * A hidden item (a shard, a message) is what is being looked at: the camera
   * frames it where it is drawn, its true place (itemCentre), rather than by
   * the stop markers' policy.
   */
  item?: boolean
}

export interface CyberspaceState {
  identity: { pubkey: string; npub: string }
  position: Position
  /** Where the next hop would land. Free to noodle; costs nothing until committed. */
  cursor: Position
  /** Destination of the in-flight proof; null when nothing is computing. */
  pendingTarget: Position | null
  /** The route a commit beyond the ceiling is executing; null otherwise. */
  plan: MovePlan | null
  /**
   * What the last fold from elsewhere did to this chain.
   *
   * One identity has one chain, however many devices are signed in. When two
   * of them act from the same head the chain forks, and every reader, this
   * device included, resolves it the same way: follow the oldest child at the
   * branch, breaking a tie on the smaller event id (events.ts buildChain).
   * So one branch wins for everybody and the other one's actions are simply
   * not in the chain any more. That used to happen in silence, and a silent
   * loss of work you paid HOSAKA for is the worst way to learn about it.
   *
   * `adopted` is how many actions came from another device, which explains an
   * avatar that moved on its own. `dropped` is how many of this device's
   * actions the fold left out of the chain.
   *
   * `replaced` gets its own words, because the generic count hides what
   * happened (arkinox, 2026-10-01): the adopted chain begins with a newer
   * spawn, so this device's whole chain was superseded (§3.2: a respawn on
   * another device, or another device answering the held-chain prompt with
   * "Keep the local chain"). A fork is never reported here: a fork ends the
   * whole chain (spec §8.7.3 rule 4, arkinox 2026-10-08), so both branches
   * are kept and the broken-chain notice says so.
   */
  forkNotice: { adopted: number; dropped: number; replaced: boolean; at: number } | null
  /**
   * Whether this identity already has a chain on the relays, as last asked
   * (lib/chainHold.ts, lib/selfSync.ts): `checking`, `found`, `none`, or
   * `unknown` with the cause. Per identity: reset to `checking` on every
   * switch and asked again on every load and whenever the connection comes
   * back while the answer is `unknown`.
   */
  selfCheck: SelfCheck
  /**
   * The chain is HELD: it was started by a first move the relays could not
   * vouch for, so it stays on this device whatever LIVE says (arkinox,
   * 2026-10-01). Lifted silently when the relays answer that there is no
   * other chain; turned into `chainConflict` when they answer with one.
   * Persisted with the chain. Bags and messages are not affected.
   */
  held: boolean
  /**
   * A choice between two versions of this identity's chain, waiting for the
   * person. `held`: a held chain met a chain on the relays
   * (resolveHeldConflict). `branch`: this device's unpublished moves fork
   * against moves another device already published (resolveBranchConflict,
   * lib/branchConflict.ts). Nothing is chosen automatically; while either is
   * pending no move is taken, nothing is published and nothing is adopted.
   */
  chainConflict: HeldConflict | BranchConflict | null
  /** Bumped by a deliberate "publish now" that is not an action (lib/release.ts `release`). */
  publishRequest: number
  /** The self-check's answer for `pubkey`; ignored when the identity has moved on. */
  applySelfCheck: (pubkey: string, verdict: CheckVerdict | { status: 'checking' }) => void
  /**
   * Answer the held-chain prompt. `relay` deletes the local held chain and
   * places you at the relay chain's head; `local` lifts the hold so the local
   * chain publishes (now, while LIVE) and, its spawn being newer, supersedes
   * the relay chain for every reader. Region keys stay held either way.
   */
  resolveHeldConflict: (choice: 'relay' | 'local') => void
  /**
   * Answer the diverged-branch prompt. `relay` discards this device's
   * unpublished moves after the fork and takes the relays' version. `mine`
   * is refused: publishing them would fork the chain on the relays, and a
   * fork ends the whole chain (spec §8.7.3 rule 4, arkinox 2026-10-08).
   */
  resolveBranchConflict: (choice: 'relay' | 'mine') => void
  /** Sats spent on HOSAKA for the current chain, in msats. Kept on this device only, never published. */
  spentMsats: number
  /** How many times this identity has respawned; each one began a new chain. */
  respawns: number
  /**
   * The plane the next commit lands in. Part of the lined-up action, like the
   * cursor: toggling it costs nothing until committed, and a commit with the
   * cursor parked but the plane flipped is a valid hop in its own right.
   */
  plane: Plane
  /** The plane the chain head is actually in. */
  headPlane: Plane
  scaleExp: number
  /**
   * The build STEP: how far each move steps the build cursor while a deploy is
   * lined up, and the cell the placement snaps to, as an exponent finer than
   * the zoom (arkinox, 2026-10-08). Null is the zoom itself, which is where
   * every deploy starts, so nothing changes until STEP is touched. Read it
   * through buildStepOf (lib/buildCursor.ts), which keeps it at or under the
   * zoom; zooming in to it or below puts it back on the zoom, by any path
   * (the subscription at the bottom). Cleared when the deploy ends (useShards)
   * and when BUILD mode does (store/buildStep.ts).
   */
  buildStep: number | null
  /**
   * Where lowering STEP last re-centered the build cursor (`at`), and where
   * you had put it before that (`from`): store/buildStep.ts. While the cursor
   * still sits at `at`, nothing but STEP has moved it, so it counts as being
   * at `from` (lib/buildCursor.ts placedCursor), and it goes back there when
   * STEP returns to following the zoom. Null while STEP has not re-centered.
   */
  buildSettle: { at: Position; from: Position } | null
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
  /**
   * How many published actions the canonical relay has not taken after
   * CANONICAL_LATE_MS, while another relay has (lib/publisher.ts keeps
   * asking it). Zero almost always; the status strip says so when it is not.
   */
  canonicalLate: number
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
  focus: CyberFocus | null
  /**
   * The pin: the place on Earth you asked to look at, left standing in the
   * scene so the focal point is visible rather than implied.
   *
   * Deliberately NOT derived from `focus`, because it has to outlive a focus
   * change: clicking a landfall moves the focus to that block and the pin
   * stays where it was, which is what makes it possible to look around and
   * come back. Dropped by a click on the globe and by a POSITION panel VIEW
   * that resolves to a point on Earth; cleared by RETURN (clearFocus) and by
   * REMOVE PIN. One at a time, so a second drop replaces the first.
   */
  pin: EarthPin | null
  /** Drop the pin at a place on Earth. `scaleExp` defaults to the zoom you are at. */
  dropPin: (position: Position, label: string, scaleExp?: number) => void
  /** Take the pin away. */
  clearPin: () => void
  /** Look at the pin again, at the zoom it was dropped at. */
  viewPin: () => void
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
  /**
   * Set the build STEP; at or above the zoom it goes back to following the
   * zoom (null), which also undoes STEP's re-centering if nothing has moved
   * the cursor since.
   */
  setBuildStep: (step: number | null) => void
  setCursorAtCell: (row: number, col: number) => void
  commit: () => Promise<void>
  /**
   * The /demo tour's SPAWN (arkinox, 2026-10-15): sign this identity's spawn
   * where it stands, before any move, through the same self-check a first
   * move waits on. Only for an identity with no chain; true when the spawn
   * was signed. The tour offers it only for a key it generated itself, and
   * nothing else calls it: no login, switch or page load signs a spawn.
   */
  signSpawn: () => Promise<boolean>
  /**
   * WALK's commit (store/useWalk.ts): one step to `target` from where you
   * stand, aimed at `target` rather than at the cursor, which in WALK is
   * already out ahead at the last queued step. `stillAimed` replaces the
   * cursor check: the walk is still on and this is still its next step. A
   * step that needs HOSAKA is refused rather than quoted, since nothing in a
   * walk ever pays on its own, and a step past the ceiling runs as a route
   * to `target` whatever the move mode is.
   */
  walkTo: (target: Position, stillAimed: () => boolean) => Promise<void>
  /**
   * WALK is on (store/useWalk.ts owns the queue). The cursor is the walk's
   * predicted head then, so nothing else may move it: the pad and the keys
   * go through the walk, and a tap on a cell does nothing.
   */
  walking: boolean
  /** Whether COMMIT runs one step of the route or all of them in order. */
  moveMode: MoveMode
  setMoveMode: (mode: MoveMode) => void
  /** Whether the regions you hold keys to are drawn in the scene. */
  showSecrets: boolean
  setShowSecrets: (show: boolean) => void
  /** Whether the chain's trail (the line through its positions) is drawn in the scene. */
  showTrail: boolean
  setShowTrail: (show: boolean) => void
  cancel: () => void
  /** Continue a paused route: ask for the pending signature again, or restart the step. */
  resumePlan: () => void
  /** Abandon a route. Steps already signed stay on the chain; the avatar stays where they left it. */
  cancelPlan: () => void
  /** Sign and append a finished proof (the second half of applyProofMessage). */
  finishProof: (msg: ProofResponse) => Promise<void>
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
  /**
   * A deliberate request to publish the waiting chain now, while LIVE: the
   * same release the held-chain answer gives (release.ts `release`,
   * `publishRequest`), so the publisher drains as for a new action, with its
   * relay look first. A held chain or a pending choice still stops it
   * (maySend), and shows as it always does. Nothing while LOCAL. Used by the
   * /demo tour's GO LIVE (arkinox, 2026-10-15).
   */
  publishNow: () => void
  /** Put the fork notice away once it has been read. */
  clearForkNotice: () => void
  setPublishStatus: (id: string, status: PublishStatus, reason?: string) => void
  /**
   * §3.2: a new spawn event, which by being newer retires every prior action.
   * The avatar is back at its pubkey with nothing behind it. Cannot be undone,
   * because the old chain's events still exist on relays but no longer lead
   * anywhere.
   */
  /** Rejects when the signature is refused, or when the identity changed while it was asked for. */
  respawn: () => Promise<void>
  /**
   * Respawn from a broken chain (arkinox, 2026-10-07, Q3): first the last
   * valid position goes into the Position panel's RECENT as "End of Chain"
   * and the first eight hex of the last valid event's id (the invalid
   * spawn's, when no event is valid, Q7), so the place the old chain froze
   * at is one tap away; then an ordinary respawn.
   */
  respawnFromBrokenChain: (forPubkey?: string) => Promise<void>
  /** Anchor the scene on action `index` of the chain; null or past the end is the head. */
  explore: (index: number | null) => void
  /** Step the explored index; clamps at both ends. */
  exploreStep: (delta: number) => void
  /**
   * Start following a pubkey: anchors on its spawn coordinate until its chain
   * arrives. With `keepView` and a driven view standing (BUILD mode,
   * store/useBuilder.ts), the view stays and is aimed at them instead: the
   * build cursor goes to their spawn, then to their head when the chain
   * arrives, and the pad keeps driving it.
   */
  beginSpectate: (pubkey: string, keepView?: boolean) => void
  /** The spectated chain, fetched or updated. Keeps the explored index when it still fits. */
  setSpectateChain: (pubkey: string, events: NostrEvent[], status?: 'live' | 'empty' | 'error' | 'partial') => void
  /** Back to your own head; with a driven view standing (BUILD mode), the view stays where it is. */
  endSpectate: () => void
  /**
   * Aim the driven view (the free view, and BUILD mode's build cursor) at a
   * place, in its plane, keeping a spectation: the cursor goes there and the
   * view follows it as it follows the pad, re-anchoring only when the place
   * is out of the field's reach. Nothing else changes: not your head, your
   * chain, or the plane lined up at it. Does nothing without a driven view.
   */
  aimView: (position: Position, plane: Plane) => void
  /**
   * Turn what is on screen into a driven view: a spectated avatar or an
   * action of history becomes a free view at that place, the spectation kept
   * and history left. BUILD mode entered from there starts its build cursor
   * on what you were looking at.
   */
  driveHere: (label: string) => void
  /**
   * VIEW from the pad (arkinox, 2026-10-10): a free view from your own head,
   * so the pad moves the cursor to look around without planning a hop. The
   * commit row keeps RECALL, which ends it; VIEW again ends it too.
   */
  viewHere: () => void
  /** Whether the pad's VIEW is on: a free view begun from the pad, as opposed to one begun from a pin, a star or BUILD. */
  viewing: () => boolean
  /** Look at a fixed coordinate (a deployed shard), optionally jumping the scale. */
  /** Look at a place. With `drive` the cursor comes along: the free view, driven from the pad. */
  focusOn: (position: Position, plane: Plane, label: string, scaleExp?: number, drive?: boolean) => void
  /** Look at a hidden item: focusOn, framed on the item where it is drawn. */
  focusItem: (position: Position, plane: Plane, label: string, scaleExp?: number) => void
  /**
   * Stop looking; the scene returns to your avatar. With `keepScale` the zoom
   * stays where it is instead of going back to the one the look began at:
   * the Builder ends a view that already sits on your avatar this way, so
   * leaving build mode changes nothing on screen (useBuilder `exit`).
   */
  clearFocus: (keepScale?: boolean) => void
  /** Hyperspace transit: non-null from boarding until arrival (DECK-0001 v3). */
  transit: TransitState | null
  /** §3: sign and queue an enter-hyperspace event from the current position. */
  boardHyperspace: () => Promise<void>
  /** §5: sign and queue the hyperjump for a computed ride, arriving at the stop. */
  completeRide: (ride: CompletedRide) => Promise<void>
  /**
   * Confirm this device holds the live head now (confirmHead), for an action
   * that will take long to prepare before it is signed, such as a ride's
   * proof: refused before the work, not after it. Resolves to the words to
   * refuse with, null when confirmed, or STALE_CONFIRMATION when a respawn or
   * an identity switch landed meanwhile (nothing to say then).
   */
  confirmHeadNow: () => Promise<string | null | typeof STALE_CONFIRMATION>
  /** Forget the boarding locally; the next hop cancels it on the wire (§3.3). */
  cancelTransit: () => void
  addTarget: (pubkey: string, name?: string | null) => void
  removeTarget: (pubkey: string) => void
  toggleTarget: (pubkey: string, name?: string | null) => void
  /** A target's chain, fetched or updated: its head becomes the position. */
  setTargetChain: (pubkey: string, events: NostrEvent[], status?: 'error' | 'partial') => void
  /** Fold relay events for THIS identity into the live chain, adopting a newer
   * one from another machine. The self-sync loop and login both feed this. */
  adoptChain: (events: NostrEvent[]) => void
  /** The tracked targets as things the HUD can point at. */
  targetList: () => CyberTarget[]
  /** Sign a template with this identity's active signer. Async because an
   * extension or a bunker is genuinely remote. The only door to it outside this module. */
  /** Sign as the current identity. `patienceMs` is how long to wait for a remote signer before asking again over fresh sockets; a human-in-the-loop signature (an avatar) deserves more than a hop's. */
  signEvent: (template: EventTemplate, patienceMs?: number) => Promise<NostrEvent>

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
  /** Use the single login field's nsec, ncryptsec, or bunker URI. */
  useLogin: (credential: string, password?: string) => Promise<void>
  /** Switch to the browser extension (NIP-07). */
  useExtension: () => Promise<void>
  /** Switch to a remote bunker (NIP-46) from its bunker:// URI. */
  useBunker: (uri: string) => Promise<void>
  /** Wait for and activate a client-initiated Nostr Connect QR session. */
  useNostrConnect: (session: NostrConnectSession, signal?: AbortSignal, onConnected?: () => void) => Promise<void>
  /** Clear a shown login error. */
  clearLoginError: () => void
  /**
   * This device's own key as an encrypted `ncryptsec1…`, or a thrown error.
   *
   * Only a local signer has a key to give: an extension and a bunker hold
   * theirs. The password rule lives in lib/keyExport, not here and not in the
   * markup, so no caller can offer an unprotected export by forgetting a check.
   */
  exportKey: (password: string, again: string) => string
  /**
   * Open a NIP-44 payload sealed to this identity by `senderPubkey`: a chest
   * sealed to a person (lib/chests.ts), a private message (lib/dm.ts).
   * Rejects, in words, when the signer truly offers no NIP-44 decrypt
   * (lib/signers.ts), or when a remote signer failed it and holds another
   * account (SignerAccountMismatch) or would not say (SignerUnconfirmed):
   * those two are about the signer, not the payload (signerCannotJudge).
   */
  decryptSealed: (senderPubkey: string, payload: string) => Promise<string>
  /**
   * NIP-44 encrypt `plaintext` from this identity to `recipientPubkey`: what
   * seals a private message to an agent (lib/dm.ts; arkinox, 2026-10-10).
   * Rejects, in words, only when the signer truly offers no NIP-44 encrypt.
   */
  encryptSealed: (recipientPubkey: string, plaintext: string) => Promise<string>
  /**
   * Encryption to and from this identity's own key, as the current signer
   * offers it: what seals the private half of the NIP-51 mute list
   * (lib/muteList.ts, store/useMutes.ts). A method is absent when the signer
   * lacks it. A failed decrypt through a remote signer is checked as
   * decryptSealed's is (SignerAccountMismatch, SignerUnconfirmed).
   */
  selfCrypto: () => SelfCrypto

  /** HOSAKA cloud compute: the flow in progress and its pending job. */
  cloud: CloudState
  /** Persisted: the mode, the budget below which AUTO does not ask, and the API. */
  cloudPrefs: CloudPrefs
  /** PAY on the quote: submit the cloud move. */
  approveCloud: () => void
  /** CANCEL on the quote: nothing is submitted; the cursor stays lined up. */
  declineCloud: () => void
  /**
   * Stop the cloud flow. Unpaid, the job is abandoned and expires server-side.
   * Paid or computing, the watch stops but the record stays for RESUME: the
   * money is spent and the result can still be claimed while the head holds.
   */
  cancelCloud: () => void
  /** Remember a balance HOSAKA just reported for this identity. */
  noteBalance: (msats: number) => void
  /** Load the remembered balance for this identity, if the slice has none yet. */
  ensureBalance: () => void
  /** Ask HOSAKA for the balance (a signed request) and remember the answer. */
  refreshBalance: () => Promise<void>
  /** Buy compute credit with no movement waiting on it; sats, not millisats. */
  topUp: (sats: number) => Promise<void>
  /**
   * Buy the key to the cube of side 2^height around `at` from HOSAKA, through
   * the same job driver a route uses: a short balance gets the job's own
   * invoice in the invoice modal, CHECK PAYMENT and CANCEL JOB work on it,
   * and the job starts when the invoice settles. Resolves to the key, or to
   * the reason it did not.
   */
  buyRegionKey: (at: Position, plane: Plane, height: number) => Promise<{ ok: true; result: HosakaRegionKeyResult } | { ok: false; error: string }>
  /**
   * Buy a ride's proof from HOSAKA and sign the hyperjump (onosendai-launch
   * #35 P5; arkinox, 2026-10-11): submit with the ride's idempotency key,
   * pay through the invoice modal or the balance, poll, check the proof here
   * at Level 1, then sign it as a local ride is signed. The head is held for
   * the whole wait, as a computing move holds it. Resolves true when the
   * hyperjump was signed; every other ending says why in `cloud.rideError`.
   */
  rideViaHosaka: (ask: CloudRideAsk) => Promise<boolean>
  /**
   * Pick up the persisted job (on load, after an identity switch, or from the
   * panel) when its chain head is still ours; drop it when the head moved or
   * its invoice expired. Also fetches the caps when cloud mode is on.
   */
  resumeCloudJob: () => Promise<void>
  /** Collect the destination cubes of a staged hop whose move has already landed. */
  collectCloudKeys: () => Promise<void>
  /** Forget a kept job without finishing it. */
  discardCloudJob: () => void
  /** Ask HOSAKA about the invoice now rather than at the next poll. */
  checkCloudPayment: () => void
  /** Back from another app: drop a remote signer's sockets before the next request. */
  wakeSigner: () => void
  /** The credited-while-away notice was read. */
  dismissCredited: () => void
  setCloudMode: (mode: CloudMode) => void
  setCloudPrefs: (patch: Partial<CloudPrefs>) => void
  setInvoiceOpen: (open: boolean) => void

  axes: () => ViewAxes
  /** Axes as they appear on screen right now, including free orbit. */
  screenAxes: ViewAxes | null
  setScreenAxes: (a: ViewAxes) => void
  /** Where the chain head puts you: the coordinate of the last recognized action, or the one a game holds (events.ts buildChain). */
  coordHex: () => string
  sector: () => string
  /** The chain, parsed. */
  actions: () => ActionEvent[]
  /** True when the scene is anchored on YOUR live head, where the controls apply. */
  atHead: () => boolean
  /** The cursor can be driven: at your head, or in a free view that brought it along. Never while spectating or exploring history. */
  canDrive: () => boolean
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
/** The focus label of the pad's VIEW: what the focus bar says, and how `viewing` tells it from a pin's or a star's view. */
export const VIEW_FOCUS_LABEL = 'VIEW'

const LIVE_KEY = 'onosendai:live'
const MOVE_MODE_KEY = 'onosendai:moveMode'
const SHOW_SECRETS_KEY = 'onosendai:showSecrets'

const SHOW_TRAIL_KEY = 'onosendai:showTrail'

function loadShowTrail(): boolean {
  try { return localStorage.getItem(SHOW_TRAIL_KEY) !== '0' } catch { return true }
}

function loadShowSecrets(): boolean {
  try { return localStorage.getItem(SHOW_SECRETS_KEY) !== '0' } catch { return true }
}

/** One action per commit, or the whole route in order. */
export type MoveMode = 'single' | 'auto'

function loadMoveMode(): MoveMode {
  try {
    return localStorage.getItem(MOVE_MODE_KEY) === 'auto' ? 'auto' : 'single'
  } catch {
    return 'single'
  }
}

function saveMoveMode(mode: MoveMode): void {
  try { localStorage.setItem(MOVE_MODE_KEY, mode) } catch { /* private mode */ }
}
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
  /**
   * Held: started before the relays could say whether this identity already
   * had a chain, so it stays on this device whatever LIVE says until they
   * answer (lib/chainHold.ts). Stored with the chain so a reload keeps
   * holding. Absent on every chain saved before holding existed, which were
   * all ordinary chains.
   */
  held?: boolean
  /**
   * When the chain's actions last changed (ms), in both stores: of two copies
   * that have parted ways, the later one is the chain (furtherCopy). Absent
   * on everything saved before IndexedDB kept the chain too: read as 0.
   */
  savedAt?: number
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
  mintedOnLoad = true
  return fresh
}

/** Whether this page load generated the local key (no key was stored). */
let mintedOnLoad = false

/**
 * The pubkey of the last key this app generated on this device (a new
 * visitor's key, or USE NEW KEY), never an imported nsec, ncryptsec,
 * extension or bunker. The /demo tour reads it: a key the app made, with no
 * chain yet, is the tour's to SPAWN and to leave LOCAL (store/useDemo.ts).
 * Keys generated before this marker existed have none.
 */
export const MINTED_KEY = 'onosendai:mintedKey'

function markMinted(pubkey: string): void {
  try { localStorage.setItem(MINTED_KEY, pubkey) } catch { /* private mode */ }
}

/** Whether `pubkey` is the key this app last generated on this device; null when no marker exists. */
export function appMinted(pubkey: string): boolean | null {
  try {
    const m = localStorage.getItem(MINTED_KEY)
    return m === null ? null : m === pubkey
  } catch { return null }
}

/**
 * Signatures already checked this session, as `id:sig`. A Schnorr check
 * costs about 2 ms on the main thread, and the same chain is read from
 * storage more than once in a session (at boot by the signer pick and again
 * by the store, and again on every switch back to an identity), so each
 * signature is checked once. Memory only, never written to storage: a flag
 * on disk would be exactly as trustworthy as the disk.
 */
const verifiedSigs = new Set<string>()

/**
 * Whether an event is authentic (spec §8.2, §8.7.3, Q4): its id is the hash
 * of its contents and its sig a valid signature of that id. The hash is
 * recomputed every time, which is cheap, so an event whose contents changed
 * under a remembered id and sig is still caught; only the Schnorr check is
 * skipped for an id and sig already checked.
 */
function authentic(e: NostrEvent): boolean {
  const key = `${e.id}:${e.sig}`
  if (verifiedSigs.has(key)) return getEventHash(e) === e.id
  if (!verifyEvent(e as unknown as VerifiedEvent)) return false
  verifiedSigs.add(key)
  return true
}

/** The memo key of an event's signature check. */
const sigKey = (e: NostrEvent): string => `${e.id}:${e.sig}`

/**
 * The stretch of `events` that still reassembles once every event
 * `isAuthentic` refuses is discarded (spec §8.2, §8.7.3, Q4): one whose id or
 * signature does not verify never existed, a branch through it is cut off,
 * and the chain continues from the event before it. A forked chain is kept
 * whole: it is dead at the spawn coordinate, and both branches stay so the
 * notice can name them (2026-10-08 ruling). Null when nothing reassembles
 * exactly, from this key: a chain that cannot be continued, and pretending
 * otherwise would sign hops onto a history the relay will reject.
 */
function authenticStretch(pubkey: string, events: NostrEvent[], isAuthentic: (e: NostrEvent) => boolean): NostrEvent[] | null {
  const kept = events.filter((e) => e && e.pubkey === pubkey && isAuthentic(e))
  const resolved = buildChain(kept, pubkey)
  const onChain = new Set(resolved.map((a) => a.id))
  const forked = resolved[0]?.fork !== undefined
  const out = forked || kept.length === events.length ? kept : kept.filter((e) => onChain.has(e.id))
  if (resolved.length === 0 || (!forked && resolved.length !== out.length) || resolved[0].pubkey !== pubkey) return null
  return out
}

/**
 * This identity's saved chain. With `later`, its signatures are not checked
 * here: the chain is returned as stored, so it can be drawn at once, with
 * the events whose signatures this session has not checked yet in
 * `unchecked`, for startSignatureCheck to check off the main thread.
 */
function loadChain(pubkey: string, later = false): LoadedChain | null {
  // What is read now is what this tab knows (foldOtherTabs compares the mark).
  knownMarks.set(pubkey, storedMark(pubkey))
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
    if (data.version !== 2) return null
    return chainFrom(pubkey, data, later)
  } catch { /* corrupt or missing */ }
  return null
}

/** A chain read back from storage, with the events this session has not checked yet when it was read with `later`. */
type LoadedChain = PersistedChain & { unchecked: NostrEvent[] }

/**
 * A chain read back from either store (localStorage or lib/chainDb.ts), as
 * the store holds it. Only authentic events, even from our own storage
 * (authenticStretch); with `later`, as stored, and checked off the main
 * thread. Null when nothing of it reassembles.
 */
function chainFrom(pubkey: string, data: Partial<PersistedChain> | StoredChain, later: boolean): LoadedChain | null {
  if (!Array.isArray(data.events) || data.events.length === 0) return null
  const events = authenticStretch(pubkey, data.events, later ? () => true : authentic)
  if (!events) return null
  return {
    version: 2,
    events,
    unchecked: later ? events.filter((e) => !verifiedSigs.has(sigKey(e))) : [],
    published: Array.isArray(data.published) ? data.published : [],
    stats: { ...EMPTY_STATS, ...(data.stats ?? {}) },
    held: data.held === true,
    savedAt: typeof data.savedAt === 'number' && Number.isFinite(data.savedAt) ? data.savedAt : 0,
  }
}

/**
 * Of two stored copies of one identity's chain, the one that is further on:
 * the one holding every event of the other and more (a later save of the
 * same chain); else, when they have parted ways (a respawn, a branch kept
 * from the relays, a stretch one store missed), the one whose actions
 * changed last (`savedAt`), and on a tie the one with the newer spawn.
 * Otherwise `a`, the copy the caller already trusts. localStorage stops
 * taking a chain that outgrew its few megabytes, so its copy can be an old
 * stretch of the one IndexedDB holds (lib/chainDb.ts), stamped with the
 * time it stopped.
 */
function furtherCopy(a: LoadedChain | null, b: LoadedChain | null): LoadedChain | null {
  if (!a || !b) return a ?? b
  if (b.events.length > a.events.length && holdsAll(b, a)) return b
  if (a.events.length >= b.events.length && holdsAll(a, b)) return a
  const aAt = a.savedAt ?? 0
  const bAt = b.savedAt ?? 0
  if (aAt !== bAt) return bAt > aAt ? b : a
  return b.events[0].created_at > a.events[0].created_at ? b : a
}

/** Whether `outer` holds every event of `inner`. */
function holdsAll(outer: { events: NostrEvent[] }, inner: { events: NostrEvent[] }): boolean {
  const ids = new Set(outer.events.map((e) => e.id))
  return inner.events.every((e) => ids.has(e.id))
}

/** This identity's saved chain, from whichever store holds it furthest on (furtherCopy). */
async function loadNewestChain(pubkey: string): Promise<LoadedChain | null> {
  const local = loadChain(pubkey)
  const kept = await readStoredChain(pubkey)
  return furtherCopy(local, kept && kept !== 'unreadable' && kept !== 'timeout' ? chainFrom(pubkey, kept, false) : null)
}

/**
 * The hold goes to disk with the chain. Every save is of the current
 * identity's chain, so by default it is the store's own `held` at the moment
 * of the save; the few saves that change it pass it explicitly. A default
 * rather than a required argument, so that no existing save can quietly
 * write `false` over a held chain by forgetting it.
 */
function heldNow(pubkey: string): boolean {
  try {
    const s = useCyberspace.getState()
    return s.identity.pubkey === pubkey && s.held
  } catch {
    // Called before the store exists (it never is today): nothing is held yet.
    return false
  }
}

function saveChain(events: NostrEvent[], published: Record<string, PublishStatus>, stats: ChainStats, held?: boolean): void {
  const pubkey = events[0]?.pubkey
  if (!pubkey) return
  const savedAt = changedAt(pubkey, events)
  // While the load is still reading IndexedDB, what is in hand may be the
  // old stretch localStorage kept, and saving it would put that over the
  // whole chain: the save waits for the read (hydrateChain), which then
  // saves whatever the chain is by then. When the actions changed is noted
  // now, so a respawn made meanwhile is still the newer chain.
  if (hydration?.pubkey === pubkey) { hydration.dirty = true; return }
  if (rowsWanted()) {
    // One row per new action, off the main thread, and no copy of the chain
    // anywhere else (lib/chainStore.ts): the old stores stay as they are.
    if (inRows(pubkey)) {
      // The marker says a chain is in rows, so it goes up with the first action.
      if (!rowsMarked(pubkey)) setMarker(pubkey, storedMark(pubkey))
      saveRows(pubkey, { events, isPublished: (id) => published[id] === 'ok', nip01Of: (e) => (verifiedSigs.has(sigKey(e)) ? 1 : 0), held: held ?? heldNow(pubkey), stats: { ...stats }, savedAt })
      markForOldTabs(pubkey, events)
      return
    }
    // The rows hold this chain and have not answered yet. Nothing goes over
    // the frozen copy; what no relay holds is kept until they do answer.
    if (rowsMarked(pubkey)) {
      const unsent = events.filter((e) => published[e.id] !== 'ok')
      const inHand = new Set(unsent.map((e) => e.id))
      writeTail(pubkey, readTail(pubkey).filter((e) => !inHand.has(e?.id)).concat(unsent))
      return
    }
  }
  const data: PersistedChain = {
    version: 2,
    events,
    published: events.map((e) => e.id).filter((id) => published[id] === 'ok'),
    stats,
    ...((held ?? heldNow(pubkey)) ? { held: true } : {}),
    savedAt,
  }
  // The whole chain, whatever its size (lib/chainDb.ts), but only once this
  // session has read what IndexedDB keeps for the identity and taken it in:
  // after a read that timed out or failed, what is in hand may be the old
  // stretch, and the record may hold actions nothing else does.
  if (dbRead.has(pubkey)) storeWhole(pubkey, data)
  // A chain at least as long as one localStorage already refused is not
  // offered again this session: the refusal costs a full serialization of
  // the chain on every save, and the answer would be the same. A shorter one
  // (a respawn) is.
  const refused = tooBigForLocal.get(pubkey)
  if (refused === undefined || events.length < refused) {
    try {
      localStorage.setItem(chainKeyFor(pubkey), JSON.stringify(data))
      tooBigForLocal.delete(pubkey)
    } catch {
      // Quota exceeded or private mode. The copy there stays at the last
      // chain that fit, with that chain's time; IndexedDB has this one.
      tooBigForLocal.set(pubkey, events.length)
    }
  }
  // A fresh mark beside it, so another tab can tell the chain changed
  // without reading it (foldOtherTabs), and this tab knows the mark is its own.
  // Written even when the chain did not fit: the other tab then reads IndexedDB.
  try {
    const mark = `${events.length}:${events[events.length - 1].id.slice(0, 16)}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    localStorage.setItem(chainMarkKeyFor(pubkey), mark)
    knownMarks.set(pubkey, mark)
  } catch { /* storage full: the other tab learns from the relays instead */ }
}

/** Per identity, the head the old stores' mark last named here. */
const markedHead = new Map<string, string>()

/**
 * A tab of an older build, still open through a deploy, knows only the old
 * stores. It is told the chain moved the way it understands: its mark. It then
 * waits for a chain that will not land and goes to the relays, as it does for
 * any mark whose chain never comes (OTHER_TAB_MARK_PATIENCE_MS). The `:r` says
 * this came from the rows: a mark without it is that older tab moving
 * (foldStaleBuild). Only when the head changes.
 */
function markForOldTabs(pubkey: string, events: NostrEvent[]): void {
  const head = events[events.length - 1].id
  if (markedHead.get(pubkey) === head) return
  markedHead.set(pubkey, head)
  try {
    const mark = `${events.length}:${head.slice(0, 16)}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}:r`
    localStorage.setItem(chainMarkKeyFor(pubkey), mark)
    knownMarks.set(pubkey, mark)
  } catch { /* storage full: that tab learns from the relays instead */ }
}

/**
 * Per identity, the chain in hand as last saved or loaded: its head, its
 * length, and when its actions last changed. A save that changes neither
 * (a relay acknowledgement) keeps the time, so it never makes an old
 * stretch look newer than the chain it is a stretch of.
 */
const chainAt = new Map<string, { head: string; length: number; at: number }>()

/** When `events` last changed, as saveChain stamps it: now, unless they are the chain already noted. */
function changedAt(pubkey: string, events: NostrEvent[]): number {
  const head = events[events.length - 1].id
  const prev = chainAt.get(pubkey)
  if (prev && prev.head === head && prev.length === events.length) return prev.at
  const at = Math.max(Date.now(), (prev?.at ?? 0) + 1)
  chainAt.set(pubkey, { head, length: events.length, at })
  return at
}

/** Note the chain a load or a switch put in hand, with the time its store gave it. */
function noteInHand(pubkey: string, chain: LoadedChain | null): void {
  if (!chain) { chainAt.delete(pubkey); return }
  chainAt.set(pubkey, { head: chain.events[chain.events.length - 1].id, length: chain.events.length, at: chain.savedAt ?? 0 })
}

/**
 * Identities whose IndexedDB record this session has read and taken in
 * (hydrateChain). Only theirs are written there (saveChain).
 */
const dbRead = new Set<string>()

/** Per identity, the length of a chain localStorage refused this session (saveChain). */
const tooBigForLocal = new Map<string, number>()

/** Keep `data` as `pubkey`'s whole chain in IndexedDB (lib/chainDb.ts). */
function storeWhole(pubkey: string, data: PersistedChain): void {
  writeStoredChain(pubkey, { events: data.events, published: data.published, stats: { ...data.stats }, held: data.held === true, savedAt: data.savedAt })
}

/**
 * The read of the identity's chain from IndexedDB that follows every load
 * (hydrateChain), while it is out. Until it lands, the chain in hand may be
 * the old stretch of it that localStorage kept, so: relay events for this
 * identity wait for it (adoptChain), or the relays' copy of the actions this
 * device already signed would be counted as another device's; chain actions
 * wait for it (signaturesChecked), or a move would be signed from an old
 * head; and saves wait (`dirty`, saveChain).
 */
let hydration: { pubkey: string; done: Promise<void>; dirty: boolean } | null = null
/** Relay events for the hydrating identity, folded once the read lands. */
let awaitingHydration: NostrEvent[] = []
/** Bumped by every hydrateChain: a late answer to an older read is not taken. */
let hydrateTicket = 0

/** The small key every save of a chain writes beside it: what foldOtherTabs compares before reading the chain. */
function chainMarkKeyFor(pubkey: string): string {
  return `${CHAIN_KEY}-mark:${pubkey}`
}

/** The mark of each identity's stored chain as this tab last wrote or read it. */
const knownMarks = new Map<string, string | null>()

/** The stored chain's mark now, or null when there is none (nothing saved, or saved by an older build). */
function storedMark(pubkey: string): string | null {
  try { return localStorage.getItem(chainMarkKeyFor(pubkey)) } catch { return null }
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
  if (pref && pref.kind !== 'local' && (rowsFirst(pref.pubkey) || loadChain(pref.pubkey, true))) {
    // The live signer replaces this stand-in only while the stand-in is still
    // the one in use. A bunker can answer minutes after the first signature
    // asked for it, and by then the identity may have been switched: its late
    // answer must not put the old identity back behind a screen that shows
    // the new one (found in review of snocrash #35, 2026-10-15). A late
    // answer nobody wants is closed rather than left holding sockets.
    const standIn: Signer = deferredReconnect(pref, (s) => {
      if (currentSigner === standIn) currentSigner = s
      else void s.close?.()
    })
    return standIn
  }
  if (pref?.nsec) { try { return signerFromNsec(pref.nsec) } catch { /* corrupt */ } }
  return localSigner(loadOrGenerateKey())
}

/**
 * A local key signs at once. A remote signer gets SIGN_PATIENCE_MS; if it does
 * not answer, its channel is presumed dead (the phone was in a wallet app)
 * and it is rebuilt once and asked again. A payment poll used to await this
 * forever, which left a paid invoice unrecognised until a reload.
 */
/** Remote signatures in flight: while one waits, a wake must not drop the sockets its answer arrives on. */
let pendingSigns = 0

/**
 * The identity whose signer was last found on another account, so that is
 * said once (otherAccount) and not on every refused signature, of which a
 * relay's AUTH alone brings one per socket. Cleared when the signer signs as
 * that identity again, so a later switch away is said again.
 */
let otherAccountNoticed: string | null = null

/**
 * Say, once, that the signer is on another account than `pubkey`, the
 * identity that asked it: each refusal also says so where it happened, but
 * a relay's AUTH or a background read has nowhere to say it. Not for an
 * identity no longer on screen: its late answer is nobody's business now.
 */
function otherAccount(pubkey: string): void {
  if (otherAccountNoticed === pubkey) return
  if (useCyberspace.getState().identity.pubkey !== pubkey) return
  otherAccountNoticed = pubkey
  useToast.getState().show({ label: 'SIGNER ON ANOTHER ACCOUNT', meta: 'Switch your signer back, or log in again.', mark: 'signer', sticky: true })
}

async function signEvent(template: EventTemplate, patienceMs?: number, signer: Signer = currentSigner): Promise<NostrEvent> {
  // The last look before a movement event exists, whatever path asked for
  // it (a hop, a sidestep, BOARD, a ride, a spawn, a respawn): a deploy
  // requiring newer chain rules than this build's gets none from this tab
  // (lib/versionGate.ts). A recent answer is reused, and no answer lets it go.
  if (template.kind === ACTION_KIND) {
    const look = lookBeforeMove()
    if (!(look instanceof Promise ? await look : look)) throw new Error(VERSION_BLOCKED_MESSAGE)
  }
  if (signer.kind === 'local') {
    // The local key computes the id and the signature itself, so its events
    // are authentic by construction, and are remembered as checked.
    const own = await signer.signEvent(template)
    verifiedSigs.add(`${own.id}:${own.sig}`)
    return own
  }
  pendingSigns++
  let signed: NostrEvent
  try {
    try {
      signed = await signWithin(signer, template, patienceMs)
    } catch (err) {
      // A timeout, or a publish that gave up ("All promises were rejected"):
      // either way the signer's sockets are presumed dead. Drop them and ask
      // once more over fresh ones. Not a signer on another account (a
      // stand-in whose reconnect found one): asking again only asks it again.
      if (err instanceof SignerAccountMismatch || !signer.reconnect) throw err
      const fresh = await signer.reconnect()
      if (currentSigner === signer) currentSigner = fresh
      signed = await signWithin(fresh, template, patienceMs)
    }
  } catch (err) {
    if (err instanceof SignerAccountMismatch) otherAccount(signer.pubkey)
    throw err
  } finally {
    pendingSigns--
  }
  return checkedAnswer(signed, signer)
}

/**
 * A remote signer's answer is checked before anything holds it (spec §8.2,
 * §8.7.3, Q4): an event whose id or signature does not verify is not
 * authentic, so it never goes onto a chain, here or on a relay. The local
 * signer computes both itself; an extension or bunker is trusted to.
 *
 * And it must be signed by the identity that asked. A remote signer signs as
 * whichever account it holds now: an extension or a bunker can be switched
 * mid-visit, and a Nostr Connect session restored on reload is never asked
 * which account it holds. Its signature checks out against its own pubkey,
 * so without this a hop, a relay's AUTH, a HOSAKA request or a profile went
 * out as somebody else, under this identity's name on screen (found porting
 * this to snocrash, review of snocrash #37).
 */
function checkedAnswer(signed: NostrEvent, signer: Signer): NostrEvent {
  if (!authentic(signed)) throw new Error('the signer returned an event whose signature does not verify, so it was not used')
  if (signed.pubkey !== signer.pubkey) {
    otherAccount(signer.pubkey)
    throw new SignerAccountMismatch()
  }
  signerHome(signer)
  return signed
}

/**
 * `signer` just answered as its own identity (a signature by it, or a payload
 * sealed to it that opened): it holds this account now. The notice is done
 * with, and a "not this identity" answer kept by heldBy no longer stands,
 * or a payload that truly does not open, failing within its window, would
 * be called the signer's fault and raise the notice again.
 */
function signerHome(signer: Signer): void {
  if (heldAsked?.signer === signer) heldAsked = null
  if (otherAccountNoticed === signer.pubkey) {
    otherAccountNoticed = null
    if (useToast.getState().toast?.mark === 'signer') useToast.getState().dismiss()
  }
}

/** How long a decrypt that failed waits for the signer to say which account it holds. */
const HELD_PATIENCE_MS = 10_000
/**
 * How long a "not this identity" answer stands, so a page of wraps that will
 * not open asks once, not once each. Only that answer is kept: "this
 * identity" is asked afresh each time, since a signer switched away within
 * the window would otherwise have its failures kept as unopenable.
 */
const HELD_ANSWER_MS = 30_000

/** The last answer to "which account do you hold", per signer object. */
let heldAsked: { signer: Signer; at: number; answer: Promise<string | null> } | null = null

/** The account `signer` holds now, or null when it could not say in time. */
function heldBy(signer: Signer): Promise<string | null> {
  if (heldAsked && heldAsked.signer === signer && Date.now() - heldAsked.at < HELD_ANSWER_MS) return heldAsked.answer
  const ask = signer.heldPubkey
  let timer: ReturnType<typeof setTimeout> | undefined
  const answer = ask
    ? Promise.race([
      ask().then((pk) => (typeof pk === 'string' ? pk : null), () => null),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), HELD_PATIENCE_MS) }),
    ]).finally(() => clearTimeout(timer))
    : Promise.resolve(null)
  const asked = { signer, at: Date.now(), answer }
  heldAsked = asked
  void answer.then((pk) => { if (pk === signer.pubkey && heldAsked === asked) heldAsked = null })
  return answer
}

/**
 * Why a decrypt through `signer` failed, as the error to reject with. A
 * remote signer on another account cannot open what is sealed to this
 * identity, and the failure looks exactly like a payload that does not open,
 * which is kept as such (a private message is never decrypted again). So the
 * signer is asked which account it holds: this identity's, and the payload
 * truly does not open; another, and that is said (SignerAccountMismatch);
 * no answer, and it is left undecided (SignerUnconfirmed).
 */
async function decryptRefusal(signer: Signer, err: unknown): Promise<unknown> {
  if (signer.kind === 'local') return err
  if (err instanceof SignerAccountMismatch) { otherAccount(signer.pubkey); return err }
  if (err instanceof Error && err.message === NIP44_UNAVAILABLE) return err
  if (err instanceof Error && err.message === NIP04_UNAVAILABLE) return err
  const held = await heldBy(signer)
  if (held === signer.pubkey) return err
  if (held === null) return new SignerUnconfirmed()
  otherAccount(signer.pubkey)
  return new SignerAccountMismatch()
}

/**
 * The tab is back from another app. A remote signer's sockets are presumed
 * half-open and dropped now, before the first request, so the payment check
 * that follows goes out over live connections.
 */
function wakeSigner(): void {
  if (currentSigner.kind === 'local') return
  // Back from the signer's own app with a signature still pending: the answer
  // is on its way over these sockets. Dropping them now would lose it and ask
  // again, which is the second prompt for the same event. If they really are
  // dead, the pending request's timeout reconnects and asks again itself.
  if (pendingSigns > 0) return
  // The fresh signer is taken only if the one that reconnected is still in
  // use: a switch of identity while it reconnected wins.
  const asked = currentSigner
  void asked.reconnect?.().then((fresh) => { if (currentSigner === asked && fresh !== asked) currentSigner = fresh }).catch(() => { /* the next signature reconnects and says why */ })
}

/** Said while a move asks the relays again for your latest move. */
export const HEAD_RETRYING_MESSAGE = "Can't confirm your latest move; retrying."
/** Said when the relays still could not confirm it, and the move is refused. */
export const HEAD_UNCONFIRMED_MESSAGE = "Can't confirm your latest move. Try again."
/** How many times a move asks before it refuses. */
const HEAD_CONFIRM_TRIES = 2

/**
 * Another tab of this browser moved you: its saves land in the same storage.
 * What it signed is folded in, and whatever of it is not yet published stays
 * queued (adoptChain counts what it folds as already on the relays).
 */
/** Said when another tab's move is still on its way into storage, and this tab's move waits for it. */
export const OTHER_TAB_SAVING_MESSAGE = "Another tab of yours just moved, and that move is not in this tab's saved chain yet. Try again in a few seconds."

/**
 * How long past the write pause another tab's mark may run ahead of the
 * chain before it is taken as seen anyway. A mark whose chain never lands
 * (the tab was closed or crashed inside its pause, its write failed, or its
 * IndexedDB read timed out and it writes marks only) must not refuse every
 * move until a reload (review of #536, R1): once it is this old, the move
 * goes on to the relays' confirmation, as it did before marks were checked.
 */
export const OTHER_TAB_MARK_PATIENCE_MS = 5_000

/** When a mark was written (ms), from its third field, which starts with Date.now() in base 36 (saveChain); null when it does not say. */
function markWrittenAt(mark: string): number | null {
  const third = mark.split(':')[2]
  if (!third || third.length < 8) return null
  const at = Number.parseInt(third.slice(0, 8), 36)
  return Number.isFinite(at) ? at : null
}

/** Whether a mark is still young enough that its chain may yet land: written within the pause and OTHER_TAB_MARK_PATIENCE_MS. */
function markStillLanding(mark: string | null): boolean {
  if (mark === null) return false
  const at = markWrittenAt(mark)
  if (at === null) return false
  const age = Date.now() - at
  return age >= 0 && age < chainWritePause() + OTHER_TAB_MARK_PATIENCE_MS
}

/**
 * Whether `stored` (or the chain in hand) reaches the head a mark names. A
 * mark is `length:head-id-prefix:nonce` (saveChain); one this build cannot
 * read names nothing to wait for.
 */
function reachesMark(mark: string | null, stored: { events: NostrEvent[] } | null, inHand: NostrEvent[]): boolean {
  const m = mark === null ? null : /^\d+:([0-9a-f]{16}):/.exec(mark)
  if (!m) return true
  const head = m[1]
  return inHand.some((e) => e.id.startsWith(head)) || (stored?.events.some((e) => e.id.startsWith(head)) ?? false)
}

/**
 * Read the stored chain for another tab's mark. The mark is written at once
 * and the chain behind it a moment later (lib/chainDb.ts pauses a write to
 * merge the two saves of an action), so a copy that does not yet reach the
 * mark's head is read again once that pause is over; and while it still does
 * not, the mark is not taken as seen, and the caller is told: signing now
 * would sign from the head before that tab's move, a fork (review of #536, F1).
 * Only while the mark is young (markStillLanding): an older one whose chain
 * never came is taken as seen, and the relays decide, as before (R1).
 */
async function readForMark(pubkey: string, before: string | null | undefined): Promise<{ stored: LoadedChain | null; behind: boolean }> {
  for (let attempt = 0; ; attempt++) {
    const mark = storedMark(pubkey)
    // loadChain notes the mark it read as this tab's own, before its await.
    const stored = await loadNewestChain(pubkey)
    if (reachesMark(mark, stored, useCyberspace.getState().events)) return { stored, behind: false }
    // Its chain is not coming: the mark stays seen (loadChain noted it), and the relays are asked.
    if (!markStillLanding(mark)) return { stored, behind: false }
    // Not seen after all: unless this tab saved meanwhile (its own mark then stands).
    if (knownMarks.get(pubkey) === mark) {
      if (before === undefined) knownMarks.delete(pubkey)
      else knownMarks.set(pubkey, before)
    }
    if (attempt > 0) return { stored, behind: true }
    await new Promise((r) => setTimeout(r, chainWritePause() + 300))
    if (useCyberspace.getState().identity.pubkey !== pubkey) return { stored: null, behind: false }
  }
}

/**
 * What a tab of an older build saved to the old stores since this device last
 * looked, folded in: the moves of a tab still open through a deploy, or of a
 * build taken back to the old stores for a while (lib/chainStoreVersion.ts).
 * Told by its mark, which costs nothing to compare.
 */
async function foldStaleBuild(pubkey: string): Promise<void> {
  const mark = storedMark(pubkey)
  if (mark === null || mark.endsWith(':r') || markerValue(pubkey) === mark) return
  setMarker(pubkey, mark)
  const local = loadChain(pubkey, true)
  const kept = await readStoredChain(pubkey)
  const stored = furtherCopy(local, kept && kept !== 'unreadable' && kept !== 'timeout' ? chainFrom(pubkey, kept, true) : null)
  if (stored) takeInStored(pubkey, stored)
}

/** Take in what storage holds beyond the chain in hand. True when it was something another tab can have done. */
function takeInStored(pubkey: string, stored: { events: NostrEvent[]; published: string[] }): boolean {
  const s = useCyberspace.getState()
  if (s.identity.pubkey !== pubkey || s.events.length === 0) return true
  const have = new Set(s.events.map((e) => e.id))
  const extra = stored.events.filter((e) => !have.has(e.id))
  if (extra.length === 0) return true
  // Only what another tab can have done: moved on from this tab's head (the
  // stored chain holds every event this tab holds), or respawned (a newer
  // spawn). Storage that disagrees in any other way is not taken on trust
  // here; what was published is on the relays, and confirmHead asks them.
  const storedIds = new Set(stored.events.map((e) => e.id))
  const movedOn = s.events.every((e) => storedIds.has(e.id))
  const respawned = stored.events[0].id !== s.genesisId && stored.events[0].created_at > s.events[0].created_at
  if (!movedOn && !respawned) return false
  foldNow(extra)
  const now = useCyberspace.getState()
  const queued = extra.filter((e) => !stored.published.includes(e.id) && now.published[e.id] === 'ok')
  if (queued.length === 0) return true
  const published = { ...now.published }
  for (const e of queued) published[e.id] = 'queued'
  useCyberspace.setState({ published })
  saveChain(now.events, published, now.chain)
  return true
}

/** Said when another tab's move committed first, and this tab's move was taken back before anything was sent. */
export const OTHER_TAB_FIRST_MESSAGE = 'Another tab of yours moved first. This move was not sent. Re-aim from where you are now.'

/**
 * The rows and the chain in hand disagree, and the rows are the order things
 * committed in: another tab won. The rows go in hand. What this tab holds
 * beyond them that a relay already has is folded back in as from the relays.
 * What no relay has was signed from a head that is gone, and sending it would
 * fork the chain, so it is set aside, signed, unsent, and said so. Null when
 * nothing of this tab's was taken back.
 */
function reconcileWithRows(pubkey: string, read: ChainRead): string | null {
  noteCommitted(pubkey, read.events.map((e) => e.id), read.published)
  const s = useCyberspace.getState()
  if (s.identity.pubkey !== pubkey) return null
  const fromDb = chainFrom(pubkey, read, true)
  if (!fromDb) return null
  const recorded = new Set(read.events.map((e) => e.id))
  const ours = s.events.filter((e) => !recorded.has(e.id))
  const unsent = ours.filter((e) => s.published[e.id] !== 'ok')
  const have = new Set(s.events.map((e) => e.id))
  if (unsent.length > 0) void setAsideRows(pubkey, { events: s.events, published: s.events.filter((e) => s.published[e.id] === 'ok').map((e) => e.id), stats: { ...s.chain }, held: s.held, savedAt: chainAt.get(pubkey)?.at ?? 0 })
  putInHand(pubkey, fromDb, have)
  chainAt.delete(pubkey)
  foldNow(ours.filter((e) => s.published[e.id] === 'ok'))
  if (unsent.length === 0) return null
  console.warn(`[chain] another tab moved first: ${unsent.length} action(s) of this tab were set aside, unsent`)
  useCyberspace.setState({ proof: { ...IDLE_PROOF, status: 'infeasible', message: OTHER_TAB_FIRST_MESSAGE } })
  return OTHER_TAB_FIRST_MESSAGE
}

/**
 * Before a move, in rows: the record says at once whether another tab
 * committed since this tab last looked. Nothing here waits for a chain to
 * land, because the record only ever names what has landed, whole. A record
 * that cannot be read proves nothing, and the relays are asked, as ever; the
 * commit itself still refuses a head that is gone.
 */
async function foldRowsOfOtherTabs(pubkey: string): Promise<string | null> {
  await foldStaleBuild(pubkey)
  const record = await rowsHead(pubkey)
  if (record === null || record === 'unreadable') return null
  const known = committedHead(pubkey)
  if (record.headId === known.headId && record.length === known.length) return null
  const read = await readRows(pubkey)
  if (read === null || read === 'unreadable' || read === 'timeout') return null
  if (useCyberspace.getState().identity.pubkey !== pubkey) return null
  noteCommitted(pubkey, read.events.map((e) => e.id), read.published)
  markedHead.set(pubkey, read.headId)
  if (takeInStored(pubkey, read)) return null
  return reconcileWithRows(pubkey, read)
}

onChainLost((pubkey) => {
  void readRows(pubkey).then((read) => {
    if (read === null || read === 'unreadable' || read === 'timeout') return
    reconcileWithRows(pubkey, read)
  })
})

onChainRefused((pubkey, quota) => {
  if (useCyberspace.getState().identity.pubkey !== pubkey) return
  useToast.getState().show(quota
    ? { label: 'STORAGE FULL', meta: 'Your moves stay in this tab. Free up space, or stay LIVE.', mark: 'block', sticky: true }
    : { label: 'CHAIN NOT SAVED', meta: 'Your moves stay in this tab. It keeps trying.', mark: 'block', sticky: true })
})

async function foldOtherTabs(pubkey: string): Promise<string | null> {
  if (useCyberspace.getState().events.length === 0) return null
  if (rowsWanted() && inRows(pubkey)) return foldRowsOfOtherTabs(pubkey)
  // Only when another tab has saved since this one last wrote or read the
  // chain: comparing the mark costs nothing, and reading, hashing and
  // rebuilding a long saved chain before every move cost about 190 ms on a
  // 2,000-event chain (review of #236). With no mark (an older build saved
  // it), the chain is read as before.
  const mark = storedMark(pubkey)
  const before = knownMarks.get(pubkey)
  if (mark !== null && before === mark) return null
  // Both stores: the other tab's chain may have outgrown localStorage, and
  // then only IndexedDB has its save (lib/chainDb.ts).
  // loadChain notes the mark it read, before the await; set again after it,
  // it could overwrite the newer mark of a save this tab made meanwhile.
  const { stored, behind } = await readForMark(pubkey, before)
  if (behind) return OTHER_TAB_SAVING_MESSAGE
  if (stored) takeInStored(pubkey, stored)
  return null
}

/**
 * Confirm this device holds the identity's live head before a chain action
 * is signed (arkinox's ruling of 2026-10-08, normative in the spec): a
 * client that signs from a stale head forks the chain, and a fork ends it.
 * Another tab's saves and the relays' answers are folded in first; the
 * caller then compares the head with the one it meant to extend. Null when
 * confirmed: the canonical relay answered, and every relay that holds this
 * chain answered or 2.5 s passed since the requests went out; or, the
 * canonical relay silent, another configured relay answered holding the
 * newest event already on the relays (chains.ts confirmChainEvents, option
 * B and the ruling on the slow-relay grace). The refusal's words when
 * nothing counted after HEAD_CONFIRM_TRIES asks (`retrying` runs before each
 * ask after the first), and the move is then refused rather than signed
 * blind: offline, slow relays, or a chain returned with a hole.
 * STALE_CONFIRMATION when a respawn or an identity switch landed meanwhile.
 * A spawn needs none of this, since nothing can follow a spawn signed a
 * moment ago.
 */
/**
 * What confirmHead returns when a respawn or an identity switch landed while
 * it waited: the action it was confirming belongs to a chain that is gone,
 * and its caller ends without a word. It writes nothing to the panel, which
 * belongs to whatever the new chain is doing now, and it never lifts the one
 * proof at a time guard of a proof that started since (verification of
 * #236, finding 5).
 */
export const STALE_CONFIRMATION: unique symbol = Symbol('stale confirmation')

/** Bumped by a respawn and an identity switch: an older value marks a waiter from a chain that is gone. */
let chainEpoch = 0

async function confirmHead(retrying: () => void): Promise<string | null | typeof STALE_CONFIRMATION> {
  const pubkey = useCyberspace.getState().identity.pubkey
  const epoch = chainEpoch
  const here = await headCheckedHere()
  if (here) return here
  // No confirmation is reused, however recent (arkinox, 2026-10-08): another
  // device can move in the second between two looks, and only a fresh answer
  // makes the relay's silence mean "nothing newer".
  for (let i = 0; i < HEAD_CONFIRM_TRIES; i++) {
    if (chainEpoch !== epoch) return STALE_CONFIRMATION
    if (i > 0) retrying()
    const now = useCyberspace.getState()
    if (now.identity.pubkey !== pubkey) return HEAD_UNCONFIRMED_MESSAGE
    // Only what is new since the newest event the relays already hold, and
    // on the second ask over a fresh socket: a silent or unauthenticated one
    // is replaced, not asked again (review of #236).
    const anchor = newestEventOnRelays(now.events, now.published)
    const got = await confirmChainEvents(pubkey, now.genesisId || undefined, now.events, { since: anchor?.created_at, anchorId: anchor?.id, reconnect: i > 0 }).catch(() => null)
    if (chainEpoch !== epoch) return STALE_CONFIRMATION
    if (useCyberspace.getState().identity.pubkey !== pubkey) return HEAD_UNCONFIRMED_MESSAGE
    if (got) {
      foldNow(got)
      return null
    }
  }
  return HEAD_UNCONFIRMED_MESSAGE
}

/**
 * The part of confirmHead that asks no relay: the whole saved chain read in
 * (the hydration hold), its signatures checked, so nothing is signed onto a
 * chain until every event of it is known to be authentic, and another tab's
 * move taken in (foldOtherTabs). Null when none of them refuses. Every
 * confirmHead runs it first; a WALK step runs only this before its proof
 * (arkinox, 2026-10-31), and the whole confirmHead before it is signed.
 */
async function headCheckedHere(): Promise<string | null | typeof STALE_CONFIRMATION> {
  const pubkey = useCyberspace.getState().identity.pubkey
  const epoch = chainEpoch
  const cut = await signaturesChecked(pubkey)
  if (chainEpoch !== epoch) return STALE_CONFIRMATION
  if (cut) return cut
  const otherTab = await foldOtherTabs(pubkey)
  if (chainEpoch !== epoch) return STALE_CONFIRMATION
  return otherTab
}

/**
 * The created_at of the newest event of `events` the relays already hold
 * (published, or adopted from them), or undefined when none is: the second
 * a confirmation asks from. In the usual case that is the head's. When the
 * head is not published yet (LOCAL, offline, queued) it is earlier, so a move
 * another device published meanwhile, from the last shared event on, is
 * still found.
 */
export function newestOnRelays(events: NostrEvent[], published: Record<string, PublishStatus>): number | undefined {
  return newestEventOnRelays(events, published)?.created_at
}

/**
 * The newest event of `events` the relays already hold, itself: what a
 * confirmation asks from (its created_at) and what an answer must hold to
 * show the relay really holds this chain (its id; chains.ts
 * confirmChainEvents `anchorId`).
 */
export function newestEventOnRelays(events: NostrEvent[], published: Record<string, PublishStatus>): NostrEvent | undefined {
  let newest: NostrEvent | undefined
  for (const e of events) if (published[e.id] === 'ok' && (newest === undefined || e.created_at > newest.created_at)) newest = e
  return newest
}

/** Said while a chain action waits for the saved chain's signatures to be checked. */
export const SIG_CHECK_MESSAGE = 'Checking the signatures of your saved chain.'

/** A performance mark, for measuring boot; nothing where there is no performance API. */
function mark(name: string): void {
  try { performance.mark(name) } catch { /* no performance API */ }
}

/**
 * The background signature check of a saved chain, while it runs: whose
 * chain, and the words to refuse a waiting action with if it cut the chain
 * (null when every signature verified).
 */
let sigCheck: { pubkey: string; done: Promise<string | null> } | null = null

/**
 * Check a saved chain's signatures off the main thread (lib/sigCheck.ts),
 * after it has been drawn unchecked (loadChain with `later`). Every
 * signature that verifies joins the memo; at the first one that does not,
 * the chain is cut there as loadChain would have cut it (cutInauthentic).
 * Chain actions wait for it (signaturesChecked).
 */
function startSignatureCheck(pubkey: string, unchecked: NostrEvent[]): void {
  // A check of this identity's chain already running (the load's, when
  // IndexedDB then brings more of the chain) goes on, and chain actions wait
  // for both.
  const running = sigCheck?.pubkey === pubkey ? sigCheck.done : null
  if (unchecked.length === 0) {
    if (running) return
    sigCheck = null
    mark('onosendai:chain-verified')
    return
  }
  const entry: { pubkey: string; done: Promise<string | null> } = { pubkey, done: Promise.resolve(null) }
  const own = checkSignatures(unchecked).then((bad) => {
    const badKeys = new Set(unchecked.filter((e) => bad.has(e.id)).map(sigKey))
    for (const e of unchecked) if (!badKeys.has(sigKey(e))) verifiedSigs.add(sigKey(e))
    return badKeys.size === 0 ? null : cutInauthentic(pubkey, badKeys)
  })
  entry.done = (running ? Promise.all([running, own]).then(([a, b]) => a ?? b) : own).then((cut) => {
    if (sigCheck === entry) sigCheck = null
    mark('onosendai:chain-verified')
    return cut
  })
  sigCheck = entry
}

/**
 * After a load has drawn the chain localStorage kept, read the one IndexedDB
 * keeps (lib/chainDb.ts) and take it when it is further on (furtherCopy):
 * localStorage stops taking a chain that outgrew its few megabytes, and its
 * copy is then an old stretch of the chain. Taken in silence, because every
 * action in it was saved here; the relays are compared with it afterwards,
 * so what they hold that it lacks is all that is reported as another
 * device's. The read itself writes nothing: a save made while it was out
 * waits, and is made once it lands.
 *
 * A read that runs out of time (lib/chainDb.ts READ_PATIENCE_MS) or fails
 * stops holding anything up: the chain in hand is used as it is, as before
 * IndexedDB kept the chain. But nothing is written to IndexedDB for this
 * identity until a read has been taken in (dbRead), because the record may
 * hold actions nothing else does, such as LOCAL ones never published. The
 * read that ran out keeps going, and is taken in when it lands: in silence
 * when one copy holds the other, and through the diverged-branch prompt when
 * they parted ways meanwhile (takeStoredChain).
 */
function hydrateChain(pubkey: string): void {
  awaitingHydration = []
  dbRead.delete(pubkey)
  const ticket = ++hydrateTicket
  if (!chainDbAvailable()) { hydration = null; return }
  const epoch = chainEpoch
  const entry: { pubkey: string; done: Promise<void>; dirty: boolean } = { pubkey, done: Promise.resolve(), dirty: false }
  // When the chain in hand last changed as the read went out: a late answer
  // that disagrees with moves made after that is not taken over them.
  const startedAt = chainAt.get(pubkey)?.at ?? 0
  const read = rowsWanted() ? hydrateFromRows(pubkey, entry, ticket, epoch, startedAt) : hydrateFromOldStores(pubkey, entry, ticket, epoch, startedAt).then(() => takeRowsBack(pubkey, entry, ticket))
  entry.done = read.catch(() => { /* the chain in hand stands */ }).finally(() => {
    if (hydration !== entry) return
    hydration = null
    mark('onosendai:chain-read')
    const s = useCyberspace.getState()
    if (s.identity.pubkey !== pubkey) { awaitingHydration = []; return }
    // The save that waited. To localStorage either way; to IndexedDB only
    // when the read was taken in (saveChain, dbRead).
    if (entry.dirty && s.events[0]?.pubkey === pubkey) saveChain(s.events, s.published, s.chain, s.held)
    const waiting = awaitingHydration
    awaitingHydration = []
    if (waiting.length > 0) s.adoptChain(waiting)
    if (rowsWanted() && inRows(pubkey)) void foldStaleBuild(pubkey)
  })
  hydration = entry
}

/** The read of the old stores. True when it was taken in. */
async function hydrateFromOldStores(pubkey: string, entry: { pubkey: string }, ticket: number, epoch: number, startedAt: number): Promise<boolean> {
  const kept = await readStoredChain(pubkey, (late) => {
    if (ticket !== hydrateTicket || late === 'unreadable') return
    if (useCyberspace.getState().identity.pubkey !== pubkey) return
    if (!takeStoredChain(pubkey, late, startedAt)) return
    // Taken in: IndexedDB now gets whatever the chain is.
    const s = useCyberspace.getState()
    if (s.events[0]?.pubkey === pubkey) saveChain(s.events, s.published, s.chain, s.held)
  })
  if (hydration !== entry || ticket !== hydrateTicket) return false
  if (kept === 'timeout' || kept === 'unreadable') {
    console.warn(`[chain] IndexedDB ${kept === 'timeout' ? 'did not answer in time' : 'could not be read'}: using the chain localStorage kept, and writing nothing to IndexedDB until it answers`)
    return false
  }
  if (useCyberspace.getState().identity.pubkey !== pubkey) return false
  // A respawn while the read was out is a new chain, never one to replace.
  if (chainEpoch !== epoch) { dbRead.add(pubkey); return true }
  return takeStoredChain(pubkey, kept, null)
}

/** How long moves wait for a chain's first move into rows. Past this they go on, to the old stores, and the rows catch up on the next save. */
const MIGRATE_HOLD_MS = 15_000

/** The frozen copy in hand, when the rows did not bring the chain and nothing is in hand yet. */
function frozenCopyInHand(pubkey: string): void {
  const s = useCyberspace.getState()
  if (s.events.length > 0 || s.identity.pubkey !== pubkey) return
  const local = loadChain(pubkey, true)
  if (local) putInHand(pubkey, local, new Set())
  tailInHand(pubkey)
}

/**
 * Whether these actions read as one chain with no fork: a sibling of the head
 * joining them would show a fork that never happened, and a fork ends a chain.
 * A tail can hold one: a tab closed with a commit on its way that then lost.
 */
function oneLine(pubkey: string, events: NostrEvent[]): boolean {
  const order = buildChain(events, pubkey)
  return order.length === events.length && order[0]?.fork === undefined
}

/** Actions no store has yet, joined to the chain in hand when they carry it on. When they do not, they stay where they are. */
function tailInHand(pubkey: string): void {
  const s = useCyberspace.getState()
  if (s.identity.pubkey !== pubkey) return
  const have = new Set(s.events.map((e) => e.id))
  const tail = readTail(pubkey).filter((e) => e?.id && !have.has(e.id))
  if (tail.length === 0) return
  const events = s.events.concat(tail)
  if (!oneLine(pubkey, events)) return
  const merged = chainFrom(pubkey, { events, published: s.events.filter((e) => s.published[e.id] === 'ok').map((e) => e.id), stats: s.chain, held: s.held, savedAt: chainAt.get(pubkey)?.at ?? 0 }, true)
  if (merged) putInHand(pubkey, merged, have)
}

/**
 * The rows, when this device has them; and when it does not, the old stores
 * as ever, and then the chain moves over: copied, read back, compared and
 * switched (lib/eventDb/chainRows.ts), with the hold on moves still up. The
 * old stores are never written again for an identity once it is in rows.
 */
async function hydrateFromRows(pubkey: string, entry: { pubkey: string; dirty: boolean }, ticket: number, epoch: number, startedAt: number): Promise<void> {
  // Not on this browser, unless it has shown it can. It stays on the old stores.
  if (!await storeWorksHere()) {
    turnRowsOff()
    if (hydration !== entry || ticket !== hydrateTicket || useCyberspace.getState().identity.pubkey !== pubkey) return
    if (rowsMarked(pubkey)) frozenCopyInHand(pubkey)
    await hydrateFromOldStores(pubkey, entry, ticket, epoch, startedAt)
    await takeRowsBack(pubkey, entry, ticket)
    return
  }
  const read = await readRows(pubkey, (late) => {
    if (ticket !== hydrateTicket || late === 'unreadable' || late === null) return
    if (useCyberspace.getState().identity.pubkey !== pubkey) return
    takeRows(pubkey, late, startedAt)
    const s = useCyberspace.getState()
    if (s.events[0]?.pubkey === pubkey) saveChain(s.events, s.published, s.chain, s.held)
  })
  if (hydration !== entry || ticket !== hydrateTicket) return
  if (useCyberspace.getState().identity.pubkey !== pubkey) return
  if (read === 'timeout' || read === 'unreadable') {
    if (rowsMarked(pubkey)) {
      // The chain is in the rows and the rows do not answer. The frozen copy
      // draws something, moves go on to the relays' confirmation, and nothing
      // is written over it (saveChain) until the late answer lands.
      console.warn(`[chain] the event database ${read === 'timeout' ? 'did not answer in time' : 'could not be read'}: using the frozen copy, and writing nothing until it answers`)
      frozenCopyInHand(pubkey)
      return
    }
    await hydrateFromOldStores(pubkey, entry, ticket, epoch, startedAt)
    return
  }
  if (read !== null) {
    if (chainEpoch !== epoch) { noteCommitted(pubkey, read.events.map((e) => e.id), read.published); dbRead.add(pubkey); return }
    if (takeRows(pubkey, read, null)) entry.dirty = true
    return
  }
  // No rows: never moved here, or the database was wiped. The old copies say.
  if (rowsMarked(pubkey)) frozenCopyInHand(pubkey)
  if (!await hydrateFromOldStores(pubkey, entry, ticket, epoch, startedAt)) return
  tailInHand(pubkey)
  // Only on the deploy's yes, asked now, so a bad move can be stopped from the version file.
  if (!await deployAllowsMove()) return
  if (hydration !== entry || ticket !== hydrateTicket) return
  const moving = moveToRows(pubkey, startedAt)
  await Promise.race([moving, new Promise((resolve) => setTimeout(resolve, MIGRATE_HOLD_MS))])
}

/** Copies that hold actions the chain moved to rows does not. They stay where they are too; a branch set aside can be found from the rows. */
async function otherCopies(pubkey: string, source: ChainSource): Promise<ChainSource[]> {
  const ids = new Set(source.events.map((e) => e.id))
  const beyond = (c: { events: NostrEvent[] }): boolean => c.events.some((e) => !ids.has(e?.id))
  const local = loadChain(pubkey, true)
  const kept = await readStoredChain(pubkey)
  const asSource = (c: { events: NostrEvent[]; published?: string[]; stats?: unknown; held?: boolean; savedAt?: number }): ChainSource => ({ events: c.events, published: c.published ?? [], stats: { ...(c.stats as Record<string, unknown> | undefined) }, held: c.held === true, savedAt: c.savedAt ?? 0 })
  const out: ChainSource[] = []
  if (local && beyond(local)) out.push(asSource(local))
  if (kept && kept !== 'unreadable' && kept !== 'timeout' && beyond(kept)) out.push(asSource(kept))
  for (const branch of await setAsideChains(pubkey).catch(() => [])) out.push(asSource(branch))
  return out
}

/** Move the chain in hand to rows. What fails here leaves the identity on the old stores, and the next load tries again. */
async function moveToRows(pubkey: string, startedAt: number): Promise<void> {
  const s = useCyberspace.getState()
  if (s.identity.pubkey !== pubkey) return
  const legacyMark = storedMark(pubkey)
  // Nothing to move: an identity with no chain is in rows from its first action.
  if (s.events.length === 0 || s.events[0].pubkey !== pubkey) { noteCommitted(pubkey, [], []); return }
  const events = s.events
  const published = events.filter((e) => s.published[e.id] === 'ok').map((e) => e.id)
  const source: ChainSource = { events, published, stats: { ...s.chain }, held: s.held, savedAt: chainAt.get(pubkey)?.at ?? 0 }
  const parted = await otherCopies(pubkey, source).catch(() => [])
  const result = await migrateToRows(pubkey, source, parted, ['onosendai:chain', 'onosendai:chains'])
  if (result.status === 'exists') {
    const read = await readRows(pubkey)
    if (read !== null && read !== 'unreadable' && read !== 'timeout' && useCyberspace.getState().identity.pubkey === pubkey) {
      takeRows(pubkey, read, startedAt)
      setMarker(pubkey, legacyMark)
    }
    return
  }
  if (result.status !== 'switched') {
    console.warn(`[chain] the chain could not be moved to the event database (${result.status === 'failed' ? result.reason : `a row read back differently: ${result.id}`}): it stays in the old stores, and the next load tries again`)
    return
  }
  noteCommitted(pubkey, events.map((e) => e.id), published)
  setMarker(pubkey, legacyMark)
  clearTail(pubkey)
  mark('onosendai:chain-moved')
  // Moves made after the hold gave out go in now, as the next save would take them.
  const now = useCyberspace.getState()
  if (now.identity.pubkey === pubkey && now.events !== events && now.events[0]?.pubkey === pubkey) saveChain(now.events, now.published, now.chain, now.held)
}

/**
 * Take in what the rows answered. Actions that had no store when they were
 * made (a full disk, a page closed mid-write) join them when they still
 * reassemble, and are set aside when they do not. True when such actions were
 * added, so they are written now.
 */
function takeRows(pubkey: string, read: ChainRead, blindSince: number | null): boolean {
  noteCommitted(pubkey, read.events.map((e) => e.id), read.published)
  markedHead.set(pubkey, read.headId)
  if (!rowsMarked(pubkey)) setMarker(pubkey, storedMark(pubkey))
  const held = new Set(read.events.map((e) => e.id))
  const tail = readTail(pubkey).filter((e) => e?.id && !held.has(e.id))
  if (tail.length === 0) {
    clearTail(pubkey)
    takeStoredChain(pubkey, read, blindSince)
    return false
  }
  const merged: ChainRead = { ...read, events: read.events.concat(tail) }
  if (oneLine(pubkey, merged.events) && chainFrom(pubkey, merged, true)) {
    takeStoredChain(pubkey, merged, blindSince)
    return true
  }
  void setAsideRows(pubkey, { events: tail, published: [], stats: {}, held: false, savedAt: Date.now() })
  clearTail(pubkey)
  takeStoredChain(pubkey, read, blindSince)
  return false
}

/**
 * The rows are off (lib/chainStoreVersion.ts: a build on version 1, or the
 * deploy's kill switch, or a browser that no longer passes the probe), after
 * they were in use on this device: they may be further on than the old stores,
 * by every move made since. Taken like any other copy, and the old stores are
 * written from it at once.
 */
async function takeRowsBack(pubkey: string, entry: { dirty: boolean }, ticket: number): Promise<void> {
  // Only a device that has used the rows opens them: everywhere else this is the old build, to the letter.
  if (rowsWanted() || !eventDbAvailable() || !rowsMarked(pubkey)) return
  const read: RowsRead = await readRows(pubkey)
  if (ticket !== hydrateTicket || read === null || read === 'unreadable' || read === 'timeout') return
  if (useCyberspace.getState().identity.pubkey !== pubkey) return
  takeStoredChain(pubkey, read, null)
  entry.dirty = true
}

/**
 * Take in what IndexedDB answered for `pubkey`: the chain in hand becomes
 * the record's when the record is further on, in silence. True when it was
 * taken in, and IndexedDB may be written for this identity from now on.
 *
 * `blindSince`, for an answer that came after its read ran out: when the
 * chain in hand last changed as that read went out. If the chain in hand
 * changed since and the two parted ways, neither is picked by save time,
 * because the later save is only the one made without seeing the other
 * (review of #528, P3): that would settle the parting in silence, on this
 * load or the next, and lose this device's unpublished actions on the
 * losing side (takeParted).
 */
function takeStoredChain(pubkey: string, kept: StoredChain | null, blindSince: number | null): boolean {
  const s = useCyberspace.getState()
  if (kept === null) { dbRead.add(pubkey); return true }
  // The usual case, a chain that fits localStorage: nothing kept that is
  // not in hand, and the chain is not rebuilt a second time.
  const have = new Set(s.events.map((e) => e.id))
  if (kept.events.every((e) => have.has(e?.id))) { dbRead.add(pubkey); return true }
  const fromDb = chainFrom(pubkey, kept, true)
  if (!fromDb) { dbRead.add(pubkey); return true }
  const inHand: LoadedChain | null = s.events.length === 0
    ? null
    : { version: 2, events: s.events, published: s.events.filter((e) => s.published[e.id] === 'ok').map((e) => e.id), stats: s.chain, held: s.held, savedAt: chainAt.get(pubkey)?.at ?? 0, unchecked: [] }
  const movedSince = blindSince !== null && (chainAt.get(pubkey)?.at ?? 0) > blindSince
  if (inHand && movedSince && !holdsAll(inHand, fromDb) && !holdsAll(fromDb, inHand)) return takeParted(pubkey, kept, fromDb, have)
  if (furtherCopy(inHand, fromDb) !== fromDb) { dbRead.add(pubkey); return true }
  putInHand(pubkey, fromDb, have)
  return true
}

/**
 * A late answer that parted ways with what the chain in hand took on while
 * the read was out. When everything the chain in hand has and the record
 * lacks is on the relays (another device's move the relays brought, or a
 * move of this tab already published), the record is this device's side:
 * it goes back in hand, and what the relays hold is folded in as from the
 * relays. adoptChain then raises the diverged-branch prompt when the
 * record's side is unpublished (lib/branchConflict.ts), or shows the chain
 * forked when both sides are already on the relays, and nothing is decided
 * without the person. When both sides hold unpublished actions of this
 * device (moves made LOCAL during the wait), the prompt has no words for
 * that: the chain in hand stays, and the record is kept in IndexedDB beside
 * it, set aside under its own key, so neither side is ever written over.
 */
function takeParted(pubkey: string, kept: StoredChain, fromDb: LoadedChain, have: Set<string>): boolean {
  const s = useCyberspace.getState()
  const recorded = new Set(fromDb.events.map((e) => e.id))
  const ours = s.events.filter((e) => !recorded.has(e.id))
  if (ours.every((e) => s.published[e.id] === 'ok')) {
    putInHand(pubkey, fromDb, have)
    // Taken back on purpose, now: stamped as changed now, so the old stretch
    // localStorage took meanwhile is never the later copy on the next load.
    chainAt.delete(pubkey)
    useCyberspace.getState().adoptChain(ours)
    return true
  }
  if (rowsWanted() && inRows(pubkey)) void setAsideRows(pubkey, { events: kept.events, published: kept.published, stats: kept.stats, held: kept.held, savedAt: kept.savedAt ?? 0 })
  else setAsideStoredChain(pubkey, kept)
  console.warn('[chain] IndexedDB answered late with a branch that parted ways with unpublished moves made meanwhile; the chain in hand stays, and that branch is kept aside in IndexedDB')
  dbRead.add(pubkey)
  return true
}

/** The record's chain in hand, in silence: what a load does when IndexedDB holds the chain further on. */
function putInHand(pubkey: string, fromDb: LoadedChain, have: Set<string>): void {
  const s = useCyberspace.getState()
  const d = derive(fromDb)
  // Acknowledged here since the load stays acknowledged.
  const published = { ...d.published }
  for (const id of Object.keys(published)) if (s.published[id] === 'ok') published[id] = 'ok'
  // A hold is only ever lifted on a chain, never put back, so on the same
  // chain the one in hand decides; a hold the self-check already lifted
  // (the relays answered "none" after the record was written) stays lifted.
  // A different chain (a held respawn only the record has) keeps its own.
  const sameChain = s.events.length > 0 && s.genesisId === d.genesisId
  const lifted = s.selfCheck.pubkey === pubkey && s.selfCheck.status === 'none'
  const held = d.held && (sameChain ? s.held : !lifted)
  const following = s.atHead()
  useCyberspace.setState({
    events: d.events,
    genesisId: d.genesisId,
    prevEventId: d.prevEventId,
    published,
    held,
    chain: d.chain,
    position: d.position,
    plane: d.plane,
    headPlane: d.headPlane,
    positionHistory: d.positionHistory,
    ...(d.genesisId !== s.genesisId ? { spentMsats: loadSpent(d.genesisId) } : {}),
    ...(following ? { anchor: d.position, anchorPlane: d.headPlane, ...(s.walking ? {} : { cursor: d.position }), exploreIndex: null } : {}),
  })
  noteInHand(pubkey, fromDb)
  dbRead.add(pubkey)
  // What localStorage did not have is checked like the rest, off the main thread.
  startSignatureCheck(pubkey, fromDb.unchecked.filter((e) => !have.has(e.id)))
}

/** Resolves once the read of `pubkey`'s chain from IndexedDB has landed (hydrateChain). */
async function chainHydrated(pubkey: string): Promise<void> {
  const h = hydration
  if (h && h.pubkey === pubkey) await h.done
}

/**
 * Whether a load reads this identity's chain from its rows alone: it has moved
 * there, so the old copy is an old stretch not worth parsing and drawing.
 */
function rowsFirst(pubkey: string): boolean {
  return rowsWanted() && rowsMarked(pubkey)
}

/**
 * What the first draw waits for: nothing when the chain is already in hand,
 * and otherwise the read of its rows, so nothing is drawn as the chain until
 * the chain is here (onosendai/event-db-design.md, 3.7). main.tsx bounds it.
 */
export function chainReadyToDraw(): Promise<void> {
  const s = useCyberspace.getState()
  return s.events.length > 0 || !rowsFirst(s.identity.pubkey) ? Promise.resolve() : chainHydrated(s.identity.pubkey)
}

/** Resolves once the current identity's whole saved chain is in hand: the IndexedDB read after a load or a switch has landed. */
export function savedChainLoaded(): Promise<void> {
  return chainHydrated(useCyberspace.getState().identity.pubkey)
}

/**
 * Wait for the background check of `pubkey`'s saved chain, saying so while
 * it runs. Resolves to the words a chain action is refused with when the
 * check cut the chain under it, and null otherwise.
 */
async function signaturesChecked(pubkey: string): Promise<string | null> {
  const say = (): void => useCyberspace.setState({ proof: { ...useCyberspace.getState().proof, message: SIG_CHECK_MESSAGE } })
  const first = sigCheck?.pubkey === pubkey ? sigCheck : null
  if (first) say()
  // The whole saved chain first: IndexedDB may hold more of it than was
  // drawn, and what it adds joins the check (hydrateChain).
  const h = hydration
  if (h && h.pubkey === pubkey) await h.done
  const check = (sigCheck?.pubkey === pubkey ? sigCheck : null) ?? first
  if (!check) return null
  if (!first) say()
  const cut = await check.done
  if (useCyberspace.getState().proof.message === SIG_CHECK_MESSAGE) useCyberspace.setState({ proof: { ...useCyberspace.getState().proof, message: null } })
  return cut
}

/**
 * The ids of the actions a cut set aside (cutInauthentic). When the relays
 * still hold them, correctly signed, the next confirmation restores them,
 * and the move that finds that says so, not that another device moved you.
 */
const setAside = new Set<string>()

/** The words for a head that moved under a move: a restore after a cut, or another device's move. */
function headMovedWords(events: NostrEvent[], again: string): string {
  const restored = events.some((e) => setAside.has(e.id))
  setAside.clear()
  return restored
    ? `The relays still hold the actions set aside here, correctly signed, so your chain was restored from them. ${again}`
    : `Another device moved you. ${again}`
}

/**
 * Cut the chain in hand at the events whose signatures failed (`badKeys`),
 * as loadChain cuts a stored chain (authenticStretch): they never existed,
 * and the chain continues from the event before the first of them. Redraws,
 * saves, and says so in the proof notice. Returns those words, or null when
 * nothing in hand was affected (another identity by now, or already gone).
 */
function cutInauthentic(pubkey: string, badKeys: Set<string>): string | null {
  const s = useCyberspace.getState()
  if (s.identity.pubkey !== pubkey) return null
  const n = s.events.filter((e) => badKeys.has(sigKey(e))).length
  if (n === 0) return null
  const events = authenticStretch(pubkey, s.events, (e) => !badKeys.has(sigKey(e)))
  if (!events) {
    // The spawn itself failed: nothing of the chain stands, and the identity
    // is back at its spawn coordinate, unsigned, as with nothing saved.
    const words = 'The spawn of your saved chain failed its signature check, so the chain was set aside. You stand at your spawn coordinate.'
    const base = provisionalChain(pubkey)
    useCyberspace.setState({ ...base, cursor: base.position, pendingTarget: null, proof: { ...IDLE_PROOF, status: 'infeasible', message: words } })
    return words
  }
  // Every action set aside counts: the ones that failed, and the ones after
  // them that the cut takes off with them (review of #242).
  const removed = s.events.length - events.length
  for (const e of s.events) if (!events.includes(e)) setAside.add(e.id)
  const words = removed === 1
    ? 'One saved action failed the signature check and was set aside. Your chain continues from the action before it.'
    : `${removed} saved actions were set aside, from the first one that failed the signature check on. Your chain continues from the action before them.`
  const d = derive({ version: 2, events, published: events.filter((e) => s.published[e.id] === 'ok').map((e) => e.id), stats: s.chain, held: s.held })
  useCyberspace.setState({ ...d, cursor: d.position, pendingTarget: null, proof: { ...IDLE_PROOF, status: 'infeasible', message: words } })
  saveChain(d.events, d.published, d.chain, s.held)
  return words
}

/** Whether a signed cloud move names the job's move: c at its start (x, y, z), C exactly its destination hex. */
function cloudMoveMatches(event: NostrEvent, move: { fromHex: string; toHex: string } | undefined): boolean {
  if (!move) return false
  const c = event.tags.find((t) => t[0] === 'c')?.[1]
  const C = event.tags.find((t) => t[0] === 'C')?.[1]
  if (!c || !C || !/^[0-9a-f]{64}$/.test(c) || C !== move.toHex) return false
  const a = coordToXyz(hexToCoord(c))
  const b = coordToXyz(hexToCoord(move.fromHex))
  return a.x === b.x && a.y === b.y && a.z === b.z
}

/**
 * Level 1 of a hop just signed here (spec 5.11), under its own event id,
 * with everything but its three tags taken from this client: the standing
 * coordinate it moved from, the destination it was proved for, the previous
 * event. Empty when it holds.
 */
function localHopFailures(event: NostrEvent, fromHex: string, to: Position, plane: Plane, prevEventId: string): string[] {
  if (!/^[0-9a-f]{64}$/.test(fromHex)) return ['c']
  const tagOf = (name: string): string | undefined => event.tags.find((t) => t[0] === name)?.[1]
  try {
    return verifyHopLevel1({
      from: coordToXyz(hexToCoord(fromHex)),
      to: { x: to.x, y: to.y, z: to.z, plane },
      previousEventIdHex: prevEventId,
      proof: tagOf('proof'),
      nonce: tagOf('mn'),
      openings: tagOf('mp'),
      eventId: event.id,
      // A hop this client just signed is a new id, so it is on no list (lib/v1HopListGuard).
      grandfathered: new Set(),
    })
  } catch (err) {
    return [`check: ${err instanceof Error ? err.message : String(err)}`]
  }
}

/** The unsent old-format hops already reported as stuck, so each is said once. */
const staleStuck = new Set<string>()

/**
 * The publisher met an unsent hop in the old format that retireStaleFormat
 * will not cut, because an event after it is already on the relays (a cut
 * never takes back a published event). It is never sent, and nothing after
 * it on this chain is sent either, since the publisher sends in order. Said
 * once to the player, and warned in the console. Nothing else is held: only
 * this chain's queue waits; bags, messages and every other publish go out
 * by their own paths.
 */
export function noteStaleFormatStuck(event: NostrEvent): void {
  if (staleStuck.has(event.id)) return
  staleStuck.add(event.id)
  console.warn(`[onosendai] unsent hop ${event.id} is in the old proof format and an action after it is already on the relays: it is never sent, and this chain's unsent actions after it wait behind it`)
  if (useCyberspace.getState().proof.status === 'computing') return
  useCyberspace.setState({ proof: { ...IDLE_PROOF, status: 'infeasible', message: STALE_STUCK_MESSAGE } })
}

const STALE_STUCK_MESSAGE = 'One of your unsent actions is a hop in the old proof format, and an action after it is already on the relays, so it cannot be taken back. It will never be sent, and your unsent actions after it wait behind it. Respawning starts a new chain.'

/**
 * Cut the chain in hand at its first unsent hop in the old proof format
 * (lib/staleFormat.ts; cutover checklist item 1 in lib/chainRulesEpoch.ts):
 * that hop and everything after it, all unsent, are set aside unpublished
 * and the chain continues from the event before. One such hop alone, whose
 * previous is still the head and which this machine proves within its
 * ceiling, goes back on the cursor so one COMMIT makes it again with the new
 * proof; it is never re-proved without the player, because a commit opens
 * the publisher's release gate. Redraws, saves, and says so in the proof
 * notice. Returns those words, or null when nothing was cut.
 */
export function retireStaleFormat(): string | null {
  const before = useCyberspace.getState()
  const cut = staleFormatCut(before.events, (id) => before.published[id] === 'ok')
  if (!cut) return null
  // Whatever was computing or being bought was for the chain as it stood,
  // and the head is about to change under it: stopped as a respawn stops it
  // (review of #539, F1), so no proof lands on the cut chain with a
  // destination it was not made for. A paid cloud job is kept for RESUME
  // (cancelCloud), which drops it if its head is gone.
  if (before.proof.status === 'computing') {
    cancelProof()
    requestId++
  }
  if (before.cloud.status !== 'idle') before.cancelCloud()
  if (before.plan) useCyberspace.setState({ plan: null })
  const s = useCyberspace.getState()
  const events = s.events.slice(0, cut.at)
  for (const e of cut.removed) setAside.add(e.id)
  const d = derive({ version: 2, events, published: events.filter((e) => s.published[e.id] === 'ok').map((e) => e.id), stats: s.chain, held: s.held })
  const again = cut.reprove ? parseAction(cut.reprove) : null
  const ceiling = Math.min(MAX_COMPUTE_HEIGHT, recommendedHopHeight())
  const reprove = again !== null && again.type === 'hop' && again.previousId === d.prevEventId && again.prevCoordHex === positionHex(d.position, d.headPlane)
    && !estimateHopCost(d.position.x, d.position.y, d.position.z, again.position.x, again.position.y, again.position.z, again.plane, ceiling).exceedsLimit
  const words = reprove
    ? 'A hop signed by the previous version of ONOSENDAI was never sent, and its proof is in the old format the chain rules no longer accept. It was taken back and your cursor is on where it went: COMMIT makes the same hop with the new proof.'
    : cut.removed.length === 1
      ? 'An action signed by the previous version of ONOSENDAI was never sent, and its proof is in the old format the chain rules no longer accept, so it was set aside. Your chain continues from the action before it.'
      : `${cut.removed.length} actions signed by the previous version of ONOSENDAI were never sent, from a hop whose proof is in the old format the chain rules no longer accept, so they were set aside. Your chain continues from the action before them.`
  useCyberspace.setState({
    ...d,
    cursor: reprove ? again.position : d.position,
    ...(reprove ? { plane: again.plane } : {}),
    pendingTarget: null,
    proof: { ...IDLE_PROOF, status: 'infeasible', message: words },
  })
  saveChain(d.events, d.published, d.chain, s.held)
  return words
}

const pubkeyHex = currentSigner.pubkey
if (mintedOnLoad) markMinted(pubkeyHex)

/**
 * The pubkey this page load generated, or null when the key was already on
 * the device (or came from a login). The /demo tour reads it to tell a key
 * it generated from one the visitor brought (store/useDemo.ts).
 */
export function keyMintedOnLoad(): string | null {
  return mintedOnLoad ? pubkeyHex : null
}
const SPAWN_XYZ = coordToXyz(hexToCoord(pubkeyHex))
const SPAWN: Position = { x: SPAWN_XYZ.x, y: SPAWN_XYZ.y, z: SPAWN_XYZ.z }

/**
 * A fresh spawn signed through whatever signer is active (may be remote),
 * by way of signEvent, so a remote signer's answer is checked like every
 * other: a spawn whose signature does not verify is refused here, never
 * shown or saved, and never silently dropped by loadChain on the next load.
 */
async function freshSpawnAsync(signer: Signer, retiring?: NostrEvent): Promise<PersistedChain> {
  const now = Math.floor(Date.now() / 1000)
  const createdAt = retiring ? Math.max(now, retiring.created_at + 1) : now
  const spawn = await signEvent(spawnTemplate(signer.pubkey, createdAt), undefined, signer)
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
    held: false,
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
  // Counted on the resolved chain, so a hop a game client signed inside a
  // bracket, which moves nobody (spec §8.11.4 rule 3), is not one of yours.
  for (const a of buildChain(events)) {
    if (a.type === 'hop') hops++
    else if (a.type === 'sidestep') sidesteps++
  }
  return { ...prev, hops, sidesteps }
}

/** Everything the store derives from a chain, so spawn and respawn agree. */
function derive(saved: PersistedChain): {
  events: NostrEvent[]
  genesisId: string
  prevEventId: string
  published: Record<string, PublishStatus>
  held: boolean
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
    held: saved.held === true,
    // Rides are counted from the events, so an adopted chain reads the same
    // as one ridden here; the local measurements stay what was saved.
    chain: { ...saved.stats, ...rideStatsOf(actions) },
    position: head.position,
    positionHistory: actions.map((a) => a.position),
    plane: head.plane,
    headPlane: head.plane,
    exploreIndex: null,
    anchor: head.position,
    anchorPlane: head.plane,
  }
}

/**
 * The page never signs a spawn on load (arkinox, 2026-10-01). A saved chain is
 * picked up as it was; with none, the identity sits unsigned at its spawn
 * coordinate exactly as a switch leaves it, and the self-check (selfSync.ts)
 * asks the relays whether it already has a chain before its first move signs
 * anything. This used to sign a fresh spawn here, and because an identity
 * switched in is not saved until it moves, switch-then-reload signed a new
 * spawn for it: newer than its real chain on the relays, so it replaced that
 * chain and was published on the next move.
 */
// Drawn at once, unchecked: the signatures are checked in the background
// (startSignatureCheck, below the store), and every chain action waits.
const saved = rowsFirst(pubkeyHex) ? null : loadChain(pubkeyHex, true)
const initial = saved ? derive(saved) : provisionalChain(pubkeyHex)
noteInHand(pubkeyHex, saved)
// And the rest of it, if localStorage could only keep an old stretch:
// started now, ahead of any save, so none of them writes the old stretch
// over the whole chain IndexedDB keeps.
hydrateChain(pubkeyHex)
mark('onosendai:chain-loaded')

let requestId = 0

/** The request id of the one hop a WALK step asked for, when it was not a route (a route says so on its plan, MovePlan.walk). */
let walkHopId: number | null = null

/**
 * Relay events for your own chain that arrived while a proof was computing.
 * Folding them then would move the head under the proof, so they wait here
 * and are folded the moment the proof is about to be signed or ends
 * (foldDeferred). Dropping them, as this used to, lost a game's entry that
 * arrived during a long HOSAKA job: it is never delivered again, and the
 * finished hop forked against it.
 */
let deferred: NostrEvent[] = []
/** True while foldDeferred or a signing look folds: adoptChain then folds even mid-proof. */
let folding = false

/** Fold `events` into your chain now, even while a proof is computing. */
function foldNow(events: NostrEvent[]): void {
  if (events.length === 0) return
  folding = true
  try { useCyberspace.getState().adoptChain(events) } finally { folding = false }
}

/** Fold whatever arrived while a proof was computing. */
function foldDeferred(): void {
  const held = deferred
  deferred = []
  foldNow(held)
}

/** The cloud flow in progress: its fetches, and the claim-poll sleep a button can cut short. */
let cloudAbort: AbortController | null = null
// One collector at a time: the startup call and a just-landed hop can both ask.
let collectingKeys = false
let cloudWaker: Waker | null = null
let hosaka: { url: string; client: HosakaClient } | null = null
/** The caps request out right now, and the API URL it was sent to. */
let limitsInFlight: { url: string; promise: Promise<HosakaLimits | null> } | null = null

/** One client per API URL. It signs through `signEvent`, so it follows identity switches. */
export function cloudClient(apiUrl: string): HosakaClient {
  if (!hosaka || hosaka.url !== apiUrl) hosaka = { url: apiUrl, client: createHosaka({ apiUrl, sign: signEvent }) }
  return hosaka.client
}

/** Claim polls are signed. A local key signs silently, so every 4 s (the
 * contract's 3 to 5); an extension or a bunker may prompt for each one, so
 * it is asked less often and the invoice modal offers CHECK PAYMENT. */
function claimIntervalFor(kind: SignerKind): number {
  return kind === 'local' ? 4_000 : 10_000
}

/** Installed by the store below: how a cloud step of a route is run (startCloudStep). */
let cloudStepStarter: ((step: PlanStep, id: number) => Promise<void>) | null = null
/** Installed by the store below: how a HOSAKA ride record is run to a hyperjump (runCloudRide). */
let cloudRideRunner: ((record: PendingCloudJob, id: number) => Promise<boolean>) | null = null
/** How long a finished HOSAKA ride waits for the line to hold a sampled block before it is kept for RESUME. */
const LINE_WAIT_MS = 3 * 60_000
const LINE_POLL_MS = 1_000

/**
 * A job's action as a proof mode. A region-key purchase is a job too, but it
 * never becomes a proof: the driver hands its key to the deploy instead, so
 * only the two move actions reach here.
 */
function moveAction(action: HosakaAction): ProofMode {
  return action === 'sidestep' ? 'sidestep' : 'hop'
}

/**
 * What a hop unlocked, listed. A hop leaves the key to the region it crossed,
 * whether this machine or HOSAKA computed it, and the key is only worth
 * something if it opens what is there: ask the relay at once, so the finds
 * get their ceremony and the Nearby Loot list. Imported lazily: the shards
 * store imports this one.
 */
function scanHeldKey(lookupId: string, keyHex: string): void {
  void import('./useShards').then((m) => m.useShards.getState().rescan(lookupId, keyHex)).catch(() => { /* the relay was asked; a miss is a miss */ })
}

/**
 * How long a provisional identity's first move waits for the self-check to
 * answer before deciding without it. Short, because someone pressed COMMIT;
 * a check that has not answered by then holds the new chain rather than
 * publishing a spawn that may rival a real one (lib/chainHold.ts firstMove).
 */
const FIRST_MOVE_WAIT_MS = 4000

/** A first move is waiting on the check or the signer: a second press must not sign a second spawn. */
let firstMoveInFlight = false


export const useCyberspace = create<CyberspaceState>((set, get, api) => {
  /**
   * The self-check's status for `pubkey` once it is no longer `checking`, or
   * `checking` when `ms` ran out first. Resolves at once when it has already
   * answered.
   */
  const waitForCheck = (pubkey: string, ms: number): Promise<SelfCheck['status']> => new Promise((resolve) => {
    const answered = (): SelfCheck['status'] | null => {
      const c = get().selfCheck
      return c.pubkey === pubkey && c.status !== 'checking' ? c.status : null
    }
    const now = answered()
    if (now) { resolve(now); return }
    const timer = setTimeout(() => { unsub(); resolve('checking') }, ms)
    const unsub = api.subscribe(() => {
      const st = answered()
      if (st) { clearTimeout(timer); unsub(); resolve(st) }
    })
  })

  /**
   * Sign the spawn of an identity with no chain yet, after the self-check
   * has had its short say (lib/chainHold.ts firstMove). True when the spawn
   * was signed and the chain now holds it; false when nothing was signed
   * (the relays placed you, the signer refused, `lost` said the reason to
   * sign has gone, or another first move is already in flight). Only a
   * deliberate act reaches this: a first move (commit) or the /demo tour's
   * SPAWN (signSpawn), never a login, a switch or a page load.
   */
  const signFirstSpawn = async (lost: () => boolean): Promise<boolean> => {
    if (firstMoveInFlight) return false
    firstMoveInFlight = true
    try {
      const pubkey = get().identity.pubkey
      const adoptedMessage = 'This identity already has a chain on the relays, and you are at its head now. Re-aim from here.'
      // A chain IndexedDB still holds for it is no chain to spawn over.
      await chainHydrated(pubkey)
      if (get().identity.pubkey !== pubkey) return false
      if (get().selfCheck.status === 'checking') {
        set({ proof: { ...IDLE_PROOF, message: 'Asking the relays whether this identity already has a chain.' } })
      }
      const status = await waitForCheck(pubkey, FIRST_MOVE_WAIT_MS)
      if (get().identity.pubkey !== pubkey) return false
      if (firstMove(status, get().events.length > 0) === 'adopted') {
        set({ pendingTarget: null, proof: { ...IDLE_PROOF, status: 'infeasible', message: adoptedMessage } })
        return false
      }
      if (lost()) return false
      set({ proof: IDLE_PROOF })
      let spawn: NostrEvent
      try {
        spawn = await signEvent(spawnTemplate(pubkey, Math.floor(Date.now() / 1000)))
      } catch (err) {
        set({ proof: { ...IDLE_PROOF, status: 'infeasible', message: `Signing failed: ${err instanceof Error ? err.message : String(err)}` } })
        return false
      }
      if (get().identity.pubkey !== pubkey) return false
      // The relay chain may have landed while the signer was thinking; if so
      // it already placed us and this spawn is never used.
      if (get().events.length > 0) {
        set({ pendingTarget: null, proof: { ...IDLE_PROOF, status: 'infeasible', message: adoptedMessage } })
        return false
      }
      // Left your head while the signer was thinking: the spawn is dropped
      // unused, never saved or sent, and nothing moves.
      if (lost()) return false
      // Decided on the check as it stands now, which the signer's wait may
      // have settled.
      const now = get().selfCheck
      const held = firstMove(now.pubkey === pubkey ? now.status : 'checking', false) === 'spawn-held'
      const d = derive({ version: 2, events: [spawn], published: [], stats: EMPTY_STATS, held })
      set({ ...d })
      saveChain(d.events, d.published, d.chain, held)
      return true
    } finally {
      firstMoveInFlight = false
    }
  }

  /**
   * Replace the active identity. A known pubkey keeps its stored chain; a new
   * one spawns where its own bits land (spec §3.1). Either way the scene lets
   * go of whatever it was spectating and returns to the new head.
   */
  /** Abort whatever cloud flow is running. The record's fate is the caller's call. */
  const stopCloud = (): void => {
    cloudAbort?.abort()
    cloudAbort = null
    cloudWaker = null
  }

  /**
   * A finished proof that will not be signed now. A route stops: it fails
   * outright when nothing can be signed (a game holds the avatar), and is
   * paused with the proof kept when a choice may yet make it signable
   * (`keep`). A single move just says why.
   */
  const refuseSigning = (msg: ProofResponse, message: string, keep: boolean): void => {
    const { plan } = get()
    set({
      pendingTarget: null,
      plan: plan ? { ...plan, status: keep ? 'paused' : 'failed', message, awaiting: keep ? msg : null } : null,
      proof: { ...IDLE_PROOF, status: 'infeasible', message },
    })
  }

  /**
   * The head moved under a finished proof (HEAD_MOVED_MESSAGE). A route
   * computes its step again from where the chain now stands, at once when
   * this machine computes it, and on RESUME when HOSAKA would, because that
   * costs sats again. A single move keeps its aim for the next commit.
   */
  /**
   * The live feed brought another device's move while a proof computed: the
   * proof is bound to a head that is no longer the head, so it stops now,
   * what arrived is folded, and the reason is said: a game that holds the
   * avatar, a choice between two chains, or the head that moved.
   */
  const stopForNewHead = (beforeHead: string): void => {
    // The worker is stopped; a finish already on its way is refused by
    // finishProof itself, whose head no longer matches.
    cancelProof()
    set({ proof: { ...IDLE_PROOF } })
    foldDeferred()
    const reason = whyNoMove(get().actions()) ?? (get().chainConflict ? CHOOSE_FIRST_MESSAGE : null)
    if (reason) {
      const { plan } = get()
      set({ pendingTarget: null, plan: plan ? { ...plan, status: 'failed', message: reason, awaiting: null } : null, proof: { ...IDLE_PROOF, status: 'infeasible', message: reason } })
      return
    }
    if (get().prevEventId !== beforeHead) headMovedUnder(isWalkProof(requestId))
  }

  /**
   * Whether the proof with this request id is a WALK step's: its one hop, or
   * a step of its route. A HOSAKA result never is (a walk never pays), so a
   * cloud job resumed while walking is refused as HOP's.
   */
  const isWalkProof = (id: number, source?: 'local' | 'cloud'): boolean =>
    source !== 'cloud' && (id === walkHopId || get().plan?.walk === true)

  /**
   * A WALK step (`walk`) is not computed again: the walk stops, route and
   * all, as it does the moment any step does not land (store/useWalk.ts),
   * with the words the look before its proof gave when it still asked the
   * relays there (arkinox, 2026-10-31). Nothing starts again without a
   * press, and the next press walks on from the new head.
   */
  const headMovedUnder = (walk: boolean): void => {
    const { plan, position } = get()
    if (walk) {
      const message = headMovedWords(get().events, 'Re-aim from where you are now.')
      set({
        pendingTarget: null,
        plan: plan ? { ...plan, status: 'failed', message, awaiting: null } : null,
        proof: { ...IDLE_PROOF, status: 'infeasible', message },
      })
      return
    }
    if (!plan) {
      set({ pendingTarget: null, proof: { ...IDLE_PROOF, status: 'infeasible', message: `${HEAD_MOVED_MESSAGE} Your aim is kept: commit again to compute the move from where you stand now.` } })
      return
    }
    const next = nextStep(position, plan.target, plan.ceilings)
    if (!next) {
      set({ plan: null, pendingTarget: null, proof: { ...IDLE_PROOF, status: 'infeasible', message: `${HEAD_MOVED_MESSAGE} Where you stand now is already the end of the route.` } })
      return
    }
    if (next.source === 'cloud') {
      set({
        plan: { ...plan, status: 'paused', step: next, awaiting: null, message: `${HEAD_MOVED_MESSAGE} The next step is one HOSAKA computes, so RESUME pays for it again from where you stand now.` },
        pendingTarget: null,
        proof: IDLE_PROOF,
      })
      return
    }
    set({ plan: { ...plan, status: 'running', step: next, awaiting: null, message: `${HEAD_MOVED_MESSAGE} This step is being computed again from where you stand now.` } })
    startPlanStep()
  }

  /** The cloud flow ended without a proof. The move does not happen; the message stays until X or the next commit. */
  const cloudFail = (message: string, keepJob: boolean): void => {
    const cloud = get().cloud
    const plan = get().plan
    set({
      pendingTarget: null,
      plan: plan ? { ...plan, status: 'failed', message, awaiting: null } : null,
      proof: { ...IDLE_PROOF, status: 'infeasible', message },
      cloud: {
        ...cloud,
        status: 'error',
        message,
        quote: null,
        invoice: null,
        invoiceOpen: false,
        progress: null,
        job: keepJob ? cloud.job : null,
      },
    })
  }

  /**
   * GET /limits, once per API URL. null when HOSAKA cannot be reached, which
   * routes every move locally. Limits that said cloud hops were paused are
   * asked for again each time, so a reopened HOSAKA is seen at the next
   * commit or RESUME, not at the next reload.
   */
  const ensureCloudLimits = (): Promise<HosakaLimits | null> => {
    const cached = get().cloud.limits
    if (cached && !cached.hop_paused) return Promise.resolve(cached)
    const url = get().cloudPrefs.apiUrl
    // A request out for another URL is not this one: its answer would be
    // dropped as stale below, and the caller would plan without caps (#69).
    if (limitsInFlight && limitsInFlight.url === url) return limitsInFlight.promise
    const promise: Promise<HosakaLimits | null> = cloudClient(url)
      .limits()
      .then((limits) => {
        // The URL may have changed while this was out; a stale answer is dropped.
        if (get().cloudPrefs.apiUrl === url) set({ cloud: { ...get().cloud, limits } })
        // The provider's own presentation rides along, and is never required.
        void cloudClient(url).provider?.()
          .then((provider) => { if (get().cloudPrefs.apiUrl === url) set({ cloud: { ...get().cloud, provider } }) })
          .catch(() => { if (get().cloudPrefs.apiUrl === url) set({ cloud: { ...get().cloud, provider: null } }) })
        return limits
      })
      .catch(() => null)
      .finally(() => { if (limitsInFlight?.promise === promise) limitsInFlight = null })
    limitsInFlight = { url, promise }
    return promise
  }

  /** What each primitive can reach right now, here and (when on and known) in the cloud. */
  const cloudCeilings = (): Ceilings => {
    const { cloudPrefs, cloud } = get()
    const on = cloudPrefs.mode !== 'off' && cloud.limits !== null
    return {
      hop: Math.min(MAX_COMPUTE_HEIGHT, recommendedHopHeight()),
      sidestep: recommendedSidestepHeight(),
      cloudHop: on ? cloudHopsSold(cloud.limits) : 0,
      cloudSidestep: on && cloud.limits ? cloud.limits.max_sidestep_height : 0,
      offloadFrom: offloadFrom(cloudPrefs.profile, {
        hopCeiling: Math.min(MAX_COMPUTE_HEIGHT, recommendedHopHeight()),
        sidestepCeiling: recommendedSidestepHeight(),
        cloudHop: on ? cloudHopsSold(cloud.limits) : 0,
        provider: cloud.provider ?? null,
        signerKind: get().signerKind,
        cantorMsByHeight: useCalibration.getState().cantorMsByHeight,
        sha256PerSec: useCalibration.getState().sha256PerSec,
        experience: experienceRatio(),
      }),
    }
  }

  /** The route's cloud steps, in order, from where it stands now. */
  const cloudStepsOf = (from: Position, plan: MovePlan): PlanStep[] => {
    const out: PlanStep[] = []
    let cur = from
    for (let n = 0; n < 100_000; n++) {
      const step = nextStep(cur, plan.target, plan.ceilings)
      if (!step) break
      if (step.source === 'cloud') out.push(step)
      cur = step.to
    }
    return out
  }

  /**
   * Quote every cloud step of the route (public, never a signer prompt), add
   * them up, and either ask for PAY or fund straight away within the budget.
   */
  const quoteRoute = async (id: number): Promise<void> => {
    const { position, plane, cloudPrefs, plan } = get()
    if (!plan) return
    set({
      cloud: { ...get().cloud, status: 'quoting', quote: null, invoice: null, invoiceOpen: false, job: null, progress: null, message: 'Asking HOSAKA for a quote.', startedAt: Date.now() },
    })
    const client = cloudClient(cloudPrefs.apiUrl)
    if (Number.isFinite(bigintBitLimit())) {
      let cur = position
      for (let n = 0; n < 100_000; n++) {
        const step = nextStep(cur, plan.target, plan.ceilings)
        if (!step) break
        const issue = movementCapabilityIssue(step.kind, step.from, step.to, plane, step.source === 'cloud' ? 'cloud' : 'local')
        if (issue) { routeFail(issue); return }
        cur = step.to
        if (n === 99_999) { routeFail('Too long a route to check for this browser: choose a closer destination.'); return }
      }
    }
    const steps = cloudStepsOf(position, plan)
    // Cloud hops, before any quote: only from a HOSAKA that makes hop proof
    // version 2, only as tall as this client can check before signing, and
    // never while HOSAKA has them paused (the route waits for RESUME).
    if (steps.some((st) => st.kind === 'hop')) {
      const limits = get().cloud.limits?.hop_paused ? (await ensureCloudLimits()) ?? get().cloud.limits : get().cloud.limits
      if (id !== requestId) return
      if (cloudHopsSold(limits) === 0) { routeFail(NO_V2_CLOUD_HOPS_MESSAGE); return }
      for (const st of steps) {
        const tooTall = st.kind === 'hop' ? cloudVerifyIssue({ from: st.from, to: st.to, plane }) : null
        if (tooTall) { routeFail(tooTall); return }
      }
      const paused = cloudHopPause(limits)
      if (paused) { routePause(hopPausedWords(paused), true, false); return }
    }
    let total = 0
    let tallest = 0
    let estTime: string | null = null
    // The steps run one after another, so their waits add, like their prices.
    let seconds = 0
    let secondsKnown = true
    // What HOSAKA already holds, across every step of the route.
    let reusedAxes = 0
    let savedMsats = 0
    let savedSeconds = 0
    try {
      for (const step of steps) {
        // Under LOOT a hop is quoted with the destination's cubes, since that
        // is what LOOT pays for; the other profiles quote the bare hop.
        const q = await client.quote(step.kind, hosakaCoord(step.from, plane), hosakaCoord(step.to, plane), undefined, hopWants(step.kind))
        if (id !== requestId) return
        if (q.paused) { routePause(hopPausedWords(q.hint), true, false); return }
        if (!q.within_cap || q.cost_msats === null) {
          routeFail(q.hint ?? `HOSAKA does not sell an h${q.max_height} ${step.kind}.`)
          return
        }
        total += q.cost_msats
        if (typeof q.est_seconds === 'number') seconds += q.est_seconds
        else secondsKnown = false
        if (q.max_height > tallest) { tallest = q.max_height; estTime = q.est_time }
        reusedAxes += q.reused_axes?.length ?? 0
        savedMsats += q.reuse_saves_msats ?? 0
        savedSeconds += q.reuse_saves_seconds ?? 0
      }
    } catch (err) {
      if (id !== requestId) return
      routeFail(describeCloudError(err))
      return
    }
    const first = steps[0]
    const quote: CloudQuote = {
      action: first ? first.kind : 'hop',
      to: plan.target,
      costMsats: total,
      tier: null,
      estTime: secondsKnown && steps.length > 0 ? formatWait(seconds) : estTime,
      estSeconds: secondsKnown && steps.length > 0 ? seconds : null,
      maxHeight: tallest,
      K: 0,
      route: { steps: plan.summary.steps, cloudSteps: steps.length },
      ...(reusedAxes > 0 ? { reuse: { axes: reusedAxes, savedMsats, savedSeconds } } : {}),
    }
    if (needsApproval(total, cloudPrefs)) {
      set({ cloud: { ...get().cloud, status: 'confirm', quote, message: null } })
      return
    }
    set({ cloud: { ...get().cloud, quote } })
    await fundRoute(total, id)
  }

  /**
   * HOSAKA has cloud hops paused (hosaka-api hop_pause, 503 hop_paused):
   * nothing was charged, and the same move can be bought once it reopens. The
   * route pauses with HOSAKA's reason; RESUME asks again, for a quote when
   * none was approved yet (`requote`), else for the same step, whose
   * idempotency key names the job any earlier submit made. `keepJob` keeps a
   * paid job's record, which RESUME in the cloud panel also finishes.
   */
  const routePause = (message: string, requote: boolean, keepJob: boolean): void => {
    const { plan, cloud } = get()
    set({
      pendingTarget: null,
      plan: plan ? { ...plan, status: 'paused', message, awaiting: null, requote } : null,
      proof: plan ? IDLE_PROOF : { ...IDLE_PROOF, status: 'infeasible', message },
      cloud: { ...cloud, status: keepJob ? 'error' : 'idle', message, quote: null, invoice: null, invoiceOpen: false, progress: null, job: keepJob ? cloud.job : null },
    })
  }

  /** What a refusal that returned money left in the balance (400 job_not_runnable), noted at once. */
  const noteRefusalBalance = (err: unknown): void => {
    if (!(err instanceof HosakaError) || !err.jobNotRunnable) return
    const d = err.detail as { current_balance_msats?: unknown } | null
    if (d && typeof d.current_balance_msats === 'number') get().noteBalance(d.current_balance_msats)
  }

  /** The route cannot be bought: the plan ends with the reason, nothing is signed. */
  const routeFail = (message: string): void => {
    const { plan, cloud } = get()
    set({
      pendingTarget: null,
      plan: plan ? { ...plan, status: 'failed', message, awaiting: null } : null,
      proof: { ...IDLE_PROOF, status: 'infeasible', message },
      cloud: { ...cloud, status: 'error', message, quote: null, invoice: null, invoiceOpen: false, progress: null },
    })
  }

  /**
   * One deposit for the whole route: the balance covers what it can, an
   * invoice covers the rest, and the route starts once the node reports the
   * invoice settled. Nothing else asks for money while the route runs.
   */
  const fundRoute = async (totalMsats: number, id: number): Promise<void> => {
    const { cloudPrefs, plan } = get()
    if (!plan) return
    const client = cloudClient(cloudPrefs.apiUrl)
    stopCloud()
    const abort = new AbortController()
    const waker = createWaker()
    cloudAbort = abort
    cloudWaker = waker
    try {
      set({ cloud: { ...get().cloud, status: 'funding', message: currentSigner.kind === 'local' ? 'Checking your HOSAKA balance.' : 'Waiting for your signer to approve the HOSAKA balance check.' } })
      const bal = await client.balance(abort.signal)
      get().noteBalance(bal.balance_msats)
      if (id !== requestId) return
      // Whole sats: a node refuses an invoice for a fraction of one.
      const shortfall = Math.ceil(Math.max(0, totalMsats - bal.balance_msats) / 1000) * 1000
      if (shortfall > 0) {
        const dep = await client.deposit(shortfall, abort.signal)
        if (id !== requestId) return
        const invoice = invoiceOf(dep)
        // On disk before the invoice is on screen: a reload after paying claims it.
        saveCloudDeposit({ depositId: dep.deposit_id, pubkey: get().identity.pubkey, amountMsats: shortfall, expiresAt: invoice.expiresAt, bolt11: invoice.bolt11 })
        set({ cloud: { ...get().cloud, status: 'awaiting_payment', invoice, invoiceOpen: true, message: null, checking: false, lastCheck: null } })
        const settled = await client.waitForDeposit(dep.deposit_id, {
          signal: abort.signal,
          expiresAt: invoice.expiresAt,
          intervalMs: claimIntervalFor(currentSigner.kind),
          waker,
          onPoll: (d) => { if (id === requestId) set({ cloud: { ...get().cloud, checking: false, lastCheck: { at: Date.now(), status: d.status } } }) },
          onPollError: () => { if (id === requestId) set({ cloud: { ...get().cloud, checking: false } }) },
        })
        if (typeof settled.balance_msats === 'number') get().noteBalance(settled.balance_msats)
        if (id !== requestId) return
        if (settled.status !== 'settled') {
          clearCloudDeposit()
          routeFail('The invoice expired unpaid. Commit again for a fresh quote.')
          return
        }
        clearCloudDeposit()
      }
    } catch (err) {
      if (id !== requestId || abort.signal.aborted) return
      routeFail(describeCloudError(err))
      return
    } finally {
      if (cloudAbort === abort) { cloudAbort = null; cloudWaker = null }
    }
    set({
      cloud: { ...get().cloud, status: 'paid', invoice: null, invoiceOpen: false, message: 'Route funded.' },
      plan: { ...get().plan!, status: 'running', message: null },
    })
    startPlanStep()
  }

  /**
   * One cloud step of the route: the signed submit (funded from the balance,
   * so it starts at once), the poll, the verification here, then the same
   * signature step a local proof gets. A short balance (the price moved) is
   * paid through the job's own invoice, as before.
   *
   * The submit's idempotency key is a function of the step and the chain head
   * (lib/hosaka.ts idempotencyKeyFor), so a submit whose answer was lost, and
   * the same step committed again after the route failed over it, name the
   * job the first attempt made rather than buying a second.
   */
  const startCloudStep = async (step: PlanStep, id: number): Promise<void> => {
    const { plane, prevEventId, identity, cloudPrefs } = get()
    const issue = movementCapabilityIssue(step.kind, step.from, step.to, plane, 'cloud')
    if (issue) { routeFail(issue); return }
    // The same three checks quoteRoute made, again at the moment of buying:
    // the limits may have changed since (a HOSAKA rolled back, or paused).
    if (step.kind === 'hop') {
      const limits = get().cloud.limits
      if (cloudHopsSold(limits) === 0) { routeFail(NO_V2_CLOUD_HOPS_MESSAGE); return }
      const tooTall = cloudVerifyIssue({ from: step.from, to: step.to, plane })
      if (tooTall) { routeFail(tooTall); return }
    }
    const client = cloudClient(cloudPrefs.apiUrl)
    set({
      pendingTarget: step.to,
      proof: { ...IDLE_PROOF, status: 'computing', mode: step.kind, source: 'cloud' },
      cloud: {
        ...get().cloud,
        status: 'quoting',
        invoice: null,
        invoiceOpen: false,
        job: null,
        progress: null,
        message: currentSigner.kind === 'local' ? 'Submitting to HOSAKA.' : 'Waiting for your signer to approve the HOSAKA request.',
        startedAt: Date.now(),
      },
    })
    let job: HosakaJob
    // The submit may ask again on its own after a lost answer (lib/hosaka.ts),
    // so it runs under the cloud flow's abort like every other cloud wait: X
    // (cancelCloud, cancelPlan) stops the retries, and a step cancelled during
    // one is never charged by a retry that lands after it.
    stopCloud()
    const abort = new AbortController()
    cloudAbort = abort
    try {
      const v1 = hosakaCoord(step.from, plane)
      const v2 = hosakaCoord(step.to, plane)
      job = step.kind === 'hop'
        ? await client.submitHop(v1, v2, prevEventId, abort.signal, hopWants('hop'))
        : await client.submitSidestep(v1, v2, prevEventId, abort.signal)
      const after = job.new_balance_msats ?? job.current_balance_msats
      if (typeof after === 'number') get().noteBalance(after)
      if (job.followed_existing) {
        // The same move was already on HOSAKA with the other cube setting:
        // that job is followed rather than paid for twice (lib/hosaka.ts).
        useToast.getState().show({
          label: 'SAME MOVE ALREADY ON HOSAKA',
          meta: 'Following the job already running, so nothing is charged twice. Your new cube setting applies from your next move.',
          mark: 'hosaka',
        })
      }
    } catch (err) {
      if (id !== requestId || abort.signal.aborted) return
      // Paused: nothing was charged, and RESUME submits the same step again.
      if (err instanceof HosakaError && err.hopPaused) { routePause(describeCloudError(err), false, false); return }
      noteRefusalBalance(err)
      routeFail(describeCloudError(err))
      return
    } finally {
      if (cloudAbort === abort) cloudAbort = null
    }
    if (id !== requestId || abort.signal.aborted) return
    const paying = job.payment_required === true && job.deposit !== undefined
    const record: PendingCloudJob = {
      version: 1,
      jobId: job.id,
      pollToken: job.poll_token ?? '',
      action: step.kind,
      pubkey: identity.pubkey,
      from: wirePosition(step.from),
      to: wirePosition(step.to),
      plane,
      prevEventId,
      costMsats: typeof job.cost_msats === 'number' ? job.cost_msats : 0,
      createdAt: Date.now(),
      stage: paying ? 'awaiting_payment' : 'computing',
      deposit: paying && job.deposit ? invoiceOf(job.deposit) : null,
      estSeconds: cloudSeconds(step.maxHeight, get().cloud.provider?.pricing?.hop ?? null) ?? undefined,
    }
    saveCloudJob(record)
    set({ cloud: { ...get().cloud, job: record, message: null } })
    await runCloud(record, id)
  }

  /**
   * From a persisted record to a signed event: pay if the job asks (a route is
   * funded up front, so normally it does not), poll (lib/cloud.ts
   * driveCloudJob), verify in a worker, refuse a moved head, then hand the
   * result to finishProof exactly as the worker would have. The route, if one
   * is running, continues from there.
   */
  const runCloud = async (record: PendingCloudJob, id: number): Promise<void> => {
    const client = cloudClient(get().cloudPrefs.apiUrl)
    stopCloud()
    const abort = new AbortController()
    const waker = createWaker()
    cloudAbort = abort
    cloudWaker = waker
    let outcome: { job: HosakaJob; record: PendingCloudJob }
    try {
      outcome = await driveCloudJob(client, record, {
        claimIntervalMs: claimIntervalFor(currentSigner.kind),
        onRecord: (r) => {
          saveCloudJob(r)
          if (id === requestId) set({ cloud: { ...get().cloud, job: r } })
        },
        onDepositPoll: (d) => {
          if (id === requestId) set({ cloud: { ...get().cloud, checking: false, lastCheck: { at: Date.now(), status: d.status } } })
        },
        // A failed poll must not leave CHECK PAYMENT spinning: the wait goes on and the button is live again.
        onDepositPollError: () => {
          if (id === requestId) set({ cloud: { ...get().cloud, checking: false } })
        },
        onStage: (stage, d) => {
          if (id !== requestId) return
          const cloud = get().cloud
          set({
            cloud: {
              ...cloud,
              status: stage,
              invoice: d.invoice === undefined ? cloud.invoice : d.invoice,
              invoiceOpen: stage === 'awaiting_payment' ? (d.invoice ? true : cloud.invoiceOpen) : false,
              progress: d.progress === undefined ? cloud.progress : d.progress,
              message: d.message === undefined ? cloud.message : d.message,
            },
            ...(d.progress !== undefined && d.progress !== null ? { proof: { ...get().proof, progress: d.progress } } : {}),
          })
        },
      }, abort.signal, waker)
    } catch (err) {
      if (id !== requestId || abort.signal.aborted) return
      // A paid job HOSAKA will not start while hops are paused: it stays
      // pending and uncharged, so its record is kept and RESUME starts it
      // once they reopen.
      if (err instanceof HosakaError && err.hopPaused) { routePause(describeCloudError(err), false, true); return }
      // job_not_runnable: failed, refunded to the balance, and the record
      // is worthless (retainsRecord drops it).
      noteRefusalBalance(err)
      const keep = retainsRecord(err)
      if (!keep) clearCloudJob()
      cloudFail(describeCloudError(err), keep)
      return
    } finally {
      if (cloudAbort === abort) { cloudAbort = null; cloudWaker = null }
    }
    if (id !== requestId) return

    const { job } = outcome
    const final = outcome.record
    // A staged hop is not a finished job and is not a failed one: its own
    // proof is whole and the destination cubes are still being computed, so
    // it is verified and signed exactly like a finished one and the cubes are
    // collected afterwards (collectCloudKeys).
    if (job.status !== 'completed' && !keysPending(job)) {
      clearCloudJob()
      cloudFail(`HOSAKA job failed: ${job.error ?? 'no reason given'}. The charge was refunded to your HOSAKA balance.`, false)
      return
    }
    // What it actually took, against what was estimated: TIME learns from it.
    recordJobExperience(final, Math.max(findLcaHeight(BigInt(final.from.x), BigInt(final.to.x)), findLcaHeight(BigInt(final.from.y), BigInt(final.to.y)), findLcaHeight(BigInt(final.from.z), BigInt(final.to.z))))

    // A hop that finished in the old hop_n shape (a job that straddled
    // HOSAKA's switch to version 2): never signed (lib/cloud.ts
    // straddlingV1Hop, decision D-A), and the record goes with it.
    const straddled = straddlingV1Hop(final.action, job.result, final.jobId)
    if (straddled) {
      clearCloudJob()
      cloudFail(straddled, false)
      return
    }

    set({ cloud: { ...get().cloud, status: 'verifying', invoice: null, invoiceOpen: false, progress: null, message: null } })
    const move = { from: positionFromWire(final.from), to: positionFromWire(final.to), plane: final.plane, prevEventId: final.prevEventId }
    let failed: string[]
    try {
      failed = await verifyCloudResult(final.action, job.result, move)
    } catch (err) {
      failed = [`verifier: ${err instanceof Error ? err.message : String(err)}`]
    }
    if (id !== requestId) return
    if (failed.length > 0) {
      clearCloudJob()
      cloudFail(`Cloud proof rejected: ${failed.join(', ')}. Nothing was signed.`, false)
      return
    }
    // The proof binds to the head it was quoted against (spec 5.3). A head
    // that moved since makes it worthless, so it is refused, not appended.
    if (get().prevEventId !== final.prevEventId) {
      clearCloudJob()
      cloudFail('The chain head moved while HOSAKA was computing; the cloud proof was discarded.', false)
      return
    }

    // Set by the hop below when HOSAKA is still computing its cubes.
    let stagedCubes = false
    const msg = cloudProofResponse(id, final, job, Date.now() - (get().cloud.startedAt ?? final.createdAt))
    if (msg.type === 'done' && msg.mode === 'hop' && msg.lookupId) {
      // The region key of the region entered (spec 7.2), which this machine could not derive.
      const r = job.result as CloudHopResult
      // The region's height is the move's own tallest axis, never HOSAKA's word.
      const height = Math.max(msg.lca.x, msg.lca.y, msg.lca.z)
      saveCloudRegionKey({
        lookupId: msg.lookupId,
        keyHex: r.region_n.secret_key,
        height,
        coordHex: positionHex(move.to, move.plane),
        jobId: final.jobId,
        at: Math.floor(Date.now() / 1000),
      })
      // And into the Secrets list, where every region you can open is listed
      // together, whoever computed it.
      useSecrets.getState().hold([{
        lookupId: msg.lookupId,
        keyHex: r.region_n.secret_key,
        height,
        base: {
          x: String((move.to.x >> BigInt(height)) << BigInt(height)),
          y: String((move.to.y >> BigInt(height)) << BigInt(height)),
          z: String((move.to.z >> BigInt(height)) << BigInt(height)),
        },
        plane: move.plane,
        source: 'cloud',
        at: Math.floor(Date.now() / 1000),
      }])
      scanHeldKey(msg.lookupId, r.region_n.secret_key)
      // LOOT: the cubes around where it landed. HOSAKA's own list when it sent
      // one; this machine computes what it can either way, up to its ceiling.
      if (get().cloudPrefs.profile === 'loot') {
        const sent = r.destination_keys ? holdCloudDestinationKeys(r.destination_keys, move.to, move.plane) : 0
        const top = sent > 0 ? Math.min(...r.destination_keys!.map((k) => k.height)) - 1 : localKeyCeiling()
        void holdDestinationCubes(move.to, move.plane, destinationHeights(Math.min(height, top), localKeyCeiling()), MAX_COMPUTE_HEIGHT, 'cloud')
        // Staged delivery: this result is the hop alone and the cubes are
        // still being computed on the same job. Noted here, taken up once the
        // move itself has landed, since the cubes are the lesser half.
        stagedCubes = r.keys_pending === true
      }
    }
    const before = get().events.length
    await get().finishProof(msg)
    if (get().events.length === before) {
      if (id !== requestId) return
      // The signer refused. The verified result is still good, so the record stays for RESUME.
      set({ cloud: { ...get().cloud, status: 'error', message: `${get().plan?.message ?? get().proof.message ?? 'Signing failed.'} The verified cloud result is kept.` } })
      return
    }
    useToast.getState().show({ label: `CLOUD COMPUTE JOB COMPLETE - ${final.jobId.slice(0, 8)}`, meta: 'Thanks for using HOSAKA!', mark: 'hosaka' })
    // The move is signed and the toast for it has been shown; now the cubes,
    // which arrive on the same job minutes later. The ticket outlives this
    // tab, so a phone put away mid job collects them when it comes back.
    if (stagedCubes) {
      saveKeysTicket({ version: 1, jobId: final.jobId, pollToken: final.pollToken, to: wirePosition(move.to), plane: move.plane, at: Date.now() })
      void get().collectCloudKeys()
    }
    // The event landed, and a route may already have moved on to its next
    // step (which bumps the request id): the bookkeeping below is about the
    // step that landed, so it runs regardless.
    clearCloudJob()
    const cost = msg.type === 'done' ? msg.costMsats ?? final.costMsats : final.costMsats
    // Spent on this chain, on this device only.
    set({ spentMsats: addSpent(get().genesisId, cost) })
    set({
      cloud: {
        ...IDLE_CLOUD,
        balance: get().cloud.balance,
        limits: get().cloud.limits,
        // Per API URL like the limits: kept, or the ride offer and the
        // crossover lose it until a reload (arkinox, 2026-10-11).
        provider: get().cloud.provider,
        // A route in progress keeps its funded status visible.
        status: get().plan ? 'paid' : 'idle',
        message: get().plan ? 'Route funded.' : null,
        last: {
          jobId: final.jobId,
          action: final.action,
          costMsats: cost,
          lookupId: msg.type === 'done' ? msg.lookupId ?? null : null,
          at: Date.now(),
        },
      },
    })
  }

  cloudStepStarter = startCloudStep

  /**
   * A HOSAKA ride that ended without a hyperjump. The head is let go (the
   * deferred relay events fold), the reason goes to the Hyperspace panel and
   * the Cloud panel, and the record stays for RESUME only when `keep`: a
   * paid job that can still be finished or signed.
   */
  const rideFail = (message: string, keep: boolean): void => {
    const cloud = get().cloud
    set({
      pendingTarget: null,
      proof: IDLE_PROOF,
      cloud: { ...cloud, status: 'error', message, rideError: message, quote: null, invoice: null, invoiceOpen: false, progress: null, job: keep ? cloud.job : null },
    })
  }

  /**
   * A sampled block's hash from the line this client synced. The stop index
   * fills while the line syncs, so right after a reload a finished job may
   * be checked before the block is there: wait for it a while, then give up
   * WITHOUT judging the proof (verifyCloudRide rejects), so the paid proof is
   * kept for RESUME. Lazy import: useHyperspace imports this store.
   */
  const rideBlockHash = (id: number) => async (height: number): Promise<string> => {
    const { getStopByHeight } = await import('./useHyperspace')
    for (let waited = 0; ; waited += LINE_POLL_MS) {
      const hash = getStopByHeight(height)?.blockHash
      if (hash) return hash
      if (id !== requestId) throw new Error('canceled')
      if (waited >= LINE_WAIT_MS) throw new Error(`block ${height} is not on this device's line yet`)
      await new Promise((resolve) => setTimeout(resolve, LINE_POLL_MS))
    }
  }

  /**
   * From a persisted ride record to a signed hyperjump: pay if the job asks,
   * poll (lib/cloud.ts driveCloudJob, as for hops), check the proof at Level
   * 1 (lib/cloudRide.ts), refuse a moved head, then sign through completeRide,
   * the one path a local ride takes. A proof that fails the check is never
   * signed. Resolves true when the hyperjump was signed.
   */
  const runCloudRide = async (record: PendingCloudJob, id: number): Promise<boolean> => {
    const ride = record.ride
    if (!ride) return false
    const client = cloudClient(get().cloudPrefs.apiUrl)
    stopCloud()
    const abort = new AbortController()
    const waker = createWaker()
    cloudAbort = abort
    cloudWaker = waker
    let outcome: { job: HosakaJob; record: PendingCloudJob }
    try {
      outcome = await driveCloudJob(client, record, {
        claimIntervalMs: claimIntervalFor(currentSigner.kind),
        onRecord: (r) => {
          saveCloudJob(r)
          if (id === requestId) set({ cloud: { ...get().cloud, job: r } })
        },
        onDepositPoll: (d) => {
          if (id === requestId) set({ cloud: { ...get().cloud, checking: false, lastCheck: { at: Date.now(), status: d.status } } })
        },
        onDepositPollError: () => {
          if (id === requestId) set({ cloud: { ...get().cloud, checking: false } })
        },
        onStage: (stage, d) => {
          if (id !== requestId) return
          const cloud = get().cloud
          set({
            cloud: {
              ...cloud,
              status: stage,
              invoice: d.invoice === undefined ? cloud.invoice : d.invoice,
              invoiceOpen: stage === 'awaiting_payment' ? (d.invoice ? true : cloud.invoiceOpen) : false,
              progress: d.progress === undefined ? cloud.progress : d.progress,
              message: d.message === undefined ? cloud.message : d.message,
            },
            ...(d.progress !== undefined && d.progress !== null ? { proof: { ...get().proof, progress: d.progress } } : {}),
          })
        },
      }, abort.signal, waker)
    } catch (err) {
      if (id !== requestId || abort.signal.aborted) return false
      const keep = retainsRecord(err)
      if (!keep) clearCloudJob()
      rideFail(describeCloudError(err), keep)
      return false
    } finally {
      if (cloudAbort === abort) { cloudAbort = null; cloudWaker = null }
    }
    if (id !== requestId) return false
    const { job } = outcome
    const final = outcome.record
    const after = job.new_balance_msats ?? job.current_balance_msats
    if (typeof after === 'number') get().noteBalance(after)
    if (job.status !== 'completed') {
      // HOSAKA refunds a failed job to the balance; the same ride asked
      // again names a new job under the same key, paid from that refund.
      clearCloudJob()
      rideFail(`HOSAKA could not finish the ride: ${job.error ?? 'no reason given'}. The charge was refunded to your HOSAKA balance.`, false)
      return false
    }

    set({ cloud: { ...get().cloud, status: 'verifying', invoice: null, invoiceOpen: false, progress: null, message: 'Checking HOSAKA\'s ride proof on this device.' } })
    let failed: string[]
    try {
      failed = await verifyCloudRide(job, { previousId: final.prevEventId, fromHeight: ride.fromHeight, toHeight: ride.toHeight }, rideBlockHash(id))
    } catch (err) {
      // Not judged (the line has not synced a sampled block, the verifier
      // broke): kept, never signed unchecked and never thrown away paid.
      if (id !== requestId) return false
      rideFail(`HOSAKA's ride proof could not be checked yet (${err instanceof Error ? err.message : String(err)}). It is kept: RESUME in the Cloud compute panel checks it and signs it once the line has synced.`, true)
      return false
    }
    if (id !== requestId) return false
    if (failed.length > 0) {
      clearCloudJob()
      rideFail(`HOSAKA's ride proof failed this device's check (${failed.join('; ')}), so nothing was signed and you did not move. Quote job ${final.jobId.slice(0, 8)} to HOSAKA for a refund.`, false)
      return false
    }
    // Bound to the head it was computed from (§5.3): a head that moved
    // makes it worthless, so it is refused, not signed.
    if (get().prevEventId !== final.prevEventId) {
      clearCloudJob()
      rideFail('Your chain moved while HOSAKA was computing the ride, and the proof is bound to where it started, so it was discarded.', false)
      return false
    }

    const r = job.result as CloudRideResult
    // The head is let go here: completeRide confirms it afresh with the
    // relays and refuses a moved one, as for a ride computed here.
    set({ proof: IDLE_PROOF, cloud: { ...get().cloud, message: 'Signing the hyperjump.' } })
    const before = get().events.length
    let refusal: string | null = null
    try {
      await get().completeRide({
        previousId: final.prevEventId,
        toCoordHex: ride.toCoordHex,
        fromHeight: ride.fromHeight,
        toHeight: ride.toHeight,
        asOf: ride.asOf,
        rootHex: r.root,
        mp: r.mp,
        mnHex: r.mn,
      })
    } catch (err) {
      refusal = err instanceof Error ? err.message : String(err)
    }
    if (get().events.length === before) {
      if (id !== requestId) return false
      // Not signed. A moved head makes the proof worthless; anything else
      // (the signer declined, the relays did not answer) keeps it for RESUME.
      const moved = get().prevEventId !== final.prevEventId
      if (moved) clearCloudJob()
      rideFail(`${refusal ?? 'The hyperjump was not signed.'}${moved ? '' : ' The checked ride proof is kept: RESUME in the Cloud compute panel signs it.'}`, !moved)
      return false
    }
    clearCloudJob()
    const cost = typeof job.cost_msats === 'number' ? job.cost_msats : final.costMsats
    set({ spentMsats: addSpent(get().genesisId, cost) })
    set({
      cloud: {
        ...IDLE_CLOUD,
        balance: get().cloud.balance,
        limits: get().cloud.limits,
        provider: get().cloud.provider,
        last: { jobId: final.jobId, action: 'ride', costMsats: cost, lookupId: null, at: Date.now() },
      },
    })
    useToast.getState().show({ label: `HOSAKA RIDE COMPLETE - ${final.jobId.slice(0, 8)}`, meta: 'Checked on this device and signed. Thanks for using HOSAKA!', mark: 'hosaka' })
    return true
  }
  cloudRideRunner = runCloudRide

  /**
   * Every login and every reconnect that ends in a switch goes through here.
   * Each takes a ticket when it starts; a slow one (a bunker on a sleeping
   * phone, an extension prompt left open) that finishes after a newer one
   * started, or after the identity changed some other way, is closed instead
   * of switched to, and its error is dropped: a late answer never undoes a
   * newer choice (review of #353, 2026-10-15).
   */
  let loginTicket = 0
  let switchCount = 0
  const login = async (make: () => Signer | Promise<Signer>, errorPrefix = '', quiet: () => boolean = () => false): Promise<void> => {
    const ticket = ++loginTicket
    // Real switches of identity, counted by switchTo. Not the signer object:
    // the store replaces that in the background for the SAME identity (the
    // stand-in going live, a retry rebuilding a dead channel), and that must
    // not drop a login the user is making (review of #353).
    const switches = switchCount
    const current = (): boolean => ticket === loginTicket && switches === switchCount
    const fail = (err: unknown): void => {
      if (current() && !quiet()) set({ loginError: `${errorPrefix}${err instanceof Error ? err.message : String(err)}` })
    }
    let signer: Signer
    try {
      signer = await make()
    } catch (err) {
      fail(err)
      return
    }
    if (!current()) { void signer.close?.(); return }
    // A signer must name a real key before it becomes the identity.
    if (!/^[0-9a-f]{64}$/.test(signer.pubkey)) { void signer.close?.(); fail(new Error('The signer gave a key that is not a valid public key.')); return }
    // switchTo counts the switch before anything in it can throw, so its own
    // failure is this attempt's to report: judged by the ticket alone.
    try { await switchTo(signer) } catch (err) {
      if (ticket === loginTicket && !quiet()) set({ loginError: `${errorPrefix}${err instanceof Error ? err.message : String(err)}` })
    }
  }

  const switchTo = async (signer: Signer): Promise<void> => {
    switchCount++
    // Whatever was waiting to sign as the old identity ends without a word.
    chainEpoch++
    // A cloud flow in progress was signing as the old identity; it ends here.
    stopCloud()
    requestId++
    currentSigner = signer
    // A new signer: whether the old one was on another account is old news.
    otherAccountNoticed = null
    heldAsked = null
    if (useToast.getState().toast?.mark === 'signer') useToast.getState().dismiss()
    saveSignerPref(prefOf(signer))
    // No spawn is signed here. A returning identity loads from local storage now
    // and from the relay a moment later (self-sync), and a brand-new one sits at
    // its spawn coordinate until its first move. So switching to a bunker or an
    // extension never makes it sign anything just to log in.
    // Drawn at once, its signatures checked in the background (below).
    const local = rowsFirst(signer.pubkey) ? null : loadChain(signer.pubkey, true)
    const base = local ? derive(local) : provisionalChain(signer.pubkey)
    noteInHand(signer.pubkey, local)
    // A broken-chain notice or respawn confirm left open was about the old
    // identity's chain; it must never respawn the new one.
    useChainUi.getState().setBrokenView(null)
    set({
      identity: { pubkey: signer.pubkey, npub: nip19.npubEncode(signer.pubkey) },
      signerKind: signer.kind,
      loginError: null,
      ...base,
      cursor: base.position,
      pendingTarget: null,
      plan: null,
      spentMsats: loadSpent(base.genesisId),
      respawns: loadRespawns(signer.pubkey),
      proof: IDLE_PROOF,
      publishError: null,
      spectate: null,
      focus: null,
      transit: null,
      cloud: { ...IDLE_CLOUD, limits: get().cloud.limits, provider: get().cloud.provider, balance: loadBalance(signer.pubkey) },
      // A new identity, a new question: the old one's answer and its prompt
      // say nothing about this one (selfSync.ts asks again on the switch).
      selfCheck: { pubkey: signer.pubkey, status: 'checking' },
      chainConflict: null,
      forkNotice: null,
    })
    // Before the save below: until IndexedDB has been read, that save must not
    // put this copy over the one kept there (hydrateChain).
    hydrateChain(signer.pubkey)
    if (local) saveChain(base.events, base.published, base.chain, base.held)
    startSignatureCheck(signer.pubkey, local?.unchecked ?? [])
    // A pending cloud job of THIS identity, if there is one, picks up where it stopped.
    void get().resumeCloudJob()
  }

  /**
   * A free view keeps its anchor where VIEW put it and lets the cursor roam
   * the field, exactly as at your head: the camera follows the cursor, and
   * nothing re-anchors per press. Only when the cursor leaves the field's
   * reach does the view jump to it, the way a commit re-anchors on the avatar,
   * so a long walk costs one re-anchor every field width rather than one
   * per step.
   */
  const rideView = (next: Position): void => {
    const { anchor, scaleExp, focus } = get()
    if (!focus?.drive || get().atHead()) return
    const far = (['x', 'y', 'z'] as const).some((axis) => Math.abs(cellDelta(next[axis], anchor[axis], scaleExp)) > GRID_RADIUS)
    if (far) set({ anchor: { ...next }, focus: { ...focus, position: { ...next } } })
  }

  /**
   * COMMIT, toward the cursor (`walk` null) or toward one WALK step. Both
   * share every check below; WALK differs only in what it aims at, what
   * counts as still aimed, and that it never asks HOSAKA for a quote.
   */
  const commitToward = async (walk: { target: Position; stillAimed: () => boolean } | null): Promise<void> => {
    // Is a newer deploy requiring newer chain rules (lib/versionGate.ts)?
    // Asked now, alongside the head checks below, and waited for
    // before any proof is computed or any HOSAKA sats are spent; whyNoMove
    // gives the answer. A recent answer is in hand at once, with no wait.
    const versionLook = lookBeforeMove()
    // One proof at a time. X cancels a commit you regret.
    if (get().proof.status === 'computing') return
    // Looking at history: nothing here is a place you can move from.
    if (!get().atHead()) return

    // A held chain that met a chain on the relays waits for its answer: a
    // move now would only lengthen one side of a choice not yet made.
    if (get().chainConflict) {
      const message = get().chainConflict!.kind === 'held'
        ? 'This identity has a chain on the relays as well as this one. Choose which to keep first.'
        : 'Another device published moves from the same point as your unpublished ones. Choose which to keep first.'
      set({ proof: { ...IDLE_PROOF, status: 'infeasible', message } })
      // A prompt that was set aside comes back: the question is why nothing moved.
      useChainUi.getState().setPromptAside(false)
      return
    }

    // A game holds the avatar, or the chain is broken:
    // nothing here may be signed (whyNoMove).
    const noMove = whyNoMove(get().actions())
    if (noMove) {
      set({ pendingTarget: null, proof: { ...IDLE_PROOF, status: 'infeasible', message: noMove } })
      return
    }

    // What this commit was pressed for, held across every wait below. The
    // look at the relay, the first move's check and its signer, and HOSAKA's
    // caps can each take seconds, and the cursor is free to move meanwhile:
    // into BUILD mode or a VIEW, where it is a build cursor or a view's
    // cursor and never a destination, or simply re-aimed at your head. A move
    // reading the cursor after the wait flew to wherever it had gone (found
    // in review, 2026-10-07). So the move goes where it was aimed when it was
    // pressed, from your head, or not at all.
    // A WALK step is aimed at its own target, not at the cursor, which by
    // then is out at the last step queued; it stays aimed while the walk
    // still has it next.
    const aimedCursor = { ...(walk ? walk.target : get().cursor) }
    const aimedPlane = get().plane
    const lostAim = (): boolean => {
      const now = get()
      if (now.atHead() && (walk ? walk.stillAimed() : samePosition(now.cursor, aimedCursor)) && now.plane === aimedPlane) return false
      set({ pendingTarget: null, proof: { ...IDLE_PROOF, status: 'infeasible', message: now.atHead() ? AIM_CHANGED_MESSAGE : LEFT_HEAD_MESSAGE } })
      return true
    }

    // The head is confirmed before anything is computed or signed.
    //
    // An action names the one before it, so an action signed from a head
    // another device or tab has already moved past forks the chain, and a
    // fork ends the whole chain for every reader (arkinox, 2026-10-08). The
    // live subscription usually has us up to date; this closes the gap
    // between an event reaching the relay and reaching us, and refuses to
    // sign when the relays cannot say (confirmHead). LOCAL changes nothing
    // here: it decides what this device publishes, not whether it can read.
    //
    // Only for a chain that exists. A provisional identity's question is a
    // different one (does it have a chain at all?) and is answered below.
    //
    // A WALK step does not ask the relays here, only before it is signed
    // (arkinox, 2026-10-31): the relays' look before the proof was most of
    // a step's wait, and a step's proof takes milliseconds, so a head that
    // moved meanwhile costs only that proof. The look before signing still
    // refuses it, and the walk stops there (headMovedUnder); the next press
    // walks on from the new head. What this device can check without a relay (the
    // saved chain read in, its signatures, another tab's move) is still
    // checked now, so the proof starts from the head this browser knows.
    if (get().events.length > 0) {
      const beforeHead = get().prevEventId
      const refusal = walk
        ? await headCheckedHere()
        : await confirmHead(() => set({ proof: { ...IDLE_PROOF, message: HEAD_RETRYING_MESSAGE } }))
      if (versionLook instanceof Promise) await versionLook
      if (refusal === STALE_CONFIRMATION) return
      if (refusal) {
        set({ pendingTarget: null, proof: { ...IDLE_PROOF, status: 'infeasible', message: refusal } })
        return
      }
      // On a held chain, a relay chain does not move you: it raises the prompt.
      if (get().chainConflict) return
      // The look may have brought a game's entry: a game holds the avatar now.
      const noMoveNow = whyNoMove(get().actions())
      if (noMoveNow) {
        set({ pendingTarget: null, proof: { ...IDLE_PROOF, status: 'infeasible', message: noMoveNow } })
        return
      }
      // Before the aim: adopting another device's move carries the cursor
      // with it, and that is the reason to give, not "the cursor changed".
      if (get().prevEventId !== beforeHead) {
        set({
          pendingTarget: null,
          proof: { ...IDLE_PROOF, status: 'infeasible', message: headMovedWords(get().events, 'Re-aim from where you are now.') },
        })
        return
      }
      if (lostAim()) return
    }

    // A provisional identity (logged in or loaded, never placed) has no
    // genesis yet. Its spawn is signed now, on this first deliberate move, and
    // never at login or on load: this is the only spawn a switched-in
    // identity ever signs. Before signing, the self-check gets a short wait
    // to say whether the identity already has a chain (lib/chainHold.ts
    // firstMove; arkinox, 2026-10-01):
    //
    // | Check | First move |
    // |---|---|
    // | found | the relay chain has placed you: nothing is signed, re-aim from its head |
    // | none | sign the spawn: a normal new chain, published per LIVE |
    // | unknown, or no answer in time | sign the spawn, and HOLD the chain on this device |
    if (get().events.length === 0) {
      // Nothing lined up is no reason to sign a spawn.
      if (samePosition(get().position, aimedCursor) && get().plane === get().headPlane) return
      if (!(await signFirstSpawn(lostAim))) return
    }

    const { position, plane, headPlane, prevEventId, proof } = get()
    const cursor = aimedCursor
    if (proof.status === 'computing') return
    // Nothing lined up: same cell, same plane.
    if (samePosition(position, cursor) && plane === headPlane) return
    // A previous cloud failure has been read by now; a new commit starts
    // clean. A kept job stays kept.
    if (get().cloud.status === 'error') set({ cloud: { ...get().cloud, status: 'idle', message: null } })

    // Route by feasibility: a hop straight to the cursor when the Cantor tree
    // fits this machine; otherwise HOSAKA, when cloud mode is on and it sells
    // the height (a cloud hop lands at the cursor, a cloud sidestep past the
    // wall); otherwise a local Merkle sidestep across the blocking wall(s),
    // landing 1 gibson past the boundary, not at the cursor, so the cursor
    // keeps the rest of the journey for the next commit (lib/cloud.ts
    // lib/movePlan.ts). The ceiling this commit will actually attempt: the
    // protocol's hard cap, lowered to what calibration measured THIS machine
    // finishing in budget (lib/calibration.ts). Routing, the sidestep landing
    // and the worker all use the same number, so a hop the machine cannot
    // finish becomes a sidestep at the real ceiling instead of a stalled tab.
    const ceiling = Math.min(MAX_COMPUTE_HEIGHT, recommendedHopHeight())
    const estimate = estimateHopCost(
      position.x, position.y, position.z,
      cursor.x, cursor.y, cursor.z,
      plane,
      ceiling,
    )
    if (!estimate.exceedsLimit) {
      const issue = movementCapabilityIssue('hop', position, cursor, plane)
      if (issue) {
        set({ proof: { ...IDLE_PROOF, status: 'infeasible', message: issue } })
        return
      }
      const to = { ...cursor }
      const id = ++requestId
      if (walk) walkHopId = id
      set({
        pendingTarget: to,
        plan: null,
        proof: { ...IDLE_PROOF, status: 'computing', mode: 'hop' },
      })
      postProof({ id, mode: 'hop', from: position, to, plane, prevEventId, maxComputeHeight: ceiling })
      return
    }

    // A wall is in the way. A sidestep buys exactly 1 gibson through a wall
    // (spec 6.3), so the route is hops to the leaf touching the wall, the
    // sidestep, hops on, for every wall and every block boundary above the
    // ceiling between here and the cursor. HOSAKA, when it is on, raises the
    // hop ceiling to its cap, so a paid hop replaces the walk wherever it
    // reaches; its steps are quoted together and paid with one deposit before
    // the route starts. Each step is its own event; the route runs them in
    // order and pauses when a signature is declined.
    if (get().cloudPrefs.mode !== 'off' && get().cloud.limits === null) {
      set({ proof: { ...IDLE_PROOF, status: 'computing', mode: 'hop', message: 'Asking HOSAKA for its caps.' } })
      await ensureCloudLimits()
      set({ proof: IDLE_PROOF })
      if (lostAim()) return
    }
    // Local first, per step, as the button promised (lib/movePlan.ts): the
    // step is this machine's whenever it has one; HOSAKA's caps enter only
    // at a boundary this machine cannot cross (nextActionFor makes the same
    // choice). Only a step nobody can take is refused here.
    const ceilings = cloudCeilings()
    const step = nextStep(position, cursor, ceilings)
    if (!step) return
    if (step.source === 'infeasible') {
      set({
        plan: null,
        proof: {
          ...IDLE_PROOF,
          status: 'infeasible',
          message: `The next step crosses a boundary (h${step.maxHeight}) higher than this machine${ceilings.cloudHop ? ' or HOSAKA' : ''} computes (sidestep cap h${Math.max(ceilings.sidestep, ceilings.cloudSidestep)}). Line up a nearer cursor${ceilings.cloudHop ? '' : ', or turn the cloud on'}.`,
        },
      })
      return
    }
    // SINGLE: one action per commit. The cursor may sit any distance away;
    // the commit executes only the first step of the way there, the one the
    // button named (a hop to the cursor, a hop to the boundary, a sidestep
    // through it, or HOSAKA's version of either), and lands where that step
    // lands. The cursor stays, so the next commit names the next step.
    //
    // AUTOMATIC: the whole route, its steps run in order, pausing only for a
    // declined signature or a step that fails. A long walk is dozens of
    // identical presses otherwise, which is what this is for.
    // A WALK step is one press, so its route is the whole of it.
    const target = walk || get().moveMode === 'auto' ? { ...cursor } : { ...step.to }
    const one = planSummary(position, target, ceilings)
    const funded = one.cloudSteps === 0
    // WALK never pays on its own: a step HOSAKA would have to sell stops the
    // walk here, and HOP is where the offer is made.
    if (walk && !funded) {
      set({ plan: null, proof: { ...IDLE_PROOF, status: 'infeasible', message: WALK_NEEDS_HOSAKA_MESSAGE } })
      return
    }
    set({
      plan: {
        target,
        ceilings,
        summary: one,
        done: 0,
        step,
        status: funded ? 'running' : 'funding',
        message: null,
        awaiting: null,
        startedAt: Date.now(),
        ...(walk ? { walk: true as const } : {}),
      },
    })
    if (funded) startPlanStep()
    else await quoteRoute(++requestId)
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
  plan: null,
  spentMsats: loadSpent(initial.genesisId),
  respawns: loadRespawns(pubkeyHex),
  scaleExp: 0,
  buildStep: null,
  buildSettle: null,
  // Facing the black sun, the section 11.3 canonical orientation, the same
  // one the SUN button restores. The spec's left/right/above/below language
  // is defined against it, so it is what a first look should agree with; the
  // map view is one TOP away and does not need to be where everyone starts.
  view: canonicalQuaternion(),
  viewHistory: [],
  proof: IDLE_PROOF,
  publishError: null,
  canonicalLate: 0,
  live: loadLive(),
  forkNotice: null,
  selfCheck: { pubkey: pubkeyHex, status: 'checking' },
  chainConflict: null,
  publishRequest: 0,
  signerKind: currentSigner.kind,
  loginError: null,

  signSpawn: async () => {
    if (get().events.length > 0 || get().chainConflict) return false
    if (whyNoMove(get().actions())) return false
    return signFirstSpawn(() => false)
  },

  moveCursor: (dir) => {
    const { cursor, scaleExp } = get()
    if (!get().canDrive()) return
    // WALK's cursor is its predicted head, moved only by a step (useWalk).
    if (get().walking) return
    // One cell of the zoom, or one build STEP while a deploy is lined up in
    // BUILD mode. Never a STEP at your head, where the cursor is a move's.
    const step = stepFor(get().atHead() ? scaleExp : buildStepOf(get())) * BigInt(dir.dir)

    const next: Position = { ...cursor }
    next[dir.axis] = clampAxis(cursor[dir.axis] + step)

    // Clamped against the axis wall: nowhere to go.
    if (next[dir.axis] === cursor[dir.axis]) return
    set({ cursor: next })
    rideView(next)
  },

  setBuildStep: (step) => {
    const next = step === null || step >= get().scaleExp ? null : Math.max(0, Math.round(step))
    if (next !== null) { if (next !== get().buildStep) set({ buildStep: next }); return }
    const { buildStep, buildSettle, cursor } = get()
    if (buildStep === null && buildSettle === null) return
    // Back on the zoom, the snap is the cube's center wherever the cursor is
    // in it, so STEP's re-centering is undone if nothing has moved it since.
    const back = buildSettle && samePosition(cursor, buildSettle.at) ? { cursor: { ...buildSettle.from } } : {}
    set({ buildStep: null, buildSettle: null, ...back })
  },

  setCursorAtCell: (row, col) => {
    if (get().walking) return
    const { scaleExp, view } = get()
    const focus = get().focus
    const viewing = !get().atHead() && focus?.drive === true
    // Cells are counted from the field's origin: your head, or the view's anchor.
    const position = viewing ? get().anchor : get().position
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
    if (viewing) rideView(next)
  },

  commit: () => commitToward(null),

  walkTo: (target, stillAimed) => commitToward({ target, stillAimed }),

  walking: false,

  setShowSecrets: (show) => {
    if (show === get().showSecrets) return
    try { localStorage.setItem(SHOW_SECRETS_KEY, show ? '1' : '0') } catch { /* private mode */ }
    set({ showSecrets: show })
  },

  setShowTrail: (show) => {
    if (show === get().showTrail) return
    try { localStorage.setItem(SHOW_TRAIL_KEY, show ? '1' : '0') } catch { /* private mode */ }
    set({ showTrail: show })
  },

  setMoveMode: (mode) => {
    if (mode === get().moveMode) return
    saveMoveMode(mode)
    set({ moveMode: mode })
  },

  resumePlan: () => {
    const { plan } = get()
    if (!plan || plan.status !== 'paused') return
    if (plan.requote) {
      // Paused by HOSAKA before any price was approved: ask for a quote
      // again, which looks at the limits afresh (ensureCloudLimits).
      set({ plan: { ...plan, status: 'funding', message: null, requote: false } })
      void quoteRoute(++requestId)
      return
    }
    if (plan.awaiting) {
      const msg = plan.awaiting
      // The kept proof is for the paused step: its destination is the step's.
      set({
        plan: { ...plan, status: 'running', message: null, awaiting: null },
        pendingTarget: plan.step.to,
        // A kept cloud proof goes in its job's plane (finishProof signs it there either way).
        ...(msg.type === 'done' && msg.move ? { plane: coordToXyz(hexToCoord(msg.move.toHex)).plane } : {}),
      })
      void get().finishProof(msg)
      return
    }
    set({ plan: { ...plan, status: 'running', message: null } })
    startPlanStep()
  },

  cancelPlan: () => {
    if (get().proof.status === 'computing') cancelProof()
    requestId++
    if (get().cloud.status !== 'idle') {
      // Ends the cloud flow the same way X does: a paid job is kept for RESUME.
      get().cancelCloud()
    }
    set({ plan: null, pendingTarget: null, proof: IDLE_PROOF })
  },

  cancel: () => {
    const { proof, position, headPlane, plan, cloud } = get()
    if (plan) { get().cancelPlan(); return }
    // A cloud flow owns the commit while it runs, and its failure notice
    // afterwards; X ends either the same way.
    if (cloud.status !== 'idle') { get().cancelCloud(); return }
    if (proof.status === 'computing') {
      // A Cantor proof is one synchronous computation, so cancelling means
      // killing the worker thread. Position never moved; the chain is intact.
      cancelProof()
      requestId++
      set({ pendingTarget: null, proof: IDLE_PROOF })
      return
    }
    // The pad's VIEW ends here too: the focus goes, and with it the cursor
    // comes home and the zoom returns (clearFocus).
    if (get().viewing()) { get().clearFocus(); return }
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
    const focus = get().focus
    // Someone else's plane is theirs; the terrain follows their chain. A
    // driven view kept through a spectation (BUILD mode) is yours, and its
    // plane is the one you build in.
    if (get().spectate && !focus?.drive) return
    if (get().plane === plane && get().anchorPlane === plane) return
    // The view follows the lined-up plane the way it follows the cursor: at
    // your own head, or in a focus view such as EARTH, the scene switches
    // planes now, so the planet, the landfalls, other avatars and everything
    // else of the other plane disappear at once. Only history keeps its own
    // plane, because each action there records the plane it was in.
    // In a free view the flip is the view's alone: the plane you have lined
    // up at your head is untouched, and RETURN puts the scene back in it.
    if (focus?.drive && get().exploreIndex === null) { set({ anchorPlane: plane, focus: { ...focus, plane } }); return }
    const next: Partial<CyberspaceState> = { plane, proof: IDLE_PROOF }
    if (get().exploreIndex === null) next.anchorPlane = plane
    set(next)
  },

  // The plane on show flips: yours at your head, the view's in a view.
  togglePlane: () => { const shown = get().atHead() ? get().plane : get().anchorPlane; get().setPlane(shown === 0 ? 1 : 0) },

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
      const { plan } = get()
      set({
        pendingTarget: null,
        plan: plan ? { ...plan, status: 'failed', message: msg.message, awaiting: null } : null,
        proof: {
          ...IDLE_PROOF,
          status: 'infeasible',
          elapsedMs: msg.elapsedMs,
          message: msg.message,
        },
      })
      return
    }

    await get().finishProof(msg)
  },

  finishProof: async (msg) => {
    if (msg.type !== 'done' || msg.id !== requestId) return

    // The chain as it stands now, not as it stood when the proof started:
    // relay events held back while it computed are folded first. What the
    // live feed brought already refuses, with no look at the relays needed.
    foldDeferred()
    const refusedBefore = whyNoMove(get().actions())
    if (refusedBefore) { refuseSigning(msg, refusedBefore, false); return }
    if (get().chainConflict) { refuseSigning(msg, CHOOSE_FIRST_MESSAGE, true); return }
    if (msg.prevEventId !== undefined && msg.prevEventId !== get().prevEventId) { headMovedUnder(isWalkProof(msg.id, msg.source)); return }
    // Then the head is confirmed immediately before signing, every time
    // (arkinox, 2026-10-08): a silent feed is no proof that nothing moved,
    // since a half-open socket is silent too.
    const unconfirmed = await confirmHead(() => set({ proof: { ...get().proof, message: HEAD_RETRYING_MESSAGE } }))
    if (unconfirmed === STALE_CONFIRMATION || msg.id !== requestId) return
    if (unconfirmed) { refuseSigning(msg, unconfirmed, true); return }
    // The live feed kept delivering while the look was out.
    foldDeferred()
    // A game entered meanwhile (a hop now would be a base action inside it,
    // spec §8.11.4 rule 3), a choice between two chains waiting, or a head
    // that moved: none of them is signed onto.
    const refusal = whyNoMove(get().actions())
    if (refusal) { refuseSigning(msg, refusal, false); return }
    if (get().chainConflict) { refuseSigning(msg, CHOOSE_FIRST_MESSAGE, true); return }
    if (msg.prevEventId !== undefined && msg.prevEventId !== get().prevEventId) { headMovedUnder(isWalkProof(msg.id, msg.source)); return }
    // Capture the chain we are extending. A cancel or a respawn bumps requestId,
    // so for this id events/head stay valid across the await; only `published`
    // moves under us as the publisher drains, so that is re-read after signing.
    const { pendingTarget, events, genesisId, prevEventId } = get()
    // A cloud proof is for its job's move, in the job's plane, whatever plane
    // is lined up now (a reload, or a flip between a declined signature and
    // RESUME, leaves the head's): it is signed there (review of #539).
    const plane: Plane = msg.move ? coordToXyz(hexToCoord(msg.move.toHex)).plane : get().plane
    // A proof is for one move, from here to its pending target. With none
    // (a cut or a cancel cleared it), nothing says where this proof goes, and
    // signing it at the current position would name a C its proof was never
    // made for (review of #539, F1).
    if (!pendingTarget) { refuseSigning(msg, NO_TARGET_MESSAGE, false); return }
    const newPosition = pendingTarget
    const head = events[events.length - 1]
    // `previous` is the chain's actual last event, whatever it is, and `c` is
    // where the identity stands, which after an action this client does not
    // recognize is the last recognized action's C, not that event's own
    // (spec §8.9 rule 2).
    const standing = chainHead(parsedChain(events))

    // The proof covers exactly position -> pendingTarget, and this event is
    // its receipt: the hop the next proof will bind to. Signed before the
    // position moves, so the chain and the avatar can never disagree.
    const link = {
      createdAt: nextCreatedAt(head),
      genesisId,
      previousId: prevEventId,
      prevCoordHex: standing?.coordHex ?? '',
      to: newPosition,
      plane,
      proofHash: msg.proofHash,
    }

    // A hop is signed as hop proof version 2 or not at all: a proof without
    // its mn and mp (an old worker's, or HOSAKA's old shape) is refused here,
    // before any signer is asked.
    let template: EventTemplate | null = null
    try {
      template = msg.mode === 'sidestep'
        ? (msg.sidestep ? sidestepTemplate({ ...link, ...msg.sidestep }) : null)
        : (msg.hop && msg.hop.sealHex === msg.proofHash ? hopTemplate({ ...link, mn: msg.hop.mnHex, mp: msg.hop.mpHex }) : null)
    } catch {
      // hopTemplate refuses a malformed tag rather than sign it.
      template = null
    }
    if (!template) { refuseSigning(msg, OLD_FORMAT_PROOF_MESSAGE, false); return }

    let event: NostrEvent
    try {
      event = await get().signEvent(template)
    } catch (err) {
      // The signer refused, or a bunker dropped mid-handshake: the move does not
      // commit, and the avatar stays where the last committed hop left it.
      if (msg.id !== requestId) return
      const reason = err instanceof Error ? err.message : String(err)
      const { plan } = get()
      if (plan) {
        // The proof is done and kept; RESUME asks for the signature again.
        set({
          plan: { ...plan, status: 'paused', message: `Signature declined: ${reason}`, awaiting: msg },
          proof: { ...get().proof, status: 'idle', progress: 1, elapsedMs: msg.elapsedMs },
        })
        return
      }
      set({
        pendingTarget: null,
        proof: {
          ...IDLE_PROOF,
          status: 'infeasible',
          elapsedMs: msg.elapsedMs,
          message: `Signing failed: ${reason}`,
        },
      })
      return
    }

    // A remote signer can take seconds; a cancel or respawn may have landed
    // while it was thinking. If so this receipt is for a chain that is gone.
    if (msg.id !== requestId) return
    // Every hop computed here is checked at Level 1 under its own signed id
    // before it is recorded or queued (spec 5.11; as cyberspace-mcp does), so
    // a hop whose proof does not hold for this very event is never kept or
    // sent. About 15 ms at h20. A cloud hop was checked before signing.
    if (msg.mode === 'hop' && msg.source !== 'cloud') {
      const failed = localHopFailures(event, standing?.coordHex ?? '', newPosition, plane, prevEventId)
      if (failed.length > 0) { refuseSigning(msg, `${LOCAL_CHECK_FAILED_MESSAGE} (${failed.join(', ')})`, false); return }
    }
    // A cloud move was verified for the move its job was bought for; the
    // event just signed must be that move: its c where the job started (x, y
    // and z; c's plane bit is the head's), its C exactly the job's
    // destination in the job's plane. A cheap equality, and a mismatch is
    // never kept or sent (review of #539).
    if (msg.source === 'cloud' && !cloudMoveMatches(event, msg.move)) { refuseSigning(msg, CLOUD_MOVE_MISMATCH_MESSAGE, false); return }
    // The live feed kept delivering while the signer thought. What arrived is
    // folded now, before the signed event joins the chain: if it moved the
    // head or entered a game, the signed event is discarded unpublished, as a
    // proof refused before signing would have been.
    foldDeferred()
    const refusedNow = whyNoMove(get().actions())
    if (refusedNow) { refuseSigning(msg, refusedNow, false); return }
    if (get().chainConflict) { refuseSigning(msg, CHOOSE_FIRST_MESSAGE, true); return }
    if (get().prevEventId !== prevEventId) { headMovedUnder(isWalkProof(msg.id, msg.source)); return }

    const now = get()
    const stats: ChainStats = {
      // Rides are counted from the events (rideStatsOf), untouched here.
      ...now.chain,
      hops: now.chain.hops + (msg.mode === 'hop' ? 1 : 0),
      sidesteps: now.chain.sidesteps + (msg.mode === 'sidestep' ? 1 : 0),
      totalOps: now.chain.totalOps + (msg.mode === 'hop' ? msg.totalOps : 0),
      totalHashes: now.chain.totalHashes + (msg.mode === 'sidestep' ? msg.totalOps : 0),
      // Cloud wall time is HOSAKA's, not this machine's compute.
      totalMs: now.chain.totalMs + (msg.source === 'cloud' ? 0 : msg.elapsedMs),
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
        terrainK: msg.terrainK,
        lca: msg.lca,
        totalOps: msg.totalOps,
        message: null,
        source: msg.source ?? 'local',
        costMsats: msg.costMsats ?? null,
        lookupId: msg.lookupId ?? null,
      },
      events: nextEvents,
      prevEventId: event.id,
      published: nextPublished,
      chain: stats,
      positionHistory: [...now.positionHistory, newPosition],
    })

    saveChain(nextEvents, nextPublished, stats)

    // What the hop unlocked: the region it crossed, held with the action that
    // bought it, so the chain can say which hops left a key behind.
    if (msg.type === 'done' && msg.mode === 'hop' && msg.region) {
      useSecrets.getState().hold([{
        lookupId: msg.region.lookupId,
        keyHex: msg.region.keyHex,
        height: Math.max(...msg.region.heights),
        heights: { x: msg.region.heights[0], y: msg.region.heights[1], z: msg.region.heights[2] },
        base: { x: msg.region.base[0], y: msg.region.base[1], z: msg.region.base[2] },
        plane,
        source: 'hop',
        eventId: event.id,
        at: Math.floor(Date.now() / 1000),
      }])
      scanHeldKey(msg.region.lookupId, msg.region.keyHex)
      // LOOT: the cubes around where it landed, up to what this machine computes.
      if (get().cloudPrefs.profile === 'loot') {
        const n = Math.max(...msg.region.heights)
        void holdDestinationCubes(newPosition, plane, destinationHeights(n, localKeyCeiling()), MAX_COMPUTE_HEIGHT, 'hop', event.id)
      }
    }

    // A route continues from where this step landed, or ends here.
    const { plan } = get()
    if (plan && plan.status === 'running') {
      const next = nextStep(newPosition, plan.target, plan.ceilings)
      if (!next) {
        // The route is complete; a funded cloud flow has nothing left to do.
        const cloud = get().cloud
        set({ plan: null, ...(cloud.status === 'paid' ? { cloud: { ...cloud, status: 'idle', message: null } } : {}) })
      } else {
        set({ plan: { ...plan, done: plan.done + 1, step: next, awaiting: null } })
        startPlanStep()
      }
    }
  },

  clearForkNotice: () => set({ forkNotice: null }),

  setLive: (live) => {
    if (live === get().live) return
    saveLive(live)
    // Going Local stops the publisher, and with it every retry, so an event
    // left reading 'sending' or 'failed' would be describing something that
    // is no longer happening: the panel would say RETRYING at a publisher
    // that is not going to try. Both are demoted to what they actually are
    // now, signed and held here, which is the same reason the last refusal is
    // cleared off the panel on the line below.
    const published = live
      ? get().published
      : Object.fromEntries(Object.entries(get().published)
        .map(([id, st]) => [id, st === 'ok' ? st : 'queued' as const]))
    set({ live, published, publishError: null })
  },

  publishNow: () => {
    if (!get().live) return
    set({ publishRequest: get().publishRequest + 1 })
  },

  respawn: async () => {
    // A deploy requiring newer chain rules refuses the new spawn's signing,
    // so ask first: before it, nothing may be cancelled or cleared, a kept
    // HOSAKA job above all, which is paid work (lib/versionGate.ts).
    const versionLook = lookBeforeMove()
    if (!(versionLook instanceof Promise ? await versionLook : versionLook)) {
      set({ proof: { ...IDLE_PROOF, status: 'infeasible', message: VERSION_BLOCKED_MESSAGE } })
      throw new Error(VERSION_BLOCKED_MESSAGE)
    }
    // A proof in flight was for a chain that is about to stop existing.
    if (get().proof.status === 'computing') {
      cancelProof()
      requestId++
    }
    // So was any cloud job, paid or not: its temporal binding names a head
    // that is about to stop being one.
    if (get().cloud.status !== 'idle' || get().cloud.job !== null) {
      stopCloud()
      requestId++
      clearCloudJob()
    }
    if (get().plan) set({ plan: null })
    const { events, held, selfCheck, identity } = get()
    const signer = currentSigner
    // A respawn is deliberate, but it is not a decision about a chain on the
    // relays nobody has seen yet. A held chain stays held through it; so does
    // a respawn from the provisional state while the check has not said
    // "none", for the same reason the first move holds (lib/chainHold.ts).
    const keepHeld = held || (events.length === 0 && !(selfCheck.pubkey === identity.pubkey && selfCheck.status === 'none'))
    let signed: PersistedChain
    try {
      signed = await freshSpawnAsync(signer, events[events.length - 1])
    } catch (err) {
      // Refused, timed out, or answered with a signature that does not
      // verify: nothing is respawned, and it says so where a hop's refusal
      // is said, as well as to whoever asked for the respawn.
      const reason = err instanceof Error ? err.message : String(err)
      if (get().identity.pubkey === identity.pubkey) set({ proof: { ...IDLE_PROOF, status: 'infeasible', message: `Signing failed: ${reason}` } })
      throw new Error(`signing failed: ${reason}`)
    }
    // A remote signer can wait minutes for an approval on a phone. If the
    // identity changed meanwhile, this spawn is the old identity's: nothing
    // of it may land in the store, which now holds someone else (final
    // review of #227). Compared by key, because signEvent may have rebuilt a
    // dead remote signer's channel and swapped in the rebuilt one for the
    // same identity.
    if (get().identity.pubkey !== identity.pubkey || currentSigner.pubkey !== signer.pubkey) {
      throw new Error('the identity changed while the respawn waited for its signature, so nothing was respawned')
    }
    const fresh = derive({ ...signed, held: keepHeld })
    // The old chain's signature check is about a chain that is gone: nothing
    // waits on it any more (review of #242), and whatever was waiting on it,
    // or on a look at the relays, ends without a word (STALE_CONFIRMATION).
    sigCheck = null
    chainEpoch++
    set({
      ...fresh,
      // A choice between two versions of the old chain is about a chain
      // that is gone too: left set, it refused every move until a reload
      // (review of #236, item 10).
      chainConflict: null,
      cursor: fresh.position,
      pendingTarget: null,
      proof: IDLE_PROOF,
      publishError: null,
      spentMsats: loadSpent(fresh.genesisId),
      respawns: addRespawn(get().identity.pubkey),
      cloud: { ...IDLE_CLOUD, limits: get().cloud.limits, provider: get().cloud.provider, balance: get().cloud.balance },
    })
    saveChain(fresh.events, fresh.published, fresh.chain, keepHeld)
  },

  respawnFromBrokenChain: async (forPubkey) => {
    // Confirmed for one identity: never carried out for another.
    if (forPubkey !== undefined && forPubkey !== get().identity.pubkey) throw new Error('the identity changed after this respawn was confirmed, so nothing was respawned')
    // A deploy requiring newer chain rules refuses the respawn (respawn
    // below): asked before the End of Chain entry is added for it.
    const versionLook = lookBeforeMove()
    if (!(versionLook instanceof Promise ? await versionLook : versionLook)) throw new Error(VERSION_BLOCKED_MESSAGE)
    const broken = firstBreak(get().actions())
    if (broken) {
      // With no valid event at all (an invalid spawn, Q7), the spawn row
      // names the entry, and it stands where the identity is frozen: the
      // spawn coordinate.
      const at = broken.lastValid ?? broken.action
      addRecentView({ input: at.coordHex, label: endOfChainLabel(at.id), plane: at.plane, pinned: true })
    }
    await get().respawn()
  },

  applySelfCheck: (pubkey, verdict) => {
    if (get().identity.pubkey !== pubkey) return
    const selfCheck: SelfCheck = verdict.status === 'unknown'
      ? { pubkey, status: 'unknown', cause: verdict.cause }
      : { pubkey, status: verdict.status }
    set({ selfCheck })
    if (verdict.status === 'found') {
      // A verified or provisional chain adopts it (§3.2, your other device);
      // a held one raises the prompt instead. adoptChain makes that call.
      get().adoptChain(verdict.events)
      return
    }
    if (verdict.status === 'none' && get().held && !get().chainConflict) {
      // The relays answered and there is no other chain: this one is the
      // identity's. Lifted silently, and from here it publishes as LIVE says.
      set({ held: false })
      const { events, published, chain } = get()
      saveChain(events, published, chain, false)
    }
  },

  resolveHeldConflict: (choice) => {
    const { chainConflict: conflict, events: local } = get()
    if (!conflict || conflict.kind !== 'held') return
    if (choice === 'local') {
      // Only offered when it would actually place you (the prompt checks the
      // same thing); a relay chain respawned after this one would still win.
      if (!localSupersedes(local, conflict.relayEvents)) return
      // The hold lifts and the answer is the deliberate act that opens the
      // gate, so while LIVE the whole chain goes out now. While LOCAL it
      // stays here like any other chain until LIVE and an action.
      set({ held: false, chainConflict: null, publishRequest: get().publishRequest + 1 })
      const { events, published, chain } = get()
      saveChain(events, published, chain, false)
      return
    }
    // Keep the relay chain: the held chain is deleted, which is the stored
    // chain being overwritten by the relay's, and you stand at its head.
    // Region keys found by the local hops stay in Secrets: a key is
    // knowledge, not chain state.
    if (get().proof.status === 'computing') cancelProof()
    requestId++
    const order = buildChain(conflict.relayEvents)
    if (order.length === 0) return
    const byId = new Map(conflict.relayEvents.map((e) => [e.id, e]))
    const chainEvents = order.map((a) => byId.get(a.id)).filter((e): e is NostrEvent => !!e)
    const d = derive({
      version: 2,
      events: chainEvents,
      published: chainEvents.map((e) => e.id),
      stats: statsFromChain(chainEvents, EMPTY_STATS),
      held: false,
    })
    set({
      ...d,
      cursor: d.position,
      pendingTarget: null,
      plan: null,
      proof: IDLE_PROOF,
      transit: null,
      spectate: null,
      focus: null,
      chainConflict: null,
      forkNotice: null,
      spentMsats: loadSpent(d.genesisId),
    })
    saveChain(d.events, d.published, d.chain, false)
  },

  resolveBranchConflict: (choice) => {
    const { chainConflict: conflict, events, published } = get()
    if (!conflict || conflict.kind !== 'branch') return
    const div = findDivergence(events, published, conflict.relayEvents)
    if (!div) { set({ chainConflict: null }); return }
    // Publishing this device's side would put a fork on the relays, and a
    // fork ends the whole chain for every reader (arkinox, 2026-10-08), so
    // "mine" is never carried out: the prompt stays until the relays'
    // version is kept.
    if (choice === 'mine') return
    // Keep the relays' version: the shared part, then the relays' branch.
    // This device's moves after the fork are dropped; region keys they found
    // stay in Secrets, as with any chain that leaves the store.
    if (get().proof.status === 'computing') cancelProof()
    requestId++
    const { events: next, onRelay } = relayVersion(events, conflict.relayEvents, div)
    if (next.length === 0) return
    const okIds = new Set([...onRelay, ...events.filter((e) => published[e.id] === 'ok').map((e) => e.id)])
    const d = derive({
      version: 2,
      events: next,
      published: next.filter((e) => okIds.has(e.id)).map((e) => e.id),
      stats: statsFromChain(next, get().chain),
      held: false,
    })
    set({
      ...d,
      cursor: d.position,
      pendingTarget: null,
      plan: null,
      proof: IDLE_PROOF,
      transit: null,
      chainConflict: null,
      forkNotice: null,
    })
    saveChain(d.events, d.published, d.chain, false)
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

  beginSpectate: (pubkey, keepView = false) => {
    const spawn = spawnOf(pubkey)
    const { view, viewHistory, spectate } = get()
    // BUILD mode (arkinox, 2026-10-08): spectating does not end it. The
    // driven view is the build cursor, so it stays, and is aimed at them, at
    // their spawn until the chain arrives (setSpectateChain). The angle you
    // were building from is kept, and nothing is put back at the end.
    if (keepView && get().focus?.drive) {
      set({
        spectate: { pubkey, npub: nip19.npubEncode(pubkey), events: [], actions: [], lastActive: null, status: 'loading', returnView: spectate?.returnView ?? view.clone() },
        exploreIndex: null,
      })
      get().aimView(spawn.position, spawn.plane)
      return
    }
    // The view you arrive with is the black sun orientation (section 11.3),
    // the same the C key gives, at the standard distance the rig frames from:
    // a stranger's neighborhood seen from whatever angle you had orbited to
    // was a view of nothing in particular. What you had is kept and put back
    // when spectation ends; switching from one avatar to another keeps the
    // first one's return view.
    set({
      spectate: { pubkey, npub: nip19.npubEncode(pubkey), events: [], actions: [], lastActive: null, status: 'loading', returnView: spectate?.returnView ?? view.clone() },
      exploreIndex: null,
      // A standing focus (a shard, EARTH, a viewed stop) would hide the
      // avatar and keep the rig on the old point: spectating replaces it.
      focus: null,
      anchor: spawn.position,
      anchorPlane: spawn.plane,
      view: canonicalQuaternion(),
      viewHistory: [...viewHistory, view.clone()],
    })
  },

  setSpectateChain: (pubkey, events, status) => {
    const prev = get().spectate
    if (!prev || prev.pubkey !== pubkey) return
    const actions = buildChain(events, pubkey)
    const head = actions[actions.length - 1]
    // A chain that grew under an explorer parked in its history leaves the
    // explorer where it was; one that was replaced (a respawn) snaps to head.
    const keep = get().exploreIndex !== null
      && get().exploreIndex! < actions.length
      && actions[get().exploreIndex!]?.id === prev.actions[get().exploreIndex!]?.id
    const at = keep ? actions[get().exploreIndex!] : head
    const spawn = spawnOf(pubkey)
    // Under a driven view (BUILD mode) the scene stays on the build cursor,
    // which the chain does not move, with one exception: the first chain to
    // arrive takes the cursor from their spawn to their head, unless you
    // already moved it. After that their new actions move their avatar, not
    // your cursor.
    if (get().focus?.drive) {
      set({
        spectate: { ...prev, events, actions, lastActive: head?.createdAt ?? null, status: status ?? (head ? 'live' : 'empty') },
        exploreIndex: null,
      })
      const s = get()
      if (prev.actions.length === 0 && head && samePosition(s.cursor, spawn.position) && s.anchorPlane === spawn.plane) s.aimView(head.position, head.plane)
      return
    }
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
    // Back to your own head, in the plane you have lined up there, looking
    // the way you were looking before.
    const { position, plane, spectate } = get()
    // Under a driven view (BUILD mode) the view, its cursor and its angle
    // stay where they are: ending spectation is not leaving the build.
    if (get().focus?.drive) { set({ spectate: null, exploreIndex: null }); return }
    set({ spectate: null, exploreIndex: null, anchor: position, anchorPlane: plane, ...(spectate ? { view: spectate.returnView } : {}) })
  },

  aimView: (position, plane) => {
    const focus = get().focus
    if (!focus?.drive) return
    const next = { ...position }
    set({ cursor: next, ...(plane !== get().anchorPlane ? { anchorPlane: plane, focus: { ...focus, plane } } : {}) })
    rideView(next)
  },

  viewHere: () => { if (get().atHead()) get().driveHere(VIEW_FOCUS_LABEL) },

  viewing: () => get().focus?.drive === true && get().focus?.label === VIEW_FOCUS_LABEL && get().exploreIndex === null,

  driveHere: (label) => {
    const { anchor, anchorPlane, focus, scaleExp, focusReturnScale } = get()
    set({
      focus: { position: { ...anchor }, plane: anchorPlane, label, drive: true },
      cursor: { ...anchor },
      exploreIndex: null,
      focusReturnScale: focus === null ? scaleExp : focusReturnScale,
    })
  },

  pin: null,

  dropPin: (position, label, scaleExp) => set({
    pin: { position: { ...position }, plane: 0, scaleExp: scaleExp ?? get().scaleExp, label },
  }),

  clearPin: () => set({ pin: null }),

  viewPin: () => {
    const { pin } = get()
    if (!pin) return
    // Driven, like a VIEW and unlike a block: the cursor comes with you, so a
    // deploy started from there lands at the pin rather than at your head:
    // BUILD mode starts its build cursor where you are looking (useBuilder,
    // ruling A, 2026-10-07). Standing at the venue is not required to hide
    // something in it.
    get().focusOn(pin.position, pin.plane, pin.label, pin.scaleExp, true)
  },

  focusOn: (position, plane, label, scaleExp, drive = false) => {
    const next: Partial<CyberspaceState> = {
      focus: { position: { ...position }, plane, label, drive },
      // A free view brings the cursor along, so the pad moves it there and a
      // message or a shard placed from the view lands there, not at your head.
      ...(drive ? { cursor: { ...position } } : {}),
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

  focusItem: (position, plane, label, scaleExp) => {
    get().focusOn(position, plane, label, scaleExp)
    const focus = get().focus
    if (focus) set({ focus: { ...focus, item: true } })
  },

  clearFocus: (keepScale = false) => {
    // Home is your position in the plane you have lined up, which is what
    // the scene showed before the focus began.
    const { position, plane, focusReturnScale, scaleExp, focus, spectate } = get()
    // A driven view kept through a spectation (BUILD mode) that ends while
    // the spectation stands goes back to watching them, on their head.
    const watched = spectate ? (spectate.actions[spectate.actions.length - 1] ?? spawnOf(spectate.pubkey)) : null
    set({
      focus: null,
      // RETURN ends the look, and the pin was the look's subject.
      pin: null,
      anchor: watched ? { ...watched.position } : position,
      anchorPlane: watched ? watched.plane : plane,
      // A cursor that went out with the view comes home with it.
      ...(focus?.drive ? { cursor: { ...position } } : {}),
      // Back at the zoom the user left, not whatever the viewed thing chose.
      scaleExp: keepScale ? scaleExp : focusReturnScale ?? scaleExp,
      focusReturnScale: null,
    })
  },

  boardHyperspace: async () => {
    const { events, genesisId, prevEventId, position, proof, transit } = get()
    if (transit !== null || proof.status === 'computing') return
    // Your own chain, at its head: never from history or a spectation. A view
    // (a block, EARTH, a /C/ link, VIEW) does not stand in the way: boarding
    // acts on the chain head, never on the place on screen, and its coordinate
    // below comes from the chain (arkinox, 2026-10-15: "the board button
    // should always be available if I have a destination set").
    if (get().exploreIndex !== null || get().spectate !== null) return
    // A provisional identity has no chain to board from; move once first.
    if (events.length === 0 || !genesisId || !prevEventId) return
    // A game holds the avatar (GAME_HOLDS_MESSAGE): boarding is a base action.
    // The Hyperspace panel withholds BOARD and says why; this is the backstop.
    if (whyNoMove(get().actions())) return
    // The head is confirmed before the boarding is signed (confirmHead).
    const refusal = await confirmHead(() => set({ proof: { ...IDLE_PROOF, message: HEAD_RETRYING_MESSAGE } }))
    if (refusal === STALE_CONFIRMATION) return
    if (refusal) { set({ proof: { ...IDLE_PROOF, status: 'infeasible', message: refusal } }); return }
    if (get().prevEventId !== prevEventId) { set({ proof: { ...IDLE_PROOF, status: 'infeasible', message: headMovedWords(get().events, 'Board again from where you are now.') } }); return }
    if (get().proof.message === HEAD_RETRYING_MESSAGE) set({ proof: IDLE_PROOF })
    const head = events[events.length - 1]
    // Where the chain says you stand, plane bit included: the last recognized
    // action's C. Not `position` with `plane`: `plane` is the plane lined up
    // for the next move (viewing EARTH lines up dataspace), and a boarding
    // built from it at a port in ideaspace named the right x, y and z in the
    // wrong plane, so its c no longer matched the C before it and the chain
    // was invalid from there (2026-10-06, a published chain on the relay).
    const here = chainHead(parsedChain(events))?.coordHex
    if (!here) return
    const proofHash = computeEnterProof(hexToCoord(here), prevEventId)
    const template = enterHyperspaceTemplate({
      createdAt: nextCreatedAt(head),
      genesisId,
      previousId: prevEventId,
      coordHex: here,
      proofHash,
    })
    let event: NostrEvent
    try {
      event = await get().signEvent(template)
    } catch (err) {
      // The signer refused, or answered with a signature that does not
      // verify: no boarding, said where a hop's refusal is said. Unless the
      // chain moved on meanwhile, when this refusal is about nothing current.
      if (get().prevEventId !== prevEventId) return
      set({ proof: { ...IDLE_PROOF, status: 'infeasible', message: `Signing failed: ${err instanceof Error ? err.message : String(err)}` } })
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
      transit: { stage: 'boarded', enterEventId: event.id, enterCoordHex: here },
    })
    saveChain(nextEvents, published, get().chain)
  },

  confirmHeadNow: async () => {
    const refusal = await confirmHead(() => set({ proof: { ...IDLE_PROOF, message: HEAD_RETRYING_MESSAGE } }))
    if (refusal === STALE_CONFIRMATION) return refusal
    if (get().proof.message === HEAD_RETRYING_MESSAGE) set({ proof: IDLE_PROOF })
    return refusal
  },

  completeRide: async (ride) => {
    if (!get().genesisId || !get().prevEventId) return
    // The head is confirmed before the ride is signed (confirmHead). The
    // ride's proof is bound to the head it started from, so a head that the
    // confirmation moved is refused below like any other.
    const refusal = await confirmHead(() => set({ proof: { ...IDLE_PROOF, message: HEAD_RETRYING_MESSAGE } }))
    if (refusal === STALE_CONFIRMATION) return
    if (get().proof.message === HEAD_RETRYING_MESSAGE) set({ proof: IDLE_PROOF })
    if (refusal) throw new Error(refusal)
    const { events, genesisId, prevEventId, transit } = get()
    if (!genesisId || !prevEventId) return
    const head = events[events.length - 1]
    if (!head) return
    // A game holds the avatar, or the chain is broken (whyNoMove): a ride is a base action.
    const noRide = whyNoMove(parsedChain(events))
    if (noRide) throw new Error(noRide)
    // From a boarding, or chained from the stop the last ride reached (§4.3):
    // either way the head is on the line, and `c` is its coordinate.
    const line = lineStateOf(parsedChain(events))
    if (!transit && !line) return
    // Never a zero-length ride (arkinox, 2026-10-07): the backstop behind
    // startRide, which refuses one before any work is done.
    const zero = zeroLengthRideRefusal(ride.fromHeight, ride.toHeight, line?.fromHeight != null)
    if (zero) throw new Error(zero)
    // Every leaf was seeded by the head the ride started from (§5.3). Signed
    // under any other `previous` it would be a ride whose every leaf is wrong,
    // so a head that moved while the proof ran (a fork adopted from another
    // device) refuses the ride instead of publishing it.
    if (ride.previousId !== prevEventId) {
      throw new Error('Your chain moved while the ride was computing, and the proof is bound to where it started. Ride again from here.')
    }
    // Where the identity stands: the last recognized action's C, so a skipped
    // action between the boarding and the ride does not move `c` (spec §8.9).
    const prevCoordHex = chainHead(parsedChain(events))?.coordHex ?? transit?.enterCoordHex ?? line?.coordHex
    if (!prevCoordHex) return
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
      mnHex: ride.mnHex,
    })
    let event: NostrEvent
    try {
      event = await get().signEvent(template)
    } catch (err) {
      // The signer refused, or answered with a signature that does not
      // verify: no ride. Thrown with the words a hop's refusal uses, so the
      // Hyperspace panel shows it where the ride ran and keeps the
      // destination, instead of clearing it as if the ride had gone.
      throw new Error(`Signing failed: ${err instanceof Error ? err.message : String(err)}`)
    }
    if (get().prevEventId !== prevEventId) return
    const dest = coordToXyz(hexToCoord(ride.toCoordHex))
    const newPosition: Position = { x: dest.x, y: dest.y, z: dest.z }
    const published: Record<string, PublishStatus> = { ...get().published, [event.id]: 'queued' }
    const nextEvents = [...get().events, event]
    const chain: ChainStats = { ...get().chain, ...rideStatsOf(buildChain(nextEvents)) }
    set({
      events: nextEvents,
      prevEventId: event.id,
      published,
      chain,
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
    const me = cur.identity.pubkey
    const mine = incoming.filter((e) => e.pubkey === me)
    if (mine.length === 0) return
    // The relay pool checked these signatures on receipt (relay.ts); remember
    // them, so the chain they are saved into is not checked again when it is
    // read back this session.
    for (const e of mine) if ((e as unknown as VerifiedEvent)[verifiedSymbol] === true) verifiedSigs.add(`${e.id}:${e.sig}`)
    // The load is still reading the rest of the saved chain from IndexedDB:
    // compared now, the relays' copy of actions this device signed and saved
    // would be counted as another device's (hydrateChain).
    if (hydration?.pubkey === me) {
      awaitingHydration = awaitingHydration.concat(mine)
      return
    }
    // A HELD chain never adopts. It was started before the relays could say
    // whether this identity had a chain, so a chain arriving now is exactly
    // the one it may rival, and "newest spawn wins" would pick the local one
    // (signed just now) without asking. The choice goes to the person
    // instead (arkinox, 2026-10-01). Ahead of the computing guard below,
    // because folding into the prompt never touches the head, and an event
    // the live subscription delivers during a proof is not delivered twice.
    if (cur.held) {
      const prev = cur.chainConflict?.kind === 'held' ? cur.chainConflict : null
      const conflict = foldHeldConflict(prev, mine, cur.events, Date.now())
      if (conflict !== prev) set({ chainConflict: conflict })
      return
    }
    // A diverged-branch choice is pending: what arrives now joins the relays'
    // side of it, and nothing is folded into the chain until it is answered.
    if (cur.chainConflict?.kind === 'branch') {
      const conflict = foldBranchConflict(cur.chainConflict, mine, cur.events, cur.published, Date.now())
      if (conflict && conflict !== cur.chainConflict) set({ chainConflict: conflict })
      return
    }
    // A local commit owns the head while it computes; a relay echo must not
    // race it. What arrives is held back, not dropped (foldDeferred). But a
    // move another device made from this head dooms the proof, which is bound
    // to the head it started from: it is stopped now, not finished and then
    // refused (arkinox, 2026-10-08: the live feed is the early warning).
    if (cur.proof.status === 'computing' && !folding) {
      deferred = deferred.concat(mine)
      const have = new Set(cur.events.map((e) => e.id))
      const fresh = mine.filter((e) => !have.has(e.id))
      // A HOSAKA job has its own flow and its own cancel (cancelCloud); its
      // result is refused at signing like any other (finishProof).
      if (fresh.length === 0 || cur.cloud.status !== 'idle') return
      const order = buildChain(cur.events.concat(fresh), me)
      const head = order[order.length - 1]
      if (order.length > 0 && head.id === cur.prevEventId && order[0].fork === undefined) return
      stopForNewHead(cur.prevEventId)
      return
    }
    // Nothing new: the usual answer, since every move's confirmation asks the
    // relays for the chain from the newest event they hold, and gets back
    // events this device already has. Everything below would come to nothing
    // (findDivergence skips what is held, and the merge is the chain in hand),
    // after rebuilding the whole chain twice: about 0.35 s per fold on a
    // 1,300-action chain, twice per move (arkinox, 2026-10-30: a WALK step
    // took 2 to 6 seconds). Only when the chain in hand reads the way a fold
    // would leave it, which parsedChain answers from its memo.
    const inHand = new Set(cur.events.map((e) => e.id))
    if (mine.every((e) => inHand.has(e.id)) && settledChain(cur.events, cur.prevEventId, me)) return
    // This device's unpublished moves fork against moves the relays already
    // hold (another device of yours moved on while this one was LOCAL or
    // offline). Folding now would decide in silence, and publishing this
    // device's side would fork the chain on the relays, which ends it for
    // every reader (arkinox, 2026-10-08); nothing happens until the person
    // keeps the relays' version (lib/branchConflict.ts; arkinox, 2026-10-01).
    const div = findDivergence(cur.events, cur.published, mine)
    if (div) {
      set({ chainConflict: { kind: 'branch', forkId: div.forkId, relayEvents: mine, at: Date.now() } })
      useChainUi.getState().setPromptAside(false)
      return
    }
    const seen = inHand
    const merged = cur.events.concat(mine.filter((e) => !seen.has(e.id)))
    // buildChain is §8.7.3: the newest spawn wins, then follow the links. So a
    // newer chain from another machine supersedes ours; our own echoed events
    // fold in as a no-op. It returns parsed actions in order; map back to the
    // raw events the store actually holds.
    const order = buildChain(merged, me)
    if (order.length === 0) return
    // A fork on the relays ends the whole chain (arkinox, 2026-10-08): both
    // branches are kept, so the chain shows dead at the spawn coordinate with
    // the branches named, nothing of either is dropped, and no move can be
    // signed onto it (whyNoMove) until a respawn.
    const forked = order[0].fork !== undefined
    if (forked && merged.length === cur.events.length) return
    const head = order[order.length - 1]
    if (!forked && head.id === cur.prevEventId && order.length === cur.events.length) return
    const byId = new Map(merged.map((e) => [e.id, e]))
    const chainEvents = forked ? merged : order.map((a) => byId.get(a.id)).filter((e): e is NostrEvent => !!e)
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
    // What this fold cost and what it brought. Dropped actions are this
    // device's own work the fold left out of the chain (a newer spawn took
    // over); adopted ones are another device's, and are why the avatar just
    // moved on its own.
    const kept = new Set(chainEvents.map((e) => e.id))
    const lost = cur.events.filter((e) => !kept.has(e.id))
    const dropped = lost.length
    const adopted = chainEvents.filter((e) => !seen.has(e.id)).length
    // A different genesis is a newer spawn taking over.
    const replaced = cur.events.length > 0 && d.genesisId !== cur.genesisId
    // A loss stays reported until it is read. The other device's events
    // arrive one fold at a time, so the fold that replaced your chain is
    // usually followed at once by one that only brings the rest of it; that
    // one must add to the unread notice, not replace it. A notice that only
    // explained an adoption is replaced as before.
    const prior = cur.forkNotice
    const unreadLoss = prior !== null && (prior.dropped > 0 || prior.replaced)
    const notice = forked
      ? null
      : dropped > 0 || adopted > 0
      ? unreadLoss
        ? { adopted: prior.adopted + adopted, dropped: prior.dropped + dropped, replaced: prior.replaced || replaced, at: Date.now() }
        : { adopted, dropped, replaced, at: Date.now() }
      : null
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
      // In WALK the cursor is the walk's predicted head (store/useWalk.ts),
      // which a fold must not pull back to the proven one: the eye would
      // glide back a step. A fold that moves the head stops the walk itself.
      ...(following ? { anchor: d.position, anchorPlane: d.headPlane, ...(cur.walking ? {} : { cursor: d.position }), exploreIndex: null } : {}),
      // A drop is kept until it is read; an adoption is just an explanation
      // for the movement and fades on its own. A fold that changed nothing
      // says nothing.
      ...(notice ? { forkNotice: notice } : {}),
    })
    saveChain(d.events, d.published, saved.stats)
  },

  setTargetChain: (pubkey, events, status) => {
    const { targets } = get()
    const t = targets[pubkey]
    if (!t) return
    const targetChain = buildChain(events, pubkey)
    const head = targetChain[targetChain.length - 1]
    const spawn = spawnOf(pubkey)
    set({
      targets: {
        ...targets,
        [pubkey]: {
          ...t,
          position: head?.position ?? spawn.position,
          plane: head?.plane ?? spawn.plane,
          lastActive: head?.createdAt ?? null,
          status: head ? (status === 'partial' ? 'partial' : 'live') : status ?? 'spawn',
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
    if (currentSigner.pubkey === pref.pubkey && currentSigner.reconnect) {
      // The stand-in: its own onReady decides whether it is still wanted. Its
      // failure is only news while it is still the identity in use.
      const switches = switchCount
      try { await currentSigner.reconnect() }
      catch (err) { if (switches === switchCount) set({ loginError: `Could not reconnect ${pref.kind}: ${err instanceof Error ? err.message : String(err)}` }) }
    } else {
      await login(() => signerFromPref(pref), `Could not reconnect ${pref.kind}: `)
    }
  },
  useNewKey: async () => {
    const signer = randomSigner()
    markMinted(signer.pubkey)
    await switchTo(signer)
  },
  exportKey: (password, again) => exportNcryptsec(currentSigner.secretKey, password, again),
  decryptSealed: async (senderPubkey, payload) => {
    const signer = currentSigner
    const open = signer.nip44Decrypt
    if (!open) throw new Error(NIP44_UNAVAILABLE)
    let plain: string
    try { plain = await open(senderPubkey, payload) }
    catch (err) { throw await decryptRefusal(signer, err) }
    if (signer.kind !== 'local') signerHome(signer)
    return plain
  },
  encryptSealed: (recipientPubkey, plaintext) => {
    const seal = currentSigner.nip44Encrypt
    return seal ? seal(recipientPubkey, plaintext) : Promise.reject(new Error(NIP44_ENCRYPT_UNAVAILABLE))
  },
  selfCrypto: () => {
    const signer = currentSigner
    const me = signer.pubkey
    const open = (f: Signer['nip44Decrypt']): ((payload: string) => Promise<string>) | undefined => f && (async (payload) => {
      let plain: string
      try { plain = await f(me, payload) }
      catch (err) { throw await decryptRefusal(signer, err) }
      if (signer.kind !== 'local') signerHome(signer)
      return plain
    })
    const seal = (f: Signer['nip44Encrypt']): ((plaintext: string) => Promise<string>) | undefined => f && ((plaintext) => f(me, plaintext))
    return {
      nip44Decrypt: open(signer.nip44Decrypt),
      nip44Encrypt: seal(signer.nip44Encrypt),
      nip04Decrypt: open(signer.nip04Decrypt),
      nip04Encrypt: seal(signer.nip04Encrypt),
    }
  },
  useNsec: async (nsec) => { await login(() => signerFromNsec(nsec)) },
  useNcryptsec: async (ncryptsec, password) => { await login(() => signerFromNcryptsec(ncryptsec, password)) },
  useLogin: async (credential, password = '') => {
    const kind = loginCredentialKind(credential)
    await login(async () => {
      if (kind === 'nsec') return signerFromNsec(credential)
      if (kind === 'ncryptsec') {
        if (!password) throw new Error('Enter the password for this ncryptsec.')
        return signerFromNcryptsec(credential, password)
      }
      if (kind === 'bunker') return nip46Signer(credential)
      throw new Error('Paste an nsec, ncryptsec, or bunker:// URI.')
    })
  },
  useExtension: async () => { await login(() => nip07Signer()) },
  useBunker: async (uri) => { await login(() => nip46Signer(uri)) },
  useNostrConnect: async (session, signal, onConnected) => {
    // Left the QR screen while the signer was answering: no switch, and no
    // error for a screen that is no longer there.
    await login(async () => {
      const signer = await session.connect(signal, onConnected)
      if (signal?.aborted) { await signer.close?.(); throw new Error('left the QR screen') }
      return signer
    }, '', () => signal?.aborted === true)
  },
  clearLoginError: () => set({ loginError: null }),

  cloud: IDLE_CLOUD,
  cloudPrefs: loadCloudPrefs(),
  moveMode: loadMoveMode(),
  showSecrets: loadShowSecrets(),
  showTrail: loadShowTrail(),

  approveCloud: () => {
    const { cloud } = get()
    if (cloud.status !== 'confirm' || !cloud.quote) return
    // The estimate modal stays up with PAY locked until the invoice (or the
    // funded route) takes over.
    set({ cloud: { ...cloud, status: 'funding', message: null } })
    void fundRoute(cloud.quote.costMsats, requestId)
  },

  noteBalance: (msats) => {
    set({ cloud: { ...get().cloud, balance: saveBalance(get().identity.pubkey, msats), balanceError: null } })
  },

  ensureBalance: () => {
    const { cloud, identity } = get()
    if (cloud.balance !== null) return
    const known = loadBalance(identity.pubkey)
    if (known) set({ cloud: { ...cloud, balance: known } })
  },

  /**
   * Put sats on the HOSAKA balance, with no movement waiting on them.
   *
   * The route's own funding tops up as much as one route needs and no more,
   * which is the right shape when a hop is waiting but leaves no way to fill
   * the balance in advance. This is that way: a deposit for the amount asked,
   * the invoice on screen through the same modal a route uses, and the balance
   * refreshed the moment the node reports it settled. Nothing else waits on
   * it, so cancelling costs nothing but the invoice.
   */
  topUp: async (sats) => {
    const { cloud, cloudPrefs, plan } = get()
    // A route in flight owns the cloud flow and its invoice; two invoices at
    // once would fight over the same modal and the same saved deposit.
    if (plan !== null || (cloud.status !== 'idle' && cloud.status !== 'error')) {
      set({ cloud: { ...cloud, balanceError: 'Finish or cancel the move in progress first.' } })
      return
    }
    const msats = Math.max(0, Math.round(sats)) * 1000
    const min = cloud.limits?.deposit_min_msats ?? 1000
    const max = cloud.limits?.deposit_max_msats ?? Number.MAX_SAFE_INTEGER
    if (msats < min || msats > max) {
      set({ cloud: { ...cloud, balanceError: `HOSAKA takes between ${satsOf(min)} and ${satsOf(max)} sats at a time.` } })
      return
    }

    const client = cloudClient(cloudPrefs.apiUrl)
    stopCloud()
    const id = ++requestId
    const abort = new AbortController()
    const waker = createWaker()
    cloudAbort = abort
    cloudWaker = waker
    try {
      set({ cloud: { ...get().cloud, status: 'funding', balanceError: null, message: currentSigner.kind === 'local' ? 'Asking HOSAKA for an invoice.' : 'Waiting for your signer to approve the request.' } })
      const dep = await client.deposit(msats, abort.signal)
      if (id !== requestId) return
      const invoice = invoiceOf(dep)
      // On disk before the invoice is on screen: a reload after paying claims it.
      saveCloudDeposit({ depositId: dep.deposit_id, pubkey: get().identity.pubkey, amountMsats: msats, expiresAt: invoice.expiresAt, bolt11: invoice.bolt11 })
      set({ cloud: { ...get().cloud, status: 'awaiting_payment', invoice, invoiceOpen: true, message: null, checking: false, lastCheck: null } })

      const settled = await client.waitForDeposit(dep.deposit_id, {
        signal: abort.signal,
        expiresAt: invoice.expiresAt,
        intervalMs: claimIntervalFor(currentSigner.kind),
        waker,
        onPoll: (d) => { if (id === requestId) set({ cloud: { ...get().cloud, checking: false, lastCheck: { at: Date.now(), status: d.status } } }) },
        onPollError: () => { if (id === requestId) set({ cloud: { ...get().cloud, checking: false } }) },
      })
      if (typeof settled.balance_msats === 'number') get().noteBalance(settled.balance_msats)
      if (id !== requestId) return
      clearCloudDeposit()
      if (settled.status !== 'settled') {
        set({ cloud: { ...get().cloud, status: 'idle', invoice: null, invoiceOpen: false, message: null, balanceError: 'The invoice expired unpaid. Nothing was charged.' } })
        return
      }
      set({ cloud: { ...get().cloud, status: 'idle', invoice: null, invoiceOpen: false, message: null, credited: { msats, at: Date.now() } } })
      // The node's own figure is authoritative, but ask anyway: it settles
      // what the panel shows without waiting for the next reason to look.
      void get().refreshBalance()
    } catch (err) {
      if (id !== requestId || abort.signal.aborted) return
      clearCloudDeposit()
      set({ cloud: { ...get().cloud, status: 'idle', invoice: null, invoiceOpen: false, message: null, balanceError: describeCloudError(err) } })
    } finally {
      if (cloudAbort === abort) { cloudAbort = null; cloudWaker = null }
    }
  },

  buyRegionKey: async (at, plane, height) => {
    const { cloud, cloudPrefs, plan } = get()
    if (cloudPrefs.mode === 'off') return { ok: false, error: 'Cloud compute is off in the Cloud compute panel.' }
    // A route in flight owns the cloud flow and its invoice.
    if (plan !== null || (cloud.status !== 'idle' && cloud.status !== 'error')) {
      return { ok: false, error: 'Finish or cancel the move in progress first.' }
    }
    const client = cloudClient(cloudPrefs.apiUrl)
    stopCloud()
    const id = ++requestId
    const abort = new AbortController()
    const waker = createWaker()
    cloudAbort = abort
    cloudWaker = waker
    const idle = { status: 'idle' as const, invoice: null, invoiceOpen: false, job: null, progress: null, message: null }
    try {
      set({ cloud: { ...get().cloud, status: 'quoting', invoice: null, invoiceOpen: false, job: null, progress: null, message: currentSigner.kind === 'local' ? 'Asking HOSAKA for the key.' : 'Waiting for your signer to approve the HOSAKA request.' } })
      const job = await client.submitRegionKey(at, height, abort.signal)
      if (id !== requestId) return { ok: false, error: 'Superseded by another cloud job.' }
      if (typeof job.new_balance_msats === 'number') get().noteBalance(job.new_balance_msats)
      if (!job.poll_token) { set({ cloud: { ...get().cloud, ...idle } }); return { ok: false, error: 'HOSAKA took the job but gave no way to follow it.' } }
      const paying = job.payment_required === true && job.deposit !== undefined
      if (job.payment_required === true && !paying) {
        set({ cloud: { ...get().cloud, ...idle } })
        return { ok: false, error: `HOSAKA wants ${Math.ceil((job.amount_due_msats ?? job.cost_msats) / 1000)} sats more than your balance holds and issued no invoice.` }
      }
      // Not persisted: a reload mid-purchase loses the job, not the money. A
      // paid invoice lands on the balance, and the next attempt for the same
      // cube and height carries the same idempotency key (lib/hosaka.ts), so a
      // provider that honors keys hands back this job instead of selling it twice.
      const record: PendingCloudJob = {
        version: 1, jobId: job.id, pollToken: job.poll_token, action: 'region_key', pubkey: get().identity.pubkey,
        from: wirePosition(at), to: wirePosition(at), plane, prevEventId: get().prevEventId ?? '',
        costMsats: typeof job.cost_msats === 'number' ? job.cost_msats : 0, createdAt: Date.now(),
        stage: paying ? 'awaiting_payment' : 'computing', deposit: paying && job.deposit ? invoiceOf(job.deposit) : null,
        estSeconds: regionKeyQuote(height, get().cloud.provider)?.seconds ?? undefined,
      }
      set({ cloud: { ...get().cloud, job: record, message: null } })
      const outcome = await driveCloudJob(client, record, {
        onRecord: (r) => { if (id === requestId) set({ cloud: { ...get().cloud, job: r } }) },
        onDepositPoll: (d) => { if (id === requestId) set({ cloud: { ...get().cloud, checking: false, lastCheck: { at: Date.now(), status: d.status } } }) },
        onDepositPollError: () => { if (id === requestId) set({ cloud: { ...get().cloud, checking: false } }) },
        onStage: (stage, d) => {
          if (id !== requestId) return
          const c = get().cloud
          set({ cloud: { ...c, status: stage, invoice: d.invoice === undefined ? c.invoice : d.invoice, invoiceOpen: stage === 'awaiting_payment' ? (d.invoice ? true : c.invoiceOpen) : false, progress: d.progress === undefined ? c.progress : d.progress, message: d.message === undefined ? c.message : d.message } })
        },
      }, abort.signal, waker)
      if (id !== requestId) return { ok: false, error: 'Superseded by another cloud job.' }
      const done = outcome.job
      if (typeof done.new_balance_msats === 'number') get().noteBalance(done.new_balance_msats)
      set({ cloud: { ...get().cloud, ...idle } })
      if (done.status !== 'completed' || !done.result) return { ok: false, error: done.error ? `HOSAKA could not compute it: ${done.error}` : 'HOSAKA could not compute it.' }
      recordJobExperience(outcome.record, height)
      const r = done.result as HosakaRegionKeyResult
      if (!r.secret_key || !r.lookup_id) return { ok: false, error: 'HOSAKA returned no key.' }
      return { ok: true, result: r }
    } catch (err) {
      if (abort.signal.aborted) { set({ cloud: { ...get().cloud, ...idle } }); return { ok: false, error: 'Cancelled.' } }
      if (id === requestId) set({ cloud: { ...get().cloud, ...idle } })
      return { ok: false, error: describeCloudError(err) }
    } finally {
      if (cloudAbort === abort) { cloudAbort = null; cloudWaker = null }
    }
  },

  rideViaHosaka: async (ask) => {
    // Before anything is paid for: a deploy requiring newer chain rules
    // refuses the ride below (whyNoMove), as for a commit. No wait when the
    // answer is in hand.
    const versionLook = lookBeforeMove()
    if (versionLook instanceof Promise) await versionLook
    const { cloud, cloudPrefs, plan, proof, prevEventId, identity } = get()
    const refuse = (message: string): false => {
      set({ cloud: { ...get().cloud, rideError: message } })
      return false
    }
    if (cloudPrefs.mode === 'off') return refuse('Cloud compute is off in the Cloud compute panel.')
    // One cloud flow and one computing move at a time: the invoice modal and
    // the persisted job are single, and the head is held by one move.
    if (plan !== null || proof.status === 'computing' || (cloud.status !== 'idle' && cloud.status !== 'error')) {
      return refuse('Finish or cancel the move in progress first.')
    }
    // A kept job is paid work; a new record would overwrite it.
    if (cloud.job !== null) return refuse('A HOSAKA job is kept in the Cloud compute panel. RESUME or DISCARD it first.')
    if (ask.previousId !== prevEventId) return refuse('Your chain moved since this ride was planned. Ride again from here.')
    if (whyNoMove(get().actions())) return refuse(whyNoMove(get().actions())!)

    const client = cloudClient(cloudPrefs.apiUrl)
    stopCloud()
    const id = ++requestId
    const abort = new AbortController()
    cloudAbort = abort
    // The head is held from here until the hyperjump is signed or the ride
    // ends: a computing move blocks every commit, BOARD and local ride, and
    // the relays' copies of this chain fold only when it ends (foldDeferred).
    set({
      pendingTarget: null,
      proof: { ...IDLE_PROOF, status: 'computing', source: 'cloud', message: 'HOSAKA is computing your ride.' },
      cloud: {
        ...get().cloud,
        status: 'quoting',
        quote: null,
        invoice: null,
        invoiceOpen: false,
        job: null,
        progress: null,
        rideError: null,
        message: currentSigner.kind === 'local' ? 'Submitting the ride to HOSAKA.' : 'Waiting for your signer to approve the HOSAKA request.',
        startedAt: Date.now(),
      },
    })
    let job: HosakaJob
    try {
      // Keyed by the ride itself (lib/hosaka.ts rideBody): a lost answer is
      // asked again with the same key, and so is a second tap on the same
      // ride from the same head, so HOSAKA hands back the job it already
      // made instead of charging twice.
      job = await client.submitRide(ask.previousId, ask.fromHeight, ask.toHeight, abort.signal)
    } catch (err) {
      if (id !== requestId || abort.signal.aborted) return false
      rideFail(describeCloudError(err), false)
      return false
    } finally {
      if (cloudAbort === abort) cloudAbort = null
    }
    if (id !== requestId || abort.signal.aborted) return false
    const balanceNow = job.new_balance_msats ?? job.current_balance_msats
    if (typeof balanceNow === 'number') get().noteBalance(balanceNow)
    if (!job.poll_token) {
      rideFail('HOSAKA took the ride but gave no way to follow it. Ride again: the same ride names the same job.', false)
      return false
    }
    const paying = job.payment_required === true && job.deposit !== undefined
    if (job.payment_required === true && !paying) {
      rideFail(`HOSAKA wants ${satsOf(job.amount_due_msats ?? job.cost_msats)} sats more than your balance holds and issued no invoice.`, false)
      return false
    }
    const dest = coordToXyz(hexToCoord(ask.toCoordHex))
    const record: PendingCloudJob = {
      version: 1,
      jobId: job.id,
      pollToken: job.poll_token,
      action: 'ride',
      pubkey: identity.pubkey,
      from: wirePosition(get().position),
      to: wirePosition({ x: dest.x, y: dest.y, z: dest.z }),
      plane: dest.plane,
      prevEventId: ask.previousId,
      costMsats: typeof job.cost_msats === 'number' ? job.cost_msats : 0,
      createdAt: Date.now(),
      stage: paying ? 'awaiting_payment' : 'computing',
      deposit: paying && job.deposit ? invoiceOf(job.deposit) : null,
      ...(ask.estSeconds !== null ? { estSeconds: ask.estSeconds } : {}),
      ride: { fromHeight: ask.fromHeight, toHeight: ask.toHeight, toCoordHex: ask.toCoordHex, ...(ask.asOf !== undefined ? { asOf: ask.asOf } : {}) },
    }
    // On disk before the invoice is on screen: a reload after paying, or
    // while HOSAKA computes, picks the same job up (resumeCloudJob).
    saveCloudJob(record)
    set({ cloud: { ...get().cloud, job: record, message: null } })
    return cloudRideRunner ? cloudRideRunner(record, id) : false
  },

  refreshBalance: async () => {
    const { cloud, cloudPrefs } = get()
    if (cloud.balanceChecking) return
    set({ cloud: { ...cloud, balanceChecking: true, balanceError: null } })
    try {
      const bal = await cloudClient(cloudPrefs.apiUrl).balance()
      get().noteBalance(bal.balance_msats)
    } catch (err) {
      set({ cloud: { ...get().cloud, balanceError: describeCloudError(err) } })
    } finally {
      set({ cloud: { ...get().cloud, balanceChecking: false } })
    }
  },

  declineCloud: () => {
    if (get().cloud.status !== 'confirm') return
    requestId++
    set({ plan: null, pendingTarget: null, proof: IDLE_PROOF, cloud: { ...get().cloud, status: 'idle', quote: null, message: null, startedAt: null } })
  },

  cancelCloud: () => {
    const { cloud } = get()
    if (cloud.status === 'idle') return
    requestId++
    stopCloud()
    // Unpaid, the job simply expires on the server. Paid or computing, the
    // record is kept: the money is spent and the result can still be claimed.
    // Dismissing an error keeps whatever the failure left behind.
    const keep = cloud.job !== null && (cloud.status === 'error' || cloud.job.stage !== 'awaiting_payment')
    if (!keep) clearCloudJob()
    set({
      pendingTarget: null,
      proof: IDLE_PROOF,
      cloud: {
        ...IDLE_CLOUD,
        limits: cloud.limits,
        provider: cloud.provider,
        balance: cloud.balance,
        last: cloud.last,
        job: keep ? cloud.job : null,
        message: keep
          ? 'Cloud job kept. RESUME finishes it; moving first makes it worthless.'
          : cloud.status === 'awaiting_payment'
            ? 'Cloud job abandoned. If you already paid, the deposit stays claimable on your HOSAKA balance.'
            : null,
      },
    })
  },

  collectCloudKeys: async () => {
    const ticket = loadKeysTicket()
    if (!ticket || collectingKeys) return
    collectingKeys = true
    try {
      const job = await cloudClient(get().cloudPrefs.apiUrl).waitForJob(ticket.jobId, ticket.pollToken)
      const r = job.result as CloudHopResult | null
      if (job.status === 'completed' && r?.destination_keys && r.destination_keys.length > 0) {
        const n = holdCloudDestinationKeys(r.destination_keys, positionFromWire(ticket.to), ticket.plane)
        clearKeysTicket()
        if (n > 0) useToast.getState().show({ label: `${n} REGION KEYS FROM HOSAKA`, meta: 'The cubes around your paid hop are open. Anything hidden in them is yours to find.', mark: 'hosaka' })
      } else if (r?.keys_error) {
        // The hop stands and is already signed: only the extra work failed,
        // and HOSAKA credited its surcharge back.
        clearKeysTicket()
        const back = Math.round((r.keys_credit_msats ?? 0) / 1000)
        useToast.getState().show({
          label: 'CUBES NOT COMPUTED',
          meta: back > 0 ? `Your hop stands. ${back} sats came back to your HOSAKA balance.` : 'Your hop stands. Nothing extra was charged.',
          mark: 'hosaka',
        })
      } else if (job.status === 'completed' || job.status === 'failed') {
        // Nothing is coming on this job.
        clearKeysTicket()
      }
    } catch {
      // A dropped socket or a tab put away: the ticket keeps, and the next
      // load picks it up again.
    } finally {
      collectingKeys = false
    }
  },

  resumeCloudJob: async () => {
    const { cloudPrefs, identity } = get()
    if (cloudPrefs.mode !== 'off') void ensureCloudLimits()
    // A route deposit that was paid (or not) while the tab was away: claim it
    // so the sats reach the balance, or forget it once its invoice expired.
    const dep = loadCloudDeposit()
    if (dep && dep.pubkey === identity.pubkey) {
      if (dep.expiresAt * 1000 < Date.now()) {
        clearCloudDeposit()
      } else {
        try {
          const claimed = await cloudClient(cloudPrefs.apiUrl).claimDeposit(dep.depositId)
          if (typeof claimed.balance_msats === 'number') get().noteBalance(claimed.balance_msats)
          if (claimed.status === 'settled') {
            clearCloudDeposit()
            const msats = claimed.settled_msats ?? dep.amountMsats
            set({ cloud: { ...get().cloud, message: `A ${satsOf(msats)} sat route deposit from an interrupted commit was credited to your HOSAKA balance.`, credited: { msats, at: Date.now() } } })
          } else if (claimed.status === 'expired') {
            clearCloudDeposit()
          }
        } catch {
          // Unreachable now; the record stays for the next load.
        }
      }
    }
    const record = loadCloudJob()
    // Another identity's job stays on disk for when it is back.
    if (!record || record.pubkey !== identity.pubkey) return
    if (get().proof.status === 'computing') return
    if (record.prevEventId !== get().prevEventId) {
      clearCloudJob()
      set({ cloud: { ...get().cloud, job: null, message: 'A pending cloud job was dropped: the chain head moved since it was created.' } })
      return
    }
    if (record.stage === 'awaiting_payment' && record.deposit && record.deposit.expiresAt * 1000 < Date.now()) {
      clearCloudJob()
      set({ cloud: { ...get().cloud, job: null, message: 'A pending cloud job was dropped: its invoice expired.' } })
      return
    }
    const id = ++requestId
    if (record.action === 'ride') {
      // A ride bought before a reload: the head is held again at once, and
      // the same job is followed to its end by its id and poll token.
      set({
        pendingTarget: null,
        proof: { ...IDLE_PROOF, status: 'computing', source: 'cloud', message: 'HOSAKA is computing your ride.' },
        cloud: {
          ...get().cloud,
          status: record.stage,
          quote: null,
          invoice: record.deposit,
          invoiceOpen: record.stage === 'awaiting_payment',
          job: record,
          progress: null,
          message: null,
          rideError: null,
          startedAt: record.createdAt,
        },
      })
      if (cloudRideRunner) await cloudRideRunner(record, id)
      return
    }
    set({
      pendingTarget: positionFromWire(record.to),
      // The job's plane, with its destination: a plane-change job resumed
      // after a reload must sign C in the plane it was bought for.
      plane: record.plane,
      proof: { ...IDLE_PROOF, status: 'computing', mode: moveAction(record.action), source: 'cloud' },
      cloud: {
        ...get().cloud,
        status: record.stage,
        quote: null,
        invoice: record.deposit,
        invoiceOpen: record.stage === 'awaiting_payment',
        job: record,
        progress: null,
        message: null,
        startedAt: record.createdAt,
      },
    })
    await runCloud(record, id)
  },

  discardCloudJob: () => {
    const { cloud, proof } = get()
    if (cloud.status !== 'idle' && cloud.status !== 'error') return
    clearCloudJob()
    set({
      cloud: { ...cloud, status: 'idle', job: null, message: null, quote: null, invoice: null, invoiceOpen: false },
      ...(proof.status === 'infeasible' ? { proof: IDLE_PROOF } : {}),
    })
  },

  dismissCredited: () => { set({ cloud: { ...get().cloud, credited: null } }) },

  wakeSigner: () => wakeSigner(),

  checkCloudPayment: () => {
    if (get().cloud.status !== 'awaiting_payment') return
    set({ cloud: { ...get().cloud, checking: true } })
    cloudWaker?.wake()
  },

  setCloudMode: (mode) => { get().setCloudPrefs({ mode }) },

  setCloudPrefs: (patch) => {
    const prev = get().cloudPrefs
    const next: CloudPrefs = { ...prev, ...patch }
    if (!Number.isFinite(next.autoMaxSats) || next.autoMaxSats < 0) next.autoMaxSats = prev.autoMaxSats
    next.autoMaxSats = Math.floor(next.autoMaxSats)
    next.apiUrl = next.apiUrl.trim().replace(/\/+$/, '')
    saveCloudPrefs(next)
    const urlChanged = next.apiUrl !== prev.apiUrl
    if (urlChanged) limitsInFlight = null
    set({ cloudPrefs: next, ...(urlChanged ? { cloud: { ...get().cloud, limits: null, provider: null } } : {}) })
    if (next.mode !== 'off' && get().cloud.limits === null) void ensureCloudLimits()
  },

  setInvoiceOpen: (open) => set({ cloud: { ...get().cloud, invoiceOpen: open } }),

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
    // Where the chain puts you, which is not always the last event's own C:
    // after an action this client does not recognize, or inside a game, it
    // is the position carried or held (events.ts buildChain).
    const head = chainHead(parsedChain(events))
    // Provisional identity: no head event yet, so read the spawn coordinate.
    return head ? head.coordHex : positionHex(position, plane)
  },

  sector: () => {
    const { position } = get()
    return sectorTag(xyzToSectorId(position.x, position.y, position.z))
  },

  actions: () => parsedChain(get().events),

  // A driven view drives while spectating too: the two stand together only in
  // BUILD mode (beginSpectate `keepView`), where the pad moves the build
  // cursor near the avatar being watched. Never your head: that is atHead.
  canDrive: () => get().atHead() || (get().focus?.drive === true && get().exploreIndex === null),
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
    // A driven focus (the free view) frames its cursor like your head does,
    // so the camera follows the pad; a plain focus frames the viewed point.
    if (focus !== null && !focus.drive) {
      // A hidden item is drawn at its true place at every zoom, so that is
      // what is framed; on the stop markers' policy below, the camera framed
      // the item's cell centre at and below 2^33 while the item sat up to half
      // a cell away, wandering on screen as you zoomed (arkinox, 2026-10-01).
      if (focus.item) return itemCentre(anchor, alignedOrigin(anchor, scaleExp), scaleExp, focusAxes)
      // Same policy as markerCentre: at occupancy zooms the marker snaps to
      // its cell, whose cube centre is the aligned origin itself.
      if (scaleExp <= OCCUPANCY_SCALE_MAX) return [0, 0, 0]
      const focusOrigin = alignedOrigin(anchor, scaleExp)
      return [focusAxes.right, focusAxes.up, focusAxes.out].map(
        (a) => (cellDelta(anchor[a.axis], focusOrigin[a.axis], scaleExp) - 0.5) * a.dir,
      ) as [number, number, number]
    }
    const axes = viewAxes(view)
    // With no cursor to drive (spectating, history, a plain focus) the camera
    // sits on the anchor: its cell centre, [0, 0, 0], below the continuous
    // range, and its true position inside that cell in it, where the avatar
    // is drawn (anchorCentre).
    if (!get().canDrive()) return anchorCentre(anchor, scaleExp, axes)
    // placeCentre, the same placement the cursor cube, the avatar and the
    // path trail draw with: cell CENTRES below CONTINUOUS_SCALE_MIN, the true
    // point from there up. This used to mix cellOffset on two axes with
    // cellDelta on the third, so the point field's focus, the camera target
    // and the cursor cube could sit up to half a cell apart above scaleExp 0:
    // the terrain magnified around a spot the cursor was not quite on.
    return placeCentre(cursor, alignedOrigin(anchor, scaleExp), scaleExp, axes)
  },
  }
})

// The saved chain loaded at boot is drawn already; its signatures are
// checked now, off the main thread.
startSignatureCheck(pubkeyHex, saved?.unchecked ?? [])

// The build STEP never exceeds the zoom. Zooming in to it or past it, by any
// path (the pad and the keys, a focus, a hyperspace view), puts it back on
// the zoom, so it cannot come back when the zoom is restored.
useCyberspace.subscribe((s, prev) => {
  if (s.scaleExp < prev.scaleExp && s.buildStep !== null && s.buildStep >= s.scaleExp) s.setBuildStep(null)
})

// DEV is also true under vitest, which runs in node, and importing this module
// for alignedOrigin must not blow up on a missing window. Same reason the
// localStorage calls above are wrapped.
// A proof that ends any way but signing (cancelled, refused, failed) folds
// what arrived while it computed; signing folds it itself (finishProof).
useCyberspace.subscribe((s, prev) => {
  if (prev.proof.status === 'computing' && s.proof.status !== 'computing') foldDeferred()
})

// Nothing in the old hop format is ever published (retireStaleFormat): what
// a reload, another tab's save or a fold brings in is inspected as it lands,
// before a new action can be signed on top of it, and once for the chain
// this page loaded with.
useCyberspace.subscribe((s, prev) => {
  if (s.events !== prev.events || s.published !== prev.published) retireStaleFormat()
})
retireStaleFormat()

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
 * Compute the route's current step: its proof request goes to the worker like
 * any single commit, and applyProofMessage carries it through signing.
 */
function startPlanStep(): void {
  const s = useCyberspace.getState()
  const plan = s.plan
  if (!plan || plan.status !== 'running') return
  // A game's entry arrived between steps: the route stops where it is.
  const noMove = whyNoMove(s.actions())
  if (noMove) {
    useCyberspace.setState({
      plan: { ...plan, status: 'failed', message: noMove, awaiting: null },
      pendingTarget: null,
      proof: { ...IDLE_PROOF, status: 'infeasible', message: noMove },
    })
    return
  }
  const issue = movementCapabilityIssue(plan.step.kind, plan.step.from, plan.step.to, s.plane, plan.step.source === 'cloud' ? 'cloud' : 'local')
  if (issue) {
    useCyberspace.setState({
      plan: { ...plan, status: 'failed', message: issue, awaiting: null },
      pendingTarget: null,
      proof: { ...IDLE_PROOF, status: 'infeasible', message: issue },
    })
    return
  }
  const id = ++requestId
  if (plan.step.source === 'cloud') {
    void cloudStepStarter?.(plan.step, id)
    return
  }
  useCyberspace.setState({
    pendingTarget: plan.step.to,
    proof: { ...IDLE_PROOF, status: 'computing', mode: plan.step.kind, source: 'local' },
  })
  postProof({
    id,
    mode: plan.step.kind,
    from: plan.step.from,
    to: plan.step.to,
    plane: s.plane,
    prevEventId: s.prevEventId,
    maxComputeHeight: plan.ceilings.hop,
  })
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
/** What to ask a HOSAKA hop for: the destination's cubes under LOOT, nothing extra otherwise. Sidesteps never carry them. */
function hopWants(kind: HosakaAction): HopWants | undefined {
  return kind === 'hop' && useCyberspace.getState().cloudPrefs.profile === 'loot' ? { destinationKeys: true } : undefined
}

export function alignedOrigin(position: Position, scaleExp: number): Position {
  return {
    x: alignTo(position.x, scaleExp),
    y: alignTo(position.y, scaleExp),
    z: alignTo(position.z, scaleExp),
  }
}
