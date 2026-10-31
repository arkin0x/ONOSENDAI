/**
 * offlineRelay.ts - lib/relay as tests have it (src/test/noNetwork.ts mocks
 * it for every test file): every question answered at once with nothing,
 * every publish accepted, no socket ever opened. A test file that mocks
 * lib/relay itself spreads this under its own overrides, so whatever it does
 * not override stays offline too; one that tests relay.ts itself unmocks it
 * and fakes the socket.
 */
import { normalizeURL } from 'nostr-tools/utils'
import type { Filter } from 'nostr-tools/filter'
import type { NostrEvent } from '../lib/events'
import type { RelayAnswer } from '../lib/relayOutcome'

const nothing = (url: string): RelayAnswer => ({ url: normalizeURL(url), outcome: 'answered', events: [] })

export const offlineRelay = {
  connectRelay: async (_url: string): Promise<boolean> => true,
  authForRead: async (_url: string): Promise<void> => {},
  publish: async (_event: NostrEvent) => ({ ok: true as const }),
  publishMany: async (relays: string[], _event: NostrEvent) => ({ ok: true as const, accepted: relays }),
  publishLight: async (_event: NostrEvent): Promise<boolean> => true,
  query: async (_filter: Filter): Promise<NostrEvent[]> => [],
  queryAny: async (_relays: string[], _filter: Filter, _maxWait?: number): Promise<NostrEvent[]> => [],
  queryEach: async (_filter: Filter, _maxWait?: number): Promise<RelayAnswer[]> => [nothing('wss://offline.invalid')],
  queryEachAt: async (relays: string[], _filter: Filter, _maxWait?: number): Promise<RelayAnswer[]> => relays.map(nothing),
  queryEachSettled: async (relays: string[], _filter: Filter, _maxWait: number, _primary: string, _waitFor: string[], opts: { onSent?: () => void } = {}): Promise<RelayAnswer[]> => {
    opts.onSent?.()
    return [...new Set(relays)].map(nothing)
  },
  askRelay: async (url: string, _filter: Filter, _onEvent: (ev: NostrEvent) => void): Promise<RelayAnswer> => nothing(url),
  askEach: async (relays: string[], _filter: Filter, _onEvent: (ev: NostrEvent) => void): Promise<RelayAnswer[]> => relays.map(nothing),
  subscribeOne: (_url: string, _filter: Filter, handlers: { oneose: () => void }): { close: () => void } => {
    const t = setTimeout(() => handlers.oneose(), 0)
    return { close: () => clearTimeout(t) }
  },
  subscribe: (_filter: Filter, _onEvent: (ev: NostrEvent) => void, onEose?: () => void): (() => void) => {
    const t = setTimeout(() => onEose?.(), 0)
    return () => clearTimeout(t)
  },
  probeLiveness: async (): Promise<'alive' | 'dead' | 'skipped'> => 'skipped',
  signedIn: (_url: string): boolean => true,
  resumeLive: (): void => {},
  watchConnectivity: (): (() => void) => () => {},
}
