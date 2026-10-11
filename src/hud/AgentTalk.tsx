/**
 * AgentTalk.tsx: the private conversation with one of your agents, opened
 * by TALK on its MY AGENTS row (arkinox, 2026-10-10, operator and agent DMs).
 *
 * Top to bottom: the STRATEGY line (the newest standing orders you sent, set
 * or replaced here), the history, the quick orders, and the composer. The
 * quick orders (COME TO ME, REPORT, HOLD, KEEP GOING) are not commands of any protocol:
 * each only writes a message into the composer, which you read and SEND, so
 * nothing goes out on one stray tap. COME TO ME carries your coordinate.
 * KEEP GOING is the one with a marker (lib/dm.ts CONTINUE_TAG, arkinox
 * 2026-10-11): sent, it renews the agent's spent session budget, read by the
 * agent's server rather than its model, so the work under way resumes.
 *
 * Everything is a NIP-17 DM (lib/dm.ts, store/useAgentDms.ts). Without a DM
 * inbox (kind 10050) on either side the conversation says "NO DM INBOX" with
 * a tooltip on what that is, and nothing is sent; your 10050 is never
 * published for you. House rules: no standing paragraphs (the EXPLAIN pill
 * holds the prose), lucide icons, uppercase labels, and a card that fits a
 * phone. Hooks stay above any return (hookOrder.test.ts).
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ClipboardList, Copy, FastForward, Hand, MapPin, Send, Square, Target, Volume2, X } from 'lucide-react'
import { useAgentConversation } from '../hooks/useAgentConversation'
import { useEscape } from '../hooks/useEscape'
import { formatAgo, formatStamp } from '../lib/time'
import { useCyberspace } from '../store/useCyberspace'
import { setTalking, useAgentDms } from '../store/useAgentDms'
import { Explanation } from './Explanation'
import { ProfileBadge } from './ProfileBadge'

/** What a DM inbox is, for the tooltip on NO DM INBOX. */
export const DM_INBOX_TIP =
  'A DM inbox is a kind 10050 list naming the relays where someone reads private messages (NIP-17). Messages go only to those relays. Publish yours from a client that manages DM relays; this app never publishes it for you.'

/** The quick orders: plain messages, written into the composer. */
export function quickOrders(coordHex: string): { label: string; title: string; text: string; keepGoing?: boolean }[] {
  return [
    {
      label: 'COME TO ME',
      title: 'Write an order to come to your coordinate',
      text: `COME TO ME. I am at ${coordHex}. Quote the ride to the stop nearest me, tell me the cost, then ride there and tell me when you arrive.`,
    },
    {
      label: 'REPORT',
      title: 'Write an order to report',
      text: 'REPORT. Tell me where you are, your chain status, your budget left, and what you are doing now.',
    },
    {
      label: 'HOLD',
      title: 'Write an order to hold',
      text: 'HOLD. Stop where you are. Make no move and spend nothing until I say so.',
    },
    {
      label: 'KEEP GOING',
      title: 'Write an order that renews your agent\'s spent compute budget, so the work under way resumes',
      text: 'KEEP GOING. Your budget is renewed: resume the work under way where it stopped.',
      keepGoing: true,
    },
  ]
}

const ORDER_ICONS = [MapPin, ClipboardList, Hand, FastForward]

/** How long a tapped COPY says COPIED. */
const COPIED_MS = 1200

/** Whether this browser can speak (Web Speech API); the button is left out where it cannot. */
export function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'
}

/**
 * COPY and SPEAK under one of the agent's messages (arkinox, 2026-10-11).
 * SPEAK reads it aloud with the browser's own voice; tapped again, or when
 * another message starts speaking, it stops. Nothing leaves the device.
 */
