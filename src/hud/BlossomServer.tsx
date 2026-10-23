/**
 * BlossomServer.tsx: where an upload goes, one picker for every upload
 * (a profile picture, hidden audio).
 *
 * Your own server list (kind 10063, BUD-03) comes first, then a few public
 * servers that take browser uploads (lib/blossom DEFAULT_BLOSSOM_SERVERS); a
 * server you type is remembered on this device, and so is the last one an
 * upload went to. Moved out of ProfileModal unchanged when hidden audio
 * needed the same choice (2026-10-23).
 */

import { useEffect, useState } from 'react'
import { GENERAL_RELAYS } from '../lib/contacts'
import type { NostrEvent } from '../lib/events'
import { queryAny, relaySet } from '../lib/relay'
import { DEFAULT_BLOSSOM_SERVERS, SERVER_LIST_KIND, normalizeServer, serversFromList } from '../lib/blossom'

const SERVER_KEY = 'onosendai:blossom-server'
/** The select's value for "type a server". */
const CUSTOM = 'custom'
/** How long to wait on the relays for your server list. */
const LIST_WAIT_MS = 5000

function savedServer(): string | null {
  try {
    return normalizeServer(localStorage.getItem(SERVER_KEY) ?? '')
  } catch {
    return null
  }
}

/** Where your server list lives: the general relays, and yours. */
export function serverListRelays(): string[] {
  return [...new Set([...GENERAL_RELAYS, ...relaySet()])]
}

/** The picker's state, and what an upload needs from it. */
export interface BlossomChoice {
  servers: string[]
  server: string
  setServer: (s: string) => void
  custom: string
  setCustom: (s: string) => void
  /** The server an upload goes to now, or null while "another server" holds nothing usable. */
  chosen: () => string | null
  /** An upload went there: the next picker starts on it. */
  remember: (server: string) => void
  /** Your kind 10063, from a query the caller made (ProfileModal asks for it with your kind 0). */
  adopt: (list: NostrEvent | null) => void
}

/**
 * The picker's state. With `fetchList` it reads your server list (kind
 * 10063) itself, for `pubkey`; without, the caller hands it over (`adopt`).
 */
export function useBlossomChoice(pubkey: string, fetchList: boolean): BlossomChoice {
  const [servers, setServers] = useState<string[]>(DEFAULT_BLOSSOM_SERVERS)
  const [server, setServer] = useState<string>(() => savedServer() ?? DEFAULT_BLOSSOM_SERVERS[0])
  const [custom, setCustom] = useState('')

  const adopt = (list: NostrEvent | null): void => {
    const mine = serversFromList(list)
    if (mine.length === 0) return
    setServers([...mine, ...DEFAULT_BLOSSOM_SERVERS.filter((s) => !mine.includes(s))])
    // Your own first server is the default unless this device already chose one.
    if (!savedServer()) setServer(mine[0])
  }

  useEffect(() => {
    if (!fetchList) return
    let alive = true
    void (async () => {
      let events: NostrEvent[] = []
      try {
        events = await queryAny(serverListRelays(), { kinds: [SERVER_LIST_KIND], authors: [pubkey] }, LIST_WAIT_MS)
      } catch { /* relays down: the public servers alone */ }
      if (!alive) return
      const newest = events.filter((e) => e.pubkey === pubkey && e.kind === SERVER_LIST_KIND).sort((a, b) => b.created_at - a.created_at)[0] ?? null
      adopt(newest)
    })()
    return () => { alive = false }
    // adopt only sets state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pubkey, fetchList])

  return {
    servers,
    server,
    setServer,
    custom,
    setCustom,
    chosen: () => (server === CUSTOM ? normalizeServer(custom) : server),
    remember: (target) => { try { localStorage.setItem(SERVER_KEY, target) } catch { /* private mode */ } },
    adopt,
  }
}

/** The select, and a field for a server of your own when "Another server" is picked. */
export function BlossomServerPicker({ id, choice, disabled, label = 'Where uploads go (a Blossom server)' }: { id: string; choice: BlossomChoice; disabled?: boolean; label?: string }): JSX.Element {
  return (
    <div className="login__section">
      <label className="login__label" htmlFor={id}>{label}</label>
      <div className="profile__server">
        <select id={id} className="avatars__input login__input profile__select" value={choice.server} onChange={(e) => choice.setServer(e.target.value)} disabled={disabled}>
          {choice.servers.map((s) => <option key={s} value={s}>{s.replace(/^https?:\/\//, '')}{DEFAULT_BLOSSOM_SERVERS.includes(s) ? '' : ' (yours)'}</option>)}
          <option value={CUSTOM}>Another server…</option>
        </select>
        {choice.server === CUSTOM && (
          <input className="avatars__input login__input" type="url" placeholder="https://blossom.example.com" value={choice.custom} onChange={(e) => choice.setCustom(e.target.value)} spellCheck={false} disabled={disabled} />
        )}
      </div>
    </div>
  )
}
