/**
 * ChestLooks.tsx: every chest and door in the world, as the look it wears
 * (lib/looks.ts; chest and door design, D2, R14).
 *
 * A chest is the treasure chest, a door the door slab, each closed until
 * this identity opens it with OPEN and open from then on (R14), a reload
 * included: opened by hand on this device is open, whether a key or a
 * signer opened it (store/useOpenedChests), as WALK's walls have it. Only
 * what this session read floats out of it. Drawn at the zooms
 * a key's cube is (lib/worldMarks.ts markShown), with no name floating over
 * it (WorldMessages FLOATING_NAME): a tap opens its card, where its name and
 * OPEN are.
 */

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { ACCENT } from '../lib/palette'
import { GRID_RADIUS, itemCentre, type ViewAxes } from '../lib/space'
import { drawnLook, lookFacing, lookOf, lookStand, onSealedLooks, sealedLooksVersion, swapsOnOpen, type Look } from '../lib/looks'
import { regionBox } from '../lib/clip'
import type { ShardModel } from 'sno-core/shards'
import { markShown } from '../lib/worldMarks'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { openedByHand, openedContents, openedKey, useOpenedChests } from '../store/useOpenedChests'
import { useShards, type WorldItem } from '../store/useShards'
import { useMutes } from '../store/useMutes'
import { setDrawnLooks, useOpenCeremony, type Playing } from '../store/useOpenCeremony'
import { ChestCeremony, restShowsFrom } from './ChestCeremony'
import { DoorCeremony, DoorCloses } from './DoorCeremony'
import { ChestLoot, HOVER_Y, LOOT_SIDE } from './ChestLoot'
import { ShardMesh } from './ShardMesh'
import { chestLoot, type LootObject } from '../lib/lootObjects'
import { holdsEntry } from '../lib/inventory'
import { hidesThing } from '../lib/muteList'
import { useInventory } from '../store/useInventory'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { LookMark, type LookFrame } from './LookMark'
import { sameBox, samePose } from './WorldShards'
import { placedPose } from '../lib/pose'
import { trueScale } from '../lib/itemModel'
import { followsVersion, onFollows, trustedPlacement } from '../lib/trust'
import { FLOATING_NAME, NOTE, NOTE_EDGE_PX, author, itemMarkText } from './WorldMessages'
import { useDrawReach } from './buildZoom'

const REACH = GRID_RADIUS * 8
/**
 * A look's own frame, where the view's turn is the identity (store/walkWalls
 * WALL_AXES): LookMark turns the look with the view around it, so its cut is
 * measured here.
 */
const LOOK_FRAME: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: -1 } }
/** The top of the loot hovering over an opened chest, which its label stands above. */
const LOOT_TOP = HOVER_Y + LOOT_SIDE

/** One chest or door as the scene draws it. */
export interface PlacedLook {
  key: string
  look: Look
  opened: boolean
  /** What floats over it once opened: what is inside and not yet held. */
  loot: LootObject[]
  text: string
  sub: string
  centre: [number, number, number]
  /** Its cut, its stance and its share of the scene's budget (lookFrame). */
  frame: LookFrame
}

/** A look's cut and stance as last handed to the scene, by key: kept while equal, so what keys on them holds still. */
export type KeptLookFrames = Map<string, Pick<LookFrame, 'clip' | 'pose'>>

/** Only what is drawn stays kept: a look passed by goes, or a long walk keeps one of each it ever passed. */
export function pruneLookFrames(kept: KeptLookFrames, drawn: ReadonlySet<string>): void {
  for (const key of kept.keys()) if (!drawn.has(key)) kept.delete(key)
}

/**
 * How a look is drawn now (scene/LookMark LookFrame), from what is drawn: its
 * unit, its stance, and whom to trust for what it places (as WorldShards'
 * PlacedShard). A built-in carries nothing to cut, stand or fetch. Its cut and
 * stance are the same objects as last time while they are equal, because
 * ShardMesh keys its geometry on the clip's identity and the anchor moves with
 * every WALK step: a fresh box each step cut every look again every step
 * (the 2026-10-23 freeze, WorldShards useSteadied).
 */
