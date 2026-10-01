/**
 * ChainStatus.tsx - what the chain's publishing is doing, under the
 * LIVE/LOCAL switch.
 *
 * The switch says what you chose: LIVE publishes your chain as you act, and
 * LOCAL keeps it on this device. It does not say whether that choice is being
 * carried out, and a few states mean it is not: the chain is HELD on this
 * device because the relays could not confirm whether this identity already
 * has a chain; a held chain met a chain on the relays and is waiting for your
 * choice; this device's unpublished moves fork against moves another device
 * of yours already published, and are waiting for your choice; or the switch is LIVE but actions are waiting because no relay can
 * be reached. The switch stays exactly as it is, and this strip slides in
 * directly under it while one of those states holds; with nothing to report
 * it is not drawn at all (arkinox, 2026-10-01). A tap on it opens a modal
 * that explains the state in full: what it means, why the client is in it,
 * what the client does about it by itself, what happens next, and what you
 * can do.
 *
 * The decision is lib/chainHold.ts chainStatusOf; this file only draws it.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ConfirmModal } from './ConfirmModal'
import { connected } from '../lib/relay'
import { recheckNow } from '../lib/selfSync'
import { chainStatusLabel, chainStatusOf, refusalText, type ChainStatus, type SelfCheck } from '../lib/chainHold'
import { useCyberspace } from '../store/useCyberspace'
import { useChainUi } from '../store/useChainUi'
import { DEFAULT_RELAY, useRelays } from '../store/useRelays'

/** How often the pool is asked whether a relay is connected; it has no event to listen to. */
const POLL_MS = 2000

/** navigator.onLine and the pool's own view of the relays, kept current. */
export function useConnectivity(): { online: boolean; relayUp: boolean } {
  const read = (): { online: boolean; relayUp: boolean } => ({
    online: typeof navigator === 'undefined' || navigator.onLine !== false,
    relayUp: connected(),
  })
  const [state, setState] = useState(read)
  useEffect(() => {
    const tick = (): void => {
      const next = read()
      setState((cur) => (cur.online === next.online && cur.relayUp === next.relayUp ? cur : next))
    }
    const interval = window.setInterval(tick, POLL_MS)
    window.addEventListener('online', tick)
    window.addEventListener('offline', tick)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('online', tick)
      window.removeEventListener('offline', tick)
    }
  }, [])
  return state
}

/** The chain status now, or null when there is nothing to report. */
export function useChainStatus(): ChainStatus | null {
  const live = useCyberspace((s) => s.live)
  const held = useCyberspace((s) => s.held)
  const conflict = useCyberspace((s) => s.chainConflict?.kind ?? null)
  const events = useCyberspace((s) => s.events)
  const published = useCyberspace((s) => s.published)
  const { online, relayUp } = useConnectivity()
  return useMemo(() => {
    const waiting = events.filter((e) => published[e.id] !== 'ok').length
    return chainStatusOf({ live, held, conflict, waiting, online, relayUp })
  }, [live, held, conflict, events, published, online, relayUp])
}

/** The strip itself. Rendered by TouchControls directly under the switch. */
export function ChainStatusStrip({ status }: { status: ChainStatus }): JSX.Element {
  const check = useCyberspace((s) => s.selfCheck)
  const label = chainStatusLabel(status, check)
  return (
    <button
      className={`chainstatus chainstatus--${status.kind}`}
      title="What this means: tap for the full explanation"
      aria-label={`${label}. Tap for the explanation.`}
      onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); useChainUi.getState().setExplaining(true) }}
    >{label}</button>
  )
}

