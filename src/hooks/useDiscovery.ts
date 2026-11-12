/**
 * useDiscovery.ts — scan for chalk near where you are looking.
 *
 * Spec §7.4: at a coordinate you scan heights, compute each region's lookup_id,
 * and ask the relay for encrypted content published under them. The keys come
 * from the region worker, off the frame; the relay query and the decryption
 * are here. What decrypts goes into the shard store and appears in the world.
 *
 * The scan re-runs when the anchor crosses into a new region, not on every
 * gibson: §7.5 says an aligned subtree of height h changes only when you cross
 * a boundary at that height, so a key stays valid until you do, and there is
 * nothing to recompute until then.
 */

import { useEffect, useRef, useState } from 'react'
import { query } from '../lib/relay'
import { HIDDEN_KIND, unbag, type Hidden } from '../lib/hidden'
import type { NostrEvent } from 'nostr-tools'
import { unbagRemembered } from '../lib/foundCache'
import { bagsToOpen } from '../lib/bagVersions'
import { hexToBytes } from '../lib/events'
import { MAX_COMPUTE_HEIGHT, useCyberspace } from '../store/useCyberspace'
import { useCeremony } from '../store/useCeremony'
import { SCAN_MAX_HEIGHT, useShards } from '../store/useShards'
import { resolveReference } from '../lib/references'
import { useSecrets, type CurrentKey } from '../store/useSecrets'
import { useTv } from '../store/useTv'
import type { RegionRequest, RegionResponse } from '../workers/region.worker'
import { guideBagsFor, onGuideBags } from '../tutorial/guideBags'
import { afterHop, frameBudget } from '../lib/hopStage'

/** The aligned base of a value at a height: what decides "same region". */
function base(v: bigint, h: number): bigint {
  return (v >> BigInt(h)) << BigInt(h)
}

/** A signature of which regions the current anchor sits in, all heights. */
function regionSignature(x: bigint, y: bigint, z: bigint): string {
  let sig = ''
  for (let h = 0; h <= SCAN_MAX_HEIGHT; h++) sig += `${base(x, h)},${base(y, h)},${base(z, h)};`
  return sig
}

