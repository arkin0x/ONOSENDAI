/**
 * ChestCompose.tsx: the chest modal, before a chest is sealed and whenever
 * its hider changes what it holds (Keys and Chests B1 §3.1; chest and door
 * design R18, 3.1, 4.8).
 *
 * SEAL A CHEST places first (arkinox, 2026-10-26, R18: "placed first, then
 * filled with ADD"; 2026-10-31: "tap, choose location, choose contents"):
 * the hide bar picks the place, the model, SCALE, TURN, WALK and the height,
 * and PLACE CHEST fixes where it lands (useShards placeChest). This modal is
 * what comes next, `place`: the chest in 3D across the top, its name, its
 * lock, what opens it, and ADD. SEAL & PUBLISH (or LOCAL) seals and hides it
 * where it was placed; MOVE goes back to the bar with the draft kept.
 *
 * On a chest of yours already hidden, EDIT and ADD open the same modal on
 * what it holds (`edit`): its name, lock and label (EDIT), and its contents,
 * each one kept exactly as it was sealed unless taken out with ×, with ADD
 * for more. SAVE seals it again where it stands (useShards resealChest).
 *
 * A chest is sealed to an item in your ITEMS, to a listed item from the
 * ITEM FEED (arkinox, 2026-10-13), or to a pasted item public key or npub,
 * which seals it to a person. The select is text only: an <option> cannot
 * hold an item's picture. The meter shows the sealed size against NIP-44's
 * 65,535 bytes, and sealing is refused past it, in the same words the seal
 * would use.
 *
 * What is inside is taken, not placed (DECK-0004 §3.4, spec #82): nothing in
 * a chest is aimed at a point of its own any more. A door is for that.
 */

import { useEffect, useMemo, useState } from 'react'
import { ShardSpin } from '../scene/ShardSpin'
import { readContents } from '../lib/chests'
import { entryKey, type BagEntry, type HiddenType } from '../lib/hidden'
import { turnShard } from '../lib/turn'
import { ItemFeedPicker } from './ItemFeedPicker'
import { lockFromListing } from '../lib/itemListing'
import { ItemIcon } from './ItemIcon'
import { ShardFolders, modelEditedAt, modelName, modelRef, useNewestFirst } from './ShardFolders'
import { ShardThumb } from './ShardThumb'
import type { ShardModel } from 'sno-core/shards'
import { nip19 } from 'nostr-tools'
import { forgeKey, isLockPubkey, NIP44_MAX_PLAINTEXT, sizeRefusal, templateBytes } from '../lib/chests'
import { attributed } from '../lib/client'
import { MAX_ITEM_NAME, MAX_MESSAGE_LENGTH, keyInnerTemplate, messageInnerTemplate, shardInnerTemplate } from '../lib/hidden'
import { findCashuToken } from '../lib/cashu'
import { hasNftLink } from '../lib/nftLink'
import { useCyberspace } from '../store/useCyberspace'
import { useInventory } from '../store/useInventory'
import { lookModelOf, useShards, type ChestContent, type ChestDraft, type ChestLock } from '../store/useShards'
import { creditOf, useWorkshop } from '../store/useWorkshop'
import { composeVerdict, SETTLE_MS, useCashu } from './useCashu'
import { useSettled } from './useSettled'
import { AudioUpload } from './AudioCompose'
import { audioInnerTemplate } from '../lib/audioItem'

/** A pasted lock: an item's public key as hex, or a person's npub; either must name a point on the curve. */
function parseLock(text: string): ChestLock | null {
  const t = text.trim()
  if (isLockPubkey(t)) return { pubkey: t, label: 'a pasted key' }
  try {
    const d = nip19.decode(t)
    if (d.type === 'npub' && isLockPubkey(d.data)) return { pubkey: d.data, label: 'a person' }
  } catch { /* not an npub */ }
  return null
}

/** A ten-digit time, the width every created_at has for decades, so the meter's count is the deploy's. */
const SAMPLE_CREATED_AT = 1_700_000_000

