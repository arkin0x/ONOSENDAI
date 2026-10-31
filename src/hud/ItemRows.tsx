/**
 * ItemRows.tsx: the key line and the chest block, wherever found things are
 * listed (Keys and Chests B1 §3.2).
 *
 * A keypair item found says its name and who forged it, with TAKE, which
 * puts it in your ITEMS (arkinox, 2026-10-10: "keys ARE items"; the
 * TypeScript names keep saying key). Found is not held (arkinox, 2026-10-26:
 * "I dont want items to automatically be added to my inventory the moment i
 * decrypt them from a bag. i want to TAKE them"), so an item opens chests
 * only once it is taken. A chest says its name and what opens it; when
 * something you hold does (an item whose public key is the lock, or the lock
 * is your own identity), OPEN decrypts it where it stands and lists what is
 * inside, each row with TAKE, which copies the thing into ITEMS, and TAKE
 * ALL under the list (arkinox, 2026-10-26: "TAKE on each row. make the take
 * button bigger. add a TAKE ALL at the bottom of the list."). An item inside
 * is taken like anything else. A chest inside a chest is a chest block of
 * its own, so chaining reads as nesting.
 *
 * Used by the bag record (LootDetail), the nearby list (NearbyLootModal), the
 * item modal (SecretModal) and the ITEMS panel's taken chests, so a chest
 * opens the same way from every door. Opening is a local act: nothing is
 * published. An item's picture stands where its kind's icon would, in every
 * row that draws one (ItemFace); the key line itself is the words.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useProfile } from '../hooks/useProfile'
import { cashuLabel, readCashuToken } from '../lib/cashu'
import { chestSealer, openWithSecret, openWithSigner, openerFor, readContents, requiresLabel, revealedIn, type ChestEntry, type Opener } from '../lib/chests'
import { positionOf, useShards } from '../store/useShards'
import { hiddenLabel, type ChestItem } from '../lib/hidden'
import { ItemFace } from './ItemIcon'
import { ShardThumb } from './ShardThumb'
import { holdsEntry, openingKeys, type HeldFrom, type HeldItem, type HeldPlace } from '../lib/inventory'
import { safeNpub } from '../lib/npub'
import { useCyberspace } from '../store/useCyberspace'
import { useInventory } from '../store/useInventory'
import { forgetRefusal, openedByHand, openedContents, openedKey, readRefused, refuseRead, rememberOpened, useOpenedChests } from '../store/useOpenedChests'
import { celebrateOpen } from '../store/useOpenCeremony'
import { useCeremony } from '../store/useCeremony'
import { isDoor, lookOf } from '../lib/looks'
import { doorSecretWithKey, doorSecretWithSigner } from '../lib/doors'
import { doorAsFound, enterRoom } from '../store/rooms'
import { chestLoot } from '../lib/lootObjects'
import { landedAt } from '../lib/ceremony'
import { resumeAudio } from '../lib/audioContext'
import { prefersReducedMotion } from '../hooks/useReducedMotion'
import { profileLabel } from '../store/useProfiles'
import { useMutes } from '../store/useMutes'
import { hidesThing, type Muted } from '../lib/muteList'

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

/**
 * A keypair item where it was found: its name, who forged it, and TAKE, or
 * IN YOUR ITEMS once it is held. `id` is the find's event id; without one,
 * or for a thing that is not among this device's finds (one of your own,
 * held since you forged it), there is nothing to take.
 */
export function KeyLine({ id, name, author }: { id?: string; name: string; author: string }): JSX.Element {
  const who = useWho(author)
  const held = useInventory((s) => (id ? !!s.items[id] : false))
  const found = useShards((s) => (id ? !!s.discovered[id] : false))
  return (
    <span className="keyline">
      <span className="item__line">
        <span className="item__name" title={name}>{name}</span>
        <span className="item__meta">forged by {who}{held && <> · <span className="item__held" title="It is in your ITEMS">IN YOUR ITEMS</span></>}</span>
      </span>
      {id && found && !held && (
        <button className="chest__act chest__act--take" onClick={() => { useShards.getState().takeFound([id]) }} title="Put it in your ITEMS">TAKE</button>
      )}
    </span>
  )
}


/**
 * Whether this identity has a chest open here, by its id, under the lock it
 * has now (the chest as found or deployed): its contents are listed under it.
 */
