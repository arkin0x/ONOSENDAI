/**
 * DeployBar.tsx — placing a shard in the world.
 *
 * While this is up you are aiming, not moving: a deploy happens in BUILD mode
 * (store/useBuilder.ts), so the build cursor picks the spot (WASD, the pad,
 * the zoom, the View panel, all of it), the shard ghosts there, and
 * DEPLOY hides it at the build cursor. Nothing here moves your avatar. The one real choice is the height, which is the discovery
 * radius (spec §7.3): height 0 is a single gibson, so only someone standing on
 * that exact point finds it; each step up doubles the aligned cube it hides in
 * and the work it costs to find. The bar spells the radius out in real units
 * so the choice is legible rather than a bare number.
 *
 * A shard also has a size of its own, its `unit`, which the workshop sets as
 * DEPLOY SCALE MULTIPLIER. SCALE MULTIPLIER here is the same quantity for this
 * one deployment: it starts at the shard's own unit and changing it places the
 * shard at that size without editing the model on the bench, so the same shard
 * goes out as a trinket in one place and a monument in another. A message has
 * no size, so the row is not offered for one.
 *
 * SNAP TO EARTH is the third choice, and only where it means anything: in
 * dataspace, at height 27 and above (lib/pose.ts SNAP_MIN_HEIGHT). A shard is
 * built on cyberspace axes, and cyberspace Y is the planet's polar axis, so a
 * shard built upright stands upright only at the poles and lies on its side at
 * the equator. The snap turns it to the ground under it: bottom to Earth, +Z
 * facing SPIN, a compass bearing in whole degrees. FINE ROTATION hands SPIN to
 * the camera, so orbiting aims the shard and the ghost shows exactly what
 * lands. Both travel inside the encrypted payload, so a finder decrypts the
 * pose along with the shape and sees it as it was placed.
 *
 * CONSTRAIN MOVEMENT IN WALK MODE (OFF / ALL / OPAQUE, DECK-0003 §1.12) is the
 * shard's WALK setting for this deployment, seeded from the shard (OPAQUE for
 * one that never chose, as it publishes) and written into what is hidden like
 * SCALE; EDIT shows it too. Not for a LIVE LINK,
 * whose setting is its author's (lib/walkConstrain.ts).
 *
 * More choices belong to the BAG rather than to this item, because a bag
 * is one event per author and region holding everything hidden there (spec
 * §7.6) (arkinox, 2026-10-01):
 *   - PUBLISH HEIGHT HINT: whether the bag carries its `H` tag (spec §8.6, optional).
 *   - PUBLISH SECTOR HINT: a hint naming the bag's sector, heights of 30 on
 *     every axis, with its X, Y, Z and S sector tags (spec §7.7, §10). A hint
 *     must be at least the bag's height, so it is off above height 30, and
 *     comes back on at 30 or lower (useShards `deployHintHeld`).
 *   - PUBLISH CONTENTS: what is inside, by kind and count, money and NFTs left out.
 *   - PUBLISH THAT MONEY OR NFTS ARE INSIDE: shown whenever a cashu token or
 *     an NFT claim link is inside, with contents on or off. They are said
 *     only with it on: counted beside the rest with contents on, alone
 *     without (lib/hidden.ts bagContentsTags; owner ruling 2026-11-16: an
 *     NFT claim link is hidden by default as money is, since whoever finds
 *     it can claim it).
 *   The three hint switches are ON for a player who never touched them, the
 *   money switch OFF (arkinox, 2026-11-15: "money off by default"), and all
 *   four then stay what they set them, on every later hide, reload and session, for
 *   shards, messages, keys, items, chests, doors, audio and seeds alike, into
 *   a new bag or one of yours already out, an edit or a move (arkinox,
 *   2026-11-15: "these 3 hint settings (toggles) should stay what you set
 *   them after the initial defaults of all 3 being turned on";
 *   store/deployHintPrefs.ts, kept per device). The bag goes out with them as
 *   shown. A room's bag behind a door carries no hint at all (lib/doors.ts
 *   ROOM_BAG_SETTINGS), and this bar shows no bag rows for it.
 *   - HINT MESSAGE: a riddle in the bag's plaintext `content` (spec §7.7).
 * When the cursor's region already holds your bag, the riddle starts at that
 * bag's and the bar says these settings apply to everything you hid there.
 *
 * The bar is docked in the lower left, where the route overlay docks: over
 * the menu button, a gap short of the controls when the pad is open, and
 * growing upward to 35% of the screen, so the center, where the ghost shows
 * what is being placed, stays clear on every screen (arkinox, 2026-10-12: it
 * sat at the top and covered the model). The title and the deploy button are
 * pinned and everything under them scrolls, so the button is always one tap
 * away however many rows are open. Each row's green note sits on its own line
 * under the row's controls (DeployRow), so the controls get the bar's width
 * at the phone-narrow span beside the pad.
 *
 * A shard aimed into a chest (useShards `intoChest`, arkinox 2026-10-10) is
 * the same bar with the chest's rows gone: STEP, SCALE, TURN and the snap are
 * the shard's and stay; the height, its fit note, HOSAKA's estimate and the
 * bag controls belong to the chest that will hold it, and go. PUT IN CHEST
 * signs the shard where it stands and hands the chest back to its composer;
 * nothing is hidden or published. The height still runs underneath, fitted
 * automatically, because the shard's point is the center of its cell at that
 * height exactly as a hide's would be, and the snap is offered by it.
 *
 * Placing the chest itself, the height fits what was aimed inside (lib/deployFit
 * fitHeightAll): a content stands at its own point only inside the chest's
 * region (lib/chests revealedIn), so the smallest region holding the chest and
 * every aimed shard, each with its reach, is where the height starts. Lowered
 * by hand below that, the row's tooltip says what will stand at the chest.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { DoorClosedLocked } from 'lucide-react'
import { roomOf } from '../lib/doors'
import { noCallout, useRepeatable } from '../hooks/useRepeatable'
import { MAX_UNIT, type ShardModel } from 'sno-core/shards'
import { formatCellSize, formatDistance } from 'sno-core/scale'
import { fadeStep, inscribedRadius, sourceLocal } from '../lib/audioItem'
import { CARDS_LOCAL_NOTE, cardsStayLocal, LINK_PROTECTED, SCAN_MAX_HEIGHT, autoRoomFor, bagRowsFor, deployBagMeter, plannedShard, posedForDeploy, type BagMeter, fillingChest, placedDoorHeight, movingId, placingChest, sealingDoor, lookModelOf, lookTagsFor, type LookChoice, aimedOf, atLastSpot, copyLinedUp, isProtected, moneyRowShown, ownBagIn, pendingEmpty, pendingName, positionOf, regionOf, useShards } from '../store/useShards'
import { aimedPoint } from '../lib/chests'
import { snapOffered } from '../lib/pose'
import { MAX_RIDDLE_LENGTH } from '../lib/hidden'
import { BAG_SAFE_BYTES } from '../lib/bagSize'
import { lookTagsSize, sealedLookLimit } from '../lib/sealedLooks'
import { findCashuToken } from '../lib/cashu'
import { AXIS_BITS, SECTOR_HEIGHT, SECTOR_HINT, isSectorHint, searchExponent } from '../lib/hint'
import { deployPoint, type Position } from '../lib/space'
import { buildPlane, buildStepOf, moveStepOf } from '../lib/buildCursor'
import { stepBuild } from '../store/buildStep'
import { useBuilder } from '../store/useBuilder'
import { Field, Switch } from './ui/Switch'
import { ItemIcon } from './ItemIcon'
import { MAX_COMPUTE_HEIGHT, useCyberspace } from '../store/useCyberspace'
import { useCalibration } from '../lib/calibration'
import { ratioOf, useExperience } from '../lib/experience'
import { cloudKeyQuote, deployCeiling, deployRoute, localKeySeconds, needsAsk, regionKeyLadder, waitLabel } from '../lib/deployPlan'
import { useEscape } from '../hooks/useEscape'
import { useCover } from '../hooks/useCover'
import { fitCause, fitHeight, fitHeightAll, outsideAt, reachGibsons, type FitPoint } from '../lib/deployFit'
import { seedDraftHeight } from '../lib/seeds/plant'
import { seedSnapOffered } from '../lib/seeds/orientation'
import { CHEST_LOOKS, DOOR_LOOKS, LOOK_LABELS } from '../lib/looks'
import { LookPicker } from './LookPicker'
import { SHALLOW_WARN, autoHeightMax, shallowBag, shallowExplain } from '../lib/shallowBag'
import { CONSTRAINS, CONSTRAIN_TIPS } from '../lib/walkConstrain'
import { GoArrow } from './ui/GoArrow'
import { PayTerms } from './ui/PayTerms'

/**
 * The bar's classes. `pad` is whether the controls pad is on screen: with it,
 * the bar stops a gap short of the controls, as the route overlay does; with
 * it closed, the bar has the bottom left up to the screen's right gutter
 * (styles.css, "Route overlay") (arkinox, 2026-10-12).
 */