function MessageActions({ id, text, speaking, setSpeaking }: { id: string; text: string; speaking: string | null; setSpeaking: (id: string | null) => void }): JSX.Element {
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    navigator.clipboard?.writeText(text).then(
      () => { setCopied(true); window.setTimeout(() => setCopied(false), COPIED_MS) },
      () => { /* no clipboard here */ },
    )
  }
  const on = speaking === id
  const speak = (): void => {
    const synth = window.speechSynthesis
    synth.cancel()
    if (on) { setSpeaking(null); return }
    const u = new SpeechSynthesisUtterance(text)
    u.onend = () => setSpeaking(null)
    u.onerror = () => setSpeaking(null)
    setSpeaking(id)
    synth.speak(u)
  }
  return (
    <span className="talk__acts">
      <button className="talk__act" onClick={copy} title="Copy this message">
        <Copy size={10} aria-hidden /> {copied ? 'COPIED' : 'COPY'}
      </button>
      {canSpeak() && (
        <button className={`talk__act ${on ? 'is-on' : ''}`} onClick={speak} title={on ? 'Stop reading aloud' : 'Read this message aloud'} aria-pressed={on}>
          {on ? <Square size={10} aria-hidden /> : <Volume2 size={10} aria-hidden />} {on ? 'STOP' : 'SPEAK'}
        </button>
      )}
    </span>
  )
}

/** Long enough for real orders, short enough to stay one message. */
const MAX_DM = 4000