/** What a content row says. */
function contentLabel(c: ChestContent, shardName: (id: string) => string): string {
  if (c.kind === 'message') return findCashuToken(c.text) ? 'message with a cashu token' : hasNftLink(c.text) ? 'message with an NFT link' : c.text.trim().replace(/\s+/g, ' ').slice(0, 48)
  if (c.kind === 'shard') return shardName(c.shardId)
  if (c.kind === 'audio') return c.audio.title
  if (c.kind === 'sealed') return c.label
  return c.key.name
}

/** What a row's icon is: its kind, a kept entry's own. */
function contentType(c: ChestContent): HiddenType {
  return c.kind === 'sealed' ? c.type : c.kind
}

/** What a chest of yours holds, as the modal lists it: each entry kept as sealed, named as its row would be. */
export function sealedContents(entries: BagEntry[], sealer: string): ChestContent[] {
  const read = new Map(readContents(entries, sealer).map((e) => [e.id, e]))
  const out: ChestContent[] = []
  for (const entry of entries) {
    const k = entryKey(entry)
    const r = typeof k === 'string' ? read.get(k) ?? [...read.values()].find((x) => (entry as { id?: string }).id === x.id) : undefined
    if (!r) { out.push({ kind: 'sealed', entry, label: 'something this client cannot read', type: 'message' }); continue }
    const body = r.body
    const label = body.type === 'message' ? (findCashuToken(body.text ?? '') ? 'message with a cashu token' : (body.text ?? '').trim().replace(/\s+/g, ' ').slice(0, 48)) : body.type === 'shard' ? body.shard?.name ?? 'model' : body.type === 'key' ? body.key?.name ?? 'item' : body.type === 'audio' ? body.audio?.title ?? 'audio' : body.chest?.name ?? 'chest'
    out.push({ kind: 'sealed', entry, label, type: body.type })
  }
  return out
}

/** Which chest the modal is for: the one just placed, or one of yours already hidden (EDIT shows its name and lock, ADD only its contents). */
export type ChestModalMode = { mode: 'place' } | { mode: 'edit'; eventId: string; fields: boolean }

