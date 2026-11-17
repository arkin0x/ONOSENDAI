/**
 * useAvatars.ts - who looks like what.
 *
 * Every avatar drawn asks here for its shape: the kind 11333 event of that
 * pubkey (lib/avatar), fetched once and refreshed now and then, null meaning
 * the dodecahedron. An avatar is drawn only when it is one (spec 8.10,
 * cyberspace-core's verifyAvatar): kind 11333, content within the 128 KB size
 * limit, a shard payload this client can read. Anything else is the
 * dodecahedron to everyone. There is no work to check: a nonce tag on an
 * avatar published while avatars were paid for in work is ignored.
 *
 * Every avatar event seen is kept on the device (lib/avatarDb, its own
 * IndexedDB database; never localStorage, arkinox 2026-11-17), so a
 * reload draws you and the people around you in your own shapes from the
 * device in milliseconds, not as dodecahedra until the relays answer
 * (arkinox, 2026-10-12: "when I refresh the page XOR disappears until it
 * loads"). Adopting a shard refuses it over the size limit, signs (with a
 * long patience, since a person is reading the prompt), keeps the event,
 * and publishes it unless you are LOCAL. An avatar adopted while LOCAL is
 * kept whole, and `broadcastMine` sends that same event once you are LIVE.
 * `phase` says which of those is happening, so the workshop can keep the
 * button down and say where things are.
 *
 * Newest wins, everywhere (lib/avatar avatarReplaces, NIP-01): what is drawn
 * for a pubkey is the newest avatar event seen for it, from the relays, the
 * device or a signature just made, and a copy that is not newer never draws
 * over it. A newer one the relays answer with is kept at once, so an avatar
 * adopted on another device is the one on screen at the next start, not the
 * one this device signed last (arkinox, 2026-11-17: "every time I start
 * onosendai it shows my previous avatar for about 30 seconds and then
 * finally shows my more recently updated one").
 */

import { withoutCarried } from '../lib/carried'
import { useEffect } from 'react'
import { create } from 'zustand'
import { verifyAvatar } from 'cyberspace-core'
import { AVATAR_KIND, avatarReplaces, avatarShard, avatarSize, avatarTemplate, newestAvatar } from '../lib/avatar'
import { keepAvatarEvent, migrateAvatarStorage, readKeptAvatar } from '../lib/avatarDb'
import type { NostrEvent } from '../lib/events'
import { publish, query } from '../lib/relay'
import { SignerAccountMismatch } from '../lib/signers'
import type { ShardModel } from 'sno-core/shards'
import { useCyberspace } from './useCyberspace'

const REFRESH_MS = 5 * 60_000

/** Where an adopt is: the signer, then the relays. */
export type AdoptPhase = 'signing' | 'publishing'

/** The furthest past now a new avatar's created_at goes to replace a held one dated ahead: relays refuse events far in the future. */
export const AVATAR_AHEAD_MAX_S = 600

/** How long to wait for a remote signer here: a person is reading the prompt, not a hop. */
export const AVATAR_SIGN_PATIENCE_MS = 120_000

interface AvatarsState {
  /** By pubkey: the shard, null for the dodecahedron; absent until asked. */
  shards: Record<string, ShardModel | null>
  /**
   * By pubkey: the avatar event the drawn shape comes from, the newest seen
   * from the relays, the device or your own signature (the avatar card's
   * event data). A copy that does not replace it (avatarReplaces) is not drawn.
   */
  events: Record<string, NostrEvent>
  /** When each pubkey was last asked for, so the relay is not asked per frame. */
  asked: Record<string, number>
  /** Your own avatar event, signed and kept, whether or not a relay has it. */
  mineEvent: NostrEvent | null
  /** Whether a relay took your avatar. False for one adopted while LOCAL. */
  minePublished: boolean
  /** What adopt is doing now, null when idle; the button stays down through all of it. */
  phase: AdoptPhase | null
  /** Why the last adopt failed, for the notice; null when it succeeded or was cancelled. */
  adoptError: string | null
  /** Look a pubkey's avatar up, on the device once and on the relays once per refresh window. */
  ensure: (pubkey: string) => void
  /** Publish this shard as your avatar (null for the dodecahedron); true when a relay took it. */
  adopt: (shard: ShardModel | null) => Promise<boolean>
  /** Send the avatar you adopted while LOCAL to the relays now. */
  broadcastMine: () => Promise<boolean>
  /** Your own from the device, before the relay answers, unless something newer is already drawn. */
  loadMine: () => Promise<void>
}

/** The pubkeys this page has looked up on the device: once each, since every copy seen after is kept as it arrives. */
const readFromDevice = new Set<string>()

/** Where a copy came from: the device (with whether a relay has it) or a relay's answer. */
type Source = { from: 'device'; published: boolean } | { from: 'relay' }

/** By pubkey: the newest avatar the relays answered with on this page. A device copy newer than that is one no relay has. */
const relaySaid = new Map<string, NostrEvent>()

