/**
 * usePublished.ts - PUBLISH and RETRACT in the workshop's MENU, and the
 * ledger of what this browser has published (lib/published.ts).
 *
 * A publish signs the shard as a public kind 33331 (publicObjectTemplate),
 * sends it to your relay set, and writes the ledger when a relay takes it.
 * The ledger is the only record that this object went out and what it looked
 * like when it did: an addressable event keeps no memory of what it replaced.
 * A retraction is a NIP-09 deletion by address, and forgets the record.
 *
 * Deliberately not gated on LIVE. The LOCAL/LIVE switch is the grain of the
 * chain, where every action names the one before it; a public object is a
 * standalone event, like a bag, and sending one says nothing about where you
 * have been (hud/PublishSwitch.tsx says the same of a bag's LIVE). PUBLISH is
 * that decision for one object, and it is the button, not a setting.
 *
 * The Shard Feed re-reads after a publish or a retraction when it has been
 * opened this session, so the object is there the next time the window is
 * looked at ("show up in the shard feed instantly", arkinox 2026-10-10).
 * What the relays already hold under this key is learned from any read of
 * them (`learn`): the OBJECT picker's query of your objects, and the feed as
 * it arrives, so a shard published from snocrash under the same id reads as
 * PUBLISHED here.
 */

import { create } from 'zustand'
import type { ShardModel } from 'sno-core/shards'
import { SNO_KIND, objectAddress } from 'sno-core/feed'
import { publishMany, relaySet } from '../lib/relay'
import { shardRefusal } from '../lib/hidden'
import { forgetRef } from '../lib/parts'
import type { NostrEvent } from '../lib/events'
import {
  fingerprint, forget, loadLedger, noteSeen, noteSent, publicObjectTemplate, retractionTemplate, saveLedger, type Ledger,
} from '../lib/published'
import { useCyberspace } from './useCyberspace'
import { useWorkshop } from './useWorkshop'
import { useFeed } from './useFeed'

/** The fields of an event a sighting reads; a feed's FeedEvent and a relay's NostrEvent both have them. */
export type SeenEvent = Pick<NostrEvent, 'id' | 'kind' | 'pubkey' | 'tags' | 'created_at'>

interface PublishedState {
  /** What this browser knows about which shards have been published. */
  ledger: Ledger
  publishing: boolean
  retracting: boolean
  /** Sign the shard as a public object and send it to your relays. True when one took it. */
  publish: (shard: ShardModel) => Promise<boolean>
  /** Send a deletion of the published object (NIP-09). True when a relay took it. */
  retract: (shard: ShardModel) => Promise<boolean>
  /** Note the public objects among these that this identity published, from any read of the relays. */
  learn: (events: readonly SeenEvent[]) => void
}

/**
 * A per-object clock, so a publish is strictly newer than the last publish
 * or retraction of the same object: a relay keeps the addressable event with
 * the greatest created_at, and a deletion by address covers every version up
 * to its own second (sno-core isDeleted), so PUBLISH AGAIN or PUBLISH after
 * RETRACT inside one second would otherwise lose. Session-local, seeded from
 * the ledger's record of the last send.
 */
const clock = new Map<string, number>()
function nextAt(id: string, floor: number): number {
  const now = Math.floor(Date.now() / 1000)
  const at = Math.max(now, floor + 1, (clock.get(id) ?? 0) + 1)
  clock.set(id, at)
  return at
}

/** One place things are said: the workshop's toast. */
function say(notice: string): void {
  useWorkshop.setState({ notice })
}

/** The feed, read again from the newest, when it has been read at all this session. */
function refreshFeed(): void {
  const feed = useFeed.getState()
  if (feed.started) feed.refresh()
}

