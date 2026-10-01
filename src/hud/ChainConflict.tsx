/**
 * ChainConflict.tsx - the prompt a held chain raises when it meets a chain on
 * the relays.
 *
 * A held chain was started by a first move the relays could not vouch for
 * (lib/chainHold.ts). When they do answer, with a chain, one identity has two
 * and somebody has to say which one it is. Not "newest spawn wins": that
 * would always pick the chain signed here a moment ago, which is the very
 * thing the hold exists to prevent. So both are shown side by side and the
 * person chooses; nothing is chosen for them (arkinox, 2026-10-01). A tap
 * outside the card sets the prompt aside without answering it: the conflict
 * stands, no move is taken, the strip under the LIVE/LOCAL switch reads
 * CHAIN CONFLICT, and a tap there (or any attempt to move) brings it back.
 *
 * KEEP THE RELAY CHAIN leads, because it is the one that loses nothing
 * anyone else has seen. KEEP THE LOCAL CHAIN publishes this device's chain,
 * which, being newer, replaces the relay chain for every reader; the old one
 * stays on the relays as history. That cannot be undone, so it asks twice.
 *
 * `ChainCompare` is the side-by-side table on its own, for any prompt that
 * puts two versions of a chain next to each other.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ConfirmModal } from './ConfirmModal'
import { formatAgo, formatStamp, shortHex } from '../lib/time'
import { positionHex } from '../lib/events'
import { holdReason, localSupersedes, summarizeChain, type ChainSummary } from '../lib/chainHold'
import { useCyberspace } from '../store/useCyberspace'
import { useChainUi } from '../store/useChainUi'

export interface CompareColumn {
  heading: string
  cells: ReactNode[]
}

/** Two (or more) columns of facts against one column of row labels. Spans only: it sits inside the modal's paragraph. */
export function ChainCompare({ labels, columns }: { labels: string[]; columns: CompareColumn[] }): JSX.Element {
  return (
    <span className="chaincmp" style={{ gridTemplateColumns: `auto repeat(${columns.length}, minmax(0, 1fr))` }}>
      <span className="chaincmp__corner" />
      {columns.map((c) => <span key={c.heading} className="chaincmp__head">{c.heading}</span>)}
      {labels.map((label, row) => (
        <span key={label} className="chaincmp__row">
          <span className="chaincmp__label">{label}</span>
          {columns.map((c) => <span key={c.heading} className="chaincmp__cell">{c.cells[row]}</span>)}
        </span>
      ))}
    </span>
  )
}

/** The rows a whole chain is compared by: when it started, how long it is, when it last moved, where it is. */
export const SUMMARY_LABELS = ['Started', 'Actions', 'Last activity', 'Where']

export function summaryCells(s: ChainSummary, now: number): ReactNode[] {
  return [
    <span title={formatStamp(s.startedAt)}>{formatAgo(s.startedAt, now)}</span>,
    String(s.actions),
    <span title={formatStamp(s.lastActive)}>{formatAgo(s.lastActive, now)}</span>,
    <span title={positionHex(s.position, s.plane)}>{s.sector}{s.plane === 1 ? ' · ideaspace' : ''}<br />{shortHex(positionHex(s.position, s.plane), 6, 4)}</span>,
  ]
}

