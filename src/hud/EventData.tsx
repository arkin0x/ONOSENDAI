/**
 * EventData.tsx: the nostr event behind a modal, at the bottom of it, under
 * the actions (arkinox, 2026-10-20): its id, `d` tag, pubkey and created_at,
 * each copied by a tap with COPIED in its place for a moment, and below them
 * the whole event as JSON in Monaspace Krypton. The field has no COPY
 * (arkinox, 2026-10-20: "we don't have to have a full event copy ... if
 * someone wants to copy, they can manually do it"): its text can still be
 * selected.
 *
 * A key item's secret is never shown or copied (lib/chests: "The secret is
 * shown to nobody"): it opens every chest sealed to the key, and a
 * screenshot or a pasted event would hand that to whoever saw it (review of
 * #399). The field shows the event with the secret hidden, and says that
 * the event shown will not verify. A message's nonfungible.cash claim link
 * is the same kind of thing: its key, after the `#`, claims the NFT, so the
 * key is hidden here too, and the link's id is left to read (lib/nftLink).
 *
 * Its kind is named too, and for a thing this device hid the card passes
 * the wire facts (WireData) as children, between these fields and the JSON:
 * the wire record folded into this section (arkinox, 2026-10-20: "kind,
 * coord, relays, published status, and test discovery button could be added
 * to our metadata section ... then we can have these unified").
 */

import { useMemo, useRef, useState, type ReactNode } from 'react'
import type { NostrEvent } from 'nostr-tools'
import { formatStamp } from '../lib/time'
import { CHEST_KIND, KEY_KIND, MESSAGE_KIND, OBJECT_KIND, SHARD_KIND } from '../lib/hidden'
import { findNftLinks, NFT_SITE } from '../lib/nftLink'

/** What stands in for a hidden secret. */
export const HIDDEN_SECRET = '(hidden)'

/**
 * The event as shown: a key item's secret, in its tag or (keys forged before
 * 2026-10-09) as the content, hidden, and a message's claim-link keys hidden.
 * `which` says which, when anything was.
 */
export function shownEvent(ev: NostrEvent): { event: NostrEvent; hidden: boolean; which?: 'key' | 'nft' } {
  if (ev.kind === MESSAGE_KIND && typeof ev.content === 'string') {
    const links = findNftLinks(ev.content)
    if (links.length === 0) return { event: ev, hidden: false }
    let content = ev.content
    for (const l of links) content = content.split(l.url).join(`${NFT_SITE}/claim/${l.id}#${HIDDEN_SECRET}`)
    return { event: { ...ev, content }, hidden: true, which: 'nft' }
  }
  if (ev.kind !== KEY_KIND) return { event: ev, hidden: false }
  let hidden = false
  const tags = ev.tags.map((t) => {
    if (t[0] !== 'secret') return t
    hidden = true
    return [t[0], HIDDEN_SECRET, ...t.slice(2)]
  })
  const legacy = /^[0-9a-f]{64}$/i.test(ev.content.trim())
  if (legacy) hidden = true
  return hidden ? { event: { ...ev, tags, content: legacy ? HIDDEN_SECRET : ev.content }, hidden, which: 'key' } : { event: { ...ev, tags, content: ev.content }, hidden }
}

/**
 * The event as JSON in NIP-01's field order, one tag to a line. A rumor (a
 * hidden message, lib/hidden.ts rumorOf) has no `sig`, and none is shown.
 */
export function eventJson(ev: Omit<NostrEvent, 'sig'> & { sig?: string }): string {
  const s = JSON.stringify
  const tags = ev.tags.length === 0 ? '[]' : `[\n${ev.tags.map((t) => `    ${s(t)}`).join(',\n')}\n  ]`
  const sig = ev.sig ? `,\n  "sig": ${s(ev.sig)}` : ''
  return `{\n  "id": ${s(ev.id)},\n  "pubkey": ${s(ev.pubkey)},\n  "created_at": ${s(ev.created_at)},\n  "kind": ${s(ev.kind)},\n  "tags": ${tags},\n  "content": ${s(ev.content)}${sig}\n}`
}

/** How long COPIED stays, as on the other copies. */
const COPIED_MS = 1400

/**
 * What a kind is to a reader, as the wire record named it (arkinox,
 * 2026-10-10: a key item is an item, never a shard). An object of kind
 * 33331 in a bag is a shard hidden by reference. Null for any other kind.
 */
export function kindName(kind: number): string | null {
  switch (kind) {
    case SHARD_KIND: return 'shard'
    case OBJECT_KIND: return 'shard, by reference'
    case MESSAGE_KIND: return 'message'
    case KEY_KIND: return 'item'
    case CHEST_KIND: return 'chest'
    default: return null
  }
}

/** One value a tap copies, with COPIED in its place for a moment. `shown` is what reads, when it is not the value itself. */
export function CopyValue({ value, title, shown }: { value: string; title: string; shown?: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  // The latest tap's timer, so an earlier one never clears a newer COPIED.
  const timer = useRef(0)
  const copy = (): void => {
    // Refused (no permission, an insecure page): nothing to undo, the words stay to select.
    navigator.clipboard?.writeText(value).catch(() => {})
    setCopied(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), COPIED_MS)
  }
  return <button className="eventdata__value" title={title} onClick={copy}>{copied ? 'COPIED' : shown ?? value}</button>
}

export function EventData({ event: raw, children }: { event: NostrEvent; children?: ReactNode }): JSX.Element {
  // Once per event: a card re-renders on every store change, and a shard's event runs to tens of KB.
  const { event, which } = useMemo(() => shownEvent(raw), [raw])
  const json = useMemo(() => eventJson(event), [event])
  const d = event.tags.find((t) => t[0] === 'd')?.[1]
  const name = kindName(event.kind)
  const props: [string, string | undefined, string, string?][] = [
    ['event ID', event.id, 'Tap to copy the event id'],
    ['d tag', d || undefined, 'Tap to copy the d tag'],
    ['pubkey', event.pubkey, 'Tap to copy the pubkey (hex)'],
    ['created_at', String(event.created_at), formatStamp(event.created_at)],
    ['kind', String(event.kind), 'Tap to copy the kind', name ? `${event.kind} (${name})` : undefined],
  ]
  return (
    <section className="eventdata" aria-label="Event data">
      <dl className="eventdata__props">
        {props.map(([label, value, title, shown]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              {value === undefined
                ? <span className="eventdata__none">none</span>
                : <CopyValue value={value} title={title} shown={shown} />}
            </dd>
          </div>
        ))}
      </dl>
      {children}
      {which === 'key' && <p className="eventdata__note">The key's secret is hidden here, so the event shown will not verify.</p>}
      {which === 'nft' && <p className="eventdata__note">The NFT link's key is hidden here, so the event shown will not verify.</p>}
      <div className="eventdata__json">
        <pre>{json}</pre>
      </div>
    </section>
  )
}
