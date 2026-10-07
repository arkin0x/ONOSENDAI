/**
 * PlaceObjectPicker.tsx - PLACE OBJECT: choose something to place at the
 * build cursor.
 *
 * Built around a list of sources, each a tab, so more places to place from
 * slot in beside your own models without reworking the picker: the Shard
 * Feed (PR 3) and SNO lists (PR 4) become new entries in SOURCES with their
 * own rows and their own empty state. While there is one source the tab row
 * is not drawn.
 *
 * A fresh identity has no models, and the empty state is something to act
 * on, not a dead end (arkinox, 2026-10-07): OPEN WORKSHOP leaves BUILD mode
 * the way EXIT does and opens the workshop, where a model is made and its
 * DEPLOY brings you straight back into BUILD mode.
 */

import { useState } from 'react'
import type { ShardModel } from 'sno-core/shards'
import { useWorkshop } from '../store/useWorkshop'
import { useBuilder } from '../store/useBuilder'
import { useStash } from './stash'

/** Where objects to place come from. Only your own models for now. */
type SourceId = 'models'

const SOURCES: Array<{ id: SourceId; label: string }> = [
  { id: 'models', label: 'YOUR MODELS' },
]

/** Leave BUILD mode as EXIT does, and open the workshop to make a model. */
export function openWorkshopFromPicker(): void {
  useStash.getState().close()
  useBuilder.getState().exit()
  useWorkshop.getState().openWorkshop()
}

export function PlaceObjectPicker(): JSX.Element {
  const [source, setSource] = useState<SourceId>('models')
  return (
    <>
      {SOURCES.length > 1 && (
        <div className="objpick__tabs" role="tablist">
          {SOURCES.map((s) => (
            <button key={s.id} role="tab" aria-selected={source === s.id} className={`objpick__tab ${source === s.id ? 'is-on' : ''}`} onClick={() => setSource(s.id)}>{s.label}</button>
          ))}
        </div>
      )}
      {source === 'models' && <ModelsSource />}
    </>
  )
}

function ModelsSource(): JSX.Element {
  const shards = useWorkshop((s) => s.shards)
  const list: ShardModel[] = [...shards].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  if (list.length === 0) {
    return (
      <div className="objpick__empty">
        <p className="login__note">No models yet. Make one in the workshop.</p>
        <button className="secret__act login__act objpick__workshop" onClick={openWorkshopFromPicker}>OPEN WORKSHOP</button>
      </div>
    )
  }
  return (
    <>
      <p className="login__note">Choose one of your models. You aim and place it next; CANCEL on the bar brings you back here.</p>
      <ul className="objpick__list">
        {list.map((s) => {
          const empty = s.vertices.length === 0 && (s.parts?.length ?? 0) === 0
          return (
            <li key={s.id}>
              <button className="objpick__row" disabled={empty} onClick={() => useStash.getState().deployModel(s.id)} title={empty ? 'Nothing in it to place yet' : `Place "${s.name}"`}>
                <span className="objpick__name">{s.name}</span>
                <span className="objpick__meta">{empty ? 'EMPTY' : `${s.vertices.length} v · ${s.faces.length} f${s.parts?.length ? ` · ${s.parts.length} obj` : ''}`}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </>
  )
}
