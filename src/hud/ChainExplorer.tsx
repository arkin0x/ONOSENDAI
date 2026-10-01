/**
 * ChainExplorer.tsx — walk the chain, yours or anyone's.
 *
 * Every avatar is a line of signed actions, and the scene can stand at any
 * point on that line: this is the instrument that moves you along it. Step
 * back and forward, jump to the spawn or the head, or scrub the rail, and the
 * whole scene re-anchors on that action: the avatar, the trail up to it, the
 * terrain around it, the rooms, the XOR readout showing what that hop cost.
 *
 * It rides on the scene under the XOR readout rather than in a panel, for the
 * same reason the readout does: it is something you work while looking at the
 * space, not a fact you look up. Its heading is the chip that folds it away.
 *
 * Off the head the controls are withdrawn, because nothing in history is a
 * place you can move from; LATEST brings them back. It says LATEST, not LIVE,
 * because LIVE is the publishing setting: this is the newest action on the
 * chain, whether or not any of it has been sent to a relay.
 *
 * The chip also reports what a fold from another device did to your chain:
 * actions it brought, actions it dropped, and in their own words the two
 * cases a count hides, a chain replaced by a newer spawn and published
 * moves overturned by an older branch (arkinox, 2026-10-01). They stay
 * here, on the chain's own chip, rather than under the LIVE/LOCAL switch:
 * they report something that already happened to the chain, while the
 * strip there reports a publishing state that is still in force.
 *
 * COMMENTS (N), with a speech-bubble icon, opens the reactions and public comments on the action
 * under the mark (ActionModal; arkinox, 2026-09-28). The count is asked for
 * once the mark rests, not per step of a scrub.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { KeyRound, MessageCircle } from 'lucide-react'
import { findLcaHeight } from 'cyberspace-core'
import { keyStateForAction, useSecrets } from '../store/useSecrets'
import { noCallout, useRepeatable } from '../hooks/useRepeatable'
import { formatAgo, formatStamp, shortHex } from '../lib/time'
import { useCyberspace } from '../store/useCyberspace'
import { ConfirmModal } from './ConfirmModal'
import { useActionComments } from '../hooks/useSocial'
import { countComments } from '../lib/comments'
import { ACTION_KIND } from '../lib/social'
import { useSocialUi } from '../store/useSocialUi'

/** Past this many actions the rail stops drawing a tick per action. */
const MAX_TICKS = 96

/** How long the mark rests on an action before its comments are counted. */
const COUNT_AFTER_MS = 450

/** How long an adoption stays on the chip: long enough to explain the move it caused. */
const ADOPTED_MS = 8000

