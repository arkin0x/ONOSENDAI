/**
 * WorldMessages.tsx — hidden messages, found and read.
 *
 * A discovered kind:1 renders as a billboarded note at its coordinate: the
 * text, and a short marker of who left it. Sized on screen like every other
 * world label, so a message stays readable at any zoom rather than shrinking
 * to nothing. Past the headlamp's reach a mark recedes with depth to a
 * floor (lib/markerSize.ts recedeShare), so a chest at the far end of a hall
 * in WALK is smaller than one at your feet (arkinox, 2026-10-25), and its
 * words keep their size and fade out further on, the credit line first
 * (fadeShare). Culled past the same reach as everything else.
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
 *
 * Hidden audio (DECK-0007) is a small music note on the note's blue box
 * (arkinox, 2026-10-23), drawn when notes are; a tap opens its card, with
 * PLAY and DOWNLOAD. Its name is on that card, not floating in the world
 * (FLOATING_NAME).
 *
 * An item this identity holds is drawn at half: its model at half opacity, in
 * motion as ever, and, for one you made yourself, the note's blue box round
 * it at half too, the model's own box (2026-11-08); one taken from someone
 * else has no box (arkinox, 2026-11-06, which replaces the solid box of
 * 2026-11-01; lib/worldMarks
 * itemDrawAs, HeldItemMark). Its tap still opens its card. TAKE fades the
 * whole model out over it (scene/ItemVanish).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { nip19 } from 'nostr-tools'
import { ACCENT } from '../lib/palette'
import { useFrame } from '@react-three/fiber'
import { BoxGeometry, CircleGeometry, EdgesGeometry, OctahedronGeometry, PlaneGeometry, Vector3, type Group, type LineSegments, type Material, type Mesh, type PerspectiveCamera } from 'three'
import { decodeText, seedOf, TEXT_DECODE_MS } from '../lib/decode'
import { useCeremony } from '../store/useCeremony'
import { useInventory } from '../store/useInventory'
import { useTakeVanish, type Vanishing } from '../store/useOpenCeremony'
import { vanishOpacity } from '../lib/ceremony'
import { openedKey } from '../store/useOpenedChests'
import { GRID_RADIUS, itemCentre, type ViewAxes } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { itemMovingId, useShards } from '../store/useShards'
import { heldLineages, holdsItem, unarchived } from '../lib/inventory'
import { LABEL_PRIORITY, WorldLabel } from './WorldLabel'
import { findCashuToken } from '../lib/cashu'
import { NFT_WORDS, replaceNftLinks } from '../lib/nftLink'
import { useProfile } from '../hooks/useProfile'
import { profileLabel } from '../store/useProfiles'
import { coinKind, HELD_OPACITY, heldBox, itemDrawAs, madeBy, markShown, type MarkKind } from '../lib/worldMarks'
import { useCashu } from '../hud/useCashu'
import { TapTarget } from './TapTarget'
import { regionBox, type Box } from '../lib/clip'
import { useItemModel } from '../hooks/useItemModel'
import type { ItemAnimation, ItemModelRef } from '../lib/itemModel'
import { ItemModelMark } from './ItemModel'
import { ItemVanish } from './ItemVanish'
import { useMutes } from '../store/useMutes'
import { MARK_RECEDE_FLOOR, recedeShare } from '../lib/markerSize'
import { headlampUniforms } from './headlamp'
import { basicFaceProps, TRANSLUCENT_ORDER } from './shardFaces'

/** A message's tap target, in CSS pixels: a fingertip over the mark, at any zoom. */
const TAP_PX = 44

const REACH = GRID_RADIUS * 8
/** The message color: a warm note against the cool field. */
export const NOTE = '#ffd27d'
/** Bitcoin's own orange, for a coin left in cyberspace. */
const BITCOIN = '#f7931a'
/** How strongly an item being moved is drawn where it stood: its box, faint. */
export const MOVING_OPACITY = 0.35

