/**
 * ChainPanel.tsx - the movement chain so far.
 *
 * Position only ever advances when a proof completes, so the chain shown here
 * is contiguous by construction: hop N's proof always references hop N-1's.
 */

import { formatMs, formatOps } from '../lib/space'
import { useCyberspace } from '../store/useCyberspace'

export function ChainPanel(): JSX.Element {
  const chain = useCyberspace((s) => s.chain)
  const prevEventId = useCyberspace((s) => s.prevEventId)

  return (
    <section className="panel">
      <header className="panel__head">
        <h2>Proof chain</h2>
        <span className="tag">
          {chain.hops} HOP{chain.hops === 1 ? '' : 'S'}
        </span>
      </header>

      <dl className="stats">
        <div>
          <dt>Cantor ops</dt>
          <dd>{formatOps(chain.totalOps)}</dd>
        </div>
        <div>
          <dt>Compute time</dt>
          <dd>{formatMs(chain.totalMs)}</dd>
        </div>
      </dl>

      <div className="hash">
        <span className="hash__label">chain head</span>
        <code>{chain.hops === 0 ? 'spawn (no hops committed yet)' : prevEventId}</code>
      </div>

      <p className="legend__note">
        Each committed hop chains its proof to the previous one, mirroring the
        protocol's per-pubkey movement chain.
      </p>
    </section>
  )
}