export function ChainExplorer(): JSX.Element {
  const events = useCyberspace((s) => s.events)
  const fork = useCyberspace((s) => s.forkNotice)
  const [showFork, setShowFork] = useState(false)
  // An adoption explains itself and goes; a drop is work that vanished and
  // stays on the chip until somebody reads it.
  const [fresh, setFresh] = useState(true)
  useEffect(() => {
    if (!fork || fork.dropped > 0) { setFresh(true); return }
    setFresh(true)
    const t = window.setTimeout(() => setFresh(false), ADOPTED_MS)
    return () => window.clearTimeout(t)
  }, [fork])
  const spectate = useCyberspace((s) => s.spectate)
  const exploreIndex = useCyberspace((s) => s.exploreIndex)
  // Parsed once per chain change; the store caches, this just subscribes.
  const actions = useMemo(() => useCyberspace.getState().focusChain(), [events, spectate])
  const last = actions.length - 1
  const index = exploreIndex ?? last
  const action = actions[index]
  const atHead = exploreIndex === null
  const secretKeys = useSecrets((s) => s.keys)
  const key = useMemo(
    () => (action ? keyStateForAction(action, actions[index - 1] ?? null, secretKeys, findLcaHeight) : { state: 'none' as const, height: null }),
    [action, actions, index, secretKeys],
  )

  // The action the mark has rested on, and its comment count.
  const [settled, setSettled] = useState<string | null>(null)
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(action?.id ?? null), COUNT_AFTER_MS)
    return () => window.clearTimeout(t)
  }, [action?.id])
  const counted = useActionComments(action && settled === action.id ? { id: action.id, pubkey: action.pubkey, kind: ACTION_KIND } : null)
  const commentCount = action && settled === action.id && !counted.loading ? countComments(counted.comments) : null
  // Counted again when the modal closes: something may have been said there.
  const modalOpen = useSocialUi((s) => s.action !== null)
  const wasOpen = useRef(false)
  useEffect(() => {
    if (wasOpen.current && !modalOpen) counted.refresh()
    wasOpen.current = modalOpen
    // counted.refresh is a fresh closure each render; the transition is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen])

  // Minimized by default: the chip alone reads "CHAIN n/N", and the panel
  // opens on a tap when you actually want to walk the chain.
  const [open, setOpen] = useState(false)
  // Spectating opens it: the chain is the thing you came to look at. What you
  // had it set to is put back when spectation ends.
  const openBefore = useRef<boolean | null>(null)
  useEffect(() => {
    if (spectate) {
      if (openBefore.current === null) { openBefore.current = open; setOpen(true) }
    } else if (openBefore.current !== null) {
      setOpen(openBefore.current)
      openBefore.current = null
    }
    // `open` is read once, at the moment spectation starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spectate !== null])
  // Relative times drift; refresh them on a slow clock rather than per frame.
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now() / 1000), 10_000)
    return () => window.clearInterval(t)
  }, [])

  const bind = useRepeatable()
  const go = (i: number | null): void => useCyberspace.getState().explore(i)
  const step = (d: number) => () => useCyberspace.getState().exploreStep(d)

  // The rail: press or drag anywhere on it to land on the nearest action.
  const rail = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const scrubTo = (clientX: number): void => {
    const r = rail.current?.getBoundingClientRect()
    if (!r || r.width === 0 || last <= 0) return
    const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    go(Math.round(t * last))
  }

  const fraction = last <= 0 ? 1 : index / last
  const ticks = last + 1 <= MAX_TICKS ? actions.map((_, i) => (last === 0 ? 1 : i / last)) : []

  // A spectated pubkey with nothing on the relay has no chain to walk.
  if (actions.length === 0) return <></>

  return (
    <div className="explorer">
      {/* The chain is the thing that forks, so the chain's own chip is where a
          fork is reported: what another device added, and what it cost. */}
      {fork && (fork.replaced || fork.overturned > 0) ? (
        // The two cases the generic counts used to hide: the whole chain
        // superseded by a newer spawn, and published moves taken out by
        // another device's older branch (arkinox, 2026-10-01). Both stay on
        // the chip until read, like any drop.
        <button
          className="chip explorer__toggle explorer__toggle--dropped"
          {...noCallout}
          onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); setShowFork(true) }}
          aria-label={`${fork.replaced ? 'Your chain was replaced by a new spawn from another device' : `${fork.overturned} of your published moves were overturned by another device`}. Tap to read why.`}
        >
          {fork.replaced ? 'CHAIN REPLACED BY A NEW SPAWN' : `${fork.overturned} PUBLISHED MOVE${fork.overturned === 1 ? '' : 'S'} OVERTURNED`}
        </button>
      ) : fork && fork.dropped > 0 ? (
        <button
          className="chip explorer__toggle explorer__toggle--dropped"
          {...noCallout}
          onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); setShowFork(true) }}
          aria-label={`${fork.dropped} actions from this device were dropped. Tap to read why.`}
        >
          {fork.dropped} ACTION{fork.dropped === 1 ? '' : 'S'} DROPPED
        </button>
      ) : fork && fork.adopted > 0 && fresh ? (
        <button
          className="chip explorer__toggle explorer__toggle--adopted"
          {...noCallout}
          onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); setShowFork(true) }}
          aria-label={`${fork.adopted} actions arrived from another device. Tap to read why.`}
        >
          {fork.adopted} FROM ANOTHER DEVICE
        </button>
      ) : (
        <button
          className="chip explorer__toggle"
          {...noCallout}
          onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v) }}
          aria-label={open ? 'Hide chain explorer' : 'Show chain explorer'}
          aria-pressed={open}
        >
          CHAIN {index + 1}/{actions.length}{atHead ? '' : ' HISTORY'}
        </button>
      )}

      {showFork && fork && (fork.replaced ? (
        <ConfirmModal
          title="Your chain was replaced by a new spawn from another device"
          cardClassName="chainexplain"
          scroll
          body={<>
            <p><b>What happened:</b> another device signed in as you published a new spawn. A spawn is the first event of a chain: it places your identity at the coordinate your public key decodes to. The protocol places every identity by its newest spawn (spec §3.2), so the chain that new spawn starts is now your chain, for every reader and on this device. Your avatar moved to where that chain puts you.</p>
            <p><b>Why the other device did it:</b> usually one of two things. Either it respawned, which starts a new chain on purpose, or it had started a chain before it could confirm whether this identity already had one (offline, or the relays did not answer) and, when it found this chain, its user chose to keep its own chain and publish it.</p>
            <p><b>What happened to your previous chain:</b> its {fork.dropped} action{fork.dropped === 1 ? '' : 's'} on this device {fork.dropped === 1 ? 'is' : 'are'} no longer part of your chain. The ones that were published stay on the relays as history, but they no longer place you. Anything you paid HOSAKA for on that chain was spent. Region keys those moves found stay in your Secrets.</p>
            <p><b>What this device did by itself:</b> it adopted the new chain without asking, because a newer spawn from your own identity on a chain this device had already confirmed is a legitimate change made by you on another device.</p>
            <p><b>What you can do:</b> nothing is required; your next move continues the new chain. If you did not respawn or choose to keep another chain on any of your devices, someone else may be using this identity's key.</p>
          </>}
          confirmLabel="UNDERSTOOD"
          cancelLabel={null}
          danger={false}
          onConfirm={() => { setShowFork(false); useCyberspace.getState().clearForkNotice() }}
          onCancel={() => { setShowFork(false); useCyberspace.getState().clearForkNotice() }}
        />
      ) : fork.overturned > 0 ? (
        <ConfirmModal
          title={`Another device's older branch overturned ${fork.overturned} of your published move${fork.overturned === 1 ? '' : 's'}`}
          cardClassName="chainexplain"
          scroll
          body={<>
            <p><b>What happened:</b> {fork.overturned} move{fork.overturned === 1 ? '' : 's'} this device had already published {fork.overturned === 1 ? 'is' : 'are'} no longer part of your chain, for every reader. Another device signed in as you had moves from an earlier point of the chain that it had not published yet (it was LOCAL or offline), and it has now published them.</p>
            <p><b>Why its moves won:</b> both branches continue from the same action, so the chain forked. Every reader resolves a fork the same way: the older of the two next actions by created_at (the time each event says it was signed) continues the chain, a tie going to the smaller event id. The other device's first move after the fork is older than this device's, so its branch continues the chain. If that device runs this version of ONOSENDAI, it was shown both branches before publishing, was told that publishing would override these moves, and its user chose to publish.</p>
            <p><b>What happened to your moves:</b> they stay on the relays as a branch that no reader follows.{fork.dropped > fork.overturned ? ` ${fork.dropped - fork.overturned} unpublished action${fork.dropped - fork.overturned === 1 ? '' : 's'} built on them went with them.` : ''} Anything you paid HOSAKA for on that branch was spent. Region keys those moves found stay in your Secrets.</p>
            <p><b>What this device did by itself:</b> it adopted the winning branch, which is why your avatar moved. {fork.adopted} action{fork.adopted === 1 ? '' : 's'} arrived from the other device.</p>
            <p><b>What you can do:</b> nothing is required; your next move continues from where you stand now. To avoid this, act on one device at a time, or let a device that was LOCAL or offline publish before moving on another.</p>
          </>}
          confirmLabel="UNDERSTOOD"
          cancelLabel={null}
          danger={false}
          onConfirm={() => { setShowFork(false); useCyberspace.getState().clearForkNotice() }}
          onCancel={() => { setShowFork(false); useCyberspace.getState().clearForkNotice() }}
        />
      ) : (
        <ConfirmModal
          title={fork.dropped > 0 ? 'Your chain forked' : 'Another device moved you'}
          body={fork.dropped > 0 ? (<>
            One identity has one chain, however many devices you are signed in
            on. Two of them acted from the same point, so the chain forked, and
            everyone reading it resolves the fork the same way: the earlier
            action continues the chain.
            <br /><br />
            {fork.dropped} action{fork.dropped === 1 ? '' : 's'} taken on this
            device {fork.dropped === 1 ? 'is' : 'are'} not in the chain any
            more. Anything you paid HOSAKA for on that branch was spent.
            <br /><br />
            To avoid it, act on one device at a time.
          </>) : (<>
            {fork.adopted} action{fork.adopted === 1 ? '' : 's'} arrived from
            another device signed in as you, which is why your avatar moved on
            its own. Nothing of yours was lost.
          </>)}
          confirmLabel="UNDERSTOOD"
          cancelLabel={null}
          danger={false}
          onConfirm={() => { setShowFork(false); useCyberspace.getState().clearForkNotice() }}
          onCancel={() => { setShowFork(false); useCyberspace.getState().clearForkNotice() }}
        />
      ))}

      {open && action && (
        <div className={`explorer__body ${atHead ? '' : 'is-history'}`}>
          <div className="explorer__row">
            <button className="explorer__btn" title="Spawn (Home)" aria-label="Go to spawn" disabled={index === 0} {...noCallout}
              onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); go(0) }}>|◀</button>
            <button className="explorer__btn" title="Back (hold to repeat, [ key)" aria-label="Back one action" disabled={index === 0} {...bind(step(-1))}>◀</button>

            <div
              className="explorer__rail"
              ref={rail}
              role="slider"
              aria-label="Chain position"
              aria-valuemin={1}
              aria-valuemax={actions.length}
              aria-valuenow={index + 1}
              {...noCallout}
              onPointerDown={(e) => {
                e.preventDefault(); e.stopPropagation()
                dragging.current = true
                ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
                scrubTo(e.clientX)
              }}
              onPointerMove={(e) => { if (dragging.current) scrubTo(e.clientX) }}
              onPointerUp={() => { dragging.current = false }}
              onPointerCancel={() => { dragging.current = false }}
            >
              <span className="explorer__line" />
              <span className="explorer__walked" style={{ width: `${fraction * 100}%` }} />
              {ticks.map((t, i) => (
                <span key={i} className={`explorer__tick ${i === 0 ? 'explorer__tick--spawn' : ''}`} style={{ left: `${t * 100}%` }} />
              ))}
              <span className="explorer__mark" style={{ left: `${fraction * 100}%` }} />
            </div>

            <button className="explorer__btn" title="Forward (hold to repeat, ] key)" aria-label="Forward one action" disabled={index >= last} {...bind(step(1))}>▶</button>
            <button className="explorer__btn" title="Head (End)" aria-label="Go to head" disabled={index >= last} {...noCallout}
              onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); go(null) }}>▶|</button>
          </div>

          <div className="explorer__meta">
            <span className={`explorer__type explorer__type--${action.type}`}>{action.type.toUpperCase()}</span>
            <span className="explorer__when" title={formatStamp(action.createdAt)}>{formatAgo(action.createdAt, now)}</span>
            {/* A hop computes the region's Cantor root, which is the key to what
                is hidden there; a sidestep computes no root at all. */}
            {key.state !== 'none' && (
              <span
                className={`explorer__root ${key.state === 'gone' ? 'is-gone' : ''}`}
                title={key.state === 'held'
                  ? `This hop yielded the key to its 2^${key.height} region, and you still hold it.`
                  : `This hop yielded the key to its 2^${key.height} region. It is not in your Secrets list.`}
              >
                <KeyRound size={11} strokeWidth={2.25} aria-hidden />2^{key.height}
              </span>
            )}
            {atHead ? (
              <span className="explorer__live">{spectate ? 'THEIR HEAD' : 'LATEST'}</span>
            ) : (
              <button className="explorer__return" {...noCallout}
                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); go(null) }}>{spectate ? 'TO THEIR HEAD' : 'RETURN TO LATEST'}</button>
            )}
          </div>

          {/* One field per line, labelled in words, so the block stays narrow
              rather than running a wide C … S … row across the scene. */}
          <div className="explorer__detail" title={action.coordHex}>
            <span className="explorer__key">coord </span>{shortHex(action.coordHex, 8, 6)}
          </div>
          <div className="explorer__detail" title={action.sector}>
            <span className="explorer__key">sector </span>{action.sector}
          </div>
          {action.proofHash && (
            <div className="explorer__detail" title={action.proofHash}>
              <span className="explorer__key">proof </span>{shortHex(action.proofHash, 8, 6)}
            </div>
          )}
          <button className="explorer__comments" {...noCallout}
            onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); useSocialUi.getState().openAction(action) }}
          ><MessageCircle size={11} strokeWidth={2.25} aria-hidden />Comments{commentCount === null ? '' : ` (${commentCount})`}</button>
        </div>
      )}
    </div>
  )
}