export function lookFrame(w: Pick<WorldItem, 'key' | 'at' | 'height' | 'plane' | 'author'>, look: Look, drawn: ShardModel, centre: [number, number, number], scaleExp: number, axes: ViewAxes, kept: KeptLookFrames): LookFrame {
  if (look.name !== 'custom') { kept.delete(w.key); return {} }
  const stand = lookStand(drawn, w.plane, w.at)
  const was = kept.get(w.key)
  const pose = stand ? placedPose(axes, stand) : undefined
  const clip = regionBox(w.at, w.height, drawn.unit, stand ? axes : LOOK_FRAME)
  const steady = {
    clip: was?.clip && sameBox(was.clip, clip) ? was.clip : clip,
    pose: pose && was?.pose && samePose(was.pose, pose) ? was.pose : pose,
  }
  kept.set(w.key, steady)
  const author = drawn.author ?? w.author
  return { ...steady, budget: { key: `look:${w.key}`, trusted: trustedPlacement(w.author, author), centre, scale: trueScale(drawn.unit, scaleExp) } }
}

export function ChestLooks({ axes }: { axes: ViewAxes }): JSX.Element | null {
  const anchor = useCyberspace((s) => s.anchor)
  const anchorPlane = useCyberspace((s) => s.anchorPlane)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const me = useCyberspace((s) => s.identity.pubkey)
  const mine = useShards((s) => s.mine)
  const discovered = useShards((s) => s.discovered)
  const curated = useShards((s) => s.curated)
  const muted = useMutes((s) => s.muted)
  const opened = useOpenedChests((s) => s.opened)
  const playing = useOpenCeremony((s) => s.playing)
  const items = useInventory((s) => s.items)
  // Whose ITEMS these are, and whether they are read: until then no loot, or
  // what you hold would float out for a moment after an identity switch.
  const itemsReady = useInventory((s) => s.owner === me && s.storage !== 'loading')
  const still = useReducedMotion()
  // Whom you follow decides what a look's placed objects may spend.
  const follows = useSyncExternalStore(onFollows, followsVersion)
  // A sealed look landing (DECK-0004 §3.6): the chest drawn without it until then is drawn with it now.
  const sealed = useSyncExternalStore(onSealedLooks, sealedLooksVersion)
  const frames = useRef<KeptLookFrames>(new Map())

  // As far as the fog's end needs (buildZoom.ts).
  const reach = useDrawReach((s) => Math.max(REACH, s.reach))
  const placed = useMemo<PlacedLook[]>(() => {
    if (!markShown('note', scaleExp)) { frames.current.clear(); return [] }
    const origin = alignedOrigin(anchor, scaleExp)
    const out: PlacedLook[] = []
    for (const w of useShards.getState().drawnItems()) {
      if (w.type !== 'chest' || !w.chest || w.plane !== anchorPlane) continue
      const look = lookOf(w)
      if (!look) continue
      const centre = itemCentre(w.at, origin, scaleExp, axes)
      if (Math.hypot(...centre) > reach) continue
      const inside = openedContents(opened, me, w.key, w.chest.lockPubkey)
      // What the mute list hides is not drawn coming out, as it is not listed (ItemRows ChestBlock).
      const shown = inside?.filter((e) => !hidesThing(muted, { authors: [w.author ?? '', e.event.pubkey], ids: [e.id] }, me))
      const loot = chestLoot({ look: look.kind, entries: shown, held: (e) => holdsEntry(items, e), itemsReady })
      const isOpen = openedByHand(me, w.key, w.chest.lockPubkey)
      const frame = lookFrame(w, look, drawnLook(look, isOpen) ?? look.closed, centre, scaleExp, axes, frames.current)
      out.push({ key: w.key, look, opened: isOpen, loot, text: itemMarkText(w), sub: author({ author: w.author ?? '', mine: w.mine }), centre, frame })
    }
    pruneLookFrames(frames.current, new Set(out.map((w) => w.key)))
    return out
    // mine, discovered, curated and muted are what worldItems reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, anchorPlane, scaleExp, axes, me, mine, discovered, curated, muted, opened, items, itemsReady, follows, reach, sealed])

  // OPEN asks whether a chest is drawn, to know whether its ceremony can be seen (store/useOpenCeremony).
  useEffect(() => { setDrawnLooks(placed.map((w) => w.key)) }, [placed])
  useEffect(() => () => setDrawnLooks([]), [])

  if (placed.length === 0) return null
  return (
    <>
      {placed.map((w) => {
        // Opening plays on an open look, closing (CLOSE) on a shut one: a stale one of either is not drawn.
        const now = playing[openedKey(me, w.key)]
        const ceremony = now && w.opened === !now.closing ? now : undefined
        const { swap } = restPlan(w.look, ceremony)
        const model = drawnLook(w.look, w.opened)
        const loot = w.loot.length > 0
        return (
          <LookMark
            key={w.key}
            look={w.look}
            model={model}
            at={w.centre}
            axes={axes}
            minPx={NOTE_EDGE_PX}
            label={FLOATING_NAME[w.look.kind] ? { text: w.text, color: NOTE, sub: w.sub, subColor: ACCENT } : undefined}
            onTap={() => useShards.getState().selectSecret(w.key)}
            clearTop={loot ? LOOT_TOP : 0}
            frame={w.frame}
            // Dims while it blocks the build cursor; not mid-ceremony, which sets its own materials each frame.
            occluder={swap ? undefined : `look:${w.key}`}
          >
            {({ dim }) => <LookBody look={w.look} opened={w.opened} ceremony={ceremony} loot={w.loot} frame={w.frame} dim={dim} still={still} />}
          </LookMark>
        )
      })}
    </>
  )
}

/**
 * What a ceremony does to a look's resting mesh: `swap`, the ceremony when it
 * has a model to swap (lib/looks.ts swapsOnOpen; a chest with one model has
 * none, and its model stays drawn throughout), during which the resting mesh is
 * hidden; and `showsFrom`, when it shows again before the ceremony ends (the
 * lid's handoff, ChestCeremony restShowsFrom), or null for at its end.
 */
export function restPlan(look: Look, ceremony: Playing | undefined): { swap: Playing | undefined; showsFrom: number | null } {
  const swap = ceremony && swapsOnOpen(look, !!ceremony.closing) ? ceremony : undefined
  return { swap, showsFrom: swap && !swap.closing && swap.kind === 'chest' ? restShowsFrom(look, swap) : null }
}

/**
 * Everything drawn in a look's own frame, in three places in the tree that
 * never move: the ceremony swapping its model (or nothing), the resting mesh
 * (RestLook), and the loot. Nothing OPEN, CLOSE, a ceremony or loot does moves
 * the resting mesh, so it is never unmounted.
 */
export function LookBody({ look, opened, ceremony, loot, frame, dim, still }: { look: Look; opened: boolean; ceremony: Playing | undefined; loot: LootObject[]; frame: LookFrame; dim: number; still: boolean }): JSX.Element {
  const { swap, showsFrom } = restPlan(look, ceremony)
  return (
    <>
      {swap ? (swap.kind === 'door' ? (swap.closing ? <DoorCloses look={look} at={swap.at} frame={frame} /> : <DoorCeremony look={look} at={swap.at} calm={swap.calm} frame={frame} />) : <ChestCeremony look={look} at={swap.at} calm={swap.calm} frame={frame} />) : null}
      <RestLook model={drawnLook(look, opened)} frame={frame} dim={dim} hidden={!!swap} showsFrom={showsFrom} />
      {loot.length > 0 && <ChestLoot loot={loot} ceremony={ceremony} still={still} dim={dim} facing={lookFacing(look)} />}
    </>
  )
}

/**
 * The look as it rests: the model drawnLook gives, in one place in the tree
 * that OPEN, CLOSE, a ceremony and loot never move, so its mesh is never
 * unmounted, rebuilt or fetched again by any of them (arkinox, 2026-11-18: the
 * chest model disappeared for a few seconds as it opened). While a ceremony
 * swaps the model (`hidden`), it is mounted and hidden: the ceremony draws the
 * change, and this, already built with its parts fetched, shows the moment the
 * ceremony lets it (`showsFrom`, performance.now() time) or ends. A chest whose
 * look has one model has no ceremony to hide behind, so it is drawn on every
 * frame through the opening.
 */
export function RestLook({ model, frame, dim, hidden = false, showsFrom = null }: { model: ShardModel | null; frame: LookFrame; dim: number; hidden?: boolean; showsFrom?: number | null }): JSX.Element | null {
  const group = useRef<Group>(null)
  useFrame(() => {
    // Only while a ceremony hides it: at rest the `visible` prop below holds.
    if (hidden && group.current) group.current.visible = restVisible(hidden, showsFrom, performance.now())
  })
  if (!model) return null
  return (
    <group ref={group} visible={restVisible(hidden, showsFrom, performance.now())}>
      <ShardMesh shard={model} world {...frame} dim={dim} />
    </group>
  )
}

/** Whether the resting look shows now: always but behind a ceremony, and behind one from `showsFrom` on. */
export function restVisible(hidden: boolean, showsFrom: number | null, now: number): boolean {
  return !hidden || (showsFrom !== null && now >= showsFrom)
}
