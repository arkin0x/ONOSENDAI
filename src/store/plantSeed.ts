/**
 * plantSeed.ts - what COMMIT does for a seed before its bag is written
 * (DECK-0008 §7, §8.1, §8.2), for the deploy in useShards.
 *
 * 1. The DNA: the one already signed for this text and these caps (this
 *    session, or one of yours on the relays), else a new one signed now. It
 *    goes to the relays first when it is not there yet: publishing a DNA is
 *    free, and a finder must be able to fetch it. LOCAL keeps it on this
 *    device, and BROADCAST sends it with the bag later (useShards).
 * 2. The seed at the clock block (the tip minus 6, §4.2), at the build
 *    cursor's point, its work mined in workers at its DNA's price with the
 *    committed target equal to that price. The deploy bar shows how far the
 *    mining is and about how long is left, and CANCEL stops it.
 *
 * The signer then signs the mined template unchanged, and the deploy checks
 * the work still holds on what came back.
 */

import { clockHeight } from 'sno-core/seeds'
import { describeDuration, expectedTries, nonceTagged, type MineTemplate } from '../lib/avatarMine'
import { MineCancelled, mineInWorker, type AvatarMiner, type MineProgress } from '../lib/avatarWorker'
import { publishMany, query, relaySet } from '../lib/relay'
import { attributed } from '../lib/client'
import type { EventTemplate, NostrEvent } from '../lib/events'
import type { Plane } from 'cyberspace-core'
import type { Position } from '../lib/space'
import { dnaMatches, dnaTemplate, draftPrice, dnaTextRefusal, readDnaText, seedTemplate, type SeedDraft } from '../lib/seeds/plant'
import { checkDna, idbDnaCache } from '../lib/seeds/dnaStore'
import { dnaResolver, refreshTrustedTip, trustedTip } from '../lib/seeds/seedSources'
import { DNA_KIND, type SeedStand } from '../lib/seeds/seedItem'

/** The name a seed draft goes by: its DNA's, or its title. Parsed once per text (plant.ts readDnaText). */
export function seedDraftName(draft: SeedDraft): string {
  if (draft.title.trim()) return draft.title.trim()
  const read = readDnaText(draft.text)
  return read.ok ? read.name : 'seed'
}

/** The miner: the avatar's NIP-13 workers. Replaced in tests, where there is no Worker. */
let miner: AvatarMiner = mineInWorker
export function setSeedMiner(m: AvatarMiner | null): void {
  miner = m ?? mineInWorker
}

/** The planting being mined, if one is, and how to stop it. */
let mining: { pending: object; cancel: () => void } | null = null

/** Whether this pending deploy's seed is being mined now: CANCEL may stop it. */
export function isMining(pending: object | null): boolean {
  return pending !== null && mining?.pending === pending
}

/** Stop the mining, if any. The deploy's promise rejects with MineCancelled. */
export function cancelMining(): void {
  const m = mining
  mining = null
  m?.cancel()
}

/** "Mining the seed: 40%, about 3 s left" (or "any moment" past the expected work). */
export function miningNote(p: MineProgress, bits: number): string {
  const expected = expectedTries(bits)
  const pct = Math.min(99, Math.floor((p.tries / expected) * 100))
  if (p.tries >= expected || p.elapsedMs <= 0) return `Mining the seed: ${pct}%, any moment now`
  const rate = p.tries / (p.elapsedMs / 1000)
  return `Mining the seed: ${pct}%, ${describeDuration((expected - p.tries) / rate)} left`
}

/** DNAs signed or found this session, by author, caps and text: every later planting of the same DNA names the same one. */
const kept = new Map<string, NostrEvent>()
const keyOf = (owner: string, d: SeedDraft): string => `${owner}|${d.caps.vertices}.${d.caps.symbols}.${d.caps.generations}|${d.text}`

/** The first relay that takes an event, or null. */
async function publishTo(ev: NostrEvent): Promise<string | null> {
  const urls = relaySet()
  if (urls.length === 0) return null
  const sent = await publishMany(urls, ev)
  return sent.ok ? sent.accepted?.[0] ?? urls[0] : null
}

