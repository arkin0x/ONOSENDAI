/**
 * InventoryPanel.tsx: LOOT, what this identity holds (Keys and Chests B1 §3.3).
 *
 * The third of the three bag panels: HIDDEN (later), DISCOVERED (opened where
 * it stands) and this one, what you hold, kept per identity in IndexedDB
 * (store/useInventory.ts). Keys first: each with its name, who forged it,
 * where it was found and when, and which DISCOVERED chests it opens, computed
 * from the lock tags of chests seen. Then what was taken out of chests: coins
 * with the Cashu card and its mint state, shards with COPY TO STASH, messages,
 * and chests, which open here as they do where they were found. COPY puts a
 * key on the clipboard as text (`cyberspace-key:` and its event) and PASTE
 * reads one back, so a key crosses devices. Nothing here is destructive; BURN
 * comes later.
 */

import { useMemo, useState } from 'react'
import { useProfile } from '../hooks/useProfile'
import { cashuLabel, readCashuToken } from '../lib/cashu'
import { hiddenGlyph } from '../lib/hidden'
import { chestsOpenedBy, keyText, splitPanels, type HeldItem } from '../lib/inventory'
import { regionLabel } from '../lib/loot'
import { safeNpub } from '../lib/npub'
import { formatAgo, formatStamp, shortHex } from '../lib/time'
import { useCyberspace } from '../store/useCyberspace'
import { useInventory } from '../store/useInventory'
import { profileLabel } from '../store/useProfiles'
import { useShards } from '../store/useShards'
import { useWorkshop } from '../store/useWorkshop'
import { MessageText } from './CashuCard'
import { Explanation } from './Explanation'
import { ChestBlock, Unsigned } from './ItemRows'
import { useCashu, cashuStateLabel } from './useCashu'

/** How a held item came to be held, in a word for the row. */
const SOURCE: Record<HeldItem['source'], string> = { forged: 'forged by you', found: 'found', taken: 'taken', pasted: 'pasted' }

function Copyable({ label, value, title }: { label: string; value: string; title: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    })
  }
  return (
    <>
      <dt>{label}</dt>
      <dd><button className="lootd__copy" title={`${title} (click to copy)`} onClick={copy}>{copied ? 'copied' : shortHex(value, 14, 8)}</button></dd>
    </>
  )
}

/** Where a held item was found, as a line, and a VIEW that flies there. */
function FoundAt({ item }: { item: HeldItem }): JSX.Element | null {
  const p = item.place
  if (!p) return null
  const view = (): void => useCyberspace.getState().focusItem({ x: BigInt(p.at.x), y: BigInt(p.at.y), z: BigInt(p.at.z) }, p.plane, item.name.toUpperCase(), 0)
  return (
    <>
      <dt>Found at</dt>
      <dd>{regionLabel(p.height)} · {p.plane === 0 ? 'dataspace' : 'ideaspace'} <button className="chest__act" onClick={view} title="Fly to where it was found">VIEW</button></dd>
    </>
  )
}

/** A held key: name, who forged it, where and when, what it opens, DETAILS and COPY. */
function KeyRow({ item, opens }: { item: HeldItem; opens: number }): JSX.Element {
  const me = useCyberspace((s) => s.identity.pubkey)
  const profile = useProfile(item.author || null)
  const who = item.author === me ? 'you' : profileLabel(profile, safeNpub(item.author))
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    void navigator.clipboard?.writeText(keyText(item)).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    })
  }
  const pubkey = item.key?.itemPubkey ?? ''
  return (
    <li className="secrets__row held__row">
      <span className="chest__glyph chest__glyph--key" aria-hidden="true">{hiddenGlyph('key')}</span>
      <span className="item__line">
        <span className="item__name" title={item.name}>{item.name}</span>
        <span className="item__meta">
          {item.source === 'forged' ? 'forged by you' : `forged by ${who}`} · {item.source === 'forged' ? 'hidden' : SOURCE[item.source]} <span title={formatStamp(item.at)}>{formatAgo(item.at)}</span>
          {opens > 0 && <> · <span className="secrets__found" title="Discovered chests whose lock is this key">opens {opens} chest{opens === 1 ? '' : 's'}</span></>}
          {!item.verified && <> · <Unsigned /></>}
        </span>
      </span>
      <span className="held__acts">
        <button className={`chest__act ${open ? 'is-on' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>DETAILS</button>
        <button className={`chest__act ${copied ? 'is-on' : ''}`} onClick={copy} title="Copy the key as text, to paste into LOOT on another device">{copied ? 'COPIED' : 'COPY'}</button>
      </span>
      {open && (
        <div className="held__details">
          <dl>
            <Copyable label="item" value={safeNpub(pubkey)} title={safeNpub(pubkey)} />
            <Copyable label="hex" value={pubkey} title={pubkey} />
            <dt>Forged by</dt><dd>{who}</dd>
            <FoundAt item={item} />
            {item.from && <><dt>From</dt><dd>chest “{item.from.chestName}”</dd></>}
            {item.key?.about && <><dt>About</dt><dd>{item.key.about}</dd></>}
          </dl>
        </div>
      )}
    </li>
  )
}

/** Something taken out of a chest: a coin, a shard, a message or a chest, with what each can do. */
function TakenRow({ item }: { item: HeldItem }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const { raw, token } = readCashuToken(item.type === 'message' ? item.text : null)
  const cashu = useCashu(raw ? item.text : null)
  const coin = raw !== null
  const label = coin ? (token ? cashuLabel(token) : 'cashu token') : item.name
  const toStash = (): void => {
    if (item.shard) useWorkshop.getState().importShard(item.shard)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }
  return (
    <li className="secrets__row held__row">
      <span className={`chest__glyph chest__glyph--${coin ? 'cashu' : item.type}`} aria-hidden="true">{hiddenGlyph(item.type, coin)}</span>
      {item.type === 'chest' && item.chest
        ? <ChestBlock id={item.id} chest={item.chest} author={item.author} verified={item.verified} place={item.place} />
        : (
          <span className="item__line">
            <span className="item__name" title={label}>{label}</span>
            <span className="item__meta">
              {item.from ? `from “${item.from.chestName}”` : SOURCE[item.source]} · <span title={formatStamp(item.at)}>{formatAgo(item.at)}</span>
              {coin && <> · <span className={`shards__cashu shards__cashu--${cashu.state}`}>{cashuStateLabel(cashu.state)}</span></>}
              {!item.verified && <> · <Unsigned /></>}
            </span>
          </span>
        )}
      <span className="held__acts">
        {item.type === 'shard' && <button className={`chest__act ${copied ? 'is-on' : ''}`} onClick={toStash} title="Copy this model into your workshop">{copied ? 'COPIED' : 'COPY TO STASH'}</button>}
        {item.type === 'message' && <button className={`chest__act ${open ? 'is-on' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>{coin ? 'CARD' : 'READ'}</button>}
      </span>
      {open && item.type === 'message' && (
        <div className="held__details">
          <MessageText text={item.text ?? ''} words={(t) => <blockquote className="secret__message">{t}</blockquote>} />
        </div>
      )}
    </li>
  )
}

