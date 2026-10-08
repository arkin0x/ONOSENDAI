/**
 * BrokenChain.tsx - what a broken chain looks like from inside it, and the
 * way out.
 *
 * arkinox, 2026-10-07 (Q3): an invalid chain stands at its LAST VALID
 * position, frozen until a respawn. So when your chain has an event that
 * breaks a chain rule (events.ts firstBreak):
 *
 * - the avatar stands where the event before it left you (buildChain
 *   freezes every position from the first break on), for you and for anyone
 *   watching you;
 * - every move is refused (store whyNoMove, BROKEN_CHAIN_MESSAGE);
 * - this file says which event broke it, why in plain words, and, when the
 *   break is not your doing (a rule a spec change introduced, or a known
 *   ONOSENDAI bug), says so and apologizes (lib/chainBreak.ts);
 * - RESPAWN, behind a warning and a confirm step, starts a new chain, after
 *   leaving an "End of Chain" entry in RECENT at the last valid position
 *   (store respawnFromBrokenChain).
 *
 * Three pieces: BrokenChainNotice, the notice itself, in the Proof chain
 * panel and in the modal; BrokenChainChip, a red bar at the top of the
 * instrument stack so the state is never hidden behind the menu on a phone;
 * and BrokenChainModal, the notice and the respawn confirm, opened by the
 * chip, by RESPAWN in the panel, and by WHY wherever a move was refused.
 */

import { useEffect, useMemo, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { actionLabel, firstBreak, type ActionEvent } from '../lib/events'
import { apologyFor, apologyHeading, breakCause, endOfChainLabel } from '../lib/chainBreak'
import { useCyberspace } from '../store/useCyberspace'
import { walkChain } from '../store/useBuilder'
import { useChainUi } from '../store/useChainUi'
import { ConfirmModal } from './ConfirmModal'
import { Explanation } from './Explanation'

/** Your own chain's first break, resolved once per chain change. */
export function useBrokenChain(): ReturnType<typeof firstBreak> {
  const events = useCyberspace((s) => s.events)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => firstBreak(useCyberspace.getState().actions()), [events])
}

/** A reason as a sentence: its first letter capitalized. */
const sentence = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1)

/** "row 4, event 1a2b3c4d… (HOP)" for an action at a row. */
function rowName(index: number, a: ActionEvent): string {
  return `row ${index}, event ${a.id.slice(0, 8)}… (${actionLabel(a)})`
}

/**
 * The notice: the row and event that broke the chain, the reason, the
 * apology it is owed if any, and where you stand now. `actions` are the
 * buttons under it, which differ between the panel and the modal.
 */
