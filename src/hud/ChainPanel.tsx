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
import { Explanation } from './Explanation'

export function ChainPanel(): JSX.Element {
  const chain = useCyberspace((s) => s.chain)
  const spentMsats = useCyberspace((s) => s.spentMsats)
  const prevEventId = useCyberspace((s) => s.prevEventId)
  const genesisId = useCyberspace((s) => s.genesisId)
  const events = useCyberspace((s) => s.events)
  const published = useCyberspace((s) => s.published)
  const publishError = useCyberspace((s) => s.publishError)
  const live = useCyberspace((s) => s.live)
  const exploreIndex = useCyberspace((s) => s.exploreIndex)

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
        {/* The whole chain, spawn included, not this session's proofs; a tap
            opens the chain explorer at the head, a second tap puts it away. */}
        <button
          className="tag tag--tap"
          onClick={() => useCyberspace.getState().explore(exploreIndex === null ? Math.max(0, events.length - 1) : null)}
          aria-pressed={exploreIndex !== null}
          title="Open the chain explorer"
        >
          {events.length} ACTION{events.length === 1 ? '' : 'S'}
        </button>
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
        <div title="What HOSAKA charged for proofs on this chain. Counted on this device only, never published.">
          <dt>Sats spent</dt>
          <dd>{spentMsats === 0 ? '0' : `${Math.ceil(spentMsats / 1000).toLocaleString()} (local)`}</dd>
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
        <span className="hash__label">chain head{events.length <= 1 ? ' (spawn)' : ''}</span>
        <code>{prevEventId}</code>
      </div>

      {publishError && <p className="notice">{CYBERSPACE_RELAY}: {publishError}</p>}

      <Explanation>
        To alter your position in cyberspace, you must compute the cantor root for
        the region containing your origin and destination, and publish a root proof
        naming the proof that came before it. This forms a personal "hash chain" for
        your identity that mathematically proves a valid history of your actions
        without relying on a central authority to enforce movement rules.
      </Explanation>
    </section>
  )
}