/**
 * Draw `event` as `pubkey`'s avatar if it is the newest held (avatarReplaces);
 * true when it is. A relay's copy is kept on the device. Yours also becomes
 * `mineEvent`, published when a relay has it: an avatar newer than every
 * relay answer is not, whatever was kept with it, so BROADCAST is offered
 * (sending it again is harmless), whichever of the two answers landed first.
 */
function take(pubkey: string, event: NostrEvent, source: Source): boolean {
  const s = useAvatars.getState()
  const mine = pubkey === useCyberspace.getState().identity.pubkey
  if (source.from === 'relay') {
    const said = relaySaid.get(pubkey)
    if (!said || avatarReplaces(event, said)) relaySaid.set(pubkey, event)
    // Kept, or only marked seen when the device has a newer one (avatarDb).
    void keepAvatarEvent(event, { mine, published: true })
  }
  const held = newestAvatar([s.events[pubkey], mine ? s.mineEvent : null])
  if (held && avatarReplaces(held, event)) {
    if (mine && source.from === 'relay' && s.mineEvent && avatarReplaces(s.mineEvent, event) && s.minePublished) useAvatars.setState({ minePublished: false })
    return false
  }
  // The same event again draws nothing new: its shape is already built.
  if (s.events[pubkey]?.id !== event.id) {
    useAvatars.setState({ shards: { ...s.shards, [pubkey]: avatarShard(event) }, events: { ...s.events, [pubkey]: event } })
  }
  if (mine) {
    const said = relaySaid.get(pubkey)
    const unsent = !!said && avatarReplaces(event, said)
    // The same event again from the device: what this session already
    // learned of it (a relay's answer) outranks the flag kept with it.
    const published = source.from === 'relay' || (s.mineEvent?.id === event.id ? s.minePublished : source.published && !unsent)
    if (s.mineEvent?.id !== event.id || s.minePublished !== published) useAvatars.setState({ mineEvent: event, minePublished: published })
  }
  return true
}

