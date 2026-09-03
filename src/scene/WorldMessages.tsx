/**
 * WorldMessages.tsx — hidden messages, found and read.
 *
 * A discovered kind:1 renders as a billboarded note at its coordinate: the
 * text, and a short marker of who left it. Held to a constant pixel size like
 * every other world label, so a message stays readable at any zoom rather than
 * shrinking to nothing. Culled past the same reach as everything else.
 */

import { useMemo, useRef, useState } from 'react'
import { markSceneTapHandled } from '../hooks/useCanvasTap'
import { nip19 } from 'nostr-tools'
import { ACCENT } from '../lib/palette'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { decodeText, seedOf, TEXT_DECODE_MS } from '../lib/decode'
import { useCeremony } from '../store/useCeremony'
import { GRID_RADIUS, cellCentre, type ViewAxes } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { useShards } from '../store/useShards'
import { WorldLabel } from './WorldLabel'

const TAP_SLOP = 8

const REACH = GRID_RADIUS * 8
/** The message color: a warm note against the cool field. */
const NOTE = '#ffd27d'

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

/** Wrap a long message onto a few lines so the billboard is not one long strip. */
function wrap(text: string, width = 28): string {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    if ((line + ' ' + w).trim().length > width) { if (line) lines.push(line); line = w } else line = (line + ' ' + w).trim()
  }
  if (line) lines.push(line)
  return lines.slice(0, 8).join('\n')
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
        return (
          <group key={w.key}>
            {births[w.key] !== undefined
              ? <DecodingLabel text={wrap(w.text)} seed={seedOf(w.key)} birth={births[w.key]} at={w.centre} />
              : <WorldLabel text={wrap(w.text)} color={NOTE} at={w.centre} align="center" px={13} />}
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
