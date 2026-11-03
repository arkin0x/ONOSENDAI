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
 * Mutes (arkinox, 2026-11-03): each row has its own speaker, and the head
 * has MUTE ALL at its top right. A track muted here plays on silent, so it
 * still raises this pill and stays listed, dimmed; its switch is kept on this
 * device by its lineage id (store/useSoundMutes), so it is still muted when
 * you come back to it. MUTE ALL is over hidden audio only, never TV (RULED
 * 2026-11-03), and leaves each track's own switch as it was. TV's row
 * speaker is TV's own mute, as a tap on the row is.
 *
 * TAP FOR SOUND stands in the same place while the browser holds sound back
 * and something hidden here is waiting to be heard. Its tap, or any tap,
 * lets it out (lib/audioContext).
 */

import { useState } from 'react'
import { Volume2, VolumeX, X } from 'lucide-react'
import { ItemIcon } from './ItemIcon'
import { letSoundOut, stopVoice, useHiddenAudio, type AudioEntry } from '../store/useHiddenAudio'
import { toggleMasterMute, toggleTrackMute, useSoundMutes } from '../store/useSoundMutes'
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
  /** What its speaker mutes by: the item's lineage id; absent for TV, whose speaker is TV's own mute. */
  trackId?: string
  /** Its own switch is on: the speaker shows muted. */
  muted: boolean
  /** Not heard: its own switch, or MUTE ALL for hidden audio. */
  silenced: boolean
}

/** NOW PLAYING's mutes as the list reads them (store/useSoundMutes). */
export interface RowMutes { tracks: ReadonlySet<string>; master: boolean }
const NO_MUTES: RowMutes = { tracks: new Set(), master: false }

/**
 * What is playing, as the list shows it: the hidden voices, then TV's music.
 * A world voice waiting for a tap is not playing yet. A muted one is: it
 * stays, saying so, whether by its own switch or by MUTE ALL.
 */
export function playingRows(entries: Record<string, AudioEntry>, tv: { title: string; artist: string } | null, tvMuted: boolean, mutes: RowMutes = NO_MUTES): PlayingRow[] {
  const rows: PlayingRow[] = []
  for (const [key, e] of Object.entries(entries)) {
    if (e.phase !== 'playing' && e.phase !== 'loading') continue
    // A card played from ITEMS has no item in the world to open: its row only stops it.
    const held = e.itemKey.startsWith('held:')
    const where = e.mode === 'world' ? 'here' : held ? 'from ITEMS' : 'from its card'
    const muted = !!e.trackId && mutes.tracks.has(e.trackId)
    const silenced = muted || mutes.master
    rows.push({ key, title: e.title, meta: muted ? `${where} · muted` : silenced ? `${where} · all muted` : where, itemKey: held ? undefined : e.itemKey, stoppable: e.mode === 'card', trackId: e.trackId, muted, silenced })
  }
  if (tv) rows.push({ key: 'tv', title: tv.artist ? `${tv.title} · ${tv.artist}` : tv.title, meta: tvMuted ? 'Cyberspace TV · muted' : 'Cyberspace TV', stoppable: false, muted: tvMuted, silenced: tvMuted })
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
  const tracks = useSoundMutes((s) => s.tracks)
  const master = useSoundMutes((s) => s.master)
  const [open, setOpen] = useState(false)
  const rows = playingRows(entries, track, tvMuted, { tracks, master })
  useEscape('chip', open && rows.length > 0, () => setOpen(false))
  if (rows.length === 0) return null
  // MUTE ALL while any hidden audio is listed, or while it is on, so it can be turned off; never for TV alone.
  const showAll = master || rows.some((r) => r.key !== 'tv')
  const go = (r: PlayingRow): void => {
    if (r.key === 'tv') { toggleMusicMute(); return }
    if (r.itemKey && useShards.getState().secretByEvent(r.itemKey)) { setOpen(false); useShards.getState().selectSecret(r.itemKey); return }
    if (r.stoppable) stopVoice(r.key)
  }
  return (
    <div className={`hyperbar presence nowplaying ${open ? 'is-open' : ''}`} role="status">
      <div className="nowplaying__top">
        <button className="presence__head" onClick={() => setOpen((o) => !o)} aria-expanded={open} title="What is playing; tap one to open it">
          <ItemIcon type="audio" size={12} />
          <span className="hyperbar__label">NOW PLAYING {rows.length}</span>
          {open && <span className="presence__close" aria-hidden="true">✕</span>}
        </button>
        {showAll && (
          <button className={`held__clear nowplaying__mute nowplaying__all ${master ? 'is-on' : ''}`} onClick={() => toggleMasterMute()} aria-pressed={master} title={master ? 'Unmute all (not TV)' : 'Mute all (not TV)'} aria-label={master ? 'Unmute all' : 'Mute all'}>
            {master ? <VolumeX size={14} aria-hidden /> : <Volume2 size={14} aria-hidden />}
          </button>
        )}
      </div>
      {open && (
        <ul className="presence__list">
          {rows.map((r) => (
            <li key={r.key} className={`presence__row nowplaying__row ${r.silenced ? 'is-muted' : ''}`}>
              <button className="nowplaying__open" onClick={() => go(r)} title={r.key === 'tv' ? (tvMuted ? 'Unmute TV' : 'Mute TV') : r.itemKey ? 'Open its card' : 'Stop it'}>
                <span className="presence__who">
                  <span className="presence__name">{r.title}</span>
                  <span className="presence__meta">{r.meta}</span>
                </span>
              </button>
              {(r.key === 'tv' || r.trackId) && (
                <button className={`held__clear nowplaying__mute ${r.muted ? 'is-on' : ''}`} onClick={() => (r.key === 'tv' ? toggleMusicMute() : toggleTrackMute(r.trackId!))} aria-pressed={r.muted} title={r.muted ? 'Unmute' : 'Mute'} aria-label={`${r.muted ? 'Unmute' : 'Mute'} ${r.title}`}>
                  {r.muted ? <VolumeX size={14} aria-hidden /> : <Volume2 size={14} aria-hidden />}
                </button>
              )}
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

/**
 * TAP FOR SOUND: hidden audio here that the browser will not let play
 * until a tap, whatever the context's state: Safari lets an element start
 * only inside one. Its tap plays them all in that gesture (letSoundOut).
 */
export function SoundChip(): JSX.Element | null {
  const waiting = useHiddenAudio((s) => waitingCount(s.entries))
  if (waiting === 0) return null
  return (
    <div className="hyperbar presence hyperbar--found" role="status">
      <button className="presence__head" onClick={() => letSoundOut()} title="The browser holds sound back until a tap">
        <Volume2 size={12} strokeWidth={2.25} aria-hidden />
        <span className="hyperbar__label">TAP FOR SOUND {waiting}</span>
      </button>
    </div>
  )
}
