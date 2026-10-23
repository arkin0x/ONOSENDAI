/**
 * AudioCompose.tsx: hiding an audio file (DECK-0007, arkinox's rulings of
 * 2026-10-23), before aiming it.
 *
 * Pick a file, name it, say how it is heard (AUTOPLAY, LOOP, for a one-shot
 * EVERY ENTRY, and WALK ONLY), and pick the Blossom server it goes to, the
 * same picker the profile's pictures use (BlossomServer). PLACE AUDIO
 * encrypts the file here with a fresh key, uploads the ciphertext, and hands
 * the item to the deploy (useShards `startDeployAudio`), which seals it into
 * the bag at the build cursor. The key never leaves the bag.
 *
 * AudioUpload is the form itself, also used inside the chest composer to put
 * audio in a chest (`submitLabel` ADD). A kept draft (BUILD mode ended under
 * a deploy) comes back already uploaded, so it is not uploaded twice.
 */

import { useEffect, useRef, useState } from 'react'
import { explainUpload } from '../lib/blossom'
import { audioFileRefusal, audioTypeOf, iphoneMayNotPlay, sealAndUpload, type UploadedAudio } from '../lib/audioFile'
import { MAX_AUDIO_TITLE, titleFromFileName, type AudioItem } from '../lib/audioItem'
import { useBuilder } from '../store/useBuilder'
import { useCyberspace } from '../store/useCyberspace'
import { useShards } from '../store/useShards'
import { BlossomServerPicker, useBlossomChoice } from './BlossomServer'
import { Field, Switch } from './ui/Switch'

/** A person reads the upload prompt, as for a profile picture. */
const UPLOAD_SIGN_PATIENCE_MS = 60_000

type Status = { tone: 'ok' | 'warn' | 'note'; text: string }

/** The file again, typed by its extension when the system gave it no type, or as it was. */
function withType(f: File): File {
  const type = audioTypeOf(f.name)
  return type ? new File([f], f.name, { type, lastModified: f.lastModified }) : f
}

function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** The hider's choices, before the file is known. */
const DEFAULTS = { autoplay: true, loop: true, retrigger: 'once' as const, walkOnly: false }

