/**
 * PrizePanel.tsx - TERRAIN's hand on the prizes a smash made (owner,
 * 2026-11-27): the prize strip in the hint's slot over the hotbar (how many
 * wait here, COLLECT ALL, every prize when there are more than the ring
 * shows, PUT AWAY), the card a tapped toy opens (its name, its maker, TAKE),
 * the picker, and the toys flying to the menu as they are taken.
 *
 * Taking is the player's choice, three ways: walk into a toy, tap it and
 * TAKE, or COLLECT ALL. PUT AWAY only takes the toys out of the scene: they
 * wait in ITEMS › BLUEPRINTS › BUILT, so nothing is lost by a stray tap.
 */

import { ITEM_ORANGE, isItemPrize } from '../lib/blueprint/itemMark'
import { useEffect, useMemo, useState } from 'react'
import { Bomb, Boxes, EyeOff, Hammer, PackageCheck, Sparkles } from 'lucide-react'
import { isQuarryPrize, toolWhat } from '../lib/blueprint/gameCard'
import { quarryModelNow, useQuarryModel } from '../lib/blueprint/quarryModel'
import { fromPayload } from 'sno-core/shards'
import { useBlueprints } from '../store/useBlueprints'
import { prizeName, usePrizePick } from '../store/usePrizePick'
import { useCyberspace } from '../store/useCyberspace'
import { terrainSession, headNow, offsetOf } from '../store/useTerrain'
import { takeToy } from '../lib/blueprint/smashRun'
import { RING_MAX } from '../lib/blueprint/smash'
import { keepOwnTable } from '../lib/carried'
import { authorColour } from '../lib/authorColour'
import { useProfile } from '../hooks/useProfile'
import { shortNpub } from '../lib/nameLabel'
import { ModalClose } from '../hud/ui/ModalClose'
import { ItemThumb } from '../hud/ItemThumb'
import { CardSpin } from '../scene/CardSpin'
import { Stacked, useModalStack } from '../hud/modalStack'
import type { ToyRow } from '../lib/blueprint/blueprintDb'

/** How near (gibsons) prizes count as here, for the strip and COLLECT ALL. */
const HERE = 24

/** The prizes waiting near you and not put away, looked at a few times a second. */
export function usePrizesHere(): ToyRow[] {
  const toys = useBlueprints((s) => s.toys)
  const putAway = useBlueprints((s) => s.putAway)
  const plane = useCyberspace((s) => s.plane)
  const [here, setHere] = useState<ToyRow[]>([])
  useEffect(() => {
    const look = (): void => {
      const s = terrainSession
      if (!s) { setHere([]); return }
      const head = offsetOf(s, headNow())
      const list = toys.filter((t) => {
        if (t.at.plane !== plane || putAway.has(t.rowKey)) return false
        const o = offsetOf(s, { x: BigInt(t.at.x), y: BigInt(t.at.y), z: BigInt(t.at.z) })
        return Math.max(Math.abs(o[0] - head[0]), Math.abs(o[1] - head[1]), Math.abs(o[2] - head[2])) <= HERE
      })
      setHere((was) => (was.length === list.length && was.every((t, i) => t === list[i]) ? was : list))
    }
    look()
    const t = window.setInterval(look, 400)
    return () => clearInterval(t)
  }, [toys, putAway, plane])
  return here
}

/** Take one prize, flying to the menu. */
export function takeWithFlight(key: string): void {
  // The flight starts from where the toy stood, so it is measured first; it flies only when the prize was taken.
  const pick = usePrizePick.getState()
  const from = pick.measure(key)
  if (takeToy(key)) pick.flyFrom(key, from)
}

/** A maker's name for a prize: their profile's, a short npub, or the game's own for a starter recipe. */
function MakerName({ maker }: { maker: string }): JSX.Element {
  const profile = useProfile(maker === 'game' ? null : maker)
  if (maker === 'game') return <>a starter recipe</>
  return <>{profile?.name?.trim() || shortNpub(maker)}</>
}

/** The prize strip: in the hint's slot, so nothing moves when it comes and goes. */
export function PrizeStrip({ here }: { here: ToyRow[] }): JSX.Element | null {
  if (here.length === 0) return null
  const more = here.length - RING_MAX
  return (
    <span className="prize-strip" role="group" aria-label="Prizes here">
      <Sparkles size={14} strokeWidth={2} aria-hidden />
      <span className="prize-strip__count">{here.length === 1 ? '1 prize' : `${here.length} prizes`}</span>
      {more > 0 && <button className="prize-strip__btn" onClick={() => usePrizePick.getState().setPicker(true)}>+{more} MORE</button>}
      <button className="prize-strip__btn prize-strip__btn--go" onClick={() => { for (const t of here) takeWithFlight(t.rowKey) }}><PackageCheck size={13} strokeWidth={2.25} aria-hidden />COLLECT ALL</button>
      <button className="prize-strip__btn" onClick={() => useBlueprints.getState().putAwayToys(here.map((t) => t.rowKey))} title="Put away to ITEMS, BLUEPRINTS, BUILT"><EyeOff size={13} strokeWidth={2.25} aria-hidden />PUT AWAY</button>
    </span>
  )
}

function prizeModel(toy: ToyRow): ReturnType<typeof fromPayload> | null {
  if (isQuarryPrize(toy.prize)) return quarryModelNow()
  if (toy.prize.type !== 'sno') return null
  const s = fromPayload(toy.prize.payload, toy.rowKey)
  return s ? keepOwnTable(s, toy.maker) : null
}