export function AgentTalk({ agent, onClose }: { agent: string; onClose: () => void }): JSX.Element {
  const talk = useAgentConversation(agent)
  const coordHex = useCyberspace((s) => s.coordHex())
  const [draft, setDraft] = useState('')
  // Set by KEEP GOING: the draft goes out with the marker. Cleared when the
  // draft empties or another order replaces it.
  const [keepGoing, setKeepGoing] = useState(false)
  // The message being read aloud, if any; speech stops when TALK closes.
  const [speaking, setSpeaking] = useState<string | null>(null)
  useEffect(() => () => { if (canSpeak()) window.speechSynthesis.cancel() }, [])
  // null while the STRATEGY line only shows; text while it is being set.
  const [strategyDraft, setStrategyDraft] = useState<string | null>(null)
  // The NO DM INBOX tip, opened by a tap: a title alone never shows on a phone.
  const [tip, setTip] = useState(false)
  const listRef = useRef<HTMLOListElement>(null)
  useEscape('modal', true, onClose)
  // The newest message in view whenever one arrives.
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [talk.messages.length])

  const canSend = !talk.blocked && !talk.sending
  const send = (): void => {
    const text = draft.trim()
    if (!text || !canSend) return
    void talk.send(text, false, keepGoing).then((ok) => { if (ok) { setDraft(''); setKeepGoing(false) } })
  }
  const sendStrategy = (): void => {
    const text = strategyDraft?.trim()
    if (!text || !canSend) return
    void talk.send(text, true).then((ok) => { if (ok) setStrategyDraft(null) })
  }
  const noInbox = talk.blocked !== null && /^No DM inbox/.test(talk.blocked)
  // A stray tap outside must not throw away an order being written: with a
  // draft the backdrop does nothing, and the close button or Escape still close.
  const backdrop = (): void => { if (!draft.trim() && !strategyDraft?.trim()) onClose() }

  return createPortal(
    <div className="modal" role="dialog" aria-modal="true" aria-label="Talk to your agent" onPointerDown={backdrop}>
      <div className="modal__card login talk" onPointerDown={(e) => e.stopPropagation()}>
        <div className="login__head">
          <h2 className="modal__title talk__title">TALK <ProfileBadge pubkey={agent} /></h2>
          <button className="secret__close" onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>

        {talk.blocked && (
          <p className="notice talk__notice">
            {noInbox ? (
              <>
                <button className="tag tag--tap" onClick={() => setTip((t) => !t)} title={DM_INBOX_TIP} aria-expanded={tip}>NO DM INBOX</button>
                {' '}{talk.blocked.replace(/^No DM inbox: /, '')}
              </>
            ) : talk.blocked}
          </p>
        )}
        {noInbox && tip && <div className="explain__well legend__note">{DM_INBOX_TIP}</div>}
        {talk.reading === 'failed' && <p className="notice talk__notice" title={talk.readError ?? undefined}>Could not read your DM inbox.</p>}
        {talk.reading !== 'failed' && talk.readError && <p className="notice talk__notice">{talk.readError}</p>}

        <div className="talk__strategy" title="Standing orders: your agent keeps the newest STRATEGY and rereads it every turn.">
          <span className="legend__label">Strategy</span>
          {strategyDraft === null ? (
            <>
              <span className={`talk__strategy-text ${talk.strategy ? '' : 'is-empty'}`}>{talk.strategy?.text ?? 'NONE SET'}</span>
              <button className="avatars__go" onClick={() => setStrategyDraft(talk.strategy?.text ?? '')} disabled={!!talk.blocked}>
                <Target size={10} /> {talk.strategy ? 'REPLACE' : 'SET'}
              </button>
            </>
          ) : (
            <div className="talk__strategy-edit">
              <textarea
                className="shards__textarea"
                value={strategyDraft}
                onChange={(e) => setStrategyDraft(e.target.value.slice(0, MAX_DM))}
                placeholder="Standing orders for your agent"
                rows={3}
                autoFocus
              />
              <div className="shards__actions">
                <button className="avatars__go" onClick={() => setStrategyDraft(null)}>CANCEL</button>
                <button className="avatars__go" onClick={sendStrategy} disabled={!canSend || !strategyDraft.trim()}>
                  {talk.sending ? 'SENDING' : 'SEND STRATEGY'}
                </button>
              </div>
            </div>
          )}
        </div>

        <ol className="talk__list" ref={listRef} aria-label="Messages">
          {talk.messages.map((m) => {
            const mine = m.from === talk.me
            return (
              <li key={m.id} className={`talk__msg ${mine ? 'talk__msg--mine' : ''}`}>
                <span className="talk__meta" title={formatStamp(m.at)}>
                  {mine ? 'YOU' : 'AGENT'}{m.strategy ? ' · STRATEGY' : ''}{m.keepGoing ? ' · KEEP GOING' : ''} · {formatAgo(m.at)}
                </span>
                <span className="talk__text">{m.text}</span>
                {!mine && <MessageActions id={m.id} text={m.text} speaking={speaking} setSpeaking={setSpeaking} />}
              </li>
            )
          })}
          {talk.messages.length === 0 && (
            <li className="avatars__empty">{talk.myInbox.status === 'loading' ? 'Reading your DM inbox…' : talk.myInbox.status === 'ready' ? 'No messages yet.' : 'No messages to show.'}</li>
          )}
        </ol>

        <div className="talk__orders">
          {quickOrders(coordHex).map((o, i) => {
            const Icon = ORDER_ICONS[i]
            return (
              <button key={o.label} className="avatars__go" title={o.title} onClick={() => { setDraft(o.text); setKeepGoing(!!o.keepGoing) }} disabled={!!talk.blocked}>
                <Icon size={10} /> {o.label}
              </button>
            )
          })}
        </div>

        <div className="talk__compose">
          <textarea
            className="shards__textarea"
            value={draft}
            onChange={(e) => { const v = e.target.value.slice(0, MAX_DM); setDraft(v); if (!v.trim()) setKeepGoing(false) }}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send() }}
            placeholder="A private message to your agent"
            rows={2}
            disabled={!!talk.blocked}
          />
          <button className="avatars__go talk__send" onClick={send} disabled={!canSend || !draft.trim()} title="Send as a private NIP-17 message">
            <Send size={10} /> {talk.sending ? 'SENDING' : keepGoing ? 'SEND KEEP GOING' : 'SEND'}
          </button>
        </div>
        {talk.sendError && <p className="notice talk__notice" role="status">{talk.sendError}</p>}

        <Explanation>
          Everything here is a private NIP-17 message between you and your
          agent: sealed, wrapped under a one-time key, and sent only to the
          agent&apos;s DM inbox, with a copy to yours so your history follows
          you to any device. Your agent reads them with its inbox tool and
          answers with message_operator, and obeys only you. STRATEGY is
          standing orders: the agent keeps the newest one and rereads it every
          turn. The quick orders only write a message for you to send.
          KEEP GOING also renews your agent&apos;s spent compute budget once,
          so a ride that stopped for its budget resumes.
        </Explanation>
      </div>
    </div>,
    document.body,
  )
}

/**
 * The TALK modal, wherever it was asked for: TALK on an agent's row, or the
 * notifications toast with the menu shut (arkinox, 2026-10-11). Mounted once,
 * from App, so it does not depend on the AGENTS panel being on screen.
 */
export function AgentTalkHost(): JSX.Element | null {
  const talking = useAgentDms((s) => s.talking)
  if (!talking) return null
  return <AgentTalk key={talking} agent={talking} onClose={() => setTalking(null)} />
}
