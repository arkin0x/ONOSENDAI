/**
 * ZipImport.tsx - bulk import's review list and progress (store/useShardImport).
 *
 * One row per shard file: a box to untick, its picture once it is read
 * (useThumbs, drawn by a ThumbStage of its own while the list is open), its
 * name, folder, size, and what became of it. Above the list, what a taken
 * name means (SKIP, COPY, UPDATE) and whether to PUBLISH; below it, the
 * files that are not shards and why. Words in the list are labels and
 * reasons only; the rest is behind EXPLAIN.
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Checkbox } from '../hud/ui/Checkbox'
import { Field, Switch } from '../hud/ui/Switch'
import { Explanation } from '../hud/Explanation'
import { ThumbStage } from '../scene/ThumbStage'
import { useThumbs } from '../store/useThumbs'
import { useEscape } from '../hooks/useEscape'
import { useCyberspace } from '../store/useCyberspace'
import { useShardImport, type ImportRow } from '../store/useShardImport'
import { dupAction, type Dup, type DupMode } from '../lib/shardZip'

const MODES: Array<{ mode: DupMode; label: string; help: string }> = [
  { mode: 'skip', label: 'SKIP', help: 'Leave out a piece you already have, and a file whose name one of your shards has' },
  { mode: 'copy', label: 'COPY', help: 'Bring it in beside the one you have, as "<name> copy"' },
  { mode: 'update', label: 'UPDATE', help: 'Replace a piece imported from this kit before, at the same address, so every object placing it draws the new one. A shard of yours that only shares a name is never replaced.' },
]

const size = (n: number): string => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1048576).toFixed(1)} MB`)

/** The key a row's picture is kept under: per open, so a zip opened again (edited, same name) is drawn again. */
const thumbKey = (openId: number, key: string): string => `zip:${openId}:${key}`

/** Pictures asked for this open: each once, so one evicted from the shared cache (it keeps 200) is not drawn again and again. */
const asked = new Set<string>()

function Thumb({ row, openId, root }: { row: ImportRow; openId: number; root: HTMLElement | null }): JSX.Element {
  const k = thumbKey(openId, row.key)
  const url = useThumbs((s) => s.urls[k])
  const box = useRef<HTMLSpanElement>(null)
  // Asked for once the row is near the list's visible part, as the Shard Feed's tiles are.
  useEffect(() => {
    const shard = row.shard
    if (!shard || url || asked.has(k)) return
    const ask = (): void => { if (!asked.has(k)) { asked.add(k); useThumbs.getState().request(k, shard) } }
    const el = box.current
    if (!el || typeof IntersectionObserver === 'undefined') { ask(); return }
    const seen = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { ask(); seen.disconnect() } }, { root, rootMargin: '120px' })
    seen.observe(el)
    return () => seen.disconnect()
  }, [k, row.shard, url, root])
  return <span className="zipimport__thumb" ref={box}>{url ? <img src={url} alt="" width={40} height={40} /> : null}</span>
}

/** The tag at a row's end: what is happening to it, or what will. */
function status(row: ImportRow, mode: DupMode, dup: Dup): { label: string; tone: string; title?: string } {
  if (row.read === 'waiting') return { label: 'WAITING', tone: 'tag--local' }
  if (row.read === 'reading') return { label: 'READING', tone: 'tag--sending' }
  if (row.read === 'error') return { label: 'ERROR', tone: 'tag--failed', title: row.error ?? undefined }
  if (row.run === 'working') return { label: 'WORKING', tone: 'tag--sending' }
  if (row.run === 'done') return { label: row.outcome === 'update' ? 'UPDATED' : row.outcome === 'copy' ? 'COPIED' : 'DONE', tone: 'tag--live' }
  if (row.run === 'failed') return { label: 'FAILED', tone: 'tag--failed', title: row.failure ?? undefined }
  if (row.run === 'skipped') return { label: 'SKIPPED', tone: 'tag--local', title: row.failure ?? undefined }
  if (dup) {
    const act = dupAction(dup, mode).act
    const title = dup.in === 'same' ? 'Imported from this kit before' : dup.in === 'name' ? 'One of your shards has this name' : 'Same path twice in this zip'
    const label = act === 'skip' ? (dup.in === 'same' ? 'YOURS' : dup.in === 'name' ? 'TAKEN' : 'TWICE') : act === 'update' ? 'UPDATE' : 'AS COPY'
    return { label, tone: 'tag--sending', title }
  }
  return { label: 'NEW', tone: '' }
}

