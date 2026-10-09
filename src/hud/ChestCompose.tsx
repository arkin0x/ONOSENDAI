/**
 * ChestCompose.tsx: sealing a chest to hide (Keys and Chests B1 §3.1).
 *
 * A chest has a name, a lock and contents. The lock is one of your LOOT keys
 * (so you can seal to a key you forged, or to one you found that someone else
 * forged), or a pasted item public key or npub, which seals it to a person.
 * The contents are a message (which may hold a Cashu token, checked at the
 * mint as a hidden message is), one of your workshop models, or a new key
 * forged here, for chaining. Nothing is signed or sealed in the composer: the
 * deploy does that at the place it lands (useShards `deploy`). The meter
 * shows the sealed size against NIP-44's 65,535 bytes, and PLACE CHEST is
 * refused past it, in the same words the deploy would use.
 *
 * Nested chests are read and opened wherever they are found, but not composed
 * here: a chest inside a chest would need this whole composer inside itself.
 */

import { useEffect, useMemo, useState } from 'react'
import { nip19 } from 'nostr-tools'
import { forgeKey, NIP44_MAX_PLAINTEXT, sizeRefusal, templateBytes } from '../lib/chests'
import { MAX_ITEM_NAME, MAX_MESSAGE_LENGTH, hiddenGlyph, keyInnerTemplate, messageInnerTemplate, shardInnerTemplate } from '../lib/hidden'
import { findCashuToken } from '../lib/cashu'
import { useBuilder } from '../store/useBuilder'
import { useCyberspace } from '../store/useCyberspace'
import { useInventory } from '../store/useInventory'
import { useShards, type ChestContent, type ChestLock } from '../store/useShards'
import { useWorkshop } from '../store/useWorkshop'
import { composeVerdict, SETTLE_MS, useCashu } from './useCashu'
import { useSettled } from './useSettled'

const HEX_64 = /^[0-9a-f]{64}$/

/** A pasted lock: an item's public key as hex, or a person's npub. */
function parseLock(text: string): ChestLock | null {
  const t = text.trim()
  if (HEX_64.test(t)) return { pubkey: t, label: 'a pasted key' }
  try {
    const d = nip19.decode(t)
    if (d.type === 'npub') return { pubkey: d.data, label: 'a person' }
  } catch { /* not an npub */ }
  return null
}

/** What a content row says. */
function contentLabel(c: ChestContent, shardName: (id: string) => string): string {
  if (c.kind === 'message') return findCashuToken(c.text) ? 'message with a cashu token' : c.text.trim().replace(/\s+/g, ' ').slice(0, 48)
  if (c.kind === 'shard') return shardName(c.shardId)
  return c.key.name
}

