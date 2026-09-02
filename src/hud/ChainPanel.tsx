/**
 * ChainPanel.tsx - the movement chain so far.
 *
 * Position only ever advances when a proof completes, so the chain shown here
 * is contiguous by construction: hop N's event names hop N-1's id, and its
 * proof was bound to that id before it was signed.
 *
 * The relay line is the one thing here that is not about cost. It says how
 * much of the chain exists anywhere but this device, which while Live is the
 * difference between moving and being seen to move.
 */

import { formatMs, formatOps } from '../lib/space'
import { useCyberspace } from '../store/useCyberspace'
import { CYBERSPACE_RELAY } from '../lib/relay'
import { useRelays } from '../store/useRelays'
import { Explanation } from './Explanation'

export function ChainPanel(): JSX.Element {
  const chain = useCyberspace((s) => s.chain)
  const prevEventId = useCyberspace((s) => s.prevEventId)
  const genesisId = useCyberspace((s) => s.genesisId)
  const events = useCyberspace((s) => s.events)
  const published = useCyberspace((s) => s.published)
  const publishError = useCyberspace((s) => s.publishError)
  const live = useCyberspace((s) => s.live)
  const relayCount = useRelays((s) => s.relays.length)
  const actions = chain.hops + chain.sidesteps

  const statuses = events.map((e) => published[e.id])
  const sent = statuses.filter((st) => st === 'ok').length
  const relayState = !live
    ? 'LOCAL'
    : statuses.includes('failed')
      ? 'RETRYING'
      : statuses.includes('sending')
        ? 'SENDING'
        : sent === events.length ? 'SYNCED' : 'QUEUED'

  return (
    <section className="panel">
      <header className="panel__head">
        <h2>Proof chain</h2>
        <span className="tag">
          {actions} ACTION{actions === 1 ? '' : 'S'}
        </span>
      </header>

      <dl className="stats">
        <div>
          <dt>Hops</dt>
          <dd>{chain.hops}</dd>
        </div>
        <div>
          <dt>Sidesteps</dt>
          <dd>{chain.sidesteps}</dd>
        </div>
        <div>
          <dt>Cantor ops</dt>
          <dd>{formatOps(chain.totalOps)}</dd>
        </div>
        <div>
          <dt>SHA-256 hashes</dt>
          <dd>{formatOps(chain.totalHashes)}</dd>
        </div>
        <div>
          <dt>Compute time</dt>
          <dd>{formatMs(chain.totalMs)}</dd>
        </div>
        <div>
          <dt>Published</dt>
          <dd>
            {sent} / {events.length}{' '}
            <span className={`relay relay--${relayState.toLowerCase()}`}>{relayState}</span>
          </dd>
        </div>
      </dl>

      <div className="hash">
        <span className="hash__label">genesis</span>
        <code>{genesisId}</code>
      </div>
      <div className="hash">
        <span className="hash__label">chain head{actions === 0 ? ' (spawn)' : ''}</span>
        <code>{prevEventId}</code>
      </div>

      {publishError && <p className="notice">{CYBERSPACE_RELAY}: {publishError}</p>}

      <Explanation>
        Every committed action is a signed kind:3333 event naming the one
        before it (spec section 8). {live
          ? `Live publishes each one to your ${relayCount === 1 ? CYBERSPACE_RELAY.replace('wss://', '') : `${relayCount} relays`} as it lands.`
          : 'Local keeps them on this device; switching to Live publishes the whole chain in order.'}
      </Explanation>
    </section>
  )
}
