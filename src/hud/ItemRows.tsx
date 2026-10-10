/**
 * ItemRows.tsx: the key line and the chest block, wherever found things are
 * listed (Keys and Chests B1 §3.2).
 *
 * A key found says its name, who forged it, and that it is in your LOOT,
 * because reading it was holding it. A chest says its name and what opens it;
 * when something you hold does (a key whose public key is the lock, or the
 * lock is your own identity), OPEN decrypts it where it stands and lists what
 * is inside, each row with TAKE, which copies the thing into LOOT. A key
 * inside an opened chest is held the moment it is read, like any key. A chest
 * inside a chest is a chest block of its own, so chaining reads as nesting.
 *
 * Used by the bag record (LootDetail), the nearby list (NearbyLootModal), the
 * item modal (SecretModal) and the LOOT panel's taken chests, so a chest opens
 * the same way from every door. Opening is a local act: nothing is published.
 */

import { useMemo, useState } from 'react'
import { useProfile } from '../hooks/useProfile'
import { cashuLabel, readCashuToken } from '../lib/cashu'
import { openWithSecret, openWithSigner, openerFor, readContents, requiresLabel, revealedIn, type ChestEntry } from '../lib/chests'
import { positionOf, useShards } from '../store/useShards'
import { hiddenGlyph, hiddenLabel, type ChestItem } from '../lib/hidden'
import { openingKeys, type HeldFrom, type HeldPlace } from '../lib/inventory'
import { safeNpub } from '../lib/npub'
import { useCyberspace } from '../store/useCyberspace'
import { useInventory } from '../store/useInventory'
import { profileLabel } from '../store/useProfiles'

/** The mark on an item that carries no signature: its author is a claim, never a fact (spec §7.6). */
export function Unsigned(): JSX.Element {
  return <span className="item__meta" title="This item carries no signature, so its author is a claim">UNSIGNED</span>
}

/** "you", or the hider's name. */
export function useWho(pubkey: string): string {
  const me = useCyberspace((s) => s.identity.pubkey)
  const profile = useProfile(pubkey || null)
  return pubkey === me ? 'you' : profileLabel(profile, safeNpub(pubkey))
}

/** A key where it was found: its name, who forged it, and that it is held. */
export function KeyLine({ name, author }: { name: string; author: string }): JSX.Element {
  const who = useWho(author)
  return (
    <span className="item__line">
      <span className="item__name" title={name}>{name}</span>
      <span className="item__meta">forged by {who} · <span className="item__held" title="Reading a key is holding it: it is in your LOOT">IN YOUR LOOT</span></span>
    </span>
  )
}

/** The row label of a content: a coin's amount, else the item's label. */
export function entryLabel(entry: ChestEntry): { label: string; coin: boolean } {
  if (entry.body.type === 'message') {
    const { raw, token } = readCashuToken(entry.body.text)
    if (raw) return { label: token ? `${cashuLabel(token)} (cashu)` : 'cashu token', coin: true }
  }
  return { label: hiddenLabel(entry.body, 48), coin: false }
}

/**
 * A chest: its name, what opens it, OPEN when you hold it, and its contents
 * once open. `id` is the chest's event id, `author` its hider (a claim unless
 * `verified`), `place` where it was found (null for a chest held in LOOT
 * with no place of its own).
 */
export function ChestBlock({ id, chest, author, verified, place }: { id: string; chest: ChestItem; author: string; verified: boolean; place: HeldPlace | null }): JSX.Element {
  const items = useInventory((s) => s.items)
  const me = useCyberspace((s) => s.identity.pubkey)
  const keys = useMemo(() => openingKeys(items), [items])
  const opener = useMemo(() => openerFor(chest, keys, me), [chest, keys, me])
  const [entries, setEntries] = useState<ChestEntry[] | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const who = useWho(author)
  const from: HeldFrom = { chestId: id, chestName: chest.name }

  const open = async (): Promise<void> => {
    if (!opener || busy) return
    setBusy(true)
    setStatus(null)
    try {
      const raw = opener.by === 'key' ? openWithSecret(chest, opener.key.secretHex) : await openWithSigner(chest, useCyberspace.getState().decryptSealed)
      const contents = readContents(raw)
      setEntries(contents)
      // A key read is held, wherever it was read (B1 §2.1).
      useInventory.getState().take(contents.filter((e) => e.body.type === 'key'), from, place)
      // What the chest held is found in place: the room behind the door is
      // drawn where the door stands, as a scan's finds are.
      if (place) {
        const door = { eventId: id, bagId: place.bagId, lookupId: place.lookupId, author, at: positionOf(place), plane: place.plane, height: place.height }
        useShards.getState().addDiscovered(revealedIn(door, contents))
      }
      if (contents.length === 0) setStatus('Opened: nothing inside this client can read.')
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const opensWith = opener === null ? null : opener.by === 'self' ? 'your identity' : items[opener.key.id]?.name ?? 'a key you hold'
  return (
    <div className="chest">
      <div className="chest__head">
        <span className="item__line">
          <span className="item__name" title={chest.name}>{chest.name}</span>
          <span className="item__meta" title={opensWith ? `Opens with ${opensWith}` : 'The hider’s label of what opens it'}>
            {entries ? 'OPEN' : `REQUIRES: ${requiresLabel(chest)}`} · hidden by {who}{!verified && <> · <Unsigned /></>}
          </span>
        </span>
        {opener && !entries && (
          <button className="chest__act" onClick={() => void open()} disabled={busy} title={`Decrypt it here with ${opensWith}`}>{busy ? 'OPENING' : 'OPEN'}</button>
        )}
      </div>
      {status && <span className="chest__status" role="status">{status}</span>}
      {entries && entries.length > 0 && (
        <ul className="chest__contents">
          {entries.map((e) => <ContentRow key={e.id} entry={e} from={from} place={place} />)}
        </ul>
      )}
    </div>
  )
}

/** One thing inside an opened chest, with TAKE. */
function ContentRow({ entry, from, place }: { entry: ChestEntry; from: HeldFrom; place: HeldPlace | null }): JSX.Element {
  const held = useInventory((s) => !!s.items[entry.id])
  const { label, coin } = entryLabel(entry)
  const type = entry.body.type
  const take = (): void => { useInventory.getState().take([entry], from, place) }
  return (
    <li className="chest__row">
      <span className={`chest__glyph chest__glyph--${coin ? 'cashu' : type}`} aria-hidden="true">{hiddenGlyph(type, coin)}</span>
      {type === 'chest' && entry.body.chest
        ? <ChestBlock id={entry.id} chest={entry.body.chest} author={entry.event.pubkey} verified={entry.verified} place={place} />
        : (
          <span className="item__line">
            <span className="item__name" title={label}>{label}</span>
            {!entry.verified && <Unsigned />}
          </span>
        )}
      {type === 'key'
        ? <span className="item__held" title="Reading a key is holding it: it is in your LOOT">IN YOUR LOOT</span>
        : <button className={`chest__act ${held ? 'is-on' : ''}`} onClick={take} disabled={held} title={held ? 'Already in your LOOT' : 'Copy it into your LOOT'}>{held ? 'TAKEN' : 'TAKE'}</button>}
    </li>
  )
}
