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
 *
 * Folded, while the spot at the center of the screen is not your avatar (the
 * cursor moved off it, or the view is elsewhere), the chip is a star instead
 * (StarChip.tsx): you cannot speak from there, and that is where you would
 * want to mark a place. Back on your avatar, CHAT returns. In BUILD mode CHAT
 * stays, since the Builder owns that moment. Unfolded, the dock stays as it
 * is either way.
 *
 * Mentions (arkinox, 2026-10-11): typing "@" in the line opens a short list
 * of who is nearby, your own agents first, filtered as you type; Enter, Tab
 * or a tap puts "@Name" in the line. On send the name goes out as NIP-27
 * nostr:npub and the inner event carries a p tag per person (lib/mentions.ts).
 * Lines show those references as @Name, and a line that mentions you is
 * tinted.
 */

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { nip19 } from 'nostr-tools'
import { MessageSquare, SendHorizontal, Trash2, Volume2, VolumeX, ChevronDown, Bot, AtSign } from 'lucide-react'
import { useChat, sendKey, type ChatLine } from '../store/useChat'
import { useCyberspace } from '../store/useCyberspace'
import { useSecrets } from '../store/useSecrets'
import { ProfilePic } from './ProfileBadge'
import { pressGuard } from './pressGuard'
import { useProfile } from '../hooks/useProfile'
import { formatCellSize } from 'sno-core/scale'
import { MAX_CHAT_LENGTH } from '../lib/hidden'
import { useEscape } from '../hooks/useEscape'
import { bottomChip } from '../lib/starred'
import { StarChip } from './StarChip'
import { useBuilder } from '../store/useBuilder'
import { usePresence } from '../store/usePresence'
import { useProfiles, profileLabel } from '../store/useProfiles'
import { useMyAgents } from '../hooks/useMyAgents'
import { activeMention, buildCandidates, filterCandidates, insertMention, mentionsMe, segments, type Candidate } from '../lib/mentions'

/** How many lines the unfolded dock shows; the rest are a scroll away. */
const SHOWN = 200

