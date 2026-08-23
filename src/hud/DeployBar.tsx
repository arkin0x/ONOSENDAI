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

export function DeployBar(): JSX.Element | null {
  const pending = useShards((s) => s.pending)
  const shard = useShards((s) => (s.pending?.type === 'shard' ? s.pendingShard() : null))
  const height = useShards((s) => s.deployHeight)
  const status = useShards((s) => s.deployStatus)
  const error = useShards((s) => s.deployError)
  const live = useCyberspace((s) => s.live)
  const bind = useRepeatable()

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
        <button className="deploybar__btn" {...bind(() => useShards.getState().setDeployHeight(height + 1))} disabled={height >= MAX_COMPUTE_HEIGHT} aria-label="Higher height">+</button>
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

      {error && <div className="deploybar__row notice">{error}</div>}

      <button
        className="deploybar__deploy"
        disabled={empty || working}
        onClick={() => void useShards.getState().deploy()}
        {...noCallout}
      >
        {empty ? (isMessage ? 'MESSAGE IS EMPTY' : 'SHARD IS EMPTY') : working ? 'HIDING…' : live ? 'HIDE & PUBLISH' : 'HIDE (LOCAL)'}
      </button>
    </div>
  )
}
