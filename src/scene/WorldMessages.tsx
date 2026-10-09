/**
 * WorldMessages.tsx — hidden messages, found and read.
 *
 * A discovered kind:1 renders as a billboarded note at its coordinate: the
 * text, and a short marker of who left it. Held to a constant pixel size like
 * every other world label, so a message stays readable at any zoom rather than
 * shrinking to nothing. Culled past the same reach as everything else.
 *
 * Placed with markerCentre, not cellCentre, and the difference is the whole of
 * a bug worth naming. GO TO IT focuses the camera on the item, and a plain
 * focus frames the CONTINUOUS point: cursorOffset returns the sub-cell
 * fraction minus a half above scaleExp 33, and [0, 0, 0] at or below it.
 * cellCentre snaps the item to its aligned cell, which is always [0, 0, 0]
 * when the anchor is the item. So above 33 the camera looked at the point
 * while the note was drawn at its cell, and the two sat up to half a cell
 * apart. The gap is a different slice of the coordinate's bits at every zoom,
 * so every step out threw the note somewhere else near the middle, and it only
 * came right at 33, where cursorOffset switches to [0, 0, 0] and the two
 * conventions finally agree (arkinox, 2026-09-16).
 *
 * The lesson holds and the policy has moved on: a hidden item is now drawn
 * at its true coordinate plus half a gibson at every zoom (itemCentre), so a
 * scene of many items keeps its layout as you zoom out, and an item focus
 * (focusItem) frames exactly that place, so the camera and the note still
 * agree at every zoom (arkinox, 2026-10-01).
 *
 * Not everything is drawn at every zoom. A coin the mint has not called
 * redeemed is money, and money shows from anywhere. A note, and a coin the
 * mint says is spent, are drawn at 2^1 and below only: zoomed out, a field of
 * notes was a field of clutter (arkinox, 2026-10-09), and the words were
 * always one tap away. The rule is markShown (lib/worldMarks). A spent coin
 * keeps its place as a still gray diamond, so a visitor sees that someone was
 * here and the coin is gone, rather than a coin.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { nip19 } from 'nostr-tools'
import { ACCENT } from '../lib/palette'
import { useFrame } from '@react-three/fiber'
import { BoxGeometry, EdgesGeometry, OctahedronGeometry, type Group, type PerspectiveCamera } from 'three'
import { decodeText, seedOf, TEXT_DECODE_MS } from '../lib/decode'
import { useCeremony } from '../store/useCeremony'
import { GRID_RADIUS, itemCentre, type ViewAxes } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { useShards } from '../store/useShards'
import { WorldLabel } from './WorldLabel'
import { findCashuToken } from '../lib/cashu'
import { coinKind, markShown, type MarkKind } from '../lib/worldMarks'
import { useCashu } from '../hud/useCashu'
import { TapTarget } from './TapTarget'

/** A message's tap target, in CSS pixels: a fingertip over the mark, at any zoom. */
const TAP_PX = 44

const REACH = GRID_RADIUS * 8
/** The message color: a warm note against the cool field. */
const NOTE = '#ffd27d'
/** Bitcoin's own orange, for a coin left in cyberspace. */
const BITCOIN = '#f7931a'
/** The note's own blue, for the cube a message hangs on. */
const NOTE_BLUE = '#4aa3ff'
/** Steel, for a coin that has been redeemed: the shape stays, the money is gone. */
const SPENT = '#7f8891'
/** How wide the mark behind an item stands, in CSS pixels. The coin is larger
 * than the note: it is a whole object in itself, where the cube is a backing.
 * It was 51 until 2026-10-09; smaller reads less like a billboard (arkinox). */
const MARK_PX = { coin: 40, spent: 40, note: 34 } as const
/** The ₿ on a coin, in CSS pixels. */
const COIN_PX = 31

interface Props {
  axes: ViewAxes
}

/**
 * The credit line under a hidden thing, carried by the label it belongs to
 * rather than placed near it. It used to be its own WorldLabel anchored three
 * quarters of a cell below the item, which meant the text held a constant
 * pixel size while the gap to it grew with camera depth: at a wide view the
 * credit ended up an inch from what it credited, with nothing to say which
 * item it belonged to (arkinox, 2026-09-14).
 */
function author(w: { author: string; mine: boolean }): string {
  return `— ${shortAuthor(w.author, w.mine)}`
}