function whenLabel(at: number, now: number): string {
  const s = Math.max(0, now - at)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

/** A NIP-27 reference in a line, shown as @Name (arkinox, 2026-10-11). */
function MentionName({ pubkey, npub, me }: { pubkey: string; npub: string; me: boolean }): JSX.Element {
  const profile = useProfile(pubkey)
  return <span className={`chat__mention ${me ? 'is-me' : ''}`} title={npub}>{`@${profileLabel(profile, npub)}`}</span>
}

/** A line's words with its nostr:npub references as names. */
export function LineText({ text, me }: { text: string; me: string }): JSX.Element {
  const parts = useMemo(() => segments(text), [text])
  return (
    <span className="chat__text">
      {parts.map((p, i) => ('pubkey' in p ? <MentionName key={i} pubkey={p.pubkey} npub={p.npub} me={p.pubkey === me} /> : <Fragment key={i}>{p.text}</Fragment>))}
    </span>
  )
}

function Line({ line, now, here }: { line: ChatLine; now: number; here: boolean }): JSX.Element {
  const profile = useProfile(line.from)
  const me = useCyberspace((s) => s.identity.pubkey)
  const name = line.mine ? 'you' : (profile?.name ?? line.from.slice(0, 8))
  const forMe = mentionsMe(line, me)
  return (
    <li className={`chat__line ${line.mine ? 'is-mine' : ''} ${here ? '' : 'is-elsewhere'} ${forMe ? 'is-for-me' : ''}`} title={forMe ? 'Mentions you' : undefined}>
      <ProfilePic pubkey={line.from} size={22} />
      <div className="chat__body">
        <span className="chat__meta">
          <span className="chat__who">{name}</span>
          <span className="chat__when">{whenLabel(line.at, now)}</span>
        </span>
        <LineText text={line.text} me={me} />
      </div>
    </li>
  )
}

/** One person in the @ list. */
function PickRow({ c, active, onPick }: { c: Candidate; active: boolean; onPick: (c: Candidate) => void }): JSX.Element {
  // Asked for here as well, so a name not yet fetched arrives while the list is open.
  useProfile(c.pubkey)
  return (
    <li role="option" aria-selected={active}>
      <button
        type="button"
        className={`chat__pick ${active ? 'is-active' : ''}`}
        // Keep the caret (and a phone's keyboard) in the line while tapping.
        onPointerDown={(e) => e.preventDefault()}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onPick(c)}
      >
        <ProfilePic pubkey={c.pubkey} size={18} />
        <span className="chat__pickname">{c.label}</span>
        {c.bot && <Bot className="chat__pickbot" size={12} strokeWidth={2.25} aria-label="Agent" />}
        {c.mine && <span className="chat__picktag" title="One of your agents">YOURS</span>}
      </button>
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
  const chip = useCyberspace((s) => bottomChip(s))
  // BUILD mode is off your avatar by design, but the star is not what that
  // spot is for while building: the Builder's overlay and its PLACE buttons
  // own the moment, so the plain CHAT chip stays instead (useBuilder).
  const building = useBuilder((s) => s.active)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  // The chip takes only a click whose press began on it (pressGuard.ts).
  const chipPress = useMemo(() => pressGuard(), [])
  const now = Math.floor(Date.now() / 1000)

  // Mentions (arkinox, 2026-10-11): where the caret is, and the "@" whose
  // list was dismissed with Escape, so the list stays shut until a new one.
  const me = useCyberspace((s) => s.identity.pubkey)
  const people = usePresence((s) => s.people)
  const profiles = useProfiles((s) => s.profiles)
  const { agents } = useMyAgents(me)
  const [caret, setCaret] = useState(0)
  const [dismissed, setDismissed] = useState<number | null>(null)
  const [highlight, setHighlight] = useState(0)
  const typing = open ? activeMention(draft, caret) : null
  const picking = typing !== null && typing.start !== dismissed
  const candidates = useMemo(
    () => buildCandidates(Object.keys(people), agents, (pk) => profiles[pk], (pk) => profileLabel(profiles[pk], nip19.npubEncode(pk))),
    [people, agents, profiles],
  )
  const matches = useMemo(() => (picking ? filterCandidates(candidates, typing.query, me) : []), [picking, candidates, typing?.query, me])
  useEffect(() => { setHighlight(0) }, [typing?.query, typing?.start])
  const noMention = typing === null
  useEffect(() => { if (noMention) setDismissed(null) }, [noMention])

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
  // Unfolded, the dock is a chip on the Escape stack: Escape folds it when the
  // caret is elsewhere. In the line, the line's own Escape folds it first.
  useEscape('chip', open, () => useChat.getState().setOpen(false))

  if (!open && chip === 'star' && !building) return <StarChip />
  if (!open) {
    return (
      <button
        className="chip chatdock__chip"
        onPointerDown={(e) => chipPress.press(e.timeStamp)}
        onClick={(e) => { if (chipPress.real(e.detail, e.timeStamp)) useChat.setState({ open: true, unread: 0, focusOnOpen: false }) }}
        aria-label={unread > 0 ? `Open chat, ${unread} new` : 'Open chat'}
        title="Chat with whoever is standing here (/)"
      >
        <MessageSquare size={11} strokeWidth={2.25} aria-hidden /> CHAT
        {unread > 0 && <span className="chatdock__dot" aria-hidden="true" />}
      </button>
    )
  }

  const busy = sendStatus === 'signing' || sendStatus === 'sending'
  const trackCaret = (el: HTMLInputElement): void => setCaret(el.selectionStart ?? el.value.length)
  const pickMention = (c: Candidate): void => {
    if (!typing) return
    const next = insertMention(draft, typing.start, caret, c.label)
    const chat = useChat.getState()
    chat.setDraft(next.text)
    chat.pick({ pubkey: c.pubkey, label: c.label })
    setCaret(next.caret)
    requestAnimationFrame(() => {
      const el = input.current
      if (!el) return
      el.focus()
      el.setSelectionRange(next.caret, next.caret)
    })
  }

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
        {shown.map((l, i) => (
          <Fragment key={l.id}>
            {/* The room changed: a rule with the new room's size, so a log
                that spans your walk still says which room each line was in. */}
            {(i === 0 || shown[i - 1].region !== l.region) && shown.length > 0 && (i > 0 || (key && l.region !== key.lookupId)) && (
              <li className="chat__divider" aria-hidden="true"><span>{l.region === key?.lookupId ? 'HERE' : `ANOTHER 2^${l.height}`}</span></li>
            )}
            <Line line={l} now={now} here={!key || l.region === key.lookupId} />
          </Fragment>
        ))}
      </ul>

      {picking && (
        <ul className="chat__picker" role="listbox" aria-label="Mention someone nearby">
          {matches.length === 0 && <li className="chat__pickempty"><AtSign size={11} strokeWidth={2.25} aria-hidden /> NO ONE NEARBY BY THAT NAME</li>}
          {matches.map((c, i) => <PickRow key={c.pubkey} c={c} active={i === highlight} onPick={pickMention} />)}
        </ul>
      )}

      <form
        className="chat__compose"
        onSubmit={(e) => { e.preventDefault(); void useChat.getState().send() }}
      >
        <input
          ref={input}
          className="chat__input"
          value={draft}
          onChange={(e) => { useChat.getState().setDraft(e.target.value); trackCaret(e.target) }}
          onSelect={(e) => trackCaret(e.currentTarget)}
          onKeyDown={(e) => {
            // With the @ list open, the arrows move through it, Enter or Tab
            // picks, and Escape shuts the list before it folds the dock.
            if (picking) {
              if (e.key === 'Escape') { e.preventDefault(); setDismissed(typing.start); return }
              if (matches.length > 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                e.preventDefault()
                const step = e.key === 'ArrowDown' ? 1 : -1
                setHighlight((h) => (h + step + matches.length) % matches.length)
                return
              }
              if (matches.length > 0 && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); pickMention(matches[highlight] ?? matches[0]); return }
            }
            if (e.key === 'Escape') { e.preventDefault(); useChat.getState().setOpen(false) }
          }}
          placeholder={!atHead ? 'Come back to your head to talk' : key ? 'Say something here, @ to mention' : 'Waiting for the scan of where you stand'}
          maxLength={MAX_CHAT_LENGTH}
          disabled={busy || !atHead}
          autoComplete="off"
          autoCapitalize="sentences"
          enterKeyHint="send"
          aria-label="Chat message"
          aria-expanded={picking}
          aria-autocomplete="list"
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
