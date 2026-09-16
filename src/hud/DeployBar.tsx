/**
 * DeployBar.tsx — placing a shard in the world.
 *
 * While this is up you are aiming, not moving: the movement cursor picks the
 * spot (WASD, the pad, all of it), the shard ghosts there, and DEPLOY hides it
 * at the cursor. The one real choice is the height, which is the discovery
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
 */

import { noCallout, useRepeatable } from '../hooks/useRepeatable'
import { MAX_UNIT } from 'sno-core/shards'
import { formatCellSize } from 'sno-core/scale'
import { SCAN_MAX_HEIGHT, useShards } from '../store/useShards'
import { snapOffered } from '../lib/pose'
import { messagePreview } from '../lib/hidden'
import { MAX_COMPUTE_HEIGHT, useCyberspace } from '../store/useCyberspace'
import { useCalibration } from '../lib/calibration'
import { ratioOf, useExperience } from '../lib/experience'
import { cloudKeyQuote, deployCeiling, deployRoute, localKeySeconds, needsAsk, waitLabel } from '../lib/deployPlan'

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
  const plane = useCyberspace((s) => s.plane)
  const up = useShards((s) => s.deployUp)
  const spin = useShards((s) => s.deploySpin)
  const follow = useShards((s) => s.deployFollow)
  const cantorMs = useCalibration((s) => s.cantorMsByHeight)
  // This machine's limit: the calibrated hop ceiling the movement panel shows.
  const hopLimit = useCalibration((s) => s.hopHeight)
  const bind = useRepeatable()

  const inputs = { localMax: Math.min(MAX_COMPUTE_HEIGHT, hopLimit), cloudMode, cloudCap }
  const ceiling = deployCeiling(inputs)
  const route = deployRoute(height, inputs)
  const localSeconds = localKeySeconds(height, cantorMs)
  const experience = useExperience((s) => ratioOf(s.samples))
  const quote = route === 'cloud' ? cloudKeyQuote(height, ladder, experience) : null
  const willAsk = route === 'cloud' && needsAsk(cloudMode, quote?.sats ?? null, autoMaxSats)

  if (!pending) return null

  const isMessage = pending.type === 'message'
  const name = isMessage ? messagePreview(pending.text) : shard?.name ?? 'shard'
  const empty = isMessage ? pending.text.trim().length === 0 : !shard || shard.vertices.length === 0
  const working = status === 'working'

  return (
    <div className="deploybar" role="dialog" aria-label="Deploy shard">
      <div className="deploybar__row">
        <span className="deploybar__eye" aria-hidden="true">◇</span>
        <span className="deploybar__title">
          {isMessage ? 'HIDE MESSAGE' : 'DEPLOY'} <strong>{name}</strong>
        </span>
        <button className="deploybar__cancel" onClick={() => useShards.getState().cancelDeploy()}>CANCEL</button>
      </div>

      {/* Both steppers read the store inside the press rather than the value
          this render closed over: `bind` repeats the very same callback while
          the button is held, so a captured `height` would set the same number
          again and again and a held button would move exactly one step. */}
      <div className="deploybar__row deploybar__row--height">
        <span className="deploybar__label">HIDE AT HEIGHT</span>
        <button className="deploybar__btn" {...bind(() => useShards.getState().setDeployHeight(useShards.getState().deployHeight - 1))} disabled={height <= 0} aria-label="Lower height">−</button>
        <span className="deploybar__value">{height}</span>
        <button className="deploybar__btn" {...bind(() => useShards.getState().setDeployHeight(useShards.getState().deployHeight + 1))} disabled={height >= ceiling} aria-label="Higher height">+</button>
        <span className="deploybar__radius">
          {height === 0 ? 'this exact gibson' : `found within ${formatCellSize(height)}`}
        </span>
      </div>

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
        Aim with the movement controls; the ghost is where it lands.
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

      {error && <div className="deploybar__row notice">{error}</div>}

      {/* The ask takes the button's place: the same green, now the yes, with
          the price and the wait on it, and a way to stand down beside it. */}
      {ask ? (
        <div className="deploybar__ask">
          <button className="deploybar__deploy" onClick={() => useShards.getState().confirmDeploy()} {...noCallout}>
            {ask.sats !== null ? `${ask.sats} SATS` : 'HIDE VIA HOSAKA'}{ask.seconds !== null ? ` · ${waitLabel(ask.seconds).toUpperCase()}` : ''}
          </button>
          <button className="deploybar__decline" onClick={() => useShards.getState().declineDeploy()} {...noCallout}>NOT NOW</button>
        </div>
      ) : (
        <button
          className="deploybar__deploy"
          disabled={empty || working}
          onClick={() => void useShards.getState().deploy()}
          {...noCallout}
        >
          {empty ? (isMessage ? 'MESSAGE IS EMPTY' : 'SHARD IS EMPTY') : working ? (note ? `${note.toUpperCase()}…` : 'HIDING…') : route === 'cloud' ? 'HIDE VIA HOSAKA' : live ? 'HIDE & PUBLISH' : 'HIDE (LOCAL)'}
        </button>
      )}
    </div>
  )
}
