/**
 * DoorOwner.tsx: what a door's card shows the one who sealed it (chest and
 * door design, 4.7, 4.8, 4.11, R3, R12).
 *
 * `BEHIND IT · 7`, and `HERE · 3`: what you already hid in its room, at any
 * height, with SEAL on each and SEAL ALL (R3). The list scrolls, never cut
 * short; a row's name flies to it, and RETURN reopens this card on the same
 * door, scrolled as it was (lib/doorReturn.ts). DELETE's card is the folder
 * delete's pattern (R12): one switch, off leaves what was behind it where it
 * stands, as ordinary placements; on deletes it too, with a count, and the
 * button turns red. The switch is not offered without the door secret, which
 * this device learns by sealing the door or opening it (4.11), nor for one of
 * several doors, which goes alone (§3.7.8).
 */

import { useLayoutEffect, useRef, useState } from 'react'
import { doorSecret } from '../store/doorSecrets'
import { useCyberspace } from '../store/useCyberspace'
import { behindDoor, behindDoorDeep, doorsBeside, hereInRoom, positionOf, useShards, type MyDeployment } from '../store/useShards'
import { takeDoorScroll, viewFromDoor } from '../lib/doorReturn'
import { hiddenLabel } from '../lib/hidden'
import { ConfirmModal } from './ConfirmModal'
import { ItemIcon } from './ItemIcon'
import { Field, Switch } from './ui/Switch'

/**
 * The words on DELETE's card, as deleteDoor works. `known`: this device knows the
 * door's secret, without which nothing behind it can be moved, deleted or even
 * counted; it stays sealed on the relays (§3.7.8).
 */
export function deleteDoorWords(behind: number, alone: boolean, contents: boolean, known = true): { title: string; lines: string[]; confirmLabel: string; danger: boolean } {
  const title = 'Delete this door?'
  if (!alone) return { title, lines: ['The room stays, and the other door still opens it.'], confirmLabel: 'DELETE DOOR', danger: true }
  if (!known) return { title, lines: ['You have not opened it on this device, so what is behind it stays sealed, out of reach by this door.'], confirmLabel: 'DELETE DOOR', danger: true }
  if (behind === 0) return { title, lines: ['Nothing is behind it.'], confirmLabel: 'DELETE DOOR', danger: false }
  return contents
    ? { title, lines: [`Delete contents: ${behind} ${behind === 1 ? 'thing' : 'things'}.`, 'This cannot be undone.'], confirmLabel: 'DELETE DOOR AND CONTENTS', danger: true }
    : { title, lines: ['What was behind it stays where it stands, unsealed: anyone at the place can find it.'], confirmLabel: 'DELETE DOOR', danger: false }
}

/** The card a door's list scrolls inside, whose own scroll RETURN puts back too. None where there is no page (a test's renderer). */
function cardOf(list: HTMLElement | null): Element | null {
  return typeof list?.closest === 'function' ? list.closest('.modal__card') : null
}

/** BEHIND IT and HERE, on a door of yours. */
export function DoorOwnerBlock({ door }: { door: MyDeployment }): JSX.Element | null {
  const me = useCyberspace((s) => s.identity.pubkey)
  const mine = useShards((s) => s.mine)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const list = useRef<HTMLUListElement>(null)
  // Back from a row's VIEW: the list, and the card around it, scrolled as they were.
  // Again a frame on, once the card above it has drawn (its 3D look).
  useLayoutEffect(() => {
    const back = takeDoorScroll(door.eventId)
    if (!back) return
    const put = (): void => {
      if (list.current) list.current.scrollTop = back.listTop
      const card = cardOf(list.current)
      if (card) card.scrollTop = back.cardTop
    }
    put()
    if (typeof requestAnimationFrame !== 'function') return
    const frame = requestAnimationFrame(put)
    return () => cancelAnimationFrame(frame)
  }, [door.eventId])
  if (!doorSecret(me, door.eventId)) return null
  const behind = behindDoor(mine, door)
  const here = hereInRoom(mine, door)
  const seal = (ids: string[]): void => {
    setBusy(true); setStatus(null)
    void useShards.getState().sealIntoRoom(door.eventId, ids).then((why) => { setBusy(false); setStatus(why) })
  }
  const view = (d: MyDeployment): void => {
    const card = cardOf(list.current)
    viewFromDoor({ doorId: door.eventId, listTop: list.current?.scrollTop ?? 0, cardTop: card?.scrollTop ?? 0 }, positionOf(d), d.plane, hiddenLabel(d, 48).toUpperCase(), d.type === 'shard' ? d.shard?.unit ?? 0 : 0)
  }
  return (
    <div className="doorowner">
      <span className="legend__label doorowner__count">BEHIND IT · {behind.length}</span>
      {here.length > 0 && (
        <>
          <span className="legend__label doorowner__count">HERE · {here.length}</span>
          <ul ref={list} className="chest__contents doorowner__here" aria-label="Here, not behind the door">
            {here.map((d) => (
              <li key={d.eventId} className="chest__row">
                <ItemIcon className={`chest__glyph chest__glyph--${d.type}`} type={d.type} />
                <button className="doorowner__view" onClick={() => view(d)} title="Fly to it">
                  <span className="item__name">{hiddenLabel(d, 48)}</span>
                  <span className="doorowner__height">H{d.height}</span>
                </button>
                <button className="chest__act chest__act--take" disabled={busy} onClick={() => seal([d.eventId])} title="Seal it behind this door">SEAL</button>
              </li>
            ))}
          </ul>
          <div className="chest__all"><button className="chest__act chest__act--take" disabled={busy} onClick={() => seal(here.map((d) => d.eventId))} title="Seal everything here behind this door">SEAL ALL</button></div>
        </>
      )}
      {status && <span className="chest__status" role="status">{status}</span>}
    </div>
  )
}

/** DELETE on a door of yours, with its one switch (R12). */
export function DeleteDoorCard({ door, onCancel, onDone }: { door: MyDeployment; onCancel: () => void; onDone: () => void }): JSX.Element {
  const me = useCyberspace((s) => s.identity.pubkey)
  const mine = useShards((s) => s.mine)
  const [contents, setContents] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const alone = doorsBeside(mine, door).length === 0
  const known = !!doorSecret(me, door.eventId)
  const behind = behindDoorDeep(mine, door).length
  const words = deleteDoorWords(behind, alone, contents, known)
  return (
    <ConfirmModal
      title={words.title}
      busy={busy}
      danger={words.danger}
      confirmLabel={words.confirmLabel}
      body={(
        <>
          {words.lines.map((line) => <span key={line} className="modal__line">{line}</span>)}
          {alone && known && behind > 0 && (
            <Field id="door-delete-contents" label="Delete contents" hint={`${behind} ${behind === 1 ? 'thing' : 'things'}`}>
              <Switch id="door-delete-contents" checked={contents} onCheckedChange={setContents} />
            </Field>
          )}
          {status && <span className="modal__line" role="status">{status}</span>}
        </>
      )}
      onConfirm={() => {
        setBusy(true); setStatus(null)
        void useShards.getState().deleteDoor(door.eventId, contents).then((why) => { setBusy(false); if (why) setStatus(why); else onDone() })
      }}
      onCancel={onCancel}
    />
  )
}