export function ChestCompose({ onDone }: { onDone: () => void }): JSX.Element {
  // A chest whose deploy ended under it comes back whole (useBuilder `itemDraft`).
  const draft = useMemo(() => { const d = useBuilder.getState().itemDraft; return d?.type === 'chest' ? d : null }, [])
  useEffect(() => { useBuilder.getState().takeItemDraft('chest') }, [])
  const me = useCyberspace((s) => s.identity.pubkey)
  const items = useInventory((s) => s.items)
  const keys = useMemo(() => Object.values(items).filter((it) => it.type === 'key' && it.key).sort((a, b) => b.at - a.at), [items])
  const models = useWorkshop((s) => s.shards)
  const shardName = (id: string): string => models.find((s) => s.id === id)?.name ?? 'model'

  const [name, setName] = useState(draft?.name ?? '')
  const [requires, setRequires] = useState(draft?.requires ?? '')
  const [requiresTouched, setRequiresTouched] = useState(!!draft)
  // The lock: a held key by its id, or pasted text.
  const [lockKeyId, setLockKeyId] = useState<string>(() => (draft ? '' : keys[0]?.id ?? ''))
  const [pasted, setPasted] = useState(draft && draft.lock.label !== 'a person' && !keys.some((k) => k.key?.itemPubkey === draft.lock.pubkey) ? draft.lock.pubkey : draft?.lock.label === 'a person' ? nip19.npubEncode(draft.lock.pubkey) : '')
  const [contents, setContents] = useState<ChestContent[]>(draft?.contents ?? [])
  // What is being added: one editor open at a time.
  const [adding, setAdding] = useState<'message' | 'shard' | 'key' | null>(null)
  const [text, setText] = useState('')
  const [shardId, setShardId] = useState(models[0]?.id ?? '')
  const [keyName, setKeyName] = useState('')

  const heldLock = keys.find((k) => k.id === lockKeyId)
  const lock: ChestLock | null = heldLock?.key ? { pubkey: heldLock.key.itemPubkey, label: heldLock.name } : parseLock(pasted)
  // The hider's label of what opens it starts as the lock's own name until typed over.
  useEffect(() => {
    if (requiresTouched) return
    setRequires(heldLock ? `the ${heldLock.name}` : lock?.label === 'a person' ? 'being the one it was sealed for' : '')
  }, [heldLock, lock?.label, requiresTouched])

  // A Cashu token in a message is read, and its mint asked, once the text holds still.
  const settled = useSettled(text, SETTLE_MS) === text
  const cashu = useCashu(adding === 'message' && settled ? text : null)
  const verdict = composeVerdict(settled, cashu)

  // The sealed size, as the deploy will see it: every content as the event it becomes.
  const bytes = useMemo(() => {
    const at = { x: 0n, y: 0n, z: 0n }
    const templates = contents.map((c) => {
      if (c.kind === 'message') return messageInnerTemplate(c.text, at, 0, 0)
      if (c.kind === 'key') return keyInnerTemplate(c.key, at, 0, 0)
      const model = models.find((s) => s.id === c.shardId)
      return model ? shardInnerTemplate(model, at, 0, 0) : messageInnerTemplate('', at, 0, 0)
    })
    return templateBytes(templates, me || '0'.repeat(64))
  }, [contents, models, me])
  const refusal = sizeRefusal(bytes)

  const add = (c: ChestContent): void => { setContents((list) => [...list, c]); setAdding(null); setText(''); setKeyName('') }
  const remove = (i: number): void => setContents((list) => list.filter((_, j) => j !== i))
  const ready = name.trim().length > 0 && !!lock && contents.length > 0 && !refusal
  const place = (): void => {
    if (!ready || !lock) return
    useShards.getState().startDeployChest({ name: name.trim(), lock, requires: requires.trim(), contents })
    onDone()
  }

  return (
    <div className="shards__compose">
      <input className="avatars__input" value={name} onChange={(e) => setName(e.target.value.slice(0, MAX_ITEM_NAME))} placeholder="Name the chest" maxLength={MAX_ITEM_NAME} autoFocus aria-label="Chest name" />

      {/* The lock: a key you hold, or a pasted public key. */}
      <div className="compose__row">
        <span className="legend__label">Lock</span>
        <select className="avatars__input compose__select" value={lockKeyId} onChange={(e) => setLockKeyId(e.target.value)} aria-label="Seal to a key you hold" title="A key in your LOOT: whoever holds it opens the chest">
          <option value="">{keys.length === 0 ? 'no keys in your LOOT' : 'paste a key below'}</option>
          {keys.map((k) => <option key={k.id} value={k.id}>⚷ {k.name}</option>)}
        </select>
      </div>
      {!heldLock && (
        <input className={`avatars__input ${pasted.trim() && !lock ? 'is-bad' : ''}`} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="an item public key (hex) or an npub" spellCheck={false} autoComplete="off" aria-label="Seal to a pasted public key" title="A key’s public key seals it to that key; an npub seals it to that person" />
      )}
      <input className="avatars__input" value={requires} onChange={(e) => { setRequires(e.target.value.slice(0, MAX_ITEM_NAME)); setRequiresTouched(true) }} placeholder="What opens it, for those who cannot" maxLength={MAX_ITEM_NAME} aria-label="Requires" title="Shown to anyone who finds the chest without its key" />

      {/* The contents, one editor at a time. */}
      {contents.length > 0 && (
        <ul className="compose__list">
          {contents.map((c, i) => (
            <li key={i} className="chest__row">
              <span className={`chest__glyph chest__glyph--${c.kind === 'message' && findCashuToken(c.text) ? 'cashu' : c.kind}`} aria-hidden="true">{hiddenGlyph(c.kind, c.kind === 'message' && !!findCashuToken(c.text))}</span>
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
          <button className="chest__act" onClick={() => setAdding('key')} title="A new key forged here, for the next chest">+ KEY</button>
        </div>
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
        <div className="compose__row">
          <select className="avatars__input compose__select" value={shardId} onChange={(e) => setShardId(e.target.value)} aria-label="Model to seal">
            {models.map((s) => <option key={s.id} value={s.id}>◇ {s.name}</option>)}
          </select>
          <button className="chest__act" onClick={() => setAdding(null)}>CANCEL</button>
          <button className="chest__act" disabled={!shardId} onClick={() => add({ kind: 'shard', shardId })}>ADD</button>
        </div>
      ) : (
        <div className="compose__row">
          <input className="avatars__input" value={keyName} onChange={(e) => setKeyName(e.target.value.slice(0, MAX_ITEM_NAME))} placeholder="Name the key inside" maxLength={MAX_ITEM_NAME} autoFocus aria-label="Key to seal" />
          <button className="chest__act" onClick={() => { setAdding(null); setKeyName('') }}>CANCEL</button>
          <button className="chest__act" disabled={!keyName.trim()} onClick={() => add({ kind: 'key', key: forgeKey(keyName.trim()) })}>ADD</button>
        </div>
      )}

      {/* The one hard limit, as a meter. */}
      <div className={`compose__meter ${refusal ? 'is-over' : ''}`} title="NIP-44 seals at most 65,535 bytes">
        <span>{refusal ?? (contents.length === 0 ? 'Nothing inside yet.' : `sealed to ${lock ? lock.label : 'nothing yet'}`)}</span>
        <span>{bytes.toLocaleString('en-US')}/{NIP44_MAX_PLAINTEXT.toLocaleString('en-US')} B</span>
      </div>

      <div className="shards__actions">
        <button className="avatars__go" onClick={onDone}>CANCEL</button>
        <button className="avatars__go" disabled={!ready} onClick={place} title={refusal ?? (!lock ? 'Pick a key or paste a public key to seal to' : contents.length === 0 ? 'Put something in it first' : 'Aim it at the build cursor; it is signed and sealed when hidden')}>PLACE CHEST ▸</button>
      </div>
    </div>
  )
}
