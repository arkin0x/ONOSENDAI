/**
 * usePaletteNet.ts - palettes on nostr: publish one (or an edit of one), and
 * read one back by its nevent or naddr (DECK-0003 §1.3b).
 *
 * Ported from snocrash's useNostr with the palette sheet (arkinox,
 * 2026-09-27), onto this client's signer and relay layer. Kept as its own
 * small store because nothing else here publishes palettes: `publishing`
 * disables the sheet's publish keys while one is in flight, and `notice`
 * says why the last attempt failed, since the sheet covers the workshop's
 * toast.
 */

import { create } from 'zustand'
import { nip19, type Event as NostrEvent } from 'nostr-tools'
import { hexAt, parsePaletteEvent, type Palette } from 'sno-core/snoPalette'
import { publishMany, queryAny, relaySet } from '../lib/relay'
import { useCyberspace } from './useCyberspace'
import type { PublishedPalette } from './useWorkshop'
import { CLIENT_TAG } from '../lib/client'

/** Color moments: the kind palettes already travel as on nostr. */
export const PALETTE_KIND = 3367

/** A palette read back off a relay, with everything needed to keep using it. */
export interface FetchedPalette {
  colors: Palette
  /** What its author called it, when they said. */
  name: string | null
  event: PublishedPalette
}

/**
 * The event a palette goes out as (DECK-0003 §1.3b). Pure, like objectTemplate.
 *
 * One `c` tag per colour, in index order, and no second machine-readable copy
 * of them anywhere else. The colours are tags rather than content because `c`
 * is a single-letter tag, which relays index: `{"#c": ["#ff0000"]}` finds every
 * palette containing pure red, and that is a capability a palette in `content`
 * could never offer. It also makes this event a colour moment, which is what
 * the clients already publishing kind 3367 know how to show.
 *
 * `prev` turns a publish into an edit. A regular event cannot be replaced, so
 * a correction is a new event that names the old one: `previous` is the step
 * back, `genesis` is where the chain started, and the two marker words are the
 * ones Cyberspace's own action chain uses.
 */
export function paletteTemplate(
  name: string, colors: Palette, createdAt: number, prev?: PublishedPalette,
): { kind: number; created_at: number; tags: string[][]; content: string } {
  const hexes = colors.map((_, i) => hexAt(colors, i))
  const shown = hexes.slice(0, 8).join(', ')
  const rest = hexes.length - 8
  return {
    kind: PALETTE_KIND,
    created_at: createdAt,
    tags: [
      // The palette itself. Tag n is the colour index n names.
      ...hexes.map((h) => ['c', h]),
      ['name', name],
      // How the colour-moment clients lay a palette out. Cosmetic, and theirs.
      ['layout', 'horizontal'],
      // What a client that cannot render it should say instead (NIP-31).
      ['alt', `Color palette "${name}": ${hexes.length} colors, ${shown}${rest > 0 ? `, and ${rest} more` : ''}`],
      [...CLIENT_TAG],
      ...(prev ? [['e', prev.id, prev.relays[0] ?? '', 'previous']] : []),
      // Only when it says something `previous` does not: the first edit's
      // previous IS the genesis, and one hop back finds it.
      ...(prev && prev.genesis !== prev.id ? [['e', prev.genesis, '', 'genesis']] : []),
    ],
    // Deliberately not the palette. A colour-moment client puts a note or an
    // emoji here, and a second copy of the colours would be the same thing
    // spelled twice, with a rule needed to say which copy wins.
    content: '',
  }
}

/**
 * The reference an object carries to name a palette (DECK-0003 §1.3a).
 *
 * An nevent rather than an naddr, because a palette event is regular and has
 * no address, and because naming one immutable event is what pins an object's
 * colours: an author correcting a palette publishes a new event and cannot
 * repaint objects that already name the old one.
 */
export function paletteNevent(event: PublishedPalette): string {
  return nip19.neventEncode({ id: event.id, relays: event.relays.slice(0, 2), kind: PALETTE_KIND })
}

function withHints(hints: string[] | undefined): string[] {
  return [...new Set([...(hints ?? []), ...relaySet()])]
}

interface PaletteNetState {
  publishing: boolean
  notice: string | null
  /** Publish a palette, or an edit of `prev`; where it went, or null with `notice` set. */
  publishPalette: (name: string, colors: Palette, prev?: PublishedPalette) => Promise<PublishedPalette | null>
  /** A palette by nevent or naddr; null with `notice` set when there is none. */
  fetchPalette: (ref: string) => Promise<FetchedPalette | null>
}