export function deployBarClass(pad: boolean): string {
  return pad ? 'deploybar deploybar--pad' : 'deploybar'
}

/**
 * One row of the bar: its label and controls on a line, and its green note,
 * when it has one, on the next line under them, so the controls have the
 * whole width of the docked bar (arkinox, 2026-10-12).
 */
export function DeployRow({ kind, label, hint, hintTitle, children }: { kind: string; label: string; hint?: ReactNode; hintTitle?: string; children: ReactNode }): JSX.Element {
  return (
    <>
      <div className={`deploybar__row deploybar__row--${kind}`}>
        <span className="deploybar__label">{label}</span>
        {children}
      </div>
      {hint ? <div className={`deploybar__radius deploybar__hint deploybar__hint--${kind}`} title={hintTitle}>{hint}</div> : null}
    </>
  )
}

/**
 * The height's two warnings, one or the other for every hide (arkinox,
 * 2026-10-19): at SCAN_MAX_HEIGHT or less any view that stops in the region
 * finds the bag (lib/shallowBag.ts), a chip with its explanation the tooltip;
 * past it, discovery never surfaces it. An aim into a chest has no height of
 * its own, so neither. `localMax` is this machine's own key ceiling, which
 * says whether going deeper needs HOSAKA.
 */
export function HeightWarnings({ height, intoChest, localMax }: { height: number; intoChest: boolean; localMax: number }): JSX.Element | null {
  if (intoChest) return null
  if (shallowBag(height)) return <div className="deploybar__row deploybar__shallow" role="note" title={shallowExplain(localMax)}>{SHALLOW_WARN}</div>
  return (
    <div className="deploybar__row deploybar__warn">
      ⚠ Past height {SCAN_MAX_HEIGHT}, discovery will not surface this automatically, not even on your other devices. Only someone who already knows this spot and height can compute the region and open it.
    </div>
  )
}

/**
 * The automatic height's fit (lib/deployFit.ts): a shard's own reach, a seed's
 * measured bloom (`seedFit`), or a chest's look (`wearsLook`, measured by
 * its `fitShape` when it has one) with every aimed content. Tried only up to
 * `autoMax` (lib/shallowBag.ts autoHeightMax): null when nothing up to it
 * holds the thing, and the height then stays at `autoMax`. Null too when
 * nothing is fitted (a message, a key).
 */
export function autoFitHeight(o: { shard: Pick<ShardModel, 'vertices' | 'parts'> | null; wearsLook: boolean; fitShape: Pick<ShardModel, 'vertices' | 'parts'> | null; unit: number; cursor: Position; step: number; aimed: FitPoint[]; seedFit: number | null; autoMax: number }): number | null {
  if (o.shard) return fitHeight(o.shard, o.unit, o.cursor, o.step, 0, o.autoMax)
  if (o.seedFit !== null) return o.seedFit
  if (o.wearsLook || o.aimed.length > 0) return fitHeightAll(o.fitShape ? reachGibsons(o.fitShape, o.unit) : 0n, o.aimed, o.cursor, o.step, 0, o.autoMax)
  return null
}

/**
 * Why the automatic height did not hold the whole thing: nothing up to
 * `autoMax` (lib/shallowBag.ts autoHeightMax, discovery's reach) holds it, so
 * the height stays at `autoMax`. Higher holds more, up to `ceiling`, but only
 * by +, under the past-height warning: an automatic height past discovery hid
 * a player's shards from his own laptop (owner, 2026-11-14).
 */
export function FitNote({ cause, autoMax, ceiling }: { cause: 'size' | 'edge' | 'contents'; autoMax: number; ceiling: number }): JSX.Element {
  const higher = ceiling > autoMax ? ' Press + to hide it higher; there no scan finds it, not even on your other devices.' : ''
  return (
    <div className="deploybar__row deploybar__fitnote">{cause === 'edge'
      ? `Sits across a region edge, so part of it will be cut off; move it to fit.${higher}`
      : cause === 'contents'
        ? <>No region up to 2^{autoMax} holds the chest and everything aimed inside it; what falls outside stands at the chest when it opens.{higher}</>
        : <>At this scale the model is larger than any region up to 2^{autoMax}; part of it will be cut off. Hide it at a smaller scale, or move the cursor.{higher}</>}</div>
  )
}

/**
 * A copy lined up on the spot the last one landed on, nothing changed, where
 * a press is refused (useShards `atLastSpot`): the bar's button and the pad's
 * PLACE both say so. Subscribed to both stores, since the cursor and the
 * settings each change it.
 */
export function useAtLastSpot(): boolean {
  const a = useShards((s) => atLastSpot(s, useCyberspace.getState()))
  const b = useCyberspace((c) => atLastSpot(useShards.getState(), c))
  return a && b
}

/**
 * What a look's height fits: the model it wears. A FEED look is a wrapper with
 * nothing of its own to reach with, so the object it places stands for it.
 */
export function lookFitShape(look: LookChoice | null, model: ShardModel | null): ShardModel | null {
  return look?.from === 'feed' ? look.object.shard : model
}

/**
 * How large a custom look is against the size limit, for the MODEL row: its
 * bytes, the limit it is held to, and how it goes out (INLINE in its tag, or BY
 * REFERENCE: sealed as its own event, DECK-0004 §3.6). Null for a built-in, a
 * FEED placement and a look MOVE keeps as it is, which carry nothing of their own to
 * measure.
 */
export function lookSizeLine(look: LookChoice, tags: readonly string[][]): string | null {
  if (look.from !== 'mine' && look.from !== 'model') return null
  const { bytes, sealed } = lookTagsSize(tags)
  return `${bytes.toLocaleString('en-US')} of ${sealedLookLimit().toLocaleString('en-US')} bytes · ${sealed ? 'BY REFERENCE' : 'INLINE'}`
}

/**
 * The model row (chest and door design, D2, D3): the built-in looks, then
 * OTHER, any model from MINE or FEED (LookPicker). The chosen OTHER's name
 * is the row's note, with its size against the size limit (lookSizeLine); a
 * look over the size limit says so there instead.
 */