/** The DNA this seed plants, on the relays when live, and the relay hint its `dna` tag names. */
export async function dnaFor(draft: SeedDraft, owner: string, live: boolean, createdAt: number, sign: (t: EventTemplate) => Promise<NostrEvent>): Promise<{ event: NostrEvent; hint: string }> {
  // An original DNA the owner has published: that event, by id, for every seed of it (owner ruling 2026-11-10).
  if (draft.dnaId) {
    const v = await dnaResolver.resolve(draft.dnaId)
    if (v.state !== 'ok' || !dnaMatches(v.event, draft.text, draft.caps)) throw new Error('The original DNA is not on your relays yet. Try again in a moment.')
    return { event: v.event, hint: relaySet()[0] ?? '' }
  }
  const key = keyOf(owner, draft)
  let ev: NostrEvent | undefined = kept.get(key)
  // One of yours this device signed before, LOCAL or not, kept in IndexedDB: no second copy after a reload.
  if (!ev) {
    const stored = await idbDnaCache.all().catch(() => [] as NostrEvent[])
    ev = stored.filter((e) => e.pubkey === owner && dnaMatches(e, draft.text, draft.caps) && checkDna(e, e.id).state === 'ok').sort((a, b) => a.created_at - b.created_at)[0]
  }
  if (!ev && live) {
    // One of yours already out there with this text and these caps: no second copy.
    const yours = await query({ kinds: [DNA_KIND], authors: [owner], limit: 200 }).catch(() => [] as NostrEvent[])
    ev = yours.filter((e) => dnaMatches(e, draft.text, draft.caps) && checkDna(e, e.id).state === 'ok').sort((a, b) => a.created_at - b.created_at)[0]
  }
  if (!ev) ev = await sign(dnaTemplate(draft.text, draft.caps, createdAt))
  kept.set(key, ev)
  // Grown here at once, and after a reload, LOCAL or not.
  dnaResolver.note(ev)
  void idbDnaCache.save(ev)
  if (!live) return { event: ev, hint: '' }
  const there = await query({ ids: [ev.id] }).catch(() => [] as NostrEvent[])
  if (there.some((e) => e.id === ev!.id)) return { event: ev, hint: relaySet()[0] ?? '' }
  const took = await publishTo(ev)
  if (!took) throw new Error('No relay took the DNA. Try again when one is reachable.')
  return { event: ev, hint: took }
}

/** What the deploy passes in. */
export interface PlantContext {
  at: Position
  plane: Plane
  createdAt: number
  owner: string
  live: boolean
  sign: (t: EventTemplate) => Promise<NostrEvent>
  /** Whether this planting is still the deploy lined up: once another replaces it, its mining stops. */
  current: () => boolean
  /** How the bloom stands, from the deploy bar's TURN, SNAP TO EARTH and FINE ROTATION (§5.7), as the tags write it. */
  stand?: SeedStand
  note: (n: string) => void
  mining: (on: boolean) => void
}

/**
 * The seed's template with its work: the DNA ready, the planted block the
 * clock's, the nonce mined at the DNA's price. Throws MineCancelled on CANCEL.
 */
export async function plantedTemplate(pending: { type: 'seed'; seed: SeedDraft }, o: PlantContext): Promise<EventTemplate> {
  const draft = pending.seed
  const refusal = dnaTextRefusal(draft.text)
  const price = draftPrice(draft)
  if (refusal || price === null) throw new Error(refusal ?? 'Its size limit is out of range.')
  o.note('Getting the DNA ready')
  const dna = await dnaFor(draft, o.owner, o.live, o.createdAt, o.sign)
  // The writer's clock block (§4.2): the tip this client trusts, NTH's newest verified anchor, asked
  // for now (a tab left idle may hold an old one), minus 6.
  await refreshTrustedTip(null, Date.now(), true)
  const tip = trustedTip()
  if (tip === null) throw new Error('No block yet to plant at. Try again in a moment.')
  if (!o.current()) throw new MineCancelled()
  // Attributed before it is mined, as an avatar is (lib/client.ts): the signer adds no client tag to a
  // template that names one, so the work, done over every tag, still holds on what it signs.
  const template = attributed(seedTemplate({ dnaId: dna.event.id, relayHint: dna.hint, planted: clockHeight(tip), scale: draft.scale, at: o.at, plane: o.plane, title: draft.title, createdAt: o.createdAt, ...(o.stand ? { stand: o.stand } : {}) }))
  o.note('Mining the seed')
  o.mining(true)
  const mineable: MineTemplate = { pubkey: o.owner, created_at: template.created_at, kind: template.kind, tags: template.tags, content: template.content }
  const job = miner(mineable, price, (p) => {
    // Replaced by another deploy (BUILD stays up while it mines): stop, and say nothing on the new one's bar.
    if (!o.current()) { job.cancel(); return }
    o.note(miningNote(p, price))
  })
  mining = { pending, cancel: job.cancel }
  try {
    const found = await job.done
    return nonceTagged(template, found.nonce, price)
  } finally {
    if (mining?.pending === pending) mining = null
    o.mining(false)
  }
}

/** For tests: forget the DNAs kept this session. */
export function forgetKeptDnas(): void {
  kept.clear()
}
