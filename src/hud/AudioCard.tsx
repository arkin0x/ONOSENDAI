/**
 * AudioCard.tsx: what the item modal shows for hidden audio (DECK-0007,
 * arkinox, 2026-10-23), as a voice line (owner, 2026-11-26: "the audio look
 * is amazing from the hidden message looks. lets replace audio with this",
 * direction 7): its title; a large play button beside the file's waveform,
 * which is the scrubber, with the time and the length under it
 * (WaveBars WaveScrubber); the hider's caption as the written line under
 * them; the marks that say how it is heard; DOWNLOAD and, for a one-shot
 * that plays once, RESET TRIGGER.
 *
 * PLAY is the file as it is, from the tap (store/useHiddenAudio): a manual
 * play, whatever the item's autoplay, loop and walk settings, which are for
 * hearing it in the world. A tap or a drag on the waveform moves the play
 * there, and before PLAY starts it there (once its length is known). DOWNLOAD saves the decrypted file.
 * RESET TRIGGER forgets that this device heard the one-shot fire
 * (lib/audioTrigger), so leaving its sphere and entering again plays it once
 * more. Nothing here shortens or lengthens what plays: the whole file, as
 * before.
 *
 * The waveform is the file's own once it is known here: a small file is
 * decoded for it, a larger one is drawn as it is heard (store/useWaveforms).
 *
 * `moderation` is the row under the actions where MUTE THIS AUDIO and
 * BLOCK AUTHOR go (SecretModal, store/useMutes); absent, nothing is drawn.
 *
 * The card's play goes on when the card closes: NOW PLAYING lists it, and
 * stops it (hud/NowPlaying). It is mounted in two places: the item modal
 * (SecretModal) and a TAKEN row in ITEMS (InventoryPanel). A mute or a block
 * stops its sound wherever the card is, open or not, because the voice keeps
 * its item's `who` and the mute list is watched (useHiddenAudio
 * stopMutedVoices).
 *
 * NOW PLAYING's mutes are by track (its lineage id, `triggerId`), and reach
 * its PLAY too: a muted track plays silent, listed in NOW PLAYING, where it
 * is unmuted. MUTED among the marks says so here.
 */

import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Download, Play, RotateCcw, Square } from 'lucide-react'
import type { AudioItem } from '../lib/audioItem'
import { audioExtension } from '../lib/audioItem'
import { hasTrigger, onTriggers, resetTrigger, triggerFired, triggersVersion } from '../lib/audioTrigger'
import { cardKey, cardLevel, cardTime, downloadAudio, playAudio, seekCard, stopAudio, useHiddenAudio, type MuteSubject } from '../store/useHiddenAudio'
import { trackSilenced, useSoundMutes } from '../store/useSoundMutes'
import { noteDuration, noteLevel, wantWave } from '../store/useWaveforms'
import { clockWords, scrubTime } from '../lib/waveform'
import { useWave, WaveScrubber } from './WaveBars'

const ICON = 12

/** How the item is heard in the world, as short marks: LOOP or ONE-SHOT, and the rest. */
export function audioMarks(a: Pick<AudioItem, 'autoplay' | 'loop' | 'retrigger' | 'walkOnly' | 'mime' | 'size'>): string[] {
  const out = [a.loop ? 'LOOP' : 'ONE-SHOT']
  if (a.autoplay) out.push(a.loop ? 'AUTOPLAY' : a.retrigger === 'auto' ? 'EVERY ENTRY' : 'FIRST ENTRY')
  else out.push('ON TAP')
  if (a.walkOnly) out.push('WALK ONLY')
  out.push(audioExtension(a.mime).toUpperCase())
  if (a.size > 0) out.push(a.size >= 1024 * 1024 ? `${(a.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(a.size / 1024))} KB`)
  return out
}

/** What a mark says, for its tooltip. */
const MARK_TIPS: Record<string, string> = {
  LOOP: 'Plays over and over',
  'ONE-SHOT': 'Plays once through each time it starts',
  AUTOPLAY: 'Plays by itself where it is heard',
  'EVERY ENTRY': 'Plays each time you enter its sphere',
  'FIRST ENTRY': 'Plays the first time you enter its sphere',
  'ON TAP': 'Plays only from here',
  'WALK ONLY': 'Heard only in first person (WALK mode)',
  MUTED: 'Muted in NOW PLAYING',
}