export function LookRow({ choices, look, refusal, size = null }: { choices: readonly (keyof typeof LOOK_LABELS)[]; look: LookChoice; refusal: string | null; size?: string | null }): JSX.Element {
  const [picking, setPicking] = useState(false)
  const pick = (l: LookChoice): void => { useShards.getState().setDeployLook(l); setPicking(false) }
  const other = look.from === 'mine' ? lookModelOf(look)?.name ?? 'model' : look.from === 'feed' ? look.object.shard.name : look.from === 'model' ? look.closed.name : look.from === 'kept' ? 'as it is' : null
  return (
    <DeployRow kind="model" label="MODEL" hint={refusal ?? (other && size ? <><span>{other}</span> · <span data-testid="look-size">{size}</span></> : other)}>
      <span className="deploybar__choices" role="group" aria-label="Model">
        {choices.map((name) => (
          <button key={name} className={`deploybar__toggle ${look.from === 'builtin' && look.name === name ? 'is-on' : ''}`} aria-pressed={look.from === 'builtin' && look.name === name} onClick={() => pick({ from: 'builtin', name })} {...noCallout}>{LOOK_LABELS[name]}</button>
        ))}
        <button className={`deploybar__toggle ${other !== null ? 'is-on' : ''}`} aria-pressed={other !== null} title="Any model from MINE or FEED" onClick={() => setPicking(true)} {...noCallout}>OTHER</button>
      </span>
      {picking && <LookPicker onPick={pick} onClose={() => setPicking(false)} />}
    </DeployRow>
  )
}

/**
 * What to do when a shard will not fit its bag even with entries moved out
 * (store/useShards deployBagMeter, lib/bagFit.ts planUnderCap): HIDE &
 * PUBLISH is off and this line says why, in plain words (owner, 2026-11-16).
 * `others`: the bag already holds other things of yours, so another height
 * (another bag) is the way out. `room`: it is going into a door's room, whose
 * height the door sets, so the way out is the room chip's ×.
 */
export function bagTooBigLine(others: boolean, room = false): string {
  if (room) return 'This room is too full for it. Leave it out of the room with the \u00d7.'
  return others ? 'This bag is too full for it. Hide it at another height.' : 'Too big for one bag. Hide part of it, and hide the rest at another height.'
}

/** What to do when the shard itself is too big to hide whole (store/useShards deployBagMeter objectRefusal): one line; the deploy's own refusal, with the numbers, is its hover. */
export const OBJECT_TOO_BIG_LINE = 'Too big to hide whole. Move part of it into its own shard and place that.'

/**
 * The bag's size with the shard in it, against what one bag may be
 * (lib/bagSize.ts): BY REFERENCE when the shard goes out as its own object,
 * and why; TOO LARGE, with the deploy's own words, when even that does not fit.
 */
export function BagMeterRow({ meter, others = false, room = false }: { meter: BagMeter; others?: boolean; room?: boolean }): JSX.Element {
  // The shard itself too big: the bag's own numbers would read as if it fitted, so the row names the shard instead.
  const of = meter.objectRefusal ? 'THE SHARD ITSELF' : `${meter.bytes.toLocaleString('en-US')} of ${BAG_SAFE_BYTES.toLocaleString('en-US')} bytes`
  const form = meter.refusal || meter.objectRefusal ? 'TOO LARGE' : meter.fitted ? 'BY REFERENCE: THE BAG IS FULL' : meter.byReference ? 'BY REFERENCE' : 'INLINE'
  return (
    <DeployRow kind="bagsize" label="BAG" hint={meter.objectRefusal ? <span data-testid="object-too-big">{OBJECT_TOO_BIG_LINE}</span> : meter.refusal ? <span data-testid="bag-too-big">{bagTooBigLine(others, room)}</span> : meter.fitted ? 'Too large to carry inline here, so it goes out as its own sealed object and the bag names it.' : undefined} hintTitle={meter.objectRefusal ?? meter.refusal ?? undefined}>
      <span className="deploybar__value" data-testid="bag-meter">{of} · {form}</span>
    </DeployRow>
  )
}

/**
 * The bar, only while something is being placed. It is mounted all the time
 * (App.tsx), and its body asks the store about the build cursor, your hides
 * and the bag they would land in on every change: in WALK, where the cursor
 * is the walker and moves several times a second, that was every hide you
 * have read again at each gibson (ownBagIn), for a bar that draws nothing
 * (arkinox, 2026-11-21: WALK stutters on his phone). Nothing placed, nothing
 * asked.
 */
export function DeployBar({ pad = false }: { pad?: boolean }): JSX.Element | null {
  const placing = useShards((s) => s.pending !== null)
  return placing ? <DeployBarOpen pad={pad} /> : null
}