export function InventoryPanel(): JSX.Element {
  const items = useInventory((s) => s.items)
  const storage = useInventory((s) => s.storage)
  const discovered = useShards((s) => s.discovered)
  const { keys, taken } = useMemo(() => splitPanels([], Object.values(items)).loot, [items])
  // Which DISCOVERED chests each key opens, from the lock tags of chests seen.
  const chests = useMemo(() => Object.values(discovered).filter((h) => h.type === 'chest' && h.chest).map((h) => ({ id: h.eventId, chest: h.chest! })), [discovered])
  const [paste, setPaste] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const doPaste = (): void => {
    const r = useInventory.getState().paste(paste)
    setNote(r.ok ? (r.already ? `Already in your LOOT: ${r.item?.name}.` : `Held: ${r.item?.name}.`) : r.reason ?? 'Not a key.')
    if (r.ok) setPaste('')
  }
  const count = keys.length + taken.length

  return (
    <section className="panel panel--loot">
      <header className="panel__head">
        <h2>Loot</h2>
        <span className="loot__tags">
          {storage === 'memory' && <span className="tag" title="IndexedDB could not be opened; what you hold lasts this session only">THIS SESSION</span>}
          <span className="tag">{count === 0 ? 'NOTHING HELD' : `${keys.length} KEY${keys.length === 1 ? '' : 'S'}${taken.length > 0 ? ` · ${taken.length} TAKEN` : ''}`}</span>
        </span>
      </header>

      {keys.length > 0 && (
        <div className="shards__section">
          <span className="legend__label">Keys</span>
          <ul className="secrets__list held__list">
            {keys.map((k) => <KeyRow key={k.id} item={k} opens={k.key ? chestsOpenedBy(k.key, chests).length : 0} />)}
          </ul>
        </div>
      )}

      {taken.length > 0 && (
        <div className="shards__section">
          <span className="legend__label">Taken</span>
          <ul className="secrets__list held__list">
            {taken.map((t) => <TakenRow key={t.id} item={t} />)}
          </ul>
        </div>
      )}

      {count === 0 && <p className="avatars__empty">Nothing held yet.</p>}

      {/* A key from another device, as COPY wrote it. */}
      <form className="loot__paste" onSubmit={(e) => { e.preventDefault(); doPaste() }}>
        <input className="avatars__input" value={paste} onChange={(e) => { setPaste(e.target.value); setNote(null) }} placeholder="cyberspace-key:…" spellCheck={false} autoComplete="off" aria-label="A key as text" />
        <button className="avatars__go" type="submit" disabled={!paste.trim()} title="Hold a key copied from LOOT on another device">PASTE</button>
      </form>
      {note && <p className="notice" role="status">{note}</p>}

      <Explanation>
        What you hold: keys read out of bags or forged by you, and what you took
        out of chests. A chest sealed to one of these keys opens where it is
        found, in DISCOVERED. Kept on this device per identity; COPY and PASTE
        carry a key to another device as text.
      </Explanation>
    </section>
  )
}
