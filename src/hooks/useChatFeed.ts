/**
 * useChatFeed.ts — listen for what is said where you stand, and one cube over.
 *
 * One live subscription for ephemeral envelopes (kind 23330) filed under any
 * of the regions the passive scan says you are in, plus the 26 cubes of side
 * 2^SCAN_MAX_HEIGHT around yours: a line is sealed to the cube its speaker
 * stands in, and two people a gibson apart on either side of a cube's wall
 * would otherwise never hear each other. The neighbors' keys are computed
 * here, by the same worker the scan uses, whenever you cross into a new cube
 * of that size; 26 roots at one height is a fraction of a second.
 *
 * There is nothing to backfill: the relay keeps none of these, so a line said
 * before you were listening is gone, which is what ephemeral means.
 */

import { useEffect, useRef } from 'react'
import { subscribe } from '../lib/relay'
import { CHAT_BAG_KIND } from '../lib/hidden'
import { useChat } from '../store/useChat'
import { useCyberspace, MAX_COMPUTE_HEIGHT } from '../store/useCyberspace'
import { useSecrets, type CurrentKey } from '../store/useSecrets'
import { SCAN_MAX_HEIGHT } from '../store/useShards'
import type { RegionRequest, RegionResponse } from '../workers/region.worker'

/** Cyberspace is 2^85 gibsons on a side; a neighbor past either edge is not there. */
const EDGE = 1n << 85n

/** The 26 positions one cube of side 2^h away from `at`, those inside cyberspace. */
export function neighborPositions(at: { x: bigint; y: bigint; z: bigint }, h: number): Array<{ x: bigint; y: bigint; z: bigint }> {
  const side = 1n << BigInt(h)
  const out: Array<{ x: bigint; y: bigint; z: bigint }> = []
  for (const dx of [-1n, 0n, 1n]) for (const dy of [-1n, 0n, 1n]) for (const dz of [-1n, 0n, 1n]) {
    if (dx === 0n && dy === 0n && dz === 0n) continue
    const p = { x: at.x + dx * side, y: at.y + dy * side, z: at.z + dz * side }
    if (p.x < 0n || p.y < 0n || p.z < 0n || p.x >= EDGE || p.y >= EDGE || p.z >= EDGE) continue
    out.push(p)
  }
  return out
}

/** Which cube of side 2^h a position is in, as a string that changes only on crossing. */
function cubeKey(at: { x: bigint; y: bigint; z: bigint }, h: number): string {
  const s = BigInt(h)
  return `${at.x >> s},${at.y >> s},${at.z >> s}`
}

export function useChatFeed(): void {
  const current = useSecrets((s) => s.current)
  const neighbors = useSecrets((s) => s.neighbors)
  const anchor = useCyberspace((s) => s.anchor)
  const worker = useRef<Worker | null>(null)
  const reqId = useRef(0)

  // The neighbors' keys, recomputed when you cross into a new cube of the chat's size.
  const cube = cubeKey(anchor, SCAN_MAX_HEIGHT)
  useEffect(() => {
    if (!worker.current) worker.current = new Worker(new URL('../workers/region.worker.ts', import.meta.url), { type: 'module' })
    const w = worker.current
    const found: Record<string, CurrentKey> = {}
    const ids = new Set<number>()
    for (const p of neighborPositions(anchor, SCAN_MAX_HEIGHT)) {
      const id = ++reqId.current
      ids.add(id)
      const request: RegionRequest = { id, x: p.x.toString(), y: p.y.toString(), z: p.z.toString(), heights: [SCAN_MAX_HEIGHT], maxComputeHeight: MAX_COMPUTE_HEIGHT }
      w.postMessage(request)
    }
    const onMessage = (e: MessageEvent<RegionResponse>): void => {
      const msg = e.data
      if (!ids.has(msg.id)) return
      if (msg.type === 'key') found[msg.key.lookupId] = { keyHex: msg.key.keyHex, height: msg.key.height }
      if (msg.type === 'done' || msg.type === 'error') {
        ids.delete(msg.id)
        if (ids.size === 0) useSecrets.getState().setNeighbors(found)
      }
    }
    w.addEventListener('message', onMessage)
    return () => { w.removeEventListener('message', onMessage); ids.clear() }
    // The anchor's cube is what matters, not the anchor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cube])

  useEffect(() => () => { worker.current?.terminate(); worker.current = null }, [])

  const regions = [...new Set([...Object.keys(current), ...Object.keys(neighbors)])].sort().join(',')
  useEffect(() => {
    if (regions === '') return
    const ids = regions.split(',')
    const stop = subscribe({ kinds: [CHAT_BAG_KIND], '#d': ids }, (ev) => { void useChat.getState().receive(ev) })
    return stop
  }, [regions])
}
