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
 *
 * Not every row is a move (spec §8.9, §8.11). A game played on this identity
 * from another client puts its entry, its own moves and its exit on the
 * chain, drawn pink as GAME rows; an action this client does not recognize
 * is followed and passed over, drawn quiet as SKIPPED. While a game holds
 * the avatar nothing here moves it, and the notice under the rows says so.
 */

import { useEffect, useMemo, useRef } from 'react'
import { formatMs, formatOps } from '../lib/space'
import { expectedRidePairs } from '../lib/hyperspace/ride'
import { TriangleAlert } from 'lucide-react'
import { actionKind, actionLabel, firstBreak, openBracket } from '../lib/events'
import { PUBLISH_TAG_LABEL, PUBLISH_TAG_TITLE, publishTag } from '../lib/release'
import { useCyberspace } from '../store/useCyberspace'
import { CYBERSPACE_RELAY } from '../lib/relay'
import { Explanation } from './Explanation'
import { useChainStatus } from './ChainStatus'
import { holdReason } from '../lib/chainHold'
import { useChainUi } from '../store/useChainUi'
import { Field, Switch } from './ui/Switch'

export function ChainPanel(): JSX.Element {
  const chain = useCyberspace((s) => s.chain)
  const showTrail = useCyberspace((s) => s.showTrail)
  const spentMsats = useCyberspace((s) => s.spentMsats)
  const prevEventId = useCyberspace((s) => s.prevEventId)
  const genesisId = useCyberspace((s) => s.genesisId)
  const events = useCyberspace((s) => s.events)
  const published = useCyberspace((s) => s.published)
  const publishError = useCyberspace((s) => s.publishError)
  const live = useCyberspace((s) => s.live)
  const exploreIndex = useCyberspace((s) => s.exploreIndex)
  const respawns = useCyberspace((s) => s.respawns)
  const held = useCyberspace((s) => s.held)
  const check = useCyberspace((s) => s.selfCheck)
  // The same status the strip under the LIVE/LOCAL switch shows (ChainStatus.tsx).
  const status = useChainStatus()

  // Resolved once per chain change (the store caches it): what each event is
  // to the chain is the one thing a row needs from inside it, and re-reading
  // on every publish result would walk the whole chain once per send.
  const actions = useMemo(() => useCyberspace.getState().actions(), [events])
  const byId = useMemo(() => new Map(actions.map((a) => [a.id, a])), [actions])
  // A game holds the avatar: its entry, when the chain ends inside a bracket.
  const game = useMemo(() => openBracket(actions), [actions])
  // The first row a verifier rejects, if any (events.ts firstBreak).
  const broken = useMemo(() => firstBreak(actions), [actions])

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
  // HELD first: whatever LIVE says, a held chain is going nowhere until the
  // relays answer. Then the two ways a LIVE queue can be stuck, which used to
  // read QUEUED as if it were merely waiting its turn.
  const relayState = held
    ? 'HELD'
    : !live
    ? 'LOCAL'
    : status?.kind === 'waiting' && status.why === 'offline'
      ? 'OFFLINE'
      : status?.kind === 'waiting'
        ? 'NO RELAY'
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

      {/* The line through the chain's positions in the scene, on by default.
          Remembered on this device (arkinox, 2026-10-01). */}
      <Field id="chain-show-trail" label="Show chain trail" hint="Toggle the red line that shows your movement path history.">
        <Switch id="chain-show-trail" checked={showTrail} onCheckedChange={(v) => useCyberspace.getState().setShowTrail(v)} />
      </Field>

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
            <span className={`relay relay--${relayState.toLowerCase().replace(' ', '')}`}>{relayState}</span>
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
          const a = byId.get(e.id)
          // A row that breaks a rule reads BROKEN whatever its role, with the
          // warning glyph, so it is never mistaken for a game's pink row.
          const kind = a ? actionKind(a) : 'broken'
          const breaks = kind === 'broken'
          const label = a ? actionLabel(a) : 'UNREADABLE'
          return (
            <li key={e.id} className={`chainrows__row ${breaks ? 'chainrows__row--broken' : ''}`}>
              <span className="chainrows__n">{i}</span>
              <span className={`chainrows__type chainrows__type--${kind}`} title={a?.breaks ?? a?.name}>
                {breaks && <TriangleAlert size={10} strokeWidth={2.5} aria-hidden className="chainrows__warn" />}
                {label}
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
      {/* The strip under the switch is only drawn with the touch controls; the
          panel says the same for whoever reads it here. */}
      {status?.kind === 'diverged' ? (
        <p className="notice">
          BRANCHES DIVERGED: another device published moves from the same point as this device's unpublished ones. Nothing publishes until you choose.
          <button className="tag tag--tap" onClick={() => useChainUi.getState().setPromptAside(false)}>SHOW THE CHOICE</button>
        </p>
      ) : status?.kind === 'conflict' ? (
        <p className="notice">
          CHAIN CONFLICT: this identity has a chain on the relays as well as the one held here. Nothing moves until you choose.
          <button className="tag tag--tap" onClick={() => useChainUi.getState().setPromptAside(false)}>SHOW THE CHOICE</button>
        </p>
      ) : game ? (
        // Below the publishing states, which are choices waiting on you; this
        // one waits on the game's client (store GAME_HOLDS_MESSAGE).
        <p className="notice notice--game">
          IN A GAME: this identity entered a game from another client, so a game holds your avatar where it entered. Nothing here moves you until that client publishes an exit, or until you respawn, which also leaves the game and is the only way out if that client is gone.
          <button className="tag tag--tap" onClick={() => useCyberspace.getState().explore(actions.indexOf(game))}>SHOW THE GAME</button>
        </p>
      ) : held ? (
        <p className="notice notice--held">
          HELD on this device: {holdReason(check)}. Nothing publishes until the relays confirm whether this identity already has a chain.
          <button className="tag tag--tap" onClick={() => useChainUi.getState().setExplaining(true)}>WHY</button>
        </p>
      ) : null}

      {/* Apart from the states above: a broken row is a fact about the chain
          itself, and it can stand alongside any of them. */}
      {broken && (
        <p className="notice notice--broken">
          <TriangleAlert size={12} strokeWidth={2.5} aria-hidden className="chainrows__warn" />
          BROKEN CHAIN AT ROW {broken.index} ({actionLabel(broken.action)}): {broken.action.breaks}. Every verifier treats this chain as invalid from that row, so nothing after it counts, including any move you make now; ONOSENDAI still lets you move on it for the moment. A respawn starts a new, valid chain at your spawn point.
          <button className="tag tag--tap" onClick={() => useCyberspace.getState().explore(broken.index)}>SHOW THE ROW</button>
        </p>
      )}

      <Explanation>
        To alter your position in cyberspace, you must compute the cantor root for
        the region containing your origin and destination, and publish a root proof
        naming the proof that came before it. This forms a personal "hash chain" for
        your identity that mathematically proves a valid history of your actions
        without relying on a central authority to enforce movement rules.
        <br /><br />
        Not every row is a move. A pink row is a game. Another client can take
        this identity into a game by publishing an ENTER GAME action on this
        same chain; every action after it, shown as GAME and the game's own name
        for it, belongs to the game, until an EXIT GAME action closes it. None of
        those actions moves you through cyberspace: your position stays where
        you entered, and the exit puts you back there. While a game holds your
        avatar, ONOSENDAI will not sign a hop, a sidestep or a ride, because any
        of them inside a game would make your whole chain invalid from that
        point for every verifier. Leave the game in the client you entered it
        with, and you can move again from where you entered.
        <br /><br />
        A grey SKIPPED row is an action this client does not recognize, from an
        extension it does not implement. The chain is followed through it and
        it is passed over: it does not move you, and your next move continues
        after it from where your last recognized action put you. A red BROKEN
        row is an action out of place or malformed, such as a hop signed inside
        a game; a verifier says the chain stops being valid there, and this
        client, which shows chains rather than verifying them, marks it and
        keeps reading. An action whose starting point (its c) is not where the
        chain stood is BROKEN too, wherever it is. The first BROKEN row is named
        in a notice above, with the rule it breaks; a respawn starts a new,
        valid chain.
        <br /><br />
        A game holds your avatar until the client you entered it with publishes
        an exit. If that client is gone, a respawn also leaves the game: it
        starts a new chain at your spawn point, and the game decides what
        leaving without an exit means.
        <br /><br />
        On the chain explorer's rail, every action is a tick: pink ticks are a
        game's actions, its entry and exit included, and short grey ticks are
        skipped or broken actions, which are on the chain but move nobody.
      </Explanation>
    </section>
  )
}
