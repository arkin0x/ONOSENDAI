/**
 * ChainAhead.tsx: how far ahead of your chain the walk is, drawn on the
 * CHAIN chip (arkinox, 2026-11-17: "we need a UI to show how far ahead of
 * our chain we are", in the chain chip, "without changing the size of the
 * chip").
 *
 * WALK shows every step the moment it is pressed and proves them behind
 * you. The count here is the events ahead (store/walkAhead.ts), the one
 * number fluid WALK's slowdown and the LOSING SYNC warning go by, so the
 * three always agree: the bar turns amber where the walk starts to slow
 * and the warning starts to show, and red where the walk stops and the
 * warning is fully shown. Moves already proved and waiting for the relay
 * (LOCAL, a held chain) are not counted: that is the strip under the
 * LIVE/LOCAL switch.
 *
 * The edge bar: one slanted tick per event, FLUID_HOLD_AT (20) of them, in
 * the chip's bottom padding, so the chip is the same size in every state.
 *
 * | Ahead | Look |
 * |---|---|
 * | 0 | The chip as it always was. The bar fades out about a second after you catch up and is then taken off the page. |
 * | 1 to 14 | That many ticks lit cyan from the left, the newest white. The last six slots are hollow amber outlines, set a little apart: the slowing stretch, in sight before you reach it. |
 * | 15 to 19 | The amber slots fill. Amber corner brackets appear outside the chip and close in. |
 * | 20 and past | Every tick red (the warning's red), the brackets on the corners and red, the chip's border red, and the bar breathes slowly. A fall can queue past 20; the bar stays full. |
 *
 * A new move's tick lights white and tall, then settles. A move landing on
 * your chain folds the end tick away while the CHAIN total glints white.
 * Moves dropped together (a wall, STOP) go out together, with no fold: they
 * did not land.
 *
 * Nothing here is drawn on a chain that is not yours to walk right now:
 * spectating, history, or out of WALK. The marks are absolutely positioned
 * and take no pointer events, so no state moves the chip or what is under
 * it (styles.css, "Chain chip: how far ahead"). Every change is a class or
 * a custom property on a render that happens once per count change; the
 * motion is the stylesheet's.
 *
 * Kept cheap (arkinox, 2026-11-21: "I like the visual, but I don't want to
 * sacrifice the performance"). The count is read in AheadChip, the chip's
 * button, and nowhere else in the chip, so a step renders the button and
 * not the chain explorer around it; a store change that leaves the count
 * alone renders nothing; no state is set during a render. The stylesheet
 * moves only transform and opacity, which the compositor plays without
 * painting the chip again (hud/__tests__/chipCost.test.tsx holds all of
 * this).
 *
 * Drawn after augmented-ui's corner regions, Halo's shield states (the
 * limit changes the frame, not just the fill) and FUI registration marks;
 * the research is in the design plan. All hand-written CSS.
 */

import { memo, useLayoutEffect, useMemo, useReducer, useRef, type ButtonHTMLAttributes, type CSSProperties } from 'react'
import { FLUID_HOLD_AT } from '../lib/fluidWalk'
import { useCyberspace } from '../store/useCyberspace'
import { SYNC_WARN_AT } from '../store/useWalk'
import { useAheadSelect } from '../store/walkAhead'
import { useLayers } from '../store/useLayers'

/** One tick per event, to where the walk stops. */
export const AHEAD_TICKS = FLUID_HOLD_AT

/**
 * How long the bar stays on the page after the walk has caught up: the
 * stylesheet's wait (900 ms) and fade (400 ms), and a little over. Waiting
 * first keeps it from blinking while proofs keep pace with the steps.
 */
export const AHEAD_LINGER_MS = 1400

/** How far out the corner brackets sit, in px: where they appear, and closed onto the corners. */
const BRACKET_FAR = 4
const BRACKET_NEAR = 1.5

/** The bar's state at one count. */
export interface AheadBar {
  /** Lit ticks: the events ahead, 0 to AHEAD_TICKS. A count past the stop is a full bar. */
  n: number
  /** Anything is ahead. */
  on: boolean
  /** The walk is slowing: the amber stretch, the brackets. */
  slow: boolean
  /** The walk is stopped: red. */
  limit: boolean
  /** How far the brackets have closed in, 0 where they appear to 1 at the stop. */
  close: number
  /** The slowing stretch is drawn (the hollow amber slots): the sync limit is on. */
  zone: boolean
}

/**
 * The bar for `ahead` events ahead (store/walkAhead.ts): the slowdown's own
 * thresholds, never its own. With the sync limit off in Settings (`limits`
 * false, store/walkLimits.ts) the walk neither slows nor stops, so the bar
 * only counts: no amber, brackets or red.
 */