function shortAuthor(pubkey: string, mine: boolean): string {
  if (mine) return 'you'
  try {
    const npub = nip19.npubEncode(pubkey)
    return `${npub.slice(0, 10)}…${npub.slice(-4)}`
  } catch {
    return pubkey.slice(0, 8)
  }
}

/** How much of a long message is shown in the world before the tap. */
const PREVIEW_CHARS = 160

/**
 * Wrap a message onto a few lines so the billboard is not one long strip.
 *
 * Breaking on spaces alone was not enough: a Cashu token is a single word two
 * thousand characters long, so it never broke, and the note became a band of
 * text across the whole screen. A run longer than the line is cut to fit, and
 * the whole thing is truncated: the whole message is one tap away.
 */
function wrap(text: string, width = 28): string {
  const lines: string[] = []
  let line = ''
  const push = (): void => { if (line) { lines.push(line); line = '' } }
  for (const word of text.trim().split(/\s+/)) {
    let rest = word
    // A word longer than the line is broken at the line, not left to run on.
    while (rest.length > width) {
      push()
      lines.push(rest.slice(0, width))
      rest = rest.slice(width)
    }
    if (!rest) continue
    if ((line + ' ' + rest).trim().length > width) push()
    line = (line + ' ' + rest).trim()
  }
  push()
  return lines.slice(0, 6).join('\n')
}

/** A message as it reads in the world: cut to PREVIEW_CHARS, then wrapped. */
export function messageBillboard(text: string): string {
  const trimmed = text.trim()
  const cut = trimmed.length > PREVIEW_CHARS ? `${trimmed.slice(0, PREVIEW_CHARS)}…` : trimmed
  return wrap(cut)
}