export function BrokenChainNotice({ broken, actions }: { broken: NonNullable<ReturnType<typeof firstBreak>>; actions?: JSX.Element }): JSX.Element {
  const { index, action, lastValid } = broken
  const apology = apologyFor(action)
  const cause = breakCause(action)
  return (
    <div className="brokenchain" role="alert">
      <p className="brokenchain__title">
        <TriangleAlert size={13} strokeWidth={2.5} aria-hidden className="chainrows__warn" />
        YOUR CHAIN IS BROKEN AT ROW {index}
      </p>
      <p className="brokenchain__line">
        <b>What broke it:</b> {rowName(index, action)}.
      </p>
      <p className="brokenchain__line">
        <b>Why:</b> {sentence(action.breaks ?? 'it breaks a chain rule')}.
      </p>
      <p className="brokenchain__line">
        <b>Where you are now:</b> every verifier treats your chain as invalid from row {index} on, so you stand frozen {lastValid
          ? <>at your last valid position, where {rowName(index - 1, lastValid)} left you</>
          : <>at your spawn coordinate, the place your public key decodes to, because the spawn that starts this chain is itself invalid and no event on it counts. The newest spawn always decides which chain is yours, so an older chain of yours does not come back in its place</>}. Nothing more can move you on this chain, and ONOSENDAI will not sign a move onto it. A respawn starts a new chain.
      </p>
      {apology && (
        <p className={`brokenchain__sorry brokenchain__sorry--${cause?.kind ?? 'none'}`}>
          <b>{cause ? apologyHeading(cause) : ''}</b> {apology}
        </p>
      )}
      {actions && <div className="brokenchain__actions">{actions}</div>}
      <Explanation>
        A chain is a list of signed actions, each one naming the action
        before it and starting exactly where the action before it ended. A
        verifier, any client that reads your chain to find out where you are,
        walks it from your spawn and accepts each action only if it follows
        every chain rule. At the first action that does not, the walk stops:
        that action and everything after it count for nothing.
        <br /><br />
        So ONOSENDAI shows you, and everyone who sees you, at the last place
        your chain was valid, not where the later actions claim to take you.
        Your avatar is frozen there. The rows after the break are still in the
        Proof chain panel, marked BROKEN where they break a rule themselves,
        and SHOW THE ROW takes the chain explorer to the first one, but none of
        them moves you, and a new move would not either, which is why every
        way of moving stands down.
        <br /><br />
        A signed action cannot be edited or taken back, so a broken chain
        cannot be repaired. The way forward is a respawn: a new spawn starts a
        new chain at your spawn point, the coordinate your public key decodes
        to, and the broken chain stays on the relays as history that no
        longer places you. Before it respawns, ONOSENDAI adds{' '}
        {endOfChainLabel((lastValid ?? action).id)} to RECENT in the Position panel, at the
        place this chain froze, so you can look at it again and travel back.
        It is marked KEPT and stays in RECENT until you remove it.
        <br /><br />
        When a break is not your doing, ONOSENDAI says so. If the rule it
        breaks, or the check it fails, took effect after the action was
        signed, your chain was valid when you made it, and the notice says on
        which day and by what the rules changed, and apologizes. If a bug in
        ONOSENDAI signed the action wrong before the bug was fixed, the notice
        says that ONOSENDAI caused it. An action signed after the rule took
        effect, or after the fix shipped, gets the reason without an apology,
        because the rule was already there to follow.
      </Explanation>
    </div>
  )
}

/** The red bar at the top of the instrument stack while your chain is broken. Tap: the notice and RESPAWN. */
export function BrokenChainChip(): JSX.Element | null {
  const broken = useBrokenChain()
  const spectating = useCyberspace((s) => s.spectate !== null)
  if (!broken || spectating) return null
  return (
    <button
      className="hyperbar hyperbar--broken"
      onClick={() => useChainUi.getState().setBrokenView('notice')}
      title="Your chain is broken. Tap to see which action broke it, why, and how to respawn."
      aria-label={`Chain broken at row ${broken.index}. Tap for why and to respawn.`}
    >
      <TriangleAlert size={14} strokeWidth={2.5} aria-hidden className="hyperbar__glyph" />
      <span className="hyperbar__text">
        <span className="hyperbar__label">CHAIN BROKEN AT ROW {broken.index}</span>
        <span className="hyperbar__meta">FROZEN AT YOUR LAST VALID POSITION · TAP FOR WHY AND RESPAWN</span>
      </span>
    </button>
  )
}

