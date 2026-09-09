/**
 * WorldMessages.tsx — hidden messages, found and read.
 *
 * A discovered kind:1 renders as a billboarded note at its coordinate: the
 * text, and a short marker of who left it. Held to a constant pixel size like
 * every other world label, so a message stays readable at any zoom rather than
 * shrinking to nothing. Culled past the same reach as everything else.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { markSceneTapHandled } from '../hooks/useCanvasTap'
import { nip19 } from 'nostr-tools'
import { ACCENT } from '../lib/palette'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { BoxGeometry, EdgesGeometry, OctahedronGeometry, type Group, type PerspectiveCamera } from 'three'
import { decodeText, seedOf, TEXT_DECODE_MS } from '../lib/decode'
import { useCeremony } from '../store/useCeremony'
import { GRID_RADIUS, cellCentre, type ViewAxes } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { useShards } from '../store/useShards'
import { WorldLabel } from './WorldLabel'
import { findCashuToken, textWithoutToken } from '../lib/cashu'

const TAP_SLOP = 8

const REACH = GRID_RADIUS * 8
/** The message color: a warm note against the cool field. */
const NOTE = '#ffd27d'
/** Bitcoin's own orange, for a coin left in cyberspace. */
const BITCOIN = '#f7931a'
/** The note's own blue, for the cube a message hangs on. */
const NOTE_BLUE = '#4aa3ff'
/** How wide the mark behind an item stands, in CSS pixels. */
const MARK_PX = 34

interface Props {
  axes: ViewAxes
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
    return useShards.getState().worldItems()
      .filter((w) => w.type === 'message' && w.text && w.plane === anchorPlane)
      .map((w) => ({ key: w.key, text: w.text!, mine: w.mine, author: w.author ?? '', centre: cellCentre(w.at, origin, scaleExp, axes) }))
      .filter((w) => Math.hypot(...w.centre) <= REACH)
    // mine and discovered are what worldItems reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, anchorPlane, scaleExp, axes, mine, discovered])

  if (placed.length === 0) return null

  return (
    <>
      {placed.map((w) => {
        const open = (e: ThreeEvent<MouseEvent>): void => {
          if (e.delta > TAP_SLOP) return
          e.stopPropagation()
          markSceneTapHandled()
          useShards.getState().selectSecret(w.key)
        }
        // Money reads as money: a coin hidden here shows the mark and nothing
        // else, because its token is two thousand characters of base64 and
        // says nothing to anybody. Everything else shows what it says, cut.
        const coin = findCashuToken(w.text) !== null
        return (
          <group key={w.key}>
            <WorldMark kind={coin ? 'coin' : 'note'} at={w.centre} />
            {coin
              ? <>
                  <WorldLabel text="₿" color={BITCOIN} at={w.centre} align="center" px={26} />
                  {/* Words left around the token are the message; the base64 is not. */}
                  {textWithoutToken(w.text) && (
                    <WorldLabel text={messageBillboard(textWithoutToken(w.text))} color={NOTE} at={[w.centre[0], w.centre[1] - 0.55, w.centre[2]]} align="center" px={12} />
                  )}
                </>
              : births[w.key] !== undefined
                ? <DecodingLabel text={messageBillboard(w.text)} seed={seedOf(w.key)} birth={births[w.key]} at={w.centre} />
                : <WorldLabel text={messageBillboard(w.text)} color={NOTE} at={w.centre} align="center" px={13} />}
            <WorldLabel text={`— ${shortAuthor(w.author, w.mine)}`} color={ACCENT} at={[w.centre[0], w.centre[1] - 0.9, w.centre[2]]} align="center" px={9} opacity={0.7} />
            <mesh position={w.centre} onClick={open}>
              <sphereGeometry args={[1, 8, 8]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
          </group>
        )
      })}
    </>
  )
}

/**
 * A message that was just found: its characters resolve out of glyphs over
 * TEXT_DECODE_MS, each at its own moment, then it is an ordinary label.
 */
function DecodingLabel({ text, seed, birth, at }: { text: string; seed: number; birth: number; at: [number, number, number] }): JSX.Element {
  const [shown, setShown] = useState(() => decodeText(text, 0, seed, 0))
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


/**
 * The shape behind a hidden thing: a turning diamond for a coin, a still cube
 * for a message. Outlines rather than solids, so they read as drawn light like
 * everything else in the scene, and held to a constant size on screen so a
 * note is the same size to the eye wherever it is.
 */
function WorldMark({ kind, at }: { kind: 'coin' | 'note'; at: [number, number, number] }): JSX.Element {
  const group = useRef<Group>(null)
  const geometry = useMemo(
    () => new EdgesGeometry(kind === 'coin' ? new OctahedronGeometry(0.5) : new BoxGeometry(0.72, 0.72, 0.72)),
    [kind],
  )
  useEffect(() => () => geometry.dispose(), [geometry])

  useFrame((state) => {
    const g = group.current
    if (!g) return
    const cam = state.camera as PerspectiveCamera
    const perPixel = 2 * Math.tan((cam.fov * Math.PI) / 360) / state.size.height
    g.scale.setScalar(Math.max(1e-5, cam.position.distanceTo(g.position) * perPixel * MARK_PX))
    // The coin turns; a note stays where it was left.
    if (kind === 'coin') g.rotation.y = state.clock.elapsedTime * 0.6
  })

  return (
    <group ref={group} position={at}>
      <lineSegments geometry={geometry} frustumCulled={false}>
        <lineBasicMaterial color={kind === 'coin' ? BITCOIN : NOTE_BLUE} toneMapped={false} transparent opacity={kind === 'coin' ? 0.9 : 0.55} depthWrite={false} />
      </lineSegments>
    </group>
  )
}
