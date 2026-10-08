/**
 * PlaceObjectPicker.tsx - PLACE OBJECT: choose something to place at the
 * build cursor.
 *
 * Built around a list of sources, each a tab: MINE (your models) and FEED
 * (everyone's published objects, the Shard Feed). SNO lists (PR 4) become one
 * more entry in SOURCES. FEED opens first when you have no models of your
 * own, since that is where there is something to place (arkinox, 2026-10-08).
 *
 * A tap on a FEED object lines it up exactly as one of your models: the
 * deploy bar, the height fitted to it, size and turns. It goes out as a copy
 * that credits its author, or with LIVE LINK by reference (ruling B1).
 *
 * The empty state is something to act on: pick from the FEED, or OPEN
 * WORKSHOP, which leaves BUILD mode the way EXIT does and opens the workshop,
 * where a model is made and its DEPLOY brings you straight back.
 */

import { useState } from 'react'
import type { ShardModel } from 'sno-core/shards'
import { useWorkshop } from '../store/useWorkshop'
import { useBuilder } from '../store/useBuilder'
import { useStash } from './stash'
import { FeedList } from './FeedList'
import { Explanation } from './Explanation'

/** Where objects to place come from. */
export type SourceId = 'mine' | 'feed'

const SOURCES: Array<{ id: SourceId; label: string }> = [
  { id: 'mine', label: 'MINE' },
  { id: 'feed', label: 'FEED' },
]

/** The tab PLACE OBJECT opens on: FEED when you have no models yet, else MINE. */
export function defaultSource(models: readonly ShardModel[]): SourceId {
  return models.length === 0 ? 'feed' : 'mine'
}

/** Leave BUILD mode as EXIT does, and open the workshop to make a model. */
export function openWorkshopFromPicker(): void {
  useStash.getState().close()
  useBuilder.getState().exit()
  useWorkshop.getState().openWorkshop()
}

export function PlaceObjectPicker(): JSX.Element {
  // The tab last picked from, so a cancelled deploy comes back to it; else MINE, or FEED with no models.
  const [source, setSource] = useState<SourceId>(() => useStash.getState().pickTab ?? defaultSource(useWorkshop.getState().shards))
  return (
    <>
      <div className="objpick__tabs" role="tablist">
        {SOURCES.map((s) => (
          <button key={s.id} role="tab" aria-selected={source === s.id} className={`objpick__tab ${source === s.id ? 'is-on' : ''}`} onClick={() => setSource(s.id)}>{s.label}</button>
        ))}
      </div>
      {source === 'mine' && <ModelsSource toFeed={() => setSource('feed')} />}
      {source === 'feed' && (
        <>
          <FeedList onPick={(o) => useStash.getState().deployObject(o)} />
          <Explanation>
            <ul className="objpick__explain">
              <li>A pick goes out as a copy: it stays exactly as you placed it.</li>
              <li>The copy credits its author.</li>
              <li>LIVE LINK instead follows the author&apos;s edits.</li>
            </ul>
          </Explanation>
        </>
      )}
    </>
  )
}

function ModelsSource({ toFeed }: { toFeed: () => void }): JSX.Element {
  const shards = useWorkshop((s) => s.shards)
  const list: ShardModel[] = [...shards].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  if (list.length === 0) {
    return (
      <div className="objpick__empty">
        <p className="login__note">You have no models yet. Pick one from the FEED to start building, or make your own in the WORKSHOP.</p>
        <div className="objpick__emptyacts">
          <button className="secret__act login__act objpick__workshop" onClick={toFeed}>FEED</button>
          <button className="secret__act login__act objpick__workshop" onClick={openWorkshopFromPicker}>OPEN WORKSHOP</button>
        </div>
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