/** The note's own blue, for the cube a message hangs on. */
const NOTE_BLUE = '#4aa3ff'
/** Steel, for a coin that has been redeemed: the shape stays, the money is gone. */
const SPENT = '#7f8891'
/** How wide the mark behind an item stands, in CSS pixels. The coin is larger
 * than the note: it is a whole object in itself, where the cube is a backing.
 * It was 51 until 2026-10-09; smaller reads less like a billboard (arkinox). */
const MARK_PX = { coin: 40, spent: 40, note: 34 } as const
/** The note's cube's edge (0.72 of its mark), CSS pixels: the smallest an item's model box is drawn (ItemModel). */
export const NOTE_EDGE_PX = 0.72 * MARK_PX.note
/** The ₿ on a coin, in CSS pixels. */
const COIN_PX = 31
/** The note's own color: the box's blue, lit. */
const AUDIO_BLUE = '#9fd0ff'

/** What carries its name floating in the world, by what it is. */
export type NamedKind = 'item' | 'chest' | 'door' | 'sound'

/**
 * Whether a placed thing's name floats beside it in the world. A door, a
 * chest and a sound do not: the name is on its card, one tap away (arkinox,
 * 2026-11-02). An item keeps its name until the owner decides otherwise.
 * Messages, coins and shards are not in this list and are unchanged.
 */
export const FLOATING_NAME: Readonly<Record<NamedKind, boolean>> = { item: true, chest: false, door: false, sound: false }

/**
 * A mark's share of its full size at `depth` from the camera: full out to
 * the headlamp's reach, smaller past it (lib/markerSize.ts recedeShare).
 * Its words keep their size and fade far off instead (WorldLabel `recede`),
 * the coin's glyph shrinks with it, and its tap target stays a fingertip.
 * Marks size themselves when labels do (LABEL_PRIORITY), after the headlamp
 * has read this frame's camera, so a cut never draws a mark a frame behind.
 */
function markRecede(depth: number): number {
  return recedeShare(depth, headlampUniforms.uHeadlampReach.value, MARK_RECEDE_FLOOR)
}

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
export function author(w: { author: string; mine: boolean }): string {
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
  // A claim link's key is what claims it, so the scene never draws it (lib/nftLink).
  const trimmed = replaceNftLinks(text, NFT_WORDS).trim()
  const cut = trimmed.length > PREVIEW_CHARS ? `${trimmed.slice(0, PREVIEW_CHARS)}…` : trimmed
  return wrap(cut)
}

