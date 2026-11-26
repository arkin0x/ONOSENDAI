/**
 * ChipFold.tsx: the arrow chip under the top-left stack (owner, 2026-11-26:
 * "lets add a new chip button that goes under all the other chips ... the
 * button simply has a left arrow. tapping it swipes all the chips off the
 * left of the screen and unloads them. only the arrow chip remains, and it
 * reverses direction via fade so its now in the top leftmost corner and
 * pressing it again will load and slide all the chips back onto the
 * screen"). He said "top right"; the stack is the top-left one, which is
 * where the arrow says it ends up.
 *
 * WHAT GOES. Every chip in the stack, RETURN chips and toasts included, is
 * unmounted once it has slid away (App renders none while the phase is
 * `hidden`), so none of them renders, subscribes or runs a timer. Nothing
 * any chip shows lives in the chip: the chain, notifications, finds and
 * toasts are in their stores, so a chip mounted again draws what is true
 * now. A toast waits while they are away, as it waits while the menu covers
 * the stack.
 *
 * THE MOTION, one phase at a time (useChipFoldPhase):
 *
 * | Phase | Chips | Arrow |
 * |---|---|---|
 * | shown | at rest | under the last chip, pointing left |
 * | leaving | slide off the left, top first, fading | glides up to the corner, the point turns right |
 * | hidden | unmounted | alone in the corner, pointing right |
 * | arriving | mounted, held off the left, unseen (one frame) | held in the corner while it is now laid out under them |
 * | entering | slide back in, top first | glides down under them, the point turns left |
 *
 * The glide is the arrow translated by how far its place in the stack is
 * from the stack's top (`--fold-dy`, from offsetTop, which a transform does
 * not move): on the way up it travels while the chips leave, and the moment
 * they unmount it is already where the layout puts it, so its translate
 * drops to nothing with no transition and nothing moves. On the way back
 * the same distance is where it starts. With reduced motion asked for, the
 * chips and the arrow fade instead (styles.css).
 *
 * KEPT PER IDENTITY in IndexedDB (store/chipsFold.ts). U on a keyboard does
 * the same (hooks/useKeyboard.ts). Not during the tutorial or the /demo
 * tour, which teach with chips by name (App).
 *
 * THE LOOK (owner, 2026-11-26: "your ui ux designer can decide the shape of
 * this chip"): a hexagonal blade whose point is the direction, morphing
 * through a symmetric hexagon to point the other way as the chips go or
 * come (one clip-path, the same six corners in both, so it animates). A
 * 1px cyan line round a dark glass plate, the house's line-and-inset-fill
 * technique (.fluidnote), a lit spine on the flat edge where it "holds" the
 * stack, a soft cyan halo, and a white chevron with the dark edge every
 * word over the scene has. A small amber diamond on the folded blade when
 * something waits behind it: unread notifications, or a chip that stops you
 * (RELOAD TO MOVE, a broken chain, a stalled signer, a game left open).
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { toggleChipsFolded } from '../store/chipsFold'
import { useUnread } from './Notifications'
import { useSignerStuck } from './SignerControls'
import { useGameAway } from './GameChip'
import { useChainStop } from '../hooks/useChainStop'
import { useCyberspace } from '../store/useCyberspace'
import { useVersionGate } from '../lib/versionGate'

export type FoldPhase = 'shown' | 'leaving' | 'hidden' | 'arriving' | 'entering'

/** One chip's slide, and the step between one chip and the next, top first. */
export const FOLD_SLIDE_MS = 240
export const FOLD_STAGGER_MS = 22
/** Chips after the sixth go with the sixth: the whole move stays near a third of a second. */
export const FOLD_STAGGER_MAX = 5
/** The fade that stands in for the slide with reduced motion. */
export const FOLD_FADE_MS = 180

/** How long a move takes from the tap until the chips are gone (or at rest). */
export function foldMoveMs(reduced: boolean): number {
  return reduced ? FOLD_FADE_MS : FOLD_SLIDE_MS + FOLD_STAGGER_MS * FOLD_STAGGER_MAX
}