export function WorldMessages({ axes }: Props): JSX.Element | null {
  const anchor = useCyberspace((s) => s.anchor)
  const anchorPlane = useCyberspace((s) => s.anchorPlane)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const mine = useShards((s) => s.mine)
  const discovered = useShards((s) => s.discovered)
  const births = useCeremony((s) => s.births)

  const placed = useMemo(() => {
    const origin = alignedOrigin(anchor, scaleExp)
    // Notes are not drawn past MESSAGE_SCALE_MAX (markShown). Coins stay in
    // the list at every zoom: whether one is spent is the mint's word, which
    // CoinItem asks for, and a spent coin drops out there.
    const notesShown = markShown('note', scaleExp)
    return useShards.getState().worldItems()
      .filter((w) => w.type === 'message' && w.text && w.plane === anchorPlane)
      .map((w) => ({ key: w.key, text: w.text!, mine: w.mine, author: w.author ?? '', coin: findCashuToken(w.text!) !== null, centre: itemCentre(w.at, origin, scaleExp, axes) }))
      .filter((w) => (w.coin || notesShown) && Math.hypot(...w.centre) <= REACH)
    // mine and discovered are what worldItems reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, anchorPlane, scaleExp, axes, mine, discovered])

  if (placed.length === 0) return null

  return (
    <>
      {placed.map((w) => {
        const open = (): void => useShards.getState().selectSecret(w.key)
        if (w.coin) return <CoinItem key={w.key} text={w.text} at={w.centre} scaleExp={scaleExp} onTap={open} />
        return (
          <group key={w.key}>
            <WorldMark kind="note" at={w.centre} />
            {births[w.key] !== undefined
              ? <DecodingLabel text={messageBillboard(w.text)} seed={seedOf(w.key)} birth={births[w.key]} at={w.centre} />
              : <WorldLabel text={messageBillboard(w.text)} color={NOTE} at={w.centre} align="center" px={13} sub={author(w)} subColor={ACCENT} />}

            {/* The mark is a fixed size on screen at any zoom, so its target is
                too: a fingertip over the mark (TapTarget). */}
            <TapTarget px={TAP_PX} at={w.centre} onTap={open} />
          </group>
        )
      })}
    </>
  )
}

/**
 * A coin in the world: the diamond and the ₿, and nothing else. Its token is
 * two thousand characters of base64 that say nothing to anybody, and the
 * words someone leaves around one are usually about the coin rather than
 * worth reading at distance. They used to hang under the mark as a second
 * label, which in a field of coins was a field of paragraphs; the mark alone
 * is legible at any zoom and the words are one tap away, which is where the
 * rest of the message already lived (arkinox, 2026-09-16). The credit line
 * went the same way: "you" under your own coin said nothing the tap does not
 * (arkinox, 2026-09-24).
 *
 * Whether the coin is still there is the mint's word (useCashu: it asks once
 * when the coin mounts, from a cache the item's card, the STASH rows and the
 * compose box share, good for a minute; a token once called redeemed is
 * remembered on this device and never asked about again). Redeemed, it
 * turns gray and stops turning, and past 2^1 it is not drawn at all. Until
 * the mint answers, or when it cannot be reached, the coin is drawn as a
 * coin: nobody has said it is gone.
 */
function CoinItem({ text, at, scaleExp, onTap }: { text: string; at: [number, number, number]; scaleExp: number; onTap: () => void }): JSX.Element | null {
  const { state } = useCashu(text)
  const kind = coinKind(state)
  if (!markShown(kind, scaleExp)) return null
  const spent = kind === 'spent'
  return (
    <group>
      <WorldMark kind={kind} at={at} />
      <WorldLabel text="₿" color={spent ? SPENT : BITCOIN} opacity={spent ? 0.7 : 1} at={at} align="center" px={COIN_PX} />
      <TapTarget px={TAP_PX} at={at} onTap={onTap} />
    </group>
  )
}

/**
 * A message that was just found: its characters resolve out of glyphs over
 * TEXT_DECODE_MS, each at its own moment, then it is an ordinary label.
 */
function DecodingLabel({ text, seed, birth, at }: { text: string; seed: number; birth: number; at: [number, number, number] }): JSX.Element {
  // Start from where the ceremony really is: a note found while zoomed out
  // past where notes are drawn is first mounted later, and should read as
  // text at once rather than show a frame of glyphs.
  const [shown, setShown] = useState(() => decodeText(text, (performance.now() - birth) / TEXT_DECODE_MS, seed, 0))
  const frame = useRef(0)
  const last = useRef(0)
  const done = useRef(false)
  useFrame(() => {
    if (done.current) return
    const now = performance.now()
    if (now - last.current < 40) return
    last.current = now
    frame.current++
    const t = (now - birth) / TEXT_DECODE_MS
    setShown(decodeText(text, t, seed, frame.current))
    if (t >= 1) done.current = true
  })
  return <WorldLabel text={shown} color={NOTE} at={at} align="center" px={13} />
}


/** The line color and opacity of each mark. A spent coin is steel and faint. */
const MARK_LOOK: Record<MarkKind, { color: string; opacity: number }> = {
  coin: { color: BITCOIN, opacity: 0.9 },
  spent: { color: SPENT, opacity: 0.6 },
  note: { color: NOTE_BLUE, opacity: 0.55 },
}

/**
 * The shape behind a hidden thing: a turning diamond for a coin, the same
 * diamond still and gray once the mint says the coin was redeemed, a still
 * cube for a message. Outlines rather than solids, so they read as drawn light
 * like everything else in the scene, and held to a constant size on screen so
 * a note is the same size to the eye wherever it is.
 */
function WorldMark({ kind, at }: { kind: MarkKind; at: [number, number, number] }): JSX.Element {
  const group = useRef<Group>(null)
  const geometry = useMemo(
    () => new EdgesGeometry(kind === 'note' ? new BoxGeometry(0.72, 0.72, 0.72) : new OctahedronGeometry(0.5)),
    [kind],
  )
  useEffect(() => () => geometry.dispose(), [geometry])

  useFrame((state) => {
    const g = group.current
    if (!g) return
    const cam = state.camera as PerspectiveCamera
    const perPixel = 2 * Math.tan((cam.fov * Math.PI) / 360) / state.size.height
    g.scale.setScalar(Math.max(1e-5, cam.position.distanceTo(g.position) * perPixel * MARK_PX[kind]))
    // A live coin turns; a note, and a spent coin, stay where they were left.
    // Two axes at speeds that do not divide evenly, so the diamond tumbles
    // slowly instead of spinning on a spit, the way a selected hyperjump does
    // (StopCubes). A coin that the mint calls redeemed while it is on screen
    // snaps to rest upright: the kind changes, the group is remounted by its
    // key below, and a fresh group has no rotation.
    if (kind === 'coin') {
      g.rotation.y = state.clock.elapsedTime * 0.6
      g.rotation.z = state.clock.elapsedTime * 0.41
    }
  })

  const look = MARK_LOOK[kind]
  return (
    <group key={kind} ref={group} position={at}>
      <lineSegments geometry={geometry} frustumCulled={false}>
        <lineBasicMaterial color={look.color} toneMapped={false} transparent opacity={look.opacity} depthWrite={false} />
      </lineSegments>
    </group>
  )
}
