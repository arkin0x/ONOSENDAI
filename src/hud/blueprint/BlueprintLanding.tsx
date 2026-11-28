/**
 * BlueprintLanding.tsx - what BUILD's BLUEPRINT button shows first (owner,
 * 2026-11-27: "the first thing it should show is the blueprints you have in
 * the item inventory style with a deploy button next to each, and then a big
 * button on top to CREATE NEW. this gives both paths then").
 *
 * - CREATE NEW on top, the whole width: it starts a new blueprint (onCreate).
 * - Under it, every blueprint held that is not archived, yours (MINE) and
 *   the ones you found (HELD), as tiles in the ITEMS style: the 80px
 *   chamfered smoke model (every block for your own, what a finder sees for
 *   a found one), the name and who made it. The tile just made, when there
 *   is one, comes first and wears NEW.
 * - Each tile's DEPLOY lines it up where you stand (lib/blueprint/place
 *   startPlaceBlueprint 'here': the same PLACE HERE as BLUEPRINTS, with its
 *   confirmation and its LIVE/LOCAL rules), and the BLUEPRINT tool closes so
 *   the deploy bar takes over. PUT IN A CHEST lines up a new chest with the
 *   card inside, as in BLUEPRINTS. Why it could not start shows over the
 *   tile, so nothing under it moves.
 * - Tapping the picture opens EXAMINE (BlueprintExamine, the one BLUEPRINTS
 *   opens, with FINDER and MAKER for your own).
 * - The game's own blueprint (the Compiler's) is never placed: a plain line
 *   stands where DEPLOY and PUT IN A CHEST would be, at their height.
 * - An item blueprint wears the orange mark: an orange outline and a
 *   hammer tab on its picture (ItemTab).
 * - NEW marks the card just made and any card that arrived unseen (the
 *   BLUEPRINTS store's fresh set), like the Compiler's when the game gives it.
 *
 * The cards are read once for both views (BlueprintsModal useListedCards),
 * and the names and EXAMINE are the BLUEPRINTS list's own.
 */

import { useMemo, useState } from 'react'
import { gameNoDeploy, isGameCard } from '../../lib/blueprint/gameCard'
import { useBlueprints } from '../../store/useBlueprints'
import { MapPin, PackagePlus, Plus, X } from 'lucide-react'
import { startPlaceBlueprint } from '../../lib/blueprint/place'
import { useBlueprintTool } from '../../store/useBlueprintTool'
import { NEW_MARK } from '../ItemsGrid'
import { Chamfer, THUMB_PX } from '../ui/Chamfer'
import { BlueprintModel } from './BlueprintModel'
import { BlueprintExamine, ITEM_STYLE, ItemTab, Who, itemChamfer, useListedCards, type CardViews } from './BlueprintsModal'
import type { BlueprintCard } from '../../lib/blueprint/blueprintDb'

/** The one line under CREATE NEW when there is nothing held yet. */
export const NO_LANDING = "Make a blueprint from blocks you've built"

export interface BlueprintLandingProps {
  /** CREATE NEW: start a new blueprint. */
  onCreate: () => void
  /** The card just made, listed first and marked NEW. */
  freshRowKey?: string | null
}

export function BlueprintLanding({ onCreate, freshRowKey = null }: BlueprintLandingProps): JSX.Element {
  const listed = useListedCards()
  const arrived = useBlueprints((s) => s.fresh)
  const cards = useMemo(() => {
    const held = listed.filter((l) => !l.card.archived)
    const fresh = freshRowKey ? held.find((l) => l.card.rowKey === freshRowKey) : undefined
    return fresh ? [fresh, ...held.filter((l) => l !== fresh)] : held
  }, [listed, freshRowKey])
  return (
    <div className="bp-land" data-landing>
      <button type="button" className="bp-land__create" onClick={onCreate} title="Make a new blueprint from blocks you've built">
        <Plus size={18} strokeWidth={2.5} aria-hidden />CREATE NEW
      </button>
      {cards.length === 0 ? (
        <p className="bp-land__empty">{NO_LANDING}</p>
      ) : (
        <ul className="bp-land__grid" aria-label="Your blueprints">
          {cards.map((l) => <LandingTile key={l.card.rowKey} card={l.card} views={l.views} fresh={l.card.rowKey === freshRowKey || arrived.has(l.card.rowKey)} />)}
        </ul>
      )}
    </div>
  )
}

/** One blueprint held: its picture (EXAMINE), its name and maker, DEPLOY and PUT IN A CHEST. */
function LandingTile({ card, views, fresh }: { card: BlueprintCard; views: CardViews; fresh: boolean }): JSX.Element {
  const [examining, setExamining] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const name = views.record.title
  const game = isGameCard(card)
  const thumb = itemChamfer(card)
  const place = (where: 'here' | 'chest'): void => {
    setRefusal(null)
    const why: unknown = startPlaceBlueprint(card, where)
    if (typeof why === 'string' && why) { setRefusal(why); return }
    // Lined up: the deploy bar takes over from here.
    useBlueprintTool.getState().close()
  }
  return (
    <li className={`bp-land__tile${fresh ? ' is-new' : ''}`} style={ITEM_STYLE} data-landing-tile={card.rowKey} data-item={thumb.item || undefined}>
      <button type="button" className="bp-land__pic" onClick={() => setExamining(true)} title={`Examine ${name}`} aria-label={`Examine ${name}${thumb.item ? ', an item blueprint' : ''}`}>
        <Chamfer size={THUMB_PX} className={thumb.className || undefined}>
          <BlueprintModel view={views.full ?? views.finder} size={THUMB_PX} label={name} />
          {thumb.item && <ItemTab />}
        </Chamfer>
        {fresh && <span className="bp-land__new" aria-hidden="true">{NEW_MARK}</span>}
      </button>
      <span className="bp-land__name" title={name}>{name}</span>
      <span className="bp-land__by">by <Who pubkey={card.record.pubkey} /></span>
      {game ? (
        <span className="bp-land__gameline">{gameNoDeploy(card)}</span>
      ) : (
        <>
          <button type="button" className="bp-land__go" onClick={() => place('here')} title="Leave it where you are, for others to find. They each take a copy">
            <MapPin size={13} strokeWidth={2.25} aria-hidden />DEPLOY
          </button>
          <button type="button" className="bp-land__chest" onClick={() => place('chest')} title="Put a copy in a new chest">
            <PackagePlus size={12} strokeWidth={2.25} aria-hidden />PUT IN A CHEST
          </button>
        </>
      )}
      {refusal && (
        <span className="bp-land__refusal" role="status">
          <span>{refusal}</span>
          <button type="button" className="bp-land__dismiss" onClick={() => setRefusal(null)} aria-label="Dismiss"><X size={12} strokeWidth={2.5} aria-hidden /></button>
        </span>
      )}
      {examining && <BlueprintExamine card={card} views={views} onClose={() => setExamining(false)} />}
    </li>
  )
}
