/**
 * ChatDock.tsx — the room you are standing in.
 *
 * Folded, it is a chip at the bottom centre with a count of what came in
 * while it was folded. Unfolded, it is the last lines of talk in this region,
 * newest at the bottom, older ones climbing and fading out above a third of
 * the screen, and a line to type into. It sits between the menu button on
 * the left and the controls on the right, so it never covers either.
 *
 * `/` unfolds it and puts the caret in the line; Escape folds it. A line that
 * arrives from someone else unfolds it on its own, so a room that starts
 * talking is heard.
 */

import { useEffect, useMemo, useRef } from 'react'
import { MessageSquare, SendHorizontal, Trash2, Volume2, VolumeX, ChevronDown } from 'lucide-react'
import { useChat, sendKey, type ChatLine } from '../store/useChat'
import { useCyberspace } from '../store/useCyberspace'
import { useSecrets } from '../store/useSecrets'
import { ProfilePic } from './ProfileBadge'
import { useProfile } from '../hooks/useProfile'
import { formatCellSize } from '../lib/scale'
import { MAX_CHAT_LENGTH } from '../lib/hidden'

/** How many lines the unfolded dock shows; the rest are a scroll away. */
const SHOWN = 200

function whenLabel(at: number, now: number): string {
  const s = Math.max(0, now - at)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

function Line({ line, now }: { line: ChatLine; now: number }): JSX.Element {
  const profile = useProfile(line.from)
  const name = line.mine ? 'you' : (profile?.name ?? line.from.slice(0, 8))
  return (
    <li className={`chat__line ${line.mine ? 'is-mine' : ''}`}>
      <ProfilePic pubkey={line.from} size={22} />
      <div className="chat__body">
        <span className="chat__meta">
          <span className="chat__who">{name}</span>
          <span className="chat__when">{whenLabel(line.at, now)}</span>
        </span>
        <span className="chat__text">{line.text}</span>
      </div>
    </li>
  )
}

export function ChatDock(): JSX.Element {
  const open = useChat((s) => s.open)
  const lines = useChat((s) => s.lines)
  const unread = useChat((s) => s.unread)
  const muted = useChat((s) => s.muted)
  const draft = useChat((s) => s.draft)
  const sendStatus = useChat((s) => s.sendStatus)
  const sendError = useChat((s) => s.sendError)
  const current = useSecrets((s) => s.current)
  const atHead = useCyberspace((s) => s.atHead())
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const now = Math.floor(Date.now() / 1000)

  // The region a line would go to right now: its size is the room's name.
  const key = useMemo(() => sendKey(), [current])
  const room = key ? `2^${key.height} · ${formatCellSize(key.height)}` : 'no region yet'
  const shown = lines.slice(-SHOWN)

  // Unfolding puts the caret in the line, and the newest line in view.
  useEffect(() => {
    if (!open) return
    const el = list.current
    if (el) el.scrollTop = el.scrollHeight
  }, [open, lines.length])

  useEffect(() => {
    if (open && useChat.getState().focusOnOpen) {
      input.current?.focus()
      useChat.setState({ focusOnOpen: false })
    }
  }, [open])

  if (!open) {
    return (
      <button
        className="chip chatdock__chip"
        onClick={() => useChat.setState({ open: true, unread: 0, focusOnOpen: false })}
        aria-label={unread > 0 ? `Open chat, ${unread} new` : 'Open chat'}
        title="Chat with whoever is standing here (/)"
      >
        <MessageSquare size={11} strokeWidth={2.25} aria-hidden /> CHAT
        {unread > 0 && <span className="chatdock__badge">{unread > 99 ? '99+' : unread}</span>}
      </button>
    )
  }

  const busy = sendStatus === 'signing' || sendStatus === 'sending'

  return (
    <section className="chatdock" aria-label="Chat">
      <header className="chatdock__head">
        <span className="chatdock__title">
          <MessageSquare size={12} strokeWidth={2.25} aria-hidden /> CHAT
          <span className="chatdock__room" title="The region a line reaches: everyone whose passive scan covers this cube">{room}</span>
        </span>
        <span className="chatdock__acts">
          <button className="chatdock__act" onClick={() => useChat.getState().toggleMuted()} aria-pressed={muted} title={muted ? 'Sound off. Tap for sound on arrival' : 'Sound on arrival. Tap to mute'}>
            {muted ? <VolumeX size={12} strokeWidth={2.25} aria-hidden /> : <Volume2 size={12} strokeWidth={2.25} aria-hidden />}
          </button>
          <button className="chatdock__act" onClick={() => { if (lines.length === 0 || window.confirm('Forget every line on this device?')) useChat.getState().clear() }} title="Clear the chat on this device" aria-label="Clear chat">
            <Trash2 size={12} strokeWidth={2.25} aria-hidden />
          </button>
          <button className="chatdock__act" onClick={() => useChat.getState().setOpen(false)} title="Fold the chat away (Esc)" aria-label="Collapse chat">
            <ChevronDown size={13} strokeWidth={2.25} aria-hidden />
          </button>
        </span>
      </header>

      <ul className="chat__list" ref={list}>
        {shown.length === 0 && (
          <li className="chat__empty">
            Nothing said here yet. A line reaches everyone standing in the same {key ? `2^${key.height}` : ''} cube, and the relay keeps none of it.
          </li>
        )}
        {shown.map((l) => <Line key={l.id} line={l} now={now} />)}
      </ul>

      <form
        className="chat__compose"
        onSubmit={(e) => { e.preventDefault(); void useChat.getState().send() }}
      >
        <input
          ref={input}
          className="chat__input"
          value={draft}
          onChange={(e) => useChat.getState().setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); useChat.getState().setOpen(false) } }}
          placeholder={!atHead ? 'Come back to your head to talk' : key ? 'Say something to this region' : 'Waiting for the scan of where you stand'}
          maxLength={MAX_CHAT_LENGTH}
          disabled={busy || !atHead}
          autoComplete="off"
          autoCapitalize="sentences"
          enterKeyHint="send"
          aria-label="Chat message"
        />
        <button className="chat__send" type="submit" disabled={busy || !atHead || draft.trim() === '' || !key} aria-label="Send" title={busy ? 'Sending' : 'Send (Enter)'}>
          <SendHorizontal size={15} strokeWidth={2.25} aria-hidden />
        </button>
      </form>
      {sendStatus === 'error' && sendError && <p className="chat__error">{sendError}</p>}
      {busy && <p className="chat__status">{sendStatus === 'signing' ? 'SIGNING' : 'SENDING'}</p>}
    </section>
  )
}