export const usePaletteNet = create<PaletteNetState>((set) => ({
  publishing: false,
  notice: null,

  publishPalette: async (name, colors, prev) => {
    const relays = relaySet()
    if (colors.length < 2 || colors.length > 256) { set({ notice: 'A palette is 2 to 256 colors.' }); return null }
    set({ publishing: true, notice: null })
    try {
      const signed = await useCyberspace.getState().signEvent(paletteTemplate(name, colors, Math.floor(Date.now() / 1000), prev))
      // One relay at a time, in parallel, so the hint lists only relays that took it.
      const results = await Promise.all(relays.map((r) => publishMany([r], signed)))
      const took = relays.filter((_, i) => results[i].ok)
      if (took.length === 0) {
        set({ publishing: false, notice: 'No relay took it.' })
        return null
      }
      set({
        publishing: false,
        notice: prev
          ? `"${name}" is edited, as a new event on ${took.length} of ${relays.length} relays. Objects on the old one keep the old colors.`
          : `"${name}" is published to ${took.length} of ${relays.length} relays.`,
      })
      // Only the relays that took it: a hint pointing somewhere the event is
      // not is worse than no hint, because a reader spends its fetch there.
      return { id: signed.id, genesis: prev?.genesis ?? signed.id, relays: took }
    } catch (err) {
      set({ publishing: false, notice: `Could not publish: ${err instanceof Error ? err.message : String(err)}` })
      return null
    }
  },

  fetchPalette: async (ref) => {
    let decoded: nip19.DecodedResult
    try { decoded = nip19.decode(ref.trim().replace(/^nostr:/, '')) } catch {
      set({ notice: 'That is not an nevent or an naddr.' })
      return null
    }
    // An nevent names one immutable event, which is what an object is pinned
    // to. An naddr is accepted because somebody may publish a palette as an
    // addressable event of their own; the shape rules are the same once it is
    // in hand (DECK-0003 §1.3b).
    const [filter, hints] = decoded.type === 'nevent'
      ? [{ ids: [decoded.data.id] }, decoded.data.relays]
      : decoded.type === 'naddr'
        ? [{ kinds: [decoded.data.kind], authors: [decoded.data.pubkey], '#d': [decoded.data.identifier] }, decoded.data.relays]
        : [null, undefined]
    if (!filter) {
      set({ notice: 'That points at something else. A palette is an nevent or an naddr.' })
      return null
    }
    const relays = withHints(hints)
    // Asked one relay at a time, in parallel, so the answer says where each
    // event was actually seen: that is what a relay hint is for.
    const answers = await Promise.all(relays.map(async (r) => ({ r, evs: await queryAny([r], filter).catch(() => [] as NostrEvent[]) })))
    const found = answers.flatMap((a) => a.evs)
    // The newest, for an naddr that several relays answer with different
    // versions of. An nevent can only match one event, so this is a no-op there.
    const ev = found.sort((a, b) => b.created_at - a.created_at)[0]
    if (!ev) {
      // Which relays, because "no relay had it" is unactionable and the usual
      // cause is that the pointer named none. An nevent with no relay hint can
      // only be looked for where this app already goes, and a palette
      // published on somebody else's relay is not there. Espy's palettes, for
      // one, live on relay.ditto.pub and its nevents carry no hints at all.
      const shown = relays.slice(0, 3).map((r) => r.replace(/^wss:\/\//, ''))
      const rest = relays.length - shown.length
      set({
        notice: `No relay had that event. Looked on ${shown.join(', ')}${rest > 0 ? ` and ${rest} more` : ''}`
          + `${hints?.length ? '' : ', and the pointer named no relay of its own'}`
          + '. Add the relay it lives on in the menu, or paste the colors instead.',
      })
      return null
    }
    const colors = parsePaletteEvent(ev)
    if (!colors) {
      // A failed fetch rather than an error, in the deck's sense: the event is
      // real and is simply not a palette, so there is nothing to adopt.
      set({ notice: 'That event carries no palette.' })
      return null
    }
    // Where it was actually seen, not where it was looked for, because that is
    // what a relay hint is for.
    const seen = answers.filter((a) => a.evs.some((e) => e.id === ev.id)).map((a) => a.r)
    return {
      colors,
      name: ev.tags.find((t) => t[0] === 'name')?.[1] ?? null,
      event: { id: ev.id, genesis: ev.id, relays: seen.length ? seen : relays.slice(0, 1) },
    }
  },
}))
