/**
 * DeployBar.tsx — placing a shard in the world.
 *
 * While this is up you are aiming, not moving: a deploy happens in BUILD mode
 * (store/useBuilder.ts), so the build cursor picks the spot (WASD, the pad,
 * the zoom, the Position panel, all of it), the shard ghosts there, and
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
 * Three more choices belong to the BAG rather than to this item, because a bag
 * is one event per author and region holding everything hidden there (spec
 * §7.6) (arkinox, 2026-10-01):
 *   - PUBLISH HEIGHT HINT: whether the bag carries its `h` tag (spec §8.6, optional).
 *   - PUBLISH SECTOR HINT: a hint naming the bag's sector, heights of 30 on
 *     every axis, with its X, Y, Z and S sector tags (spec §7.7, §10). A hint
 *     must be at least the bag's height, so it is off above height 30.
 *   - HINT MESSAGE: a riddle in the bag's plaintext `content` (spec §7.7).
 * When the cursor's region already holds your bag, they start at that bag's
 * settings and the bar says they apply to everything you hid there.
 *
 * On a phone the bar is capped at a quarter of the screen's height so what is
 * being hidden stays in view at the centre (arkinox's rule, 2026-10-01). The
 * title and the deploy button are pinned and everything between them scrolls,
 * so the button is always one tap away however many rows are open.
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

import { useEffect, useMemo } from 'react'
import { noCallout, useRepeatable } from '../hooks/useRepeatable'
import { MAX_UNIT } from 'sno-core/shards'
import { formatCellSize } from 'sno-core/scale'
import { LINK_PROTECTED, SCAN_MAX_HEIGHT, aimedOf, isProtected, ownBagIn, pendingEmpty, pendingName, regionOf, useShards } from '../store/useShards'
import { aimedPoint } from '../lib/chests'
import { snapOffered } from '../lib/pose'
import { MAX_RIDDLE_LENGTH } from '../lib/hidden'
import { findCashuToken } from '../lib/cashu'
import { AXIS_BITS, SECTOR_HEIGHT, SECTOR_HINT, isSectorHint, searchExponent } from '../lib/hint'
import { deployPoint } from '../lib/space'
import { buildPlane, buildStepOf } from '../lib/buildCursor'
import { stepBuild } from '../store/buildStep'
import { useBuilder } from '../store/useBuilder'
import { Field, Switch } from './ui/Switch'
import { ItemIcon } from './ItemIcon'
import { MAX_COMPUTE_HEIGHT, useCyberspace } from '../store/useCyberspace'
import { useCalibration } from '../lib/calibration'
import { ratioOf, useExperience } from '../lib/experience'
import { cloudKeyQuote, deployCeiling, deployRoute, localKeySeconds, needsAsk, waitLabel } from '../lib/deployPlan'
import { useEscape } from '../hooks/useEscape'
import { fitCause, fitHeight, fitHeightAll, outsideAt, type FitPoint } from '../lib/deployFit'

export function DeployBar(): JSX.Element | null {
  const pending = useShards((s) => s.pending)
  const shard = useShards((s) => (s.pending?.type === 'shard' ? s.pendingShard() : null))
  // A shard being aimed into a chest: signed where it stands, not hidden.
  const intoChest = useShards((s) => s.pending?.type === 'shard' && !!s.pending.intoChest)
  const chestName = useShards((s) => (s.pending?.type === 'shard' ? s.pending.intoChest?.draft.name ?? null : null))
  const height = useShards((s) => s.deployHeight)
  const unit = useShards((s) => s.deployUnit)
  const status = useShards((s) => s.deployStatus)
  const error = useShards((s) => s.deployError)
  const note = useShards((s) => s.deployNote)
  const ask = useShards((s) => s.deployAsk)
  const live = useCyberspace((s) => s.live)
  const cloudMode = useCyberspace((s) => s.cloudPrefs.mode)
  const autoMaxSats = useCyberspace((s) => s.cloudPrefs.autoMaxSats)
  const cloudCap = useCyberspace((s) => s.cloud.limits?.max_hop_height ?? null)
  const ladder = useCyberspace((s) => s.cloud.provider?.pricing?.hop)
  // The plane the build cursor is in: the build view's (lib/buildCursor.ts).
  const plane = useCyberspace(buildPlane)
  const up = useShards((s) => s.deployUp)
  const spin = useShards((s) => s.deploySpin)
  const turn = useShards((s) => s.deployTurn)
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
  // The region the deploy would land in, as a string, so the bar re-renders
  // when the cursor crosses into another region and not on every step.
  const region = useCyberspace((s) => regionOf(deployPoint(s.cursor, buildStepOf(s), height), buildPlane(s), height))
  const existing = useMemo(() => ownBagIn(mine, region), [mine, region])
  // Hooks stay above the early return below. The controls take this region's
  // bag settings when the cursor's region changes (seedDeployBag decides).
  useEffect(() => {
    if (pending) useShards.getState().seedDeployBag(existing)
  }, [pending, existing])

  const inputs = { localMax: Math.min(MAX_COMPUTE_HEIGHT, hopLimit), cloudMode, cloudCap }
  const ceiling = deployCeiling(inputs)
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
  // The build STEP: how far a move steps and the cell the placement snaps to
  // (store/buildStep.ts), the zoom until it is lowered.
  const step = useCyberspace(buildStepOf)
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
  // What the height is fitted to: a shard's own reach, or the chest's aimed contents.
  const fitting = !!shard || aimed.points.length > 0
  const fitH = useMemo(
    () => (shard ? fitHeight(shard, unit, cursor, step, 0, ceiling) : aimed.points.length > 0 ? fitHeightAll(0n, aimed.points, cursor, step, 0, ceiling) : null),
    [shard, unit, cursor, step, ceiling, aimed],
  )
  useEffect(() => {
    if (!heightAuto || !fitting) return
    const want = fitH ?? ceiling
    if (want !== useShards.getState().deployHeight) useShards.getState().setDeployHeight(want)
  }, [heightAuto, fitting, fitH, ceiling])
  const fit: { auto: boolean; height: number | null; cause: 'size' | 'edge' | 'contents' } = { auto: heightAuto && fitting, height: fitH, cause: shard ? fitCause(shard, unit, fitH, ceiling) : 'contents' }
  // Aimed contents the region at this height does not hold: they stand at the chest when it opens (revealedIn).
  const outside = aimed.points.length + aimed.elsewhere === 0 ? 0 : outsideAt(deployPoint(cursor, step, height), height, aimed.points) + aimed.elsewhere
  // STEP changes only the build cursor: in BUILD mode, its view drivable, not
  // at your head, and not while hiding (store/buildStep.ts stepOpen).
  const building = useBuilder((s) => s.active)
  const drivable = useCyberspace((s) => s.canDrive() && !s.atHead())

  useEscape('chip', pending !== null, () => {
    const s = useShards.getState()
    if (s.deployAsk) s.declineDeploy()
    else s.cancelDeploy()
  })

  if (!pending) return null

  // A message, a key and a chest have no size or pose: only a shard gets those rows.
  const isMessage = pending.type !== 'shard'
  const title = intoChest ? 'AIM' : pending.type === 'shard' ? 'DEPLOY' : `HIDE ${pending.type.toUpperCase()}`
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
  const heightTip = outside > 0
    ? `${outside} aimed inside ${outside === 1 ? 'stands' : 'stand'} at the chest when it opens: outside this region`
    : fit.auto && fit.height !== null && fit.cause === 'contents'
      ? 'Raised to hold what is aimed inside. Lower it and whatever falls outside stands at the chest when it opens'
      : fit.auto && fit.height !== null && fit.cause === 'edge'
        ? 'Raised because it sits across a region edge; move it to hide lower'
        : undefined

  return (
    <div className="deploybar" role="dialog" aria-label={intoChest ? 'Aim shard for chest' : pending.type === 'shard' ? 'Deploy shard' : `Hide ${pending.type}`}>
      {/* The title row carries the action, left of CANCEL, so the rest of the
          bar is free to scroll (arkinox, 2026-10-01). While HOSAKA's ask is up
          it takes its own row below, since three buttons do not fit here. */}
      <div className="deploybar__row deploybar__head">
        <ItemIcon className="deploybar__eye" type={pending.type} coin={pending.type === 'message' && findCashuToken(pending.text) !== null} />
        <span className="deploybar__title">
          {title} <strong>{name}</strong>
        </span>
        {!ask && (
          <button
            className="deploybar__deploy"
            disabled={empty || working}
            title={localEst}
            onClick={() => void useShards.getState().deploy()}
            {...noCallout}
          >
            {empty ? `${pending.type.toUpperCase()} IS EMPTY` : working ? (note ? `${note.toUpperCase()}…` : 'HIDING…') : intoChest ? 'PUT IN CHEST' : route === 'cloud' ? 'HIDE VIA HOSAKA' : live ? 'HIDE & PUBLISH' : 'HIDE (LOCAL)'}
          </button>
        )}
        {/* Once hiding, it finishes where it was placed: CANCEL would only pretend. */}
        <button className="deploybar__cancel" disabled={working} title={working ? 'Already hiding; it finishes where you placed it' : undefined} onClick={() => useShards.getState().cancelDeploy()}>CANCEL</button>
      </div>

      {error && <div className="deploybar__row notice">{error}</div>}
      {/* The ask takes the button's place: the same green, now the yes, with
          the price and the wait on it, and a way to stand down beside it. */}
      {ask && (
        <div className="deploybar__ask">
          <button className="deploybar__deploy" onClick={() => useShards.getState().confirmDeploy()} {...noCallout}>
            {ask.sats !== null ? `${ask.sats} SATS` : 'HIDE VIA HOSAKA'}{ask.seconds !== null ? ` · ${waitLabel(ask.seconds).toUpperCase()}` : ''}
          </button>
          <button className="deploybar__decline" onClick={() => useShards.getState().declineDeploy()} {...noCallout}>NOT NOW</button>
        </div>
      )}

      {/* Everything between the title and the button scrolls inside the bar,
          which a phone caps at a quarter of the screen (styles.css). */}
      <div className="deploybar__body">

      {/* STEP: finer placement than the zoom, with the camera left where it
          is (arkinox, 2026-10-08). The small white box in the cube is the
          cell it snaps to. Comma and period on a keyboard. */}
      <div className="deploybar__row deploybar__row--step">
        <span className="deploybar__label">STEP</span>
        <button className="deploybar__btn" {...bind(() => stepBuild(-1))} disabled={!stepOpen || step <= 0} aria-label="Finer step (comma)" title="Finer step (,)">−</button>
        <span className="deploybar__value">2^{step}</span>
        <button className="deploybar__btn" {...bind(() => stepBuild(1))} disabled={!stepOpen || step >= scaleExp} aria-label="Coarser step (period)" title="Coarser step (.)">+</button>
        <span className="deploybar__radius">{formatCellSize(step)}</span>
      </div>

      {/* Both steppers read the store inside the press rather than the value
          this render closed over: `bind` repeats the very same callback while
          the button is held, so a captured `height` would set the same number
          again and again and a held button would move exactly one step. */}
      {/* The height is the chest's, not a content's: an aim has none to show. */}
      {!intoChest && (
        <div className="deploybar__row deploybar__row--height">
          <span className="deploybar__label">HIDE AT HEIGHT</span>
          <button className="deploybar__btn" {...bind(() => { useShards.setState({ deployHeightAuto: false }); useShards.getState().setDeployHeight(useShards.getState().deployHeight - 1) })} disabled={height <= 0} aria-label="Lower height">−</button>
          <span className="deploybar__value">{height}</span>
          <button className="deploybar__btn" {...bind(() => { useShards.setState({ deployHeightAuto: false }); useShards.getState().setDeployHeight(useShards.getState().deployHeight + 1) })} disabled={height >= ceiling} aria-label="Higher height">+</button>
          {/* Why an automatic height rose is a tooltip only (arkinox, 2026-10-08),
              except a chest raised for what is aimed inside, which says so in
              a few words (arkinox, 2026-10-10). */}
          <span className="deploybar__radius" title={heightTip}>
            {height === 0 ? 'this exact gibson' : `found within ${formatCellSize(height)}`}
            {fit.auto && fit.height !== null && fit.cause === 'contents' && height > 0 ? ' · raised to hold what is inside' : ''}
          </span>
        </div>
      )}
      {!intoChest && fit.auto && fit.height === null && (
        <div className="deploybar__row deploybar__fitnote">{fit.cause === 'edge'
          ? 'Sits across a region edge; move it to fit.'
          : fit.cause === 'contents'
            ? <>No region up to 2^{ceiling} holds the chest and everything aimed inside it; what falls outside stands at the chest when it opens.</>
            : <>At this scale the model is larger than any region up to 2^{ceiling}; part of it will be cut off. Hide it at a smaller scale, or move the cursor.</>}</div>
      )}

      {/* Someone else's object from the Shard Feed: a copy that stays exactly
          as placed and credits its author, or LIVE LINK, a reference to their
          object that follows their edits (spec §7.6). Linked, the size and
          turns are theirs, so those rows step aside. */}
      {fromFeed && (
        <div className="deploybar__row deploybar__row--link">
          <span className="deploybar__label">LIVE LINK</span>
          <button
            className={`deploybar__toggle ${link ? 'is-on' : ''}`}
            aria-pressed={link}
            disabled={guarded}
            title={guarded ? LINK_PROTECTED : undefined}
            onClick={() => useShards.getState().setDeployLink(!useShards.getState().deployLink)}
            {...noCallout}
          >{link ? 'ON' : 'OFF'}</button>
          <span className="deploybar__radius">{link ? "follows the author's edits" : 'a copy, credited to its author'}</span>
        </div>
      )}

      {/* How big the thing itself is, for this deployment only. The workshop's
          model keeps its own unit whatever is chosen here. */}
      {!isMessage && !link && (
        <div className="deploybar__row deploybar__row--unit">
          <span className="deploybar__label">SCALE</span>
          <button className="deploybar__btn" {...bind(() => useShards.getState().setDeployUnit(useShards.getState().deployUnit - 1))} disabled={unit <= 0} aria-label="Smaller scale">−</button>
          <span className="deploybar__value">2^{unit}</span>
          <button className="deploybar__btn" {...bind(() => useShards.getState().setDeployUnit(useShards.getState().deployUnit + 1))} disabled={unit >= MAX_UNIT} aria-label="Larger scale">+</button>
          <span className="deploybar__radius">one unit = {formatCellSize(unit)}</span>
        </div>
      )}

      {/* Quarter turns about the object's own origin, for this deployment only:
          exact on the lattice, and every reader draws them (lib/turn.ts). */}
      {!isMessage && !link && (
        <div className="deploybar__row deploybar__row--turn">
          <span className="deploybar__label">TURN</span>
          {(['X', 'Y', 'Z'] as const).map((name, axis) => (
            <button key={name} className={`deploybar__btn deploybar__turn ${turn[axis] ? 'is-on' : ''}`} onClick={() => useShards.getState().turnDeploy(axis as 0 | 1 | 2)} aria-label={`Turn a quarter about ${name}, now ${turn[axis] * 90} degrees`} {...noCallout}>
              ↻{name} {turn[axis] * 90}°
            </button>
          ))}
          <button className="deploybar__btn deploybar__turn" disabled={turn.every((t) => t === 0)} onClick={() => useShards.getState().resetDeployTurn()} aria-label="Turn back to how it was built" {...noCallout}>RESET</button>
        </div>
      )}

      {/* Standing on the ground, where there is ground: dataspace, and big
          enough that an orientation could ever be seen. */}
      {!isMessage && !link && snapOffered(plane, height) && (
        <div className="deploybar__row deploybar__row--snap">
          <span className="deploybar__label">SNAP TO EARTH</span>
          <button
            className={`deploybar__toggle ${up ? 'is-on' : ''}`}
            aria-pressed={up}
            onClick={() => useShards.getState().setDeployUp(!useShards.getState().deployUp)}
            {...noCallout}
          >{up ? 'ON' : 'OFF'}</button>
          {up && <span className="deploybar__radius">bottom to Earth</span>}
        </div>
      )}

      {!isMessage && !link && snapOffered(plane, height) && up && (
        <div className="deploybar__row deploybar__row--spin">
          <span className="deploybar__label">FINE ROTATION</span>
          <button
            className={`deploybar__toggle ${follow ? 'is-on' : ''}`}
            aria-pressed={follow}
            onClick={() => useShards.getState().setDeployFollow(!useShards.getState().deployFollow)}
            {...noCallout}
          >{follow ? 'ON' : 'OFF'}</button>
          <button className="deploybar__btn" {...bind(() => useShards.getState().setDeploySpin(useShards.getState().deploySpin - 1))} disabled={follow} aria-label="Turn counterclockwise">−</button>
          <span className="deploybar__value">SPIN {spin}°</span>
          <button className="deploybar__btn" {...bind(() => useShards.getState().setDeploySpin(useShards.getState().deploySpin + 1))} disabled={follow} aria-label="Turn clockwise">+</button>
          {follow && <span className="deploybar__radius">orbit to aim</span>}
        </div>
      )}

      {/* No paragraph here (arkinox, 2026-10-08: "these controls need to be
          tight"): how aiming works is in the Builder's EXPLAIN, and how far
          away it can be found is on the height row itself. */}

      {!intoChest && height > SCAN_MAX_HEIGHT && (
        <div className="deploybar__row deploybar__warn">
          ⚠ Past height {SCAN_MAX_HEIGHT}, discovery will not surface this automatically. Only someone who already knows this spot and height can compute the region and open it.
        </div>
      )}

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

      {!intoChest && <BagControls height={height} bag={bag} existing={existing?.count ?? 0} />}
      </div>

    </div>
  )
}

/** 2 to a power, the power raised, legible at the bar's small type. */
function Pow({ e }: { e: number }): JSX.Element {
  return <>2<sup>{e}</sup></>
}

/**
 * The bag's three public settings (lib/hidden.ts BagSettings), for shards and
 * messages alike. `existing` is how many of your things the cursor's region
 * already holds: the settings are that bag's, and the bar says so.
 */
function BagControls({ height, bag, existing }: { height: number; bag: ReturnType<typeof useShards.getState>['deployBag']; existing: number }): JSX.Element {
  const set = (patch: Partial<typeof bag>): void => useShards.getState().setDeployBag(patch)
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
            : <>Not available at height {height}: a sector is <Pow e={SECTOR_HEIGHT} /> gibsons on a side, smaller than this region, so no sector can contain it.</>}
      >
        <Switch
          id="deploy-sector-hint"
          checked={bag.hint !== null}
          disabled={!otherBox && !sectorFits}
          onCheckedChange={(v) => set({ hint: v ? SECTOR_HINT : null })}
        />
      </Field>

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
