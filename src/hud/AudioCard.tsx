/**
 * AudioCard.tsx: what the item modal shows for hidden audio (DECK-0007,
 * arkinox, 2026-10-23): its title and how it is heard, PLAY, DOWNLOAD and,
 * for a one-shot that plays once, RESET TRIGGER.
 *
 * PLAY is the file as it is, from the tap (store/useHiddenAudio): a manual
 * play, whatever the item's autoplay, loop and walk settings, which are for
 * hearing it in the world. DOWNLOAD saves the decrypted file. RESET TRIGGER
 * forgets that this device heard the one-shot fire (lib/audioTrigger), so
 * leaving its sphere and entering again plays it once more.
 *
 * `moderation` is the row under the actions where MUTE THIS AUDIO and
 * BLOCK AUTHOR go (SecretModal, store/useMutes); absent, nothing is drawn.
 *
 * Until the world plays sources by itself (the next step), the card's play
 * stops when the card closes, so nothing sounds with no way to stop it. It
 * is mounted in two places: the item modal (SecretModal) and a TAKEN row in
 * ITEMS (InventoryPanel). Both drop it when the mute list hides the item, so
 * a mute or a block stops its sound.
 */

import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Download, Play, RotateCcw, Square } from 'lucide-react'
import type { AudioItem } from '../lib/audioItem'
import { audioExtension } from '../lib/audioItem'
import { hasTrigger, onTriggers, resetTrigger, triggerFired, triggersVersion } from '../lib/audioTrigger'
import { downloadAudio, playAudio, stopAudio, useHiddenAudio } from '../store/useHiddenAudio'
import { ItemIcon } from './ItemIcon'

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
}

export function AudioCard({ id, triggerId, audio, moderation }: {
  /** The world item's key: what its playback is filed under. */
  id: string
  /** What its trigger record is kept by: the item's lineage id. */
  triggerId: string
  audio: AudioItem
  moderation?: ReactNode
}): JSX.Element {
  const entry = useHiddenAudio((s) => s.entries[id])
  useSyncExternalStore(onTriggers, triggersVersion, triggersVersion)
  const fired = triggerFired(triggerId)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // The card's play ends with the card, for now (see the header).
  useEffect(() => () => stopAudio(id), [id])

  const sounding = entry?.phase === 'playing' || entry?.phase === 'loading'
  const toggle = (): void => {
    if (sounding) stopAudio(id)
    else void playAudio(id, audio)
  }
  const save = (): void => {
    setSaving(true)
    setSaveError(null)
    void downloadAudio(audio).then((why) => { setSaving(false); setSaveError(why) })
  }
  const status = entry?.phase === 'error' ? entry.error : entry?.phase === 'loading' ? 'Opening the file…' : saveError

  return (
    <div className="audio">
      <div className="audio__head">
        <span className="audio__glyph" aria-hidden="true"><ItemIcon type="audio" size={16} /></span>
        <span className="audio__title" title={audio.title}>{audio.title}</span>
      </div>
      {audio.about && <span className="audio__about">{audio.about}</span>}
      <span className="audio__marks">
        {audioMarks(audio).map((m) => <span key={m} className="audio__mark" title={MARK_TIPS[m]}>{m}</span>)}
      </span>
      <div className="secret__actions audio__acts">
        <button className={`secret__act ${sounding ? 'is-on' : ''}`} onClick={toggle} title={sounding ? 'Stop it' : 'Play the file here, as it is'}>
          {sounding ? <Square size={ICON} strokeWidth={2.25} aria-hidden /> : <Play size={ICON} strokeWidth={2.25} aria-hidden />}
          {entry?.phase === 'loading' ? 'OPENING' : sounding ? 'STOP' : 'PLAY'}
        </button>
        <button className="secret__act" onClick={save} disabled={saving} title="Save the decrypted file">
          <Download size={ICON} strokeWidth={2.25} aria-hidden />{saving ? 'SAVING' : 'DOWNLOAD'}
        </button>
        {hasTrigger(audio) && audio.retrigger === 'once' && (
          <button className="secret__act" onClick={() => resetTrigger(triggerId)} disabled={!fired} title={fired ? 'Play it once more the next time you enter its sphere' : 'It has not played here yet'}>
            <RotateCcw size={ICON} strokeWidth={2.25} aria-hidden />RESET TRIGGER
          </button>
        )}
      </div>
      {status && <p className="secret__status" role="status">{status}</p>}
      {/* MUTE THIS AUDIO and BLOCK AUTHOR (NIP-51 kind 10000) go in this row. */}
      {moderation && <div className="secret__actions audio__moderation">{moderation}</div>}
    </div>
  )
}
