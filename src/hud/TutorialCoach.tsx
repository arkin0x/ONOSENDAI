/**
 * TutorialCoach.tsx: the first-arrival tutorial's caption panel
 * (store/useTutorial.ts; first-arrival tutorial design, 2026-11-10, T2).
 *
 * The /demo coach's look (styles.css .demo) at the top of the screen, with a
 * line or two and what to do, or a centered card for a step that is a modal
 * (the welcome). A longer explanation waits behind an EXPLAIN pill. NEXT
 * reads SKIP while a step waits, and the X is SKIP TUTORIAL, on every step.
 * No keys of its own: the player's keys are the scene's (WASD, Space).
 */

import { useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronRight, ChevronUp, X } from 'lucide-react'
import { choiceOffered, runTutorialEffect, useTutorial } from '../store/useTutorial'
import { useWorkshop } from '../store/useWorkshop'
import { useDemo } from '../store/useDemo'
import { useCover } from '../hooks/useCover'
import { useEscape } from '../hooks/useEscape'
import { CaptionText, useCoachOffsets } from './DemoCoach'
import { useTutorialStage } from '../tutorial/director'

export function TutorialCoach(): JSX.Element | null {
  const active = useTutorial((s) => s.active)
  const index = useTutorial((s) => s.index)
  const done = useTutorial((s) => s.done)
  const minimized = useTutorial((s) => s.minimized)
  const explaining = useTutorial((s) => s.explaining)
  const script = useTutorial((s) => s.script)
  // The guide's things could not be staged: said where the instruction goes.
  const stageError = useTutorialStage((s) => s.error)
  // Never over the /demo tour (useTutorial pauses for it; this is the frame between),
  // nor over the workshop, which has the screen while it is open.
  const touring = useDemo((s) => s.active)
  const workshop = useWorkshop((s) => s.open)
  const step = script.steps[index]
  const modal = step?.modal === true
  const shown = active && !touring && !workshop && !!step
  const ref = useRef<HTMLDivElement | null>(null)
  const coverRef = useCover('top', shown && !modal && !minimized)
  const panelRef = useCallback((el: HTMLDivElement | null) => { ref.current = el; coverRef(el) }, [coverRef])
  useCoachOffsets(ref, shown && !modal, minimized)
  // The welcome is a modal like any other: Escape answers it (FIND IT), the
  // pad steps aside while it is up (useModalUp), and its button has the
  // focus, so Space presses it rather than committing a first move behind it.
  const go = useRef<HTMLButtonElement | null>(null)
  useEscape('modal', shown && modal, () => useTutorial.getState().next())
  useEffect(() => { if (shown && modal) go.current?.focus() }, [shown, modal, index])

  // The control a step points at wears the /demo tour's pulsing ring
  // (styles.css .demo-pulse) while the step waits; nothing is clicked.
  // A step with no wait points for as long as it is up; one that waits, until it is done.
  const highlight = shown && (!done || !step?.wait) ? step?.scene?.highlight : undefined
  useEffect(() => {
    if (!highlight) return
    let marked: Element[] = []
    const mark = (): void => {
      for (const el of marked) el.classList.remove('demo-pulse')
      marked = Array.from(document.querySelectorAll(highlight))
      for (const el of marked) el.classList.add('demo-pulse')
    }
    mark()
    // The control may come and go (a chip appears once something is found):
    // looked for again after the page changes, at most once a frame.
    let frame = 0
    const mo = new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; mark() }) })
    mo.observe(document.body, { childList: true, subtree: true })
    return () => { mo.disconnect(); if (frame) cancelAnimationFrame(frame); for (const el of marked) el.classList.remove('demo-pulse') }
  }, [highlight])

  if (!shown || !step) return null
  const t = useTutorial.getState()
  const last = index === script.steps.length - 1
  const waiting = !!step.wait && !done
  const held = step.gate === true && waiting
  const caption = done && step.captionDone ? step.captionDone : step.caption

  if (modal) {
    return createPortal(
      <div className="modal tutorial-modal" role="dialog" aria-modal="true" aria-label={step.title}>
        <div className="modal__card tutorial-card">
          <div className="demo__head">
            <span className="demo__tag">TUTORIAL</span>
            <span className="demo__chapter" />
            <button className="demo__icon" onClick={() => t.end('skipped')} aria-label="Skip the tutorial" title="Skip the tutorial"><X size={14} /></button>
          </div>
          <h2 className="modal__title">{step.title}</h2>
          <p className="demo__caption"><CaptionText caption={caption} /></p>
          {step.choices?.filter(choiceOffered).map((c) => (
            <button key={c.id} className="demo__btn tutorial-choice" onClick={() => t.choose(c.id)}>
              <span className="tutorial-choice__label">{c.label}</span>
              <span className="tutorial-choice__about">{c.about}</span>
            </button>
          ))}
          <button ref={go} className={`demo__btn tutorial-card__go ${step.choices ? 'tutorial-card__go--done' : 'demo__btn--next'}`} onClick={t.next}>{step.go ?? (last ? 'FINISH' : 'NEXT')}</button>
        </div>
      </div>,
      document.body,
    )
  }

  if (minimized) {
    return (
      <div className="demo demo--min tutorial" ref={ref} role="region" aria-label="Tutorial">
        <button className="demo__bar" onClick={() => t.setMinimized(false)} title="Show the caption">
          <span className="demo__tag">TUTORIAL</span>
          <span className="demo__bartitle">{step.title}</span>
          <ChevronDown size={14} aria-hidden />
        </button>
        <button className="demo__icon" onClick={t.next} disabled={held} aria-label={last ? 'Finish' : waiting ? 'Skip this step' : 'Next'}><ChevronRight size={14} /></button>
      </div>
    )
  }

  return (
    <div className="demo tutorial" ref={panelRef} role="region" aria-label="Tutorial">
      <div className="demo__head">
        <span className="demo__tag">TUTORIAL</span>
        <span className="demo__chapter" />
        <button className="demo__icon" onClick={() => t.setMinimized(true)} aria-label="Fold the caption" title="Fold"><ChevronUp size={14} /></button>
        <button className="demo__icon" onClick={() => t.end('skipped')} aria-label="Skip the tutorial" title="Skip the tutorial"><X size={14} /></button>
      </div>
      <div className="demo__bar-track" aria-hidden><div className="demo__bar-fill" style={{ width: `${((index + 1) / script.steps.length) * 100}%` }} /></div>
      <div className="demo__body" key={index}>
        <div className="demo__titlerow">
          <h2 className="demo__title">{step.title}</h2>
        </div>
        <p className="demo__caption"><CaptionText caption={caption} /></p>
        {step.image && <img className="tutorial__image" src={step.image.src} alt={step.image.alt} />}
        {step.explain && explaining && <p className="demo__caption tutorial__explain">{step.explain}</p>}
      </div>
      {step.wait ? (
        <div className={`demo__wait ${done ? 'is-done' : ''}`} aria-live="polite">
          <span>{done ? '✓ Done' : stageError ?? step.hint ?? 'Your turn.'}</span>
        </div>
      ) : step.hint && (
        // A step that waits on nothing still says where to go next (the menu, for a ride or an agent).
        <div className="demo__wait"><span>{step.hint}</span></div>
      )}
      <div className="demo__foot">
        {step.action && (
          <button className="demo__btn demo__btn--next tutorial__action" onClick={() => runTutorialEffect(step.action!.effect)}>{step.action.label}</button>
        )}
        {step.explain && (
          <button className={`demo__btn ${explaining ? 'is-on' : ''}`} onClick={() => t.setExplaining(!explaining)} aria-pressed={explaining}>EXPLAIN</button>
        )}
        <button className={`demo__btn demo__btn--next ${waiting && !held ? 'is-skip' : ''}`} onClick={t.next} disabled={held} title={held ? step.hint : undefined}>
          {(last || step.branch) && !waiting ? 'FINISH' : waiting && !held ? 'SKIP' : 'NEXT'} <ChevronRight size={14} aria-hidden />
        </button>
      </div>
    </div>
  )
}
