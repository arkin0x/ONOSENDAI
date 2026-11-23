/**
 * LookPicker.tsx: OTHER on the hide bar's model row (chest and door design,
 * D2, D3): any model to wear instead of a built-in look.
 *
 * MINE is one of your workshop models, carried inline as a copy: it stays
 * as you sealed it. FEED is someone's published object, placed by a
 * one-part wrapper that follows its author's edits (DECK-0004 §3.6; useShards
 * feedWrapper). The same two tabs PLACE OBJECT has, in the same words.
 *
 * A model of yours that places pieces you never published cannot go out
 * yet: carrying those pieces inside what is hidden is the inline parts writer
 * (DECK-0003 §1.10, ONOSENDAI #504), which has not landed. It
 * is listed, disabled, with the reason as its tooltip.
 *
 * Rendered on the body (a portal), over the screen: the hide bar it opens
 * from scrolls and clips what is inside it. Laid out as PLACE OBJECT is:
 * as tall as the screen as the list needs, with the search pinned under it.
 */

import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ShardModel } from 'sno-core/shards'
import { parseAddress } from 'sno-core/parts'
import { useWorkshop } from '../store/useWorkshop'
import { usePublished } from '../store/usePublished'
import { useCyberspace } from '../store/useCyberspace'
import { useEscape } from '../hooks/useEscape'
import type { LookChoice } from '../store/useShards'
import { FeedList } from './FeedList'
import { ShardFolders, modelEditedAt, modelName, modelRef, useNewestFirst } from './ShardFolders'
import { ShardThumb } from './ShardThumb'
import { ModalClose } from './ui/ModalClose'
import { SearchField } from './ui/SearchField'
import { useVisualViewport } from '../hooks/useVisualViewport'

/** Why a workshop model cannot be worn yet: it places a piece of yours that was never published. Null when it can. */
export function unpublishedPieces(model: Pick<ShardModel, 'refs'>, me: string, published: (d: string) => boolean): string | null {
  for (const r of model.refs ?? []) {
    if (r[0] !== 'a') continue
    const a = parseAddress(r[1])
    if (a && a.pubkey === me && !published(a.d)) return 'It places pieces you have not published'
  }
  return null
}

export function LookPicker({ onPick, onClose }: { onPick: (look: LookChoice) => void; onClose: () => void }): JSX.Element {
  const shards = useWorkshop((s) => s.shards)
  const ledger = usePublished((s) => s.ledger)
  const me = useCyberspace((s) => s.identity.pubkey)
  const list: ShardModel[] = useNewestFirst(shards, modelRef, modelEditedAt)
  const [source, setSource] = useState<'mine' | 'feed'>(() => (shards.length === 0 ? 'feed' : 'mine'))
  const [query, setQuery] = useState('')
  useEscape('modal', true, onClose)
  const overlay = useRef<HTMLDivElement>(null)
  useVisualViewport(overlay)
  // To the body: the hide bar it opens from clips what is inside it.
  return createPortal((
    <div ref={overlay} className="modal modal--fill" role="dialog" aria-modal="true" aria-label="Model" onPointerDown={onClose}>
      <div className="modal__card login stash-modal stash-modal--fill" onPointerDown={(e) => e.stopPropagation()}>
        <header className="panel__head secrets__head">
          <h2 className="modal__title">Model</h2>
          <ModalClose onClose={onClose} />
        </header>
        <div className="objpick__body">
          <div className="objpick__tabs" role="tablist">
            {(['mine', 'feed'] as const).map((id) => (
              <button key={id} role="tab" aria-selected={source === id} className={`objpick__tab ${source === id ? 'is-on' : ''}`} onClick={() => setSource(id)}>{id.toUpperCase()}</button>
            ))}
          </div>
          {source === 'mine' ? (
            list.length === 0 ? (
              <p className="login__note">You have no models yet.</p>
            ) : (
              <ul className="objpick__list">
                <ShardFolders items={list} refOf={modelRef} nameOf={modelName} query={query} row={(s, f) => {
                  const empty = s.vertices.length === 0 && (s.parts?.length ?? 0) === 0
                  const held = unpublishedPieces(s, me, (d) => !!ledger[d])
                  return (
                    <li key={s.id} {...f.drag}>
                      <button className="objpick__row" disabled={empty || !!held} onClick={() => { useWorkshop.getState().keepCopy(s.id); onPick({ from: 'mine', shardId: s.id }) }} title={empty ? 'Nothing in it to place yet' : held ?? `Wear "${s.name}"`}>
                        <ShardThumb shard={s} />
                        <span className="objpick__name">{f.mark(s.name)}</span>
                        <span className="objpick__meta">{empty ? 'EMPTY' : `${s.vertices.length} v · ${s.faces.length} f${s.parts?.length ? ` · ${s.parts.length} obj` : ''}`}</span>
                      </button>
                      {f.tool}
                    </li>
                  )
                }} />
              </ul>
            )
          ) : (
            <FeedList onPick={(o) => onPick({ from: 'feed', object: o })} query={query} />
          )}
          {(source === 'feed' || list.length > 0) && (
            <SearchField
              className="objpick__search"
              holdHeight
              value={query}
              onChange={setQuery}
              placeholder={source === 'mine' ? 'Search shards and folders' : 'Search the feed'}
              label={source === 'mine' ? 'Search your shards and folders' : 'Search the feed'}
            />
          )}
        </div>
      </div>
    </div>
  ), document.body)
}