export function AudioCard({ id, triggerId, audio, who, moderation }: {
  /** The world item's key: what its playback is filed under. */
  id: string
  /** What its trigger record is kept by: the item's lineage id. */
  triggerId: string
  audio: AudioItem
  /** Who and what the mute list is asked about, so a mute stops this card's PLAY too. */
  who?: MuteSubject
  moderation?: ReactNode
}): JSX.Element {
  const entry = useHiddenAudio((s) => s.entries[cardKey(id)])
  useSyncExternalStore(onTriggers, triggersVersion, triggersVersion)
  const fired = triggerFired(triggerId)
  // Once the switches are read: not MUTED for the moment the read takes.
  const muted = useSoundMutes((s) => s.ready && trackSilenced(triggerId, s))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const sounding = entry?.phase === 'playing' || entry?.phase === 'loading'
  const playing = entry?.phase === 'playing'
  const wave = useWave(audio)
  // Where the card's PLAY is, read about thirty times a second while it plays; where a tap before PLAY will start it, while it does not.
  const [pos, setPos] = useState({ at: 0, duration: 0 })
  const length = pos.duration > 0 ? pos.duration : wave.duration
  useEffect(() => { wantWave(audio) }, [audio])
  useEffect(() => {
    if (!playing || typeof window === 'undefined') return
    // Its PLAY has opened the file: its shape can be made without fetching anything more.
    wantWave(audio, true)
    let raf = 0
    let last = 0
    const tick = (t: number): void => {
      if (t - last > 33) {
        last = t
        const now = cardTime(id)
        if (now) {
          setPos((p) => (Math.abs(p.at - now.at) < 0.02 && p.duration === now.duration ? p : now))
          if (now.duration > 0) {
            noteDuration(audio.hash, now.duration)
            // A file too large to decode whole is drawn as it is heard.
            const level = cardLevel(id)
            if (level !== null) noteLevel(audio.hash, now.at / now.duration, level, now.duration)
          }
        }
      }
      raf = window.requestAnimationFrame(tick)
    }
    raf = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(raf)
  }, [playing, audio, id])
  const toggle = (): void => {
    if (sounding) stopAudio(id)
    else void playAudio(id, audio, who, triggerId)
  }
  // Stopped, or come to its end: the waveform lights nothing, as the next PLAY starts at the top.
  useEffect(() => { if (!sounding) setPos((p) => (p.at === 0 ? p : { ...p, at: 0 })) }, [sounding])
  const seek = (fraction: number): void => {
    // With no length known there is nowhere to go to: PLAY starts it.
    if (!(length > 0)) return
    const t = scrubTime(fraction, length)
    setPos((p) => ({ ...p, at: t }))
    // Playing, it moves there; not yet playing, PLAY starts there. Asked now, not from this render, so a drag starts it once.
    const phase = useHiddenAudio.getState().entries[cardKey(id)]?.phase
    const now = phase === 'playing' || phase === 'loading'
    if (!seekCard(id, t) && !now) void playAudio(id, audio, who, triggerId)
  }
  const save = (): void => {
    setSaving(true)
    setSaveError(null)
    void downloadAudio(audio).then((why) => { setSaving(false); setSaveError(why) })
  }
  const status = entry?.phase === 'error' ? entry.error : entry?.phase === 'loading' ? 'Opening the file…' : saveError
  const verb = entry?.phase === 'loading' ? 'OPENING' : sounding ? 'STOP' : 'PLAY'

  return (
    <div className="audio voice">
      <span className="voice__title" title={audio.title}>{audio.title}</span>
      <div className="voice__player">
        <button className={`voice__play${sounding ? ' is-on' : ''}`} onClick={toggle} title={sounding ? 'Stop it' : 'Play the file here, as it is'}>
          {sounding ? <Square size={18} strokeWidth={2.25} aria-hidden /> : <Play size={18} strokeWidth={2.25} aria-hidden />}
          <span className="voice__verb">{verb}</span>
        </button>
        <div className="voice__track">
          <WaveScrubber peaks={wave.peaks} real={wave.real} time={pos.at} duration={length} onSeek={seek} label={`Where to play ${audio.title} from`} />
          <span className="voice__times"><span>{clockWords(pos.at)}</span><span>{clockWords(length > 0 ? length : null)}</span></span>
        </div>
      </div>
      {audio.about && <p className="voice__line">{audio.about}</p>}
      <span className="audio__marks">
        {[...audioMarks(audio), ...(muted ? ['MUTED'] : [])].map((m) => <span key={m} className={`audio__mark${m === 'MUTED' ? ' audio__mark--muted' : ''}`} title={MARK_TIPS[m]}>{m}</span>)}
      </span>
      <div className="secret__actions audio__acts">
        <button className="secret__act" onClick={save} disabled={saving} title="Save the decrypted file">
          <Download size={ICON} strokeWidth={2.25} aria-hidden />{saving ? 'SAVING' : 'DOWNLOAD'}
        </button>
        {hasTrigger(audio) && audio.retrigger === 'once' && (
          <button className="secret__act" onClick={() => resetTrigger(triggerId)} disabled={!fired} title={fired ? 'Play it once more the next time you enter its sphere' : 'It has not played here yet'}>
            <RotateCcw size={ICON} strokeWidth={2.25} aria-hidden />RESET TRIGGER
          </button>
        )}
      </div>
      {/* Always there, so the card does not jump as a play opens or a save fails. */}
      <p className="secret__status voice__status" role="status">{status ?? '\u00a0'}</p>
      {/* MUTE THIS AUDIO and BLOCK AUTHOR (NIP-51 kind 10000) go in this row. */}
      {moderation && <div className="secret__actions audio__moderation">{moderation}</div>}
    </div>
  )
}