export const usePublished = create<PublishedState>((set, get) => ({
  ledger: loadLedger(),
  publishing: false,
  retracting: false,

  publish: async (shard) => {
    if (get().publishing) return false
    // The same round trip every reader makes, before the signature: an object
    // the format refuses would be listed by the feed and open as nothing.
    const refusal = shardRefusal(shard)
    if (refusal) { say(refusal); return false }
    const cs = useCyberspace.getState()
    const relays = relaySet()
    set({ publishing: true })
    try {
      const template = publicObjectTemplate(shard, nextAt(shard.id, get().ledger[shard.id]?.at ?? 0))
      const signed = await cs.signEvent(template)
      const result = await publishMany(relays, signed)
      if (!result.ok) {
        // The relay's own words: a refusal is the one thing worth reading.
        say(`No relay took "${shard.name}": ${result.reason}`)
        return false
      }
      // Written down here rather than asked of a relay later: an addressable
      // event keeps no memory of what it replaced, so this is the only record
      // that this object went out and what it looked like when it did.
      const ledger = noteSent(get().ledger, shard.id, fingerprint(template.content), signed.pubkey, signed.created_at, signed.id)
      saveLedger(ledger)
      set({ ledger })
      // Every object placing this one draws the new version on its next fetch.
      forgetRef(['a', objectAddress(signed.pubkey, shard.id)])
      const took = result.accepted?.length ?? relays.length
      say(`"${shard.name}" is published to ${took} of ${relays.length} relays.`)
      refreshFeed()
      return true
    } catch (err) {
      say(`Could not publish "${shard.name}": ${err instanceof Error ? err.message : String(err)}`)
      return false
    } finally {
      set({ publishing: false })
    }
  },

  retract: async (shard) => {
    if (get().retracting) return false
    const cs = useCyberspace.getState()
    const me = cs.identity.pubkey
    const rec = get().ledger[shard.id]
    // Only the author's deletion deletes (NIP-09): an object published under
    // another key is not this key's to take down.
    if (rec && rec.pubkey !== me) { say('This object was published under another key; only that key can retract it.'); return false }
    const relays = relaySet()
    set({ retracting: true })
    try {
      const del = await cs.signEvent(retractionTemplate(me, shard.id, rec?.id, nextAt(shard.id, rec?.at ?? 0), 'object retracted'))
      const result = await publishMany(relays, del)
      if (!result.ok) {
        say(`No relay took the retraction of "${shard.name}": ${result.reason}`)
        return false
      }
      const ledger = forget(get().ledger, shard.id)
      saveLedger(ledger)
      set({ ledger })
      forgetRef(['a', objectAddress(me, shard.id)])
      const took = result.accepted?.length ?? relays.length
      say(`"${shard.name}" is retracted: the deletion went to ${took} of ${relays.length} relays. Relays that honor it drop the object. PUBLISH puts it back.`)
      refreshFeed()
      return true
    } catch (err) {
      say(`Could not retract "${shard.name}": ${err instanceof Error ? err.message : String(err)}`)
      return false
    } finally {
      set({ retracting: false })
    }
  },

  learn: (events) => {
    const me = useCyberspace.getState().identity.pubkey
    let ledger = get().ledger
    for (const ev of events) {
      // A public object of this key's: no `encrypted` tag, so a sealed object
      // hidden by reference (lib/hidden.ts) is not a publication.
      if (ev.kind !== SNO_KIND || ev.pubkey !== me || ev.tags.some((t) => t[0] === 'encrypted')) continue
      const d = ev.tags.find((t) => t[0] === 'd')?.[1]
      if (!d) continue
      // Without a fingerprint, on purpose: what a relay returns has been
      // through the reader and the writer again and need only match in
      // meaning, not byte for byte (lib/published.ts).
      ledger = noteSeen(ledger, d, ev.pubkey, ev.created_at, ev.id)
    }
    if (ledger === get().ledger) return
    saveLedger(ledger)
    set({ ledger })
  },
}))

// The Shard Feed is a read of the relays like any other: an object of yours
// in it was published, whichever browser or app published it.
useFeed.subscribe((s, prev) => {
  if (s.objects === prev.objects || s.objects.length === 0) return
  usePublished.getState().learn(s.objects.map((o) => o.event))
})
