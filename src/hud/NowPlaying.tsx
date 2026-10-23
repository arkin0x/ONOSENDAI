/**
 * NowPlaying.tsx: what cyberspace is playing, and the tap that lets it out
 * (arkinox, 2026-10-23, hidden audio step 2).
 *
 * NOW PLAYING is a pill in the instrument stack, built like the presence
 * chip beside it, shown whenever any cyberspace audio plays: hidden audio
 * sounding where it is hidden, a card's PLAY, and Cyberspace TV's music.
 * Tapping it lists them; tapping a hidden one opens its card (the item
 * modal, with PLAY, DOWNLOAD and RESET TRIGGER); a card's PLAY can be
 * stopped from its row; tapping TV's mutes or unmutes it, as tapping TV's
 * own NOW PLAYING does.
 *
 * TAP FOR SOUND stands in the same place while the browser holds sound back
 * and something hidden here is waiting to be heard. Its tap, or any tap,
 * lets it out (lib/audioContext).
 */

import { useState, useSyncExternalStore } from 'react'
import { Volume2, X } from 'lucide-react'
import { ItemIcon } from './ItemIcon'
import { audioContextVersion, audioRunning, onAudioContext, resumeAudio } from '../lib/audioContext'
import { stopVoice, useHiddenAudio, type AudioEntry } from '../store/useHiddenAudio'
import { toggleMusicMute, useTvMusic } from '../store/useTvMusic'
import { useShards } from '../store/useShards'
import { useEscape } from '../hooks/useEscape'

/** One row of the list: a hidden voice, or TV's music. */
export interface PlayingRow {
  /** The voice key, or 'tv'. */
  key: string
  title: string
  /** Where it is heard from, in a word or two. */
  meta: string
  /** The item whose card a tap opens; absent for TV. */
  itemKey?: string
  /** A card's PLAY can be stopped here. */
  stoppable: boolean
}

/** What is playing, as the list shows it: the hidden voices, then TV's music. A world voice waiting for a tap is not playing yet. */
export function playingRows(entries: Record<string, AudioEntry>, tv: { title: string; artist: string } | null, tvMuted: boolean): PlayingRow[] {
  const rows: PlayingRow[] = []
  for (const [key, e] of Object.entries(entries)) {
    if (e.phase !== 'playing' && e.phase !== 'loading') continue
    rows.push({ key, title: e.title, meta: e.mode === 'world' ? 'here' : 'from its card', itemKey: e.itemKey, stoppable: e.mode === 'card' })
  }
  if (tv) rows.push({ key: 'tv', title: tv.artist ? `${tv.title} · ${tv.artist}` : tv.title, meta: tvMuted ? 'Cyberspace TV · muted' : 'Cyberspace TV', stoppable: false })
  return rows
}

/** How many hidden sounds here wait for the browser to let sound out. */
export function waitingCount(entries: Record<string, AudioEntry>): number {
  return Object.values(entries).filter((e) => e.phase === 'waiting').length
}

export function NowPlayingChip(): JSX.Element | null {
  const entries = useHiddenAudio((s) => s.entries)
  const track = useTvMusic((s) => s.track)
  const tvMuted = useTvMusic((s) => s.muted)
  const [open, setOpen] = useState(false)
  const rows = playingRows(entries, track, tvMuted)
  useEscape('chip', open && rows.length > 0, () => setOpen(false))
  if (rows.length === 0) return null
  const go = (r: PlayingRow): void => {
    if (r.key === 'tv') { toggleMusicMute(); return }
    if (r.itemKey && useShards.getState().secretByEvent(r.itemKey)) { setOpen(false); useShards.getState().selectSecret(r.itemKey) }
  }
  return (
    <div className={`hyperbar presence nowplaying ${open ? 'is-open' : ''}`} role="status">
      <button className="presence__head" onClick={() => setOpen((o) => !o)} aria-expanded={open} title="What is playing; tap one to open it">
        <ItemIcon type="audio" size={12} />
        <span className="hyperbar__label">NOW PLAYING {rows.length}</span>
        {open && <span className="presence__close" aria-hidden="true">✕</span>}
      </button>
      {open && (
        <ul className="presence__list">
          {rows.map((r) => (
            <li key={r.key} className="presence__row nowplaying__row">
              <button className="nowplaying__open" onClick={() => go(r)} title={r.key === 'tv' ? (tvMuted ? 'Unmute TV' : 'Mute TV') : 'Open its card'}>
                <span className="presence__who">
                  <span className="presence__name">{r.title}</span>
                  <span className="presence__meta">{r.meta}</span>
                </span>
              </button>
              {r.stoppable && (
                <button className="held__clear" onClick={() => stopVoice(r.key)} title="Stop it" aria-label={`Stop ${r.title}`}><X size={14} aria-hidden /></button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** TAP FOR SOUND: hidden audio here, held back by the browser until a tap. */
export function SoundChip(): JSX.Element | null {
  const waiting = useHiddenAudio((s) => waitingCount(s.entries))
  useSyncExternalStore(onAudioContext, audioContextVersion, audioContextVersion)
  if (waiting === 0 || audioRunning()) return null
  return (
    <div className="hyperbar presence hyperbar--found" role="status">
      <button className="presence__head" onClick={() => resumeAudio()} title="The browser holds sound back until a tap">
        <Volume2 size={12} strokeWidth={2.25} aria-hidden />
        <span className="hyperbar__label">TAP FOR SOUND {waiting}</span>
      </button>
    </div>
  )
}
