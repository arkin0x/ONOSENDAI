/**
 * TutorialCoach.tsx: the first-arrival tutorial's caption panel
 * (store/useTutorial.ts; first-arrival tutorial design, 2026-11-10, T2).
 *
 * The /demo coach's look (styles.css .demo) at the top of the screen (at the
 * foot instead while that would cover the menu panel a step points at:
 * tutorial/coachPlace.ts), with a line or two and what to do, or a centered card for a step that is a modal
 * (the welcome). A longer explanation waits behind an EXPLAIN pill. NEXT
 * reads SKIP while a step waits, and the X is SKIP TUTORIAL, on every step.
 * No keys of its own: the player's keys are the scene's (WASD, Space).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bot, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Coffee, Earth, Gamepad2, Target, Wrench, type LucideIcon } from 'lucide-react'
import { choiceOffered, runTutorialEffect, useTutorial } from '../store/useTutorial'
import { useWorkshop } from '../store/useWorkshop'
import { useDemo } from '../store/useDemo'
import { useCover } from '../hooks/useCover'
import { useEscape } from '../hooks/useEscape'
import { CaptionText, useCoachOffsets } from './DemoCoach'
import { useTutorialStage } from '../tutorial/director'
import { placeCoach, type Box, type CoachSide } from '../tutorial/coachPlace'
import { ProfilePic } from './ProfileBadge'
import { StraylightIdentity } from './StraylightIdentity'
import { EarthTrips } from './EarthTrips'
import { useNewcomerView } from '../newcomer/useNewcomer'
import { NEWCOMER_CAPTIONS, plainText } from '../newcomer/names'
import { ModalClose } from './ui/ModalClose'

/** How far along a step is, 0 to 1, along the steps that are not branches; a branch is the end. */
export function progressOf(steps: ReadonlyArray<{ branch?: boolean }>, index: number): number {
  if (steps[index]?.branch) return 1
  const through = steps.filter((s) => !s.branch).length
  const before = steps.slice(0, index + 1).filter((s) => !s.branch).length
  return through === 0 ? 1 : before / through
}

/**
 * Each "Where next?" route's picture, in a column to the left of its words
 * (arkinox, 2026-11-13): the icon the rest of the app already draws for that
 * thing. EARTH in the view menu, a game's chip, an AGENT badge, the TARGET
 * buttons (the friend route adds a TARGET), and BUILD's wrench; the
 * community, a steaming cup for Straylight Cafe (owner, 2026-11-14). Decorative:
 * the button's words stay its name. A route with none keeps the empty column.
 */
export const CHOICE_ICONS: Readonly<Record<string, LucideIcon>> = {
  straylight: Coffee,
  hyperspace: Earth,
  'earth-look': Earth,
  dungeon: Gamepad2,
  agents: Bot,
  friend: Target,
  build: Wrench,
}

/** The room kept between the coach and the panel it keeps clear of, and from the screen's edges, px. */
const COACH_GAP = 8

/** Where the coach is drawn: its side, and at the foot how far up it sits (clear of the menu button). */
interface CoachSpot { side: CoachSide; bottom: number }
const AT_TOP: CoachSpot = { side: 'top', bottom: COACH_GAP }

/** The box around every box given, or null for none. */
function around(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null
  return {
    top: Math.min(...boxes.map((b) => b.top)),
    bottom: Math.max(...boxes.map((b) => b.bottom)),
    left: Math.min(...boxes.map((b) => b.left)),
    right: Math.max(...boxes.map((b) => b.right)),
  }
}

/**
 * What is docked at the foot of the screen, which the coach at the foot sits
 * above: the menu button, the pad and its row of buttons, the deploy bar
 * (the ones that register as covering the bottom, hooks/useCover), the chat.
 */
const DOCKED_AT_FOOT = '.hamburger-menu, .touchpad, .touchops, .deploybar, .chatdock'

/** The safe area's top and bottom, px (a notch, a home indicator), read off a probe the size of them. */
function safeArea(): { top: number; bottom: number } {
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)'
  document.body.appendChild(probe)
  const cs = getComputedStyle(probe)
  const area = { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 }
  probe.remove()
  return area
}

/** The nearest ancestor of `el` that scrolls it up and down: a phone's menu (.hud), a desktop column (.hud__col). */
function scrollerOf(el: Element): Element | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const y = getComputedStyle(p).overflowY
    if ((y === 'auto' || y === 'scroll') && p.scrollHeight > p.clientHeight) return p
  }
  return null
}

