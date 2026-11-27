/**
 * BlueprintsGrid.tsx - the pictures under ITEMS' third button, BLUEPRINTS
 * (design page craft-design/block-uses, section 4): the newest blueprints
 * held, each as its smoke model (BlueprintModel) in the chamfered tile the
 * other two grids use (ItemsGrid), six tiles always so the panel never
 * changes height, a "+N more" tile past six, and NEW on a card not looked at
 * yet (lib/itemsSeen isNewBlueprint) until BLUEPRINTS is opened.
 *
 * Your own blueprint's tile shows every block, as you made it; a found one
 * shows what a finder sees. A tap opens BLUEPRINTS at that row.
 */

import { GRID_SLOTS, gridOf, isNewBlueprint } from '../../lib/itemsSeen'
import { useBlueprints } from '../../store/useBlueprints'
import { useItemsSeen } from '../../store/useItemsSeen'
import { NEW_MARK, TILE_PX } from '../ItemsGrid'
import { Chamfer } from '../ui/Chamfer'
import { BlueprintModel } from './BlueprintModel'
import { NO_BLUEPRINTS, useBlueprintsModal, useListedCards } from './BlueprintsModal'

export function BlueprintsGrid(): JSX.Element {
  const owner = useBlueprints((s) => s.owner)
  const listed = useListedCards().filter((l) => !l.card.archived)
  // No NEW mark until this identity's record has been read, so a seen card never blinks NEW.
  const seen = useItemsSeen((s) => (s.ready && !!owner && s.owner === owner ? s.seen : null))
  const { shown, more, empty: blanks } = gridOf(listed, GRID_SLOTS)
  const newBehind = more > 0 && !!seen && listed.slice(shown.length).some((l) => isNewBlueprint(seen, l.card))
  const open = (focus: string | null): void => useBlueprintsModal.setState({ open: true, focus })
  return (
    <div className={`items-grid items-grid--blueprints${listed.length === 0 ? ' is-empty' : ''}`} role="group" aria-label="Your newest blueprints" data-grid="blueprints">
      {shown.map(({ card, views }) => {
        const fresh = !!seen && isNewBlueprint(seen, card)
        const name = views.record.title
        return (
          <button type="button" key={card.rowKey} className={`items-tile bp-items__tile${fresh ? ' is-new' : ''}`} data-tile={card.rowKey} onClick={() => open(card.rowKey)} title={name} aria-label={fresh ? `${name}, new` : name}>
            <Chamfer size={TILE_PX}><BlueprintModel view={views.full ?? views.finder} size={TILE_PX} label={name} /></Chamfer>
            {fresh && <span className="items-tile__new" aria-hidden="true">{NEW_MARK}</span>}
          </button>
        )
      })}
      {more > 0 && (
        <button type="button" className={`items-tile items-tile--more${newBehind ? ' is-new' : ''}`} data-tile="more" onClick={() => open(null)} title="Open BLUEPRINTS" aria-label={`${more} more${newBehind ? ', some new' : ''}: open blueprints`}>
          <Chamfer size={TILE_PX}>
            <span className="items-tile__count">+{more}</span>
            <span className="items-tile__word">MORE</span>
          </Chamfer>
          {newBehind && <span className="items-tile__new" aria-hidden="true">{NEW_MARK}</span>}
        </button>
      )}
      {Array.from({ length: blanks }, (_, i) => (
        <span key={`blank-${i}`} className="items-tile items-tile--blank" aria-hidden="true">
          <Chamfer size={TILE_PX}><span className="items-tile__scan" /></Chamfer>
        </span>
      ))}
      {listed.length === 0 && <p className="items-grid__empty">{NO_BLUEPRINTS}</p>}
    </div>
  )
}