export function useDiscovery(): void {
  const anchor = useCyberspace((s) => s.anchor)
  const plane = useCyberspace((s) => s.anchorPlane)
  const tvOn = useTv((s) => s.on)
  const worker = useRef<Worker | null>(null)
  const lastSig = useRef<string | null>(null)
  const reqId = useRef(0)
  // The tutorial guide's bags on this device (tutorial/guideBags.ts): when
  // they change, where you stand is scanned again, so a blue box staged
  // around you appears without a step.
  const [guideVersion, setGuideVersion] = useState(0)
  useEffect(() => onGuideBags(() => { lastSig.current = null; setGuideVersion((v) => v + 1) }), [])

  useEffect(() => {
    worker.current = new Worker(new URL('../workers/region.worker.ts', import.meta.url), { type: 'module' })
    return () => {
      worker.current?.terminate()
      worker.current = null
      // The scan below skips a region it has already asked about. A terminated
      // worker never answered, so the memory of having asked has to go with it,
      // or the next worker is never asked anything. In development React mounts
      // effects twice, which is exactly this: the first worker was killed
      // mid-scan and the second sat idle, so nothing was ever found.
      lastSig.current = null
      useShards.getState().setScanning(false)
    }
  }, [])

  useEffect(() => {
    // Cyberspace TV points the anchor at its shots, its bag boxes and the
    // middle of a hyperjump's line, none of them where an avatar stood at
    // that moment on tape, and a scan here would add messages and coins and
    // bags newer than the moment shown. TV scans for itself, where its
    // avatars stand and as of tape time (lib/tv/scan.ts; arkinox,
    // 2026-10-19). A scan cut off by TV starting never finishes, so it is
    // forgotten, as a terminated worker's is above: the view TV puts back is
    // scanned again.
    if (tvOn) {
      lastSig.current = null
      reqId.current++
      useShards.getState().setScanning(false)
      return
    }
    const sig = regionSignature(anchor.x, anchor.y, anchor.z)
    if (sig === lastSig.current) return
    lastSig.current = sig

    const id = ++reqId.current
    const w = worker.current
    if (!w) return

    // Collect this scan's keys, then query the relay once for all of them.
    const keys = new Map<string, string>() // lookupId -> keyHex
    const heights = new Map<string, number>() // lookupId -> the cube's height

    const onMessage = (e: MessageEvent<RegionResponse>): void => { void handle(e) }
    const handle = async (e: MessageEvent<RegionResponse>): Promise<void> => {
      const msg = e.data
      if (msg.id !== id) return
      if (msg.type === 'key') {
        keys.set(msg.key.lookupId, msg.key.keyHex)
        heights.set(msg.key.lookupId, msg.key.height)
        return
      }
      if (msg.type === 'error') {
        // A scan that dies took SCANNING with it; leaving the tag lit forever
        // said the machine was still looking when it had stopped.
        w.removeEventListener('message', onMessage)
        useShards.getState().setScanning(false)
        console.warn('[discovery] region worker failed:', msg.message)
        return
      }
      if (msg.type !== 'done') return
      w.removeEventListener('message', onMessage)
      if (keys.size === 0) { useShards.getState().setScanning(false); return }

      // The chat needs these before the relay answers, and whether it answers:
      // an envelope said in one of these cubes opens with one of these keys.
      const current: Record<string, CurrentKey> = {}
      for (const [lookupId, keyHex] of keys) current[lookupId] = { keyHex, height: heights.get(lookupId) ?? 0 }
      useSecrets.getState().setCurrent(current)

      // Where you stand, as a scanned place, with these thirteen keys: only at
      // your own head. A camera view, someone you spectate, your own history
      // and a hyperspace transit all move the anchor too, and none of them is
      // somewhere you stood. In the plane you stand in, which at your head can
      // differ from the one the scene shows after a plane flip.
      const cs = useCyberspace.getState()
      if (cs.atHead()) {
        void useSecrets.getState().recordPlace(anchor, cs.headPlane, [...keys].map(([lookupId, keyHex]) => ({ lookupId, keyHex, height: heights.get(lookupId) ?? 0 })))
      }

      /**
       * Open these bags with this scan's keys: the finds, the regions that
       * opened something, and the bags that did not open with their key (not
       * current, so what an older version of one gave stays: lib/hidden.ts
       * BagUnreadable).
       */
      const openBags = async (events: readonly NostrEvent[], guideIds: ReadonlySet<string> = new Set()): Promise<{ found: Hidden[]; opened: string[]; unread: Set<string> }> => {
        const found: Hidden[] = []
        const opened: string[] = []
        const unread = new Set<string>()
        // A frame between bags whenever the opening has held the thread for
        // 8 ms, so a full region never stalls the view while it opens.
        const pause = frameBudget()
        for (const ev of events) {
          await pause()
          // A scan superseded while it opens its list stops opening it: the
          // newer one is opening the same bags, and its finds are the ones
          // kept. What already opened still holds its keys, below.
          if (id !== reqId.current) break
          const region = ev.tags.find((t) => t[0] === 'd')?.[1]
          const keyHex = region ? keys.get(region) : undefined
          if (!keyHex || !region) continue
          // One envelope holds a bag; unbag flattens it to items.
          // A reference without its own point is drawn at the base of this region.
          // The height is the key's own, so a bag whose hider left `h` off
          // (spec §8.6, arkinox 2026-10-01) is read at its true size.
          const height = heights.get(region) ?? 0
          const h = BigInt(height)
          const origin = { at: { x: (anchor.x >> h) << h, y: (anchor.y >> h) << h, z: (anchor.z >> h) << h }, plane }
          let items: Hidden[]
          try {
            // A tutorial guide's bag is opened and forgotten: never kept in
            // the found bags, which outlive the tutorial and ask relays about
            // their authors (lib/foundCache.ts).
            items = guideIds.has(ev.id) ? await unbag(ev, hexToBytes(keyHex), resolveReference, origin, height) : await unbagRemembered(ev, hexToBytes(keyHex), resolveReference, origin, height)
          } catch {
            unread.add(ev.id)
            continue
          }
          if (items.length > 0) opened.push(region)
          found.push(...items)
        }
        return { found, opened, unread }
      }

      /*
       * Which keys are worth keeping.
       *
       * Every position is inside thirteen cubes, and this machine computes all
       * thirteen every time you cross into a new one, so holding them all made
       * the Secrets list a record of where the camera had been. Worse, the scan
       * runs at the anchor, and the anchor follows exploring, spectating and
       * the free view: regions were being marked as yours because you had
       * looked at them.
       *
       * A key is kept when it opened something. That is the one that means
       * anything: it says there is something here and you can read it. The
       * rest cost milliseconds to compute again the moment you stand there,
       * and the place you stood keeps them for RESCAN ALL.
       *
       * Wherever the anchor is (arkinox, 2026-10-04): a key that opened
       * something while you spectate, explore your history or look around is
       * as real as one found at your head. What it cannot be is a place, and
       * places are only recorded at your head, above.
       */
      const holdOpened = (opened: readonly string[]): void => {
        if (opened.length === 0) return
        const now = Math.floor(Date.now() / 1000)
        useSecrets.getState().hold(opened.map((region) => ({
          lookupId: region,
          keyHex: keys.get(region)!,
          height: heights.get(region) ?? 0,
          base: {
            x: String(base(anchor.x, heights.get(region) ?? 0)),
            y: String(base(anchor.y, heights.get(region) ?? 0)),
            z: String(base(anchor.z, heights.get(region) ?? 0)),
          },
          plane,
          source: 'scan' as const,
          at: now,
        })))
      }

      // The tutorial guide's bags here (tutorial/guideBags.ts; first-arrival
      // tutorial design, D1), opened at once, as if a relay had sent them:
      // a slow relay must not keep a newcomer's chest away. Filed now and
      // again with the relays' answer below, where they join it after the
      // relays' own checks: never asked about, never sent anywhere.
      const guided = guideBagsFor(keys.keys())
      const guideIds = new Set(guided.map((g) => g.id))
      if (guided.length > 0) {
        const early = await openBags(guided, guideIds)
        if (id !== reqId.current) return
        holdOpened(early.opened)
        const fresh = useShards.getState().freshOf(early.found)
        // A guide bag staged again (RESTART) replaces what the one before it gave.
        useShards.getState().dropStale(guided, [], early.found)
        useShards.getState().addDiscovered(early.found)
        useCeremony.getState().mark(fresh)
      }

      // A superseded scan must not write stale finds.
      const sent = await query({ kinds: [HIDDEN_KIND], '#d': [...keys.keys()] })
      if (id !== reqId.current) return
      // One version per bag, the newest, none its author deleted: relays hold
      // different versions, and opening all of them drew what a DELETE took
      // out (lib/bagVersions.ts; arkinox, 2026-11-03).
      const { bags: relayBags, deletions } = await bagsToOpen(sent, query, useShards.getState().ownDoorAddresses(keys.keys()))
      if (id !== reqId.current) return
      const events = guided.length > 0 ? [...relayBags, ...guided] : relayBags
      const { found, opened, unread } = await openBags(events, guideIds)
      holdOpened(opened)
      if (id === reqId.current) {
        // Asked before addDiscovered, which records these as seen.
        const fresh = useShards.getState().freshOf(found)
        useShards.getState().dropStale(unread.size > 0 ? events.filter((e) => !unread.has(e.id)) : events, deletions, found)
        useShards.getState().addDiscovered(found)
        useShards.getState().honorRetractions(keys.keys(), events, deletions)
        useShards.getState().setScanning(false)
        // The ceremony: only for what this scan opened for the first time.
        useCeremony.getState().mark(fresh)
      }
    }

    const request: RegionRequest = {
      id,
      x: anchor.x.toString(),
      y: anchor.y.toString(),
      z: anchor.z.toString(),
      heights: Array.from({ length: SCAN_MAX_HEIGHT + 1 }, (_, h) => h),
      maxComputeHeight: MAX_COMPUTE_HEIGHT,
    }
    // After your own hop, the scan starts once the avatar has arrived
    // (lib/hopStage.ts): what it finds, the tutorial's chest among them,
    // appears after the glide instead of stalling the frames it is drawn in
    // (owner, 2026-11-12). Any other move of the anchor scans at once. A scan
    // superseded or stopped while it waited never starts.
    let listening = false
    afterHop(() => {
      if (id !== reqId.current || worker.current !== w) return
      useShards.getState().setScanning(true)
      w.addEventListener('message', onMessage)
      listening = true
      w.postMessage(request)
    })

    return () => { if (listening) w.removeEventListener('message', onMessage) }
  }, [anchor, tvOn, guideVersion])
}