export function AudioUpload({ idPrefix, initial, submitLabel, onReady, onCancel }: {
  /** Prefixes the controls' ids, so two forms on one page never share one. */
  idPrefix: string
  /** An item already uploaded (a kept draft): its choices can change, its file cannot. */
  initial?: AudioItem
  submitLabel: string
  /** The item, and the server it was uploaded to (absent for a kept draft that never said). */
  onReady: (audio: AudioItem, server?: string) => void
  onCancel: () => void
}): JSX.Element {
  const me = useCyberspace((s) => s.identity.pubkey)
  const blossom = useBlossomChoice(me, true)
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [uploaded, setUploaded] = useState<UploadedAudio | null>(initial ?? null)
  const [title, setTitle] = useState(initial?.title ?? '')
  const [autoplay, setAutoplay] = useState(initial?.autoplay ?? DEFAULTS.autoplay)
  const [loop, setLoop] = useState(initial?.loop ?? DEFAULTS.loop)
  const [everyEntry, setEveryEntry] = useState((initial?.retrigger ?? DEFAULTS.retrigger) === 'auto')
  const [walkOnly, setWalkOnly] = useState(initial?.walkOnly ?? DEFAULTS.walkOnly)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)
  // The form closed (Escape, a tap outside, the X) while an upload was going:
  // what it uploaded is not lined up, since nobody is there to aim it.
  const gone = useRef(false)
  // Set on every mount, not only at creation: StrictMode mounts twice in development.
  useEffect(() => { gone.current = false; return () => { gone.current = true } }, [])

  const choose = (f: File | undefined): void => {
    if (!f) return
    // A file the system gave no type (often .flac or .opus) is typed by its extension.
    const typed = f.type ? f : withType(f)
    const refusal = audioFileRefusal(typed)
    if (refusal) { setStatus({ tone: 'warn', text: refusal }); return }
    setFile(typed)
    setUploaded(null)
    // Placed anyway if the hider wants: a warning, not a refusal.
    setStatus(iphoneMayNotPlay(typed) ? { tone: 'warn', text: 'iPhones may not play ogg. mp3 or m4a play everywhere.' } : null)
    if (!title.trim()) setTitle(titleFromFileName(f.name))
  }

  const item = (u: UploadedAudio): AudioItem => ({
    ...u,
    title: title.trim() || 'audio',
    about: initial?.about ?? '',
    autoplay,
    loop,
    retrigger: everyEntry ? 'auto' : 'once',
    walkOnly,
    ...(initial?.fade !== undefined ? { fade: initial.fade } : {}),
  })

  const submit = async (): Promise<void> => {
    if (busy) return
    if (uploaded) { onReady(item(uploaded)); return }
    if (!file) return
    const target = blossom.chosen()
    if (!target) { setStatus({ tone: 'warn', text: 'Enter a server first, like https://blossom.band.' }); return }
    const host = target.replace(/^https?:\/\//, '')
    setBusy(true)
    setStatus({ tone: 'note', text: `Encrypting and uploading to ${host}. Your signer may ask.` })
    try {
      const u = await sealAndUpload(file, target, (t) => useCyberspace.getState().signEvent(t, UPLOAD_SIGN_PATIENCE_MS))
      if (gone.current) return
      blossom.remember(target)
      setUploaded(u)
      setStatus({ tone: 'ok', text: `Uploaded, encrypted, to ${host}.` })
      onReady(item(u), target)
    } catch (e) {
      if (!gone.current) setStatus({ tone: 'warn', text: explainUpload(e) })
    } finally {
      if (!gone.current) setBusy(false)
    }
  }

  const fileLabel = uploaded && !file ? `${title || 'audio'} · uploaded` : file ? `${file.name} · ${sizeLabel(file.size)}` : 'No file chosen'
  const ready = !busy && (!!uploaded || !!file)

  return (
    <div className="shards__compose audio-compose">
      <div className="compose__row">
        <button className="chest__act" onClick={() => fileRef.current?.click()} disabled={busy} title="An mp3 or m4a plays everywhere">CHOOSE FILE</button>
        <span className="item__name audio-compose__file" title={fileLabel}>{fileLabel}</span>
        <input ref={fileRef} type="file" accept="audio/*" hidden onChange={(e) => { choose(e.target.files?.[0]); e.target.value = '' }} />
      </div>
      <input className="avatars__input" value={title} onChange={(e) => setTitle(e.target.value.slice(0, MAX_AUDIO_TITLE))} placeholder="Name it" maxLength={MAX_AUDIO_TITLE} aria-label="Audio name" disabled={busy} />

      <Field id={`${idPrefix}-autoplay`} label="Autoplay" hint="Plays by itself where it is heard">
        <Switch id={`${idPrefix}-autoplay`} checked={autoplay} onCheckedChange={setAutoplay} disabled={busy} />
      </Field>
      <Field id={`${idPrefix}-loop`} label="Loop" hint={autoplay ? 'Off: plays once, on entering its sphere' : 'Off: plays once through'}>
        <Switch id={`${idPrefix}-loop`} checked={loop} onCheckedChange={setLoop} disabled={busy} />
      </Field>
      {autoplay && !loop && (
        <Field id={`${idPrefix}-retrigger`} label="Every entry" hint="Off: only the first time">
          <Switch id={`${idPrefix}-retrigger`} checked={everyEntry} onCheckedChange={setEveryEntry} disabled={busy} />
        </Field>
      )}
      <Field id={`${idPrefix}-walk`} label="Walk only" hint="Can only be heard while in First Person (WALK mode)">
        <Switch id={`${idPrefix}-walk`} checked={walkOnly} onCheckedChange={setWalkOnly} disabled={busy} />
      </Field>

      {!uploaded && <BlossomServerPicker id={`${idPrefix}-server`} choice={blossom} disabled={busy} label="Upload to (encrypted)" />}

      {status && <span className={`shards__compose-note${status.tone === 'note' ? '' : ` shards__compose-note--${status.tone}`}`} role="status">{status.text}</span>}
      <div className="shards__actions">
        <button className="avatars__go" onClick={onCancel} disabled={busy}>CANCEL</button>
        <button className="avatars__go" disabled={!ready} onClick={() => void submit()} title={uploaded ? 'Aim it at the build cursor' : 'Encrypt the file, upload it, then aim it'}>{busy ? 'UPLOADING…' : submitLabel}</button>
      </div>
    </div>
  )
}

/**
 * How PLACE AUDIO lines the item up: a new file is a first copy, on the
 * server it was just uploaded to; a kept draft stays what it was, a PLACE
 * AGAIN copy still sealed afresh when placed, on the server its first copy
 * went to, so it never goes out under the first placement's key.
 */
export function placeAudioOpts(audio: Pick<AudioItem, 'hash'>, server: string | undefined, kept: { audio: Pick<AudioItem, 'hash'>; reseal?: true; server?: string } | undefined): { server?: string; reseal: boolean } {
  const same = !!kept && audio.hash === kept.audio.hash
  const where = server ?? (same ? kept?.server : undefined)
  return { ...(where ? { server: where } : {}), reseal: same && !!kept?.reseal }
}

/** PLACE AUDIO: the form, then the deploy at the build cursor. `onDone` runs on CANCEL and once it is handed over. */
export function AudioCompose({ onDone }: { onDone: () => void }): JSX.Element {
  // A kept draft, read in the initializer and taken in an effect, as the
  // other composers do (React may run an initializer twice).
  // A kept PLACE AGAIN copy stays one: it is sealed afresh when placed, so it
  // never goes out under the first placement's key (review of #463).
  const [kept] = useState(() => {
    const draft = useBuilder.getState().itemDraft
    return draft?.type === 'audio' ? draft : undefined
  })
  const initial = kept?.audio
  useEffect(() => { useBuilder.getState().takeItemDraft('audio') }, [])
  return (
    <AudioUpload
      idPrefix="audio"
      initial={initial}
      submitLabel="PLACE AUDIO ▸"
      onReady={(audio, server) => { useShards.getState().startDeployAudio(audio, placeAudioOpts(audio, server, kept)); onDone() }}
      onCancel={onDone}
    />
  )
}