export const useAvatars = create<AvatarsState>((set, get) => ({
  shards: {},
  events: {},
  asked: {},
  mineEvent: null,
  minePublished: false,
  phase: null,
  adoptError: null,

  ensure: (pubkey) => {
    const now = Date.now()
    const last = get().asked[pubkey] ?? 0
    if (now - last < REFRESH_MS) return
    set({ asked: { ...get().asked, [pubkey]: now } })
    // The device first: it answers in milliseconds, and whichever answer is
    // newer is drawn, whatever order they land in.
    if (!readFromDevice.has(pubkey)) {
      readFromDevice.add(pubkey)
      void readKeptAvatar(pubkey).then((kept) => { if (kept) take(pubkey, kept.event, { from: 'device', published: kept.published }) })
    }
    query({ kinds: [AVATAR_KIND], authors: [pubkey] })
      .then((events) => {
        const newest = newestAvatar(events.filter((e) => e.pubkey === pubkey && e.kind === AVATAR_KIND))
        // An empty answer says nothing: a relay that is down, or has not seen
        // the event yet, must not turn a known avatar back into the dodecahedron.
        if (!newest) {
          if (!(pubkey in get().shards)) set({ shards: { ...get().shards, [pubkey]: null } })
          return
        }
        take(pubkey, newest, { from: 'relay' })
      })
      .catch(() => { if (!(pubkey in get().shards)) set({ shards: { ...get().shards, [pubkey]: null } }) })
  },

  adopt: async (chosen) => {
    // An avatar is public: what came to you sealed stays out of it.
    const shard = chosen ? withoutCarried(chosen) : chosen
    // One adopt at a time, through signing and publishing: a second press
    // while the signer's prompt is open would ask again.
    if (get().phase) return false
    if (chosen && shard && shard !== chosen && shard.vertices.length === 0 && (shard.parts?.length ?? 0) === 0) {
      set({ adoptError: 'Without what came to you sealed, this shard has no vertices and places nothing.' })
      return false
    }
    const cs = useCyberspace.getState()
    const me = cs.identity.pubkey
    // Later than any avatar held for you, so it replaces it everywhere
    // (avatarReplaces), even one adopted this same second or on a device
    // whose clock runs a little ahead; never more than AVATAR_AHEAD_MAX_S
    // past now, which relays refuse.
    const held = newestAvatar([get().events[me], get().mineEvent])
    const nowS = Math.floor(Date.now() / 1000)
    const template = avatarTemplate(shard, held ? Math.max(nowS, Math.min(held.created_at + 1, nowS + AVATAR_AHEAD_MAX_S)) : nowS)
    // Over the size limit no client draws it (spec 8.10), so it is not signed.
    if (shard && avatarSize(template.content).over) {
      set({ adoptError: 'This shard is over the 128 KB size limit for an avatar.' })
      return false
    }
    set({ adoptError: null, phase: 'signing' })
    let event
    try {
      event = await cs.signEvent(template, AVATAR_SIGN_PATIENCE_MS)
    } catch (err) {
      // Switched identity meanwhile: nothing to say to the identity on screen now.
      if (useCyberspace.getState().identity.pubkey !== me) { set({ phase: null }); return false }
      // Signed as another account, it would be someone else's avatar: say that.
      set({ phase: null, adoptError: err instanceof SignerAccountMismatch ? err.message : 'The signer did not sign the avatar.' })
      return false
    }
    // Switched identity while the signer's prompt was open: kept, unsent, for
    // the identity that signed it, never offered as the new one's to broadcast.
    if (useCyberspace.getState().identity.pubkey !== me) {
      set({ phase: null })
      if (event.pubkey === me) void keepAvatarEvent(event, { mine: true, published: false })
      return false
    }
    // What the signer returned must still be an avatar every client draws.
    if (shard && !verifyAvatar(event).ok) {
      set({ phase: null, adoptError: 'The signer returned an avatar no client can draw. Try again.' })
      return false
    }
    // LOCAL means LOCAL. The avatar is signed, kept and drawn for you, and it
    // goes out the moment you broadcast it or adopt again while LIVE; publishing
    // it anyway would have been the one action that ignored the setting.
    if (!cs.live) {
      set({ phase: null, shards: { ...get().shards, [me]: shard }, events: { ...get().events, [me]: event }, asked: { ...get().asked, [me]: Date.now() }, mineEvent: event, minePublished: false })
      void keepAvatarEvent(event, { mine: true, published: false })
      return true
    }
    set({ phase: 'publishing' })
    const result = await publish(event)
    // Switched identity while the relays answered: kept for the identity that
    // signed it, and not drawn as the one on screen now.
    if (useCyberspace.getState().identity.pubkey !== me) {
      set({ phase: null })
      void keepAvatarEvent(event, { mine: true, published: result.ok })
      return result.ok
    }
    if (!result.ok) {
      set({ phase: null, mineEvent: event, minePublished: false, adoptError: 'No relay took the avatar. Try again when one is reachable.' })
      void keepAvatarEvent(event, { mine: true, published: false })
      return false
    }
    set({ phase: null, shards: { ...get().shards, [me]: shard }, events: { ...get().events, [me]: event }, asked: { ...get().asked, [me]: Date.now() }, mineEvent: event, minePublished: true })
    void keepAvatarEvent(event, { mine: true, published: true })
    return true
  },

  broadcastMine: async () => {
    const cs = useCyberspace.getState()
    const event = get().mineEvent
    if (!event) return false
    if (!cs.live) {
      set({ adoptError: 'Nothing is published while you are LOCAL. Switch to LIVE and try again.' })
      return false
    }
    if (get().phase) return false
    set({ phase: 'publishing', adoptError: null })
    const result = await publish(event)
    if (!result.ok) {
      set({ phase: null, adoptError: 'No relay took the avatar. Try again when one is reachable.' })
      return false
    }
    void keepAvatarEvent(event, { mine: true, published: true })
    if (useCyberspace.getState().identity.pubkey !== event.pubkey) {
      set({ phase: null })
      return true
    }
    set({ phase: null, minePublished: true, asked: { ...get().asked, [event.pubkey]: Date.now() } })
    return true
  },

  loadMine: async () => {
    const me = useCyberspace.getState().identity.pubkey
    const kept = await readKeptAvatar(me)
    // Switched again meanwhile: the next load is the one that counts.
    if (useCyberspace.getState().identity.pubkey !== me) return
    if (kept) take(me, kept.event, { from: 'device', published: kept.published })
    // Nothing newer kept, but a copy drawn already (a relay's, seen while you
    // were someone else) is yours: it only ever came from a relay.
    const s = get()
    const drawn = s.events[me]
    if (!s.mineEvent && drawn) set({ mineEvent: drawn, minePublished: true })
  },
}))

let unwatchMine: (() => void) | null = null

/**
 * Move what localStorage held into IndexedDB (once), take your own
 * kept avatar in now, and again on every identity switch (a new key, a
 * login, signing out), so each identity is drawn as its own and BROADCAST
 * never offers another identity's avatar. Started once, by App.
 */
export function watchMyAvatar(): () => void {
  void migrateAvatarStorage()
  void useAvatars.getState().loadMine()
  unwatchMine ??= useCyberspace.subscribe((s, prev) => {
    if (s.identity.pubkey === prev.identity.pubkey) return
    useAvatars.setState({ mineEvent: null, minePublished: false, adoptError: null })
    void useAvatars.getState().loadMine()
  })
  return () => { unwatchMine?.(); unwatchMine = null }
}

/** For tests: forget which pubkeys were looked up on the device and what the relays said, as a reload does. */
export function forgetDeviceReads(): void { readFromDevice.clear(); relaySaid.clear() }

/** The shard a pubkey is drawn as, or null for the dodecahedron; asks the relay as needed. */
export function useAvatarShard(pubkey: string): ShardModel | null {
  const shard = useAvatars((s) => s.shards[pubkey])
  useEffect(() => { if (pubkey) useAvatars.getState().ensure(pubkey) }, [pubkey])
  return shard ?? null
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __avatars?: unknown }).__avatars = useAvatars
}
