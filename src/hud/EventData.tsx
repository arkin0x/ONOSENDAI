/**
 * EventData.tsx: the nostr event behind a modal, at the bottom of it, under
 * the actions (arkinox, 2026-10-20): its id, `d` tag, pubkey and created_at,
 * each copied by a tap with COPIED in its place for a moment, and below them
 * the whole event as JSON in Monaspace Krypton, with COPY in the field's top
 * right corner.
 */

import { useState } from 'react'
import type { NostrEvent } from 'nostr-tools'
import { Check, Copy } from 'lucide-react'
import { formatStamp } from '../lib/time'

/** How long COPIED stays, as on the other copies. */
const COPIED_MS = 1400
const ICON = 11

export function EventData({ event }: { event: NostrEvent }): JSX.Element {
  const [copied, setCopied] = useState<string | null>(null)
  const copy = (what: string, value: string): void => {
    // Refused (no permission, an insecure page): nothing to undo, the words stay to select.
    navigator.clipboard?.writeText(value).catch(() => {})
    setCopied(what)
    window.setTimeout(() => setCopied((c) => (c === what ? null : c)), COPIED_MS)
  }
  const d = event.tags.find((t) => t[0] === 'd')?.[1]
  const json = JSON.stringify(event, null, 2)
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
      <div className="eventdata__json">
        <button className="eventdata__copy" onClick={() => copy('event', json)} title="Copy the whole event">
          {copied === 'event' ? <Check size={ICON} strokeWidth={2.25} aria-hidden /> : <Copy size={ICON} strokeWidth={2.25} aria-hidden />}
          {copied === 'event' ? 'COPIED' : 'COPY'}
        </button>
        <pre>{json}</pre>
      </div>
    </section>
  )
}