/** What a respawn does, said in full before it is done. `lastValid` names the End of Chain entry: the invalid spawn when no event is valid. */
function RespawnWarning({ lastValid }: { lastValid: ActionEvent }): JSX.Element {
  const events = useCyberspace((s) => s.events.length)
  return (
    <>
      <p><b>A respawn starts you over.</b> Read this before you confirm, because it cannot be undone.</p>
      <ul>
        <li><b>A new chain begins at your spawn point,</b> the coordinate your public key decodes to. ONOSENDAI signs a new spawn now, and it goes to the relays like any other action of yours. Your identity, your key and your profile stay exactly as they are.</li>
        <li><b>The old chain stays on the relays as history.</b> All {events} of its actions remain there, but from now on it no longer places you anywhere, for anyone.</li>
        <li><b>The travel on the old chain is lost.</b> You do not keep the position it reached; getting back there means traveling there again on the new chain.</li>
        <li><b>Your region keys and your items are kept.</b> A region key is knowledge, not chain state, and nothing you hold is stored on the chain.</li>
        <li><b>Before it respawns, ONOSENDAI adds {endOfChainLabel(lastValid.id)} to RECENT</b> in the Position panel, at your last valid position, so you can view that place again and find your way back. It is marked KEPT and stays there until you remove it, however many other places you look at.</li>
      </ul>
    </>
  )
}

/**
 * What a failed respawn says: the reason, that nothing changed, and, on a
 * broken chain, that the End of Chain entry added first is kept.
 */
export function respawnFailed(err: unknown, lastValidId?: string): string {
  const reason = err instanceof Error ? err.message : String(err)
  const kept = lastValidId ? ` ${endOfChainLabel(lastValidId)} stays in RECENT in the Position panel.` : ''
  return `Respawn failed: ${reason}. Nothing was signed, and your chain is as it was.${kept} You can try again.`
}

/**
 * Carry out a respawn confirmed for `pubkey`'s broken chain. Resolves to
 * null when it is done, or to what to tell the person when it failed: the
 * modal then stays open and says so, and the End of Chain entry it added
 * first stays in RECENT (review of #227). Never rejects.
 */
export async function confirmRespawn(pubkey: string, endOfChainId: string): Promise<string | null> {
  try {
    await useCyberspace.getState().respawnFromBrokenChain(pubkey)
    return null
  } catch (err) {
    return respawnFailed(err, endOfChainId)
  }
}

/** The notice in a modal, then the respawn's confirm step. Mounted once, in App. */
export function BrokenChainModal(): JSX.Element | null {
  const view = useChainUi((s) => s.brokenView)
  const broken = useBrokenChain()
  const pubkey = useCyberspace((s) => s.identity.pubkey)
  const [busy, setBusy] = useState(false)
  // A respawn that did not happen says so and keeps the modal open; the End
  // of Chain entry it added first stays in RECENT.
  const [failed, setFailed] = useState<string | null>(null)
  useEffect(() => { setFailed(null) }, [view, pubkey])
  if (!view || !broken) return null
  const close = (): void => useChainUi.getState().setBrokenView(null)
  if (view === 'notice') {
    return (
      <ConfirmModal
        title="Frozen at your last valid position"
        cardClassName="brokenchain__card"
        scroll
        danger={false}
        body={<BrokenChainNotice broken={broken} actions={(
          <button className="tag tag--tap" onClick={() => { close(); walkChain(broken.index) }}>SHOW THE ROW</button>
        )} />}
        cancelLabel="CLOSE"
        confirmLabel="RESPAWN"
        onCancel={close}
        onConfirm={() => useChainUi.getState().setBrokenView('confirm')}
      />
    )
  }
  return (
    <ConfirmModal
      title="Respawn?"
      cardClassName="brokenchain__card"
      scroll
      busy={busy}
      body={(
        <>
          <RespawnWarning lastValid={broken.lastValid ?? broken.action} />
          {failed && <p className="notice" role="alert">{failed}</p>}
        </>
      )}
      cancelLabel="GO BACK"
      confirmLabel={failed ? 'TRY AGAIN' : 'RESPAWN NOW'}
      onCancel={() => useChainUi.getState().setBrokenView('notice')}
      onBackdrop={close}
      onConfirm={() => {
        setBusy(true)
        setFailed(null)
        void confirmRespawn(pubkey, (broken.lastValid ?? broken.action).id).then((failure) => {
          setBusy(false)
          if (failure) setFailed(failure)
          else close()
        })
      }}
    />
  )
}