export function TutorialCoach(): JSX.Element | null {
  const active = useTutorial((s) => s.active)
  const index = useTutorial((s) => s.index)
  const done = useTutorial((s) => s.done)
  const minimized = useTutorial((s) => s.minimized)
  const explaining = useTutorial((s) => s.explaining)
  const script = useTutorial((s) => s.script)
  // The guide's things could not be staged: said where the instruction goes.
  const stageError = useTutorialStage((s) => s.error)
  const stepNote = useTutorial((s) => s.stepNote)
  // What the step points at now, when it changes as the player goes (the course step: the arrows, then COMMIT).
  const stepHighlight = useTutorial((s) => s.stepHighlight)
  // Never over the /demo tour (useTutorial pauses for it; this is the frame between),
  // nor over the workshop, which has the screen while it is open.
  const touring = useDemo((s) => s.active)
  const workshop = useWorkshop((s) => s.open)
  const step = script.steps[index]
  const modal = step?.modal === true
  const shown = active && !touring && !workshop && !!step
  const ref = useRef<HTMLDivElement | null>(null)
  // Top, or the foot while the top would cover the menu panel the step points at (below).
  const [spot, setSpot] = useState<CoachSpot>(AT_TOP)
  const atTop = spot.side === 'top'
  // The step the menu was last scrolled for: once a step, so the player can scroll it afterwards.
  const scrolledFor = useRef(-1)
  const coverRef = useCover(spot.side, shown && !modal && !minimized)
  const panelRef = useCallback((el: HTMLDivElement | null) => { ref.current = el; coverRef(el) }, [coverRef])
  // The instruments make room under the coach only while it is at the top.
  useCoachOffsets(ref, shown && !modal && atTop, minimized)
  // The welcome is a modal like any other: Escape answers it (FIND IT), the
  // pad steps aside while it is up (useModalUp), and its button has the
  // focus, so Space presses it rather than committing a first move behind it.
  const go = useRef<HTMLButtonElement | null>(null)
  useEscape('modal', shown && modal, () => useTutorial.getState().next())
  // A card with choices puts the focus on the first: a stray Enter or Space
  // then picks nothing that costs anything, rather than ending the tutorial.
  const firstChoice = useRef<HTMLButtonElement | null>(null)
  useTutorial((s) => s.choicesVersion)
  // A choice under way (entering the dungeon publishes): its card waits, and why one did not go stays on it.
  // Waiting is aria-disabled, not disabled: the focus stays on the card, so Space never falls through to COMMIT behind it.
  const choosing = useTutorial((s) => s.choosing)
  const choiceNote = useTutorial((s) => s.choiceNote)
  // The routes already done this run, checked off on the choices card (item 10).
  const doneChoices = useTutorial((s) => s.doneChoices)
  // The newcomer view's plain button names in what the coach says (newcomer/names.ts).
  const plain = useNewcomerView()
  useEffect(() => { if (shown && modal) (firstChoice.current ?? go.current)?.focus() }, [shown, modal, index])

  // The control a step points at wears the /demo tour's pulsing ring
  // (styles.css .demo-pulse) while the step waits; nothing is clicked.
  // A step with no wait points for as long as it is up; one that waits, until it is done.
  const highlight = shown && (!done || !step?.wait) ? stepHighlight ?? step?.scene?.highlight : undefined
  useEffect(() => {
    if (!highlight) { setSpot(AT_TOP); return }
    let marked: Element[] = []
    const mark = (): void => {
      for (const el of marked) el.classList.remove('demo-pulse')
      marked = Array.from(document.querySelectorAll(highlight))
      for (const el of marked) el.classList.add('demo-pulse')
    }
    // Keeping clear of a menu panel the step points at (owner, 2026-11-15:
    // the "Your items" box covered ITEMS). Only what sits in a menu panel
    // counts: the pad, the chips and the hamburger have their own places,
    // which the coach at the top was laid out around. The menu is scrolled at
    // most once a step, the first time the panel needs it, so the player can
    // scroll it themselves afterwards; the side follows the panel as it moves.
    let safe = safeArea()
    const place = (): void => {
      const coach = ref.current
      const inPanel = marked.filter((el) => el.closest('[data-panel-id]'))
      const target = around(inPanel.map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0))
      if (!coach || !target) { setSpot((s) => s.side === 'top' ? s : AT_TOP); return }
      for (const el of inPanel) ro?.observe(el)
      const c = coach.getBoundingClientRect()
      const vh = window.innerHeight
      // At the foot: above the safe area, and above whatever is docked there under the coach.
      let bottomInset = COACH_GAP + safe.bottom
      for (const el of document.querySelectorAll(DOCKED_AT_FOOT)) {
        const r = el.getBoundingClientRect()
        if (r.width > 0 && r.height > 0 && r.bottom > vh / 2 && r.left < c.right && c.left < r.right) bottomInset = Math.max(bottomInset, vh - r.top + COACH_GAP)
      }
      const scroller = scrollerOf(inPanel[0])
      const index = useTutorial.getState().index
      const canScroll = scroller !== null && scrolledFor.current !== index
      const at = placeCoach({
        target, coachHeight: c.height, coachLeft: c.left, coachRight: c.right, viewportHeight: vh,
        topInset: COACH_GAP + safe.top, bottomInset, gap: COACH_GAP,
        canScrollUp: canScroll ? scroller.scrollTop : 0,
        canScrollDown: canScroll ? scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop : 0,
      })
      if (canScroll && at.scroll !== 0) {
        scrolledFor.current = index
        scroller.scrollBy({ top: at.scroll })
      }
      setSpot((s) => s.side === at.side && s.bottom === bottomInset ? s : { side: at.side, bottom: bottomInset })
    }
    // The control may come and go (a chip appears once something is found):
    // looked for again after the page changes, at most once a frame; the
    // coach's place too, and after a scroll, a resize or a change in its size.
    let frame = 0
    const update = (): void => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; mark(); place() }) }
    // The coach and the highlighted panels (place adds them) changing size, as an image loads or a panel folds.
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    if (ref.current) ro?.observe(ref.current)
    mark()
    place()
    const mo = new MutationObserver(update)
    mo.observe(document.body, { childList: true, subtree: true })
    // A turn of the phone changes the safe area: read again (outside place, whose probe the observer would see).
    const resized = (): void => { safe = safeArea(); update() }
    window.addEventListener('resize', resized)
    document.addEventListener('scroll', update, { capture: true, passive: true })
    return () => {
      mo.disconnect()
      ro?.disconnect()
      window.removeEventListener('resize', resized)
      document.removeEventListener('scroll', update, { capture: true })
      if (frame) cancelAnimationFrame(frame)
      for (const el of marked) el.classList.remove('demo-pulse')
    }
  }, [highlight, minimized])

  const spotClass = atTop ? '' : ' demo--bottom'
  const spotStyle = atTop ? undefined : { bottom: `${spot.bottom}px` }

  if (!shown || !step) return null
  const t = useTutorial.getState()
  const last = index === script.steps.length - 1
  const waiting = !!step.wait && !done
  // A gate never holds when staging failed: NEXT is the way on (the box step has no SKIP otherwise).
  const held = step.gate === true && waiting && !stageError
  const own = plain ? NEWCOMER_CAPTIONS[step.id] : undefined
  const caption = plainText(done && step.captionDone ? step.captionDone : own?.caption ?? step.caption, plain)
  const title = plain ? own?.title ?? step.title : step.title
  const hint = plainText(own?.hint ?? step.hint, plain)
  const note = plainText(stepNote ?? undefined, plain)
  // BACK shows once there is a step behind this one (not on the welcome). It
  // is the way back out of a branch too (feedback item 8).
  const canBack = index > 0

  if (modal) {
    return createPortal(
      <div className="modal tutorial-modal" role="dialog" aria-modal="true" aria-label={step.title}>
        <div className="modal__card tutorial-card">
          <div className="demo__head">
            <span className="demo__tag">TUTORIAL</span>
            <span className="demo__chapter" />
            <ModalClose onClose={() => t.end('skipped')} label="Close the tutorial" />
          </div>
          <h2 className="modal__title">{title}</h2>
          <p className="demo__caption"><CaptionText caption={caption} /></p>
          {step.choices?.filter(choiceOffered).map((c, i) => {
            const choiceDone = doneChoices.includes(c.id)
            const Icon = CHOICE_ICONS[c.id]
            return (
              <button key={c.id} ref={i === 0 ? firstChoice : undefined} className={`demo__btn tutorial-choice ${choiceDone ? 'is-done' : ''}`} onClick={() => t.choose(c.id)} aria-disabled={choosing !== null}>
                <span className="tutorial-choice__icon" aria-hidden>{Icon && <Icon size={28} strokeWidth={1.75} aria-hidden />}</span>
                <span className="tutorial-choice__text">
                  <span className="tutorial-choice__label">{choiceDone && <Check size={13} aria-hidden className="tutorial-choice__check" />}{c.label}</span>
                  <span className="tutorial-choice__about">{choosing === c.id ? 'One moment.' : choiceDone ? 'Done. Try another.' : c.about}</span>
                </span>
              </button>
            )
          })}
          {/* Always there, so a screen reader hears the refusal when its words arrive. */}
          <p className="demo__caption tutorial__note" role="status">{choiceNote}</p>
          <div className="tutorial-card__foot">
            {canBack && <button className="demo__btn tutorial__back" onClick={t.back} aria-label="Back"><ChevronLeft size={14} aria-hidden /> BACK</button>}
            <button ref={go} className={`demo__btn tutorial-card__go ${step.choices ? 'tutorial-card__go--done' : 'demo__btn--next'}`} onClick={t.next}>{step.go ?? (last ? 'FINISH' : 'NEXT')}</button>
          </div>
        </div>
      </div>,
      document.body,
    )
  }

  if (minimized) {
    return (
      <div className={`demo demo--min tutorial${spotClass}`} style={spotStyle} ref={ref} role="region" aria-label="Tutorial">
        <button className="demo__bar" onClick={() => t.setMinimized(false)} title="Show the caption">
          <span className="demo__tag">TUTORIAL</span>
          <span className="demo__bartitle">{title}</span>
          <ChevronDown size={14} aria-hidden />
        </button>
        <button className="demo__icon" onClick={t.next} disabled={held} aria-label={(last || (step.branch && !step.then)) ? 'Finish' : waiting ? 'Skip this step' : 'Next'}><ChevronRight size={14} /></button>
      </div>
    )
  }

  return (
    <div className={`demo tutorial${spotClass}`} style={spotStyle} ref={panelRef} role="region" aria-label="Tutorial">
      <div className="demo__head">
        <span className="demo__tag">TUTORIAL</span>
        <span className="demo__chapter" />
        <button className="demo__icon" onClick={() => t.setMinimized(true)} aria-label="Fold the caption" title="Fold"><ChevronUp size={14} /></button>
        <ModalClose onClose={() => t.end('skipped')} label="Close the tutorial" />
      </div>
      {/* How far along, counting the way through (branches after the choice count as its end). */}
      <div className="demo__bar-track" aria-hidden><div className="demo__bar-fill" style={{ width: `${progressOf(script.steps, index) * 100}%` }} /></div>
      <div className="demo__body" key={index}>
        <div className="demo__titlerow">
          <h2 className="demo__title">{title}</h2>
        </div>
        {step.speaker
          ? (
            <div className="tutorial__speaker">
              <ProfilePic pubkey={step.speaker} size={44} />
              <p className="demo__caption"><CaptionText caption={caption} /></p>
            </div>
          )
          : <p className="demo__caption"><CaptionText caption={caption} /></p>}
        {step.panel === 'straylight-identity' && <StraylightIdentity />}
        {step.panel === 'earth-trips' && <EarthTrips />}
        {step.image && <img className="tutorial__image" src={step.image.src} alt={step.image.alt} width={160} height={160} onError={(e) => { e.currentTarget.style.display = 'none' }} />}
        {step.explain && explaining && <p className="demo__caption tutorial__explain">{plainText(step.explain, plain)}</p>}
      </div>
      {step.wait ? (
        <div className={`demo__wait ${done ? 'is-done' : ''}`} aria-live="polite">
          <span>{done ? '✓ Done' : stageError ?? note ?? hint ?? 'Your turn.'}</span>
        </div>
      ) : hint && (
        // A step that waits on nothing still says where to go next (the menu, for a ride or an agent).
        <div className="demo__wait"><span>{hint}</span></div>
      )}
      <div className="demo__foot">
        {step.action && (
          <button className="demo__btn demo__btn--next tutorial__action" onClick={() => runTutorialEffect(step.action!.effect)}>{step.action.label}</button>
        )}
        {step.explain && (
          <button className={`demo__btn ${explaining ? 'is-on' : ''}`} onClick={() => t.setExplaining(!explaining)} aria-pressed={explaining}>EXPLAIN</button>
        )}
        {/* BACK is sized to its text and outlined; NEXT fills the rest and is the filled action (feedback item 8). */}
        {canBack && <button className="demo__btn tutorial__back" onClick={t.back} aria-label="Back"><ChevronLeft size={14} aria-hidden /> BACK</button>}
        <button className={`demo__btn demo__btn--next tutorial__next ${waiting && !held ? 'is-skip' : ''}`} onClick={t.next} disabled={held} title={held ? hint : undefined}>
          {(last || (step.branch && !step.then)) && !waiting ? 'FINISH' : waiting && !held ? 'SKIP' : 'NEXT'} <ChevronRight size={14} aria-hidden />
        </button>
      </div>
    </div>
  )
}