function DeployBarOpen({ pad }: { pad: boolean }): JSX.Element | null {
  // Covers the scene from below: BUILD frames the cursor above it (hooks/useCover).
  // The target markers do not dodge it: it narrows as the pad folds, and they would jump.
  const coverRef = useCover('bottom', true, { markers: false })
  const pending = useShards((s) => s.pending)
  const shard = useShards((s) => (s.pending?.type === 'shard' ? s.pendingShard() : null))
  // EDIT: a shard you hid, being moved. Its old region (a string, so the bar
  // re-renders only when it changes) says whether the move leaves its bag,
  // and whether it was published says where the move goes.
  const moving = useShards((s) => movingId(s.pending) !== null)
  // SEAL A CHEST (R18): placed first, here, then filled in its modal, which this bar steps aside for.
  const placing = useShards((s) => placingChest(s.pending))
  const filling = useShards((s) => fillingChest(s.pending))
  const movedRegion = useShards((s) => {
    const id = movingId(s.pending)
    const d = id ? s.mine.find((m) => m.eventId === id) : undefined
    return d ? regionOf(positionOf(d), d.plane, d.height) : null
  })
  const movedPublished = useShards((s) => {
    const id = movingId(s.pending)
    return !!id && !!s.mine.find((m) => m.eventId === id)?.published
  })
  // A shard being aimed into a chest: signed where it stands, not hidden.
  const intoChest = useShards((s) => s.pending?.type === 'shard' && !!s.pending.intoChest)
  const chestName = useShards((s) => (s.pending?.type === 'shard' ? s.pending.intoChest?.draft.name ?? null : null))
  const height = useShards((s) => s.deployHeight)
  const unit = useShards((s) => s.deployUnit)
  const status = useShards((s) => s.deployStatus)
  const error = useShards((s) => s.deployError)
  const note = useShards((s) => s.deployNote)
  const mining = useShards((s) => s.deployMining)
  const ask = useShards((s) => s.deployAsk)
  const live = useCyberspace((s) => s.live)
  const cloudMode = useCyberspace((s) => s.cloudPrefs.mode)
  const autoMaxSats = useCyberspace((s) => s.cloudPrefs.autoMaxSats)
  const cloudCap = useCyberspace((s) => s.cloud.limits?.max_hop_height ?? null)
  // A hide's key is a region key: priced from the provider's region key ladder when it has one.
  const ladder = useCyberspace((s) => regionKeyLadder(s.cloud.provider))
  // The plane the build cursor is in: the build view's (lib/buildCursor.ts).
  const plane = useCyberspace(buildPlane)
  const up = useShards((s) => s.deployUp)
  const spin = useShards((s) => s.deploySpin)
  const turn = useShards((s) => s.deployTurn)
  const constrain = useShards((s) => s.deployConstrain)
  const follow = useShards((s) => s.deployFollow)
  // From the Shard Feed: a copy by default, LIVE LINK by reference (ruling B1).
  const fromFeed = useShards((s) => s.pending?.type === 'shard' && !!s.pending.object)
  const link = useShards((s) => s.deployLink)
  // Protected by its author (NIP-70): only they may republish it, so no LIVE LINK.
  const guarded = useShards((s) => s.pending?.type === 'shard' && !!s.pending.object && isProtected(s.pending.object))
  const cantorMs = useCalibration((s) => s.cantorMsByHeight)
  // This machine's limit: the calibrated hop ceiling the movement panel shows.
  const hopLimit = useCalibration((s) => s.hopHeight)
  // Scroll-safe: the bar scrolls on a phone, and a scroll that starts on a
  // stepper must stay a scroll (arkinox, 2026-10-01).
  const bind = useRepeatable({ scrollSafe: true })
  const bag = useShards((s) => s.deployBag)
  const mine = useShards((s) => s.mine)
  // What a chest wears (the model row), and that model, for the fit and the size limit.
  const look = useShards((s) => (s.pending?.type === 'chest' ? s.pending.look ?? null : null))
  const lookModel = useMemo(() => (look ? lookModelOf(look) : null), [look])
  const fitShape = useMemo(() => lookFitShape(look, lookModel), [look, lookModel])
  // Its size against the size limit, and whether it goes sealed as its own event (lib/sealedLooks.ts), or why it cannot go.
  const { lookRefusal, lookSize } = useMemo(() => {
    if (!look) return { lookRefusal: null, lookSize: null }
    try { return { lookRefusal: null, lookSize: lookSizeLine(look, lookTagsFor(look, { unit, turn, constrain })) } } catch (err) { return { lookRefusal: err instanceof Error ? err.message : String(err), lookSize: null } }
  }, [look, unit, turn, constrain])
  // The region the deploy would land in, as a string, so the bar re-renders
  // when the cursor crosses into another region and not on every step.
  const region = useCyberspace((s) => regionOf(deployPoint(s.cursor, buildStepOf(s), height), buildPlane(s), height))
  const existing = useMemo(() => ownBagIn(mine, region), [mine, region])
  // Hidden audio's sphere (DECK-0007 §4.1): how far it may reach where it
  // would land, the distance to the region's nearest wall, so the FADE row
  // and the rings on the ghost never reach out of the hide region.
  const fadeRoom = useCyberspace((s) => inscribedRadius(sourceLocal(deployPoint(s.cursor, buildStepOf(s), height), height), 2 ** height))
  // Hooks stay above the early return below. The controls take this region's
  // bag settings when the cursor's region changes (seedDeployBag decides).
  useEffect(() => {
    if (pending) useShards.getState().seedDeployBag(existing)
  }, [pending, existing])

  const inputs = { localMax: Math.min(MAX_COMPUTE_HEIGHT, hopLimit), cloudMode, cloudCap }
  const ceiling = deployCeiling(inputs)
  // What the automatic height may reach: never past discovery's reach (autoHeightMax). + still goes to `ceiling`.
  const autoMax = autoHeightMax(ceiling)
  const route = deployRoute(height, inputs)
  const localSeconds = localKeySeconds(height, cantorMs)
  const experience = useExperience((s) => ratioOf(s.samples))
  const quote = route === 'cloud' ? cloudKeyQuote(height, ladder, experience) : null
  const willAsk = route === 'cloud' && needsAsk(cloudMode, quote?.sats ?? null, autoMaxSats)
  // Placing is a chip on the Escape stack (arkinox, 2026-10-01). With the
  // HOSAKA ask up, Escape is its NOT NOW and the placing goes on; otherwise
  // it is CANCEL, as Escape was before the stack.
  // The height that holds the whole model (lib/deployFit), applied while the
  // height is still automatic: a new deploy starts there, and it follows the
  // cursor, zoom and scale until + or - is pressed (arkinox, 2026-10-01).
  const heightAuto = useShards((s) => s.deployHeightAuto)
  const cursor = useCyberspace((s) => s.cursor)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  // The cell the placement snaps to (store/buildStep.ts): the zoom until STEP
  // is lowered, 2^0 once a zoom holds the placement on the cursor itself.
  const step = useCyberspace(buildStepOf)
  // How far a move goes, which the row shows: the STEP, even once a zoom has
  // put the placement on the cursor itself and it snaps no more (buildExact).
  const moveStep = useCyberspace(moveStepOf)
  // A door being placed or moved: its own rows.
  const door = useShards((s) => s.pending?.type === 'chest' && !!s.pending.door)
  // The door what is being placed seals to, at exactly its height (4.3): the
  // chip goes away with the height, and nothing locks the height.
  const me = useCyberspace((s) => s.identity.pubkey)
  const leaveOut = useShards((s) => s.deployLeaveOut)
  const chosenRoom = useShards((s) => s.deployDoorHeight)
  // Joining a room of yours on its own (syncRoomSnap): the height is the room's until the X.
  const snap = useShards((s) => s.deployRoomSnap)
  const doorHeight = placedDoorHeight({ deployHeight: height, deployDoorHeight: chosenRoom, deployRoomSnap: snap })
  const sealMove = useShards((s) => s.deploySealMove)
  const sealing = useMemo(
    () => (pending ? sealingDoor({ mine, pending, deployLeaveOut: leaveOut, deployDoorHeight: chosenRoom, deployRoomSnap: snap, deploySealMove: sealMove }, me, deployPoint(cursor, step, height), plane, height) : null),
    [pending, mine, leaveOut, chosenRoom, snap, sealMove, me, cursor, step, height, plane],
  )
  // The bag this shard goes into, as this device knows it, with the shard in
  // the form it would go out in: by reference when it is large, or when the
  // bag would not hold it inline (lib/bagFit.ts), so the meter shows it fits.
  const editRow = useShards((s) => {
    const id = s.pending?.type === 'shard' ? s.pending.edit?.eventId : undefined
    return id ? s.mine.find((m) => m.eventId === id) ?? null : null
  })
  // Built in three parts so a step of the cursor costs nothing: the shard's
  // entry once per pose (its payload and hash are the costly part), the bag's
  // rows once per target bag (a region, or a room), and the measure from those.
  const metered = !!shard && !intoChest && !link && pending?.type === 'shard'
  const posed = useMemo(
    () => (metered && shard ? posedForDeploy(shard, false, { deployUp: up, deploySpin: spin, deployTurn: turn, deployUnit: unit, deployConstrain: constrain }, plane, height) : null),
    [metered, shard, up, spin, turn, unit, constrain, plane, height],
  )
  const planned = useMemo(() => (posed ? plannedShard(posed, me) : null), [posed, me])
  const sealingId = sealing?.eventId ?? null
  const bagRows = useMemo(
    () => (planned ? bagRowsFor(mine, { region, door: sealing, edit: editRow ?? undefined }) : []),
    // The target bag, by name: `sealing` is the door named by `sealingId`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [planned, mine, region, sealingId, editRow],
  )
  const meter: BagMeter | null = useMemo(() => {
    if (!planned) return null
    const s = useCyberspace.getState()
    const place = bagRows[0] ? { at: positionOf(bagRows[0]), plane: bagRows[0].plane } : { at: deployPoint(s.cursor, buildStepOf(s), height), plane }
    return deployBagMeter(bagRows, planned, { height, settings: bag, owner: me, room: sealingId !== null, place, edit: editRow ?? undefined })
  }, [planned, bagRows, height, bag, me, sealingId, editRow, plane])
  // Too big for its bag even with entries moved out: the deploy would refuse it, so the button is off and the BAG row says what to do.
  const tooBig = !!meter?.refusal || !!meter?.objectRefusal
  // A MOVE or EDIT keeps its own bag (review of #633): a room under it is offered, SEAL IN ROOM, never taken on its own.
  const offer = useMemo(
    () => (pending && moving && !sealMove ? autoRoomFor({ mine, pending, deployLeaveOut: leaveOut, deployDoorHeight: chosenRoom, deployHeight: height, deployRoomSnap: snap, deploySealMove: true }, me, cursor, plane) : null),
    [pending, moving, sealMove, mine, leaveOut, chosenRoom, height, snap, me, cursor, plane],
  )
  // A chest with shards aimed inside: where each stands, with its reach, in
  // the plane the chest is being placed in. One aimed in the other plane can
  // never be inside the chest's region and is counted among the outside.
  const aimed = useMemo(() => {
    if (pending?.type !== 'chest') return { points: [] as FitPoint[], elsewhere: 0 }
    const points: FitPoint[] = []
    let elsewhere = 0
    for (const { aimed: a } of aimedOf(pending)) {
      const p = aimedPoint(a.signed)
      if (p && p.plane === plane) points.push({ at: p.at, reach: p.reach })
      else elsewhere++
    }
    return { points, elsewhere }
  }, [pending, plane])
  // A seed hides where the automatic discovery finds it (owner ruling
  // 2026-11-10): the smallest height from 3 to 12 whose cube holds this DNA's
  // own bloom at its last day where it lands (SeedCompose measures it for this cursor
  // and step; anywhere else, AGAIN included, it is 12), 12 when none does, and
  // the bloom draws past its cube. + still hides it higher, by hand. It used to fit
  // the 64 units every bloom is held to, a 128-gibson span that straddles some
  // power-of-two boundary near most points, so the height climbed to wherever
  // the nearest one ended (13 at the owner's spot every time).
  const seedFit = pending?.type === 'seed' ? seedDraftHeight(pending.seed.fit, cursor, plane, step, autoMax) : null
  // What the height is fitted to: a shard's own reach, the chest's look and
  // aimed contents, so its region holds the whole model it wears, or a seed's bloom.
  const fitting = !!shard || !!lookModel || aimed.points.length > 0 || seedFit !== null
  const fitH = useMemo(
    () => autoFitHeight({ shard, wearsLook: !!lookModel, fitShape, unit, cursor, step, aimed: aimed.points, seedFit, autoMax }),
    [shard, lookModel, fitShape, unit, cursor, step, autoMax, aimed, seedFit],
  )
  useEffect(() => {
    // Once placed, its height is fixed with its place, whatever the cursor does while the modal is filled.
    if (!heightAuto || !fitting || filling) return
    const want = fitH ?? autoMax
    if (want !== useShards.getState().deployHeight) useShards.getState().setDeployHeight(want)
  }, [heightAuto, fitting, fitH, autoMax, filling])
  const fitModel = shard ?? (aimed.points.length === 0 ? fitShape : null)
  // ADD on a door (4.8): what is placed next starts at the door's height, set by hand from then on.
  const into = useShards((s) => s.deployInto)
  const lined = pending !== null
  useEffect(() => {
    if (!lined || into === null) return
    useShards.setState({ deployHeightAuto: false })
    useShards.getState().setDeployHeight(into)
  }, [lined, into])
  const fit: { auto: boolean; height: number | null; cause: 'size' | 'edge' | 'contents' } = { auto: heightAuto && fitting, height: fitH, cause: fitModel ? fitCause(fitModel, unit, fitH, autoMax) : seedFit !== null ? 'size' : 'contents' }
  // Aimed contents the region at this height does not hold: they stand at the chest when it opens (revealedIn).
  const outside = aimed.points.length + aimed.elsewhere === 0 ? 0 : outsideAt(deployPoint(cursor, step, height), height, aimed.points) + aimed.elsewhere
  // STEP changes only the build cursor: in BUILD mode, its view drivable, not
  // at your head, and not while hiding (store/buildStep.ts stepOpen).
  const building = useBuilder((s) => s.active)
  const drivable = useCyberspace((s) => s.canDrive() && !s.atHead())
  // A placement lined up again (useShards `placedLast`): how many are placed,
  // and the spot the last one landed on, where an identical copy is refused.
  const placed = useShards((s) => (s.pending !== null && s.placedLast?.pending === s.pending ? s.placedLast : null))
  const here = useAtLastSpot()

  // On a copy lined up after a placement, Escape leaves BUILD mode, as it
  // did the moment a placement used to close the bar; CANCEL stays in it.
  useEscape('chip', pending !== null && !filling, () => {
    const s = useShards.getState()
    if (s.deployAsk) s.declineDeploy()
    else if (copyLinedUp(s)) useBuilder.getState().exit()
    else s.cancelDeploy(true)
  })

  if (!pending || filling) return null

  // A message, a key and audio have no size or pose. A shard has them, and a
  // chest has the model it wears placed like a shard (D2): SCALE, TURN and
  // WALK, but not the snap.
  const isMessage = pending.type !== 'shard'
  const sized = pending.type === 'shard' || pending.type === 'chest'
  // A seed turns as a shard does, and stands on Earth wherever it is planted in
  // dataspace (DECK-0008 §5.7; owner ruling 2026-11-10). Its scale is set in SEED.
  const seedStands = pending.type === 'seed'
  const snapHere = seedStands ? seedSnapOffered(plane) : !isMessage && !link && snapOffered(plane, height)
  const title = intoChest ? 'AIM' : moving ? (pending.type === 'shard' ? 'EDIT' : 'MOVE') : pending.type === 'shard' ? 'DEPLOY' : door ? 'HIDE DOOR' : pending.type === 'blueprint' ? 'LEAVE BLUEPRINT' : `HIDE ${pending.type.toUpperCase()}`
  // A blueprint card, or a chest with one inside, stays on this device until blueprints go live (useShards cardsStayLocal).
  const cardsLocal = cardsStayLocal(pending)
  const name = pendingName(pending, shard)
  const empty = pendingEmpty(pending, shard)
  const working = status === 'working'
  const stepOpen = building && drivable && !working
  // This machine's time is the button's tooltip, not a row (arkinox,
  // 2026-10-08: trim the deploy bar); HOSAKA's time and price stay a row.
  // An aim does no key work: its tooltip says what PUT IN CHEST does instead.
  const localEst = intoChest
    ? `Signs it here, at this size and pose, for the chest "${chestName ?? ''}". Nothing is published until the chest is hidden.`
    : route !== 'local' ? undefined : height === 0 ? 'No key work at height 0' : localSeconds === null ? 'Computed on this machine; the benchmark has not run yet' : `Computed on this machine, ${waitLabel(localSeconds)}`
  // Why the height row reads as it does: lowered under what was aimed, or raised for it, or for a shard's edge.
  const fitTip = outside > 0
    ? `${outside} aimed inside ${outside === 1 ? 'stands' : 'stand'} at the chest when it opens: outside this region`
    : fit.auto && fit.height !== null && fit.cause === 'contents'
      ? 'Raised to hold what is aimed inside. Lower it and whatever falls outside stands at the chest when it opens'
      : fit.auto && fit.height !== null && fit.cause === 'edge'
        ? 'Raised because it sits across a region edge; move it to hide lower'
        : undefined
  // In a room both are said: why the height is the room's, and what that height leaves outside or cuts (review of #633).
  const roomTip = snap ? `The room\u2019s height: it joins the room. The \u00d7 leaves it out, at the height you chose${fitH !== null && fitH > height ? '. Larger than the room: its walls cut it' : ''}` : undefined
  const heightTip = [roomTip, fitTip].filter(Boolean).join('. ') || undefined

  return (
    <div ref={coverRef} className={deployBarClass(pad)} role="dialog" aria-label={intoChest ? 'Aim shard for chest' : pending.type === 'shard' ? 'Deploy shard' : door ? 'Hide door' : `Hide ${pending.type}`}>
      {/* The title row carries the action, left of CANCEL, so the rest of the
          bar is free to scroll (arkinox, 2026-10-01). While HOSAKA's ask is up
          it takes its own row below, since three buttons do not fit here. */}
      <div className="deploybar__row deploybar__head">
        <ItemIcon className="deploybar__eye" type={pending.type} coin={pending.type === 'message' && findCashuToken(pending.text) !== null} />
        <span className="deploybar__title">
          {title} <strong>{name}</strong>
        </span>
        {placed && <span className="deploybar__scope deploybar__again" aria-label={`${placed.count} placed`} title={`${placed.count} placed. Lined up again with the same settings for the next one`}>×{placed.count}</span>}
        {!ask && (
          <button
            className="deploybar__deploy"
            disabled={empty || working || here || !!lookRefusal || tooBig}
            title={lookRefusal ?? (meter?.objectRefusal ? OBJECT_TOO_BIG_LINE : tooBig ? bagTooBigLine(bagRows.length > 0, sealingId !== null) : placing ? 'Place it here, then fill it' : here ? 'The last one stands here. Move, or change how it goes out, to place another' : localEst)}
            onClick={() => { if (placing) useShards.getState().placeChest(); else void useShards.getState().deploy() }}
            {...noCallout}
          >
            {placing ? <>{door ? 'PLACE DOOR' : 'PLACE CHEST'}<GoArrow /></> : empty ? `${pending.type.toUpperCase()} IS EMPTY` : here && !working ? 'PLACED HERE' : working ? (note ? `${note.toUpperCase()}…` : 'HIDING…') : intoChest ? 'PUT IN CHEST' : moving ? (route === 'cloud' ? 'MOVE VIA HOSAKA' : live || movedPublished ? 'MOVE & PUBLISH' : 'MOVE (LOCAL)') : route === 'cloud' ? 'HIDE VIA HOSAKA' : live && !cardsLocal ? 'HIDE & PUBLISH' : 'HIDE (LOCAL)'}
          </button>
        )}
        {/* Once hiding, it finishes where it was placed: CANCEL would only pretend. */}
        {/* Except while a seed's work is mining: nothing is signed yet, so CANCEL stops it (DECK-0008 §7). */}
        <button className="deploybar__cancel" disabled={working && !mining} title={mining ? 'Stop mining; nothing is hidden' : working ? 'Already hiding; it finishes where you placed it' : placed ? 'Stop placing this one; Esc leaves build mode' : undefined} onClick={() => useShards.getState().cancelDeploy(true)}>CANCEL</button>
      </div>

      {error && <div className="deploybar__row notice">{error}</div>}
      {cardsLocal && <div className="deploybar__row deploybar__fitnote bp-place__local" role="status">{CARDS_LOCAL_NOTE}</div>}
      {/* 4.3: the icon, the door's name, and an X that leaves this one placement out (R2). */}
      {sealing && (
        <div className="deploybar__doorchip" role="status" title="Sealed to this door: only whoever opens it finds this">
          <DoorClosedLocked size={13} strokeWidth={2.25} aria-hidden />
          <span className="deploybar__doorchip-name">{sealing.name}</span>
          {/* A door moving stays in the bag that holds it (R7): nothing to leave out of. */}
          {!(door && moving) && <button className="deploybar__doorchip-x" aria-label="Leave this one out of the door" title={sealMove ? 'Keep it out: it stays in its own bag' : 'Leave this one out: an ordinary placement, at the height you chose'} onClick={() => { const s = useShards.getState(); if (s.deploySealMove) s.setDeploySealMove(false); else s.setDeployLeaveOut(roomOf(sealing.at, sealing.plane, sealing.height)) }} {...noCallout}>×</button>}
        </div>
      )}
      {!sealing && offer && (
        <button className="deploybar__doorchip deploybar__doorchip--offer" title="Move it into this room, at the room's height: only whoever opens the door finds it" onClick={() => useShards.getState().setDeploySealMove(true)} {...noCallout}>
          <DoorClosedLocked size={13} strokeWidth={2.25} aria-hidden />
          <span className="deploybar__doorchip-name">SEAL IN ROOM · {offer.name}</span>
        </button>
      )}
      {/* Comments answer the bag, which is the region at its height: a move
          out of it leaves them behind (reactions name the shard and follow). */}
      {moving && movedRegion !== null && region !== movedRegion && (
        <div className="deploybar__row deploybar__fitnote">Outside its old region: its comments stay at the old place. Reactions come with it.</div>
      )}
      {/* The ask takes the button's place: the same green, now the yes, with
          the price and the wait on it, and a way to stand down beside it. */}
      {ask && (
        <div className="deploybar__ask">
          <button className="deploybar__deploy" onClick={() => useShards.getState().confirmDeploy()} {...noCallout}>
            {ask.sats !== null ? `${ask.sats} SATS` : 'HIDE VIA HOSAKA'}{ask.seconds !== null ? ` · ${waitLabel(ask.seconds).toUpperCase()}` : ''}
          </button>
          <button className="deploybar__decline" onClick={() => useShards.getState().declineDeploy()} {...noCallout}>NOT NOW</button>
          <PayTerms className="deploybar__terms" />
        </div>
      )}

      {/* Everything under the title scrolls inside the bar, which stops at
          35% of the screen's height (styles.css, "Route overlay"). */}
      <div className="deploybar__body">

      {/* STEP: finer placement than the zoom, with the camera left where it
          is (arkinox, 2026-10-08). The small white box in the cube is the
          cell it snaps to. Comma and period on a keyboard. */}
      <DeployRow kind="step" label="STEP" hint={formatCellSize(moveStep)}>
        <button className="deploybar__btn" {...bind(() => stepBuild(-1))} disabled={!stepOpen || moveStep <= 0} aria-label="Finer step (comma)" title="Finer step (,)">−</button>
        <span className="deploybar__value">2^{moveStep}</span>
        <button className="deploybar__btn" {...bind(() => stepBuild(1))} disabled={!stepOpen || moveStep >= scaleExp} aria-label="Coarser step (period)" title="Coarser step (.)">+</button>
      </DeployRow>

      {/* How full the bag is with this shard in it, in the form it goes out in. */}
      {meter && <BagMeterRow meter={meter} others={bagRows.length > 0} room={sealingId !== null} />}

      {/* What a chest wears (D2, D3): a built-in or OTHER, from MINE or FEED. */}
      {pending.type === 'chest' && look && <LookRow choices={door ? DOOR_LOOKS : CHEST_LOOKS} look={look} refusal={lookRefusal} size={lookSize} />}

      {/* Both steppers read the store inside the press rather than the value
          this render closed over: `bind` repeats the very same callback while
          the button is held, so a captured `height` would set the same number
          again and again and a held button would move exactly one step. */}
      {/* The height is the chest's, not a content's: an aim has none to show. A door keeps its own when it moves (R7). */}
      {!intoChest && !(door && moving) && (
        <DeployRow
          kind="height"
          label="HIDE AT HEIGHT"
          hintTitle={heightTip}
          hint={snap ? 'SET BY THE ROOM' : `${height === 0 ? 'this exact gibson' : `found within ${formatCellSize(height)}`}${fit.auto && fit.height !== null && fit.cause === 'contents' && height > 0 ? ' · raised to hold what is inside' : ''}`}
        >
          {/* In a room, the room's height holds: the X on the room chip above gives the steppers back. */}
          <button className="deploybar__btn" {...bind(() => { useShards.setState({ deployHeightAuto: false }); useShards.getState().setDeployHeight(useShards.getState().deployHeight - 1) })} disabled={!!snap || height <= (door ? 1 : 0)} aria-label="Lower height">−</button>
          <span className="deploybar__value">{height}</span>
          <button className="deploybar__btn" {...bind(() => { useShards.setState({ deployHeightAuto: false }); useShards.getState().setDeployHeight(useShards.getState().deployHeight + 1) })} disabled={!!snap || height >= ceiling} aria-label="Higher height">+</button>
          {/* Why an automatic height rose is a tooltip only (arkinox, 2026-10-08),
              except a chest raised for what is aimed inside, which says so in
              a few words in the note (arkinox, 2026-10-10). */}
        </DeployRow>
      )}
      {/* A door's own room (R6, §3.7.1): its height, at most the height it is
          hidden at. Lower, inside a room of yours at that room's height, it is
          a door behind that door. */}
      {door && !moving && (
        <DeployRow kind="roomheight" label="ROOM HEIGHT" hint={`locks ${formatCellSize(doorHeight)}`}>
          <button className="deploybar__btn" {...bind(() => { const s = useShards.getState(); s.setDeployDoorHeight(Math.max(1, placedDoorHeight(s) - 1)) })} disabled={doorHeight <= 1} aria-label="Lower room height">−</button>
          <span className="deploybar__value">{doorHeight}</span>
          {/* Inside a room of yours its own stays lower than that room's (§3.7.6), so + stops one short of it. */}
          <button className="deploybar__btn" {...bind(() => { const s = useShards.getState(); const next = placedDoorHeight(s) + 1; s.setDeployDoorHeight(s.deployRoomSnap ? Math.min(next, s.deployHeight - 1) : next >= s.deployHeight ? null : next) })} disabled={snap ? doorHeight >= height - 1 : doorHeight >= height} aria-label="Higher room height">+</button>
        </DeployRow>
      )}

      {!intoChest && fit.auto && fit.height === null && <FitNote cause={fit.cause} autoMax={autoMax} ceiling={ceiling} />}

      {/* Hidden audio's sphere (arkinox, 2026-10-23): full volume inside it,
          fading to silence at the region's walls; for a one-shot it is the
          trigger zone. Blue rings on the ghost show it. Never past the
          nearest wall: the stepper stops there, and the deploy clamps it to
          where it really lands. */}
      {pending.type === 'audio' && (() => {
        const a = pending.audio
        const oneShot = a.autoplay && !a.loop
        // What the deploy writes (lib/audioItem fadeAt): whole gibsons, never
        // past the room; AUTO is half the room, written as nothing.
        const r = a.fade === undefined ? fadeRoom / 2 : Math.max(0, Math.min(Math.floor(a.fade), Math.floor(fadeRoom)))
        const set = (dir: 1 | -1): void => {
          const s = useShards.getState()
          const p = s.pending
          if (p?.type !== 'audio') return
          const next = fadeStep(p.audio.fade ?? r, fadeRoom, dir)
          if (next !== null) s.setDeployFade(next)
        }
        return (
          <DeployRow
            kind="fade"
            label={oneShot ? 'TRIGGER ZONE' : 'FADE'}
            hintTitle={oneShot ? 'Entering this sphere starts it; it fades to silence at the region’s walls' : 'Full volume inside this sphere, fading to silence at the region’s walls'}
            hint={`${r < 1 ? 'no room here' : `${formatDistance(BigInt(Math.max(1, Math.round(r))))} radius`}${a.fade === undefined ? ' · auto' : ''}`}
          >
            <button className="deploybar__btn" {...bind(() => set(-1))} disabled={fadeRoom < 1 || r <= 1} aria-label="Smaller sphere">−</button>
            <span className="deploybar__value">{r < 1 ? '0' : Math.round(r)}</span>
            <button className="deploybar__btn" {...bind(() => set(1))} disabled={fadeRoom < 1 || r >= Math.floor(fadeRoom)} aria-label="Larger sphere">+</button>
            {a.fade !== undefined && <button className="deploybar__toggle" onClick={() => useShards.getState().setDeployFade(undefined)} title="Half the way to the nearest wall" {...noCallout}>AUTO</button>}
          </DeployRow>
        )
      })()}

      {/* Someone else's object from the Shard Feed: a copy that stays exactly
          as placed and credits its author, or LIVE LINK, a reference to their
          object that follows their edits (spec §7.6). Linked, the size and
          turns are theirs, so those rows step aside. */}
      {fromFeed && (
        <DeployRow kind="link" label="LIVE LINK" hint={link ? "follows the author's edits" : 'a copy, credited to its author'}>
          <button
            className={`deploybar__toggle ${link ? 'is-on' : ''}`}
            aria-pressed={link}
            disabled={guarded}
            title={guarded ? LINK_PROTECTED : undefined}
            onClick={() => useShards.getState().setDeployLink(!useShards.getState().deployLink)}
            {...noCallout}
          >{link ? 'ON' : 'OFF'}</button>
        </DeployRow>
      )}

      {/* How big the thing itself is, for this deployment only. The workshop's
          model keeps its own unit whatever is chosen here. */}
      {sized && !link && (
        <DeployRow kind="unit" label="SCALE" hint={`one unit = ${formatCellSize(unit)}`}>
          <button className="deploybar__btn" {...bind(() => useShards.getState().setDeployUnit(useShards.getState().deployUnit - 1))} disabled={unit <= 0} aria-label="Smaller scale">−</button>
          <span className="deploybar__value">2^{unit}</span>
          <button className="deploybar__btn" {...bind(() => useShards.getState().setDeployUnit(useShards.getState().deployUnit + 1))} disabled={unit >= MAX_UNIT} aria-label="Larger scale">+</button>
        </DeployRow>
      )}

      {/* Quarter turns about the object's own origin, for this deployment only:
          exact on the lattice, and every reader draws them (lib/turn.ts). */}
      {((sized && !link) || seedStands) && (
        <DeployRow kind="turn" label="TURN">
          {(['X', 'Y', 'Z'] as const).map((name, axis) => (
            <button key={name} className={`deploybar__btn deploybar__turn ${turn[axis] ? 'is-on' : ''}`} onClick={() => useShards.getState().turnDeploy(axis as 0 | 1 | 2)} aria-label={`Turn a quarter about ${name}, now ${turn[axis] * 90} degrees`} {...noCallout}>
              ↻{name} {turn[axis] * 90}°
            </button>
          ))}
          <button className="deploybar__btn deploybar__turn" disabled={turn.every((t) => t === 0)} onClick={() => useShards.getState().resetDeployTurn()} aria-label="Turn back to how it was built" {...noCallout}>RESET</button>
        </DeployRow>
      )}

      {/* Whether a walker can cross it in WALK (DECK-0003 §1.12), for this
          deployment, as SCALE is; the workshop's model keeps its own. Linked,
          it is the author's. */}
      {/* A FEED look's WALK setting is its object's author's, as a LIVE LINK's is. */}
      {sized && !link && look?.from !== 'feed' && (
        <DeployRow kind="constrain" label="CONSTRAIN MOVEMENT IN WALK MODE">
          <span className="deploybar__choices" role="group" aria-label="Constrain movement in WALK mode">
          {CONSTRAINS.map((c) => (
            <button
              key={c}
              className={`deploybar__toggle ${constrain === c ? 'is-on' : ''}`}
              aria-pressed={constrain === c}
              title={CONSTRAIN_TIPS[c]}
              onClick={() => useShards.getState().setDeployConstrain(c)}
              {...noCallout}
            >{c.toUpperCase()}</button>
          ))}
          </span>
        </DeployRow>
      )}

      {/* Standing on the ground, where there is ground: dataspace, and big
          enough that an orientation could ever be seen. */}
      {snapHere && (
        <DeployRow kind="snap" label="SNAP TO EARTH" hint={up ? 'bottom to Earth' : null}>
          <button
            className={`deploybar__toggle ${up ? 'is-on' : ''}`}
            aria-pressed={up}
            onClick={() => useShards.getState().setDeployUp(!useShards.getState().deployUp)}
            {...noCallout}
          >{up ? 'ON' : 'OFF'}</button>
        </DeployRow>
      )}

      {snapHere && up && (
        <DeployRow kind="spin" label="FINE ROTATION" hint={follow ? 'orbit to aim' : null}>
          <button
            className={`deploybar__toggle ${follow ? 'is-on' : ''}`}
            aria-pressed={follow}
            onClick={() => useShards.getState().setDeployFollow(!useShards.getState().deployFollow)}
            {...noCallout}
          >{follow ? 'ON' : 'OFF'}</button>
          <button className="deploybar__btn" {...bind(() => useShards.getState().setDeploySpin(useShards.getState().deploySpin - 1))} disabled={follow} aria-label="Turn counterclockwise">−</button>
          <span className="deploybar__value">SPIN {spin}°</span>
          <button className="deploybar__btn" {...bind(() => useShards.getState().setDeploySpin(useShards.getState().deploySpin + 1))} disabled={follow} aria-label="Turn clockwise">+</button>
        </DeployRow>
      )}

      {/* No paragraph here (arkinox, 2026-10-08: "these controls need to be
          tight"): how aiming works is in the Builder's EXPLAIN, and how far
          away it can be found is on the height row itself. */}

      {/* Behind a door the height says nothing about who can find it: the door does. */}
      <HeightWarnings height={height} intoChest={intoChest || !!sealing} localMax={inputs.localMax} />

      {/* What HOSAKA's key costs, its time and price, and whether the mode
          will ask first. This machine's time is the button's tooltip. An aim
          computes no key, and its bag is the chest's: neither row for it. */}
      {!intoChest && route !== 'local' && (
        <div className="deploybar__row deploybar__est">
          {quote
            ? `Computed by HOSAKA, ${quote.seconds !== null ? waitLabel(quote.seconds) : 'time unknown'} · ${quote.sats} sats from your balance${willAsk ? ', asked first' : cloudMode === 'auto' ? ', without asking (AUTO)' : ''}.`
            : `Computed by HOSAKA; its price for 2^${height} is not known yet.`}
        </div>
      )}

      {/* A room bag says nothing in public: no settings to choose (§3.7.2). */}
      {!intoChest && !sealing && <BagControls height={height} bag={bag} existing={existing?.count ?? 0} claimable={moneyRowShown(pending, existing)} />}
      </div>

    </div>
  )
}