export function aheadBar(ahead: number, limits = true): AheadBar {
  const n = Number.isFinite(ahead) ? Math.max(0, Math.min(AHEAD_TICKS, Math.floor(ahead))) : 0
  if (!limits) return { n, on: n > 0, slow: false, limit: false, close: 0, zone: false }
  const close = Math.max(0, Math.min(1, (n - SYNC_WARN_AT) / (FLUID_HOLD_AT - SYNC_WARN_AT)))
  return { n, on: n > 0, slow: n >= SYNC_WARN_AT, limit: n >= FLUID_HOLD_AT, close, zone: true }
}

/** What the last change to the count was, so the stylesheet can play it. */
export interface AheadTrack {
  n: number
  /** The chain's length, to see a move land. */
  total: number
  /** The last change was a new move: tick `n` lights up white. */
  rose: boolean
  /** Ticks above `n` up to this one went by landing on the chain, one at a time: each folds away. 0 for none. */
  goneTop: number
  /** How many moves have landed in this stretch of being ahead: each new one glints the total. 0 from the first move after catching up. */
  landed: number
}

export const AHEAD_TRACK_START: AheadTrack = { n: 0, total: 0, rose: false, goneTop: 0, landed: 0 }

/**
 * The track after the count and the chain's length are now `n` and `total`.
 *
 * A move landing grows the chain and brings the count down in one store
 * change (store/useWalk.ts pump runs inside the change that lands it), so
 * the two are seen together: that, and only that, folds a tick away. A
 * count that falls any other way (a step undone, a wall, STOP) just goes
 * out. The total glints for every landing while ahead, and the first move
 * after catching up starts the count of them again, so a move made never
 * glints.
 */
export function aheadStep(was: AheadTrack, n: number, total: number): AheadTrack {
  if (was.n === n && was.total === total) return was
  const grew = total > was.total && was.n > 0
  const landed = was.n === 0 ? 0 : was.landed + (grew ? 1 : 0)
  if (n > was.n) return { n, total, rose: true, goneTop: 0, landed }
  if (n === was.n) return { ...was, total, landed }
  const folds = n === was.n - 1 && grew
  return { n, total, rose: false, goneTop: folds ? Math.max(was.goneTop, was.n) : 0, landed }
}

/** Tick `i` (1 to AHEAD_TICKS) of the bar: its classes. */
export function tickClass(i: number, bar: AheadBar, track: Pick<AheadTrack, 'rose' | 'goneTop'>): string {
  const cls: string[] = []
  if (bar.zone && i >= SYNC_WARN_AT) cls.push('is-z')
  if (bar.zone && i === SYNC_WARN_AT) cls.push('is-z1')
  if (i <= bar.n) cls.push('is-lit')
  if (i === bar.n) cls.push('is-head')
  if (i === bar.n && track.rose) cls.push('is-ign')
  if (i > bar.n && i <= track.goneTop) cls.push('is-going')
  return cls.join(' ')
}

/**
 * The words the chip's label gains while anything is ahead; '' with nothing
 * ahead. The real count, past the stop too. With the sync limit off in
 * Settings (`limits` false, store/walkLimits.ts) there is no stop to name.
 */
export function aheadLabel(ahead: number, limits = true): string {
  const n = Number.isFinite(ahead) ? Math.max(0, Math.floor(ahead)) : 0
  return n === 0 ? '' : ` ${n} move${n === 1 ? '' : 's'} ahead of your chain. ${limits ? `The walk stops at ${FLUID_HOLD_AT}.` : 'The sync limit is off.'}`
}

/** What the chip draws for the walk being ahead. */
export interface ChainAhead {
  /** The marks are on the page: something is ahead, or the bar is still fading out. */
  drawn: boolean
  bar: AheadBar
  track: AheadTrack
  /** Classes for the chip's button, with a leading space; '' when nothing is drawn. */
  cls: string
  /** aheadLabel of the real count. */
  label: string
}

/**
 * The chain chip's ahead state. `own` is whether the chip is showing your
 * own chain at its head (not spectating, not in history); `total` is the
 * chain's length on the chip.
 *
 * It renders again only when the count, WALK, the sync limit or the props
 * change: the one number it subscribes to is a primitive, so a step that
 * does not change the count, a cursor move or a frame renders nothing. No
 * state is set during render: the track is derived from the last committed
 * one (kept in a ref, written after commit), and the linger after catching
 * up is a ref the commit sets and a timer clears.
 */
