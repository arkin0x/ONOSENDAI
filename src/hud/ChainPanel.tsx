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
 *
 * Under it, the same question one action at a time. Each row wears the
 * compact tag, LIVE or LOCAL, and not the two-word switch the real control
 * uses, for two reasons. The switch is twice as wide and would push the type
 * and the id off a row that already has three fields in it. More than that, a
 * switch is a thing you press: putting one on every row would offer a choice
 * that does not exist, because publishing one action alone reveals nothing.
 * A reader walks the chain forward from the spawn following each event's
 * `previousId`, so an action whose parent is missing is never reached at all.
 * The rows report; the one switch under COMMIT decides.
 */

import { useEffect, useMemo, useRef } from 'react'
import { formatMs, formatOps } from '../lib/space'
import { expectedRidePairs } from '../lib/hyperspace/ride'
import { parseAction } from '../lib/events'
import { PUBLISH_TAG_LABEL, PUBLISH_TAG_TITLE, publishTag } from '../lib/release'
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
  const respawns = useCyberspace((s) => s.respawns)

  // Parsed once per chain change: the type is the only thing a row needs from
  // inside the event, and re-parsing on every publish result would re-read the
  // whole chain once per send.
  const kinds = useMemo(() => events.map((e) => parseAction(e)?.type ?? null), [events])

  // The newest action is at the bottom, because that is the order the
  // publisher sends in and the order the chain is read in. Keep it in view as
  // the chain grows, the way the chat dock keeps its newest line.
  const list = useRef<HTMLOListElement>(null)
  useEffect(() => {
    const el = list.current
    if (el) el.scrollTop = el.scrollHeight
  }, [events.length])

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
        <div title="DECK-0001 rides on the block line, and the blocks they passed between them">
          <dt>Hyperjumps</dt>
          <dd>{chain.hyperjumps}{chain.blocksRidden > 0 ? ` · ${chain.blocksRidden.toLocaleString()} BLOCKS` : ''}</dd>
        </div>
        <div>
          <dt>Cantor ops</dt>
          <dd>{formatOps(chain.totalOps)}</dd>
        </div>
        <div>
          <dt>SHA-256 hashes</dt>
          <dd>{formatOps(chain.totalHashes)}</dd>
        </div>
        {chain.blocksRidden > 0 && (
          <div title="The rides' work: about 42,000 Cantor pairs per block passed (DECK-0001 v3 §5.7), which is expected, not measured">
            <dt>Ride pairs</dt>
            <dd>≈ {formatOps(expectedRidePairs(chain.blocksRidden))}</dd>
          </div>
        )}
        <div>
          <dt>Compute time</dt>
          <dd>{formatMs(chain.totalMs)}</dd>
        </div>
        <div title="What HOSAKA charged for proofs on this chain. Counted on this device only, never published.">
          <dt>Sats spent</dt>
          <dd>{spentMsats === 0 ? '0' : `${Math.ceil(spentMsats / 1000).toLocaleString()} (local)`}</dd>
        </div>
        <div title="Live publishes nothing by itself. A chain still queued here goes out whole the next time you take an action while Live.">
          <dt>Published</dt>
          <dd>
            {sent} / {events.length}{' '}
            <span className={`relay relay--${relayState.toLowerCase()}`}>{relayState}</span>
          </dd>
        </div>
        {/* Last and apart: each respawn began a new chain, so this is a fact
            about the identity, not about the chain above it. */}
        <div title="Times this identity has respawned. Each one started a new chain; counted on this device.">
          <dt>Respawns</dt>
          <dd>{respawns}</dd>
        </div>
      </dl>

      {/* Every action, oldest first, and where it is. State only: there is no
          control on a row. */}
      <ol className="chainrows" ref={list}>
        {events.map((e, i) => {
          const tag = publishTag(published[e.id])
          return (
            <li key={e.id} className="chainrows__row">
              <span className="chainrows__n">{i}</span>
              <span className={`chainrows__type chainrows__type--${kinds[i] ?? 'unknown'}`}>
                {(kinds[i] ?? 'unknown').replace('enter-hyperspace', 'enter').toUpperCase()}
              </span>
              <code className="chainrows__id" title={e.id}>{e.id.slice(0, 8)}…</code>
              <span className={`tag tag--${tag}`} title={PUBLISH_TAG_TITLE[tag]}>{PUBLISH_TAG_LABEL[tag]}</span>
            </li>
          )
        })}
      </ol>

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
