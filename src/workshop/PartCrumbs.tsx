/**
 * PartCrumbs.tsx - where you are inside a shard, and the way back out
 * (arkinox, 2026-10-25: "Double-tap a part's box to enter an isolated edit view
 * of that part: the parent dims or hides, a breadcrumb shows the path (ROOM >
 * WATER), EXIT returns").
 *
 * Each crumb is a way back to that level; EXIT backs out one. A copy carried
 * in the shard (DECK-0003 §1.10) is edited here, and every placement of it in
 * the shard that holds it follows. A live link is shown as its author's event
 * has it, read-only, with DETACH, which makes it a copy you can edit.
 */

import { Fragment } from 'react'
import type { ShardModel } from 'sno-core/shards'
import { focusOf, type InsideStep } from '../lib/carried'
import { useCyberspace } from '../store/useCyberspace'
import { useWorkshop } from '../store/useWorkshop'

export function PartCrumbs({ root, path }: { root: ShardModel; path: InsideStep[] }): JSX.Element {
  const me = useCyberspace((s) => s.identity.pubkey)
  const w = useWorkshop.getState
  const names = [root.name, ...path.map((_, i) => focusOf(root, path.slice(0, i + 1)).model.name)]
  const top = path[path.length - 1]
  return (
    <nav className="ws__crumbs" aria-label="Open part">
      {names.map((n, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="ws__crumb-sep" aria-hidden>›</span>}
          <button
            className={`chip ws__crumb ${i === names.length - 1 ? 'is-on' : ''}`}
            disabled={i === names.length - 1}
            onClick={() => w().exitTo(i)}
            title={i === 0 ? 'Back to the whole shard' : `Back to ${n}`}
          >{n.toUpperCase()}</button>
        </Fragment>
      ))}
      {top?.live && <span className="tag" title="A live link follows its author's object. DETACH makes a copy you can edit.">LIVE LINK</span>}
      {top?.live && !path.slice(0, -1).some((step) => step.live) && (
        <button className="chip ws__chip" disabled={!me} onClick={() => w().detachPart(me)} title="Make it a copy, carried inside the shard, and edit that">DETACH</button>
      )}
      <button className="chip ws__chip" onClick={() => w().exitTo(path.length - 1)} title="Back out of this part (Esc)">EXIT</button>
    </nav>
  )
}
