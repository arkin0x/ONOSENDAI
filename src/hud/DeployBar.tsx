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
 */

import { noCallout, useRepeatable } from '../hooks/useRepeatable'
import { formatCellSize } from '../lib/scale'
import { SCAN_MAX_HEIGHT, useShards } from '../store/useShards'
import { messagePreview } from '../lib/hidden'
import { MAX_COMPUTE_HEIGHT, useCyberspace } from '../store/useCyberspace'
import { useCalibration } from '../lib/calibration'
import { ratioOf, useExperience } from '../lib/experience'
import { cloudKeyQuote, deployCeiling, deployRoute, localKeySeconds, needsAsk, waitLabel } from '../lib/deployPlan'

export function DeployBar(): JSX.Element | null {
  const pending = useShards((s) => s.pending)
  const shard = useShards((s) => (s.pending?.type === 'shard' ? s.pendingShard() : null))
  const height = useShards((s) => s.deployHeight)
  const status = useShards((s) => s.deployStatus)
  const error = useShards((s) => s.deployError)
  const note = useShards((s) => s.deployNote)
  const ask = useShards((s) => s.deployAsk)
  const live = useCyberspace((s) => s.live)
  const cloudMode = useCyberspace((s) => s.cloudPrefs.mode)
  const autoMaxSats = useCyberspace((s) => s.cloudPrefs.autoMaxSats)
  const cloudCap = useCyberspace((s) => s.cloud.limits?.max_hop_height ?? null)
  const ladder = useCyberspace((s) => s.cloud.provider?.pricing?.hop)
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

      <div className="deploybar__row deploybar__row--height">
        <span className="deploybar__label">HIDE AT HEIGHT</span>
        <button className="deploybar__btn" {...bind(() => useShards.getState().setDeployHeight(height - 1))} disabled={height <= 0} aria-label="Lower height">−</button>
        <span className="deploybar__value">{height}</span>
        <button className="deploybar__btn" {...bind(() => useShards.getState().setDeployHeight(height + 1))} disabled={height >= ceiling} aria-label="Higher height">+</button>
        <span className="deploybar__radius">
          {height === 0 ? 'this exact gibson' : `found within ${formatCellSize(height)}`}
        </span>
      </div>

      <div className="deploybar__row deploybar__hint">
        Aim with the movement controls; the ghost is where it lands.
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