/** Why the relays could not say, as a full sentence for the held explanation. */
function causeSentence(check: SelfCheck): ReactNode {
  if (check.status === 'checking') {
    return <>This client is asking the relays right now and has not had an answer yet.</>
  }
  if (check.status !== 'unknown') {
    return <>The relays have answered since, and this client is applying the answer.</>
  }
  switch (check.cause.kind) {
    case 'offline':
      return <>This device reported that it was offline (the browser's <code>navigator.onLine</code> was false), so no relay could be asked at all.</>
    case 'unreachable':
      return <>The relays were asked and did not answer in time. Specifically, {DEFAULT_RELAY}, the relay where every cyberspace chain is published, did not send its end-of-stored-events reply (EOSE: the message a relay sends after the last stored event that matches a request) before this client stopped waiting ({check.cause.reason}).</>
    case 'refused': {
      const auth = /^auth-required:/i.test(check.cause.reason)
      return <>The relay at {check.cause.url} refused the request with the reason "{check.cause.reason}".{auth
        ? <> An auth-required refusal means the relay wants this identity to log in first with NIP-42 authentication: your signer (the browser extension, the bunker or the local key) signs a short login event for the relay, and an extension or a bunker may ask you to approve it.</>
        : <> In plain terms: {refusalText(check.cause.reason)}.</>}</>
    }
  }
}

function HeldExplanation(): JSX.Element {
  const check = useCyberspace((s) => s.selfCheck)
  const n = useCyberspace((s) => s.events.length)
  const live = useCyberspace((s) => s.live)
  const refusedAuth = check.status === 'unknown' && check.cause.kind === 'refused' && /^auth-required:/i.test(check.cause.reason)
  return (<>
    <p><b>What this means:</b> your chain is kept on this device and is not published to any relay, whatever the LIVE/LOCAL switch says. Your switch is {live ? 'LIVE' : 'LOCAL'} and stays as you set it; the hold is a separate stop that applies only to this chain. The chain is the sequence of signed movement events (nostr kind 3333) for your identity: one spawn, then each hop, sidestep or hyperjump, each naming the event before it. A spawn is the first event of a chain: it places your identity at the coordinate your public key decodes to. This chain has {n} event{n === 1 ? '' : 's'}, spawn included.</p>
    <p><b>Why it is held:</b> when you made your first move on this device, this client could not confirm whether this identity already has a chain on the relays. {causeSentence(check)}</p>
    <p>That matters because the protocol places every identity by its newest spawn (spec §3.2). Your first move here signed a new spawn. If this identity already has a chain on the relays, publishing the new spawn would replace that chain: every reader, on every device, would stop following the existing chain and follow this one instead. So the new chain is kept here until the relays answer.</p>
    <p><b>What the client does about it by itself:</b></p>
    <ul>
      <li>It asks the relays again every time the page loads.</li>
      <li>It asks again whenever the connection comes back: when the browser reports that it is online again, when this tab returns after being hidden for at least 15 seconds, when a dead connection is detected and replaced, and when the live subscription to your own chain reaches the end of stored events.</li>
    </ul>
    <p><b>What happens next:</b></p>
    <ul>
      <li>If {DEFAULT_RELAY} answers that this identity has no chain, and no other relay returns one, the hold is lifted without asking you. The chain is then published according to your switch: while LIVE, all {n} event{n === 1 ? '' : 's'} go out in order with your next action; while LOCAL, they stay on this device as usual.</li>
      <li>If any relay returns a chain for this identity, this client shows both chains side by side and asks which one to keep. Nothing is chosen for you.</li>
    </ul>
    <p><b>What you can do:</b></p>
    <ul>
      <li>Keep moving. Every action you take is signed and added to this chain, and all of it stays on this device until the hold is lifted.</li>
      {check.status === 'unknown' && check.cause.kind === 'offline' && <li>Reconnect this device to the network; the check runs again on its own when the browser reports it is online.</li>}
      {refusedAuth && <li>Make sure your signer is connected and approve the login request it shows, then use CHECK AGAIN.</li>}
      <li>Use CHECK AGAIN below to ask the relays now.</li>
      <li>Bags and messages are not affected by the hold; they publish exactly as before.</li>
    </ul>
  </>)
}

function WaitingExplanation({ status }: { status: Extract<ChainStatus, { kind: 'waiting' }> }): JSX.Element {
  const relays = useRelays((s) => s.relays)
  const n = status.count
  return (<>
    <p><b>What this means:</b> {n} signed event{n === 1 ? '' : 's'} of your chain {n === 1 ? 'is' : 'are'} on this device and not yet on any relay. Your switch is LIVE, which means your chain is published as you act, but no relay can be reached right now, so the publisher cannot send {n === 1 ? 'it' : 'them'}. The switch stays LIVE; nothing about your setting has changed.</p>
    <p><b>Why:</b> {status.why === 'offline'
      ? <>this device reports that it is offline (the browser's <code>navigator.onLine</code> is false).</>
      : <>the browser reports a network connection, but none of your {relays.length} configured relay{relays.length === 1 ? '' : 's'} ({relays.join(', ')}) has an open connection.</>}</p>
    <p><b>What the client does about it by itself:</b></p>
    <ul>
      <li>The live subscriptions reconnect on their own, waiting a little longer after each failed attempt, and every connection is replaced as soon as the browser reports that the network is back.</li>
      <li>A send that failed is retried while LIVE, first after 4 seconds and then after twice as long each time, up to once a minute.</li>
    </ul>
    <p><b>What happens next:</b> once a relay can be reached, the waiting events are sent oldest first, so every part of the chain a relay holds starts at the spawn and reads in order. If this page was reloaded since the last send, nothing is sent until your next action taken while LIVE: a reload never publishes by itself, and that action then carries every waiting event with it.</p>
    <p><b>What you can do:</b></p>
    <ul>
      <li>Reconnect this device, or check the Relays panel for a relay address that is wrong.</li>
      <li>Switch to LOCAL if you would rather keep these events on this device for now.</li>
      <li>Nothing is lost while waiting: the events are saved on this device and survive a reload.</li>
    </ul>
  </>)
}

function ConflictExplanation(): JSX.Element {
  return (<>
    <p><b>What this means:</b> this identity has two chains: the one held on this device, and one on the relays. Only one of them can place you, and you have not chosen yet. Until you do, no move is taken, nothing is published, and the relay chain is not adopted.</p>
    <p><b>Why:</b> your first move on this device was made before the relays could confirm whether this identity already had a chain, so the chain it started was held here. The relays have since returned a chain for this identity.</p>
    <p><b>What the client does about it by itself:</b> nothing is chosen automatically. Normally a newer spawn from your own identity replaces the older chain (spec §3.2), but for a held chain that rule would always pick the chain this device signed a moment ago, so it is suspended until you answer.</p>
    <p><b>What you can do:</b> open the choice. It shows both chains side by side (when each started, how many actions it has, when it last moved, and where it is now) and offers two answers:</p>
    <ul>
      <li><b>Keep the relay chain:</b> the chain on this device is deleted and you stand at the relay chain's head. Region keys that your moves on this device found stay in your Secrets, because a key is knowledge and not part of a chain.</li>
      <li><b>Keep the local chain:</b> this device's chain is published. Its spawn is newer, so it replaces the relay chain for every reader; the old chain stays on the relays as history but no longer places you. This cannot be undone, and it asks you to confirm a second time.</li>
    </ul>
  </>)
}

function DivergedExplanation(): JSX.Element {
  return (<>
    <p><b>What this means:</b> this device has moves that are not published yet, and another device signed in as you has published different moves from the same earlier point of the same chain. The chain has forked: two actions name the same action as the one before them. Until you choose which version to keep, nothing from this device is published, no move is taken, and the other device's moves are not adopted here.</p>
    <p><b>Why:</b> this device was LOCAL or offline while the other device kept moving and publishing. When this device went LIVE, came back online, or received the other device's moves from the relays, it compared them with its own unpublished moves and found that both continue from the same action.</p>
    <p><b>How a fork is resolved:</b> every reader of a chain follows its newest spawn and then, at each fork, the older of the two next actions by created_at (the time each event says it was signed), with a tie going to the smaller event id. This rule is the same for everyone and is not changed here. It means:</p>
    <ul>
      <li>If this device's first move after the fork is older than the other device's, publishing it wins the fork for every reader the moment it lands, and the moves the other device already published stop being part of the chain.</li>
      <li>If it is newer, publishing it changes nothing anyone sees: it would sit on the relays as a branch that no reader follows.</li>
    </ul>
    <p><b>What the client does about it by itself:</b> it stops publishing this chain and suspends automatic adoption of the other device's moves, so the fork rule does not pick a winner in silence. Moves that arrive from the other device while you decide are added to its side of the comparison.</p>
    <p><b>What you can do:</b> open the choice. It shows both branches from the fork point (how many actions each has, when each started and last moved, and where each ends) and says plainly whether publishing yours would override the other device's published moves.</p>
    <ul>
      <li><b>Keep the relay's version:</b> this device's unpublished moves after the fork are discarded and you stand where the other device's moves put you. Region keys those moves found stay in your Secrets.</li>
      <li><b>Publish mine:</b> this device's moves are kept and published. When that overrides the other device's published moves, you are asked to confirm a second time.</li>
    </ul>
  </>)
}

/** The explanation modal for whatever the strip is showing. Mounted once, in App. */
export function ChainStatusModal(): JSX.Element | null {
  const open = useChainUi((s) => s.explaining)
  const status = useChainStatus()
  const checking = useCyberspace((s) => s.selfCheck.status === 'checking')
  // The state it explained ended while it was open (the hold lifted, the
  // relay came back): there is nothing left to explain.
  useEffect(() => { if (open && !status) useChainUi.getState().setExplaining(false) }, [open, status])
  if (!open || !status) return null
  const close = (): void => useChainUi.getState().setExplaining(false)

  if (status.kind === 'held') {
    return (
      <ConfirmModal
        title="Your chain is held on this device"
        cardClassName="chainexplain"
        scroll
        body={<HeldExplanation />}
        confirmLabel={checking ? 'CHECKING…' : 'CHECK AGAIN'}
        cancelLabel="CLOSE"
        danger={false}
        onConfirm={() => { if (!checking) recheckNow() }}
        onCancel={close}
      />
    )
  }
  if (status.kind === 'diverged') {
    return (
      <ConfirmModal
        title="Your unpublished moves fork from another device's"
        cardClassName="chainexplain"
        scroll
        body={<DivergedExplanation />}
        confirmLabel="SHOW THE CHOICE"
        cancelLabel="CLOSE"
        danger={false}
        onConfirm={() => { close(); useChainUi.getState().setPromptAside(false) }}
        onCancel={close}
      />
    )
  }
  if (status.kind === 'conflict') {
    return (
      <ConfirmModal
        title="Two chains for this identity"
        cardClassName="chainexplain"
        scroll
        body={<ConflictExplanation />}
        confirmLabel="SHOW THE CHOICE"
        cancelLabel="CLOSE"
        danger={false}
        onConfirm={() => { close(); useChainUi.getState().setPromptAside(false) }}
        onCancel={close}
      />
    )
  }
  return (
    <ConfirmModal
      title={`${status.count} action${status.count === 1 ? '' : 's'} waiting to publish`}
      cardClassName="chainexplain"
      scroll
      body={<WaitingExplanation status={status} />}
      confirmLabel="UNDERSTOOD"
      cancelLabel={null}
      danger={false}
      onConfirm={close}
      onCancel={close}
    />
  )
}