export function useChainAhead(own: boolean, total: number): ChainAhead {
  const walking = useCyberspace((s) => s.walking)
  const active = own && walking
  const events = useAheadSelect((n) => (active ? n : 0))
  const limits = useLayers((s) => s.walkLimits)
  const bar = aheadBar(events, limits)

  // The track: what the last change to the count played. Derived from the
  // last committed track, so a render that is not about the count (a new
  // face, the explorer opening) keeps the classes that play a change. A
  // chain that is not yours to walk (a spectated one, history) is not
  // followed: its length is no landing of yours.
  const committed = useRef<AheadTrack | null>(null)
  if (committed.current === null) committed.current = { ...AHEAD_TRACK_START, n: bar.n, total }
  const was = committed.current
  const track = own ? aheadStep(was, bar.n, total) : aheadStep(was, 0, was.total)
  useLayoutEffect(() => { committed.current = track })

  // On the page while ahead, and for the fade after catching up: set once
  // the bar has been on, cleared AHEAD_LINGER_MS after it goes off (a step
  // inside the wait starts it again).
  const shown = useRef(bar.on)
  const [, lingerOver] = useReducer((x: number) => x + 1, 0)
  useLayoutEffect(() => {
    if (bar.on) { shown.current = true; return }
    if (!shown.current) return
    const t = setTimeout(() => { shown.current = false; lingerOver() }, AHEAD_LINGER_MS)
    return () => clearTimeout(t)
  }, [bar.on])

  const drawn = own && (bar.on || shown.current)
  const cls = drawn ? ` has-ahead${bar.on ? ' is-ahead' : ''}${bar.slow ? ' is-slow' : ''}${bar.limit ? ' is-limit' : ''}` : ''
  return { drawn, bar, track, cls, label: aheadLabel(events, limits) }
}

/** The CHAIN chip's button: everything on it that the count changes, in a component of its own. */
export interface AheadChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'aria-label' | 'children'> {
  /** Your own chain, at its head, out of BUILD: the only chain the bar is drawn on. */
  own: boolean
  /** The button's own classes; the ahead classes are added after them. */
  className: string
  /** The button's label; the count is added after it, after `sep`. */
  label: string
  /** Put between the label and the count's words ('.' after a label with no full stop of its own). */
  sep?: string
  /** The chip's words. */
  words: string
}

/**
 * The CHAIN chip's button, on whichever face it has. The count is
 * subscribed to here and nowhere else in the chip, so a step renders this
 * button and its marks, not the chain explorer around it (its chain, its
 * key state, its comments and its body); and memoized, so a render of the
 * explorer for its own reasons (a clock, a comment count) does not render
 * the button.
 */
export const AheadChip = memo(function AheadChip({ own, className, label, sep = '', words, ...button }: AheadChipProps): JSX.Element {
  // The chain's length, to see a move land, read from the store here rather
  // than handed down: a landing changes it and the count in one store change,
  // and whichever of the two this renders for first, it sees both.
  const total = useCyberspace((s) => s.focusChain().length)
  const ahead = useChainAhead(own, total)
  return (
    <button className={`${className}${ahead.cls}`} aria-label={`${label}${ahead.label ? `${sep}${ahead.label}` : ''}`} {...button}>
      <AheadWords ahead={ahead} words={words} />
      <AheadMarks ahead={ahead} />
    </button>
  )
})

/**
 * The chip's words. With nothing drawn they are the bare words, as the chip
 * always had them. While the bar is drawn they sit above it, and a move
 * landing on the chain glints them white once: a white copy of the words
 * (in its data-words, drawn by the stylesheet, so the page's text is the
 * words once) laid over them and faded in and out, a new one per landing so
 * the glint plays again.
 */
export function AheadWords({ ahead, words }: { ahead: ChainAhead; words: string }): JSX.Element {
  if (!ahead.drawn) return <>{words}</>
  const landed = ahead.track.landed
  return (
    <>
      <span className="aheadtxt">{words}</span>
      {landed > 0 && <span key={landed} className="aheadglint is-glint" aria-hidden="true" data-words={words} />}
    </>
  )
}

/** The bar and the corner brackets, inside the chip's button; nothing with nothing drawn. */
export function AheadMarks({ ahead }: { ahead: ChainAhead }): JSX.Element | null {
  return ahead.drawn ? <AheadMarksDrawn bar={ahead.bar} track={ahead.track} /> : null
}

function AheadMarksDrawn({ bar, track }: { bar: AheadBar; track: AheadTrack }): JSX.Element {
  const gap = (BRACKET_NEAR + (BRACKET_FAR - BRACKET_NEAR) * (1 - bar.close)).toFixed(2)
  // Where the brackets were: the frame takes its new place at once and the
  // corners, new for each gap, play the move from there by transform.
  const was = useRef(gap)
  const from = useMemo(() => (Number(was.current) - Number(gap)).toFixed(2), [gap])
  useLayoutEffect(() => { was.current = gap }, [gap])
  const ticks: JSX.Element[] = []
  for (let i = 1; i <= AHEAD_TICKS; i++) ticks.push(<i key={i} className={tickClass(i, bar, track) || undefined} />)
  return (
    <>
      <span className="aheadbar" aria-hidden="true">{ticks}</span>
      <span className="aheadbrk" aria-hidden="true" style={{ '--ahead-gap': `${gap}px`, '--ahead-from': `${from}px` } as CSSProperties}>
        <i key={`a${gap}`} /><i key={`b${gap}`} /><i key={`c${gap}`} /><i key={`d${gap}`} />
      </span>
    </>
  )
}
