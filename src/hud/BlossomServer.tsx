/**
 * BlossomServer.tsx: where an upload goes, one picker for every upload
 * (a profile picture, hidden audio).
 *
 * The last server used comes first, then servers you typed, your own server
 * list (kind 10063, BUD-03), and a few public servers that take browser uploads (lib/blossom DEFAULT_BLOSSOM_SERVERS). A
 * server you type sticks once it answers an upload: it stays in the list on
 * this device, marked "(yours)", and the picker starts on it (owner
 * 2026-11-10, lib/blossomChoice). Moved out of ProfileModal when hidden audio
 * needed the same choice (2026-10-23).
 */

import { useEffect, useRef, useState } from 'react'
import { GENERAL_RELAYS } from '../lib/contacts'
import type { NostrEvent } from '../lib/events'
import { queryAny, relaySet } from '../lib/relay'
import { DEFAULT_BLOSSOM_SERVERS, SERVER_LIST_KIND, normalizeServer, serversFromList } from '../lib/blossom'
import { initialServer, readChoice, rememberServer, serverAfterList, serverOptions, type StoredChoice } from '../lib/blossomChoice'

/** The select's value for "type a server". */
const CUSTOM = 'custom'
/** How long to wait on the relays for your server list. */
const LIST_WAIT_MS = 5000

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
  /**
   * The server answered an upload (took it, or refused it): it stays in the
   * list on this device and the next picker starts on it (owner 2026-11-10).
   * Not for a server that never answered.
   */
  remember: (server: string) => void
  /** Your kind 10063, from a query the caller made (ProfileModal asks for it with your kind 0). */
  adopt: (list: NostrEvent | null) => void
}

/**
 * The picker's state. With `fetchList` it reads your server list (kind
 * 10063) itself, for `pubkey`; without, the caller hands it over (`adopt`).
 * Servers you typed and used are kept on this device per key (lib/blossomChoice).
 */
export function useBlossomChoice(pubkey: string, fetchList: boolean): BlossomChoice {
  const [stored, setStored] = useState<StoredChoice>(() => readChoice(pubkey))
  const [mine, setMine] = useState<string[]>([])
  // Read when an upload ends, which may be renders after it began.
  const mineNow = useRef<string[]>([])
  const [server, setServerState] = useState<string>(() => initialServer(readChoice(pubkey), []))
  const [custom, setCustom] = useState('')
  // The person picked from the select: a list that arrives later leaves it be.
  const picked = useRef(false)
  // Another key: its own servers, its own choice.
  const shownFor = useRef(pubkey)
  useEffect(() => {
    if (shownFor.current === pubkey) return
    shownFor.current = pubkey
    const next = readChoice(pubkey)
    picked.current = false
    setStored(next)
    setMine([])
    mineNow.current = []
    setServerState(initialServer(next, []))
    setCustom('')
  }, [pubkey])

  const adopt = (list: NostrEvent | null): void => {
    const fromList = serversFromList(list)
    setMine(fromList)
    mineNow.current = fromList
    setServerState((current) => serverAfterList(current, readChoice(pubkey), fromList, picked.current))
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
    servers: serverOptions(stored, mine),
    server,
    setServer: (s) => { picked.current = true; setServerState(s) },
    custom,
    setCustom,
    chosen: () => (server === CUSTOM ? normalizeServer(custom) : server),
    remember: (target) => {
      // Kept for the key that uploaded; shown only if that key is still the one here.
      const next = rememberServer(pubkey, target, undefined, mineNow.current.includes(normalizeServer(target) ?? ''))
      if (shownFor.current !== pubkey) return
      setStored(next)
      // The typed server is an option now: the select shows it, not the field.
      if (next.last) { setServerState(next.last); setCustom('') }
    },
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