export function WorldMessages({ axes }: Props): JSX.Element | null {
  const anchor = useCyberspace((s) => s.anchor)
  const anchorPlane = useCyberspace((s) => s.anchorPlane)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const mine = useShards((s) => s.mine)
  const discovered = useShards((s) => s.discovered)
  // The tour's district shows only its curators' things (DemoScene.curated).
  const curated = useShards((s) => s.curated)
  // A block or a mute hides what it names (store/useMutes).
  const muted = useMutes((s) => s.muted)
  const births = useCeremony((s) => s.births)
  const me = useCyberspace((s) => s.identity.pubkey)
  // What is filed away under ARCHIVED is not drawn as held (arkinox, 2026-11-06).
  const held = useUnarchived()
  // A key its hider moved is the same item under a new id: held by its lineage too (lib/inventory.ts holdsItem).
  const heldLin = useMemo(() => heldLineages(held), [held])
  // MOVE (useShards startMoveItem): the original stays where it stands, as
  // its faint box and not tappable, while the ghost is aimed; it goes once
  // the new one is out.
  const moving = useShards((s) => itemMovingId(s.pending))
  // Whose ITEMS these are, and whether read: until then nothing held is shown by mistake.
  const itemsRead = useInventory((s) => s.owner === me && s.storage !== 'loading')
  const vanishing = useTakeVanish((s) => s.playing)

  const placed = useMemo(() => {
    const origin = alignedOrigin(anchor, scaleExp)
    // Notes are not drawn past MESSAGE_SCALE_MAX (markShown). Coins stay in
    // the list at every zoom: whether one is spent is the mint's word, which
    // CoinItem asks for, and a spent coin drops out there.
    const notesShown = markShown('note', scaleExp)
    // A key is drawn as a note is: a cube and a short label with the item's
    // name, so VIEW and GO TO IT have something to arrive at. What it is and
    // what it opens is in the lists (ItemRows), one tap away. A chest or a
    // door is drawn as the look it wears (ChestLooks), at the same zooms.
    return useShards.getState().drawnItems()
      .filter((w) => ((w.type === 'message' && w.text) || w.type === 'key' || (w.type === 'audio' && w.audio)) && w.plane === anchorPlane)
      .map((w) => ({
        key: w.key,
        type: w.type,
        lineage: w.lineage,
        // Who wrote the item, whose versions alone share its lineage (lib/inventory.ts lineageKey).
        itemAuthor: w.event?.pubkey ?? w.author,
        // A key's keypair: every instance of a key held is held (lib/inventory.ts keypairKey).
        keypair: w.type === 'key' ? w.keyItem?.itemPubkey : undefined,
        // The SNO a key wears, and its region's walls about it (ItemModel).
        wears: w.type === 'key' && w.keyItem?.model ? { model: w.keyItem.model, animation: w.keyItem.animation ?? NO_MOTION } : undefined,
        region: w.type === 'key' && w.keyItem?.model ? regionBox(w.at, w.height, 0, axes) : null,
        text: w.type === 'message' ? w.text! : w.type === 'audio' ? w.audio!.title : itemMarkText(w),
        mine: w.mine,
        author: w.author ?? '',
        coin: w.type === 'message' && findCashuToken(w.text!) !== null,
        centre: itemCentre(w.at, origin, scaleExp, axes),
      }))
      .filter((w) => (w.coin || notesShown) && Math.hypot(...w.centre) <= REACH)
    // mine and discovered are what worldItems reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, anchorPlane, scaleExp, axes, mine, discovered, curated, muted])

  if (placed.length === 0) return null

  return (
    <>
      {placed.map((w) => {
        const open = (): void => useShards.getState().selectSecret(w.key)
        if (w.key === moving) return <PlacedBox key={w.key} at={w.centre} opacity={MOVING_OPACITY} />
        if (w.coin) return <CoinItem key={w.key} text={w.text} at={w.centre} scaleExp={scaleExp} onTap={open} />
        if (w.type === 'message') return <NoteItem key={w.key} w={w} birth={births[w.key]} onTap={open} />
        if (w.type === 'audio') return <AudioMark key={w.key} title={w.text} at={w.centre} onTap={open} />
        // A key: the cube and its short name, or at half while it is held.
        const play = vanishing[openedKey(me, w.key)]
        const draw = itemDrawAs(holdsItem(held, w.key, w.lineage, w.itemAuthor, heldLin, w.keypair), itemsRead, madeBy(w.itemAuthor, me))
        return (
          <group key={w.key}>
            {draw === 'item'
              ? <ItemMark id={w.key} text={w.text} sub={author(w)} at={w.centre} wears={w.wears} region={w.region} axes={axes} onTap={open} />
              : <HeldItemMark id={w.key} own={draw === 'own'} at={w.centre} wears={w.wears} region={w.region} axes={axes} appear={play} />}
            {draw !== 'item' && play && <ItemVanish id={w.key} label={{ text: w.text, color: NOTE, sub: author(w), subColor: ACCENT }} at={w.centre} wears={w.wears} region={w.region} axes={axes} minPx={NOTE_EDGE_PX} play={play} clear={{ trueSide: placedBoxSide(scaleExp), minPx: 0 }} />}
            {/* The mark is a fixed size on screen at any zoom, so its target is
                too: a fingertip over the mark (TapTarget). */}
            <TapTarget px={TAP_PX} at={w.centre} onTap={open} />
          </group>
        )
      })}
    </>
  )
}

/** What a key or a chest is called in the world: its glyph and its name. */
export function itemMarkText(w: { type: string; keyItem?: { name?: string }; chest?: { name?: string } }): string {
  return w.type === 'key' ? `⚷ ${w.keyItem?.name ?? 'key'}` : `▣ ${w.chest?.name ?? 'chest'}`
}

/** The SNO a key wears and how it moves (lib/itemModel.ts). */
export interface ItemWears { model: ItemModelRef; animation: readonly ItemAnimation[] }

/**
 * What an item's mark draws: its model once it is in hand (and the view's
 * axes are known), else the note's cube, as every item was drawn before
 * (arkinox, 2026-10-21: the cube while a model loads, and if it fails).
 */
export function itemMarkShape(model: unknown, axes: ViewAxes | undefined): 'model' | 'cube' {
  return model && axes ? 'model' : 'cube'
}

/** No motion: one array, so a key with a model and no `animate` tag keeps one identity across renders. */
const NO_MOTION: readonly ItemAnimation[] = []

/**
 * A key's or a chest's mark: the note's cube, its short name, and under it
 * who left it. Cyberspace TV's fade (TvFinds). A key that wears a SNO is
 * drawn as that model in its blue box instead of the cube (ItemModel), once
 * the model is in hand; while it loads, and if it never does, the cube.
 */
export function ItemMark({ id, text, sub, at, opacity = 1, wears, region = null, axes, onTap }: {
  id?: string
  text: string
  sub: string
  at: [number, number, number]
  opacity?: number
  wears?: ItemWears
  /** The region's walls about the item, gibsons, render frame (regionBox at unit 0). */
  region?: Box | null
  axes?: ViewAxes
  onTap?: () => void
}): JSX.Element {
  const model = useItemModel(wears?.model)
  // A model's faces would hide a label at its middle, so its label stands
  // just above its box instead (ItemModelMark `label`); the cube's is
  // drawn through, as before.
  const label = { text, color: NOTE, sub, subColor: ACCENT }
  if (model && axes && itemMarkShape(model, axes) === 'model') {
    return <ItemModelMark id={id ?? text} model={model} animation={wears?.animation ?? NO_MOTION} at={at} region={region} axes={axes} minPx={NOTE_EDGE_PX} opacity={opacity} onTap={onTap} label={FLOATING_NAME.item ? label : undefined} />
  }
  return (
    <>
      <WorldMark kind="note" at={at} opacity={opacity} />
      {FLOATING_NAME.item && <WorldLabel text={label.text} color={label.color} at={at} align="center" px={13} sub={label.sub} subColor={label.subColor} opacity={opacity} recede="name" />}
    </>
  )
}

/**
 * A held item (arkinox, 2026-11-06): its model at HELD_OPACITY, in motion
 * as ever, with no name and no outline of its own. One you made yourself
 * (`own`) stands in the note's blue box at the same half, and the box is the
 * model's own: the size the placement preview draws, holding the model
 * through its whole motion and cut at its region's walls, in the model's
 * frame (arkinox, 2026-11-08: "i wanted the box on an item to encompass the
 * item like shown in the item placement preview"). One taken from someone
 * else has no box. While its model loads, and when there is none, the fixed
 * box at half alone marks the place, for a taken item too, so the spot is
 * never empty (lib/worldMarks heldBox). Under TAKE (`appear`) the box fades
 * in to its half.
 */
export function HeldItemMark({ id, own, at, wears, region = null, axes, appear }: {
  id: string
  own: boolean
  at: [number, number, number]
  wears?: ItemWears
  region?: Box | null
  axes: ViewAxes
  appear?: Vanishing
}): JSX.Element {
  const model = useItemModel(wears?.model)
  const drawn = itemMarkShape(model, axes) === 'model'
  const box = heldBox(own, drawn)
  return (
    <>
      {box === 'placed' && <PlacedBox at={at} opacity={HELD_OPACITY} appear={appear} />}
      {model && drawn && <ItemModelMark id={id} model={model} animation={wears?.animation ?? NO_MOTION} at={at} region={region} axes={axes} minPx={NOTE_EDGE_PX} held={HELD_OPACITY} encompass={box === 'model' ? (s) => <PlacedBox at={s.centre} size={s.size} opacity={HELD_OPACITY} appear={appear} /> : undefined} />}
    </>
  )
}

/** How long a found message's words stay once they have resolved, before the cube and the name are all that is left. */
const FLOURISH_HOLD_MS = 2600

/**
 * A message in the world: the cube and the hider's name under it, and nothing
 * else; the words are one tap away in the item modal (arkinox, 2026-10-10,
 * decision B: the full-text billboards piled up on each other and over
 * everything near them, and were unreadable at distance anyway). A message
 * just found keeps its flourish: the words resolve out of glyphs
 * (DecodingLabel), hold for a moment, then give way to the cube and the name.
 * The name is the profile's where one is known, "you" for your own.
 */
function NoteItem({ w, birth, onTap }: { w: { key: string; text: string; mine: boolean; author: string; centre: [number, number, number] }; birth: number | undefined; onTap: () => void }): JSX.Element {
  const profile = useProfile(w.author || null)
  const until = birth === undefined ? 0 : birth + TEXT_DECODE_MS + FLOURISH_HOLD_MS
  const [flourish, setFlourish] = useState(() => performance.now() < until)
  useEffect(() => {
    if (!flourish) return
    const t = window.setTimeout(() => setFlourish(false), Math.max(0, until - performance.now()))
    return () => window.clearTimeout(t)
  }, [flourish, until])
  const name = w.mine ? 'you' : profileLabel(profile, shortAuthor(w.author, false))
  return (
    <group>
      <WorldMark kind="note" at={w.centre} />
      {flourish && birth !== undefined
        ? <DecodingLabel text={messageBillboard(w.text)} seed={seedOf(w.key)} birth={birth} at={w.centre} />
        : <WorldLabel text={name} color={ACCENT} at={w.centre} align="center" px={10} offsetPx={[0, -26]} recede="credit" />}
      {/* The mark is a fixed size on screen at any zoom, so its target is
          too: a fingertip over the mark (TapTarget). */}
      <TapTarget px={TAP_PX} at={w.centre} onTap={onTap} />
    </group>
  )
}

/**
 * Hidden audio in the world: the note's blue box with a music note on it.
 * Its name is on its card, not beside it (FLOATING_NAME).
 */
export function AudioMark({ title, at, opacity = 1, onTap }: { title: string; at: [number, number, number]; opacity?: number; onTap?: () => void }): JSX.Element {
  return (
    <group>
      <PlacedBox at={at} opacity={opacity} />
      <AudioNote at={at} opacity={opacity} />
      {FLOATING_NAME.sound && <WorldLabel text={title} color={ACCENT} at={at} align="center" px={10} offsetPx={[0, -26]} opacity={opacity} recede="name" />}
      {onTap && <TapTarget px={TAP_PX} at={at} onTap={onTap} />}
    </group>
  )
}

/**
 * How far the music note stands in front of the box's centre, toward the
 * camera, in the box's own units (its edge is 1): just past half its
 * diagonal, so the opaque box never hides it from any side.
 */
export const NOTE_STANDOFF = (Math.sqrt(3) / 2) * 1.02

/**
 * The music note on the box: a tilted oval head, a stem and a flag, flat
 * shapes turned to face the camera. Shapes, not a character: the scene's
 * font has no music note, and troika would fetch a fallback font for one.
 * Held to the box's size on screen (in the
 * box's own units its edge is 0.72, so the note stands about half of it).
 * The box is opaque, so the note stands just outside it on the camera's
 * side (NOTE_STANDOFF) and, like the box, is out of the bloom.
 */
function AudioNote({ at, opacity = 1 }: { at: [number, number, number]; opacity?: number }): JSX.Element {
  const group = useRef<Group>(null)
  const toward = useMemo(() => new Vector3(), [])
  const parts = useMemo(() => ({
    head: new CircleGeometry(0.095, 20),
    stem: new PlaneGeometry(0.035, 0.36),
    flag: new PlaneGeometry(0.035, 0.16),
  }), [])
  useEffect(() => () => { parts.head.dispose(); parts.stem.dispose(); parts.flag.dispose() }, [parts])
  useFrame((state) => {
    const g = group.current
    if (!g) return
    const cam = state.camera as PerspectiveCamera
    // The box's own size, so the note stands about half of it at any zoom.
    const side = placedBoxSide(useCyberspace.getState().scaleExp)
    g.scale.setScalar(side / NOTE_BOX_EDGE)
    g.quaternion.copy(cam.quaternion)
    // In front of the box, toward the camera, by NOTE_STANDOFF of its side.
    g.position.set(at[0], at[1], at[2])
    toward.copy(cam.position).sub(g.position)
    if (toward.lengthSq() > 0) g.position.addScaledVector(toward.normalize(), side * NOTE_STANDOFF)
  }, LABEL_PRIORITY)
  const material = <meshBasicMaterial color={AUDIO_BLUE} toneMapped={false} {...basicFaceProps(opacity, { ghost: false, world: true })} />
  return (
    <group ref={group} position={at}>
      <mesh geometry={parts.head} position={[-0.06, -0.15, 0]} rotation={[0, 0, 0.45]} scale={[1.35, 1, 1]} frustumCulled={false}>{material}</mesh>
      <mesh geometry={parts.stem} position={[0.05, 0.02, 0]} frustumCulled={false}>{material}</mesh>
      <mesh geometry={parts.flag} position={[0.11, 0.14, 0]} rotation={[0, 0, 0.9]} frustumCulled={false}>{material}</mesh>
    </group>
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
      <WorldLabel text="₿" color={spent ? SPENT : BITCOIN} opacity={spent ? 0.7 : 1} at={at} align="center" px={COIN_PX} recede="mark" />
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
  return <WorldLabel text={shown} color={NOTE} at={at} align="center" px={13} recede="name" />
}


/** A held item's and a sound's box: half a gibson, wherever you look from (owner, 2026-11-01). */
const PLACED_BOX_GIBSONS = 0.5
/** The edge the music note was drawn against, in its own units. */
const NOTE_BOX_EDGE = 0.72
/** The box's side in scene units: a scene unit is 2^scaleExp gibsons. */
export function placedBoxSide(scaleExp: number): number {
  return PLACED_BOX_GIBSONS / 2 ** scaleExp
}
const PLACED_BOX_FILL = new BoxGeometry(1, 1, 1)
const PLACED_BOX_EDGES = new EdgesGeometry(PLACED_BOX_FILL)

/** The box's faces: the note's blue, darker, so its bright edges read on them. */
const PLACED_BOX_FACE = '#24527f'

/**
 * How the box's faces and edges are drawn: as a shard's opaque faces in the
 * world are (shardFaces basicFaceProps), and both for the same two reasons
 * (arkinox, 2026-11-01: a white cube, seen only from some angles).
 *
 *  - Out of the bloom. A face written with ordinary blending puts its own
 *    alpha over whatever is behind it, which takes the tag off a room's face
 *    there, and the bloom then adds up that whole bright face: the box
 *    turned white in front of a pale room. Written with the tag (colour
 *    opaque, alpha 0, TAG_BLEND), the faces show their own blue and the room
 *    behind keeps its tag. The edges take the tag too, so they draw as blue
 *    lines rather than glowing white across a box this size.
 *  - Opaque, so it writes depth. A see-through box writes none, and every
 *    shard face is in three's transparent list sorted by its object's centre:
 *    a room whose centre sorted nearer was drawn after the box and painted
 *    over it, which turned with the view. Writing depth, the box hides what
 *    is behind it and is hidden only by what is in front, from any side.
 *
 * Under 1 (a held item's box at half, a box being moved) it takes the
 * see-through face's blend instead, which keeps the tag under it.
 */
export function placedBoxProps(opacity: number): Record<string, unknown> {
  return basicFaceProps(opacity, { ghost: false, world: true })
}

/**
 * How much of the box shows `elapsed` ms into TAKE: none, up to all of it,
 * as the item fades out over it (ItemVanish, lib/ceremony vanishOpacity).
 */
export function boxAppearOpacity(elapsed: number, calm: boolean): number {
  return 1 - vanishOpacity(elapsed, calm)
}

/** The two looks a box appearing under TAKE moves between: see-through with no depth, then solid. */
const BOX_SEE_THROUGH = placedBoxProps(0.5)
const BOX_SOLID = { ...placedBoxProps(1), depthWrite: true }

/**
 * A box's material and draw order at `opacity` while it appears: below 1 the
 * see-through face's blend, no depth written and drawn after opaque faces
 * (TRANSLUCENT_ORDER), so the item fading out inside it and its name stay in
 * sight; at 1 exactly the solid, tagged box it then stays. Nothing allocated.
 */
export function setBoxLook(material: Material, object: { renderOrder: number }, opacity: number): void {
  const solid = opacity >= 1
  Object.assign(material, solid ? BOX_SOLID : BOX_SEE_THROUGH)
  material.opacity = solid ? 1 : Math.max(0, opacity)
  material.depthWrite = solid
  object.renderOrder = solid ? 0 : TRANSLUCENT_ORDER
}

/**
 * Where a sound stands, and round an item you made and hold while its model
 * loads or when it has none: a blue box of a fixed size in the world. It is not sized to the screen, so it reads as a
 * thing in the place. A sound's is solid, so it is the same blue box from
 * every side (placedBoxProps); a held item's is at half (HeldItemMark), so
 * its model shows inside it, and draws after the opaque faces. The
 * faces sit a hair behind their edges (polygonOffset), so the edges always
 * draw over them.
 *
 * Under TAKE (`appear`) it fades in up to its `opacity` as the item fades
 * out, see-through and writing no depth until it is solid (setBoxLook).
 *
 * With a `size` it is that size in its parent's frame instead of the fixed
 * side: a held item you made has its model's own box, the one the placement
 * preview draws (HeldItemMark, ItemModel `encompass`; arkinox, 2026-11-08).
 */
export function PlacedBox({ at, opacity = 1, appear, size }: { at: [number, number, number]; opacity?: number; appear?: Vanishing; size?: [number, number, number] }): JSX.Element {
  const fixed = placedBoxSide(useCyberspace((s) => s.scaleExp))
  const side = size ?? fixed
  const fill = useRef<Mesh>(null)
  const edges = useRef<LineSegments>(null)
  useFrame(() => {
    if (!appear) return
    const o = boxAppearOpacity(performance.now() - appear.at, appear.calm) * opacity
    if (fill.current) setBoxLook(fill.current.material as Material, fill.current, o)
    if (edges.current) setBoxLook(edges.current.material as Material, edges.current, o)
  })
  // While it appears, its first frame is drawn as it starts: not there yet.
  const start = appear ? Math.min(opacity, boxAppearOpacity(performance.now() - appear.at, appear.calm) * opacity) : opacity
  // See-through, it writes no depth, so it draws after the opaque faces: at
  // order 0 a room sorted nearer would paint over it (setBoxLook).
  const order = start < 1 ? TRANSLUCENT_ORDER : 0
  return (
    <group position={at} scale={side}>
      <mesh ref={fill} geometry={PLACED_BOX_FILL} renderOrder={order}>
        <meshBasicMaterial color={PLACED_BOX_FACE} toneMapped={false} {...placedBoxProps(start)} polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1} />
      </mesh>
      <lineSegments ref={edges} geometry={PLACED_BOX_EDGES} frustumCulled={false} renderOrder={order}>
        <lineBasicMaterial color={NOTE_BLUE} toneMapped={false} {...placedBoxProps(start)} />
      </lineSegments>
    </group>
  )
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
 * like everything else in the scene, and sized on screen: the same size to
 * the eye anywhere within the headlamp's reach, smaller past it (markRecede).
 */
function WorldMark({ kind, at, opacity = 1 }: { kind: MarkKind; at: [number, number, number]; opacity?: number }): JSX.Element {
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
    const depth = cam.position.distanceTo(g.position)
    g.scale.setScalar(Math.max(1e-5, depth * perPixel * MARK_PX[kind] * markRecede(depth)))
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
  }, LABEL_PRIORITY)

  const look = MARK_LOOK[kind]
  return (
    <group key={kind} ref={group} position={at}>
      <lineSegments geometry={geometry} frustumCulled={false}>
        <lineBasicMaterial color={look.color} toneMapped={false} transparent opacity={look.opacity * opacity} depthWrite={false} />
      </lineSegments>
    </group>
  )
}

/** ITEMS without what is filed away under ARCHIVED, one object while ITEMS stays the same. */
function useUnarchived(): ReturnType<typeof unarchived> {
  const items = useInventory((s) => s.items)
  return useMemo(() => unarchived(items), [items])
}