export function useChestOpen(): (chestId: string | undefined) => boolean {
  const me = useCyberspace((s) => s.identity.pubkey)
  const opened = useOpenedChests((s) => s.opened)
  const discovered = useShards((s) => s.discovered)
  const mine = useShards((s) => s.mine)
  return useCallback((chestId: string | undefined) => {
    if (!chestId) return false
    const lock = (discovered[chestId] ?? mine.find((d) => d.eventId === chestId))?.chest?.lockPubkey
    return !!lock && !!openedContents(opened, me, chestId, lock)
  }, [me, opened, discovered, mine])
}

/**
 * A list with each thing once: a thing that came out of a chest that is in
 * the same list and open there is left to that chest's rows, where it has
 * its TAKE (review of #519: it was listed twice, and held two ways).
 */
export function listedOnce<T extends { type: string; chestId?: string }>(items: T[], idOf: (t: T) => string, open: (chestId: string) => boolean): T[] {
  const chests = new Set(items.filter((i) => i.type === 'chest').map(idOf))
  return items.filter((i) => !(i.chestId && chests.has(i.chestId) && open(i.chestId)))
}

/**
 * OPEN: decrypt a chest where it stands and read what is inside. With a
 * place, its contents are found in place too, as a scan's finds are. Holds
 * nothing: what is inside waits for TAKE (arkinox, 2026-10-26). Null when
 * the identity changed while the signer decrypted: what one identity's
 * signer opened is never filed or found under another (re-review of #519).
 */
export async function openChestHere(c: { id: string; chest: ChestItem; author: string; place: HeldPlace | null; sealer: string | undefined; door?: boolean }, opener: Exclude<Opener, null>): Promise<ChestEntry[] | null> {
  const me = useCyberspace.getState().identity.pubkey
  const raw = opener.by === 'key' ? openWithSecret(c.chest, opener.key.secretHex) : await openWithSigner(c.chest, useCyberspace.getState().decryptSealed)
  if (useCyberspace.getState().identity.pubkey !== me) return null
  const contents = readContents(raw, c.sealer)
  if (c.place) {
    // The room behind the door is drawn where the door stands.
    const door = { eventId: c.id, bagId: c.place.bagId, lookupId: c.place.lookupId, author: c.author, at: positionOf(c.place), plane: c.place.plane, height: c.place.height }
    const revealed = revealedIn(door, contents)
    useShards.getState().addDiscovered(revealed)
    // Behind a door, what is there appears as a scan's finds do, each settling
    // out of static where it stands (arkinox, 2026-10-30, door A). A chest's
    // contents float out of it instead (scene/ChestLoot).
    if (c.door) useCeremony.getState().mark(revealed)
  }
  // Opened by hand: it stays opened, and a reload opens it again (store/useOpenedChests).
  rememberOpened(me, c.id, c.chest.lockPubkey, contents)
  return contents
}

/** What is being read again, by openedKey, so two cards of one chest ask its signer once. */
const readingAgain = new Map<string, Promise<ChestEntry[] | null>>()

/**
 * A chest this identity opened by hand before, under the lock it has now,
 * whose contents this session has not read (a signer's chest after a reload:
 * the scan asks no signer), read again as OPEN read it. No ceremony: it is
 * open already, and drawn so.
 */
export function readAgain(c: Parameters<typeof openChestHere>[0], opener: Exclude<Opener, null>): Promise<ChestEntry[] | null> {
  const me = useCyberspace.getState().identity.pubkey
  const k = openedKey(me, c.id)
  const running = readingAgain.get(k)
  if (running) return running
  // Refused, a signer saying no: remembered for the session, so the card does not ask again until OPEN.
  const reading = openChestHere({ ...c, door: false }, opener)
    .catch((err: unknown) => { refuseRead(me, c.id, c.chest.lockPubkey); throw err })
    .finally(() => readingAgain.delete(k))
  readingAgain.set(k, reading)
  return reading
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
 * `verified`), `place` where it was found (null for a chest held in ITEMS
 * with no place of its own). `sealer` is the chest event's own pubkey when
 * its author is a fact, which vouches for the rumors inside (lib/chests.ts
 * readContents); without it, the chest is looked up among this device's
 * finds and deployments by `id`, and rumors read as claims if it is not
 * there. Never the bag's author: a chest inside a chest may be another's.
 */