/** 2 to a power, the power raised, legible at the bar's small type. */
function Pow({ e }: { e: number }): JSX.Element {
  return <>2<sup>{e}</sup></>
}

/**
 * The bag's public settings (lib/hidden.ts BagSettings), for shards and
 * messages alike. `existing` is how many of your things the cursor's region
 * already holds: the settings are that bag's, and the bar says so.
 */
export function BagControls({ height, bag, existing, claimable }: { height: number; bag: ReturnType<typeof useShards.getState>['deployBag']; existing: number; claimable: boolean }): JSX.Element {
  const set = (patch: Partial<typeof bag>): void => useShards.getState().setDeployBag(patch)
  // The sector hint your saved switch has ON, which this height took off, to come back on lower down.
  const held = useShards((s) => s.deployHintHeld !== null)
  // A hint must be at least the bag's height (spec §7.7); a sector is 2^30.
  const sectorFits = height <= SECTOR_HEIGHT
  // A finer box another client wrote is kept as it is while the switch stays on.
  const otherBox = bag.hint && !isSectorHint(bag.hint) ? bag.hint : null
  return (
    <div className="deploybar__bag">
      {/* A chip, its explanation the tooltip (arkinox, 2026-10-08: trim the
          deploy bar). */}
      <span
        className="deploybar__scope"
        title={existing > 0
          ? `You already hid ${existing === 1 ? 'one thing' : `${existing} things`} in this region. These settings are its bag's, so they apply to everything you hid here as well as this.`
          : `These settings belong to this region's bag: anything else you hide in this region later shares them.`}
      >
        {existing > 0 ? `BAG · ${existing} HERE` : 'NEW BAG'}
      </span>

      <Field id="deploy-height-hint" label="Publish height hint" hint="Tells seekers what height they must calculate to in order to find this.">
        <Switch id="deploy-height-hint" checked={bag.heightTag} onCheckedChange={(v) => set({ heightTag: v })} />
      </Field>

      <Field
        id="deploy-sector-hint"
        label="Publish sector hint"
        hint={otherBox
          ? <>This bag already carries a hint box of heights {otherBox.join(', ')}, written by another client. On keeps it as it is; off removes it.</>
          : sectorFits
            ? <>Tells seekers which sector this is hidden in: one cube <Pow e={SECTOR_HEIGHT} /> gibsons on a side, instead of all of cyberspace at <Pow e={AXIS_BITS} /> on a side. That cuts their search from <Pow e={searchExponent(height, AXIS_BITS)} /> regions of this size to <Pow e={searchExponent(height, SECTOR_HEIGHT)} />.</>
            : <>Not available at height {height}: a sector is <Pow e={SECTOR_HEIGHT} /> gibsons on a side, smaller than this region, so no sector can contain it.{held ? ` It turns back on at height ${SECTOR_HEIGHT} or lower.` : ''}</>}
      >
        <Switch
          id="deploy-sector-hint"
          checked={bag.hint !== null}
          disabled={!otherBox && !sectorFits}
          onCheckedChange={(v) => set({ hint: v ? SECTOR_HINT : null })}
        />
      </Field>

      {/* What is inside, by kind and count, on the bag's face (arkinox,
          2026-10-18: bags with "a little more personality", hyped on
          Cyberspace TV); money and NFTs only when their own switch is on,
          which starts off and shows whenever a cashu token or an NFT claim
          link is inside (arkinox, 2026-11-15: "money off by default"; owner
          ruling 2026-11-16: NFTs the same way). Worked out from the bag each
          time it is sealed (lib/hidden.ts bagContentsTags). */}
      <Field id="deploy-contents-hint" label="Publish contents" hint="Tells seekers what is inside: how many shards, messages, keys and chests. Not where, and not what they say. Money and NFTs stay secret unless you publish them.">
        <Switch id="deploy-contents-hint" checked={bag.contents} onCheckedChange={(v) => set({ contents: v })} />
      </Field>
      {claimable && (
        <Field
          id="deploy-money-hint"
          label="Publish that money or NFTs are inside"
          hint={bag.contents
            ? 'Tells seekers how many cashu tokens and NFTs are in this bag, not what they hold. Off, the contents leave them out.'
            : 'Tells seekers there is cashu or an NFT in this bag, without saying how many.'}
        >
          <Switch id="deploy-money-hint" checked={bag.money} onCheckedChange={(v) => set({ money: v })} />
        </Field>
      )}

      <div className="deploybar__riddle">
        <label className="ui-field__text" htmlFor="deploy-riddle">
          <span className="ui-field__label">Hint message</span>
          <span className="ui-field__hint">Leave an optional hint for seekers to help them find this so they don&apos;t have to search all of cyberspace.</span>
        </label>
        <textarea
          id="deploy-riddle"
          className="deploybar__input"
          rows={2}
          maxLength={MAX_RIDDLE_LENGTH}
          value={bag.riddle}
          onChange={(e) => set({ riddle: e.target.value })}
          placeholder="A riddle, a landmark, a clue"
        />
        <div className="deploybar__count">
          <span>Public: anyone can read it without finding this.</span>
          <span>{bag.riddle.length}/{MAX_RIDDLE_LENGTH}</span>
        </div>
      </div>
    </div>
  )
}