export function ZipImport(): JSX.Element | null {
  const s = useShardImport()
  const me = useCyberspace((c) => c.identity.pubkey)
  const [showSkipped, setShowSkipped] = useState(false)
  const running = s.phase === 'running'
  const [listEl, setListEl] = useState<HTMLUListElement | null>(null)
  // Like the backdrop: a list that holds a run's results closes only by its button.
  useEscape('modal', s.open, () => { if (!running && !s.ran) s.close() })
  if (!s.open) return null

  const ready = s.rows.filter((r) => r.read === 'ok')
  // What IMPORT would do something with: a taken name under SKIP is left out, unless a first try already made its shard.
  const todo = ready.filter((r) => r.picked && r.run !== 'done' && r.run !== 'skipped' && (r.shardId !== null || dupAction(s.dups[r.key] ?? null, s.dupMode).act !== 'skip'))
  const errors = s.rows.filter((r) => r.read === 'error').length
  const done = s.rows.filter((r) => r.run === 'done').length
  const failed = s.rows.filter((r) => r.run === 'failed').length
  const reading = s.rows.filter((r) => r.read === 'waiting' || r.read === 'reading').length
  const allPicked = ready.length > 0 && ready.every((r) => r.picked || r.run === 'done')
  const publish = s.publish && !!me
  const working = s.rows.filter((r) => r.run !== 'idle' && r.run !== 'skipped').length
  const workTotal = working + s.rows.filter((r) => r.run === 'idle' && r.picked && r.read === 'ok').length

  let line: string
  if (s.error) line = s.error
  else if (s.phase === 'opening') line = 'OPENING'
  else if (s.phase === 'reading') line = `READING ${s.rows.length - reading} OF ${s.rows.length}`
  else if (running) line = `${publish ? 'PUBLISHING' : 'ADDING'} ${Math.min(done + failed + 1, workTotal)} OF ${workTotal}`
  else if (s.phase === 'done') line = `${done} DONE${failed ? ` · ${failed} FAILED` : ''}`
  else line = [`${ready.length} SHARD${ready.length === 1 ? '' : 'S'}`, errors ? `${errors} ERROR${errors === 1 ? '' : 'S'}` : '', s.skipped.length ? `${s.skipped.length} SKIPPED` : ''].filter(Boolean).join(' · ')
  const fraction = s.phase === 'reading' ? (s.rows.length - reading) / Math.max(1, s.rows.length) : running || s.phase === 'done' ? (done + failed) / Math.max(1, workTotal) : 0

  const primary = (() => {
    if (running) return <button className="modal__confirm modal__confirm--danger" disabled={s.stopAsked} onClick={() => s.stop()}>{s.stopAsked ? 'STOPPING' : 'STOP'}</button>
    if (s.phase === 'done' && todo.length) return <button className="modal__confirm" onClick={() => void s.retry()}>{failed ? `RETRY ${todo.length}` : `IMPORT ${todo.length}`}</button>
    if (s.phase === 'done') return null
    return <button className="modal__confirm" disabled={s.phase !== 'review' || todo.length === 0} onClick={() => void s.start()}>IMPORT {todo.length}</button>
  })()

  return createPortal(
    <div className="modal" role="dialog" aria-modal="true" aria-label={`Import ${s.fileName}`} onPointerDown={() => { if (!running && !s.ran) s.close() }}>
      <ThumbStage />
      <div className="modal__card modal__card--list zipimport" onPointerDown={(e) => e.stopPropagation()}>
        <h2 className="modal__title zipimport__title">IMPORT {s.fileName.toUpperCase()}</h2>
        <div className={`zipimport__line ${s.error || s.stall ? 'is-bad' : ''}`} aria-live="polite">{s.stall ? `${s.stall.toUpperCase()} ${line}` : line}</div>
        <div className="zipimport__bar" aria-hidden><span style={{ width: `${Math.round(fraction * 100)}%` }} /></div>
        {s.rows.length > 0 && (
          <div className="zipimport__controls">
            <Field id="zipimport-all" label="ALL">
              <Checkbox id="zipimport-all" checked={allPicked} disabled={running || ready.length === 0} onCheckedChange={(v) => s.pickAll(v === true)} />
            </Field>
            <div className="workshop__modes" role="group" aria-label="If the name is taken">
              {MODES.map((m) => (
                <button key={m.mode} className={`workshop__mode ${s.dupMode === m.mode ? 'is-on' : ''}`} aria-pressed={s.dupMode === m.mode} disabled={running} title={m.help} onClick={() => s.setDupMode(m.mode)}>{m.label}</button>
              ))}
            </div>
            <Field id="zipimport-publish" label="PUBLISH" hint={me ? undefined : 'Log in to publish'}>
              <Switch id="zipimport-publish" className="ui-switch--ok" checked={publish} disabled={running || !me} onCheckedChange={(v) => s.setPublish(v)} />
            </Field>
          </div>
        )}
        <ul className="zipimport__list" ref={setListEl}>
          {s.rows.map((r) => {
            const dup = s.dups[r.key] ?? null
            const tag = status(r, s.dupMode, dup)
            const folder = r.folder.join('/')
            return (
              <li key={r.key} className={`zipimport__row ${r.picked ? '' : 'is-off'}`}>
                <Checkbox aria-label={`Import ${r.path}`} checked={r.picked} disabled={running || r.read === 'error' || r.run === 'done'} onCheckedChange={() => s.toggle(r.key)} />
                <Thumb row={r} openId={s.openId} root={listEl} />
                <span className="zipimport__text">
                  <span className="zipimport__name">{r.name}</span>
                  <span className="zipimport__meta">
                    {folder ? `${folder} · ` : ''}{size(r.size)}{r.shard ? ` · ${r.shard.vertices.length} v · ${r.shard.faces.length} f` : ''}
                  </span>
                  {(r.read === 'error' || r.run === 'failed') && <span className="zipimport__error">{r.read === 'error' ? r.error : r.failure}</span>}
                </span>
                <span className={`tag ${tag.tone}`} title={tag.title}>{tag.label}</span>
              </li>
            )
          })}
        </ul>
        {s.skipped.length > 0 && (
          <div className="zipimport__skipped">
            <button className="workshop__link" aria-expanded={showSkipped} onClick={() => setShowSkipped((o) => !o)}>{s.skipped.length} SKIPPED {showSkipped ? '▴' : '▾'}</button>
            {showSkipped && (
              <ul>
                {s.skipped.map((f, i) => <li key={`${f.path}:${i}`}><span>{f.path}</span><span className="zipimport__meta">{f.reason}</span></li>)}
              </ul>
            )}
          </div>
        )}
        <Explanation>
          Every .json SNO object and 3D file ({'PLY, STL, OBJ with its MTL, glTF or GLB, VOX'}) in the zip becomes one of
          your shards, named after its file, with its path in the zip as its address, so the same zip imported again
          finds the same pieces. A reference from one piece to another in the zip is pointed at yours. {s.foldersOn ? 'Its folders in the zip become folders here.' : 'Folders in the zip are kept for when the workshop has folders.'} Hidden
          files and __MACOSX are skipped. A 3D file is fitted to a new shard&apos;s grid, as IMPORT fits one. If one of your
          shards has the name, or the piece is already yours: SKIP leaves it out, COPY adds a copy, UPDATE replaces a piece
          imported before at the same address, so everything placing it draws the new one. A shard that only shares a
          name is never replaced. With PUBLISH on, each shard is signed and sent as PUBLISH
          sends one, one after another; a failed one can be tried again, and is sent to the same address, never twice.
        </Explanation>
        <div className={`modal__row ${primary ? '' : 'zipimport__one'}`}>
          {primary
            ? <button className="modal__cancel" disabled={running} onClick={() => s.close()}>{s.phase === 'done' ? 'CLOSE' : 'CANCEL'}</button>
            : <button className="modal__confirm" onClick={() => s.close()}>DONE</button>}
          {primary}
        </div>
      </div>
    </div>,
    document.body,
  )
}