export function ChestBlock({ id, chest, author, verified, place, sealer: given, named = true, inChest = false }: { id: string; chest: ChestItem; author: string; verified: boolean; place: HeldPlace | null; sealer?: string; named?: boolean; inChest?: boolean }): JSX.Element {
  const items = useInventory((s) => s.items)
  const me = useCyberspace((s) => s.identity.pubkey)
  const keys = useMemo(() => openingKeys(items), [items])
  const opener = useMemo(() => openerFor(chest, keys, me), [chest, keys, me])
  const found = useShards((s) => s.discovered[id])
  const ownInner = useShards((s) => s.mine.find((d) => d.eventId === id)?.inner)
  const sealer = chestSealer(given, found, ownInner)
  const opened = useOpenedChests((s) => s.opened)
  const entries = openedContents(opened, me, id, chest.lockPubkey)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const who = useWho(author)
  const from: HeldFrom = { chestId: id, chestName: chest.name }
  // What the mute list hides is neither listed nor held (store/useMutes); never in a chest of yours.
  const muted = useMutes((s) => s.muted)
  const shownOf = (list: ChestEntry[], m: Muted): ChestEntry[] => list.filter((e) => !hidesThing(m, { authors: [author, e.event.pubkey], ids: [e.id] }, me))
  const shown = entries ? shownOf(entries, muted) : null
  // A door locks a room where it stands (DECK-0004 §3.7): OPEN reads its
  // secret and opens the room. One found inside a chest never opens its room
  // (§3.7.1: a chest's contents are taken, not placed), whichever list or card it is opened from.
  const door = isDoor((found?.inner ?? ownInner)?.tags) && !inChest && !found?.chestId && !!place
  // Opened by hand before, under this lock: never OPEN again. What is inside
  // is read again once, as OPEN read it (readAgain); OPEN comes back only if
  // that fails, a signer refusing, and the refusal holds for the session
  // until OPEN is tapped (store/useOpenedChests readRefused).
  const handOpened = openedByHand(me, id, chest.lockPubkey)
  const readKey = `${openedKey(me, id)}:${chest.lockPubkey}`
  const tried = useRef<string | null>(null)
  const [, setRefusals] = useState(0)
  // Not a door: it holds no list to read again, and its room opens again from the kept secret (store/rooms reopenRoom).
  const rereading = !door && handOpened && !entries && !!opener && !readRefused(me, id, chest.lockPubkey)
  useEffect(() => {
    if (!rereading || !opener || tried.current === readKey) return
    tried.current = readKey
    readAgain({ id, chest, author, place, sealer }, opener)
      .then((contents) => { if (contents && contents.length === 0) setStatus('Opened: nothing inside this client can read.') })
      .catch((err: unknown) => { setRefusals((n) => n + 1); setStatus(err instanceof Error ? err.message : String(err)) })
    // Once per chest, lock and identity: the props it reads are those of that chest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rereading, readKey])

  const openDoor = async (first: boolean): Promise<void> => {
    if (!opener) return
    const secret = opener.by === 'key' ? doorSecretWithKey(chest, opener.key.secretHex) : await doorSecretWithSigner(chest, useCyberspace.getState().decryptSealed)
    if (useCyberspace.getState().identity.pubkey !== me) return
    if (!secret) { setStatus('This door holds nothing this client can read.'); return }
    const at = doorAsFound(id)
    if (!at) { setStatus('This door is no longer here.'); return }
    // What is behind it settles out of static where it stands (door A), the first time only.
    const opened = await enterRoom(at, secret, first ? (items) => useCeremony.getState().mark(items) : undefined)
    if (!opened) return
    celebrateOpen({ me, chestId: id, kind: 'door', first, calm: prefersReducedMotion() })
    if (!opened.found) setStatus('The room could not be retrieved.')
  }

  const open = async (): Promise<void> => {
    if (!opener || busy) return
    // Inside the tap, so a phone lets the ceremony's sound out (lib/audioContext).
    resumeAudio()
    // Once per chest, per identity, per device: a chest opened by hand before plays nothing.
    const first = !openedByHand(me, id, chest.lockPubkey)
    forgetRefusal(me, id, chest.lockPubkey)
    setBusy(true)
    setStatus(null)
    try {
      if (door) { await openDoor(first); return }
      const look = lookOf({ type: 'chest', event: found?.inner ?? ownInner })
      const contents = await openChestHere({ id, chest, author, place, sealer, door: look?.kind === 'door' && first }, opener)
      if (contents) {
        // The card yields and the chest or door opens where it stands (store/useOpenCeremony).
        if (look?.kind === 'door') celebrateOpen({ me, chestId: id, kind: 'door', first, calm: prefersReducedMotion() })
        else if (look?.kind === 'chest') {
          // The chime sounds as the last loot object lands over the chest.
          // The same loot the world draws over it (scene/ChestLooks), so the chime lands with the last of it.
          const loot = place ? chestLoot({ look: 'chest', entries: shownOf(contents, useMutes.getState().muted), held: (e) => holdsEntry(useInventory.getState().items, e), itemsReady: true }) : []
          celebrateOpen({ me, chestId: id, kind: 'chest', first, calm: prefersReducedMotion(), landMs: loot.length > 0 ? landedAt(loot.length) : undefined })
        }
      }
      if (contents && contents.length === 0) setStatus('Opened: nothing inside this client can read.')
    } catch (err) {
      // Refused again: OPEN stays, and the card does not ask by itself.
      refuseRead(me, id, chest.lockPubkey)
      setStatus(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const opensWith = opener === null ? null : opener.by === 'self' ? 'your identity' : items[opener.key.id]?.name ?? 'an item you hold'
  return (
    <div className="chest">
      <div className="chest__head">
        <span className="item__line">
          {/* The card names it above its look (SecretModal); every list names it here. */}
          {named && <span className="item__name" title={chest.name}>{chest.name}</span>}
          <span className="item__meta" title={opensWith ? `Opens with ${opensWith}` : 'The hider’s label of what opens it'}>
            {entries || rereading ? 'OPEN' : `REQUIRES: ${requiresLabel(chest)}`} · hidden by {who}{!verified && <> · <Unsigned /></>}
          </span>
        </span>
        {opener && !entries && (
          <button className="chest__act" onClick={() => void open()} disabled={busy || rereading} title={`Decrypt it here with ${opensWith}`}>{busy || rereading ? 'OPENING' : 'OPEN'}</button>
        )}
      </div>
      {status && <span className="chest__status" role="status">{status}</span>}
      {shown && shown.length > 0 && <ChestContents entries={shown} from={from} place={place} />}
    </div>
  )
}

/** What TAKE ALL takes: every content here not yet held. */
export function takeableOf(entries: ChestEntry[], items: Record<string, HeldItem>): ChestEntry[] {
  return entries.filter((e) => !holdsEntry(items, e))
}

/**
 * An opened chest's contents not yet held: a row each with TAKE, and TAKE
 * ALL under the last. What is held is not listed (arkinox, 2026-10-30: "if
 * an item is in your inventory and in the chest, hide it on the chest so it
 * feels like you took it"), so a row leaves the list as it is taken, and its
 * loot leaves the chest in the world (scene/ChestLoot). With everything
 * held, the list says so.
 */
export function ChestContents({ entries, from, place }: { entries: ChestEntry[]; from: HeldFrom; place: HeldPlace | null }): JSX.Element {
  const items = useInventory((s) => s.items)
  const takeable = useMemo(() => takeableOf(entries, items), [entries, items])
  if (takeable.length === 0) return <span className="chest__status" role="status">Everything here is in your ITEMS</span>
  return (
    <ul className="chest__contents">
      {takeable.map((e) => <ContentRow key={e.id} entry={e} from={from} place={place} />)}
      <li className="chest__all">
        <button className="chest__act chest__act--take" onClick={() => { useInventory.getState().take(takeable, from, place) }} title="Copy everything here into your ITEMS">TAKE ALL</button>
      </li>
    </ul>
  )
}

/** One thing inside an opened chest, with TAKE. */
function ContentRow({ entry, from, place }: { entry: ChestEntry; from: HeldFrom; place: HeldPlace | null }): JSX.Element {
  // One shard per model (arkinox, 2026-10-11): a model already held, under any name, reads TAKEN too.
  const held = useInventory((s) => holdsEntry(s.items, entry))
  const { label, coin } = entryLabel(entry)
  const type = entry.body.type
  const take = (): void => { useInventory.getState().take([entry], from, place) }
  return (
    <li className="chest__row">
      {type === 'shard' && entry.body.shard ? <ShardThumb shard={entry.body.shard} /> : <ItemFace className={`chest__glyph chest__glyph--${coin ? 'cashu' : type}`} type={type} coin={coin} image={entry.body.key?.image} />}
      {type === 'chest' && entry.body.chest
        ? <ChestBlock id={entry.id} chest={entry.body.chest} author={entry.event.pubkey} verified={entry.verified} place={place} sealer={entry.verified ? entry.event.pubkey : undefined} inChest />
        : (
          <span className="item__line">
            <span className="item__name" title={label}>{label}</span>
            {!entry.verified && <Unsigned />}
          </span>
        )}
      <button className={`chest__act chest__act--take ${held ? 'is-on' : ''}`} onClick={take} disabled={held} title={held ? 'Already in your ITEMS' : 'Copy it into your ITEMS'}>{held ? 'TAKEN' : 'TAKE'}</button>
    </li>
  )
}
