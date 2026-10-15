/**
 * DemoCoach.tsx: the /demo tour's caption panel (arkinox, 2026-10-14).
 *
 * The one place ONOSENDAI shows paragraphs on screen, and only under /demo
 * (arkinox: "captions are OK"). It sits at the top, folds to a one-line bar,
 * and pushes the instrument stack down while it is open so the two never
 * overlap. NEXT and BACK, the arrow keys, and Space present it; SPEAK reads
 * the caption aloud, only when tapped.
 *
 * Space stays with the scene on a step that asks for a hop or a walk, where
 * Space is a movement key; everywhere else it advances the tour. On a gated
 * step NEXT, the arrow and Space stay off until its action is done.
 *
 * At most about a third of the screen tall (arkinox, 2026-10-15): the title,
 * caption and panel scroll inside it, while the instruction, SPAWN and the
 * BACK / NEXT row stay pinned at its foot, so a gated step's way on is
 * always in reach.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Square, SquareMinus, SquarePlus, Volume2, X, type LucideIcon } from 'lucide-react'
import { splitCaption } from '../demo/captionTokens'
import { getEventHash, verifyEvent } from 'nostr-tools/pure'
import type { NostrEvent } from 'nostr-tools'
import { gateHeld, tourKeyNeedsSpawn, useDemo } from '../store/useDemo'
import { useCyberspace } from '../store/useCyberspace'
import { useAvatars } from '../store/useAvatars'
import { currentRelays } from '../store/useRelays'
import { normalizeURL } from 'nostr-tools/utils'
import { chainHolders } from '../lib/chainHolders'
import { spawnTemplate } from '../lib/events'
import { canSpeak, speak, stopSpeaking } from '../demo/voice'
import type { DemoPanel, DemoStep } from '../demo/types'
import { ConfirmModal } from './ConfirmModal'
import { ChainStatusStrip, useChainStatus } from './ChainStatus'
import { GO_LIVE_BODY } from './TouchControls'

/** The kinds the Built on Nostr chapter lists (onosendai/kinds.md). */
const KINDS: Array<[number, string]> = [
  [3333, 'Movement: spawn, hop, sidestep, hyperspace'],
  [33330, 'A bag: things hidden at a place, encrypted'],
  [33331, 'An object: a 3D shape (SNO)'],
  [11333, 'An avatar: the shape you are seen as'],
  [321, 'A Bitcoin block anchor: a hyperspace stop'],
  [0, 'A profile: name and picture'],
]

/** The icons a caption may draw ({icon:name}, demo/captionTokens.ts): this list and no other. */
const CAPTION_ICONS: Record<string, LucideIcon> = { plus: SquarePlus, minus: SquareMinus }

/** A caption with its icons drawn inline at text size; everything else is text, never HTML. */
export function CaptionText({ caption }: { caption: string }): JSX.Element {
  return (
    <>
      {splitCaption(caption).map((p, i) => {
        if ('text' in p) return <span key={i}>{p.text}</span>
        const Icon = Object.hasOwn(CAPTION_ICONS, p.icon) ? CAPTION_ICONS[p.icon] : undefined
        return Icon ? <Icon key={i} className="demo__icon-inline" size="1em" strokeWidth={2.25} aria-label={`${p.icon} button`} role="img" /> : null
      })}
    </>
  )
}

/** The caption a step shows to this identity, while its action waits (`done` false) or after. */
export function captionFor(step: DemoStep, hasChain: boolean, done = true, ownAvatar = false): string {
  if (!done && step.captionWaiting) return step.captionWaiting
  if (step.captionReturning && (hasChain || ownAvatar)) return step.captionReturning
  return !hasChain && step.captionNew ? step.captionNew : step.caption
}

/** Your newest movement event, or the spawn your first move will sign (unsigned, labeled). */
function useNewestEvent(): { event: NostrEvent | Omit<NostrEvent, 'id' | 'sig'>; signed: boolean } {
  const events = useCyberspace((s) => s.events)
  const pubkey = useCyberspace((s) => s.identity.pubkey)
  return useMemo(() => {
    const head = events[events.length - 1]
    if (head) return { event: head, signed: true }
    const t = spawnTemplate(pubkey, Math.floor(Date.now() / 1000))
    return { event: { ...t, pubkey }, signed: false }
  }, [events, pubkey])
}

function EventJson(): JSX.Element {
  const { event, signed } = useNewestEvent()
  // Read for the render; the chain (in useNewestEvent) changing re-renders this.
  const spawnable = !signed && tourKeyNeedsSpawn()
  const json = JSON.stringify(event, null, 2)
  return (
    <div className="demo__panel">
      {!signed && <div className="demo__note">{spawnable ? 'Not signed yet. SPAWN signs it here; LOCAL keeps it on this device until GO LIVE.' : 'Not signed yet: this is what your first move signs.'}</div>}
      <pre className="demo__json">{json}</pre>
    </div>
  )
}

