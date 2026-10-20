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
 * the event shown will not verify.
 */

import { useMemo, useState } from 'react'
import type { NostrEvent } from 'nostr-tools'
import { formatStamp } from '../lib/time'
import { KEY_KIND } from '../lib/hidden'

/** What stands in for a hidden secret. */
export const HIDDEN_SECRET = '(hidden)'

/** The event as shown: a key item's secret, in its tag or (keys forged before 2026-10-09) as the content, hidden. */
export function shownEvent(ev: NostrEvent): { event: NostrEvent; hidden: boolean } {
  if (ev.kind !== KEY_KIND) return { event: ev, hidden: false }
  let hidden = false
  const tags = ev.tags.map((t) => {
    if (t[0] !== 'secret') return t
    hidden = true
    return [t[0], HIDDEN_SECRET, ...t.slice(2)]
  })
  const legacy = /^[0-9a-f]{64}$/i.test(ev.content.trim())
  if (legacy) hidden = true
  return { event: { ...ev, tags, content: legacy ? HIDDEN_SECRET : ev.content }, hidden }
}

/** The event as JSON in NIP-01's field order, one tag to a line. */
export function eventJson(ev: NostrEvent): string {
  const s = JSON.stringify
  const tags = ev.tags.length === 0 ? '[]' : `[\n${ev.tags.map((t) => `    ${s(t)}`).join(',\n')}\n  ]`
  return `{\n  "id": ${s(ev.id)},\n  "pubkey": ${s(ev.pubkey)},\n  "created_at": ${s(ev.created_at)},\n  "kind": ${s(ev.kind)},\n  "tags": ${tags},\n  "content": ${s(ev.content)},\n  "sig": ${s(ev.sig)}\n}`
}

/** How long COPIED stays, as on the other copies. */
const COPIED_MS = 1400

export function EventData({ event: raw }: { event: NostrEvent }): JSX.Element {
  const [copied, setCopied] = useState<string | null>(null)
  // Once per event: a card re-renders on every store change, and a shard's event runs to tens of KB.
  const { event, hidden } = useMemo(() => shownEvent(raw), [raw])
  const json = useMemo(() => eventJson(event), [event])
  const copy = (what: string, value: string): void => {
    // Refused (no permission, an insecure page): nothing to undo, the words stay to select.
    navigator.clipboard?.writeText(value).catch(() => {})
    setCopied(what)
    window.setTimeout(() => setCopied((c) => (c === what ? null : c)), COPIED_MS)
  }
  const d = event.tags.find((t) => t[0] === 'd')?.[1]
  const props: [string, string | undefined, string][] = [
    ['event ID', event.id, 'Tap to copy the event id'],
    ['d tag', d || undefined, 'Tap to copy the d tag'],
    ['pubkey', event.pubkey, 'Tap to copy the pubkey (hex)'],
    ['created_at', String(event.created_at), formatStamp(event.created_at)],
  ]
  return (
    <section className="eventdata" aria-label="Event data">
      <dl className="eventdata__props">
        {props.map(([label, value, title]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              {value === undefined
                ? <span className="eventdata__none">none</span>
                : <button className="eventdata__value" title={title} onClick={() => copy(label, value)}>{copied === label ? 'COPIED' : value}</button>}
            </dd>
          </div>
        ))}
      </dl>
      {hidden && <p className="eventdata__note">The key's secret is hidden here, so the event shown will not verify.</p>}
      <div className="eventdata__json">
        <pre>{json}</pre>
      </div>
    </section>
  )
}