export function ChestCompose({ onDone, target = { mode: 'place' } }: { onDone: () => void; target?: ChestModalMode }): JSX.Element {
  const editing = target.mode === 'edit' ? target : null
  // A door: a name, a lock and what opens it, and no contents; what it locks is placed in the world (4.2).
  const isDoor = useShards((s) => (editing ? s.mine.find((d) => d.eventId === editing.eventId)?.chest?.door !== undefined : s.pending?.type === 'chest' && !!s.pending.door))
  // The chest being placed: what the bar handed over (useShards placeChest).
  const pending = useShards((s) => (s.pending?.type === 'chest' ? s.pending : null))
  const hidden = useShards((s) => (editing ? s.mine.find((d) => d.eventId === editing.eventId) ?? null : null))
  const me = useCyberspace((s) => s.identity.pubkey)
  const live = useCyberspace((s) => s.live)
  const items = useInventory((s) => s.items)
  const keys = useMemo(() => Object.values(items).filter((it) => it.type === 'key' && it.key).sort((a, b) => b.at - a.at), [items])
  const models = useWorkshop((s) => s.shards)
  // + SHARD's list: last edited or deployed first, as the workshop's (Workshop.tsx).
  const byRecent = useNewestFirst(models, modelRef, modelEditedAt)
  const modelOf = (id: string): ShardModel | undefined => models.find((s) => s.id === id)
  const shardName = (id: string): string => modelOf(id)?.name ?? 'model'

  // Where the draft starts: the placed chest's, or the hidden chest's own.
  const start = useMemo((): ChestDraft => {
    if (hidden?.chest) {
      const c = hidden.chest
      const held = keys.find((k) => k.key?.itemPubkey === c.lockPubkey)
      return { name: c.name, requires: c.requires, contents: [], lock: { pubkey: c.lockPubkey, label: held ? held.name : c.lockPubkey === me ? 'a person' : c.requires || 'its lock' } }
    }
    return pending ? { name: pending.name, lock: pending.lock, requires: pending.requires, contents: pending.contents } : { name: '', lock: null, requires: '', contents: [] }
    // Read once, when the modal opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [name, setName] = useState(start.name)
  const [requires, setRequires] = useState(start.requires)
  // A restored label that was never written still follows the lock once one is picked.
  const [requiresTouched, setRequiresTouched] = useState(start.requires.trim() !== '')
  const kept = start.lock
  const [lockKeyId, setLockKeyId] = useState<string>(() => (kept ? keys.find((k) => k.key?.itemPubkey === kept.pubkey)?.id ?? '' : keys[0]?.id ?? ''))
  // A lock chosen from the ITEM FEED: a listed item, held or not. A kept lock that is neither held, a person nor pasted came from there.
  const [feedLock, setFeedLock] = useState<ChestLock | null>(() => (kept && kept.label !== 'a person' && kept.label !== 'a pasted key' && !keys.some((k) => k.key?.itemPubkey === kept.pubkey) ? kept : null))
  const [picking, setPicking] = useState(false)
  const [pasted, setPasted] = useState(kept && kept.label === 'a pasted key' && !keys.some((k) => k.key?.itemPubkey === kept.pubkey) ? kept.pubkey : kept?.label === 'a person' ? nip19.npubEncode(kept.pubkey) : '')
  const [contents, setContents] = useState<ChestContent[]>(start.contents)
  // A hidden chest's contents, opened from what this device kept, or with what opens it.
  const [loading, setLoading] = useState(!!editing && !isDoor)
  const [status, setStatus] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!editing || isDoor) return
    let on = true
    void useShards.getState().chestEntries(editing.eventId).then((r) => {
      if (!on) return
      setLoading(false)
      if (typeof r === 'string') setStatus(r)
      else setContents(sealedContents(r, hidden?.inner.pubkey ?? me))
    })
    return () => { on = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // What is being added: one editor open at a time.
  const [adding, setAdding] = useState<'message' | 'shard' | 'key' | 'audio' | null>(null)
  const [text, setText] = useState('')
  const [keyName, setKeyName] = useState('')

  const heldLock = keys.find((k) => k.id === lockKeyId)
  const lock: ChestLock | null = heldLock?.key ? { pubkey: heldLock.key.itemPubkey, label: heldLock.name } : feedLock ?? parseLock(pasted)
  // The hider's label of what opens it starts as the lock's own name until typed over.
  useEffect(() => {
    if (requiresTouched) return
    setRequires(heldLock ? `the ${heldLock.name}` : feedLock ? `the ${feedLock.label}` : lock?.label === 'a person' ? 'being the one it was sealed for' : '')
  }, [heldLock, feedLock, lock?.label, requiresTouched])

  // A Cashu token in a message is read, and its mint asked, once the text holds still.
  const settled = useSettled(text, SETTLE_MS) === text
  const cashu = useCashu(adding === 'message' && settled ? text : null)
  const verdict = composeVerdict(settled, cashu)

  // The sealed size, as the seal will see it: every content as the event it
  // becomes, built the way sealChest builds it (useShards), each template
  // attributed with the client tag the signer adds, a created_at as wide as
  // the real one; a kept entry as it is.
  const bytes = useMemo(() => {
    const at = { x: 0n, y: 0n, z: 0n }
    const kept = contents.filter((c): c is Extract<ChestContent, { kind: 'sealed' }> => c.kind === 'sealed').map((c) => c.entry)
    const templates = contents.flatMap((c) => {
      if (c.kind === 'sealed') return []
      if (c.kind === 'message') return [attributed(messageInnerTemplate(c.text.trim(), at, 0, SAMPLE_CREATED_AT))]
      if (c.kind === 'key') return [attributed(keyInnerTemplate(c.key, at, 0, SAMPLE_CREATED_AT))]
      if (c.kind === 'audio') return [attributed(audioInnerTemplate(c.audio, at, 0, SAMPLE_CREATED_AT))]
      if (c.aimed) { const { kind, created_at, tags, content } = c.aimed.signed; return [{ kind, created_at, tags, content }] }
      const model = models.find((s) => s.id === c.shardId)
      return [attributed(model ? shardInnerTemplate(model, at, 0, SAMPLE_CREATED_AT, creditOf(model)) : messageInnerTemplate('', at, 0, SAMPLE_CREATED_AT))]
    })
    const fresh = templateBytes(templates, me || '0'.repeat(64))
    // Two JSON lists joined: the kept entries' bytes, less their brackets, and a comma between.
    if (kept.length === 0) return fresh
    const old = new TextEncoder().encode(JSON.stringify(kept)).length
    return templates.length === 0 ? old : old + fresh - 1
  }, [contents, models, me])
  const refusal = sizeRefusal(bytes)

  const add = (c: ChestContent): void => { setContents((list) => [...list, c]); setAdding(null); setText(''); setKeyName('') }
  const remove = (i: number): void => setContents((list) => list.filter((_, j) => j !== i))
  const ready = name.trim().length > 0 && !!lock && (isDoor || contents.length > 0) && !refusal && !loading
  const current = (): ChestDraft => ({ name: name.trim(), lock, requires: requires.trim(), contents })
  // Placing: the draft rides on the chest being placed, so closing the modal (back to the bar) keeps it.
  useEffect(() => {
    if (!editing) useShards.getState().keepChestDraft({ name: name.trim(), lock, requires: requires.trim(), contents })
    // lock is derived from these three
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, name, requires, contents, lockKeyId, feedLock, pasted])

  // Placing: the deploy's own state, shown here while the bar is out of the way.
  const deployStatus = useShards((s) => s.deployStatus)
  const deployNote = useShards((s) => s.deployNote)
  const deployError = useShards((s) => s.deployError)
  const ask = useShards((s) => s.deployAsk)
  const working = deployStatus === 'working' || saving
  const seal = (): void => {
    if (!ready || !lock) return
    if (editing) {
      setSaving(true); setStatus(null)
      const saved = isDoor ? useShards.getState().resealDoor(editing.eventId, { name: name.trim(), requires: requires.trim(), lock }) : useShards.getState().resealChest(editing.eventId, { ...current(), lock })
      void saved.then((why) => { setSaving(false); if (why) setStatus(why); else onDone() })
      return
    }
    void useShards.getState().sealPlacedChest({ ...current(), lock })
  }
  // MOVE before it is sealed: back to the hide bar, the draft kept on the chest being placed.
  const move = (): void => { useShards.getState().unplaceChest(current()); onDone() }
  const cancel = (): void => { if (!editing) useShards.getState().cancelDeploy(true); onDone() }

  // The chest in 3D across the top, as it will stand: the model the bar chose, turned as the bar turned it.
  const turn = useShards((s) => s.deployTurn)
  const look = useMemo(() => {
    if (editing || !pending?.look) return null
    const m = lookModelOf(pending.look)
    return m ? turnShard(m, turn) : null
  }, [editing, pending?.look, turn])
  const fields = !editing || editing.fields

  return (
    <div className="shards__compose">
      {look && <div className="secret__spin secret__spin--look"><ShardSpin shard={look} size={150} wide /></div>}
      {fields && <input className="avatars__input" value={name} onChange={(e) => setName(e.target.value.slice(0, MAX_ITEM_NAME))} placeholder={isDoor ? 'Name the door' : 'Name the chest'} maxLength={MAX_ITEM_NAME} autoFocus={!editing || editing.fields} aria-label={isDoor ? 'Door name' : 'Chest name'} />}

      {/* The lock: an item you hold, or a pasted public key. */}
      {fields && (
        <div className="compose__row">
          <span className="legend__label">Lock</span>
          <select className="avatars__input compose__select" value={lockKeyId} onChange={(e) => { setLockKeyId(e.target.value); if (e.target.value) setFeedLock(null) }} aria-label="Seal to an item you hold" title={`An item in your ITEMS: whoever holds it opens the ${isDoor ? 'door' : 'chest'}`}>
            <option value="">{keys.length === 0 ? 'no items in your ITEMS' : 'paste a public key below'}</option>
            {keys.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
          <button className="chest__act" onClick={() => setPicking(true)} title="Choose a listed item from the ITEM FEED, even one you have never held">ITEM FEED</button>
        </div>
      )}
      {fields && !heldLock && feedLock && (
        <div className="compose__row">
          <span className="item__name" title={feedLock.pubkey}>sealed to {feedLock.label}, from the item feed</span>
          <button className="chest__act" onClick={() => setFeedLock(null)} aria-label="Clear the item feed lock" title="Clear this lock">×</button>
        </div>
      )}
      {picking && (
        <ItemFeedPicker
          onClose={() => setPicking(false)}
          onPick={(l) => {
            const held = keys.find((k) => k.key?.itemPubkey === l.itemPubkey)
            if (held) { setLockKeyId(held.id); setFeedLock(null) } else { setLockKeyId(''); setFeedLock(lockFromListing(l)) }
            setPasted('')
            setPicking(false)
          }}
        />
      )}
      {fields && !heldLock && !feedLock && (
        <input className={`avatars__input ${pasted.trim() && !lock ? 'is-bad' : ''}`} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="an item public key (hex) or an npub" spellCheck={false} autoComplete="off" aria-label="Seal to a pasted public key" title="An item’s public key seals it to that item; an npub seals it to that person" />
      )}
      {fields && <input className="avatars__input" value={requires} onChange={(e) => { setRequires(e.target.value.slice(0, MAX_ITEM_NAME)); setRequiresTouched(true) }} placeholder="What opens it, for those who cannot" maxLength={MAX_ITEM_NAME} aria-label="Requires" title={`Shown to anyone who finds the ${isDoor ? 'door' : 'chest'} without its key`} />}

      {/* The contents, one editor at a time. A door has none. */}
      {isDoor ? null : <>
      {loading && <span className="chest__status" role="status">OPENING</span>}
      {contents.length > 0 && (
        <ul className="compose__list">
          {contents.map((c, i) => (
            <li key={i} className="chest__row">
              {c.kind === 'shard' && modelOf(c.shardId) ? <ShardThumb shard={modelOf(c.shardId)!} own /> : <ItemIcon className={`chest__glyph chest__glyph--${c.kind === 'message' && findCashuToken(c.text) ? 'cashu' : contentType(c)}`} type={contentType(c)} coin={c.kind === 'message' && !!findCashuToken(c.text)} />}
              <span className="item__name" title={contentLabel(c, shardName)}>{contentLabel(c, shardName)}</span>
              <button className="chest__act" onClick={() => remove(i)} aria-label="Take it out" title="Take it out of the chest">×</button>
            </li>
          ))}
        </ul>
      )}
      {adding === null ? (
        <div className="compose__row">
          <button className="chest__act" onClick={() => setAdding('message')} title="A message, which may hold a cashu token">+ MESSAGE</button>
          <button className="chest__act" onClick={() => setAdding('shard')} disabled={models.length === 0} title={models.length === 0 ? 'Nothing in your workshop yet' : 'One of your workshop models'}>+ SHARD</button>
          <button className="chest__act" onClick={() => setAdding('key')} title="A new item forged here, for the next chest">+ ITEM</button>
          <button className="chest__act" onClick={() => setAdding('audio')} title="An audio file, encrypted and uploaded now">+ AUDIO</button>
        </div>
      ) : adding === 'audio' ? (
        <AudioUpload idPrefix="chest-audio" submitLabel="ADD" onReady={(audio) => add({ kind: 'audio', audio })} onCancel={() => setAdding(null)} />
      ) : adding === 'message' ? (
        <>
          <textarea className="shards__textarea" value={text} onChange={(e) => setText(e.target.value.slice(0, MAX_MESSAGE_LENGTH))} placeholder="A message, or a cashu token" rows={3} autoFocus aria-label="Message to seal" />
          {verdict.note && <span className={`shards__compose-note shards__compose-note--${verdict.tone}`} role="status">{verdict.note}</span>}
          <div className="compose__row">
            <button className="chest__act" onClick={() => { setAdding(null); setText('') }}>CANCEL</button>
            <button className="chest__act" disabled={!text.trim() || !verdict.ready} onClick={() => add({ kind: 'message', text: text.trim() })}>ADD</button>
          </div>
        </>
      ) : adding === 'shard' ? (
        <>
          <ul className="objpick__list compose__models" aria-label="Model to seal">
            <ShardFolders items={byRecent} refOf={modelRef} nameOf={modelName} row={(s, f) => (
              <li key={s.id} {...f.drag}>
                <button className="objpick__row" onClick={() => add({ kind: 'shard', shardId: s.id })} title={`Seal "${s.name}" in the chest`}>
                  <ShardThumb shard={s} own />
                  <span className="objpick__name">{s.name}</span>
                  <span className="objpick__meta">{s.vertices.length} v · {s.faces.length} f{s.parts?.length ? ` · ${s.parts.length} obj` : ''}</span>
                </button>
                {f.tool}
              </li>
            )} />
          </ul>
          <div className="compose__row">
            <button className="chest__act" onClick={() => setAdding(null)}>CANCEL</button>
          </div>
        </>
      ) : (
        <div className="compose__row">
          <input className="avatars__input" value={keyName} onChange={(e) => setKeyName(e.target.value.slice(0, MAX_ITEM_NAME))} placeholder="Name the item inside" maxLength={MAX_ITEM_NAME} autoFocus aria-label="Item to seal" />
          <button className="chest__act" onClick={() => { setAdding(null); setKeyName('') }}>CANCEL</button>
          <button className="chest__act" disabled={!keyName.trim()} onClick={() => add({ kind: 'key', key: forgeKey(keyName.trim()) })}>ADD</button>
        </div>
      )}

      {/* The one hard limit, as a meter. */}
      <div className={`compose__meter ${refusal ? 'is-over' : ''}`} title="NIP-44 seals at most 65,535 bytes">
        <span>{refusal ?? (contents.length === 0 ? 'Nothing inside yet.' : `sealed to ${lock ? lock.label : 'nothing yet'}`)}</span>
        <span>{bytes.toLocaleString('en-US')}/{NIP44_MAX_PLAINTEXT.toLocaleString('en-US')} B</span>
      </div>
      </>}

      {(status ?? (editing ? null : deployError)) && <span className="chest__status notice" role="status">{status ?? deployError}</span>}
      {!editing && ask ? (
        <div className="shards__actions">
          <button className="avatars__go" onClick={() => useShards.getState().confirmDeploy()}>{ask.sats !== null ? `${ask.sats} SATS` : 'SEAL VIA HOSAKA'}</button>
          <button className="avatars__go" onClick={() => useShards.getState().declineDeploy()}>NOT NOW</button>
        </div>
      ) : (
        <div className="shards__actions">
          <button className="avatars__go" onClick={cancel} disabled={working}>CANCEL</button>
          {!editing && <button className="avatars__go" onClick={move} disabled={working} title="Back to the hide bar, to place it somewhere else">MOVE</button>}
          <button className="avatars__go" disabled={!ready || working} onClick={seal} title={refusal ?? (!lock ? 'Pick an item or paste a public key to seal to' : !isDoor && contents.length === 0 ? 'Put something in it first' : editing ? 'Seal it again where it stands' : undefined)}>
            {working ? (deployNote && !editing ? `${deployNote.toUpperCase()}…` : 'SEALING…') : editing ? 'SAVE' : live ? 'SEAL & PUBLISH' : 'SEAL (LOCAL)'}
          </button>
        </div>
      )}
    </div>
  )
}