function Verify({ waiting }: { waiting: boolean }): JSX.Element {
  const { event, signed } = useNewestEvent()
  const check = useMemo(() => {
    if (!signed) return null
    // A fresh copy: nostr-tools remembers a verification on the object it
    // checked, and the point here is to check, not to remember.
    const copy = JSON.parse(JSON.stringify(event)) as NostrEvent
    return { idOk: getEventHash(copy) === copy.id, sigOk: verifyEvent(copy), id: copy.id, sig: copy.sig }
  }, [event, signed])
  if (waiting) return <div className="demo__panel"><div className="demo__note">No hop yet: press COMMIT.</div></div>
  if (!check) return <div className="demo__panel"><div className="demo__note">No signed event yet.</div></div>
  return (
    <div className="demo__panel demo__checks">
      <div className={check.idOk ? 'is-ok' : 'is-bad'}>{check.idOk ? '✓' : '✗'} ID = sha256(fields) <code>{check.id.slice(0, 16)}…</code></div>
      <div className={check.sigOk ? 'is-ok' : 'is-bad'}>{check.sigOk ? '✓' : '✗'} Schnorr signature by your key <code>{check.sig.slice(0, 16)}…</code></div>
    </div>
  )
}

function Relays(): JSX.Element {
  const pubkey = useCyberspace((s) => s.identity.pubkey)
  // Only a chain that exists can be held; a new identity's relays are only asked.
  const hasChain = useCyberspace((s) => s.events.length > 0)
  const relays = currentRelays()
  const holders = chainHolders(pubkey)
  return (
    <div className="demo__panel">
      <ul className="demo__list">
        {relays.map((r) => (
          <li key={r}><code>{r.replace(/^wss:\/\//, '')}</code> {hasChain && holders.has(normalizeURL(r)) ? <span className="is-ok">holds your chain</span> : <span className="demo__dim">asked</span>}</li>
        ))}
      </ul>
    </div>
  )
}

function Kinds(): JSX.Element {
  return (
    <div className="demo__panel">
      <table className="demo__kinds"><tbody>
        {KINDS.map(([k, what]) => <tr key={k}><td><code>{k}</code></td><td>{what}</td></tr>)}
      </tbody></table>
    </div>
  )
}

function Chain(): JSX.Element {
  const events = useCyberspace((s) => s.events)
  const head = events[events.length - 1]
  const before = events[events.length - 2]
  if (!head || !before) return <div className="demo__panel"><div className="demo__note">Make a move or two and this shows the link.</div></div>
  const prev = head.tags.find((t) => t[0] === 'e' && t[3] === 'previous')?.[1] ?? null
  const ok = prev === before.id
  return (
    <div className="demo__panel demo__checks">
      <div>newest <code>{head.id.slice(0, 16)}…</code></div>
      <div>names previous <code>{(prev ?? 'none').slice(0, 16)}…</code></div>
      <div className={ok ? 'is-ok' : 'is-bad'}>{ok ? '✓' : '✗'} the event before it <code>{before.id.slice(0, 16)}…</code></div>
    </div>
  )
}

function Finish(): JSX.Element {
  const live = useCyberspace((s) => s.live)
  const [confirming, setConfirming] = useState(false)
  // A held chain, a pending choice or a send with no relay is what the strip
  // under the switch already says; GO LIVE shows it rather than LIVE alone.
  const status = useChainStatus()
  return (
    <div className="demo__panel demo__finish">
      {live
        ? status ? <ChainStatusStrip status={status} /> : <div className="is-ok">You are LIVE.</div>
        : <button className="demo__btn demo__btn--live" onClick={() => setConfirming(true)}>GO LIVE</button>}
      <a className="demo__link" href="https://github.com/arkin0x/cyberspace" target="_blank" rel="noreferrer">Read the protocol</a>
      {confirming && (
        <ConfirmModal
          title="Publishing"
          body={<span className="modal__pre">{GO_LIVE_BODY}</span>}
          confirmLabel="SWITCH TO LIVE"
          cancelLabel="CANCEL"
          danger={false}
          cardClassName="golive"
          // The switch alone publishes nothing until the next action
          // (release.ts); GO LIVE is a request to publish, so the waiting
          // chain goes now, by the publisher's own rules (publishNow).
          onConfirm={() => { setConfirming(false); useDemo.getState().wentLive(); useCyberspace.getState().setLive(true); useCyberspace.getState().publishNow() }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  )
}

function Panel({ panel, waiting }: { panel: DemoPanel; waiting: boolean }): JSX.Element {
  switch (panel) {
    case 'event-json': return <EventJson />
    case 'verify': return <Verify waiting={waiting} />
    case 'relays': return <Relays />
    case 'kinds': return <Kinds />
    case 'chain': return <Chain />
    case 'finish': return <Finish />
  }
}

export function DemoCoach(): JSX.Element | null {
  const active = useDemo((s) => s.active)
  const index = useDemo((s) => s.index)
  const done = useDemo((s) => s.done)
  const minimized = useDemo((s) => s.minimized)
  const empty = useDemo((s) => s.empty)
  const script = useDemo((s) => s.script)
  const hasChain = useCyberspace((s) => s.events.length > 0)
  // An avatar of your own rather than the default shape (useAvatars).
  const ownAvatar = useAvatars((s) => !!s.shards[useCyberspace.getState().identity.pubkey]?.vertices.length)
  const [speaking, setSpeaking] = useState(false)
  const [spawning, setSpawning] = useState<'idle' | 'signing' | 'failed'>('idle')
  const ref = useRef<HTMLDivElement | null>(null)

  const step = script.steps[index]
  const chapterIndex = step ? script.chapters.findIndex((c) => c.id === step.chapter) : -1
  const chapter = script.chapters[chapterIndex]
  const inChapter = step ? script.steps.filter((s) => s.chapter === step.chapter) : []
  const stepInChapter = step ? inChapter.findIndex((s) => s.id === step.id) : -1
  const last = index === script.steps.length - 1

  // The control a step points at wears a pulsing ring while the step is up.
  const highlight = active ? script.steps[index]?.scene.highlight : undefined
  useEffect(() => {
    if (!highlight) return
    let marked: Element[] = []
    const mark = (): void => {
      for (const el of marked) el.classList.remove('demo-pulse')
      marked = Array.from(document.querySelectorAll(highlight))
      for (const el of marked) el.classList.add('demo-pulse')
    }
    mark()
    // The control may be re-rendered (the menu opening swaps its icon).
    const mo = new MutationObserver(() => { if (marked.some((el) => !el.isConnected)) mark() })
    mo.observe(document.body, { childList: true, subtree: true })
    return () => { mo.disconnect(); for (const el of marked) el.classList.remove('demo-pulse') }
  }, [highlight])

  // A new step stops whatever was being read.
  useEffect(() => { setSpeaking(false); setSpawning('idle') }, [index])
  useEffect(() => () => stopSpeaking(), [])

  // Presenting from the keyboard: before the app's own keys (capture), so
  // the arrows never move the cursor and Space never commits on a step that
  // is only reading. Not from a text field.
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      const d = useDemo.getState()
      const cur = d.script.steps[d.index]
      const movement = cur?.wait === 'hop' || cur?.wait === 'walk' || cur?.wait === 'own-hop'
      // A gated step's keys are the scene's until its action is done.
      const held = gateHeld(cur, d.done)
      if (!held && (e.key === 'ArrowRight' || (e.code === 'Space' && !movement))) {
        e.preventDefault(); e.stopImmediatePropagation()
        if (d.index === d.script.steps.length - 1) d.exit(); else d.next()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault(); e.stopImmediatePropagation(); d.back()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active])

  // The instrument stack starts below the panel (styles.css .instruments).
  useLayoutEffect(() => {
    const root = document.documentElement
    if (!active) { root.style.removeProperty('--demo-coach-h'); root.style.removeProperty('--demo-coach-c'); return }
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    // Only when the two share columns: on a desktop the coach sits top centre
    // and the stack beside the panel column, and pushing the stack down there
    // only made it jump on every step (rehearsal, 2026-10-15).
    const put = (): void => {
      const coach = el.getBoundingClientRect()
      const below = (sel: string, prop: string): void => {
        const r = document.querySelector(sel)?.getBoundingClientRect()
        const shares = !r || r.width === 0 || (coach.left < r.right && r.left < coach.right)
        if (shares) root.style.setProperty(prop, `${Math.ceil(coach.height)}px`)
        else root.style.removeProperty(prop)
      }
      below('.instruments', '--demo-coach-h')
      // The compass too: on a phone the coach spans the screen and covered
      // the view controls for the whole tour (rehearsal, 2026-10-15).
      below('.compass-3d', '--demo-coach-c')
    }
    put()
    const ro = new ResizeObserver(put)
    ro.observe(el)
    window.addEventListener('resize', put)
    return () => { ro.disconnect(); window.removeEventListener('resize', put); root.style.removeProperty('--demo-coach-h'); root.style.removeProperty('--demo-coach-c') }
  }, [active, minimized])

  if (!active || !step) return null
  const caption = captionFor(step, hasChain, done, ownAvatar)
  const d = useDemo.getState()
  const held = gateHeld(step, done)
  const offerSpawn = step.wait === 'spawn' && !done
  const onSpawn = (): void => {
    // Asked again at the press, not only when the button was drawn: SPAWN
    // signs for the tour's own key with no chain, and for nothing else.
    if (!tourKeyNeedsSpawn()) return
    setSpawning('signing')
    void useCyberspace.getState().signSpawn().then((ok) => setSpawning(ok ? 'idle' : 'failed'), () => setSpawning('failed'))
  }
  const onSpeak = (): void => {
    if (speaking) { stopSpeaking(); setSpeaking(false); return }
    setSpeaking(true)
    void speak(`${step.title}. ${caption}`, () => setSpeaking(false))
  }
  const progress = `${chapterIndex + 1}/${script.chapters.length} · ${stepInChapter + 1}/${inChapter.length}`

  if (minimized) {
    return (
      <div className="demo demo--min" ref={ref} role="region" aria-label="Tour">
        <button className="demo__bar" onClick={() => d.setMinimized(false)} title="Show the caption">
          <span className="demo__tag">TOUR</span>
          <span className="demo__bartitle">{chapter?.title}: {step.title}</span>
          <ChevronDown size={14} aria-hidden />
        </button>
        <button className="demo__icon" onClick={d.back} disabled={index === 0} aria-label="Back"><ChevronLeft size={14} /></button>
        <button className="demo__icon" onClick={last ? d.exit : d.next} disabled={held} aria-label={last ? 'Finish' : 'Next'}><ChevronRight size={14} /></button>
      </div>
    )
  }

  return (
    <div className="demo" ref={ref} role="region" aria-label="Tour">
      <div className="demo__head">
        <span className="demo__tag">TOUR</span>
        <span className="demo__chapter">{chapter?.title}</span>
        <button className="demo__icon" onClick={() => d.setMinimized(true)} aria-label="Fold the caption" title="Fold"><ChevronUp size={14} /></button>
        <button className="demo__icon" onClick={d.exit} aria-label="Exit the tour" title="Exit the tour"><X size={14} /></button>
      </div>
      <div className="demo__bar-track" aria-hidden><div className="demo__bar-fill" style={{ width: `${((index + 1) / script.steps.length) * 100}%` }} /></div>
      <div className="demo__body">
        {/* The headline wraps rather than being cut, and the counter stands
            across from it at the top right (arkinox, 2026-10-15: the header
            on a phone read "IDENTITY IS LO..." beside LOCAL and the counter). */}
        <div className="demo__titlerow">
          <h2 className="demo__title">{step.title}</h2>
          <span className="demo__progress">{progress}</span>
        </div>
        <p className="demo__caption"><CaptionText caption={caption} /></p>
        {step.panel && <Panel panel={step.panel} waiting={held} />}
      </div>
      {step.wait && (
        <div className={`demo__wait ${done ? 'is-done' : ''}`}>
          <span>{done ? (empty && step.emptyHint ? step.emptyHint : '✓ Done') : spawning === 'failed' ? 'Not signed. Try SPAWN again.' : step.hint ?? 'Your turn.'}</span>
          {offerSpawn && (
            <button className="demo__btn demo__btn--spawn" onClick={onSpawn} disabled={spawning === 'signing'}>
              {spawning === 'signing' ? 'SIGNING' : 'SPAWN'}
            </button>
          )}
        </div>
      )}
      <div className="demo__foot">
        <button className="demo__btn" onClick={d.back} disabled={index === 0}><ChevronLeft size={14} aria-hidden /> BACK</button>
        {canSpeak() && (
          <button className={`demo__btn ${speaking ? 'is-on' : ''}`} onClick={onSpeak} aria-pressed={speaking} title={speaking ? 'Stop reading' : 'Read the caption aloud'}>
            {speaking ? <Square size={12} aria-hidden /> : <Volume2 size={12} aria-hidden />} {speaking ? 'STOP' : 'SPEAK'}
          </button>
        )}
        <button className={`demo__btn demo__btn--next ${step.wait && !done && !held ? 'is-skip' : ''}`} onClick={last ? d.exit : d.next} disabled={held} title={held ? step.hint : undefined}>
          {last ? 'FINISH' : step.wait && !done && !held ? 'SKIP' : 'NEXT'} <ChevronRight size={14} aria-hidden />
        </button>
      </div>
    </div>
  )
}