/** The next frame, or a timer where there are no frames (tests). */
function nextFrame(cb: () => void): () => void {
  if (typeof requestAnimationFrame === 'function') {
    let inner = 0
    const outer = requestAnimationFrame(() => { inner = requestAnimationFrame(cb) })
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner) }
  }
  const t = setTimeout(cb, 16)
  return () => clearTimeout(t)
}

/**
 * The stack's phase for `folded`: a fold is `leaving` then `hidden`, an
 * unfold `arriving` then `entering` then `shown`. A tap mid-move turns it
 * round from where it is. It starts at rest, with no move, on a load.
 */
export function useChipFoldPhase(folded: boolean, reduced: boolean): FoldPhase {
  const [phase, setPhase] = useState<FoldPhase>(folded ? 'hidden' : 'shown')
  useEffect(() => {
    if (folded) {
      if (phase === 'shown' || phase === 'arriving' || phase === 'entering') setPhase('leaving')
      return
    }
    // Still on the page mid-leave: they turn round where they are.
    if (phase === 'leaving') setPhase('entering')
    else if (phase === 'hidden') setPhase('arriving')
  }, [folded, phase])
  useEffect(() => {
    if (phase === 'arriving') return nextFrame(() => setPhase('entering'))
    if (phase !== 'leaving' && phase !== 'entering') return
    const t = setTimeout(() => setPhase(phase === 'leaving' ? 'hidden' : 'shown'), foldMoveMs(reduced))
    return () => clearTimeout(t)
  }, [phase, reduced])
  return phase
}

/** The chips themselves: the stack's groups' children, the boxes that slide. */
const CHIPS = ':scope > .instruments__group > *'

/** Number the chips top first for the stagger, and set how far the arrow is from the stack's top. */
function prepareMove(arrow: HTMLElement): void {
  const stack = arrow.parentElement
  if (!stack || typeof stack.querySelectorAll !== 'function') return
  stack.querySelectorAll<HTMLElement>(CHIPS).forEach((el, i) => el.style.setProperty('--chip-i', String(Math.min(i, FOLD_STAGGER_MAX))))
  arrow.style.setProperty('--fold-dy', `${-arrow.offsetTop}px`)
  // The held start is laid out before the next frame lets it go.
  void arrow.offsetWidth
}

export function ChipFold({ phase, folded }: { phase: FoldPhase; folded: boolean }): JSX.Element {
  const ref = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    const arrow = ref.current
    if (arrow && (phase === 'leaving' || phase === 'arriving')) prepareMove(arrow)
  }, [phase])
  // What waits behind the folded blade: news, and the chips that stop you
  // (RELOAD TO MOVE, a broken chain, a stalled signer, a game left open).
  const unread = useUnread()
  const stop = useChainStop()
  const spectating = useCyberspace((s) => s.spectate !== null)
  const blocked = useVersionGate((s) => s.verdict === 'blocked' || s.savesBlocked)
  const stuck = useSignerStuck()
  const inGame = useGameAway()
  const broken = !!stop && !spectating && !(stop.source === 'relay' && stop.stop.kind === 'tall')
  const waiting = folded && (unread > 0 || broken || blocked || stuck || inGame)
  const label = folded ? 'Show status chips' : 'Hide status chips'
  return (
    <button
      ref={ref}
      className={`chipfold${folded ? ' chipfold--out' : ''}`}
      onClick={toggleChipsFolded}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={label}
      aria-expanded={!folded}
      aria-keyshortcuts="U"
      title={`${label} (U)`}
    >
      <span className="chipfold__plate" aria-hidden="true">
        <span className="chipfold__body">
          <span className="chipfold__icons">
            <ChevronLeft className="chipfold__icon chipfold__icon--l" size={16} strokeWidth={2.5} />
            <ChevronRight className="chipfold__icon chipfold__icon--r" size={16} strokeWidth={2.5} />
          </span>
          <span className="chipfold__key">U</span>
        </span>
      </span>
      {waiting && <span className="chipfold__pip" aria-hidden="true" />}
    </button>
  )
}