export function ChainConflictPrompt(): JSX.Element | null {
  const conflict = useCyberspace((s) => s.chainConflict)
  const events = useCyberspace((s) => s.events)
  const live = useCyberspace((s) => s.live)
  const check = useCyberspace((s) => s.selfCheck)
  const aside = useChainUi((s) => s.promptAside)
  const [confirming, setConfirming] = useState(false)
  // A resolved prompt forgets the second step and being set aside, so the
  // next conflict starts at the first question, on screen.
  useEffect(() => {
    if (conflict) return
    setConfirming(false)
    useChainUi.getState().setPromptAside(false)
  }, [conflict])
  const relay = useMemo(() => (conflict ? summarizeChain(conflict.relayEvents) : null), [conflict])
  const local = useMemo(() => summarizeChain(events), [events])
  const canKeepLocal = useMemo(() => (conflict ? localSupersedes(events, conflict.relayEvents) : false), [conflict, events])
  // Why it was held is the check as it was before the relays answered; once
  // they have, the reason worth giving is the one the person saw.
  const why = check.status === 'unknown' ? holdReason(check) : 'the relays had not answered yet'

  if (!conflict || !relay || !local || aside) return null
  const now = Date.now() / 1000
  const setAside = (): void => { setConfirming(false); useChainUi.getState().setPromptAside(true) }
  const resolve = (choice: 'relay' | 'local'): void => { setConfirming(false); useCyberspace.getState().resolveHeldConflict(choice) }

  if (confirming) {
    return (
      <ConfirmModal
        title="Replace the relay chain?"
        cardClassName="chainconflict"
        onBackdrop={setAside}
        body={<>
          <p><b>What this does:</b> this device's chain ({local.actions} action{local.actions === 1 ? '' : 's'}) {live
            ? 'is published to the relays now'
            : 'stops being held and is published the next time you take an action while LIVE; your switch is LOCAL, so until then it stays on this device'}.
          </p>
          <p><b>What it replaces:</b> its spawn is newer than the relay chain's, and the protocol places every identity by its newest spawn (spec §3.2). Once it is published, every reader, on every device, follows this chain and stops following the relay chain.</p>
          <p><b>What stays:</b> the relay chain's {relay.actions} action{relay.actions === 1 ? '' : 's'} stay on the relays as history, but they no longer place you. This cannot be undone.</p>
        </>}
        confirmLabel="PUBLISH AND REPLACE"
        cancelLabel="BACK"
        danger
        onConfirm={() => resolve('local')}
        onCancel={() => setConfirming(false)}
      />
    )
  }

  return (
    <ConfirmModal
      title="This identity already has a chain"
      cardClassName="chainconflict"
      scroll
      onBackdrop={setAside}
      body={<>
        <p><b>What happened:</b> you started moving on this device before the relays could confirm whether this identity already had a chain ({why}). A chain is the sequence of signed movement events for your identity, starting with a spawn: the first event, which places your identity at the coordinate your public key decodes to. Because the relays could not confirm it, the chain your first move started was held on this device and nothing was published. The relays have now answered, and there is a chain there too.</p>
        <p><b>Why you have to choose:</b> one identity has one chain. The protocol places an identity by its newest spawn (spec §3.2), which here would always be the one this device signed a moment ago, so that rule is suspended and nothing is chosen until you answer.</p>
        <ChainCompare
          labels={SUMMARY_LABELS}
          columns={[
            { heading: 'ON THE RELAYS', cells: summaryCells(relay, now) },
            { heading: 'THIS DEVICE (HELD)', cells: summaryCells(local, now) },
          ]}
        />
        <p><b>Keep the relay chain:</b> the chain on this device is deleted and you stand at the relay chain's head. Region keys your moves here found stay in your Secrets, because a key is knowledge and not part of a chain.</p>
        {canKeepLocal ? (
          <p><b>Keep the local chain:</b> this device's chain is published and, being newer, replaces the relay chain for every reader. The old chain stays on the relays as history but no longer places you. This cannot be undone, and you are asked to confirm it a second time.</p>
        ) : (
          <p><b>Why the local chain cannot be kept:</b> the relay chain's spawn is newer than this device's, so publishing this device's chain would not place you anywhere. Only the relay chain can be kept.</p>
        )}
        <p><b>Not now:</b> a tap outside this card sets it aside without choosing. No move is taken until you choose, and CHAIN CONFLICT, under the LIVE/LOCAL switch and in the Proof chain panel, brings it back.</p>
      </>}
      confirmLabel="KEEP THE RELAY CHAIN"
      cancelLabel={canKeepLocal ? 'KEEP THE LOCAL CHAIN' : null}
      danger={false}
      onConfirm={() => resolve('relay')}
      onCancel={() => { if (canKeepLocal) setConfirming(true) }}
    />
  )
}
