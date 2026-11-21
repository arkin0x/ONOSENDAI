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
 * Drawn after augmented-ui's corner regions, Halo's shield states (the
 * limit changes the frame, not just the fill) and FUI registration marks;
 * the research is in the design plan. All hand-written CSS.
 */

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { FLUID_HOLD_AT } from '../lib/fluidWalk'
import { useCyberspace } from '../store/useCyberspace'
import { SYNC_WARN_AT } from '../store/useWalk'
import { useEventsAhead } from '../store/walkAhead'
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
 */
export function useChainAhead(own: boolean, total: number): ChainAhead {
  const walking = useCyberspace((s) => s.walking)
  const events = useEventsAhead()
  const limits = useLayers((s) => s.walkLimits)
  const ahead = own && walking ? events : 0
  const bar = aheadBar(ahead, limits)

  // Derived from the last render's count, the sanctioned way: set during
  // render, so the classes that play a change stay put through renders
  // that are not about the count.
  // A chain that is not yours to walk (a spectated one, history) is not
  // followed: its length is no landing of yours.
  const [track, setTrack] = useState<AheadTrack>(() => ({ ...AHEAD_TRACK_START, n: bar.n, total }))
  const now = own ? aheadStep(track, bar.n, total) : aheadStep(track, 0, track.total)
  if (now !== track) setTrack(now)

  // On the page while ahead, and for the fade after catching up.
  const [lingering, setLingering] = useState(false)
  if (bar.on && !lingering) setLingering(true)
  useEffect(() => {
    if (bar.on || !lingering) return
    const t = setTimeout(() => setLingering(false), AHEAD_LINGER_MS)
    return () => clearTimeout(t)
  }, [bar.on, lingering])

  const drawn = own && (bar.on || lingering)
  const cls = drawn ? ` has-ahead${bar.on ? ' is-ahead' : ''}${bar.slow ? ' is-slow' : ''}${bar.limit ? ' is-limit' : ''}` : ''
  return { drawn, bar, track: now, cls, label: aheadLabel(ahead, limits) }
}

/**
 * The chip's words. With nothing drawn they are the bare words, as the chip
 * always had them. While the bar is drawn they sit above it, and a move
 * landing on the chain glints them white once: a new span per landing, so
 * the stylesheet's glint plays again.
 */
export function AheadWords({ ahead, children }: { ahead: ChainAhead; children: ReactNode }): JSX.Element {
  if (!ahead.drawn) return <>{children}</>
  const landed = ahead.track.landed
  return <span key={landed} className={landed > 0 ? 'aheadtxt is-glint' : 'aheadtxt'}>{children}</span>
}

/** The bar and the corner brackets, inside the chip's button; nothing with nothing drawn. */
export function AheadMarks({ ahead }: { ahead: ChainAhead }): JSX.Element | null {
  if (!ahead.drawn) return null
  const { bar, track } = ahead
  const gap = BRACKET_NEAR + (BRACKET_FAR - BRACKET_NEAR) * (1 - bar.close)
  const ticks: JSX.Element[] = []
  for (let i = 1; i <= AHEAD_TICKS; i++) ticks.push(<i key={i} className={tickClass(i, bar, track) || undefined} />)
  return (
    <>
      <span className="aheadbar" aria-hidden="true">{ticks}</span>
      <span className="aheadbrk" aria-hidden="true" style={{ '--ahead-gap': `${gap.toFixed(2)}px` } as CSSProperties} />
    </>
  )
}