/** A tapped toy's card: its name, its maker, what it is, TAKE. */
export function PrizeCard(): JSX.Element | null {
  const key = usePrizePick((s) => s.open)
  const toy = useBlueprints((s) => s.toys.find((t) => t.rowKey === key) ?? null)
  const close = (): void => usePrizePick.getState().select(null)
  useModalStack(!!toy, close)
  // The Quarry Charge's model is read on first use: drawn once it is in (quarryModel.ts).
  const quarry = useQuarryModel(!!toy && isQuarryPrize(toy.prize))
  const shard = useMemo(() => (toy ? prizeModel(toy) : null), [toy, quarry])
  if (!toy) return null
  return (
    <Stacked>
      <div className="modal prize-modal" role="dialog" aria-modal="true" aria-label={prizeName(toy)} onPointerDown={close}>
        <div className="modal__card prize-card" onPointerDown={(e) => e.stopPropagation()} style={{ ['--prize-glow' as string]: toy.maker === 'game' ? '#ff9a3c' : authorColour(toy.maker) }}>
          <div className="prize-card__head">
            {isQuarryPrize(toy.prize) ? <Bomb size={16} strokeWidth={2} aria-hidden /> : toy.prize.type === 'tool' ? <Hammer size={16} strokeWidth={2} aria-hidden /> : <Boxes size={16} strokeWidth={2} aria-hidden />}
            <h2>{prizeName(toy)}</h2>
            {isItemPrize(toy.prize) && <span className="item-chip" style={{ ['--item' as string]: ITEM_ORANGE }}>ITEM</span>}
            <ModalClose onClose={close} />
          </div>
          <div className="prize-card__spin">{shard ? <CardSpin shard={shard} size={180} /> : <Hammer size={64} strokeWidth={1.25} aria-hidden />}</div>
          <p className="prize-card__by">{toy.maker === 'game' ? 'From its own recipe' : <>From {toy.name}, by <MakerName maker={toy.maker} /></>}</p>
          <p className="prize-card__what">{toy.prize.type === 'tool' ? toolWhat(toy.prize) : 'A shard: ITEMS, OTHER LOOT.'}</p>
          <button className="prize-card__take" onClick={() => takeWithFlight(toy.rowKey)}><PackageCheck size={15} strokeWidth={2.25} aria-hidden />TAKE</button>
        </div>
      </div>
    </Stacked>
  )
}

/** Every prize waiting here, to take one by one. */
export function PrizePicker({ here }: { here: ToyRow[] }): JSX.Element | null {
  const open = usePrizePick((s) => s.picker)
  const close = (): void => usePrizePick.getState().setPicker(false)
  useModalStack(open, close)
  useEffect(() => { if (open && here.length === 0) close() }, [open, here.length])
  // Drawn again once the Quarry Charge's model is read, when one waits here.
  useQuarryModel(open && here.some((t) => isQuarryPrize(t.prize)))
  if (!open) return null
  return (
    <Stacked>
      <div className="modal prize-modal" role="dialog" aria-modal="true" aria-label="Prizes here" onPointerDown={close}>
        <div className="modal__card prize-card prize-card--list" onPointerDown={(e) => e.stopPropagation()}>
          <div className="prize-card__head">
            <Sparkles size={16} strokeWidth={2} aria-hidden />
            <h2>PRIZES HERE</h2>
            <ModalClose onClose={close} />
          </div>
          <ul className="prize-list">
            {here.map((t) => {
              const shard = prizeModel(t)
              return (
                <li key={t.rowKey} className={`prize-row${isItemPrize(t.prize) ? ' is-item' : ''}`} style={{ ['--item' as string]: ITEM_ORANGE }}>
                  <span className="prize-row__thumb">
                    <ItemThumb type="shard" shard={shard ?? undefined} size={80} />
                    {isItemPrize(t.prize) && <span className="item-tab" aria-label="Item"><Hammer size={11} strokeWidth={2.5} aria-hidden /></span>}
                  </span>
                  <span className="prize-row__text">
                    <span className="prize-row__name">{prizeName(t)}</span>
                    <span className="prize-row__by">{t.maker === 'game' ? 'From its own recipe' : <>From {t.name}, by <MakerName maker={t.maker} /></>}</span>
                  </span>
                  <button className="prize-row__take" onClick={() => takeWithFlight(t.rowKey)}>TAKE</button>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </Stacked>
  )
}

/** Toys flying to the menu as they are taken, each with a short trail. */
export function PrizeFlights(): JSX.Element | null {
  const flights = usePrizePick((s) => s.flights)
  const [target, setTarget] = useState<{ x: number; y: number }>({ x: 40, y: 40 })
  useEffect(() => {
    if (!flights.length) return
    const el = document.querySelector('.items-kinds') ?? document.querySelector('.hamburger-menu')
    const r = el?.getBoundingClientRect()
    if (r && r.width > 0) setTarget({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
  }, [flights.length])
  if (!flights.length) return null
  return (
    <div className="prize-flights" aria-hidden>
      {flights.map((f) => (
        <span
          key={f.id}
          className="prize-flight"
          style={{ ['--fx' as string]: `${f.x}px`, ['--fy' as string]: `${f.y}px`, ['--tx' as string]: `${target.x}px`, ['--ty' as string]: `${target.y}px`, ['--fc' as string]: f.colour }}
          onAnimationEnd={() => usePrizePick.getState().land(f.id)}
        />
      ))}
    </div>
  )
}
