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
 */

import { useEffect, useMemo } from 'react'
import { noCallout, useRepeatable } from '../hooks/useRepeatable'
import { MAX_UNIT } from 'sno-core/shards'
import { formatCellSize } from 'sno-core/scale'
import { SCAN_MAX_HEIGHT, ownBagIn, regionOf, useShards } from '../store/useShards'
import { snapOffered } from '../lib/pose'
import { MAX_RIDDLE_LENGTH, messagePreview } from '../lib/hidden'
import { AXIS_BITS, SECTOR_HEIGHT, SECTOR_HINT, isSectorHint, searchExponent } from '../lib/hint'
import { deployPoint } from '../lib/space'
import { buildPlane } from '../lib/buildCursor'
import { Field, Switch } from './ui/Switch'
import { MAX_COMPUTE_HEIGHT, useCyberspace } from '../store/useCyberspace'
import { useCalibration } from '../lib/calibration'
import { ratioOf, useExperience } from '../lib/experience'
import { cloudKeyQuote, deployCeiling, deployRoute, localKeySeconds, needsAsk, waitLabel } from '../lib/deployPlan'
import { useEscape } from '../hooks/useEscape'
import { fitHeight } from '../lib/deployFit'

export function DeployBar(): JSX.Element | null {
  const pending = useShards((s) => s.pending)
  const shard = useShards((s) => (s.pending?.type === 'shard' ? s.pendingShard() : null))
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
  const region = useCyberspace((s) => regionOf(deployPoint(s.cursor, s.scaleExp, height), buildPlane(s), height))
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
  const fitH = useMemo(() => (shard ? fitHeight(shard, unit, cursor, scaleExp, 0, ceiling) : null), [shard, unit, cursor, scaleExp, ceiling])
  useEffect(() => {
    if (!heightAuto || !shard) return
    const want = fitH ?? ceiling
    if (want !== useShards.getState().deployHeight) useShards.getState().setDeployHeight(want)
  }, [heightAuto, shard, fitH, ceiling])
  const fit = { auto: heightAuto && !!shard, height: fitH }

  useEscape('chip', pending !== null, () => {
    const s = useShards.getState()
    if (s.deployAsk) s.declineDeploy()
    else s.cancelDeploy()
  })

  if (!pending) return null

  const isMessage = pending.type === 'message'
  const name = isMessage ? messagePreview(pending.text) : shard?.name ?? 'shard'
  const empty = isMessage ? pending.text.trim().length === 0 : !shard || (shard.vertices.length === 0 && (shard.parts?.length ?? 0) === 0)
  const working = status === 'working'

  return (
    <div className="deploybar" role="dialog" aria-label={isMessage ? 'Hide message' : 'Deploy shard'}>
      {/* The title row carries the action, left of CANCEL, so the rest of the
          bar is free to scroll (arkinox, 2026-10-01). While HOSAKA's ask is up
          it takes its own row below, since three buttons do not fit here. */}
      <div className="deploybar__row deploybar__head">
        <span className="deploybar__eye" aria-hidden="true">◇</span>
        <span className="deploybar__title">
          {isMessage ? 'HIDE MESSAGE' : 'DEPLOY'} <strong>{name}</strong>
        </span>
        {!ask && (
          <button
            className="deploybar__deploy"
            disabled={empty || working}
            onClick={() => void useShards.getState().deploy()}
            {...noCallout}
          >
            {empty ? (isMessage ? 'MESSAGE IS EMPTY' : 'SHARD IS EMPTY') : working ? (note ? `${note.toUpperCase()}…` : 'HIDING…') : route === 'cloud' ? 'HIDE VIA HOSAKA' : live ? 'HIDE & PUBLISH' : 'HIDE (LOCAL)'}
          </button>
        )}
        <button className="deploybar__cancel" onClick={() => useShards.getState().cancelDeploy()}>CANCEL</button>
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

      {/* Both steppers read the store inside the press rather than the value
          this render closed over: `bind` repeats the very same callback while
          the button is held, so a captured `height` would set the same number
          again and again and a held button would move exactly one step. */}
      <div className="deploybar__row deploybar__row--height">
        <span className="deploybar__label">HIDE AT HEIGHT</span>
        <button className="deploybar__btn" {...bind(() => { useShards.setState({ deployHeightAuto: false }); useShards.getState().setDeployHeight(useShards.getState().deployHeight - 1) })} disabled={height <= 0} aria-label="Lower height">−</button>
        <span className="deploybar__value">{height}</span>
        <button className="deploybar__btn" {...bind(() => { useShards.setState({ deployHeightAuto: false }); useShards.getState().setDeployHeight(useShards.getState().deployHeight + 1) })} disabled={height >= ceiling} aria-label="Higher height">+</button>
        <span className="deploybar__radius">
          {height === 0 ? 'this exact gibson' : `found within ${formatCellSize(height)}`}
          {fit.auto && fit.height !== null && <span className="deploybar__fit"> · fits the whole model</span>}
        </span>
      </div>
      {fit.auto && fit.height === null && (
        <div className="deploybar__row deploybar__fitnote">At this scale the model is larger than any region up to 2^{ceiling}; part of it will be cut off. Hide it at a smaller scale, or move the cursor.</div>
      )}

      {/* How big the thing itself is, for this deployment only. The workshop's
          model keeps its own unit whatever is chosen here. */}
      {!isMessage && (
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
      {!isMessage && (
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
      {!isMessage && snapOffered(plane, height) && (
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

      {!isMessage && snapOffered(plane, height) && up && (
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

      <div className="deploybar__row deploybar__hint">
        Aim with the build cursor: the movement controls move it, and zooming out with + makes every step and the cell it lands in bigger. The ghost is where it lands. Building does not move your avatar.
        {!isMessage && snapOffered(plane, height) && up && ' Stands the shard on the ground here, bottom to Earth. SPIN is the compass bearing its +Z faces.'}
        {height === 0
          ? ' At height 0 only someone on this exact point can find it.'
          : ` Anyone who computes this ${formatCellSize(height)} region can find and open it.`}
      </div>

      {height > SCAN_MAX_HEIGHT && (
        <div className="deploybar__row deploybar__warn">
          ⚠ Past height {SCAN_MAX_HEIGHT}, discovery will not surface this automatically. Only someone who already knows this spot and height can compute the region and open it.
        </div>
      )}

      {/* What the key costs: this machine's time below its ceiling, HOSAKA's
          time and price above it, and whether the mode will ask first. */}
      <div className="deploybar__row deploybar__est">
        {route === 'local'
          ? (height === 0 ? 'No key work at height 0.' : localSeconds === null ? `Computed on this machine; the benchmark has not run yet.` : `Computed on this machine, ${waitLabel(localSeconds)}.`)
          : quote
            ? `Computed by HOSAKA, ${quote.seconds !== null ? waitLabel(quote.seconds) : 'time unknown'} · ${quote.sats} sats from your balance${willAsk ? ', asked first' : cloudMode === 'auto' ? ', without asking (AUTO)' : ''}.`
            : `Computed by HOSAKA; its price for 2^${height} is not known yet.`}
      </div>

      <BagControls height={height} bag={bag} existing={existing?.count ?? 0} />
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
      <div className="deploybar__scope">
        {existing > 0
          ? <>You already hid {existing === 1 ? 'one thing' : `${existing} things`} in this region. These settings are its bag&apos;s, so they apply to everything you hid here as well as this.</>
          : <>These settings belong to this region&apos;s bag: anything else you hide in this region later shares them.</>}
      </div>

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
